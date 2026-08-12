'''REST endpoints for the authenticated user's own profile.'''

import logging

from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user, get_profile_service
from ..models import Profile, User
from ..services.profile import ProfileService

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/profile', tags=['profile'])


def require_profile_owner(user: User = Depends(get_current_user)) -> User:
    '''Require a user who can own a profile — API key clients cannot.'''
    if user.api_key_access is not None:
        raise HTTPException(403, 'API key clients have no profile')

    return user


@router.get('', response_model=Profile)
async def get_profile(
    user: User = Depends(require_profile_owner),
    svc: ProfileService = Depends(get_profile_service),
):
    '''Return the authenticated user's profile (empty fields when unset).'''
    logger.debug('Getting profile (user: %s)', user.username)
    return svc.get(user.username)


@router.put('', response_model=Profile)
async def update_profile(
    body: Profile,
    user: User = Depends(require_profile_owner),
    svc: ProfileService = Depends(get_profile_service),
):
    '''Store the authenticated user's profile. Empty fields clear the override.'''
    logger.info('Profile updated (user: %s)', user.username)
    return svc.set(user.username, body)
