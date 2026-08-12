'''HTTP middleware for authentication enforcement.'''

import logging
import secrets

from fastapi import FastAPI
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.sessions import SessionMiddleware

from . import config
from .auth import get_api_key_service

logger = logging.getLogger(__name__)

_PUBLIC_PATHS = {
    '/api/config',
    '/api/theme.css',
    '/health',
    '/login',
    '/oidc/login',
    '/oidc/callback',
    '/logout',
}

_STATIC_PREFIXES = (
    '/css/',
    '/js/',
    '/img/',
    '/favicon'
)


class AuthMiddleware(BaseHTTPMiddleware):  # pylint: disable=too-few-public-methods
    '''Redirect unauthenticated requests to the login page (or return 401 for API calls).'''

    async def dispatch(self, request, call_next):
        '''Reject unauthenticated requests before forwarding to the route.'''
        if config.TINO_AUTH_DISABLED:
            logger.debug('Auth disabled, skipping checks for %s %s',
                         request.method, request.url.path)
            return await call_next(request)

        path = request.url.path

        # Public and static paths bypass the session gate.
        is_public = path in _PUBLIC_PATHS
        is_static = path.startswith(_STATIC_PREFIXES)
        if not (is_public or is_static):
            rejection = self._reject_if_unauthenticated(request, path)
            if rejection is not None:
                return rejection

        return await call_next(request)

    @staticmethod
    def _reject_if_unauthenticated(request, path):
        '''Return a 401/redirect response if the request lacks valid auth, else ``None``.

        The only valid bearer credential here is a static API key. It is validated
        at the gate rather than trusting any ``Bearer`` header to reach a route
        dependency, so a route added without an auth dependency cannot be reached
        unauthenticated.
        '''
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            if get_api_key_service().verify(auth_header[7:]) is None:
                logger.warning('Invalid API key rejected: %s %s', request.method, path)
                return JSONResponse({'detail': 'Invalid API key'}, status_code=401)
            return None

        if request.session.get('user'):
            return None

        if path.startswith('/api/'):
            logger.debug('Unauthenticated API request rejected (401): %s %s',
                         request.method, path)
            return JSONResponse({'detail': 'Not authenticated'}, status_code=401)

        logger.debug('Unauthenticated browser request redirected to login: %s', path)
        return RedirectResponse('/login')


def register_middleware(app: FastAPI) -> None:
    '''Attach session and auth middleware to the application.

    Middleware executes in reverse registration order, so auth runs first
    (registered last) and the session is available when it checks the cookie.
    '''
    app.add_middleware(AuthMiddleware)
    secret_key = config.TINO_SECRET_KEY or secrets.token_hex(32)
    app.add_middleware(SessionMiddleware, secret_key=secret_key)
    # Compress responses — the SVG preview ships as verbose text and shrinks
    # ~5-10x over the wire, which dominates load time on slow connections.
    app.add_middleware(GZipMiddleware, minimum_size=1024)
