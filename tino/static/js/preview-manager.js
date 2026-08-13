import { SINGLE_ITEM, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, escapeHtml } from './constants.js'
import { PreviewPages } from './preview-pages.js'

/**
 * Manages preview rendering and zoom controls. The page elements themselves,
 * and the lazy compilation of long documents, live in {@link PreviewPages}.
 *
 * A failed compilation never clears the pane: the last successful render stays
 * on screen (dimmed) while the errors are reported in the editor and in the
 * banner above the preview, so a typo mid-edit does not make a long document
 * disappear and recompile from scratch.
 */

export class PreviewManager {

  /** @param {TinoApp} app - Main application instance. */

  constructor(app) {
    this.app = app
    this.pages = new PreviewPages(app, () => this.compile())
    this._renderGen = 0
  }

  /** The file the preview renders: the pinned file, else the active file. */

  get target() {
    return this.app.pinnedPreview || this.app.currentFile
  }

  /** The rendered page elements currently in the preview pane. */

  get pageElements() {
    return this.pages.elements
  }

  /**
   * Whether the rendered document is horizontal (landscape), i.e. laid out as
   * slides. Measured on the first page's SVG viewBox.
   */

  get isHorizontal() {
    const svg = this.app.els.previewPage.querySelector('.preview-svg-page svg')
    if (!svg)
      return false
    const { baseVal } = svg.viewBox
    return baseVal.width > baseVal.height
  }

  /**
   * Index of the page the user is currently looking at: the one whose top edge
   * sits closest to the top of the preview viewport.
   */

  currentPageIndex() {
    const { top } = this.app.els.previewViewport.getBoundingClientRect()
    const distances = this.pageElements.map(
      page => Math.abs(page.getBoundingClientRect().top - top),
    )
    if (distances.length === 0)
      return 0
    return distances.indexOf(Math.min(...distances))
  }

  /**
   * Compile the preview target (the pinned file when one is pinned, otherwise
   * the current file) and render its SVG pages in the preview pane.
   */

  async update() {
    const isTyp = this.target && this.target.endsWith('.typ')
    this._renderPinControls()
    document.getElementById('btn-pdf')
      .classList.toggle('hidden', !isTyp)
    if (isTyp)
      await this.compile()
    else
      this.clear()
  }

  /** Pin the preview to the current .typ file, or unpin if already pinned. */

  togglePin() {
    if (this.app.pinnedPreview)
      this.app.pinnedPreview = null
    else if (this.app.currentFile && this.app.currentFile.endsWith('.typ'))
      this.app.pinnedPreview = this.app.currentFile
    this.update()
  }

  /** Sync the pin button and pinned-file label with the current pin state. */

  _renderPinControls() {
    const pinned = this.app.pinnedPreview
    const cur = this.app.currentFile
    const canPin = Boolean(pinned) || Boolean(cur && cur.endsWith('.typ'))
    const btn = document.getElementById('btn-pin-preview')
    btn.classList.toggle('hidden', !canPin)
    btn.classList.toggle('active', Boolean(pinned))
    btn.title = PreviewManager._pinTitle(pinned)
    PreviewManager._renderPinLabel(pinned)
  }

  static _pinTitle(pinned) {
    if (pinned)
      return `Preview pinned to ${pinned} — click to unpin`
    return 'Pin preview to this file'
  }

  static _renderPinLabel(pinned) {
    const label = document.getElementById('preview-pin-label')
    label.classList.toggle('hidden', !pinned)
    if (pinned) {
      // Show only the filename; the full path lives in the hover tooltip.
      label.textContent = pinned.split('/').pop()
      label.title = pinned
    }
  }

  /** Show a placeholder when the current file has no preview. */

  clear() {
    this._discard()
    this.app.els.previewPage.innerHTML =
      '<p class="preview-empty">No preview available for this file.</p>'
    this.app.presentation.syncControls()
  }

  /**
   * Drop every trace of the current preview. Called when the workspace changes
   * underneath it (switching projects, closing all tabs) so neither pages nor
   * diagnostics of the previous project survive into the next one.
   */

  reset() {
    this._discard()
    this.app.diagnostics.clear()
    this.app.els.previewPage.innerHTML =
      '<p class="preview-empty">Open a file to see the preview.</p>'
    this.app.presentation.syncControls()
  }

  _discard() {
    this._renderGen += SINGLE_ITEM
    this.pages.reset()
    this.app.els.previewPage.classList.remove('preview-outdated')
  }

  /** Compile the current .typ file via the API and render SVG pages. */

  async compile() {
    if (!this.app.bucket || !this.target)
      return
    this._renderGen += SINGLE_ITEM
    const gen = this._renderGen
    const path = this.target
    const result = await this._runCompile(path)
    if (!result || gen !== this._renderGen)
      return
    this.app.diagnostics.set(result.diagnostics || [])
    if (result.ok)
      this._render(path, result)
    else
      this._markOutdated()
    this.app.presentation.syncControls()
  }

  /* Transport failures (offline, 404 for a file that vanished) are the only
     ones that reach the preview as an exception — a document that does not
     compile comes back as a regular response with diagnostics. */

  async _runCompile(path) {
    try {
      return await this.app.api.compile(this.app.bucket, path)
    }
    catch (err) {
      if (!this.pages.doc) {
        this.app.els.previewPage.innerHTML =
          `<pre class="preview-error">${escapeHtml(err.message)}</pre>`
      }
      this._markOutdated()
      return null
    }
  }

  _markOutdated() {
    this.app.els.previewPage.classList.add('preview-outdated')
  }

  /** Render a successful compile result, dropping the outdated marker. */

  _render(path, result) {
    this.app.els.previewPage.classList.remove('preview-outdated')
    this.pages.render(path, result)
  }

  /** Render every page of the document, for presentation and speaker mode. */

  ensureAllPages() {
    return this.pages.ensureAll()
  }

  /** Download the current .typ file as a compiled PDF. */

  downloadPdf() {
    if (!this.app.bucket || !this.target)
      return
    const slug = encodeURIComponent(this.app.bucket)
    const path = this.target
    const url = `/api/buckets/${slug}/compile/pdf/${path}`
    const link = document.createElement('a')
    link.href = url
    link.download = ''
    link.click()
  }

  /** Bind zoom in/out and PDF download buttons. */

  bindZoom() {
    const {previewPage, zoomLabel} = this.app.els

    document.getElementById('btn-zoom-in')
      .addEventListener('click', () => {
        if (this.app.zoom < ZOOM_MAX) {
          this.app.zoom += ZOOM_STEP
          previewPage.style.transform =
            `scale(${this.app.zoom / 100})`
          zoomLabel.textContent = `${this.app.zoom}%`
        }
      })

    document.getElementById('btn-zoom-out')
      .addEventListener('click', () => {
        if (this.app.zoom > ZOOM_MIN) {
          this.app.zoom -= ZOOM_STEP
          previewPage.style.transform =
            `scale(${this.app.zoom / 100})`
          zoomLabel.textContent = `${this.app.zoom}%`
        }
      })

    document.getElementById('btn-pdf')
      .addEventListener('click', () => this.downloadPdf())

    document.getElementById('btn-pin-preview')
      .addEventListener('click', () => this.togglePin())
  }

}
