/**
 * Profile dialog, opened from the user chip in the toolbar. Holds the optional
 * display name and email address commits are authored with; both are stored on
 * the server, so they follow the user across browsers and are available to the
 * commit endpoint.
 */

export class ProfileModal {

  /** @param {TinoApp} app - Main application instance. */

  constructor(app) {
    this.app = app
    this._dialog = document.getElementById('profile-dialog')
    this._name = document.getElementById('profile-name')
    this._email = document.getElementById('profile-email')
  }

  /** Bind the toolbar trigger and the dialog buttons. */

  bind() {
    document.getElementById('btn-profile')
      .addEventListener('click', () => this.open())
    document.getElementById('btn-profile-close-x')
      .addEventListener('click', () => this.close())
    document.getElementById('btn-profile-cancel')
      .addEventListener('click', () => this.close())
    document.getElementById('btn-profile-save')
      .addEventListener('click', () => this.save())
    this._dialog.addEventListener('click', evt => {
      if (evt.target === this._dialog)
        this.close()
    })
  }

  /** Open the dialog with the stored profile loaded from the server. */

  async open() {
    try {
      const profile = await this.app.api.getProfile()
      this._name.value = profile.name || ''
      this._email.value = profile.email || ''
    }
    catch (err) {
      this.app.toast.error(`Could not load your profile: ${err.message}`)
      return
    }
    this._dialog.classList.add('visible')
    this._name.focus()
  }

  /** Persist the profile and refresh the toolbar label. */

  async save() {
    try {
      await this.app.api.updateProfile({
        email: this._email.value.trim(),
        name: this._name.value.trim(),
      })
    }
    catch (err) {
      this.app.toast.error(`Could not save your profile: ${err.message}`)
      return
    }
    this.close()
    await this.app.reloadUser()
    this.app.toast.success('Profile saved.')
  }

  close() {
    this._dialog.classList.remove('visible')
  }

}
