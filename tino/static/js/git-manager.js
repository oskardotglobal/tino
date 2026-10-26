import {
  STATUS_CLASSES,
  STATUS_ICONS,
  escapeHtml,
} from './constants.js'
import { GitBranches } from './git-branches.js'
import { GitHistory } from './git-history.js'
import { renderDiffEntries } from './diff-render.js'

/**
 * Manages the Git dialog: the Changes tab (status, diffs, commit), the remote
 * actions (push and pull), and the tab switching. The branch picker lives in
 * GitBranches. History browsing lives in
 * GitHistory, which renders into this dialog's second tab.
 */

export class GitManager {

  /** @param {TinoApp} app - Main application instance. */

  constructor(app) {
    this.app = app
    this.history = new GitHistory(app)
    this.branches = new GitBranches(app, () => this._reloadTab())
    this._tab = 'changes'
  }

  /** Fetch git status for all files, and the branches along with it. */

  async loadStatus() {
    if (!this.app.bucket)
      return
    const [statuses] = await Promise.all([
      this.app.api.gitStatus(this.app.bucket),
      this.branches.load(),
    ])
    this.app.gitStatuses = {}
    statuses.forEach(item => {
      this.app.gitStatuses[item.path] = item.status
    })
  }

  /** Reload the visible tab after the working tree changed underneath it. */

  async _reloadTab() {
    if (this._tab === 'changes')
      await this.loadChanges()
    else
      await this.history.load(this.history.filePath)
  }

  // ── Dialog and tabs ──

  /*
   * Open the Git dialog. Only committers get the Changes tab, so everyone else
   * lands on the history, which is all their role allows them to do here.
   */

  async openDialog() {
    if (!this.app.bucket)
      return
    if (this.app.bucketRole !== 'committer') {
      await this.openHistory()
      return
    }
    this._showDialog('changes')
    await this.loadChanges()
  }

  /**
   * Open the Git dialog on the History tab.
   * @param {string} [filePath] - Restrict the history to a single file.
   */

  async openHistory(filePath) {
    if (!this.app.bucket)
      return
    this._showDialog('history')
    await this.history.load(filePath)
  }

  _showDialog(tab) {
    this._applyRemoteState()
    this.selectTab(tab)
    document.getElementById('git-dialog').classList.add('visible')
  }

  /** Switch between the Changes and History tabs. */

  selectTab(tab) {
    this._tab = tab
    document.querySelectorAll('.git-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab)
    })
    document.getElementById('git-view-changes')
      .classList.toggle('hidden', tab !== 'changes')
    document.getElementById('git-view-history')
      .classList.toggle('hidden', tab !== 'history')
  }

  /** Hide the Git dialog overlay. */

  closeDialog() {
    document.getElementById('git-dialog').classList.remove('visible')
    this.history.reset()
  }

  // ── Changes tab ──

  /** Load the working tree status into the Changes tab. */

  async loadChanges() {
    await this.loadStatus()
    const paths = Object.keys(this.app.gitStatuses)
    if (paths.length === 0)
      this._showEmptyChanges()
    else
      this._showFileList(paths)
  }

  _showFileList(paths) {
    this.app.els.commitFiles.innerHTML = ''
    this._renderFileList(this.app.els.commitFiles, paths)
    GitManager._resetDiffPane()
    this.app.els.commitMessage.value = ''
    this.app.els.commitMessage.focus()
  }

  _showEmptyChanges() {
    this.app.els.commitFiles.innerHTML =
      '<li class="commit-empty">No changes to commit</li>'
    GitManager._resetDiffPane()
    this.app.els.commitMessage.value = ''
  }

  static _resetDiffPane() {
    const pane = document.getElementById('commit-diff')
    if (pane)
      pane.innerHTML = '<p class="preview-empty">Select a file to view its diff.</p>'
  }

  _renderFileList(list, paths) {
    paths.forEach(filePath => {
      const li = document.createElement('li')
      li.className = 'commit-file-item'
      li.dataset.file = filePath
      const status = this.app.gitStatuses[filePath]
      const safe = escapeHtml(filePath)
      li.innerHTML =
        `<label><input type='checkbox' value='${safe}' checked></label>`
        + '<span class="commit-file-name">'
        + `<span class="material-symbols-outlined git-badge ${STATUS_CLASSES[status]}">`
        + `${STATUS_ICONS[status]}</span>${safe}</span>`
      list.appendChild(li)
    })
  }

  /** Check or uncheck every file in the Changes tab. */

  selectAll(checked) {
    this.app.els.commitFiles
      .querySelectorAll('input[type="checkbox"]')
      .forEach(cb => {
        cb.checked = checked
      })
  }

  /** Load and render the diff for a single file in the preview pane. */

  async showDiffFor(filePath) {
    this._highlightFileRow(filePath)
    const pane = document.getElementById('commit-diff')
    pane.innerHTML = '<p class="preview-empty">Loading diff…</p>'
    try {
      const entries = await this.app.api.gitDiff(this.app.bucket, filePath)
      pane.innerHTML = renderDiffEntries(entries)
    }
    catch (err) {
      pane.innerHTML =
        `<p class="preview-empty">Could not load diff: ${escapeHtml(err.message)}</p>`
    }
  }

  _highlightFileRow(filePath) {
    this.app.els.commitFiles.querySelectorAll('.commit-file-item')
      .forEach(li => li.classList.toggle('active', li.dataset.file === filePath))
  }

  /** Validate and submit a git commit. */

  async submit() {
    const files = this._collectCheckedFiles()
    const message = this.app.els.commitMessage.value.trim()
    if (!message) {
      this.app.toast.error('Please enter a commit message.')
      return
    }
    if (files.length === 0) {
      this.app.toast.error('Please select at least one file.')
      return
    }
    await this._executeCommit(files, message)
  }

  _collectCheckedFiles() {
    const checked = this.app.els.commitFiles
      .querySelectorAll('input[type="checkbox"]:checked')
    return Array.from(checked, cb => cb.value)
  }

  async _executeCommit(files, message) {
    try {
      await this.app.api.gitCommit(this.app.bucket, files, message)
      this.closeDialog()
      await this.loadStatus()
      await this.app.fileTree.loadFiles()
    }
    catch (err) {
      this.app.toast.error(`Commit failed: ${err.message}`)
    }
  }

  // ── Remote actions ──

  /*
   * Push and pull are only offered when the project has a remote URL. The
   * server authenticates on its own behalf (netrc or SSH key), so nothing
   * user-specific is sent along.
   */

  _applyRemoteState() {
    const remote = this.app.currentBucketRemote()
    const title = remote ? `Remote: ${remote}` : 'No remote configured for this project'
    for (const id of ['btn-git-pull', 'btn-git-push']) {
      const btn = document.getElementById(id)
      btn.disabled = !remote
      btn.title = title
    }
  }

  /** Push the current branch to the project's remote. */

  async push() {
    await this._runRemoteAction('Push', () => this.app.api.gitPush(this.app.bucket))
  }

  /** Pull the project's remote into the working tree and refresh the UI. */

  async pull() {
    const result = await this._runRemoteAction(
      'Pull', () => this.app.api.gitPull(this.app.bucket),
    )
    if (!result)
      return
    await this.app.reloadAfterPull(result.changed)
    await this._reloadTab()
  }

  async _runRemoteAction(label, action) {
    if (!this.app.bucket)
      return null
    try {
      const result = await action()
      this.app.toast.success(`${label} succeeded.`)
      return result
    }
    catch (err) {
      this.app.toast.error(`${label} failed: ${err.message}`)
      return null
    }
  }

}
