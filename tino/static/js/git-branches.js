/**
 * The branch picker in the Git dialog's header, and the current branch shown
 * on the toolbar's Git button.
 *
 * The branch is a property of the project's single working tree, so it is
 * shared by everyone: another committer switching it shows up here through
 * the bucket events, which reload it via GitManager.loadStatus.
 */

export class GitBranches {

  /**
   * @param {TinoApp} app - Main application instance.
   * @param {Function} onSwitched - Called after the working tree changed branch.
   */

  constructor(app, onSwitched) {
    this.app = app
    this.current = null
    this._onSwitched = onSwitched
  }

  /** Fetch the branches and show the current one in the toolbar and dialog. */

  async load() {
    if (!this.app.bucket)
      return
    try {
      this._render(await this.app.api.gitBranches(this.app.bucket))
    }
    catch {
      this._render({ branches: [], current: null })
    }
  }

  _render({ current, branches }) {
    this.current = current
    document.getElementById('git-branch-label').textContent = current || ''
    const select = document.getElementById('git-branch-select')
    select.innerHTML = ''
    if (!current)
      select.add(new Option('(detached)', '', true, true))
    branches.forEach(name => select.add(new Option(name, name, false, name === current)))
  }

  /** Check out an existing branch. */

  async switchTo(name) {
    if (!name || name === this.current)
      return
    await this._checkout(name, false)
  }

  /** Ask for a name and create a branch from the current one. */

  async create() {
    // eslint-disable-next-line no-alert
    const name = (prompt('New branch name:') || '').trim()
    if (name)
      await this._checkout(name, true)
  }

  async _checkout(name, create) {
    try {
      const result = await this.app.api.gitCheckout(this.app.bucket, name, create)
      this.app.toast.success(`Switched to branch ${name}.`)
      await this.app.reloadAfterPull(result.changed)
    }
    catch (err) {
      this.app.toast.error(`Switching branch failed: ${err.message}`)
      await this.load()
      return
    }
    await this._onSwitched()
  }

}
