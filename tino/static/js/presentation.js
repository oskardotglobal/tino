import { renderSlide, slideAction } from './slide-view.js'
import { SINGLE_ITEM } from './constants.js'

/**
 * Fullscreen presentation mode for slide decks.
 *
 * The controls only appear for documents whose pages are horizontal
 * (landscape), which is how Typst slide templates lay their pages out. Slides
 * are the already-compiled preview SVGs, so starting a presentation needs no
 * extra compilation round-trip.
 *
 * Advance with a click, space or the right arrow; go back with the left arrow;
 * leave with Escape (which also ends the browser fullscreen session).
 */

export class PresentationMode {

  /** @param {TinoApp} app - Main application instance. */

  constructor(app) {
    this.app = app
    this._group = document.getElementById('present-group')
    this._menu = document.getElementById('present-menu')
    this._menuBtn = document.getElementById('btn-present-menu')
    this._overlay = document.getElementById('presentation')
    this._slide = document.getElementById('presentation-slide')
    this._counter = document.getElementById('presentation-counter')
    this._slides = []
    this._index = 0
    this._active = false
  }

  /** Bind the toolbar controls, the slide navigation and fullscreen exit. */

  bind() {
    document.getElementById('btn-present')
      .addEventListener('click', () => this.start(0))
    this._menuBtn.addEventListener('click', evt => {
      evt.stopPropagation()
      this._toggleMenu()
    })
    this._menu.addEventListener('click', evt => this._onMenuClick(evt))
    document.addEventListener('click', () => this._closeMenu())
    this._overlay.addEventListener('click', () => this.next())
    document.addEventListener('keydown', evt => this._onKey(evt))
    document.addEventListener(
      'fullscreenchange', () => this._onFullscreenChange(),
    )
  }

  /**
   * Show the presentation controls only when the preview holds a horizontal
   * (slide-format) document. Called after every preview render.
   */

  syncControls() {
    const shown = this.app.preview.isHorizontal
    this._group.classList.toggle('hidden', !shown)
    if (!shown)
      this._closeMenu()
  }

  /**
   * Enter fullscreen presentation mode.
   * @param {number} index - Zero-based slide to start from.
   */

  start(index) {
    const pages = this.app.preview.pageElements
    if (pages.length === 0)
      return
    this._slides = pages.map(page => page.innerHTML)
    this._active = true
    this._overlay.classList.remove('hidden')
    this._show(index)
    this._enterFullscreen()
  }

  /** Leave presentation mode and return to the editor. */

  stop() {
    if (!this._active)
      return
    this._active = false
    this._overlay.classList.add('hidden')
    this._slide.replaceChildren()
    this._slides = []
    if (document.fullscreenElement)
      document.exitFullscreen()
  }

  /** Advance to the next slide, staying put on the last one. */

  next() {
    if (this._active)
      this._show(this._index + SINGLE_ITEM)
  }

  /** Go back to the previous slide, staying put on the first one. */

  prev() {
    if (this._active)
      this._show(this._index - SINGLE_ITEM)
  }

  // ── Internal ──

  /**
   * Render a slide, clamping the index to the deck so that clicking past the
   * end holds the last slide instead of leaving the presentation.
   */

  _show(index) {
    const total = this._slides.length
    const last = total - SINGLE_ITEM
    this._index = Math.min(Math.max(index, 0), last)
    renderSlide(this._slide, this._slides[this._index])
    this._counter.textContent = `${this._index + SINGLE_ITEM} / ${total}`
  }

  /**
   * Request browser fullscreen. Escape then ends the fullscreen session, which
   * `fullscreenchange` turns into leaving presentation mode. A rejected request
   * (some browsers refuse it outside a trusted gesture) leaves the overlay in
   * place, where the Escape key handler still applies.
   */

  _enterFullscreen() {
    if (document.fullscreenElement)
      return
    const request = this._overlay.requestFullscreen()
    if (request)
      request.catch(err => this.app.toast.error(err.message))
  }

  _onFullscreenChange() {
    if (this._active && !document.fullscreenElement)
      this.stop()
  }

  _onKey(evt) {
    if (!this._active)
      return
    const action = slideAction(evt.key)
    if (!action)
      return
    this._run(action)
    evt.preventDefault()
  }

  _run(action) {
    if (action === 'next')
      this.next()
    else if (action === 'prev')
      this.prev()
    else
      this.stop()
  }

  _onMenuClick(evt) {
    const item = evt.target.closest('.present-item')
    if (!item)
      return
    this._closeMenu()
    const { action } = item.dataset
    if (action === 'speaker')
      this.app.speaker.start()
    else if (action === 'current')
      this.start(this.app.preview.currentPageIndex())
    else
      this.start(0)
  }

  _toggleMenu() {
    const willOpen = this._menu.classList.contains('hidden')
    this._menu.classList.toggle('hidden', !willOpen)
    this._menuBtn.setAttribute('aria-expanded', String(willOpen))
  }

  _closeMenu() {
    if (this._menu.classList.contains('hidden'))
      return
    this._menu.classList.add('hidden')
    this._menuBtn.setAttribute('aria-expanded', 'false')
  }

}
