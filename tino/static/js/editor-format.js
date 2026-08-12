/**
 * Whole-document formatting for the editor, backed by typstyle on the server.
 *
 * The buffer is sent as-is and the formatted result is applied as an ordinary
 * edit, so it is autosaved and propagated to collaborators like any other
 * change. Only the differing part of the document is rewritten, which keeps the
 * caret (and everyone else's) where it was.
 */

export class EditorFormat {

  /** @param {TinoApp} app - Main application instance. */

  constructor(app) {
    this.app = app
    this._running = false
  }

  /** Whether formatting is offered at all (the server ships typstyle). */

  get available() {
    return !this.app.config || this.app.config.formatting !== false
  }

  /** Show or hide the toolbar's format button according to availability. */

  syncControls() {
    const btn = document.querySelector('[data-action="format"]')
    if (btn)
      btn.classList.toggle('hidden', !this.available)
  }

  /**
   * Format the current .typ buffer in place. Does nothing for other file types,
   * while a previous run is still in flight, or when the document is unchanged
   * by formatting.
   */

  async run() {
    const path = this.app.currentFile
    if (this._running || !this.available || !this.app.bucket)
      return
    if (!path || !path.endsWith('.typ')) {
      this.app.toast.info('Only Typst files can be formatted.')
      return
    }
    this._running = true
    await this._runGuarded()
  }

  // ── Internal ──

  async _runGuarded() {
    try {
      await this._format()
    }
    catch (err) {
      this.app.toast.error(`Formatting failed: ${err.message}`)
    }
    finally {
      this._running = false
      this.app.els.editor.focus()
    }
  }

  async _format() {
    const { editor } = this.app.els
    const before = editor.content
    const result = await this.app.api.format(this.app.bucket, before)

    /* Re-read the content: the user (or a collaborator) may have typed while
       the request was in flight, and overwriting that with a stale format
       result would drop their edit. */

    if (editor.content !== before) {
      this.app.toast.info('Document changed while formatting — nothing applied.')
      return
    }
    if (!editor.replaceText(result.content))
      this.app.toast.info('Already formatted.')
  }

}
