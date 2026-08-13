import { SINGLE_ITEM, escapeHtml } from './constants.js'

/**
 * Compiler diagnostics: errors and warnings reported by the Typst CLI.
 *
 * Diagnostics belong to a file, not to the preview — a broken import shows up
 * in the file that declares it, which may not even be open. They are therefore
 * kept per path, pushed into the editor whenever that file is on screen, and
 * summarised in a banner above the preview whose entries jump to the offending
 * line. The preview itself keeps the last successful render, dimmed while it is
 * known to be out of date.
 */

export class DiagnosticsManager {

  /** @param {TinoApp} app - Main application instance. */

  constructor(app) {
    this.app = app
    this._byPath = new Map()
    this._banner = document.getElementById('preview-diagnostics')
  }

  /** Bind the banner's jump-to-error links. */

  bind() {
    this._banner.addEventListener('click', evt => this._onClick(evt))
  }

  /** @returns {boolean} Whether the last compilation reported an error. */

  get hasErrors() {
    return [...this._byPath.values()]
      .some(list => list.some(diag => diag.severity === 'error'))
  }

  /**
   * Replace all diagnostics with the ones from the latest compilation.
   * @param {Array<object>} diagnostics - Diagnostics as returned by the API.
   */

  set(diagnostics) {
    this._byPath = DiagnosticsManager._group(diagnostics || [])
    this._render()
    this.apply()
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

  // ── Internal ──

  static _group(diagnostics) {
    const grouped = new Map()

    diagnostics.forEach(diag => {
      const list = grouped.get(diag.path) || []
      list.push(diag)
      grouped.set(diag.path, list)
    })

    return grouped
  }

  _render() {
    const entries = [...this._byPath.entries()]
      .flatMap(([path, list]) => list.map(diag => ({ ...diag, path })))
    const known = this.app.fileTree.filePaths || new Set()
    this._banner.classList.toggle('hidden', entries.length === 0)
    this._banner.innerHTML = entries
      .map(diag => DiagnosticsManager._entryHtml(diag, known.has(diag.path)))
      .join('')
  }

  /* Only diagnostics pointing at a file of the bucket become jump links —
     Typst also reports errors from package sources, which cannot be opened. */

  static _entryHtml(diag, openable) {
    const where = DiagnosticsManager._whereHtml(diag)
    const attrs = DiagnosticsManager._linkAttrs(diag, openable)

    return (
      `<div class="diagnostic diagnostic-${diag.severity}"${attrs}>${where}` +
      `<span class="diagnostic-message">${escapeHtml(diag.message)}</span>` +
      '</div>'
    )
  }

  /** The `file.typ:12` label a diagnostic is prefixed with, if it has one. */

  static _whereHtml(diag) {
    if (!diag.path)
      return ''
    const line = diag.line ? `:${diag.line}` : ''

    return `<span class="diagnostic-where">${escapeHtml(diag.path)}${line}</span>`
  }

  static _linkAttrs(diag, openable) {
    if (!openable)
      return ''

    return (
      ` data-path="${escapeHtml(diag.path)}"` +
      ` data-line="${diag.line || SINGLE_ITEM}"`
    )
  }

  async _onClick(evt) {
    const entry = evt.target.closest('.diagnostic[data-path]')

    if (!entry)
      return

    const { line, path } = entry.dataset

    if (path !== this.app.currentFile)
      await this.app.editor.openFile(path)

    this.app.els.editor.setCursor(Number(line))
  }

}
