.. _Buckets:

🪣 Buckets
----------

Documents are organised into **buckets**.
Each bucket is a self-contained git repository that holds one or more (Typst) files.

.. note::

   The web UI calls buckets **projects**. The API, the on-disk layout, and this
   documentation keep the original term.

Selecting a bucket
~~~~~~~~~~~~~~~~~~

Click the project button in the toolbar (top-left) to open the picker.
Select a bucket from the list to load its files into the editor.

Creating a bucket
~~~~~~~~~~~~~~~~~

Administrators can create new buckets from the picker dialog.
Click **New Project**, fill in a slug (the unique identifier) and an optional description, then save.

The same form holds the optional **Remote URL** used by
:ref:`push and pull <usage/git:Remotes>`.

Access control
~~~~~~~~~~~~~~

Each bucket has its own access control list.
Entries map an OIDC group to one of three roles:

.. list-table::
   :header-rows: 1
   :widths: 15 85

   * - Role
     - Permissions
   * - **Viewer**
     - Browse files and view commit history.
   * - **Editor**
     - Everything a Viewer can do, plus create, edit, rename, and delete files.
   * - **Committer**
     - Everything an Editor can do, plus commit changes to the git repository.

.. note::

  Members of the configured admin groups (see :attr:`TINO_ADMIN_GROUPS <tino.config.TINO_ADMIN_GROUPS>`) are implicitly treated as **Committer** on every bucket.
