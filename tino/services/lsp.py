'''Live Typst checking backed by the `tinymist` language server.

One ``tinymist lsp`` process is kept per bucket and fed the editor's *unsaved*
buffer via LSP text synchronisation, so errors surface while typing instead of
only when the compiler next runs over the saved file (see
:mod:`tino.services.diagnostics` for those).

tinymist pushes diagnostics: it publishes them a moment after a document
changes, and it stays silent when a change leaves the diagnostics identical.
A session therefore caches the last published set per document — silence means
"unchanged", not "unknown" — and a check sends the new text, waits briefly for
a publish, and returns the cached set either way.
'''

import asyncio
import json
import logging
import os
from pathlib import Path

from .versions import tool_version

logger = logging.getLogger(__name__)

#: Seconds to wait for the server to answer `initialize`.
_STARTUP_TIMEOUT = 15

#: Seconds to wait for a `publishDiagnostics` after sending a document change.
#: tinymist debounces its own compilation by roughly half a second, so this has
#: to exceed that — but not by much: a change that leaves the diagnostics
#: identical is never published, and waiting it out delays the whole check.
_PUBLISH_TIMEOUT = 1.0

#: Seconds a bucket's language server is kept alive without any check.
_SESSION_TTL = 300

#: Byte sequence terminating an LSP message's header block.
_HEADER_END = b'\r\n\r\n'

#: LSP severity numbers, mapped to the names the frontend uses.
_SEVERITIES = {1: 'error', 2: 'warning', 3: 'info', 4: 'hint'}


class LspError(RuntimeError):
    '''Raised when the language server is unavailable or misbehaves.'''


class _Document:
    '''Per-document state of a language server session.

    ``diagnostics`` is the last set the server published for the document, which
    stays valid until it publishes a new one. ``published`` wakes the check that
    is waiting for that to happen, and ``content`` is the text those diagnostics
    describe, so an unchanged buffer is answered without asking again.
    '''

    def __init__(self):
        self.version = 0
        self.content: str | None = None
        self.diagnostics: list[dict] = []
        self.published = asyncio.Event()
        self.lock = asyncio.Lock()

    def begin(self) -> int:
        '''Start a check: forget the last publish and return the next version.'''
        self.version += 1
        self.published.clear()

        return self.version

    def publish(self, diagnostics: list[dict]) -> None:
        '''Record a published set of diagnostics and wake a waiting check.'''
        self.diagnostics = diagnostics
        self.published.set()


class _LspSession:
    '''A single ``tinymist lsp`` child process, scoped to one bucket.

    Speaks just enough of the LSP wire protocol for diagnostics: initialize,
    full-text didOpen/didChange, and the publishDiagnostics notification.
    '''

    def __init__(self, root: Path, package_dir: Path | None = None,
                 font_dir: Path | None = None):
        self.root = root
        self.package_dir = package_dir
        self.font_dir = font_dir
        self._proc: asyncio.subprocess.Process | None = None
        self._reader: asyncio.Task | None = None
        self._next_id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._docs: dict[str, _Document] = {}

    async def start(self) -> None:
        '''Spawn the language server and complete the LSP handshake.'''
        try:
            self._proc = await asyncio.create_subprocess_exec(
                'tinymist', 'lsp',
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                cwd=str(self.root),
                env=self._build_env(),
            )

        except FileNotFoundError as exc:
            raise LspError('tinymist is not installed on the server') from exc

        self._reader = asyncio.create_task(self._read_loop())

        await self._request('initialize', {
            'capabilities': {'textDocument': {'publishDiagnostics': {}}},
            'initializationOptions': {
                'exportPdf': 'never',
                'formatterMode': 'disable',
                'semanticTokens': 'disable',
            },
            'processId': os.getpid(),
            'rootUri': self.root.as_uri(),
        }, timeout=_STARTUP_TIMEOUT)

        self._notify('initialized', {})
        logger.info('Started tinymist language server for %s', self.root)

    async def stop(self) -> None:
        '''Terminate the language server and drop all cached state.'''
        if self._reader:
            self._reader.cancel()

        proc = self._proc
        self._proc = None

        if proc and proc.returncode is None:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=5)
            except asyncio.TimeoutError:
                proc.kill()

        for future in self._pending.values():
            if not future.done():
                future.cancel()

        self._pending.clear()
        logger.info('Stopped tinymist language server for %s', self.root)

    @property
    def alive(self) -> bool:
        '''Whether the child process is still running.'''
        return self._proc is not None and self._proc.returncode is None

    async def check(self, source: Path, content: str) -> list[dict]:
        '''Sync a document's content and return its current diagnostics.'''
        if not self.alive:
            raise LspError('tinymist language server is not running')

        uri = source.as_uri()
        document = self._document(uri)

        async with document.lock:
            if content == document.content:
                return document.diagnostics

            document.content = content
            self._sync(uri, document.begin(), content)

            try:
                await asyncio.wait_for(document.published.wait(), timeout=_PUBLISH_TIMEOUT)
            except asyncio.TimeoutError:
                # No publish means tinymist considers the diagnostics unchanged.
                logger.debug('No diagnostics published for %s, reusing the last set', uri)

            return document.diagnostics

    # ── Internal ──

    def _build_env(self):
        '''Environment for the child: the Typst paths tinymist reads on startup.'''
        env = dict(os.environ)

        if self.package_dir:
            env['TYPST_PACKAGE_PATH'] = str(self.package_dir)

        if self.font_dir and self.font_dir.is_dir():
            env['TYPST_FONT_PATHS'] = str(self.font_dir)

        return env

    def _document(self, uri: str) -> _Document:
        '''Return the tracked state for a document, starting to track it if new.'''
        if uri not in self._docs:
            self._docs[uri] = _Document()

        return self._docs[uri]

    def _sync(self, uri: str, version: int, content: str) -> None:
        '''Open the document, or push its new full text when already open.'''
        if version == 1:
            self._notify('textDocument/didOpen', {
                'textDocument': {
                    'languageId': 'typst',
                    'text': content,
                    'uri': uri,
                    'version': version,
                },
            })
            return

        self._notify('textDocument/didChange', {
            'contentChanges': [{'text': content}],
            'textDocument': {'uri': uri, 'version': version},
        })

    async def _request(self, method: str, params: dict, timeout: float) -> dict:
        '''Send a request and await its response.'''
        self._next_id += 1
        request_id = self._next_id
        future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future

        self._write({'id': request_id, 'jsonrpc': '2.0', 'method': method, 'params': params})

        try:
            return await asyncio.wait_for(future, timeout=timeout)

        except asyncio.TimeoutError as exc:
            raise LspError(f'tinymist did not answer {method} in time') from exc

        finally:
            self._pending.pop(request_id, None)

    def _notify(self, method: str, params: dict) -> None:
        '''Send a notification (a request without an id, so without a response).'''
        self._write({'jsonrpc': '2.0', 'method': method, 'params': params})

    def _write(self, message: dict) -> None:
        '''Frame a JSON-RPC message with its Content-Length header and send it.'''
        if not self.alive:
            raise LspError('tinymist language server is not running')

        body = json.dumps(message).encode()
        self._proc.stdin.write(b'Content-Length: %d\r\n\r\n%s' % (len(body), body))

    async def _read_loop(self) -> None:
        '''Pump framed messages from the server until it closes its output.

        A message pump is the one place a loop cannot be avoided: it runs for the
        lifetime of the child process, and the task is cancelled in stop().
        '''
        stdout = self._proc.stdout

        while True:  # pylint: disable=while-used
            try:
                headers = await stdout.readuntil(_HEADER_END)
                message = json.loads(await stdout.readexactly(_content_length(headers)))

            except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, ValueError):
                break

            self._dispatch(message)

        logger.warning('tinymist language server for %s closed its output', self.root)

    def _dispatch(self, message: dict) -> None:
        '''Resolve a pending request, or record published diagnostics.'''
        if message.get('method') == 'textDocument/publishDiagnostics':
            self._store(message['params'])
            return

        future = self._pending.get(message.get('id'))

        if not future or future.done():
            return

        if 'error' in message:
            future.set_exception(LspError(str(message['error'])))
        else:
            future.set_result(message.get('result') or {})

    def _store(self, params: dict) -> None:
        '''Record a document's diagnostics and wake any check waiting on them.'''
        self._document(params['uri']).publish(
            [_normalise(diag) for diag in params.get('diagnostics', [])],
        )


class LspService:
    '''Provides live Typst diagnostics for unsaved buffers via tinymist.

    Language servers are created lazily per bucket and terminated once a bucket
    has gone untouched for the session TTL.
    '''

    def __init__(self, data_dir: Path, package_dir: Path | None = None,
                 font_dir: Path | None = None, session_ttl: int = _SESSION_TTL):
        self.data_dir = data_dir
        self.package_dir = package_dir
        self.font_dir = font_dir
        self._session_ttl = session_ttl
        self._sessions: dict[str, _LspSession] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._ttl_tasks: dict[str, asyncio.Task] = {}

    @staticmethod
    def version() -> str | None:
        '''Return the installed tinymist version string, or None when absent.'''
        return tool_version('tinymist')

    async def check(self, slug: str, path: str, content: str) -> list[dict]:
        '''Return diagnostics for ``content`` as if it were saved at ``slug/path``.

        Raises FileNotFoundError when the path escapes the bucket, or LspError
        when the language server is unavailable.
        '''
        source = self._resolve_source(slug, path)
        session = await self._get_or_create_session(slug)
        self._schedule_reap(slug)

        return await session.check(source, content)

    async def shutdown(self) -> None:
        '''Terminate every language server (called on application shutdown).'''
        for task in self._ttl_tasks.values():
            task.cancel()

        self._ttl_tasks.clear()

        for slug in list(self._sessions):
            session = self._sessions.pop(slug)
            await session.stop()

    # ── Internal ──

    def _resolve_source(self, slug: str, path: str) -> Path:
        '''Validate that the path stays inside the bucket and return it.'''
        bucket_dir = (self.data_dir / slug).resolve()
        source = (bucket_dir / path).resolve()

        if not source.is_relative_to(bucket_dir):
            raise FileNotFoundError(f'{path} is outside the bucket')

        return source

    async def _get_or_create_session(self, slug: str) -> _LspSession:
        '''Return the bucket's language server, starting one when needed.'''
        if slug not in self._locks:
            self._locks[slug] = asyncio.Lock()

        async with self._locks[slug]:
            session = self._sessions.get(slug)

            if session and session.alive:
                return session

            if session:
                # The child died (crash, OOM); drop it and start a fresh one.
                await session.stop()

            session = _LspSession(
                (self.data_dir / slug).resolve(), self.package_dir, self.font_dir,
            )
            await session.start()
            self._sessions[slug] = session

            return session

    def _schedule_reap(self, slug: str) -> None:
        '''(Re)start the idle timer that terminates the bucket's server.'''
        task = self._ttl_tasks.pop(slug, None)

        if task:
            task.cancel()

        self._ttl_tasks[slug] = asyncio.create_task(self._reap_later(slug))

    async def _reap_later(self, slug: str) -> None:
        '''Stop a bucket's language server after the idle TTL elapses.'''
        try:
            await asyncio.sleep(self._session_ttl)
        except asyncio.CancelledError:
            return

        self._ttl_tasks.pop(slug, None)
        session = self._sessions.pop(slug, None)

        if session:
            logger.info('Reaping idle tinymist session for %s', slug)
            await session.stop()


def _content_length(headers: bytes) -> int:
    '''Extract the body length from an LSP header block.'''
    for line in headers.split(b'\r\n'):
        if line.lower().startswith(b'content-length:'):
            return int(line.split(b':')[1])

    raise ValueError('LSP message without a Content-Length header')


def _normalise(diagnostic: dict) -> dict:
    '''Reduce an LSP diagnostic to the fields the editor renders.

    Positions stay LSP-shaped: zero-based line and UTF-16 character offsets.
    '''
    return {
        'message': diagnostic.get('message', ''),
        'range': diagnostic.get('range', {}),
        'severity': _SEVERITIES.get(diagnostic.get('severity'), 'error'),
        'source': diagnostic.get('source') or 'typst',
    }
