import { applyRoleVisibility, loadUser } from './app-session.js'
import { bindLogoRepoLink, setLogoVersionTooltip } from './app-logo.js'
import { readRoute, writeRoute } from './router.js'
import { ApiKeyManager } from './api-key-manager.js'
import { BucketEvents } from './bucket-events.js'
import { CodeMirrorEditor } from './codemirror-editor.js'
import { DiagnosticsManager } from './diagnostics.js'
import { EditorManager } from './editor-manager.js'
import { EditorTooling } from './editor-tooling.js'
import { FileTree } from './file-tree.js'
import { FontManager } from './font-manager.js'
import { GitManager } from './git-manager.js'
import { PanelResize } from './panel-resize.js'
import { PresentationMode } from './presentation.js'
import { PreviewManager } from './preview-manager.js'
import { ProfileModal } from './profile-modal.js'
import { SearchModal } from './search-modal.js'
import { SettingsModal } from './settings-modal.js'
import { SpeakerMode } from './speaker-mode.js'
import { TemplatePicker } from './template-picker.js'
import { TinoAPI } from './api.js'
import { Toast } from './toast.js'
import { bindToolbar } from './app-bindings.js'

class TinoApp {

  constructor() {
    this.api = new TinoAPI()
    this.dirty = new Set()
    this._resetState()
    this._buildElementRefs()
    this._initManagers()
  }

  _resetState() {
    this.bucket = null
    this.bucketRole = null
    this.currentFile = null
    this.pinnedPreview = null
    this.isAdmin = false
    Object.assign(this, { openTabs: [], tabPositions: {} })
    this.fileBuffers = {}
    this.fileMtimes = {}
    this.gitStatuses = {}
    this.zoom = 100
  }

  _buildElementRefs() {
    this.els = {
      binaryPreview: document.getElementById('binary-preview'),
      bucketBtn: document.getElementById('bucket-btn'),
      bucketDialogTitle: document.getElementById('bucket-dialog-title'),
      bucketFormDesc: document.getElementById('bucket-form-desc'),
      bucketFormName: document.getElementById('bucket-form-name'),
      bucketFormRemote: document.getElementById('bucket-form-remote'),
      bucketFormSlug: document.getElementById('bucket-form-slug'),
      bucketLabel: document.getElementById('bucket-label'),
      bucketPicker: document.getElementById('bucket-picker'),
      bucketPickerList: document.getElementById('bucket-picker-list'),
      commitFiles: document.getElementById('commit-files'),
      commitMessage: document.getElementById('commit-message'),
      cursorPos: document.getElementById('cursor-pos'),
      editor: new CodeMirrorEditor(document.getElementById('editor'), {
        onCodeAction: () => this.tooling.actions.open(),
        onCursor: () => this.editor.input.updateCursorPos(),
        onFormat: () => this.tooling.format.run(),
        statusHost: document.getElementById('keymap-status'),
      }),
      editorEmpty: document.getElementById('editor-empty'),
      fileSearch: document.getElementById('file-search'),
      fileTree: document.getElementById('file-tree'),
      gitDialog: document.getElementById('git-dialog'),
      logo: document.getElementById('logo'),
      previewPage: document.getElementById('preview-page'),
      previewViewport: document.getElementById('preview-viewport'),
      statusBarModified: document.getElementById('status-bar-modified'),
      tabBar: document.getElementById('tab-bar'),
      userLabel: document.getElementById('user-label'),
      zoomLabel: document.getElementById('zoom-level'),
    }
  }

  _initManagers() {
    this.toast = new Toast()
    this.bucketEvents = new BucketEvents(
      () => this._onFilesChanged(),
    )
    this.editor = new EditorManager(this)
    this.fileTree = new FileTree(this)
    this.git = new GitManager(this)
    this.panelResize = new PanelResize()
    this.tooling = new EditorTooling(this)
    this._initPreview()
    this._initDialogs()
  }

  /* The preview, the compiler diagnostics it reports and the two slide modes
     projecting its pages: one group, built together. */

  _initPreview() {
    this.diagnostics = new DiagnosticsManager(this)
    this.preview = new PreviewManager(this)
    this.presentation = new PresentationMode(this)
    this.speaker = new SpeakerMode(this)
  }

  _initDialogs() {
    this.fontManager = new FontManager(this)
    this.apiKeyManager = new ApiKeyManager(this)
    this.templatePicker = new TemplatePicker(this)
    this.searchModal = new SearchModal(this)
    this.settingsModal = new SettingsModal(this)
    this.profileModal = new ProfileModal(this)
  }

  /** Initialize the app: bind events and load buckets. */

  async init() {
    const route = readRoute()
    this._bindAll()
    applyRoleVisibility(this)
    this.config = await this.api.config()
    this.tooling.bind()
    setLogoVersionTooltip(this)
    bindLogoRepoLink(this)
    await this.reloadUser()
    await this.fileTree.loadBuckets()
    await this._applyRoute(route, true)
  }

  _bindAll() {
    this.toast.bind()
    bindToolbar(this)
    this._bindWindowEvents()
    this.editor.bindEditor()
    this._bindFileTree()
    this._bindDialogs()
    this.preview.bindZoom()
    this.presentation.bind()
    this.speaker.bind()
  }

  _bindDialogs() {
    this.fontManager.bind()
    this.apiKeyManager.bind()
    this.templatePicker.bind()
    this.searchModal.bind()
    this.settingsModal.bind()
    this.profileModal.bind()
  }

  _bindFileTree() {
    this.fileTree.bindTreeClicks()
    this.fileTree.bindTreeDrag()
    this.fileTree.bindUploadDrop()
    this.fileTree.bindBucketPicker()
    this.fileTree.bindSearch()
    this.fileTree.bindNewMenu()
  }

  _bindWindowEvents() {
    window.addEventListener('unhandledrejection', evt => {
      const msg = evt.reason && evt.reason.message
      if (msg)
        this.toast.error(msg)
    })
    window.addEventListener(
      'hashchange', () => this._applyRoute(readRoute(), false),
    )
    window.addEventListener('beforeunload', () => {
      this.editor.saveTabs()
    })
  }

  /** Reload the current user and refresh their toolbar chip. */

  reloadUser() {
    return loadUser(this)
  }

  /**
   * Switch to a different bucket: reset editor state, load git status and files.
   * @param {string} slug - Bucket identifier.
   */

  async selectBucket(slug, role, restoreTabs = true) {
    if (!slug)
      return
    this.editor.saveTabs()
    Object.assign(this, { bucket: slug, bucketRole: role || null })
    this.editor.resetState()
    applyRoleVisibility(this)
    this.bucketEvents.connect(slug)
    writeRoute(slug, null)
    await this.git.loadStatus()
    await this.fileTree.loadFiles()
    if (restoreTabs)
      await this._restoreBucketTabs()
  }

  /** Reopen the tabs saved for the active bucket and show the first one. */

  async _restoreBucketTabs() {
    this.editor.restoreTabs()
    if (this.openTabs.length > 0)
      await this.editor.openFile(this.openTabs[0])
  }

  /** Resolve a bucket slug to its display name (the name if set, else slug). */

  bucketDisplayName(slug) {
    const list = this.fileTree._buckets || []
    const bkt = list.find(item => item.slug === slug)
    return (bkt && bkt.name) || slug
  }

  /** Toolbar label for the active bucket, or a placeholder when none selected. */

  currentBucketLabel() {
    return this.bucket ? this.bucketDisplayName(this.bucket) : 'Select project...'
  }

  /** Remote URL configured for the active bucket, or an empty string. */

  currentBucketRemote() {
    const list = this.fileTree._buckets || []
    const bkt = list.find(item => item.slug === this.bucket)
    return (bkt && bkt.remote) || ''
  }

  /**
   * Refresh the workspace after a pull replaced files on disk.
   * @param {string[]} changed - Paths updated by the pull.
   */

  async reloadAfterPull(changed) {
    changed.forEach(path => {
      delete this.fileBuffers[path]
      this.dirty.delete(path)
    })
    await this._onFilesChanged()
    if (this.currentFile && changed.includes(this.currentFile))
      await this.editor.openFile(this.currentFile)
  }

  /** Return to the no-bucket state, e.g. after deleting the active bucket. */

  clearBucket() {
    this.bucketEvents.disconnect()
    this.bucket = null
    this.bucketRole = null
    this.gitStatuses = {}
    this.editor.resetState()
    applyRoleVisibility(this)
    this.fileTree.clear()
    this.preview.update()
    writeRoute(null, null)
  }

  async _applyRoute(route, restoreTabs) {
    if (!route.slug)
      return
    if (route.slug !== this.bucket) {
      const bkt = this.fileTree._buckets.find(
        item => item.slug === route.slug,
      )
      if (!bkt)
        return
      this.els.bucketLabel.textContent = bkt.name || bkt.slug
      await this.selectBucket(bkt.slug, bkt.role, restoreTabs)
    }
    const target =
      route.path || (restoreTabs && this.openTabs[0]) || null
    if (target && target !== this.currentFile)
      await this.editor.openFile(target)
  }

  async _onFilesChanged() {
    await this.git.loadStatus()
    await this.fileTree.loadFiles()
    this.editor.reconcileTabs(this.fileTree.filePaths)
  }

}

document.addEventListener('DOMContentLoaded', () => {
  const app = new TinoApp()
  app.init()
})
