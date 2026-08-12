.. _Projects:

📁 Projects
-----------

Documents are organised into **projects**.
Each project is a self-contained git repository that holds one or more (Typst) files.

.. note::

   Projects are called *buckets* in the REST API, on disk, and in the Python
   code. Only the wording differs — see :ref:`ADR-04`.

Selecting a project
~~~~~~~~~~~~~~~~~~~

Click the project button in the toolbar (top-left) to open the project picker.
Select a project from the list to load its files into the editor.

Creating a project
~~~~~~~~~~~~~~~~~~

Any authenticated user can create new projects from the project picker dialog.
Click **New Project**, fill in a slug (the unique identifier) and an optional description, then save.

The same form holds the optional **Remote URL** used by
:ref:`push and pull <usage/git:Remotes>`.

Ownership
~~~~~~~~~

The user who creates a project becomes its **owner**.

An owner always holds the **Committer** role on their own project, and a new
project is visible to nobody else until the owner shares it. Only the owner and
administrators can edit a project's metadata and access control list, transfer
its ownership, or delete it.

.. note::

  Projects created before ownership existed have no owner recorded in their
  ``.meta.yml``. They keep the previous behaviour: with an empty access control
  list, every authenticated user gets the :attr:`TINO_DEFAULT_ROLE
  <tino.config.TINO_DEFAULT_ROLE>`. Set an owner (via the API's ``owner`` field)
  to make such a project private.

Access control
~~~~~~~~~~~~~~

Each project has its own access control list.
Entries share the project with either an OIDC **group** or a single **user**
(matched against the login name), in one of three roles:


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

  Members of the configured admin groups (see :attr:`TINO_ADMIN_GROUPS <tino.config.TINO_ADMIN_GROUPS>`) are implicitly treated as **Committer** on every project.

A user who matches several entries — for example through a group *and* a
personal entry — holds the highest of the matching roles.
