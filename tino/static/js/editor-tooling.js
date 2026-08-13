import { EditorActions } from './editor-actions.js'
import { EditorComplete } from './editor-complete.js'
import { EditorFormat } from './editor-format.js'

/**
 * The editor's language tooling, provided by binaries on the server: formatting
 * (typstyle) plus completion and code actions (the tinymist language server).
 *
 * Grouped behind one object so the app has a single handle for "tooling", and so
 * every part is enabled together once /api/config has said which of the two
 * tools the server actually has.
 */

export class EditorTooling {

  /** @param {TinoApp} app - Main application instance. */

  constructor(app) {
    this.app = app
    this.format = new EditorFormat(app)
    this.complete = new EditorComplete(app)
    this.actions = new EditorActions(app)
  }

  /** Enable the tools the server supports. Call once the config is loaded. */

  bind() {
    this.complete.bind()
    this.actions.bind()
    this.format.syncControls()
  }

  /**
   * Make sure the server's copy of the current file matches what the editor
   * shows, before asking the language server about a position in it.
   *
   * Normally there is nothing to do: every keystroke goes into the shared Yjs
   * document, which is what the server reads. Without a collaborative session —
   * no connection, or a read-only role — the server reads the file instead, so a
   * pending autosave is flushed first.
   */

  async sync() {
    const { editor } = this.app
    if (editor.collab.synced || !this.app.dirty.has(this.app.currentFile))
      return
    await (editor.flushSave() || editor.saveCurrentFile())
  }

}
