import { SINGLE_ITEM } from './constants.js'

/**
 * Translation of language-server snippets into CodeMirror's dialect.
 *
 * The server numbers its placeholders — `${1:body}` for one holding default
 * text, `${2}` for an empty one, `$0` for where the caret ends up — while
 * CodeMirror names them and visits them in the order they appear (`${body}`).
 *
 * The alternatives in the pattern are tried left to right, so an escaped dollar
 * (`\$`, which Typst math is full of) is consumed before it can be read as the
 * start of a placeholder.
 */

const PLACEHOLDER = /\\\$|\$\{(?<index>\d+)(?::(?<fallback>[^{}]*))?\}|\$(?<bare>\d+)/gu

/* String.replace passes the named groups as its last argument. */

const groupsOf = rest => rest.at(-SINGLE_ITEM)

/**
 * @param {string} template - Snippet text as the language server wrote it.
 * @returns {string} The same snippet in CodeMirror's syntax.
 */

export const toCodeMirrorSnippet = template =>
  template.replace(PLACEHOLDER, (match, ...rest) => {
    if (match === '\\$')
      return '$'

    return `\${${groupsOf(rest).fallback || ''}}`
  })

/**
 * Resolve a snippet to the text it describes, for when it is applied without a
 * caret to walk through it: placeholders become their default text, or nothing.
 * @param {string} template - Snippet text as the language server wrote it.
 * @returns {string} Plain text.
 */

export const toPlainText = template =>
  template.replace(PLACEHOLDER, (match, ...rest) => {
    if (match === '\\$')
      return '$'

    return groupsOf(rest).fallback || ''
  })
