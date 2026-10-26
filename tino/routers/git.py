'''REST endpoints for git operations on a bucket's repository.'''

import logging
import mimetypes

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from ..auth import get_profile_service
from ..collab import CollabManager
from ..dependencies import get_collab_manager, get_git_service, get_notifier, require_committer, \
    require_editor, require_viewer
from ..models import BranchList, CheckoutRequest, CheckoutResult, CommitInfo, CommitRequest, \
    DiffEntry, FileStatus, RemoteResult, RestoreRequest
from ..services.git import GitService
from ..services.profile import ProfileService

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/buckets/{slug}/git', tags=['git'])


@router.get('/status', response_model=list[FileStatus])
async def git_status(
    slug: str,
    user=Depends(require_viewer),
    svc: GitService = Depends(get_git_service),
):
    '''Return per-file working tree status (modified, untracked, deleted, staged).'''
    try:
        return svc.status(slug)

    except Exception as exc:
        logger.warning('git status failed for %s (user: %s): %s', slug, user.username, exc)
        raise HTTPException(404, 'Bucket not found or not a git repo') from exc


@router.post('/commit', response_model=CommitInfo)
async def git_commit(
    slug: str, body: CommitRequest,
    user=Depends(require_committer),
    svc: GitService = Depends(get_git_service),
    profiles: ProfileService = Depends(get_profile_service),
):
    '''Stage the selected files and create a new commit.

    The commit is authored with the user's profile identity when they set one,
    and with their username and OIDC email otherwise.
    '''
    if not body.files:
        logger.warning(
            'Commit rejected for %s: no files specified (user: %s)',
            slug, user.username,
        )
        raise HTTPException(400, 'No files specified')

    author, email = profiles.identity(user.username, user.email)

    try:
        result = svc.commit(slug, body.files, body.message, author=author, email=email)
    except Exception as exc:
        logger.warning('Commit failed for %s (user: %s): %s', slug, user.username, exc)
        raise HTTPException(400, str(exc)) from exc

    logger.info('Committed %s: %r (user: %s)', slug, body.message, user.username)
    await get_notifier().notify(slug)
    return result


@router.post('/push', response_model=RemoteResult)
async def git_push(
    slug: str,
    user=Depends(require_committer),
    svc: GitService = Depends(get_git_service),
):
    '''Push the bucket's current branch to its remote.

    Credentials come from the server's git configuration; TINO does not handle
    per-user git authentication.
    '''
    try:
        output = svc.push(slug)

    except Exception as exc:
        logger.warning('git push failed for %s (user: %s): %s', slug, user.username, exc)
        raise HTTPException(400, _git_error(exc)) from exc

    logger.info('Pushed %s (user: %s)', slug, user.username)
    return RemoteResult(output=output)


@router.post('/pull', response_model=RemoteResult)
async def git_pull(
    slug: str,
    user=Depends(require_committer),
    svc: GitService = Depends(get_git_service),
    collab: CollabManager = Depends(get_collab_manager),
):
    '''Fast-forward the bucket's current branch from its remote.

    Open collaboration rooms for the updated files are reloaded so connected
    editors adopt the new content, just like a restore does.
    '''
    try:
        output, changed = svc.pull(slug)

    except Exception as exc:
        logger.warning('git pull failed for %s (user: %s): %s', slug, user.username, exc)
        raise HTTPException(400, _git_error(exc)) from exc

    logger.info('Pulled %s: %d file(s) changed (user: %s)', slug, len(changed), user.username)

    if changed:
        await collab.reload_rooms(slug, changed)
        await get_notifier().notify(slug)

    return RemoteResult(changed=changed, output=output)


@router.get('/branches', response_model=BranchList)
async def git_branches(
    slug: str,
    user=Depends(require_viewer),
    svc: GitService = Depends(get_git_service),
):
    '''List the local branches and the currently checked-out one.'''
    try:
        return svc.branches(slug)

    except Exception as exc:
        logger.warning('git branches failed for %s (user: %s): %s', slug, user.username, exc)
        raise HTTPException(404, 'Bucket not found or not a git repo') from exc


@router.post('/checkout', response_model=CheckoutResult)
async def git_checkout(
    slug: str, body: CheckoutRequest,
    user=Depends(require_committer),
    svc: GitService = Depends(get_git_service),
    collab: CollabManager = Depends(get_collab_manager),
):
    '''Switch the bucket to another branch, optionally creating it first.

    The working tree is shared by everyone, so this switches the branch for
    all users of the bucket. Open collaboration rooms for files that differ
    between the branches are reloaded, as after a pull.
    '''
    try:
        changed = svc.checkout(slug, body.branch, create=body.create)

    except Exception as exc:
        logger.warning('git checkout of %r failed for %s (user: %s): %s',
                       body.branch, slug, user.username, exc)
        raise HTTPException(400, _git_error(exc)) from exc

    logger.info('Switched %s to %s: %d file(s) changed (user: %s)',
                slug, body.branch, len(changed), user.username)

    if changed:
        await collab.reload_rooms(slug, changed)
    await get_notifier().notify(slug)

    return CheckoutResult(branch=body.branch, changed=changed)


def _git_error(exc: Exception) -> str:
    '''Extract the most useful message from a failed git invocation.'''
    stderr = getattr(exc, 'stderr', '') or ''
    return stderr.strip() or str(exc)


@router.get('/log', response_model=list[CommitInfo])
async def git_log(
    slug: str,
    user=Depends(require_viewer),
    svc: GitService = Depends(get_git_service),
    path: str | None = Query(None),
    max_count: int = Query(50, ge=1, le=500),
):
    '''Return commit history, optionally filtered to a single file path.'''
    try:
        return svc.log(slug, path, max_count=max_count)

    except Exception as exc:
        logger.warning('git log failed for %s (user: %s): %s', slug, user.username, exc)
        raise HTTPException(404, 'Bucket not found') from exc


@router.get('/diff', response_model=list[DiffEntry])
async def git_diff(
    slug: str,
    user=Depends(require_viewer),
    svc: GitService = Depends(get_git_service),
    path: str | None = Query(None),
    ref: str | None = Query(None),
):
    '''Return unified diffs.

    Without ``ref`` the diff covers working-tree changes vs HEAD. With
    ``ref`` it covers the changes introduced by that commit (vs its parent).
    '''
    try:
        return svc.diff(slug, path, ref)

    except Exception as exc:
        logger.warning('git diff failed for %s (user: %s): %s', slug, user.username, exc)
        raise HTTPException(404, 'Bucket not found') from exc


@router.get('/tree/{ref}')
async def git_tree(
    slug: str, ref: str,
    user=Depends(require_viewer),
    svc: GitService = Depends(get_git_service),
):
    '''List all files at a specific commit ref.'''
    try:
        return svc.tree(slug, ref)

    except Exception as exc:
        logger.warning(
            'git tree failed for %s at %s (user: %s): %s',
            slug, ref, user.username, exc,
        )
        raise HTTPException(404, 'Commit not found') from exc


@router.get('/changed/{ref}')
async def git_changed(
    slug: str, ref: str,
    user=Depends(require_viewer),
    svc: GitService = Depends(get_git_service),
):
    '''List the files changed in a specific commit.'''
    try:
        return svc.changed_files(slug, ref)

    except Exception as exc:
        logger.warning(
            'git changed failed for %s at %s (user: %s): %s',
            slug, ref, user.username, exc,
        )
        raise HTTPException(404, 'Commit not found') from exc


@router.get('/show/{ref}/content/{path:path}')
async def git_show(
    slug: str, ref: str, path: str,
    user=Depends(require_viewer),
    svc: GitService = Depends(get_git_service),
):
    '''Retrieve a file's content at a specific commit ref.'''
    logger.debug('Showing %s/%s at %s (user: %s)', slug, path, ref, user.username)
    result = svc.show(slug, ref, path)

    if result is None:
        raise HTTPException(404, 'File not found at that ref')

    return {'ref': ref, 'path': path, **result}


@router.get('/show/{ref}/raw/{path:path}')
async def git_show_raw(
    slug: str, ref: str, path: str,
    user=Depends(require_viewer),
    svc: GitService = Depends(get_git_service),
):
    '''Serve a file's raw bytes at a specific commit ref (for images).'''
    logger.debug('Serving raw %s/%s at %s (user: %s)', slug, path, ref, user.username)
    data = svc.show_raw(slug, ref, path)

    if data is None:
        raise HTTPException(404, 'File not found at that ref')

    content_type = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    return Response(content=data, media_type=content_type)


@router.post('/restore')
async def git_restore(
    slug: str, body: RestoreRequest,
    user=Depends(require_editor),
    svc: GitService = Depends(get_git_service),
    collab: CollabManager = Depends(get_collab_manager),
):
    '''Restore file(s) from a specific commit into the working tree.'''
    restored = svc.restore(slug, body.ref, body.paths)

    if not restored:
        logger.warning(
            'Restore failed for %s from %s: no files restored (user: %s)',
            slug, body.ref, user.username,
        )
        raise HTTPException(404, 'No files could be restored')

    logger.info('Restored %d file(s) in %s from %s (user: %s)',
                len(restored), slug, body.ref, user.username)
    await collab.reload_rooms(slug, restored)
    await get_notifier().notify(slug)

    return {'restored': restored}
