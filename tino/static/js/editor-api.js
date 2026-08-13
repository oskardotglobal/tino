import { GitAPI, bucketPath } from './git-api.js'

/**
 * REST endpoints for the editor's language tooling: formatting, completion and
 * code actions.
 */

export class EditorAPI extends GitAPI {

  /*
   * None of these sends the document's text: the server reads it from the
   * collaboration room, which holds the same content the editor shows.
   */

  /**
   * Format a file with typstyle.
   * @param {string} slug - Bucket the file belongs to.
   * @param {string} path - File to format.
   * @returns {Promise<{content: string, original: string}>} The formatted source,
   *   plus the text it was made from so the caller can check it is still current.
   */

  format(slug, path) {
    return this._json('POST', `${bucketPath(slug)}/format/${path}`, {})
  }

  /**
   * Ask what may be typed at a position.
   * @param {string} slug - Bucket the file belongs to.
   * @param {string} path - File being edited.
   * @param {{line: number, character: number}} position - Caret position.
   * @returns {Promise<{items: Array}>} Completion items.
   */

  complete(slug, path, position) {
    return this._json(
      'POST', `${bucketPath(slug)}/complete/${path}`, { position },
    )
  }

  /**
   * Ask which code actions apply to a range.
   * @param {string} slug - Bucket the file belongs to.
   * @param {string} path - File being edited.
   * @param {{start: object, end: object}} span - Range the caret covers.
   * @returns {Promise<{actions: Array}>} Available code actions with their edits.
   */

  codeActions(slug, path, span) {
    return this._json(
      'POST', `${bucketPath(slug)}/code-actions/${path}`, { span },
    )
  }

  /**
   * Apply a code action's edits to files the editor does not have open. The
   * server writes them through each file's collaboration room.
   * @param {string} slug - Bucket the files belong to.
   * @param {Object.<string,Array>} files - Text edits keyed by bucket path.
   */

  applyEdits(slug, files) {
    return this._json('POST', `${bucketPath(slug)}/edits`, { files })
  }

}
