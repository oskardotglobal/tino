.. _Editor:

✏️ Editor
---------

TINO's editor is built on `CodeMirror 6 <https://codemirror.net/>`_ and
offers Typst-aware syntax highlighting, structural indentation, search and
navigation, code folding, and optional Vim or Helix keybindings.

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
     - `Vim <https://www.vim.org/>`_ keybindings. A status bar at the bottom of
       the editor shows the current mode and ``:`` command line, and the caret
       becomes a block cursor in normal mode.
   * - Helix
     - `Helix <https://helix-editor.com/>`_ keybindings, with its
       selection-first editing model.

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
