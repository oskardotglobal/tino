import { SINGLE_ITEM } from './constants.js'

/**
 * Whole-document formatting for the editor, backed by typstyle on the server.
 *
 * The server formats its own copy of the file — the collaboration room's text —
 * and answers with the result plus the text it started from. The editor applies
 * it as an ordinary edit, so it reaches collaborators and disk the same way
 * typing does, and only the differing part of the document is rewritten, which
 * keeps the caret (and everyone else's) where it was.
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

  /* Applied as an ordinary transaction: the change is reported (so the file is
     marked dirty and autosaved) and propagates over collaboration. */

  async _format() {
    const { editor } = this.app.els
    await this.app.tooling.sync()
    const result = await this.app.api.format(this.app.bucket, this.app.currentFile)
    const before = editor.content

    /* The document must still be the one that was formatted. It differs when
       someone typed while the request was in flight, or when the editor's own
       edits had not reached the room yet — applying the result would then undo
       whatever the server had not seen. */

    if (result.original !== before) {
      this.app.toast.info('Document changed while formatting — try again.')
      return
    }
    if (result.content === before)
      this.app.toast.info('Already formatted.')
    else
      editor.view.dispatch({ changes: EditorFormat._change(before, result.content) })
  }

  /* Narrow a whole-document rewrite down to the span that actually differs, by
     skipping the common prefix and the common suffix — so the caret, the remote
     cursors and the undo history survive a reformat of part of the document. */

  static _change(current, text) {
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

}
