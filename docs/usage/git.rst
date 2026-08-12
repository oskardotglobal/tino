.. _Git:

🔀 Git
------

Every project is backed by a git repository.
Modified files are highlighted in the file tree with a status indicator.

The Git dialog
~~~~~~~~~~~~~~

Click the **Git** button in the toolbar to open the Git dialog. It has two
tabs — **Changes** and **History** — plus **Pull** and **Push** buttons in its
header.

Committing
~~~~~~~~~~

On the **Changes** tab, select the files to include, click a file name to see
its diff, write a commit message, and submit.

Commits are authored with your login name and email address, or with the
display name and email from your :ref:`profile <usage/authentication:Profile>`
when you set one.

.. note::

   Only users with the **Committer** role can commit changes. Other users open
   the Git dialog directly on the **History** tab.

.. hint::

   `Git LFS <https://git-lfs.com/>`_ is used to store binary files in Git.

Viewing history
~~~~~~~~~~~~~~~

- **Project history** — open the Git dialog and switch to the **History** tab to browse all commits in the project.
- **File history** — click the clock icon in the status bar (bottom of the editor) to open the same tab scoped to the current file.

The History tab shows a list of commits on the left and the file tree of the selected commit on the right.
Click a file to view its content at that point in time.

Restoring files
~~~~~~~~~~~~~~~

On the History tab, select a commit and a file, then click **Restore this file** to overwrite the working copy with the version from that commit.

Remotes
~~~~~~~

A project can carry a single remote URL, set in its edit form (see
:ref:`Projects`). TINO keeps the repository's ``origin`` remote in sync with it.

With a remote configured, the Git dialog's **Push** and **Pull** buttons become
available to users with the **Committer** role:

- **Push** pushes the current branch to ``origin``.
- **Pull** fast-forwards the current branch from ``origin``. Only
  fast-forwards are performed — if the histories have diverged, the pull is
  rejected rather than leaving conflict markers in the working tree. Files
  changed by a pull are reloaded in open editors.

.. important::

   TINO does **not** manage git credentials, and there is no per-user git
   authentication. Push and pull run as the server process and use its git
   configuration — a ``.netrc`` for HTTP(S) remotes, or an SSH key for SSH
   remotes. Every committer of a project therefore pushes with the same
   server-side identity.
