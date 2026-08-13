'''REST endpoints for bucket CRUD operations.'''

import logging

from fastapi import APIRouter, Depends, HTTPException

from ..auth import can_manage_access, get_current_user, get_profile_service, resolve_role
from ..dependencies import get_bucket_service, get_compiler_service, require_bucket_owner, \
    require_viewer
from ..models import BucketCreate, BucketInfo, BucketUpdate
from ..services.bucket import BucketService
from ..services.compiler import CompilerService
from ..services.profile import ProfileService

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/buckets', tags=['buckets'])


@router.get('')
async def list_buckets(
    user=Depends(get_current_user),
    svc: BucketService = Depends(get_bucket_service),
):
    '''List buckets the user has access to, with their resolved role.

    ``can_manage`` tells the UI whether this user may edit the project's
    metadata and access control (owner or administrator).
    '''
    results = []

    for bucket in svc.list():

        role = resolve_role(user, bucket.access, bucket.slug, bucket.owner)

        if role is not None:
            info               = bucket.model_dump()
            info['role']       = role
            info['can_manage'] = can_manage_access(user, bucket.owner)
            results.append(info)

    return results


@router.get('/{slug}', response_model=BucketInfo)
async def get_bucket(slug: str, user=Depends(require_viewer),
                     svc: BucketService = Depends(get_bucket_service)):
    '''Get metadata for a single bucket.'''
    logger.debug('Getting bucket %s (user: %s)', slug, user.username)
    bucket = svc.get(slug)

    if not bucket:
        raise HTTPException(404, 'Bucket not found')

    return bucket


@router.post('', response_model=BucketInfo, status_code=201)
async def create_bucket(
    body: BucketCreate,
    user=Depends(get_current_user),
    svc: BucketService = Depends(get_bucket_service),
    profiles: ProfileService = Depends(get_profile_service),
):
    '''Create a new bucket (initializes a git repo with .meta.yml).

    The creating user becomes the owner, and the bucket is private to them
    until they share it via the access control list.
    '''
    if user.api_key_access is not None:
        raise HTTPException(403, 'API keys cannot create projects')

    try:
        result = svc.create(
            body.slug, body.description, body.access,
            name=body.name, remote=body.remote, owner=user.username,
            author=profiles.identity(user.username, user.email),
        )
        logger.info('Bucket created: %s (user: %s)', body.slug, user.username)
        return result
    except FileExistsError as exc:
        logger.warning(
            'Bucket creation rejected: %s already exists (user: %s)',
            body.slug, user.username,
        )
        raise HTTPException(409, 'Bucket already exists') from exc


@router.put('/{slug}', response_model=BucketInfo)
async def update_bucket(
    slug: str, body: BucketUpdate,
    user=Depends(require_bucket_owner),
    svc: BucketService = Depends(get_bucket_service),
    profiles: ProfileService = Depends(get_profile_service),
):
    '''Update a bucket's description, remote, owner, or access rules.

    Restricted to the bucket's owner and global administrators.
    '''
    bucket = svc.update(
        slug, body.description, body.access,
        name=body.name, remote=body.remote, owner=body.owner,
        author=profiles.identity(user.username, user.email),
    )

    if not bucket:
        logger.warning('Bucket update rejected: %s not found (user: %s)', slug, user.username)
        raise HTTPException(404, 'Bucket not found')

    logger.info('Bucket updated: %s (user: %s)', slug, user.username)
    return bucket


@router.delete('/{slug}', status_code=204)
async def delete_bucket(
    slug: str,
    user=Depends(require_bucket_owner),
    svc: BucketService = Depends(get_bucket_service),
    compiler: CompilerService = Depends(get_compiler_service),
):
    '''Delete a bucket and its git repo from disk (owner or administrator only).'''
    if not svc.delete(slug):
        logger.warning('Bucket deletion rejected: %s not found (user: %s)', slug, user.username)
        raise HTTPException(404, 'Bucket not found')

    compiler.purge(slug)

    logger.info('Bucket deleted: %s (user: %s)', slug, user.username)
