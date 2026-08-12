'''Bucket management service. Each bucket is a git repo on disk with a .meta.yml.'''

import logging
import shutil
import threading
from pathlib import Path

import git
import yaml

from ..models import AccessEntry, BucketInfo

logger = logging.getLogger(__name__)

META_FILE = '.meta.yml'

REMOTE_NAME = 'origin'


class BucketService:
    '''CRUD operations for buckets (git-backed project directories).'''

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._slug_locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    def _slug_lock(self, slug: str) -> threading.Lock:
        '''Return a per-slug lock that serializes meta read-modify-write.'''
        with self._locks_guard:
            lock = self._slug_locks.get(slug)
            if lock is None:
                lock = threading.Lock()
                self._slug_locks[slug] = lock
            return lock

    def _path(self, slug: str) -> Path:
        '''Resolve a bucket slug to its directory path.'''
        return self.data_dir / slug

    @staticmethod
    def _read_meta(path: Path) -> dict:
        '''Parse the .meta.yml file from a bucket directory.'''
        meta_file = path / META_FILE

        if meta_file.exists():
            return yaml.safe_load(meta_file.read_text()) or {}

        return {}

    @staticmethod
    def _write_meta(path: Path, meta: dict) -> None:
        '''Write metadata to the bucket's .meta.yml file.'''
        (path / META_FILE).write_text(
            yaml.dump(meta, default_flow_style=False),
        )

    def _to_info(self, slug: str, path: Path) -> BucketInfo:
        '''Build a BucketInfo response from the bucket directory on disk.'''
        meta = self._read_meta(path)

        return BucketInfo(
            slug=slug,
            name=meta.get('name', ''),
            description=meta.get('description', ''),
            remote=meta.get('remote', ''),
            owner=meta.get('owner', ''),
            access=[AccessEntry(**a) for a in meta.get('access', [])],
        )

    def list(self) -> list[BucketInfo]:
        '''List all buckets (directories with a .git folder) in the data dir.'''
        buckets = []

        for entry in sorted(self.data_dir.iterdir()):
            if entry.is_dir() and (entry / '.git').is_dir():
                buckets.append(self._to_info(entry.name, entry))

        return buckets

    def get(self, slug: str) -> BucketInfo | None:
        '''Get a single bucket by slug, or None if it doesn't exist.'''
        path = self._path(slug)

        if not path.is_dir() or not (path / '.git').is_dir():
            return None

        return self._to_info(slug, path)

    @staticmethod
    def _actor(author: tuple[str, str] | None) -> git.Actor | None:
        '''Build a git actor from an ``(name, email)`` pair, if one was given.'''
        return git.Actor(*author) if author else None

    @staticmethod
    def _sync_remote(repo: git.Repo, url: str) -> None:
        '''Point the ``origin`` remote at *url*, or remove it when *url* is empty.'''
        existing = next((r for r in repo.remotes if r.name == REMOTE_NAME), None)

        if not url:
            if existing:
                git.Remote.remove(repo, REMOTE_NAME)
            return

        if existing:
            existing.set_url(url)
        else:
            repo.create_remote(REMOTE_NAME, url)

    @staticmethod
    def _merge_optional(meta: dict, key: str, value: str | None) -> None:
        '''Apply an optional metadata field: ``None`` keeps it, empty removes it.'''
        if value is None:
            return
        if value:
            meta[key] = value
        else:
            meta.pop(key, None)

    @staticmethod
    def _dump_access(access: list[AccessEntry]) -> list[dict]:
        '''Serialize access entries, keeping only the subject each one names.'''
        return [a.model_dump(exclude_defaults=True) for a in access]

    def create(  # pylint: disable=too-many-arguments
        self, slug: str, description: str = '',
        access: list[AccessEntry] | None = None, *,
        name: str = '',
        remote: str = '',
        owner: str = '',
        author: tuple[str, str] | None = None,
    ) -> BucketInfo:
        '''Create a new bucket: mkdir, git init, write .meta.yml, initial commit.'''
        path = self._path(slug)

        if path.is_dir() and any(path.iterdir()):
            raise FileExistsError(slug)

        path.mkdir(parents=True, exist_ok=True)

        meta = {'description': description}
        if name:
            meta['name'] = name
        if remote:
            meta['remote'] = remote
        if owner:
            meta['owner'] = owner
        if access:
            meta['access'] = self._dump_access(access)
        self._write_meta(path, meta)

        repo = git.Repo.init(path)
        try:
            repo.index.add([META_FILE])
            actor = self._actor(author)
            repo.index.commit('Initialize bucket\n\nTino-Meta: true',
                              author=actor, committer=actor)
            self._sync_remote(repo, remote)
        finally:
            repo.close()

        logger.info('Created bucket %s', slug)
        return self._to_info(slug, path)

    def update(  # pylint: disable=too-many-arguments
        self, slug: str, description: str | None = None,
        access: list[AccessEntry] | None = None, *,
        name: str | None = None,
        remote: str | None = None,
        owner: str | None = None,
        author: tuple[str, str] | None = None,
    ) -> BucketInfo | None:
        '''Update a bucket's .meta.yml. Only provided fields are changed.'''
        # Read-modify-write of .meta.yml must be serialized per-slug.
        # Two concurrent updates could otherwise lose each other's changes
        # (each reads the same starting state, last write wins).
        with self._slug_lock(slug):
            path = self._path(slug)

            if not path.is_dir():
                return None

            meta = self._read_meta(path)
            for key, value in (('name', name), ('remote', remote), ('owner', owner)):
                self._merge_optional(meta, key, value)
            if description is not None:
                meta['description'] = description
            if access is not None:
                meta['access'] = self._dump_access(access)

            self._write_meta(path, meta)

            repo = git.Repo(path)
            try:
                repo.index.add([META_FILE])
                actor = self._actor(author)
                repo.index.commit(
                    'Update bucket metadata\n\nTino-Meta: true',
                    author=actor, committer=actor,
                )
                if remote is not None:
                    self._sync_remote(repo, remote)
            finally:
                repo.close()

            logger.info('Updated bucket %s metadata', slug)
            return self._to_info(slug, path)

    def delete(self, slug: str) -> bool:
        '''Delete a bucket and its entire git repo from disk.'''
        path = self._path(slug)

        if not path.is_dir():
            return False

        shutil.rmtree(path)
        logger.info('Deleted bucket %s', slug)

        return True
