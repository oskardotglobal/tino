'''REST endpoints for editor tooling: formatting, completion and code actions.

None of these takes the document's text from the browser. The editor's content
lives in the collaboration room, which the server can read, so a request carries
only *where* it happens — and every change the server makes goes back through
that same room (see :meth:`tino.collab.CollabManager.replace_content`) rather
than to disk, so it cannot race a client's own edits.
'''

import logging

from fastapi import APIRouter, Depends, HTTPException

from ..collab import CollabManager
from ..dependencies import get_collab_manager, get_formatter_service, get_lsp_service, \
    require_editor, require_viewer
from ..models import CodeActionRequest, CompletionRequest, EditRequest
from ..services.formatter import FormatterService
from ..services.lsp import LspError, LspService
from ..services.text_edits import apply_edits, strip_snippet

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/buckets/{slug}', tags=['editor'])


def _content(collab: CollabManager, slug: str, path: str) -> str:
    '''Return the document as the server knows it, or raise when there is none.'''
    text = collab.document_text(slug, path)

    if text is None:
        raise FileNotFoundError(f'{path} not found in bucket {slug}')

    return text


@router.post('/format/{path:path}')
async def format_source(
    slug: str, path: str,
    user=Depends(require_editor),
    svc: FormatterService = Depends(get_formatter_service),
    collab: CollabManager = Depends(get_collab_manager),
):
    '''Format a file with typstyle and return the result.

    The formatted text is returned rather than written: the editor applies it as
    an ordinary edit, which travels through the collaboration room like any
    keystroke. ``original`` is the text that was formatted, so the editor can
    tell whether it is still looking at the same document.
    '''
    logger.debug('Formatting %s/%s (user: %s)', slug, path, user.username)
    try:
        original = _content(collab, slug, path)

        return {'content': svc.format(original), 'original': original}

    except FileNotFoundError as exc:
        raise HTTPException(404, 'File not found') from exc

    except RuntimeError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post('/complete/{path:path}')
async def complete(
    slug: str, path: str, body: CompletionRequest,
    user=Depends(require_viewer),
    svc: LspService = Depends(get_lsp_service),
):
    '''Return the completions tinymist offers at a position in a file.'''
    logger.debug('Completing %s/%s (user: %s)', slug, path, user.username)
    try:
        return {'items': await svc.complete(slug, path, body.position.model_dump())}

    except FileNotFoundError as exc:
        raise HTTPException(404, 'File not found') from exc

    except LspError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.post('/code-actions/{path:path}')
async def code_actions(
    slug: str, path: str, body: CodeActionRequest,
    user=Depends(require_viewer),
    svc: LspService = Depends(get_lsp_service),
):
    '''Return the code actions tinymist offers for a range in a file.'''
    logger.debug('Listing code actions for %s/%s (user: %s)', slug, path, user.username)
    try:
        return {'actions': await svc.code_actions(slug, path, body.span.model_dump())}

    except FileNotFoundError as exc:
        raise HTTPException(404, 'File not found') from exc

    except LspError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.post('/edits')
async def apply_code_action_edits(
    slug: str, body: EditRequest,
    user=Depends(require_editor),
    collab: CollabManager = Depends(get_collab_manager),
):
    '''Apply a code action's edits to files the editor does not have open.

    The editor applies the edits for the file it is showing itself — that is an
    ordinary edit and syncs like one. Only the other files a code action touches
    come here, and they are rewritten through their collaboration room, never
    straight to disk. Snippet placeholders are resolved to their default text,
    since no one is there to fill them in.
    '''
    logger.info('Applying code-action edits in %s to %s (user: %s)',
                slug, ', '.join(body.files), user.username)
    try:
        for path, edits in body.files.items():
            original = _content(collab, slug, path)
            plain = [
                edit.model_dump() | {'new_text': strip_snippet(edit.new_text)}
                for edit in edits
            ]
            await collab.replace_content(slug, path, apply_edits(original, plain))

        return {'files': sorted(body.files)}

    except FileNotFoundError as exc:
        raise HTTPException(404, 'File not found') from exc
