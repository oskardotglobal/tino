const KEYMAP_KEY = 'tino:keymap'
const LEGACY_VIM_KEY = 'tino:vim'
const FONT_FAMILY_KEY = 'tino:font-family'
const FONT_SIZE_KEY = 'tino:font-size'

const KEYMAPS = ['default', 'vim', 'helix']

const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 32

/**
 * Settings dialog: editor preferences plus entry points to the admin-only
 * font and API-key managers, which used to sit directly in the toolbar.
 */

export class SettingsModal {

  /** @param {TinoApp} app - Main application instance. */

  constructor(app) {
    this.app = app
    this._dialog = document.getElementById('settings-dialog')
    this._keymapSelect = document.getElementById('setting-keymap')
    this._fontFamily = document.getElementById('setting-font-family')
    this._fontSize = document.getElementById('setting-font-size')
  }

  /** Bind the toolbar trigger, dialog buttons, and apply the saved settings. */

  bind() {
    document.getElementById('btn-settings')
      .addEventListener('click', () => this.open())
    document.getElementById('btn-settings-close')
      .addEventListener('click', () => this.close())
    document.getElementById('btn-settings-close-x')
      .addEventListener('click', () => this.close())
    this._dialog.addEventListener('click', evt => {
      if (evt.target === this._dialog)
        this.close()
    })
    this._bindKeymap()
    this._bindFont()
    this._bindManagers()
  }

  _bindManagers() {
    document.getElementById('btn-fonts')
      .addEventListener('click', () => {
        this.close()
        this.app.fontManager.open()
      })
    document.getElementById('btn-api-keys')
      .addEventListener('click', () => {
        this.close()
        this.app.apiKeyManager.open()
      })
  }

  // ── Keymap ──

  _bindKeymap() {
    this._applyKeymap(SettingsModal._storedKeymap())
    this._keymapSelect.addEventListener('change', () => {
      const mode = this._keymapSelect.value
      this._applyKeymap(mode)
      localStorage.setItem(KEYMAP_KEY, mode)
    })
  }

  /*
   * Read the stored keymap, migrating the pre-Helix `tino:vim` on/off flag on
   * first run so users who had Vim enabled keep it.
   */

  static _storedKeymap() {
    const stored = localStorage.getItem(KEYMAP_KEY)
    if (stored)
      return KEYMAPS.includes(stored) ? stored : 'default'
    const legacy = localStorage.getItem(LEGACY_VIM_KEY) === 'on' ? 'vim' : 'default'
    localStorage.setItem(KEYMAP_KEY, legacy)
    localStorage.removeItem(LEGACY_VIM_KEY)
    return legacy
  }

  _applyKeymap(mode) {
    this.app.els.editor.setKeymap(mode)
    this._keymapSelect.value = mode
  }

  // ── Editor font ──

  _bindFont() {
    this._applyFont(
      localStorage.getItem(FONT_FAMILY_KEY) || '',
      localStorage.getItem(FONT_SIZE_KEY) || '',
    )
    this._fontFamily.addEventListener('input', () => {
      localStorage.setItem(FONT_FAMILY_KEY, this._fontFamily.value.trim())
      this._applyFont(this._fontFamily.value.trim(), this._fontSize.value)
    })
    this._fontSize.addEventListener('input', () => {
      localStorage.setItem(FONT_SIZE_KEY, this._fontSize.value)
      this._applyFont(this._fontFamily.value.trim(), this._fontSize.value)
    })
  }

  /*
   * The font is applied as CSS custom properties rather than a CodeMirror
   * theme, so changes take effect without reconfiguring the editor. Empty
   * values remove the override and fall back to the stylesheet defaults.
   */

  _applyFont(family, size) {
    const { style } = document.documentElement
    this._fontFamily.value = family
    this._fontSize.value = size
    if (family)
      style.setProperty('--editor-font-family', family)
    else
      style.removeProperty('--editor-font-family')
    const px = Number(size)
    if (px >= MIN_FONT_SIZE && px <= MAX_FONT_SIZE)
      style.setProperty('--editor-font-size', `${px}px`)
    else
      style.removeProperty('--editor-font-size')
  }

  /**
   * Show or hide the admin-only rows.
   * @param {boolean} isAdmin - Whether the current user is a global admin.
   */

  applyAdminVisibility(isAdmin) {
    this._dialog.querySelectorAll('.settings-row-admin').forEach(row => {
      row.classList.toggle('hidden', !isAdmin)
    })
  }

  open() {
    this._dialog.classList.add('visible')
  }

  close() {
    this._dialog.classList.remove('visible')
  }

}
