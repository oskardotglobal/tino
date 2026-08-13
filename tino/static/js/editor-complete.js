import { toPosition, toRange } from './codemirror-positions.js'
import { snippet } from './vendor/codemirror.js'
import { toCodeMirrorSnippet } from './snippets.js'

/**
 * Code completion for the editor, answered by tinymist on the server.
 *
 * The request carries only the caret position: the server reads the document
 * from the collaboration room, which holds the same text the editor shows, so
 * there is no buffer to upload and nothing that can disagree.
 *
 * Completions arrive with the range they replace (`#te` → `text(…)` replaces the
 * whole word, not just what follows the cursor) and often as snippets with
 * placeholders, both of which CodeMirror applies once translated.
 */

/** How much of an item's documentation fits beside its label. */

const DETAIL_MAX = 60

export class EditorComplete {

  /** @param {TinoApp} app - Main application instance. */

  constructor(app) {
    this.app = app
    this._available = true
  }

  /** Bind the completion source, unless the server has no language server. */

  bind() {
    if (this.app.config && this.app.config.languageServer === false) {
      this._available = false
      return
    }
    this.app.els.editor.setCompletionSource(context => this._complete(context))
  }

  // ── Internal ──

  /**
   * Completion source for CodeMirror.
   * @param {CompletionContext} context - The position being completed.
   * @returns {Promise<object|null>} A CodeMirror completion result, or null.
   */

  async _complete(context) {
    const path = this.app.currentFile
    if (!this._available || !this.app.bucket || !path || !path.endsWith('.typ'))
      return null
    if (!context.explicit && !EditorComplete._atTrigger(context))
      return null
    try {
      await this.app.tooling.sync()
      const { items } = await this.app.api.complete(
        this.app.bucket, path, toPosition(context.state, context.pos),
      )
      return EditorComplete._toResult(context, items)
    }
    catch (err) {
      this._disable(err)
      return null
    }
  }

  _disable(err) {
    this._available = false
    this.app.els.editor.setCompletionSource(null)
    this.app.toast.info(`Completion is unavailable: ${err.message}`)
  }

  /**
   * Turn the server's items into a CodeMirror completion result.
   *
   * All items share the range the server resolved them against, so the result's
   * span is taken from the first one carrying one. Filtering is left to the
   * server: it knows Typst's syntax, and its labels (`text`) do not always start
   * with what was typed (`#te`).
   */

  static _toResult(context, items) {
    if (!items.length)
      return null
    const ranged = items.find(item => item.range)
    const here = { from: context.pos, to: context.pos }
    const span = ranged ? toRange(context.state, ranged.range) : here

    return {
      filter: false,
      from: span.from,
      options: items.map(item => EditorComplete._toOption(item)),
      to: span.to,
    }
  }

  static _toOption(item) {
    const option = {
      apply: item.snippet ? snippet(toCodeMirrorSnippet(item.text)) : item.text,
      detail: EditorComplete._detail(item),
      label: item.label,
      type: item.kind,
    }

    /* CodeMirror shows the info panel for any option that carries one, so the
       key is only set when there is something to put in it. */

    if (item.documentation)
      option.info = item.documentation

    return option
  }

  /* Typst's own reference arrives as the item's detail, often several paragraphs
     of markdown. Only the first line fits beside the label. */

  static _detail(item) {
    const [first] = (item.detail || '').split('\n')

    return first.length > DETAIL_MAX ? `${first.slice(0, DETAIL_MAX)}…` : first
  }

}
