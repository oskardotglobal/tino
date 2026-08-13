import { SINGLE_ITEM } from './constants.js'

/**
 * Translation between CodeMirror document offsets and the line/character pairs
 * the language server speaks.
 *
 * Both count characters in UTF-16 code units — the unit a JavaScript string is
 * indexed in — so a line's character offset is a plain subtraction. Lines differ
 * only in their base: CodeMirror counts from one, the language server from zero.
 */

/**
 * @param {EditorState} state - State the offset belongs to.
 * @param {number} offset - Document offset.
 * @returns {{line: number, character: number}} The server-side position.
 */

export const toPosition = (state, offset) => {
  const line = state.doc.lineAt(offset)

  return { character: offset - line.from, line: line.number - SINGLE_ITEM }
}

/**
 * @param {EditorState} state - State the offsets belong to.
 * @param {number} from - Start offset.
 * @param {number} to - End offset.
 * @returns {{start: object, end: object}} The server-side range.
 */

export const toSpan = (state, from, to) => (
  { end: toPosition(state, to), start: toPosition(state, from) }
)

/**
 * Convert a server-side position back to a document offset, clamped to the
 * document — the answer to a request describes the document as it was when the
 * request was sent, which may be a keystroke behind.
 * @param {EditorState} state - State to resolve against.
 * @param {{line: number, character: number}} position - Server-side position.
 * @returns {number} Document offset.
 */

export const toOffset = (state, position) => {
  const { doc } = state
  const number = Math.min((position.line || 0) + SINGLE_ITEM, doc.lines)
  const line = doc.line(Math.max(SINGLE_ITEM, number))

  return Math.min(line.from + (position.character || 0), line.to)
}

/**
 * Convert a server-side range back to a document range.
 * @param {EditorState} state - State to resolve against.
 * @param {{start: object, end: object}} span - Server-side range.
 * @returns {{from: number, to: number}} Document range.
 */

export const toRange = (state, span) => {
  const from = toOffset(state, span.start || {})

  return { from, to: Math.max(from, toOffset(state, span.end || {})) }
}
