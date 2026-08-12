const VIM_KEY = 'tino:vim'

/**
 * Settings dialog: editor preferences plus entry points to the admin-only
 * font and API-key managers, which used to sit directly in the toolbar.
 */

export class SettingsModal {

  /** @param {TinoApp} app - Main application instance. */

  constructor(app) {
    this.app = app
    this._dialog = document.getElementById('settings-dialog')
    this._vimBtn = document.getElementById('btn-vim')
  }

  /** Bind the toolbar trigger, dialog buttons, and apply the saved Vim state. */

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
    this._bindVim()
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

  _bindVim() {
    this._applyVim(localStorage.getItem(VIM_KEY) === 'on')
    this._vimBtn.addEventListener('click', () => {
      const next = !this._vimBtn.classList.contains('active')
      this._applyVim(next)
      localStorage.setItem(VIM_KEY, next ? 'on' : 'off')
    })
  }

  _applyVim(enabled) {
    this.app.els.editor.setVim(enabled)
    this._vimBtn.classList.toggle('active', enabled)
    this._vimBtn.textContent = enabled ? 'On' : 'Off'
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
