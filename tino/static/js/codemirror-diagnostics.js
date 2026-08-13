import { SINGLE_ITEM } from './constants.js'

/**
 * Translation of compiler diagnostics into CodeMirror's own diagnostic shape.
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
