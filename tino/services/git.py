'''Git operations service. Wraps GitPython for status, commit, branches, log, diff, and restore.'''

import logging
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import git as gitpython

from ..models import BranchList, CommitInfo, DiffEntry, FileStatus

logger = logging.getLogger(__name__)

# Stand-in "parent" for diffing a root commit: git's well-known empty-tree SHA.
_EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

# The single remote a bucket can have, kept in sync with its .meta.yml.
_REMOTE_NAME = 'origin'


class GitService:
    '''Git operations on bucket repositories (status, commit, log, diff, restore).'''

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir

    @contextmanager
    def _open(self, slug: str):
        '''Open a git repo and ensure it is closed after use.'''
        repo = gitpython.Repo(self.data_dir / slug)

        try:
            yield repo
        finally:
            repo.close()

    @staticmethod
    def _to_commit_info(c, deleted: bool = False) -> CommitInfo:
        '''Convert a git commit object to a CommitInfo model.'''
        return CommitInfo(
            sha=c.hexsha,
            message=c.message.strip(),
            author=str(c.author),
            timestamp=datetime.fromtimestamp(c.committed_date, tz=timezone.utc).isoformat(),
            deleted=deleted,
        )

    def status(self, slug: str) -> list[FileStatus]:
        '''Return the working tree status of all user files (excludes .meta.yml and dotfiles).'''
        with self._open(slug) as repo:
            result = []

            for path in repo.untracked_files:
                if not path.startswith('.'):
                    result.append(FileStatus(path=path, status='untracked'))

            for d in repo.index.diff(None):
                if not d.a_path.startswith('.'):
                    status = 'deleted' if d.deleted_file else 'modified'
                    result.append(FileStatus(path=d.a_path, status=status))

            return result

    def commit(self, slug: str, files: list[str], message: str, *,  # pylint: disable=too-many-arguments
               author: str = 'TINO', email: str = '') -> CommitInfo:
        '''Stage the specified files and create a commit.'''
        with self._open(slug) as repo:
            working_dir = Path(repo.working_dir).resolve()
            safe = [f for f in files
                    if (working_dir / f).resolve().is_relative_to(working_dir)]
            existing = [f for f in safe if (working_dir / f).exists()]
            deleted  = [f for f in safe if not (working_dir / f).exists()]

            if existing:
                repo.index.add(existing)

            if deleted:
                repo.index.remove(deleted, working_tree=False)

            actor  = gitpython.Actor(author, email or f'{author}@tino')
            commit = repo.index.commit(message, author=actor)
            logger.info(
                'Committed %s in %s by %s (%d files)',
                commit.hexsha[:8], slug, author, len(files),
            )

            return self._to_commit_info(commit)

    def push(self, slug: str) -> str:
        '''Push the current branch to the bucket's ``origin`` remote.

        Authentication is up to the server's git configuration (a ``.netrc``
        for HTTP(S) remotes, or an SSH key for SSH remotes) — TINO neither
        stores nor forwards per-user credentials.
        '''
        with self._open(slug) as repo:
            self._require_remote(repo)
            output = repo.git.push(_REMOTE_NAME, f'HEAD:{repo.active_branch.name}')
            logger.info('Pushed %s to %s', slug, _REMOTE_NAME)
            return output

    def pull(self, slug: str) -> tuple[str, list[str]]:
        '''Fetch ``origin`` and fast-forward the current branch from it.

        :returns: ``(git output, paths changed in the working tree)``.

        The whole remote is fetched (pruning deleted branches), so the branch
        list picks up branches created on the remote since. Only fast-forwards
        are allowed: a merge or rebase could leave conflict markers in the
        working tree, which the web UI has no way to resolve.
        '''
        with self._open(slug) as repo:
            self._require_remote(repo)
            branch = repo.active_branch.name
            before = repo.head.commit.hexsha
            repo.git.fetch('--prune', _REMOTE_NAME)
            if branch not in self._remote_branches(repo):
                raise ValueError(f'Branch {branch} does not exist on the remote yet, push it first')
            output = repo.git.merge('--ff-only', f'{_REMOTE_NAME}/{branch}')
            changed = self._changed_between(repo, before, repo.head.commit.hexsha)
            logger.info('Pulled %s from %s (%d files changed)', slug, _REMOTE_NAME, len(changed))
            return output, changed

    def branches(self, slug: str) -> BranchList:
        '''List the local branches, the ``origin`` ones not yet local, and the current one.'''
        with self._open(slug) as repo:
            current = None if repo.head.is_detached else repo.active_branch.name
            # A branch without commits yet (a clone of an empty remote) has no
            # head to list, but it is still the one checked out.
            local   = sorted({h.name for h in repo.heads} | ({current} if current else set()))
            return BranchList(
                current=current, branches=local,
                remote=[b for b in self._remote_branches(repo) if b not in local],
            )

    @staticmethod
    def _remote_branches(repo) -> list[str]:
        '''Branch names known on ``origin``, without its symbolic ``HEAD``.'''
        remote = next((r for r in repo.remotes if r.name == _REMOTE_NAME), None)
        if remote is None:
            return []
        return sorted(ref.remote_head for ref in remote.refs if ref.remote_head != 'HEAD')

    def checkout(self, slug: str, branch: str, create: bool = False) -> list[str]:
        '''Switch the working tree to ``branch``, creating it from HEAD if ``create``.

        :returns: paths whose content differs between the old and new branch.

        Uncommitted changes are carried over as ``git switch`` does; when they
        would be overwritten, git refuses and the error is raised unchanged.
        A local branch that does not exist yet but is known on ``origin`` is
        created to track it.
        '''
        with self._open(slug) as repo:
            # A leading dash would be parsed as an option by ``git switch``.
            if not branch or branch.startswith('-'):
                raise ValueError(f'Invalid branch name: {branch!r}')
            repo.git.check_ref_format('--branch', branch)

            before = repo.head.commit.hexsha
            if create:
                repo.git.switch('-c', branch)
            else:
                repo.git.switch(branch)
            changed = self._changed_between(repo, before, repo.head.commit.hexsha)
            logger.info('Switched %s to %s (%d files changed)', slug, branch, len(changed))
            return changed

    @staticmethod
    def _require_remote(repo) -> None:
        '''Raise ``ValueError`` when the repository has no ``origin`` remote.'''
        if not any(r.name == _REMOTE_NAME for r in repo.remotes):
            raise ValueError('No remote configured for this bucket')

    @staticmethod
    def _changed_between(repo, before: str, after: str) -> list[str]:
        '''List the user file paths that differ between two commits.'''
        if before == after:
            return []

        paths = set()
        for diff in repo.commit(before).diff(after):
            paths.update(p for p in (diff.a_path, diff.b_path) if p)

        return sorted(p for p in paths if not p.startswith('.'))

    def log(self, slug: str, path: str | None = None, max_count: int = 50) -> list[CommitInfo]:
        '''Return commit history, optionally filtered to a single file.'''
        with self._open(slug) as repo:
            if not repo.head.is_valid():
                return []

            kwargs: dict = {'max_count': max_count}

            if path:
                kwargs['paths'] = path

            commits      = [c for c in repo.iter_commits(**kwargs)
                            if 'true' not in c.trailers.get('Tino-Meta', [])][:max_count]
            deleted_shas = self._deleted_shas(repo, path) if path else set()

            return [self._to_commit_info(c, c.hexsha in deleted_shas) for c in commits]

    @staticmethod
    def _deleted_shas(repo, path: str) -> set[str]:
        '''Return the set of commit SHAs where `path` was deleted.'''
        output = repo.git.log('--no-ext-diff', '--format=%H', '--diff-filter=D', '--', path)
        return set(output.split('\n')) if output else set()

    def diff(self, slug: str, path: str | None = None,
             ref: str | None = None) -> list[DiffEntry]:
        '''Return unified diffs.

        With ``ref=None`` (default) returns working-tree changes vs HEAD.
        With ``ref`` set returns the changes introduced by that commit
        (commit-vs-parent, or commit-vs-empty-tree for the root commit).
        '''
        with self._open(slug) as repo:
            diff_text = self._diff_text(repo, path, ref)
            return self._parse_diff(diff_text)

    @staticmethod
    def _diff_text(repo, path: str | None, ref: str | None) -> str:
        '''Compute the unified-diff text for either the working tree or a commit.

        ``--no-ext-diff`` is required: a server whose git configuration sets
        ``diff.external`` (difftastic and friends) would otherwise emit that
        tool's own format, which :meth:`_parse_diff` cannot read — the UI would
        show every file as unchanged.
        '''
        if ref is None:
            args = ['--no-ext-diff']
            if path:
                args.extend(['--', path])
            return repo.git.diff(*args)
        commit = repo.commit(ref)
        base = f'{ref}^' if commit.parents else _EMPTY_TREE_SHA
        args = ['--no-ext-diff', base, ref]
        if path:
            args.extend(['--', path])
        return repo.git.diff(*args)

    @staticmethod
    def _parse_diff(diff_text: str) -> list[DiffEntry]:
        '''Parse unified diff output into DiffEntry models.'''
        if not diff_text:
            return []

        entries                  = []
        current_path             = None
        current_lines: list[str] = []

        for line in diff_text.split('\n'):

            if line.startswith('diff --git'):
                if current_path:
                    entries.append(DiffEntry(path=current_path, diff='\n'.join(current_lines)))

                parts         = line.split(' b/')
                current_path  = parts[-1] if len(parts) > 1 else 'unknown'
                current_lines = [line]

            else:
                current_lines.append(line)

        if current_path:
            entries.append(DiffEntry(path=current_path, diff='\n'.join(current_lines)))

        return entries

    def tree(self, slug: str, ref: str) -> list[str]:
        '''List all file paths at a specific commit ref.'''
        with self._open(slug) as repo:
            commit = repo.commit(ref)
            return sorted(
                blob.path for blob in commit.tree.traverse()
                if blob.type == 'blob' and not blob.path.startswith('.')
            )

    def changed_files(self, slug: str, ref: str) -> list[str]:
        '''List file paths changed in a commit (vs its first parent).

        For the initial commit (no parents) every tracked file counts as added.
        Renames and deletions contribute both their old and new paths so the
        history view can surface a removed file for restore.
        '''
        with self._open(slug) as repo:
            commit = repo.commit(ref)
            if not commit.parents:
                paths = {
                    blob.path for blob in commit.tree.traverse()
                    if blob.type == 'blob'
                }
            else:
                paths = set()
                for diff in commit.parents[0].diff(commit):
                    paths.update(p for p in (diff.a_path, diff.b_path) if p)
            return sorted(p for p in paths if not p.startswith('.'))

    def show(self, slug: str, ref: str, path: str) -> dict | None:
        '''Return a file's content at a specific commit ref, or None if not found.'''
        with self._open(slug) as repo:
            try:
                blob = repo.commit(ref).tree / path
                content = blob.data_stream.read().decode('utf-8')
                return {'content': content, 'binary': False}
            except KeyError:
                return {'content': None, 'binary': False, 'deleted': True}
            except (gitpython.GitCommandError, gitpython.BadName):
                return None
            except UnicodeDecodeError:
                return {'content': None, 'binary': True}

    def show_raw(self, slug: str, ref: str, path: str) -> bytes | None:
        '''Return a file's raw bytes at a specific commit ref, or None if not found.'''
        with self._open(slug) as repo:
            try:
                blob = repo.commit(ref).tree / path
                return blob.data_stream.read()
            except (KeyError, gitpython.GitCommandError, gitpython.BadName):
                return None

    def restore(self, slug: str, ref: str, paths: list[str]) -> list[str]:
        '''Restore files from a specific commit into the working tree.'''
        with self._open(slug) as repo:
            working_dir = Path(repo.working_dir).resolve()
            restored    = []

            for p in paths:
                target = (working_dir / p).resolve()
                if not target.is_relative_to(working_dir):
                    continue
                try:
                    data = (repo.commit(ref).tree / p).data_stream.read()
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(data)
                    restored.append(p)
                except (KeyError, gitpython.GitCommandError, gitpython.BadName):
                    pass

            if restored:
                logger.info('Restored %d files in %s from %s', len(restored), slug, ref[:8])
            return restored
