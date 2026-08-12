import { helix, vim } from './vendor/codemirror.js'

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
