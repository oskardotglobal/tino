.. _Editor:

✏️ Editor
---------

TINO's editor is built on `CodeMirror 6 <https://codemirror.net/>`_ and
offers Typst-aware syntax highlighting, structural indentation, search and
navigation, code folding, completion, code actions, document formatting, and
optional Vim or Helix keybindings.

Tabs
~~~~

Every opened file appears as a tab above the editor.
Click a tab to switch to it, or click the **×** button on a tab to close it.
Use **Close all tabs** to clear them all at once.
Tabs are persisted across page reloads.

Syntax highlighting
~~~~~~~~~~~~~~~~~~~~~

``.typ`` files are highlighted with a Typst-aware grammar: comments, strings,
keywords (``#let``, ``#show``, ``#import``, …), function calls, headings,
strong and emphasis, math, labels and references, numbers, and punctuation each
get their own colour. The palette is drawn from the corporate-design colours
and adapts to the active :ref:`theme <Theming>` (dark and light).

Formatting toolbar
~~~~~~~~~~~~~~~~~~~~

The toolbar above the editor provides common Typst formatting actions.
For the full syntax reference, see the `Typst documentation <https://typst.app/docs/reference/>`_.

.. list-table::
   :header-rows: 1
   :widths: 20 30 50

   * - Action
     - Typst syntax
     - Description
   * - Bold
     - :code:`*…*`
     - Wrap the selection in asterisks.
   * - Italic
     - :code:`_…_`
     - Wrap the selection in underscores.
   * - Heading
     - ``=``
     - Cycle the current line's heading level (``=`` → ``==`` → ``===`` → ``====`` → plain text).
   * - Bullet list
     - ``-``
     - Start a bullet list on the current line.
   * - Numbered list
     - ``+``
     - Start a numbered list on the current line.
   * - Link
     - :code:`#link("…")`
     - Insert a link function call.
   * - Image
     - :code:`#image("…")`
     - Insert an image function call.
   * - Table
     - :code:`#table(…)`
     - Insert a 2×2 table skeleton.
   * - Inline code
     - ````` `…` `````
     - Wrap the selection in backticks.
   * - Code block
     - ````` ```…``` `````
     - Wrap the selection in triple backticks.
   * - Math
     - :code:`$…$`
     - Wrap the selection in dollar signs.
   * - Format document
     - —
     - Reformat the whole file with :ref:`typstyle <Formatting>`.
   * - Code actions
     - —
     - Offer the :ref:`code actions <Code actions>` for the selection.

Indentation
~~~~~~~~~~~

The editor indents structurally. Pressing :kbd:`Enter` keeps the surrounding
indentation, adds a level after an opening bracket (``(``, ``[`` or ``{``), and
a line that begins with a closing bracket snaps back to match its opener. Plain
prose is left at its current indentation.

Lists continue automatically: pressing :kbd:`Enter` on a list item starts the
next item (numbered markers increment), while pressing :kbd:`Enter` on an empty
item ends the list.

Keyboard shortcuts
~~~~~~~~~~~~~~~~~~

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Shortcut
     - Action
   * - :kbd:`Ctrl+Z` / :kbd:`Ctrl+Y`
     - Undo / redo.
   * - :kbd:`Tab` / :kbd:`Shift+Tab`
     - Indent / dedent.
   * - :kbd:`Enter`
     - New line with structural indentation; continue a list.
   * - :kbd:`Ctrl+F` / :kbd:`⌘F`
     - Open the search panel (find & replace, with match-case / regexp / by-word options).
   * - :kbd:`F3` / :kbd:`Shift+F3`
     - Find next / previous.
   * - :kbd:`Ctrl+G` / :kbd:`⌘G`
     - Go to line.
   * - :kbd:`Ctrl+D` / :kbd:`⌘D`
     - Select the next occurrence of the selection (multi-cursor).
   * - :kbd:`Ctrl+Space`
     - Ask for :ref:`completions <Completion>` where they are not offered by
       themselves.
   * - :kbd:`Ctrl+.` / :kbd:`⌘.`
     - Show the :ref:`code actions <Code actions>` for the selection.
   * - :kbd:`Shift+Alt+F`
     - Format the document (see :ref:`Formatting`).

.. _Formatting:

Formatting
~~~~~~~~~~

``.typ`` files can be reformatted with
`typstyle <https://github.com/typstyle-rs/typstyle>`_ — the same formatter used
by the Typst tooling elsewhere. Press :kbd:`Shift+Alt+F` or click the
**Format document** button in the toolbar.

Formatting applies to the buffer as it is on screen, unsaved changes included,
and only rewrites the part of the document that actually differs. The cursor
keeps its place, collaborators see the reformat as an ordinary edit, and the
result is autosaved like any other change. If the file does not parse, typstyle
leaves it untouched.

The style is configured server-side with
:attr:`TINO_FORMAT_LINE_WIDTH <tino.config.TINO_FORMAT_LINE_WIDTH>` and
:attr:`TINO_FORMAT_INDENT_WIDTH <tino.config.TINO_FORMAT_INDENT_WIDTH>`.

.. note::

   The button and the shortcut are only available when the server has the
   ``typstyle`` binary — the official Docker image ships it for all platforms
   with an upstream release.

.. _Completion:

Completion
~~~~~~~~~~

While you type in a ``.typ`` file, `tinymist
<https://github.com/Myriad-Dreamin/tinymist>`_ — the Typst language server —
suggests what can go there: functions from the standard library and from the
packages the document imports, their named arguments, fields and methods of a
value, labels, paths, and package names. Each suggestion carries Typst's own
reference text, shown beside the list.

Suggestions appear on their own after a word or one of Typst's syntax characters
(``#``, ``(``, ``.``, ``:``, ``@``, …); :kbd:`Ctrl+Space` asks for them anywhere.
:kbd:`Enter` inserts the selected one, :kbd:`Escape` dismisses the list.

Many suggestions insert a whole call rather than a name — picking ``figure``
writes ``figure(caption: [Caption], …)`` — and leave the caret on the first part
you have to fill in. :kbd:`Tab` moves to the next one.

.. _Code actions:

Code actions
~~~~~~~~~~~~

The language server also offers small, mechanical rewrites of what the selection
covers: wrapping a paragraph in content brackets, putting an image in a figure
with a caption, turning a relative path into an absolute one, and so on. Press
:kbd:`Ctrl+.` or use the toolbar's **Code actions** button to see what applies
where the caret is; the menu lists them, and :kbd:`Escape` closes it without
changing anything.

An action that touches only the open file is applied like an edit you typed
yourself. When one also changes another file in the project, that part is applied
by the server — through the same collaborative document as everything else, so it
cannot collide with someone editing that file at the time.

.. note::

   Completion and code actions need the ``tinymist`` binary on the server. One
   language server is started per project on demand and shut down again after
   :attr:`TINO_LSP_TTL <tino.config.TINO_LSP_TTL>` seconds without a request.
   When the binary is missing, the editor does without both.

.. hint::

   The language server reads the document from the collaborative session rather
   than from disk, so completions describe the file as it is on screen, including
   changes that have not been saved yet.

Folding and brackets
~~~~~~~~~~~~~~~~~~~~~~

Collapse a ``{…}`` or ``[…]`` block from the fold gutter beside the line
numbers, and click again to expand it. When the cursor sits next to a bracket,
its matching partner is highlighted.

Modal keybindings
~~~~~~~~~~~~~~~~~

Open the **settings** icon in the toolbar and pick a **Keybindings** mode:

.. list-table::
   :header-rows: 1
   :widths: 15 85

   * - Mode
     - Description
   * - Default
     - Plain CodeMirror keybindings — no modal editing.
   * - Vim
     - `Vim <https://www.vim.org/>`_ keybindings. The editor's status bar shows
       the current mode and the ``:`` command line, and the caret becomes a
       block cursor in normal mode.
   * - Helix
     - `Helix <https://helix-editor.com/>`_ keybindings, with its
       selection-first editing model. The current mode is shown in the editor's
       status bar as well.

Only one mode is active at a time, and the choice is remembered per browser.
In both modal modes the usual motions and operators apply, and ``u`` /
:kbd:`Ctrl+R` undo and redo.

Editor font
~~~~~~~~~~~

The settings dialog also holds the **Editor font** and **Font size**. The font
accepts any CSS font family list (for example ``"JetBrains Mono", monospace``);
leave it empty to keep the default. Both settings apply immediately and are
remembered per browser.

Saving
~~~~~~

Files are **saved automatically** a short moment after you stop typing — by
default 250 ms, configurable via
:attr:`TINO_SAVE_DEBOUNCE_MS <tino.config.TINO_SAVE_DEBOUNCE_MS>`.
There is no manual save action; :kbd:`Ctrl+S` / :kbd:`⌘S` is swallowed so the
browser's own "save page" dialog stays out of the way.
Files with unsaved changes are marked with a dot on their tab.

Settings
~~~~~~~~

The **settings** icon between the user name and **Logout** opens a dialog with
the editor preferences — :ref:`keybindings <usage/editor:Modal keybindings>` and
the :ref:`editor font <usage/editor:Editor font>` — plus, for administrators,
entry points to :ref:`Fonts` and :ref:`API keys <usage/authentication:API keys>`.

Layout
~~~~~~

The tab bar and the formatting toolbar span the editor *and* the preview, so
preview actions (**Generate PDF**, zoom) sit on the right of the toolbar and the
preview **pin** sits on the right of the tabs.

Toggle the file explorer with the panel icon at the far left of the toolbar; the
choice is remembered per browser. Both the explorer and the preview can be
resized by dragging their separators.

Preview
~~~~~~~

The right-hand panel shows an SVG preview of the current ``.typ`` file.
The preview is re-rendered automatically after each save.

Use the **Zoom in** / **Zoom out** buttons (or the displayed percentage) to adjust the preview scale.

.. _Compiler errors:

Compiler errors
~~~~~~~~~~~~~~~

Errors and warnings are reported **where they happen**: underlined in the editor
on the offending line, with the message on hover and a marker in the gutter. They
come from the compiler itself, which runs on every change.

A diagnostic belongs to the file that causes it, which is not always the one on
screen — an error in an imported template is reported against the template. Files
the compiler found errors in are marked in the file explorer, so a problem
outside the open file is still visible; hovering the mark shows the message.

A document that does not compile never empties the preview: the last successful
render stays on screen, dimmed, until the next one succeeds. The preview shows no
error text of its own.

Long documents
~~~~~~~~~~~~~~

Documents longer than
:attr:`TINO_PAGED_THRESHOLD <tino.config.TINO_PAGED_THRESHOLD>` pages
(10 by default) are compiled page by page: every change re-renders only the
first page, so the preview updates as quickly as for a short document. The rest
of the document is rendered in the background right after, and any page not
ready yet is compiled on demand when you scroll to it. Compiled pages are cached
until the document — or a file it imports — changes, so scrolling back and forth
through a long document costs nothing.
