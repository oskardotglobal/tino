.. _ADR-11:

ADR-11: Git remotes with server-side authentication
===================================================

Context
-------

Buckets are local git repositories (see :ref:`ADR-03`). Teams asked to
synchronise them with a hosted git service — pushing releases to GitHub or
GitLab, pulling changes made outside TINO.

Push and pull need credentials. The options were:

- Per-user credentials: each user stores a personal access token or SSH key in
  TINO, which forwards them to git.
- Server-side credentials: the server authenticates on its own behalf, using
  the git configuration of the container.
- No remotes at all: users clone the bucket directory themselves.

Decision
--------

A bucket carries at most one remote URL, stored in its ``.meta.yml`` and kept
in sync with the repository's ``origin`` remote. **Push and pull run as the
server process** and use its git configuration — a ``.netrc`` for HTTP(S)
remotes, or an SSH key for SSH remotes. TINO stores no git credentials and has
no per-user git authentication.

Pull is restricted to fast-forwards (``git pull --ff-only``).

Both operations require the **Committer** role on the bucket.

Consequences
------------

Positive
~~~~~~~~

- | **No credential storage**
  | TINO never holds a token or private key, so there is nothing to leak from
    its data directory and no secret rotation to implement.

- | **One deployment-level setup**
  | Operators configure access once, with the mechanism their git host already
    supports, instead of every user repeating it in the UI.

- | **No broken working trees**
  | Refusing anything but a fast-forward keeps conflict markers out of buckets,
    which the web UI has no way to resolve. A diverged branch is reported as an
    error and resolved by an operator on the server.

Negative
~~~~~~~~

- | **Shared push identity**
  | Every committer of a bucket pushes with the same server-side identity. The
    *commit* author still identifies the user (see the profile feature), but
    the remote's audit log — and any branch protection keyed to the pushing
    account — sees only TINO.

- | **Operator-managed access**
  | Adding a remote on a new host requires a change to the server's git
    configuration, not a self-service action in the UI.

- | **Manual conflict resolution**
  | A bucket whose history diverged from its remote cannot be reconciled from
    the web UI at all.
