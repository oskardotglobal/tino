'''REST endpoints for editor tooling: formatting (typstyle) and checking (tinymist).

Both take the editor's current buffer in the request body rather than reading
the file from disk, so they work on unsaved content. The compiler's own
diagnostics travel with the compile results instead (see ``compile.py``).
'''

import logging

from fastapi import APIRouter, Depends, HTTPException

from ..dependencies import get_formatter_service, get_lsp_service, require_editor, require_viewer
from ..models import SourceBuffer
from ..services.formatter import FormatterService
from ..services.lsp import LspError, LspService

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/buckets/{slug}', tags=['editor'])


@router.post('/format')
async def format_source(
    slug: str, body: SourceBuffer,
    user=Depends(require_editor),
    svc: FormatterService = Depends(get_formatter_service),
):
    '''Format a Typst buffer with typstyle and return the result.'''
    logger.debug('Formatting buffer in %s (user: %s)', slug, user.username)
    try:
        return {'content': svc.format(body.content)}

    except RuntimeError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post('/lint/{path:path}')
async def lint(
    slug: str, path: str, body: SourceBuffer,
    user=Depends(require_viewer),
    svc: LspService = Depends(get_lsp_service),
):
    '''Return tinymist's diagnostics for a buffer, as if it were saved at ``path``.'''
    logger.debug('Checking %s/%s (user: %s)', slug, path, user.username)
    try:
        return {'diagnostics': await svc.check(slug, path, body.content)}

    except FileNotFoundError as exc:
        raise HTTPException(404, 'File not found') from exc

    except LspError as exc:
        raise HTTPException(503, str(exc)) from exc
