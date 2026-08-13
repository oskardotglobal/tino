import {
  EditorState,
  EditorView,
  bracketMatching,
  codeFolding,
  defaultKeymap,
  drawSelection,
  foldGutter,
  foldKeymap,
  history,
  historyKeymap,
  indentOnInput,
  indentUnit,
  indentWithTab,
  keymap,
  lineNumbers,
  lintGutter,
  lintKeymap,
  linter,
  searchKeymap,
} from './vendor/codemirror.js'
import { editorBindings, formatBinding } from './codemirror-keymaps.js'
import { typst, typstKeymap } from './codemirror-typst.js'
import { LINT_DEBOUNCE_MS } from './constants.js'

/**
 * The CodeMirror extension set the editor runs with, kept apart from the
 * editor controller (codemirror-editor.js) so the controller stays about the
 * view and its public API.
 */

/** Undo/redo history — always active, so Vim's `u`, Ctrl-r and Ctrl-Z agree. */

const historyExt = () => [history(), keymap.of(historyKeymap)]

/**
 * Build the editor's full extension list.
 * @param {object} args
 * @param {object} args.compartments - The reconfigurable compartments, keyed by
 *   `collab`, `editable`, `keymap` and `wrap`.
 * @param {Array} args.panelExt - Panel placement extension (keymap status bars).
 * @param {Function} args.lintSource - Diagnostics source, `view => Promise<[]>`,
 *   polled after edits (debounced) and on demand via `forceLinting`.
 * @param {Function} args.onFormat - Invoked by the format key binding.
 * @param {Function} args.onUpdate - Invoked for every CodeMirror view update.
 * @returns {Array} The extensions to create the editor state with.
 */

export const editorExtensions = (
  { compartments, panelExt, lintSource, onFormat, onUpdate },
) => [
  compartments.keymap.of([]),
  panelExt,
  compartments.wrap.of(EditorView.lineWrapping),
  lineNumbers(),
  lintGutter(),
  linter(lintSource, { delay: LINT_DEBOUNCE_MS }),
  drawSelection(),
  foldGutter(),
  codeFolding(),
  bracketMatching(),
  indentUnit.of('  '),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  historyExt(),
  compartments.collab.of([]),
  typst(),
  keymap.of([
    ...editorBindings,
    formatBinding(onFormat),
    ...typstKeymap,
    indentWithTab,
    ...searchKeymap,
    ...lintKeymap,
    ...foldKeymap,
    ...defaultKeymap,
  ]),
  compartments.editable.of(EditorView.editable.of(true)),
  EditorView.updateListener.of(onUpdate),
]
