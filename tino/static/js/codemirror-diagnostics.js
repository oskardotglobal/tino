import { SINGLE_ITEM } from './constants.js'

/**
 * Translation of compiler diagnostics into CodeMirror's own diagnostic shape,
 * and their merge with the language server's.
 *
 * The compiler reports 1-based line/column pairs against the file *as saved*,
 * while CodeMirror works with document offsets of the buffer *as edited*.
 * Positions are therefore clamped to the document: a diagnostic from a compile
 * that raced ahead of the latest keystrokes still lands on a valid line instead
 * of being dropped.
 */

/* Diagnostics without a column mark the whole line. */

const _start = (line, column) => {
  if (!column)
    return line.from

  return Math.min(line.from + column - SINGLE_ITEM, line.to)
}

const _toEditorDiagnostic = (state, diag) => {
  const { doc } = state
  const number = Math.min(Math.max(diag.line || SINGLE_ITEM, SINGLE_ITEM), doc.lines)
  const line = doc.line(number)
  const from = _start(line, diag.column)

  return {
    from,
    message: diag.message,
    severity: diag.severity === 'warning' ? 'warning' : 'error',
    to: Math.max(line.to, from),
  }
}

/**
 * @param {EditorState} state - State the diagnostics are resolved against.
 * @param {Array<{line: number, column: number, severity: string,
 *   message: string}>} diagnostics - Diagnostics as reported by the compiler.
 * @returns {Array<object>} CodeMirror diagnostics.
 */

export const toEditorDiagnostics = (state, diagnostics) =>
  diagnostics.map(diag => _toEditorDiagnostic(state, diag))

/*
 * The language server and the compiler frequently report the same mistake. The
 * server's version wins: it knows the buffer as edited and marks the exact
 * range, while the compiler marks the whole line of the file as last saved.
 *
 * Two reports count as the same when they name the same problem on the same
 * line. Only the first line of the message is compared, because the compiler
 * appends its hints to the message while the language server does not.
 */

const _key = (state, diag) => {
  const { number } = state.doc.lineAt(diag.from)

  return `${number}:${diag.message.split('\n')[0]}`
}

/**
 * Combine live diagnostics with the compiler's, dropping compiler duplicates.
 * @param {EditorState} state - State both sets are resolved against.
 * @param {Array<object>} live - CodeMirror diagnostics from the language server.
 * @param {Array<object>} compiled - CodeMirror diagnostics from the compiler.
 * @returns {Array<object>} The diagnostics to show, ordered by position.
 */

export const mergeDiagnostics = (state, live, compiled) => {
  const seen = new Set(live.map(diag => _key(state, diag)))
  const merged = [
    ...live,
    ...compiled.filter(diag => !seen.has(_key(state, diag))),
  ]

  return merged.sort((one, other) => one.from - other.from)
}
