import { EditorFormat } from './editor-format.js'
import { EditorLint } from './editor-lint.js'

/**
 * The editor's language tooling, both provided by binaries on the server:
 * formatting (typstyle) and live error detection (tinymist).
 *
 * Grouped behind one object so the editor manager has a single handle for
 * "tooling", and so both parts are enabled together once /api/config has said
 * which of the two tools the server actually has.
 */

export class EditorTooling {

  /** @param {TinoApp} app - Main application instance. */

  constructor(app) {
    this.format = new EditorFormat(app)
    this.lint = new EditorLint(app)
  }

  /** Enable the tools the server supports. Call once the config is loaded. */

  bind() {
    this.lint.bind()
    this.format.syncControls()
  }

}
