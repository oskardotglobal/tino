/**
 * Entry point for the combined editor bundle.
 *
 * Re-exports every third-party symbol the editor needs — CodeMirror, Yjs,
 * y-websocket, and the y-codemirror.next binding — so esbuild resolves the
 * bare specifiers into ONE vendored file. They must share a single bundle:
 * yCollab bridges CodeMirror and Yjs, so both frameworks have to resolve to
 * the same module instances (a second copy would break facet/type identity).
 */

export { Annotation, Compartment, EditorState, Transaction } from '@codemirror/state'
export {
  EditorView,
  drawSelection,
  keymap,
  lineNumbers,
  panels,
} from '@codemirror/view'
export { Doc } from 'yjs'
export { WebsocketProvider } from 'y-websocket'
export { yCollab } from 'y-codemirror.next'

/*
 * Not part of the package's public exports, so import the source file by path.
 * It resolves to the same module yCollab uses, so the annotation is identical.
 */

export { ySyncAnnotation } from '../../../node_modules/y-codemirror.next/src/y-sync.js'
export {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
export {
  HighlightStyle,
  LanguageSupport,
  StreamLanguage,
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  foldService,
  indentOnInput,
  indentService,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language'
export {
  gotoLine,
  searchKeymap,
  selectNextOccurrence,
} from '@codemirror/search'
export { lintGutter, setDiagnostics } from '@codemirror/lint'
export { autocompletion, snippet, startCompletion } from '@codemirror/autocomplete'
export { tags } from '@lezer/highlight'
export { vim } from '@replit/codemirror-vim'
export { helix } from 'codemirror-helix'
