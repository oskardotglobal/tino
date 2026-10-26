'''Tests for BucketService: CRUD and .meta.yml round-trips.'''

import git
import pytest

from tino.models import AccessEntry


def test_create_returns_info(buckets):
    info = buckets.create('proj', description='My project')
    assert info.slug == 'proj'
    assert info.description == 'My project'
    assert info.access == []


def test_create_persists(buckets):
    buckets.create('proj', description='desc')
    got = buckets.get('proj')
    assert got is not None
    assert got.description == 'desc'


def test_create_with_access(buckets):
    access = [AccessEntry(group='team', role='editor')]
    buckets.create('proj', access=access)
    assert buckets.get('proj').access == access


def test_duplicate_create_raises(buckets):
    buckets.create('proj')
    with pytest.raises(FileExistsError):
        buckets.create('proj')


def test_get_missing_returns_none(buckets):
    assert buckets.get('ghost') is None


def test_list_is_sorted(buckets):
    buckets.create('beta')
    buckets.create('alpha')
    assert [b.slug for b in buckets.list()] == ['alpha', 'beta']


def test_update_description(buckets):
    buckets.create('proj', description='old')
    buckets.update('proj', description='new')
    assert buckets.get('proj').description == 'new'


def test_update_access(buckets):
    buckets.create('proj')
    access = [AccessEntry(group='g', role='committer')]
    buckets.update('proj', access=access)
    assert buckets.get('proj').access == access


def test_update_only_touches_given_fields(buckets):
    buckets.create('proj', description='keep')
    buckets.update('proj', access=[AccessEntry(group='g', role='viewer')])
    got = buckets.get('proj')
    assert got.description == 'keep'
    assert got.access == [AccessEntry(group='g', role='viewer')]


def test_update_missing_returns_none(buckets):
    assert buckets.update('ghost', description='x') is None


def test_delete(buckets):
    buckets.create('proj')
    assert buckets.delete('proj') is True
    assert buckets.get('proj') is None


def test_delete_missing_returns_false(buckets):
    assert buckets.delete('ghost') is False


# ── create from a remote ──

def test_create_with_remote_clones_it(buckets, files, upstream, data_dir):
    info = buckets.create('proj', remote=str(upstream))
    assert info.remote == str(upstream)
    assert files.read('proj', 'doc.typ')['content'] == 'upstream\n'

    repo = git.Repo(data_dir / 'proj')
    assert repo.active_branch.name == 'main'
    assert repo.remotes.origin.url == str(upstream)
    # .meta.yml stays local, so the clone matches the remote exactly.
    assert [c.summary for c in repo.iter_commits()] == ['Upstream commit']
    assert repo.ignored('.meta.yml')
    assert not repo.is_dirty(untracked_files=True)


def test_update_of_cloned_bucket_commits_nothing(buckets, upstream, data_dir):
    buckets.create('proj', remote=str(upstream))
    buckets.update('proj', description='changed')
    assert buckets.get('proj').description == 'changed'
    repo = git.Repo(data_dir / 'proj')
    assert [c.summary for c in repo.iter_commits()] == ['Upstream commit']


def test_create_with_unreachable_remote_leaves_nothing(buckets, data_dir, tmp_path_factory):
    missing = tmp_path_factory.mktemp('gone') / 'nothing-here'
    with pytest.raises(git.GitError):
        buckets.create('proj', remote=str(missing))
    assert not (data_dir / 'proj').exists()
    assert buckets.get('proj') is None
