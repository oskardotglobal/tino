.. _Authentication:

🔐 Authentication
=================

OIDC
----

TINO uses OpenID Connect (OIDC) for authentication and interactive logins.

Click **Login with SSO** on the login page to be redirected to your identity provider.
After a successful login you are returned to the editor.

To sign out, click the **Logout** button in the top-right corner of the toolbar.

.. seealso::

    Also have a look at the :ref:`Access control <usage/projects:Access control>`, and :ref:`OIDC integration <operations/deployment:oidc>`.

Profile
-------

Click your user name in the toolbar to open the **Profile** dialog. It holds an
optional display name and email address, which are used to author your git
commits instead of your login name and the email address from the identity
provider. Leave both fields empty to fall back to those values.

Profiles are stored server-side in ``profiles.yml`` inside the data directory,
so they follow you across browsers. API key clients have no profile.

.. note::

   The profile only affects the commit author. It is not an identity check —
   git author fields are free text in any git workflow.

API keys
--------

Interactive users sign in through the browser, but automation — CI pipelines and scripts — cannot complete the OIDC login flow.

For these clients TINO issues **API keys**: static bearer tokens that grant scoped access to the :ref:`REST API`.

.. note::

    Only token *hashes* are stored, so a leaked ``api_keys.yml`` exposes no usable credentials.

Creating a key
~~~~~~~~~~~~~~

Administrators manage keys from the **settings** icon in the toolbar, via **Manage** next to **API keys**.

Click **New Key**, give it a descriptive label, and add one row per project and :ref:`role <usage/projects:Access control>` the key may access.

.. important::

    On create the token is shown **once**.
    Copy it immediately, as it cannot be retrieved again.

Using a key
~~~~~~~~~~~

Send the token in the ``Authorization`` header of every request:

.. code-block:: console

    $ curl -H "Authorization: Bearer tino_…" \
        https://tino.example.com/api/buckets/<slug>/files

A key can only reach the projects it was granted, with exactly the assigned role — independent of any OIDC group — and can never act as an administrator.

Revoking a key
~~~~~~~~~~~~~~

Open the **API Keys** dialog and delete the key.
