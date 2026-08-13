import { gotoLine, helix, selectNextOccurrence, vim } from './vendor/codemirror.js'

/**
 * The modal keymaps the editor can run, keyed by the value stored in the
 * settings dialog. Exactly one is active at a time, so a Vim/Helix mix-up is
 * impossible by construction.
 */

const KEYMAPS = {
  default: () => [],
  helix: () => helix(),
  vim: () => vim({ status: true }),
}

/**
 * Build the extension for a keymap mode.
 * @param {string} mode - One of `default`, `vim`, or `helix`.
 * @returns {object|Array} The CodeMirror extension, empty for the default.
 */

export const keymapExtension = mode => (KEYMAPS[mode] || KEYMAPS.default)()

/*
 * Files save themselves after a short idle delay, so Mod-s has nothing to do.
 * It is still bound (and reported as handled) purely to swallow the browser's
 * "save page as" dialog, which would otherwise fire inside the editor.
 */

const _saveBinding = { key: 'Mod-s', preventDefault: true, run: () => true }

const _gotoLineBinding = {
  key: 'Mod-g', preventDefault: true, run: view => gotoLine(view),
}

/*
 * Mod-d selects the next occurrence (multi-cursor). Always report the key as
 * handled so the browser's Mod-d (bookmark) is suppressed even when there is no
 * further occurrence — otherwise the bookmark dialog leaks through.
 */

const _selectNextBinding = {
  key: 'Mod-d',
  preventDefault: true,
  run: view => {
    selectNextOccurrence(view)
    return true
  },
}

/** The editor's own key bindings, taking precedence over the standard ones. */

export const editorBindings = [_saveBinding, _gotoLineBinding, _selectNextBinding]

/*
 * Shift-Alt-f is the format shortcut users know from VS Code. Formatting itself
 * happens outside CodeMirror (it goes through the API), so the binding calls
 * back into the app and only reports the key as handled.
 */

export const formatBinding = onFormat => ({
  key: 'Shift-Alt-f',
  preventDefault: true,
  run: () => {
    onFormat()
    return true
  },
})

/*
 * Mod-. offers the code actions for the selection, as it does in VS Code. Like
 * formatting, the work happens outside CodeMirror.
 */

export const codeActionBinding = onCodeAction => ({
  key: 'Mod-.',
  preventDefault: true,
  run: () => {
    onCodeAction()
    return true
  },
})
