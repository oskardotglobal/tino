'''Typst language intelligence backed by the `tinymist` language server.

One ``tinymist lsp`` process is kept per bucket and answers the editor's
completion and code-action requests.

The server is fed from TINO's own copy of the document, never from the browser:
the live text of the collaboration room when the file is open (the CRDT is the
authoritative copy while editing), otherwise the file on disk. Requests from the
editor therefore carry a position, not a buffer, and the positions they carry
always refer to the same text the language server sees.

Diagnostics are deliberately *not* taken from here — the compiler reports those
with every render (see :mod:`tino.services.diagnostics`).
'''

import asyncio
import json
import logging
import os
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from urllib.request import url2pathname

from .versions import tool_version

logger = logging.getLogger(__name__)

#: Seconds to wait for the server to answer `initialize`.
_STARTUP_TIMEOUT = 15

#: Seconds to wait for an answer to a document request.
_REQUEST_TIMEOUT = 10

#: Seconds a bucket's language server is kept alive without a request.
_SESSION_TTL = 300

#: Byte sequence terminating an LSP message's header block.
_HEADER_END = b'\r\n\r\n'

#: The subset of LSP completion item kinds Typst uses, by their LSP number.
_COMPLETION_KINDS = {
    1: 'text', 2: 'method', 3: 'function', 4: 'constructor', 5: 'field',
    6: 'variable', 7: 'class', 8: 'interface', 9: 'module', 10: 'property',
    11: 'unit', 12: 'value', 13: 'enum', 14: 'keyword', 15: 'snippet',
    16: 'color', 17: 'file', 18: 'reference', 19: 'folder', 20: 'enum-member',
    21: 'constant', 22: 'struct', 23: 'event', 24: 'operator',
    25: 'type-parameter',
}

#: Code action kinds the editor asks for — everything tinymist has to offer.
_CODE_ACTION_KINDS = [
    '', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline',
    'refactor.rewrite', 'source', 'source.fixAll', 'source.organizeImports',
]

#: LSP marks snippet text (with ``${1:…}`` placeholders) with this format number.
_SNIPPET_FORMAT = 2


class LspError(RuntimeError):
    '''Raised when the language server is unavailable or misbehaves.'''


@dataclass
class _Document:
    '''What a session last told the server about one document.'''

    version: int = 0
    text: str | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class _LspSession:
    '''A single ``tinymist lsp`` child process, scoped to one bucket.

    Speaks just enough of the LSP wire protocol for the editor's requests:
    initialize, full-text didOpen/didChange, completion and code actions.
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

        await self._request('initialize', _INITIALIZE_PARAMS | {
            'processId': os.getpid(),
            'rootUri': self.root.as_uri(),
        }, timeout=_STARTUP_TIMEOUT)

        self._notify('initialized', {})
        logger.info('Started tinymist language server for %s', self.root)

    async def stop(self) -> None:
        '''Terminate the language server and drop all tracked documents.'''
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

    async def ask(self, source: Path, text: str, method: str, params: dict):
        '''Sync a document to ``text``, then send it a request and return the answer.'''
        if not self.alive:
            raise LspError('tinymist language server is not running')

        uri = source.as_uri()
        document = self._docs.setdefault(uri, _Document())

        async with document.lock:
            self._sync(uri, document, text)

            return await self._request(
                method,
                {'textDocument': {'uri': uri}} | params,
                timeout=_REQUEST_TIMEOUT,
            )

    # ── Internal ──

    def _build_env(self):
        '''Environment for the child: the Typst paths tinymist reads on startup.'''
        env = dict(os.environ)

        if self.package_dir:
            env['TYPST_PACKAGE_PATH'] = str(self.package_dir)

        if self.font_dir and self.font_dir.is_dir():
            env['TYPST_FONT_PATHS'] = str(self.font_dir)

        return env

    def _sync(self, uri: str, document: _Document, text: str) -> None:
        '''Open the document, or push its new full text when it has changed.'''
        if document.text == text:
            return

        document.text = text
        document.version += 1

        if document.version == 1:
            self._notify('textDocument/didOpen', {
                'textDocument': {
                    'languageId': 'typst',
                    'text': text,
                    'uri': uri,
                    'version': document.version,
                },
            })
            return

        self._notify('textDocument/didChange', {
            'contentChanges': [{'text': text}],
            'textDocument': {'uri': uri, 'version': document.version},
        })

    async def _request(self, method: str, params: dict, timeout: float):
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
        '''Resolve the pending request a response belongs to.'''
        future = self._pending.get(message.get('id'))

        if not future or future.done():
            return

        if 'error' in message:
            future.set_exception(LspError(str(message['error'])))
        else:
            future.set_result(message.get('result'))


class LspService:
    '''Answers completion and code-action requests for a bucket's Typst files.

    Language servers are created lazily per bucket and terminated once a bucket
    has gone untouched for the session TTL.
    '''

    def __init__(self, data_dir: Path, package_dir: Path | None = None,
                 font_dir: Path | None = None, session_ttl: int = _SESSION_TTL,
                 document_text: Callable[[str, str], str | None] | None = None):
        self.data_dir = data_dir
        self.package_dir = package_dir
        self.font_dir = font_dir
        self.document_text = document_text
        self._session_ttl = session_ttl
        self._sessions: dict[str, _LspSession] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._ttl_tasks: dict[str, asyncio.Task] = {}

    @staticmethod
    def version() -> str | None:
        '''Return the installed tinymist version string, or None when absent.'''
        return tool_version('tinymist')

    async def complete(self, slug: str, path: str, position: dict) -> list[dict]:
        '''Return the completions offered at a position in a file.

        ``position`` is LSP-shaped: zero-based ``line`` and UTF-16 ``character``.
        '''
        result = await self._ask(slug, path, 'textDocument/completion', {
            'context': {'triggerKind': 1},
            'position': position,
        })
        items = result.get('items', []) if isinstance(result, dict) else (result or [])

        return [_completion(item) for item in items]

    async def code_actions(self, slug: str, path: str, span: dict) -> list[dict]:
        '''Return the code actions offered for a range in a file.'''
        result = await self._ask(slug, path, 'textDocument/codeAction', {
            'context': {'diagnostics': [], 'only': _CODE_ACTION_KINDS},
            'range': span,
        })
        actions = (
            _action(slug, self._bucket_dir(slug), entry)
            for entry in (result or [])
            if isinstance(entry, dict)
        )

        return [action for action in actions if action['edits']]

    async def shutdown(self) -> None:
        '''Terminate every language server (called on application shutdown).'''
        for task in self._ttl_tasks.values():
            task.cancel()

        self._ttl_tasks.clear()

        for slug in list(self._sessions):
            session = self._sessions.pop(slug)
            await session.stop()

    # ── Internal ──

    async def _ask(self, slug: str, path: str, method: str, params: dict):
        '''Send one document request, syncing TINO's copy of the file first.'''
        source = self.resolve_source(slug, path)
        text = self.document_text(slug, path) if self.document_text else None

        if text is None:
            raise FileNotFoundError(f'{path} not found in bucket {slug}')

        session = await self._get_or_create_session(slug)
        self._schedule_reap(slug)

        return await session.ask(source, text, method, params)

    def resolve_source(self, slug: str, path: str) -> Path:
        '''Validate that the path stays inside the bucket and return it.'''
        bucket_dir = self._bucket_dir(slug)
        source = (bucket_dir / path).resolve()

        if not source.is_relative_to(bucket_dir):
            raise FileNotFoundError(f'{path} is outside the bucket')

        return source

    def _bucket_dir(self, slug: str) -> Path:
        '''The bucket's root directory, which is also the Typst project root.'''
        return (self.data_dir / slug).resolve()

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

            session = _LspSession(self._bucket_dir(slug), self.package_dir, self.font_dir)
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


#: What the editor supports, as announced to the server on startup. Snippets and
#: markdown documentation are both rendered by CodeMirror's completion widget.
_INITIALIZE_PARAMS = {
    'capabilities': {
        'textDocument': {
            'codeAction': {
                'codeActionLiteralSupport': {
                    'codeActionKind': {'valueSet': _CODE_ACTION_KINDS},
                },
            },
            'completion': {
                'completionItem': {
                    'documentationFormat': ['markdown', 'plaintext'],
                    'snippetSupport': True,
                },
            },
        },
    },
    'initializationOptions': {
        'exportPdf': 'never',
        'formatterMode': 'disable',
        'semanticTokens': 'disable',
    },
}


def _content_length(headers: bytes) -> int:
    '''Extract the body length from an LSP header block.'''
    for line in headers.split(b'\r\n'):
        if line.lower().startswith(b'content-length:'):
            return int(line.split(b':')[1])

    raise ValueError('LSP message without a Content-Length header')


def _completion(item: dict) -> dict:
    '''Reduce an LSP completion item to the fields the editor renders.

    The text to insert comes either as a ``textEdit`` (with the range it
    replaces, which can start before the cursor) or as plain ``insertText``.
    Both are normalised to a range plus a template, so the editor applies them
    the same way.
    '''
    edit = item.get('textEdit') or {}
    text = edit.get('newText', item.get('insertText', item['label']))

    return {
        'detail': item.get('detail') or '',
        'documentation': _documentation(item.get('documentation')),
        'kind': _COMPLETION_KINDS.get(item.get('kind'), 'text'),
        'label': item['label'],
        'range': edit.get('range'),
        'snippet': item.get('insertTextFormat') == _SNIPPET_FORMAT,
        'sort_text': item.get('sortText') or item['label'],
        'text': text,
    }


def _documentation(documentation) -> str:
    '''Flatten LSP documentation, which is either a string or a markup object.'''
    if isinstance(documentation, dict):
        return documentation.get('value') or ''

    return documentation or ''


def _action(slug: str, bucket_dir: Path, action: dict) -> dict:
    '''Reduce an LSP code action to a title plus edits keyed by bucket path.'''
    return {
        'edits': _workspace_edits(slug, bucket_dir, action.get('edit') or {}),
        'kind': action.get('kind') or '',
        'title': action.get('title') or 'Code action',
    }


def _workspace_edits(slug: str, bucket_dir: Path, edit: dict) -> dict:
    '''Turn a workspace edit into ``{bucket-relative path: [text edits]}``.

    Both shapes an LSP server may use are accepted: a ``changes`` map keyed by
    URI, and a ``documentChanges`` list. Edits pointing outside the bucket (a
    package source, say) are dropped — those files are not TINO's to change.
    '''
    edits: dict[str, list[dict]] = {}

    for uri, text_edits in (edit.get('changes') or {}).items():
        _collect(edits, slug, bucket_dir, uri, text_edits)

    for change in edit.get('documentChanges') or []:
        document = change.get('textDocument') or {}
        _collect(edits, slug, bucket_dir, document.get('uri'), change.get('edits'))

    return edits


def _collect(edits: dict, slug: str, bucket_dir: Path, uri, text_edits) -> None:
    '''Add one file's text edits under its bucket-relative path.'''
    path = _bucket_path(bucket_dir, uri)

    if not path or not text_edits:
        if uri:
            logger.debug('Dropping code-action edits for %s in %s', uri, slug)
        return

    edits.setdefault(path, []).extend(
        {
            'new_text': text_edit.get('newText', ''),
            'range': text_edit['range'],
            'snippet': text_edit.get('insertTextFormat') == _SNIPPET_FORMAT,
        }
        for text_edit in text_edits if text_edit.get('range')
    )


def _bucket_path(bucket_dir: Path, uri) -> str | None:
    '''Map a ``file://`` URI back to a bucket-relative path, or None if outside.'''
    if not isinstance(uri, str) or not uri.startswith('file://'):
        return None

    target = Path(url2pathname(uri.removeprefix('file://'))).resolve()

    if not target.is_relative_to(bucket_dir):
        return None

    return str(target.relative_to(bucket_dir))
