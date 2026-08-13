import { SINGLE_ITEM } from './constants.js'

/**
 * Compiler diagnostics: errors and warnings reported by the Typst CLI.
 *
 * Diagnostics belong to a file, not to the preview — a broken import is reported
 * against the file that declares it, which may not be the one on screen. They
 * are therefore kept per path and shown in two places: on the offending line of
 * the editor, and as a mark on the file in the explorer, which is how a problem
 * in a file nobody has open becomes visible at all. The preview itself only keeps
 * its last successful render, dimmed while it is known to be out of date.
 */

export class DiagnosticsManager {

  /** @param {TinoApp} app - Main application instance. */

  constructor(app) {
    this.app = app
    this._byPath = new Map()
  }

  /**
   * Replace all diagnostics with the ones from the latest compilation.
   * @param {Array<object>} diagnostics - Diagnostics as returned by the API.
   */

  set(diagnostics) {
    this._byPath = DiagnosticsManager._group(diagnostics || [])
    this.apply()
    this.mark()
  }

  /** Drop all diagnostics, e.g. when switching projects. */

  clear() {
    this.set([])
  }

  /** Push the diagnostics of the open file into the editor. */

  apply() {
    const path = this.app.currentFile
    const { editor } = this.app.els

    if (editor.hidden)
      return

    editor.setDiagnostics(this._byPath.get(path) || [])
  }

  /**
   * Mark the files that have errors in the explorer. Called after every
   * compilation, and by the file tree after it re-renders (which drops the
   * marks with the rest of the DOM).
   */

  mark() {
    const tree = this.app.els.fileTree

    if (!tree)
      return

    tree.querySelectorAll('.file-item').forEach(item => {
      DiagnosticsManager._markItem(item, this._errorsIn(item.dataset.file))
    })
  }

  // ── Internal ──

  /** The errors — not the warnings — reported against one file. */

  _errorsIn(path) {
    return (this._byPath.get(path) || [])
      .filter(diag => diag.severity === 'error')
  }

  static _markItem(item, errors) {
    item.classList.toggle('file-errors', errors.length > 0)

    if (!errors.length) {
      item.removeAttribute('title')
      return
    }

    const [first] = errors
    const summary = `${errors.length} errors`

    item.title = errors.length === SINGLE_ITEM ? first.message.split('\n')[0] : summary
  }

  static _group(diagnostics) {
    const grouped = new Map()

    diagnostics.forEach(diag => {
      const list = grouped.get(diag.path) || []
      list.push(diag)
      grouped.set(diag.path, list)
    })

    return grouped
  }

}
