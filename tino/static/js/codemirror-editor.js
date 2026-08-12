import {
  Annotation,
  Compartment,
  EditorState,
  EditorView,
  diagnosticCount,
  panels,
} from './vendor/codemirror.js'
import { editorExtensions, lintExtension } from './codemirror-extensions.js'
import { SINGLE_ITEM } from './constants.js'
import { keymapExtension } from './codemirror-keymaps.js'

/**
 * Editor controller around a CodeMirror 6 EditorView. Owns the view, its
 * extensions, and the reconfigurable compartments (editable, keymap, collab
 * binding, line wrapping), and exposes a small intention-revealing API
 * (content, selection, setContent, setEditable, setCollab, onChange, …) that
 * the rest of the app uses instead of reaching into CodeMirror directly. The
 * raw view is available via `.view` for transaction-level work (toolbar,
 * collab reconcile).
 */

const _programmatic = Annotation.define()

const _noop = () => null

export class CodeMirrorEditor {

  /**
   * @param {HTMLElement} parent - Host element to mount CM into.
   * @param {object} [opts]
   * @param {Function} [opts.onCursor] - Called when the selection changes.
   * @param {Function} [opts.onChange] - Called on user (non-programmatic) edits.
   * @param {HTMLElement} [opts.statusHost] - Element hosting the keymap status
   *   bars (Vim's mode line, Helix's NOR indicator) instead of the editor.
   * @param {Function} [opts.onFormat] - Called by the format key binding.
   */

  constructor(parent, opts = {}) {
    this._parent = parent
    this._statusHost = opts.statusHost
    this._onCursor = opts.onCursor || _noop
    this._onChange = opts.onChange || _noop
    this._onFormat = opts.onFormat || _noop
    this._parts = {
      collab: new Compartment(),
      editable: new Compartment(),
      keymap: new Compartment(),
      lint: new Compartment(),
      wrap: new Compartment(),
    }
    this._view = new EditorView({
      parent,
      state: this._buildState(''),
    })
  }

  /**
   * Bind or unbind a collaborative-editing extension (yCollab). Undo stays with
   * the always-on CM history (yCollab is configured without its own undo
   * manager), so Vim and Ctrl-Z share one consistent history.
   * @param {object|Array|null} ext - The collab extension(s), or null to clear.
   */

  setCollab(ext) {
    this._view.dispatch({ effects: this._parts.collab.reconfigure(ext || []) })
  }

  /**
   * Bind or unbind the diagnostics source that underlines errors in the
   * document. CodeMirror polls it after edits, debounced.
   * @param {Function|null} source - `view => Promise<Diagnostic[]>`, or null to
   *   turn error detection off.
   */

  setLintSource(source) {
    this._view.dispatch({
      effects: this._parts.lint.reconfigure(lintExtension(source)),
    })
  }

  /** @returns {number} How many diagnostics the document currently has. */

  get problemCount() {
    return diagnosticCount(this._view.state)
  }

  /**
   * Switch the modal keymap. Vim comes with its mode/command status bar.
   * @param {string} mode - One of `default`, `vim`, or `helix`.
   */

  setKeymap(mode) {
    this._view.dispatch({ effects: this._parts.keymap.reconfigure(keymapExtension(mode)) })
  }

  /**
   * Toggle soft line wrapping (default on).
   * @returns {boolean} The new wrap state — true when wrapping is enabled.
   */

  toggleLineWrap() {
    this._wrapOn = this._wrapOn === false
    this._view.dispatch({
      effects: this._parts.wrap.reconfigure(this._wrapOn ? EditorView.lineWrapping : []),
    })
    return this._wrapOn
  }

  /** @returns {EditorView} The underlying CodeMirror view. */

  get view() {
    return this._view
  }

  /* Vim and Helix show their mode line in a CodeMirror bottom panel; hosting it
     in the editor's own status bar keeps all editor state on one line. */

  _panels() {
    return this._statusHost ? panels({ bottomContainer: this._statusHost }) : []
  }

  _buildState(doc) {
    return EditorState.create({
      doc,
      extensions: editorExtensions({
        compartments: this._parts,
        onFormat: () => this._onFormat(),
        onUpdate: update => this._onUpdate(update),
        panelExt: this._panels(),
      }),
    })
  }

  _onUpdate(update) {
    const programmatic =
      update.transactions.some(tr => tr.annotation(_programmatic) === true)

    /* Suppress the cursor callback for programmatic content swaps (loading a
       file), otherwise the caret reset to line 1 is recorded against the
       outgoing file's tab before the switch completes. setCursor is not
       annotated programmatic, so genuine caret moves still report. */

    if ((update.selectionSet || update.docChanged) && !programmatic)
      this._onCursor()
    if (update.docChanged && !programmatic)
      this._onChange()
  }

  // ── content ──

  /** @returns {string} The full document text. */

  get content() {
    return this._view.state.doc.toString()
  }

  /**
   * Replace the whole document programmatically (e.g. loading a file or
   * adopting synced collab content). Does not emit a change notification;
   * call signalChange() when such a replacement should be persisted.
   * @param {string} text - The new document content.
   */

  setContent(text) {
    const { length } = this._view.state.doc
    this._view.dispatch({
      annotations: [_programmatic.of(true)],
      changes: { from: 0, insert: text, to: length },
    })
  }

  /**
   * Replace the document with new text as an ordinary edit: the change is
   * reported (so the file is marked dirty and saved) and propagates over
   * collaboration. Only the differing middle section is replaced, so the caret,
   * the remote cursors and the undo history all survive a reformat of a part of
   * the document.
   * @param {string} text - The new document content.
   * @returns {boolean} True when the document changed.
   */

  replaceText(text) {
    const current = this.content
    if (text === current)
      return false
    const change = CodeMirrorEditor._minimalChange(current, text)
    this._view.dispatch({ changes: change })
    return true
  }

  /* Narrow a whole-document rewrite down to the span that actually differs, by
     skipping the common prefix and the common suffix. */

  static _minimalChange(current, text) {
    const max = Math.min(current.length, text.length)
    let start = 0
    while (start < max && current[start] === text[start])
      start += SINGLE_ITEM
    let trail = 0
    while (
      trail < max - start
      && current[current.length - trail - SINGLE_ITEM]
        === text[text.length - trail - SINGLE_ITEM]
    )
      trail += SINGLE_ITEM
    return {
      from: start,
      insert: text.slice(start, text.length - trail),
      to: current.length - trail,
    }
  }

  /** @returns {{from: number, to: number}} The main selection range. */

  get selection() {
    const { from, to } = this._view.state.selection.main
    return { from, to }
  }

  /** @returns {{line: number, col: number}} 1-based caret line and column. */

  getCursorPosition() {
    const pos = this._view.state.selection.main.head
    const line = this._view.state.doc.lineAt(pos)
    return { col: pos - line.from + SINGLE_ITEM, line: line.number }
  }

  // ── view configuration ──

  /** @param {boolean} editable - Whether the user can edit the document. */

  setEditable(editable) {
    const editableState = EditorView.editable.of(editable)
    this._view.dispatch({ effects: this._parts.editable.reconfigure(editableState) })
  }

  /** @param {boolean} hidden - Toggle the host element's `hidden` class. */

  setHidden(hidden) {
    this._parent.classList.toggle('hidden', hidden)
  }

  /** @returns {boolean} True when the editor is hidden (binary preview shown). */

  get hidden() {
    return this._parent.classList.contains('hidden')
  }

  /** Move keyboard focus into the editor. */

  focus() {
    this._view.focus()
  }

  /**
   * Move the caret to a 1-based line/column and scroll it into view. Both are
   * clamped to the document bounds, so out-of-range positions are safe (a
   * now-shorter file lands on its last line, a short line on its end).
   * @param {number} lineNumber - 1-based line to jump to.
   * @param {number} [col=1] - 1-based column within the line.
   */

  setCursor(lineNumber, col = SINGLE_ITEM) {
    const { doc } = this._view.state
    const clamped = Math.max(SINGLE_ITEM, Math.min(lineNumber, doc.lines))
    const line = doc.line(clamped)
    const pos = Math.min(line.from + col - SINGLE_ITEM, line.to)
    // eslint-disable-next-line id-length -- CodeMirror's scrollIntoView axis key
    const scroll = EditorView.scrollIntoView(pos, { y: 'center' })
    this._view.dispatch({ effects: scroll, selection: { anchor: pos } })
    this._view.focus()
  }

  // ── change notifications ──

  /** @param {Function} fn - Called on each user (non-programmatic) edit. */

  onChange(fn) {
    this._onChange = fn || _noop
  }

  /** Emit a change notification for an externally applied content update. */

  signalChange() {
    this._onChange()
  }

}
