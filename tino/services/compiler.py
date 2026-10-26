'''Typst compiler service. Shells out to the system `typst` binary to produce SVG or PDF output,
and to `pandoc` for DOCX output.

Compiled SVG pages are cached on disk, keyed by a fingerprint of the source
files the document depends on (as reported by ``typst compile --deps``). As long
as the fingerprint is unchanged, pages are served straight from the cache.

Documents longer than ``page_threshold`` pages switch to *paged* mode: instead
of re-exporting every page on each change, only the first page is compiled up
front (which also yields the current page count) and the remaining pages are
compiled lazily, one at a time, as the client asks for them.

Every paged compilation also schedules a background job that renders the whole
document into the cache, so scrolling usually meets pages that are already
there. The job never blocks a request: it compiles outside the document lock and
throws its result away when the document has changed in the meantime.
'''

import concurrent.futures
import hashlib
import json
import logging
import re
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import NamedTuple

from .diagnostics import has_errors, parse_diagnostics

logger = logging.getLogger(__name__)

_COMPILE_TIMEOUT = 60
_PREFETCH_WORKERS = 2
_DEFAULT_PAGE_THRESHOLD = 10
_KEY_LENGTH = 16
_META_FILE = 'meta.json'
_OUTPUT_TEMPLATE = 'page-{0p}-of-{t}.svg'
_OUTPUT_PATTERN = re.compile(r'^page-(?P<page>\d+)-of-(?P<total>\d+)\.svg$')


class _Document(NamedTuple):
    '''A document to compile: its bucket, its path, and where both live on disk.'''

    slug: str
    path: str
    root: Path
    source: Path


class _Options(NamedTuple):
    '''The parts of a typst invocation that vary between compilations.'''

    fmt: str | None = None
    pages: str | None = None
    deps: Path | None = None


class CompileError(RuntimeError):
    '''Raised when the Typst CLI fails, carrying the parsed diagnostics.'''

    def __init__(self, message, diagnostics):
        super().__init__(message)
        self.diagnostics = diagnostics


#: Optional pandoc reference document for DOCX styling (looked up next to the
#: source file, then at the bucket root).
REFERENCE_DOCX = 'reference.docx'


class PandocMissing(RuntimeError):
    '''DOCX export was requested, but the pandoc CLI is not installed.'''


class CompilerService:
    '''Compiles .typ files to SVG, PDF or DOCX by invoking the Typst (and pandoc) CLI.'''

    def __init__(self, data_dir: Path, package_dir: Path | None = None,
                 font_dir: Path | None = None, cache_dir: Path | None = None,
                 page_threshold: int = _DEFAULT_PAGE_THRESHOLD):
        self.data_dir = data_dir
        self.package_dir = package_dir
        self.font_dir = font_dir
        self.cache_dir = cache_dir
        self.page_threshold = page_threshold
        self._locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()
        self._prefetching: dict[str, str] = {}
        self._prefetch_pool = concurrent.futures.ThreadPoolExecutor(
            max_workers=_PREFETCH_WORKERS, thread_name_prefix='compile-prefetch',
        )

    @staticmethod
    def version() -> str:
        '''Return the installed Typst CLI version string.'''
        result = subprocess.run(
            ['typst', '--version'],
            capture_output=True, text=True, check=True,
        )

        return result.stdout.strip()

    @staticmethod
    def pandoc_available() -> bool:
        '''Return whether the pandoc CLI (needed for DOCX export) is installed.'''
        return shutil.which('pandoc') is not None

    # ── Public API ──

    def compile_document(self, slug: str, path: str) -> dict:
        '''Compile a document and return its pages, page count and fingerprint.

        The result is a dictionary with:

        ``ok``
            ``False`` when compilation failed; the cached pages of the last
            successful compilation (if any) are left untouched so the client can
            keep showing them.
        ``fingerprint``
            Identifies the compiled revision. Page requests carry it back so
            stale pages are never mixed into a newer render.
        ``count``
            Total number of pages, ``0`` when unknown (first compile failed).
        ``paged``
            Whether the remaining pages must be fetched one by one.
        ``pages``
            Mapping of 1-based page number (as a string) to SVG markup. Complete
            for short documents, only the first page for paged ones.
        ``diagnostics``
            Errors and warnings reported by the compiler.
        '''
        doc = self._resolve_source(slug, path)

        with self._lock(doc):
            meta = self._read_meta(doc)
            fingerprint, signatures = self._fingerprint(doc, meta)

            if meta and meta['fingerprint'] == fingerprint:
                cached = self._cached_result(doc, meta)

                if cached:
                    if cached['paged']:
                        self._prefetch(doc, cached['fingerprint'], cached['count'])

                    return cached

            return self._compile_fresh(doc, meta, signatures)

    def compile_page(self, slug: str, path: str, page: int) -> dict:
        '''Compile (or serve from cache) a single page of a document.

        Returns ``{'stale': True, ...}`` when the document changed since the
        last full compile — the client then has to re-run
        :meth:`compile_document` to pick up the new fingerprint and page count.
        '''
        doc = self._resolve_source(slug, path)

        with self._lock(doc):
            meta = self._read_meta(doc)
            fingerprint, _ = self._fingerprint(doc, meta)

            if not meta or meta['fingerprint'] != fingerprint:
                return {'fingerprint': fingerprint, 'ok': False, 'stale': True}

            if page < 1 or page > meta['count']:
                raise FileNotFoundError(f'page {page} is out of range')

            return self._page_result(doc, meta, page)

    def compile_pdf(self, slug: str, path: str) -> Path:
        '''Compile a Typst file and return the path to the resulting PDF.

        Writes to a temporary file; the caller is responsible for deleting it
        (typically via a BackgroundTask on the FileResponse).
        Raises FileNotFoundError if the source file doesn't exist,
        or CompileError if compilation fails (with the parsed diagnostics).
        '''
        doc = self._resolve_source(slug, path)
        logger.info('Compiling PDF for %s/%s', slug, path)

        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
            output = Path(tmp.name)

        try:
            self._run(doc, output, _Options())
        except Exception:
            output.unlink(missing_ok=True)
            raise

        return output

    def compile_docx(self, slug: str, path: str) -> Path:
        '''Compile a Typst file to DOCX and return the path to the resulting file.

        Typst exports HTML (an experimental Typst feature), which pandoc then
        converts to DOCX. The HTML export ignores the page layout and drops the
        cells of ``grid`` elements; templates can render tables instead when
        ``target() == "html"``. Styling comes from an optional
        :data:`REFERENCE_DOCX`, passed to pandoc as ``--reference-doc``.

        Writes to a temporary file; the caller is responsible for deleting it.
        Raises FileNotFoundError if the source file doesn't exist,
        PandocMissing if pandoc isn't installed, CompileError if Typst fails,
        or RuntimeError if pandoc fails.
        '''
        doc = self._resolve_source(slug, path)

        if not self.pandoc_available():
            raise PandocMissing('DOCX export requires pandoc, which is not installed')

        logger.info('Compiling DOCX for %s/%s', slug, path)

        with tempfile.TemporaryDirectory() as tmp:
            html = Path(tmp) / 'document.html'
            self._run(doc, html, _Options(fmt='html'))

            with tempfile.NamedTemporaryFile(suffix='.docx', delete=False) as out:
                output = Path(out.name)

            try:
                self._pandoc(html, output, self._reference_doc(doc), doc.root)
            except Exception:
                output.unlink(missing_ok=True)
                raise

        return output

    def purge(self, slug: str) -> None:
        '''Drop the whole compile cache of a bucket, e.g. when it is deleted.'''
        if not self.cache_dir:
            return

        shutil.rmtree(Path(self.cache_dir) / 'compile' / slug, ignore_errors=True)

    # ── Compilation ──

    def _compile_fresh(self, doc, meta, signatures):
        '''Compile a document whose cache is missing or outdated.

        Known-long documents only export their first page, which is enough to
        learn the (possibly changed) page count from Typst's ``{t}`` template.
        '''
        paged = bool(meta) and meta['count'] > self.page_threshold

        try:
            count, pages, deps, warnings = self._render(doc, '1' if paged else None)

        except CompileError as exc:
            logger.debug('Compilation failed for %s/%s', doc.slug, doc.path)

            return self._failure(meta, exc.diagnostics)

        # Fingerprint the dependencies Typst just reported, using the file
        # signatures taken before the compile ran, so an edit made meanwhile is
        # not mistaken for the revision that was compiled.
        fingerprint = self._dep_fingerprint(doc.root, deps, signatures)
        self._store(doc, {
            'count': count,
            'deps': deps,
            'fingerprint': fingerprint,
            'path': doc.path,
        }, pages)
        paged = count > self.page_threshold

        if paged:
            self._prefetch(doc, fingerprint, count)

        return {
            'count': count,
            'diagnostics': warnings,
            'fingerprint': fingerprint,
            'ok': True,
            'paged': paged,
            # A long document keeps its remaining pages on disk: the client
            # fetches them lazily instead of downloading the whole document.
            'pages': _serialise_pages(pages, first_only=paged),
        }

    def _page_result(self, doc, meta, page):
        '''Serve a single page from the cache, compiling it first if needed.'''
        fingerprint = meta['fingerprint']
        cached = self._page_file(doc, fingerprint, page)

        if cached and cached.is_file():
            return _page_response(fingerprint, page, cached.read_text(encoding='utf-8'))

        try:
            _, pages, _, warnings = self._render(doc, str(page))

        except CompileError as exc:
            return self._failure(meta, exc.diagnostics)

        svg = pages.get(page) or next(iter(pages.values()), '')
        self._write_page(doc, fingerprint, page, svg)

        return _page_response(fingerprint, page, svg, warnings)

    # ── Background prefetching ──

    def _prefetch(self, doc, fingerprint, count):
        '''Schedule a full render of a long document into the cache.

        One job per document at a time: while a revision is being prefetched,
        further compilations of the same document skip scheduling, and the job
        itself discards its result once a newer revision has taken over.
        '''
        key = _key(doc)

        with self._locks_guard:
            if self._prefetching.get(key):
                return

            self._prefetching[key] = fingerprint

        self._prefetch_pool.submit(self._run_prefetch, doc, fingerprint, count)

    def _run_prefetch(self, doc, fingerprint, count):
        '''Render every page of a document and add the missing ones to the cache.'''
        try:
            if self._cached_pages(doc, fingerprint, count):
                return

            logger.debug('Prefetching %d pages of %s/%s', count, doc.slug, doc.path)
            _, pages, _, _ = self._render(doc)
            self._store_prefetched(doc, fingerprint, pages)

        except (CompileError, OSError, subprocess.SubprocessError):
            logger.debug('Prefetch failed for %s/%s', doc.slug, doc.path)

        finally:
            with self._locks_guard:
                self._prefetching.pop(_key(doc), None)

    def _cached_pages(self, doc, fingerprint, count):
        '''Whether every page of a revision is already cached.'''
        return all(
            (page_file := self._page_file(doc, fingerprint, number)) and page_file.is_file()
            for number in range(1, count + 1)
        )

    def _store_prefetched(self, doc, fingerprint, pages):
        '''Write prefetched pages, unless the document moved on while rendering.'''
        with self._lock(doc):
            meta = self._read_meta(doc)

            if not meta or meta['fingerprint'] != fingerprint:
                logger.debug('Discarding prefetch of %s/%s: revision changed',
                             doc.slug, doc.path)

                return

            for number, svg in pages.items():
                self._write_page(doc, fingerprint, number, svg)

    def _failure(self, meta, diagnostics):
        '''Build the response for a failed compilation, keeping the cached pages.'''
        return {
            'count': meta['count'] if meta else 0,
            'diagnostics': diagnostics,
            'fingerprint': meta['fingerprint'] if meta else None,
            'ok': False,
            'paged': bool(meta) and meta['count'] > self.page_threshold,
            'pages': {},
        }

    def _render(self, doc, pages=None):
        '''Compile to SVG and return ``(count, {page: svg}, deps, warnings)``.

        ``count`` is the document's total page count — Typst reports it through
        the ``{t}`` placeholder in the output template, so it is known even when
        only a single page is exported.
        '''
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            deps_file = tmp_dir / 'deps.json'
            options = _Options(fmt='svg', pages=pages, deps=deps_file)
            stderr = self._run(doc, tmp_dir / _OUTPUT_TEMPLATE, options)
            rendered, count = _collect_pages(tmp_dir)
            diagnostics = parse_diagnostics(stderr, doc.root)

            return count, rendered, _read_deps(deps_file), diagnostics

    def _resolve_source(self, slug, path):
        '''Validate that the source file exists and is inside the bucket.'''
        bucket_dir = (self.data_dir / slug).resolve()
        source     = (bucket_dir / path).resolve()

        if not source.is_relative_to(bucket_dir):
            raise FileNotFoundError(f'{path} is outside the bucket')

        if not source.is_file():
            raise FileNotFoundError(f'{path} not found in bucket {slug}')

        return _Document(slug=slug, path=path, root=bucket_dir, source=source)

    def _run(self, doc, output, options):
        '''Build the typst compile command, run it, and raise on failure.'''
        result = subprocess.run(
            self._build_cmd(doc, output, options),
            cwd=str(doc.root),
            capture_output=True, text=True,
            timeout=_COMPILE_TIMEOUT, check=False,
        )

        if result.returncode != 0:
            stderr = result.stderr.strip()
            logger.warning('Compilation failed for %s: %s', doc.source, stderr)
            diagnostics = parse_diagnostics(stderr, doc.root)

            if not has_errors(diagnostics):
                diagnostics.append({
                    'column': None, 'line': None,
                    'message': stderr or 'Compilation failed',
                    'path': None, 'severity': 'error',
                })

            raise CompileError(stderr or 'Compilation failed', diagnostics)

        return result.stderr

    @staticmethod
    def _reference_doc(doc):
        '''Return the reference DOCX next to the source, else at the bucket root, if any.

        Symlinks pointing outside the bucket are ignored.
        '''
        for candidate in (doc.source.parent / REFERENCE_DOCX, doc.root / REFERENCE_DOCX):
            if candidate.is_file() and candidate.resolve().is_relative_to(doc.root):
                return candidate

        return None

    def _pandoc(self, html, output, reference, root):
        '''Convert Typst's HTML output to DOCX with pandoc, and raise on failure.

        ``--sandbox`` limits pandoc to the files on its command line, so
        resources referenced by the HTML (e.g. via raw ``html.elem`` images)
        are never fetched from the network or the file system.
        '''
        cmd = ['pandoc', '--sandbox', '--from', 'html', '--to', 'docx',
               '--output', str(output), str(html)]

        if reference:
            cmd.extend(['--reference-doc', str(reference)])

        result = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=_COMPILE_TIMEOUT, check=False,
        )

        if result.returncode != 0:
            stderr = self._strip_paths(result.stderr.strip(), root)
            logger.warning('DOCX conversion failed for %s: %s', html, stderr)
            raise RuntimeError(stderr or 'DOCX conversion failed')

    def _strip_paths(self, text, root):
        '''Strip absolute paths so only bucket-relative ones reach the client.'''
        for base in (root, self.data_dir):
            text = text.replace(f'{base}/', '').replace(str(base), '')

        return text

    def _build_cmd(self, doc, output, options):
        '''Assemble the typst compile argument list.'''
        cmd = ['typst', 'compile', '--diagnostic-format', 'short']

        if options.fmt:
            cmd.extend(['--format', options.fmt])

        if options.pages:
            cmd.extend(['--pages', options.pages])

        if options.deps:
            cmd.extend(['--deps', str(options.deps)])

        if options.fmt == 'html':
            cmd.extend(['--features', 'html'])

        if self.package_dir:
            cmd.extend(['--package-path', str(self.package_dir)])

        if self.font_dir and self.font_dir.is_dir():
            cmd.extend(['--font-path', str(self.font_dir)])

        cmd.extend(['--root', str(doc.root), str(doc.source), str(output)])

        return cmd

    # ── Cache ──

    def _cached_result(self, doc, meta):
        '''Build a result from cached pages, or ``None`` when the cache is unusable.'''
        fingerprint = meta['fingerprint']
        count       = meta['count']
        paged       = count > self.page_threshold
        wanted      = [1] if paged else list(range(1, count + 1))
        pages       = {}

        for number in wanted:
            page_file = self._page_file(doc, fingerprint, number)

            if not page_file or not page_file.is_file():
                return None

            pages[str(number)] = page_file.read_text(encoding='utf-8')

        return {
            'count': count,
            'diagnostics': meta.get('diagnostics', []),
            'fingerprint': fingerprint,
            'ok': True,
            'paged': paged,
            'pages': pages,
        }

    def _store(self, doc, meta, pages):
        '''Write freshly compiled pages and metadata, dropping stale revisions.'''
        doc_dir = self._doc_dir(doc)

        if not doc_dir:
            return

        page_dir = doc_dir / meta['fingerprint']

        try:
            page_dir.mkdir(parents=True, exist_ok=True)

            for number, svg in pages.items():
                (page_dir / f'page-{number}.svg').write_text(svg, encoding='utf-8')

        except OSError:
            logger.warning('Could not write compiled pages to %s', page_dir)

            return

        _write_json(doc_dir / _META_FILE, meta)
        _prune(doc_dir, meta['fingerprint'])

    def _write_page(self, doc, fingerprint, page, svg):
        '''Add a lazily compiled page to the cache.'''
        page_file = self._page_file(doc, fingerprint, page)

        if not page_file:
            return

        try:
            page_file.parent.mkdir(parents=True, exist_ok=True)
            page_file.write_text(svg, encoding='utf-8')

        except OSError:
            logger.warning('Could not cache compiled page %s', page_file)

    def _read_meta(self, doc):
        '''Read the cached metadata for a document, or ``None`` when absent.'''
        doc_dir = self._doc_dir(doc)

        if not doc_dir:
            return None

        try:
            meta = json.loads((doc_dir / _META_FILE).read_text(encoding='utf-8'))

        except (OSError, ValueError):
            return None

        if not isinstance(meta, dict) or 'fingerprint' not in meta:
            return None

        return meta

    def _doc_dir(self, doc):
        '''Cache directory holding all revisions of one document.'''
        if not self.cache_dir:
            return None

        digest = hashlib.sha256(doc.path.encode('utf-8')).hexdigest()[:_KEY_LENGTH]

        return Path(self.cache_dir) / 'compile' / doc.slug / digest

    def _page_file(self, doc, fingerprint, page):
        '''Path of a single cached page, or ``None`` when caching is disabled.'''
        doc_dir = self._doc_dir(doc)

        return doc_dir / fingerprint / f'page-{page}.svg' if doc_dir else None

    @staticmethod
    def _fingerprint(doc, meta):
        '''Fingerprint a document's inputs, returning ``(hash, signatures)``.

        The dependency list of the previous compilation is authoritative: it
        covers imported files, images and data files, so unrelated edits in the
        bucket do not invalidate the cache. Without one (first compilation), the
        whole bucket is scanned instead, and the collected signatures are reused
        to fingerprint the dependencies the compiler then reports.
        '''
        deps = (meta or {}).get('deps')
        files = [_dep_path(doc.root, dep) for dep in deps] if deps else _scan(doc.root)
        signatures = {str(file): _signature(file) for file in files}

        return _hash(signatures, signatures), signatures

    @staticmethod
    def _dep_fingerprint(bucket_dir, deps, signatures):
        '''Fingerprint the dependencies of a finished compilation.'''
        keys = [str(_dep_path(bucket_dir, dep)) for dep in deps]
        known = {
            key: signatures.get(key) or _signature(Path(key))
            for key in keys
        }

        return _hash(known, keys)

    def _lock(self, doc):
        '''Per-document lock, so concurrent requests compile a document once.'''
        key = _key(doc)

        with self._locks_guard:
            return self._locks.setdefault(key, threading.Lock())


# ── Module helpers ──


def _page_response(fingerprint, page, svg, diagnostics=None):
    '''Build the response for a single compiled page.'''
    return {
        'diagnostics': diagnostics or [],
        'fingerprint': fingerprint,
        'ok': True,
        'page': page,
        'stale': False,
        'svg': svg,
    }


def _key(doc):
    '''Identity of a document across requests: its bucket and path.'''
    return f'{doc.slug}/{doc.path}'


def _serialise_pages(pages, first_only=False):
    '''JSON-friendly ``{page number: svg}`` mapping, optionally the first page only.'''
    wanted = [min(pages)] if first_only and pages else sorted(pages)

    return {str(number): pages[number] for number in wanted}


def _dep_path(bucket_dir, dep):
    '''Absolute path of a dependency Typst reported, relative to the bucket root.'''
    return (bucket_dir / dep).resolve()


def _signature(file):
    '''Change signature of a file: its mtime and size, or ``None`` when missing.'''
    try:
        stat = file.stat()

    except OSError:
        return None

    return f'{stat.st_mtime_ns}:{stat.st_size}'


def _hash(signatures, keys):
    '''Hash a set of file signatures into a short, stable fingerprint.'''
    digest = hashlib.sha256()

    for key in sorted(keys):
        digest.update(f'{key}:{signatures.get(key)}\n'.encode('utf-8'))

    return digest.hexdigest()[:_KEY_LENGTH]


def _collect_pages(tmp_dir):
    '''Read the SVG files Typst wrote, returning ``({page: svg}, total_pages)``.'''
    pages = {}
    total = 0

    for svg_file in sorted(tmp_dir.glob('page-*.svg')):
        match = _OUTPUT_PATTERN.match(svg_file.name)

        if not match:
            continue

        pages[int(match['page'])] = svg_file.read_text(encoding='utf-8')
        total = max(total, int(match['total']))

    return pages, total or len(pages)


def _read_deps(deps_file):
    '''Read the dependency list Typst wrote, as bucket-relative paths.'''
    try:
        data = json.loads(deps_file.read_text(encoding='utf-8'))

    except (OSError, ValueError):
        return []

    return [str(item) for item in data.get('inputs', [])]


def _scan(bucket_dir):
    '''All files in a bucket, ignoring the git directory.'''
    return [
        file for file in bucket_dir.rglob('*')
        if file.is_file() and '.git' not in file.parts
    ]


def _write_json(target, data):
    '''Write JSON to a file, ignoring an unwritable cache directory.'''
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(data), encoding='utf-8')

    except OSError:
        logger.warning('Could not write compile cache metadata to %s', target)


def _prune(doc_dir, keep):
    '''Delete cached revisions of a document other than ``keep``.'''
    for child in doc_dir.iterdir():
        if child.is_dir() and child.name != keep:
            shutil.rmtree(child, ignore_errors=True)
