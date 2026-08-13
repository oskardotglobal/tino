import { toCodeMirrorSnippet, toPlainText } from './snippets.js'
import { toRange, toSpan } from './codemirror-positions.js'
import { snippet } from './vendor/codemirror.js'

/**
 * Code actions for the editor — tinymist's refactors and quick fixes, offered
 * for whatever the selection covers (wrap a paragraph in content brackets, put
 * an image in a figure, make a path absolute, …).
 *
 * How an action's edits are applied depends on which file they touch:
 *
 * - the open file: as an ordinary CodeMirror transaction, which is exactly what
 *   typing does — the change goes into the shared Yjs document, reaches other
 *   collaborators, and is autosaved from there.
 * - any other file the action touches: posted back to the server, which applies
 *   it through that file's collaboration room for the same reason.
 *
 * Either way the change enters the CRDT before it reaches disk, so it cannot
 * race an edit someone else is making.
 */

/** Margin kept between the code-action menu and the window edges, in px. */

const MARGIN = 8

/** Gap between the caret and the menu, in px. */

const GAP = 4

/** An action with exactly one edit can be applied as an interactive snippet. */

const SINGLE_EDIT = 1

/** Step for moving through the menu with the arrow keys. */

const STEP = 1

export class EditorActions {

  /** @param {TinoApp} app - Main application instance. */

  constructor(app) {
    this.app = app
    this._available = true
    this._menu = null
  }

  /** Note whether the server can offer code actions at all. */

  bind() {
    if (this.app.config && this.app.config.languageServer === false)
      this._available = false
  }

  /**
   * Ask for the actions available at the selection and offer them in a menu at
   * the caret. Bound to the editor's Ctrl-. / ⌘. binding and the toolbar button.
   */

  async open() {
    const path = this.app.currentFile
    this.close()
    if (!this._available || !this.app.bucket || !path || !path.endsWith('.typ'))
      return
    const { editor } = this.app.els
    const { from, to } = editor.selection
    try {
      await this.app.tooling.sync()
      const { actions } = await this.app.api.codeActions(
        this.app.bucket, path, toSpan(editor.view.state, from, to),
      )
      this._show(actions)
    }
    catch (err) {
      this.app.toast.error(`Code actions failed: ${err.message}`)
    }
  }

  /** Dismiss the menu, if one is open. */

  close() {
    if (!this._menu)
      return
    this._menu.remove()
    this._menu = null
    document.removeEventListener('pointerdown', this._onOutside)
  }

  // ── Internal ──

  _show(actions) {
    if (!actions.length) {
      this.app.toast.info('No code actions here.')
      return
    }
    const { editor } = this.app.els
    this._menu = EditorActions._build(actions)
    document.body.appendChild(this._menu)
    EditorActions._place(this._menu, editor)
    this._bindMenu(actions)
  }

  static _build(actions) {
    const menu = document.createElement('div')
    menu.className = 'action-menu'
    menu.setAttribute('role', 'menu')
    menu.innerHTML = actions
      .map((action, index) =>
        `<button class="action-item" role="menuitem" data-index="${index}">`
        + '<span class="material-symbols-outlined">auto_fix_high</span>'
        + '<span class="action-title"></span></button>')
      .join('')
    menu.querySelectorAll('.action-title').forEach((label, index) => {
      label.textContent = actions[index].title
    })

    return menu
  }

  /* Anchored at the caret, then nudged back inside the viewport when the menu
     would hang off the bottom or the right edge. */

  static _place(menu, editor) {
    const caret = editor.view.coordsAtPos(editor.selection.from)
    if (!caret)
      return
    const box = menu.getBoundingClientRect()
    const left = Math.min(caret.left, window.innerWidth - box.width - MARGIN)
    const below = caret.bottom + box.height + MARGIN < window.innerHeight
    const top = below ? caret.bottom + GAP : caret.top - box.height - GAP
    menu.style.left = `${Math.max(MARGIN, left)}px`
    menu.style.top = `${Math.max(MARGIN, top)}px`
  }

  _bindMenu(actions) {
    this._menu.addEventListener('click', evt => {
      const item = evt.target.closest('.action-item')
      if (item)
        this._apply(actions[Number(item.dataset.index)])
    })
    this._menu.addEventListener('keydown', evt => this._onKey(evt))
    this._onOutside = evt => {
      if (this._menu && !this._menu.contains(evt.target))
        this.close()
    }
    document.addEventListener('pointerdown', this._onOutside)
    this._menu.querySelector('.action-item').focus()
  }

  _onKey(evt) {
    if (evt.key === 'Escape') {
      this.close()
      this.app.els.editor.focus()
      evt.preventDefault()
      return
    }
    if (evt.key === 'ArrowDown' || evt.key === 'ArrowUp') {
      this._move(evt.key === 'ArrowDown' ? STEP : -STEP)
      evt.preventDefault()
    }
  }

  /** Move focus through the menu, wrapping around at both ends. */

  _move(step) {
    const items = [...this._menu.querySelectorAll('.action-item')]
    const current = items.indexOf(document.activeElement)

    items[(current + step + items.length) % items.length].focus()
  }

  async _apply(action) {
    this.close()
    const { editor } = this.app.els
    const path = this.app.currentFile
    const here = action.edits[path] || []
    const elsewhere = Object.fromEntries(
      Object.entries(action.edits).filter(([target]) => target !== path),
    )
    try {
      EditorActions._applyHere(editor, here)
      if (Object.keys(elsewhere).length)
        await this.app.api.applyEdits(this.app.bucket, elsewhere)
    }
    catch (err) {
      this.app.toast.error(`Could not apply "${action.title}": ${err.message}`)
    }
    editor.focus()
  }

  /**
   * Apply the edits for the open file as one transaction, back to front so that
   * an earlier replacement cannot shift a later one's range.
   *
   * A single snippet edit keeps its placeholders and is applied interactively,
   * so the caret lands on the first one (a figure's caption, say). Placeholders
   * in a multi-edit action are filled with their default text instead — there is
   * only one caret to offer, and it cannot be in two edits at once.
   */

  static _applyHere(editor, edits) {
    if (!edits.length)
      return
    const { state } = editor.view
    const [first] = edits
    if (edits.length === SINGLE_EDIT && first.snippet) {
      const { from, to } = toRange(state, first.range)
      snippet(toCodeMirrorSnippet(first.new_text))(editor.view, null, from, to)
      return
    }
    const changes = edits
      .map(edit => ({ ...toRange(state, edit.range), insert: toPlainText(edit.new_text) }))
      .sort((one, other) => other.from - one.from)
    editor.view.dispatch({ changes })
  }

}
