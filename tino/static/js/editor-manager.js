import { INDEX_NOT_FOUND, SAVE_DEBOUNCE_MS, SINGLE_ITEM } from './constants.js'
import { dropStaleTabs, loadSavedTabs, persistTabs } from './tab-store.js'
import { BinaryPreview } from './editor-binary.js'
import { EditorCollab } from './editor-collab.js'
import { EditorInput } from './editor-input.js'
import { EditorToolbar } from './editor-toolbar.js'
import { writeRoute } from './router.js'

/**
 * Manages file loading, saving, tabs, and binary preview.
 * Delegates low-level textarea interactions to EditorInput.
 */

export class EditorManager {

  /** @param {TinoApp} app - Main application instance. */

  constructor(app) {
    this.app = app
    this.input = new EditorInput(app)
    this.toolbar = new EditorToolbar(app)
    this.binary = new BinaryPreview(app, this.toolbar)
    this.collab = new EditorCollab(app)
  }

  /** Open a file in the editor, loading from cache or API. */

  async openFile(path) {
    if (!this.app.bucket)
      return
    this._flushPendingSave()

    /* Fetch before mutating the editor, then bail if a newer open superseded us. */

    this._openGeneration = (this._openGeneration || 0) + SINGLE_ITEM
    const gen = this._openGeneration
    const loaded = await this._fetchContent(path)
    if (gen !== this._openGeneration)
      return

    /* Unbind old collab before setContent, else yCollab bleeds new text into the old room. */

    this.collab.disconnect()
    this._applyLoaded(path, loaded)
    this._activateTab(path, loaded)
    await this.app.preview.update()
  }

  _flushPendingSave() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer)
      this._saveTimer = null
      this.saveCurrentFile()
    }
  }

  _activateTab(path, loaded) {
    this.app.currentFile = path
    if (this.app.openTabs.indexOf(path) === INDEX_NOT_FOUND)
      this.app.openTabs.push(path)
    this.collab.connect(path)

    /* Restore the remembered caret BEFORE the UI refresh records the cursor;
       otherwise updateCursorPos overwrites the saved position (the freshly loaded
       doc sits at line 1) and _persistOpenState then wipes it. setCursor clamps
       past the file end, so a now-shorter file lands on its last line. */

    const pos = this.app.tabPositions[path]
    if (loaded.kind === 'text' && pos)
      this.app.els.editor.setCursor(pos.line, pos.col)
    this._refreshEditorUi()
    this.app.diagnostics.apply()
    this._persistOpenState(path)
  }

  /**
   * Fetch a file's content WITHOUT mutating the editor, returning a descriptor
   * the caller applies only after confirming the open is still current. A slow
   * fetch for an abandoned tab can therefore never overwrite the active file.
   * @param {string} path - File to load.
   * @returns {Promise<object>} `{kind: 'text'|'binary', content?, modified?}`.
   */

  async _fetchContent(path) {
    if (path in this.app.fileBuffers)
      return { content: this.app.fileBuffers[path], kind: 'text' }
    const data = await this.app.api.readFile(this.app.bucket, path)
    if (data.binary || BinaryPreview.isImage(path))
      return { kind: 'binary' }
    return { content: data.content, kind: 'text', modified: data.modified }
  }

  /** Apply a fetched descriptor to the editor (called only when current). */

  _applyLoaded(path, loaded) {
    if (loaded.kind === 'binary') {
      this.binary.show(path)
      return
    }
    if (!(path in this.app.fileBuffers)) {
      this.app.fileBuffers[path] = loaded.content
      this.app.fileMtimes[path] = loaded.modified
    }
    this._showTextEditor(loaded.content)
  }

  _showTextEditor(content) {
    this._hideOverlays()
    const canEdit = ['editor', 'committer'].includes(this.app.bucketRole)
    this.app.els.editor.setContent(content)
    this.app.els.editor.setEditable(canEdit)
    this.app.els.editor.setHidden(false)
    this.toolbar[canEdit ? 'show' : 'hide']()
  }

  /* Replace the editor with a placeholder when no file is open. Read-only was
     not enough: the toolbar dispatches transactions straight to the view,
     bypassing EditorView.editable. */

  _showEmptyState() {
    this.collab.disconnect()
    this.toolbar.hide()
    this._hideOverlays()
    this.app.els.editor.setContent('')
    this.app.els.editor.setEditable(false)
    this.app.els.editor.setHidden(true)
    this.app.els.editorEmpty.classList.remove('hidden')
  }

  _hideOverlays() {
    this.app.els.binaryPreview.classList.add('hidden')
    this.app.els.binaryPreview.innerHTML = ''
    this.app.els.editorEmpty.classList.add('hidden')
  }

  _refreshEditorUi() {
    this.input.renderTabs()
    this.input.highlightFileItem(this.app.currentFile)
    this.input.updateCursorPos()
    this.input.updateStatusBar()
    this.app.els.editor.focus()
  }

  /** Save the current file to the backend. */

  async saveCurrentFile() {
    const path = this.app.currentFile
    if (!this.app.bucket || !path || BinaryPreview.isImage(path))
      return
    if (!(path in this.app.fileBuffers))
      return
    const content = this.app.fileBuffers[path]
    const result = await this.app.api.saveFile(this.app.bucket, path, content)
    this.app.fileMtimes[path] = result.modified
    this.app.dirty.delete(path)
    await this._refreshAfterSave()
  }

  async _refreshAfterSave() {
    this.input.renderTabs()
    this.input.updateStatusBar()
    await this.app.preview.update()
    await this.app.git.loadStatus()
    await this.app.fileTree.loadFiles()
  }

  /** Close a tab and switch to an adjacent one if needed. */

  closeTab(path) {
    const idx = this.app.openTabs.indexOf(path)
    if (idx === INDEX_NOT_FOUND)
      return
    this.app.openTabs.splice(idx, SINGLE_ITEM)
    delete this.app.fileBuffers[path]
    this.app.dirty.delete(path)
    if (this.app.currentFile === path) {
      this.collab.disconnect()
      this._switchAfterClose(idx)
    }
    this.input.renderTabs()
    this.saveTabs()
  }

  /** Close every open tab and clear the editor. */

  closeAllTabs() {
    if (!this.app.openTabs.length)
      return
    this._flushPendingSave()
    this.resetState()
    this.saveTabs()
    writeRoute(this.app.bucket, null)
  }

  _switchAfterClose(idx) {
    if (this.app.openTabs.length > 0) {
      const next = this.app.openTabs[Math.max(0, idx - SINGLE_ITEM)]
      this.openFile(next)
      return
    }
    this._clearEditor()
  }

  _clearEditor() {
    this.app.currentFile = null
    this._showEmptyState()
    this.input.updateStatusBar()
    writeRoute(this.app.bucket, null)
  }

  /** Persist open tabs to localStorage for the current bucket. */

  saveTabs() {
    if (this.app.bucket)
      persistTabs(this.app.bucket, this.app.openTabs, this.app.tabPositions)
  }

  /** Restore saved tabs from localStorage, filtering stale paths. */

  restoreTabs() {
    if (!this.app.bucket)
      return
    const { tabs, positions } =
      loadSavedTabs(this.app.bucket, this.app.fileTree.filePaths)
    if (tabs.length > 0) {
      this.app.openTabs = tabs
      this.app.tabPositions = positions
      this.input.renderTabs()
    }
  }

  _persistOpenState(path) {
    writeRoute(this.app.bucket, path)
    this.saveTabs()
  }

  /** Close tabs for files that no longer exist on disk. */

  reconcileTabs(existingPaths) {
    if (this.app.pinnedPreview && !existingPaths.has(this.app.pinnedPreview))
      this.app.pinnedPreview = null
    if (!dropStaleTabs(this.app, existingPaths))
      return
    if (this.app.openTabs.includes(this.app.currentFile))
      this.input.renderTabs()
    else
      this._switchAfterClose(0)
    this.saveTabs()
  }

  debounceSave() {
    const cfg = this.app.config && this.app.config.saveDebounceMs
    clearTimeout(this._saveTimer)
    this._saveTimer =
      setTimeout(() => this.saveCurrentFile(), cfg || SAVE_DEBOUNCE_MS)
  }

  /* Reset the editor when switching buckets or closing every tab. The preview
     goes with it: its pages and diagnostics belong to what is being left. */

  resetState() {
    this.app.pinnedPreview = null
    this._clearOpenState()
    this._showEmptyState()
    this.app.els.tabBar.innerHTML = ''
    this.app.preview.reset()
  }

  _clearOpenState() {
    this.app.openTabs = []
    this.app.tabPositions = {}
    this.app.currentFile = null
    this.app.fileBuffers = {}
    this.app.fileMtimes = {}
    this.app.dirty.clear()
  }

  /** Bind editor events (delegates to EditorInput). */

  bindEditor() {
    this.input.bind()
    this.toolbar.bind()
  }

}
