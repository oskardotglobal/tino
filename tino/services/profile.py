'''Service for managing user profiles stored in ``profiles.yml``.'''

from logging import getLogger
from pathlib import Path

import yaml

from ..models import Profile

logger = getLogger(__name__)


class ProfileService:
    '''Manages user profiles persisted in a single YAML file.

    A profile holds the optional display name and email address a user wants to
    be credited with in git commits. Users without a profile fall back to their
    OIDC username and email.

    File format::

        profiles:
          jdoe:
            name: "Jane Doe"
            email: "jane@example.com"
    '''

    def __init__(self, path: Path) -> None:
        self._path = path
        self._cache_mtime: float | None = None
        self._profiles: dict[str, dict] = {}

    # ── Private helpers ──

    def _load(self) -> dict[str, dict]:
        '''Return all profiles, re-reading the file only when it has changed.

        The commit path looks a profile up on every commit, so the parsed file
        is cached and refreshed when its mtime changes (or after a local write,
        which clears the cached mtime).
        '''
        try:
            mtime = self._path.stat().st_mtime
        except FileNotFoundError:
            self._profiles = {}
            self._cache_mtime = None
            return self._profiles

        if mtime != self._cache_mtime:
            with open(self._path, encoding='utf-8') as f:
                data = yaml.safe_load(f) or {}
            self._profiles = data.get('profiles') or {}
            self._cache_mtime = mtime

        return self._profiles

    def _save(self, profiles: dict[str, dict]) -> None:
        with open(self._path, 'w', encoding='utf-8') as f:
            yaml.dump({'profiles': profiles}, f, default_flow_style=False, allow_unicode=True)
        # Force the next _load to re-read. Clearing the mtime (rather than
        # trusting the freshly written one) avoids a stale read if two writes
        # land within the filesystem's mtime resolution.
        self._cache_mtime = None

    # ── Public API ──

    def get(self, username: str) -> Profile:
        '''Return the profile for *username* (empty fields when unset).'''
        record = self._load().get(username) or {}
        return Profile(name=record.get('name', ''), email=record.get('email', ''))

    def set(self, username: str, profile: Profile) -> Profile:
        '''Store the profile for *username*. Empty fields remove the override.'''
        profiles = dict(self._load())
        record = {k: v for k, v in profile.model_dump().items() if v}

        if record:
            profiles[username] = record
        else:
            profiles.pop(username, None)

        self._save(profiles)
        logger.info('Updated profile of %s', username)

        return self.get(username)

    def identity(self, username: str, email: str) -> tuple[str, str]:
        '''Return the ``(name, email)`` to author commits with for *username*.

        The profile overrides the values from the identity provider; unset
        profile fields fall back to the given username and email.
        '''
        profile = self.get(username)
        return profile.name or username, profile.email or email
