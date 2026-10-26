'''REST endpoints for compiling Typst files to SVG, PDF or DOCX.

The endpoints are defined synchronously on purpose: compilation shells out to
the Typst CLI, so FastAPI runs them in its thread pool instead of blocking the
event loop for the duration of a compile.
'''

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..dependencies import get_compiler_service, require_viewer
from ..services.compiler import CompileError, CompilerService, PandocMissing

logger = logging.getLogger(__name__)

DOCX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

router = APIRouter(prefix='/api/buckets/{slug}/compile', tags=['compile'])


def _compile_failed(exc: CompileError) -> HTTPException:
    '''Build the 422 response for a failed compile.'''
    return HTTPException(422, detail={
        'message': str(exc),
        'diagnostics': exc.diagnostics,
    })


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
        raise _compile_failed(exc) from exc

    except RuntimeError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get('/docx/{path:path}')
def compile_docx(
    slug: str, path: str,
    user=Depends(require_viewer),
    svc: CompilerService = Depends(get_compiler_service),
):
    '''Compile a .typ file and return a DOCX (via Typst's HTML export and pandoc).'''
    logger.info('Compiling DOCX for %s/%s (user: %s)', slug, path, user.username)
    try:
        docx_path = svc.compile_docx(slug, path)
        filename = path.rsplit('/', maxsplit=1)[-1].replace('.typ', '.docx')

        return FileResponse(
            docx_path,
            filename=filename,
            media_type=DOCX_MEDIA_TYPE,
            background=BackgroundTask(docx_path.unlink, missing_ok=True),
        )

    except FileNotFoundError as exc:
        raise HTTPException(404, 'File not found') from exc

    except PandocMissing as exc:
        raise HTTPException(501, str(exc)) from exc

    except CompileError as exc:
        raise _compile_failed(exc) from exc

    except RuntimeError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get('/svg/{path:path}')
def compile_svg(
    slug: str, path: str,
    full: bool = False,
    user=Depends(require_viewer),
    svc: CompilerService = Depends(get_compiler_service),
):
    '''Compile a .typ file and return its pages, page count and diagnostics.

    Short documents come back with all their pages inlined. Long ones (see
    ``TINO_PAGED_THRESHOLD``) only carry their first page and are marked
    ``paged``; the client then fetches the remaining pages in batches. With
    ``full``, every page is returned regardless of the document's length.
    A failed compilation is not an HTTP error: it returns ``ok: false`` plus the
    diagnostics, so the client can keep showing the last successful render.
    '''
    logger.debug('Compiling SVG for %s/%s (user: %s)', slug, path, user.username)
    try:
        return svc.compile_document(slug, path, full=full)

    except FileNotFoundError as exc:
        raise HTTPException(404, 'File not found') from exc


@router.get('/pages/{path:path}')
def compile_svg_pages(
    slug: str, path: str,
    pages: str = Query(pattern=r'^\d+(,\d+)*$'),
    user=Depends(require_viewer),
    svc: CompilerService = Depends(get_compiler_service),
):
    '''Compile (or serve from cache) a batch of pages of a long document.

    ``pages`` is a comma-separated list of 1-based page numbers.
    '''
    logger.debug('Compiling pages %s of %s/%s (user: %s)', pages, slug, path, user.username)
    try:
        return svc.compile_pages(slug, path, [int(page) for page in pages.split(',')])

    except FileNotFoundError as exc:
        raise HTTPException(404, 'File not found') from exc
