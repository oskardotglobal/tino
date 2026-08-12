import {
  EditorState,
  EditorView,
  bracketMatching,
  codeFolding,
  defaultKeymap,
  drawSelection,
  foldGutter,
  foldKeymap,
  gotoLine,
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
  selectNextOccurrence,
} from './vendor/codemirror.js'
import { typst, typstKeymap } from './codemirror-typst.js'
import { LINT_DEBOUNCE_MS } from './constants.js'

/**
 * The CodeMirror extension set the editor runs with, kept apart from the
 * editor controller (codemirror-editor.js) so the controller stays about the
 * view and its public API.
 */

/*
 * Files save themselves after a short idle delay, so Mod-s has nothing to do.
 * It is still bound (and reported as handled) purely to swallow the browser's
 * "save page as" dialog, which would otherwise fire inside the editor.
 */

const saveBinding = () => ({ key: 'Mod-s', preventDefault: true, run: () => true })

const gotoLineBinding = () => (
  { key: 'Mod-g', preventDefault: true, run: view => gotoLine(view) }
)

/*
 * Mod-d selects the next occurrence (multi-cursor). Always report the key as
 * handled so the browser's Mod-d (bookmark) is suppressed even when there is
 * no further occurrence — otherwise the bookmark dialog leaks through.
 */

const selectNextBinding = () => ({
  key: 'Mod-d',
  preventDefault: true,
  run: view => {
    selectNextOccurrence(view)
    return true
  },
})

/*
 * Shift-Alt-f is the format shortcut users know from VS Code. Formatting itself
 * happens outside CodeMirror (it goes through the API), so the binding calls
 * back into the app and only reports the key as handled.
 */

const formatBinding = onFormat => ({
  key: 'Shift-Alt-f',
  preventDefault: true,
  run: () => {
    onFormat()
    return true
  },
})

/** Undo/redo history — always active, so Vim's `u`, Ctrl-r and Ctrl-Z agree. */

const historyExt = () => [history(), keymap.of(historyKeymap)]

/**
 * Wrap a diagnostics source in the lint extension, debounced so a check runs
 * once the user pauses rather than on every keystroke.
 * @param {Function|null} source - `view => Promise<Diagnostic[]>`, or null for none.
 * @returns {object|Array} The lint extension, empty when there is no source.
 */

export const lintExtension = source => {
  if (!source)
    return []
  return linter(source, { delay: LINT_DEBOUNCE_MS })
}

/**
 * Build the editor's full extension list.
 * @param {object} args
 * @param {object} args.compartments - The reconfigurable compartments, keyed by
 *   `collab`, `editable`, `keymap`, `lint` and `wrap`.
 * @param {Array} args.panelExt - Panel placement extension (keymap status bars).
 * @param {Function} args.onFormat - Invoked by the format key binding.
 * @param {Function} args.onUpdate - Invoked for every CodeMirror view update.
 * @returns {Array} The extensions to create the editor state with.
 */

export const editorExtensions = ({ compartments, panelExt, onFormat, onUpdate }) => [
  compartments.keymap.of([]),
  panelExt,
  compartments.wrap.of(EditorView.lineWrapping),
  lineNumbers(),
  drawSelection(),
  foldGutter(),
  codeFolding(),
  bracketMatching(),
  indentUnit.of('  '),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  historyExt(),
  compartments.collab.of([]),
  compartments.lint.of([]),
  lintGutter(),
  typst(),
  keymap.of([
    saveBinding(),
    gotoLineBinding(),
    selectNextBinding(),
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
