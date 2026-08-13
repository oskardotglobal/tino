import { SINGLE_ITEM } from './constants.js'

/**
 * Live error detection for the editor, backed by tinymist on the server.
 *
 * The buffer is sent to the API as-is — unsaved included — and tinymist's LSP
 * diagnostics come back with zero-based line/character positions, which are
 * converted to CodeMirror document offsets here. CodeMirror drives the polling
 * through its lint extension, so checks are debounced and superseded requests
 * are discarded for us; the editor merges the result with the compiler's own
 * diagnostics (see diagnostics.js).
 */

/** Diagnostic severities CodeMirror understands, keyed by the API's names. */

const SEVERITIES = {
  error: 'error',
  hint: 'hint',
  info: 'info',
  warning: 'warning',
}

export class EditorLint {

  /** @param {TinoApp} app - Main application instance. */

  constructor(app) {
    this.app = app
    this._available = true
  }

  /**
   * Take over the editor's diagnostics source, checking with tinymist when the
   * server has it. Called once the frontend config is known.
   *
   * The source is bound either way: with no language server it contributes
   * nothing, but it still keeps the problem count in the status bar in step with
   * the compiler's diagnostics.
   */

  bind() {
    this._available = !(this.app.config && this.app.config.linting === false)
    this.app.els.editor.setLintSource(view => this._check(view))
  }

  /** Reflect the current problem count in the status bar. */

  render() {
    const el = document.getElementById('status-bar-problems')
    if (!el)
      return
    const { problemCount: count } = this.app.els.editor
    el.classList.toggle('hidden', count === 0)
    el.textContent = count === SINGLE_ITEM ? '1 problem' : `${count} problems`
  }

  // ── Internal ──

  /**
   * Lint source for CodeMirror: fetch diagnostics for the current buffer.
   * @param {EditorView} view - The CodeMirror view being linted.
   * @returns {Promise<Array>} CodeMirror diagnostics (empty when unavailable).
   */

  async _check(view) {
    const path = this.app.currentFile
    this._scheduleRender()
    if (!this._available || !this.app.bucket || !path || !path.endsWith('.typ'))
      return []
    try {
      const result = await this.app.api.lint(
        this.app.bucket, path, view.state.doc.toString(),
      )
      this._scheduleRender()
      return result.diagnostics
        .map(diag => EditorLint._toCodeMirror(view, diag))
    }
    catch (err) {
      this._disable(err)
      return []
    }
  }

  /*
   * The lint extension offers no "diagnostics applied" hook, and it stores the
   * result in a transaction dispatched from a promise callback. A timeout —
   * rather than a microtask — therefore runs after that transaction, which is
   * when the count is finally readable.
   */

  _scheduleRender() {
    setTimeout(() => this.render(), 0)
  }

  /*
   * A failing check means the server has no working tinymist (not installed,
   * crashed, or timing out). Live checking is an assist on top of the compiler's
   * diagnostics, so it switches itself off instead of nagging on every
   * keystroke. The source stays bound and keeps reporting the count.
   */

  _disable(err) {
    this._available = false
    this.render()
    this.app.toast.info(`Live error checking is unavailable: ${err.message}`)
  }

  /** Convert one LSP diagnostic into its CodeMirror equivalent. */

  static _toCodeMirror(view, diag) {
    const range = diag.range || {}
    const from = EditorLint._offset(view, range.start)
    const to = EditorLint._offset(view, range.end)
    return {
      from,
      message: diag.message,
      severity: SEVERITIES[diag.severity] || 'error',
      source: diag.source,
      to: Math.max(from, to),
    }
  }

  /**
   * Convert a zero-based LSP position to a document offset, clamped to the
   * document — a buffer edited while a check was in flight can be shorter than
   * the text the diagnostic was computed on.
   */

  static _offset(view, position) {
    const { doc } = view.state
    if (!position)
      return 0
    const lineNumber = Math.min((position.line || 0) + SINGLE_ITEM, doc.lines)
    const line = doc.line(Math.max(SINGLE_ITEM, lineNumber))
    return Math.min(line.from + (position.character || 0), line.to)
  }

}
