'''REST endpoints for editor tooling: formatting (typstyle) and diagnostics (tinymist).

Both take the editor's current buffer in the request body rather than reading
the file from disk, so they work on unsaved content.
'''

import logging

from fastapi import APIRouter, Depends, HTTPException

from ..dependencies import get_diagnostics_service, get_formatter_service, require_editor, \
    require_viewer
from ..models import SourceBuffer
from ..services.diagnostics import DiagnosticsService, LspError
from ..services.formatter import FormatterService

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


@router.post('/diagnostics/{path:path}')
async def diagnostics(
    slug: str, path: str, body: SourceBuffer,
    user=Depends(require_viewer),
    svc: DiagnosticsService = Depends(get_diagnostics_service),
):
    '''Return tinymist's diagnostics for a buffer, as if it were saved at ``path``.'''
    logger.debug('Checking %s/%s (user: %s)', slug, path, user.username)
    try:
        return {'diagnostics': await svc.check(slug, path, body.content)}

    except FileNotFoundError as exc:
        raise HTTPException(404, 'File not found') from exc

    except LspError as exc:
        raise HTTPException(503, str(exc)) from exc
