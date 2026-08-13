'''REST endpoints for compiling Typst files to SVG or PDF.

The endpoints are defined synchronously on purpose: compilation shells out to
the Typst CLI, so FastAPI runs them in its thread pool instead of blocking the
event loop for the duration of a compile.
'''

import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..dependencies import get_compiler_service, require_viewer
from ..services.compiler import CompileError, CompilerService

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/buckets/{slug}/compile', tags=['compile'])


@router.get('/pdf/{path:path}')
def compile_pdf(
    slug: str, path: str,
    user=Depends(require_viewer),
    svc: CompilerService = Depends(get_compiler_service),
):
    '''Compile a .typ file and return the PDF.'''
    logger.info('Compiling PDF for %s/%s (user: %s)', slug, path, user.username)
    try:
        pdf_path = svc.compile_pdf(slug, path)
        filename = path.rsplit('/', maxsplit=1)[-1].replace('.typ', '.pdf')

        return FileResponse(
            pdf_path,
            filename=filename,
            media_type='application/pdf',
            background=BackgroundTask(pdf_path.unlink, missing_ok=True),
        )

    except FileNotFoundError as exc:
        raise HTTPException(404, 'File not found') from exc

    except CompileError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get('/svg/{path:path}')
def compile_svg(
    slug: str, path: str,
    user=Depends(require_viewer),
    svc: CompilerService = Depends(get_compiler_service),
):
    '''Compile a .typ file and return its pages, page count and diagnostics.

    Short documents come back with all their pages inlined. Long ones (see
    ``TINO_PAGED_THRESHOLD``) only carry their first page and are marked
    ``paged``; the client then fetches the remaining pages one by one.
    A failed compilation is not an HTTP error: it returns ``ok: false`` plus the
    diagnostics, so the client can keep showing the last successful render.
    '''
    logger.debug('Compiling SVG for %s/%s (user: %s)', slug, path, user.username)
    try:
        return svc.compile_document(slug, path)

    except FileNotFoundError as exc:
        raise HTTPException(404, 'File not found') from exc


@router.get('/page/{page}/{path:path}')
def compile_svg_page(
    slug: str, path: str, page: int,
    user=Depends(require_viewer),
    svc: CompilerService = Depends(get_compiler_service),
):
    '''Compile (or serve from cache) a single page of a long document.'''
    logger.debug('Compiling page %d of %s/%s (user: %s)', page, slug, path, user.username)
    try:
        return svc.compile_page(slug, path, page)

    except FileNotFoundError as exc:
        raise HTTPException(404, 'File not found') from exc
