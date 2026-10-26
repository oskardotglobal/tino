import {
  EditorState,
  EditorView,
  autocompletion,
  bracketMatching,
  codeFolding,
  defaultKeymap,
  drawSelection,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  indentWithTab,
  keymap,
  lineNumbers,
  lintGutter,
  searchKeymap,
} from './vendor/codemirror.js'
import { codeActionBinding, editorBindings, formatBinding } from './codemirror-keymaps.js'
import { typst, typstKeymap } from './codemirror-typst.js'
import { undoHistory } from './codemirror-history.js'

/**
 * The CodeMirror extension set the editor runs with, kept apart from the
 * editor controller (codemirror-editor.js) so the controller stays about the
 * view and its public API.
 */

/**
 * Build the editor's full extension list.
 * @param {object} args
 * @param {object} args.compartments - The reconfigurable compartments, keyed by
 *   `collab`, `editable`, `keymap` and `wrap`.
 * @param {Array} args.panelExt - Panel placement extension (keymap status bars).
 * @param {Function} args.completionSource - Completion source, `context => …`.
 * @param {Function} args.onFormat - Invoked by the format key binding.
 * @param {Function} args.onCodeAction - Invoked by the code-action key binding.
 * @param {Function} args.onUpdate - Invoked for every CodeMirror view update.
 * @returns {Array} The extensions to create the editor state with.
 */

export const editorExtensions = (
  { compartments, panelExt, completionSource, onFormat, onCodeAction, onUpdate },
) => [
  compartments.keymap.of([]),
  panelExt,
  compartments.wrap.of(EditorView.lineWrapping),
  lineNumbers(),
  lintGutter(),
  autocompletion({ activateOnTyping: false, override: [completionSource] }),
  drawSelection(),
  foldGutter(),
  codeFolding(),
  bracketMatching(),
  indentUnit.of('  '),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  undoHistory(),
  compartments.collab.of([]),
  typst(),
  keymap.of([
    ...editorBindings,
    formatBinding(onFormat),
    codeActionBinding(onCodeAction),
    ...typstKeymap,
    indentWithTab,
    ...searchKeymap,
    ...foldKeymap,
    ...defaultKeymap,
  ]),
  compartments.editable.of(EditorView.editable.of(true)),
  EditorView.updateListener.of(onUpdate),
]
