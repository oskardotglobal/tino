import { renderSlide, slideAction } from './slide-view.js'
import { SINGLE_ITEM } from './constants.js'
import { Stopwatch } from './stopwatch.js'

/**
 * Speaker mode: the audience-facing deck runs in a popup window while the
 * editor window is replaced by the speaker view — current slide, a preview of
 * the next one, and a stopwatch that starts with the presentation.
 *
 * Both windows share one slide index, so the same inputs (click, space, arrow
 * keys) advance the deck no matter which window has focus. The popup is a
 * same-origin blank document written from here, which keeps the audience view
 * free of editor chrome without a second HTML file.
 */

const POPUP_FEATURES = 'popup=yes,width=960,height=540'

const POPUP_NAME = 'tino-presentation'

/** How often the popup is checked for having been closed by the user. */

const POPUP_POLL_MS = 500

const POPUP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Presentation</title>
<style>
  html, body { margin: 0; height: 100%; background: #000000; }
  body { display: flex; align-items: center; justify-content: center;
         cursor: pointer; }
  #slide { height: 100%; width: auto; max-width: 100%; background: #ffffff; }
  #slide svg { display: block; width: 100%; height: 100%; }
  #fs-btn { position: fixed; top: 12px; right: 12px; padding: 4px 8px;
            font-size: 18px; line-height: 1; color: #ffffff; opacity: 0.25;
            background: rgba(0, 0, 0, 0.6); border: 1px solid #ffffff;
            border-radius: 4px; cursor: pointer; transition: opacity 0.15s; }
  #fs-btn:hover { opacity: 1; }
</style>
</head>
<body>
<div id="slide"></div>
<button id="fs-btn" title="Fullscreen" type="button">&#9974;</button>
</body>
</html>`

export class SpeakerMode {

  /** @param {TinoApp} app - Main application instance. */

  constructor(app) {
    this.app = app
    this.clock = new Stopwatch(
      document.getElementById('speaker-time'),
      document.getElementById('speaker-laps'),
    )
    this._buildElementRefs()
    Object.assign(this, {_active: false, _index: 0, _slides: []})
    Object.assign(this, {_popup: null, _popupSlide: null, _watch: null})
  }

  _buildElementRefs() {
    this._view = document.getElementById('speaker')
    this._current = document.getElementById('speaker-current')
    this._next = document.getElementById('speaker-next')
    this._progress = document.getElementById('speaker-progress')
    this._pauseBtn = document.getElementById('btn-speaker-pause')
  }

  /** Bind the stopwatch controls and the speaker-view navigation. */

  bind() {
    this._pauseBtn.addEventListener('click', () => this._togglePause())
    document.getElementById('btn-speaker-lap')
      .addEventListener('click', () => this._lap())
    document.getElementById('btn-speaker-reset')
      .addEventListener('click', () => this.clock.reset())
    this._view.addEventListener('click', evt => this._onViewClick(evt))
    document.addEventListener('keydown', evt => this._onKey(evt))
  }

  /** Open the audience popup and switch the editor to the speaker view. */

  start() {
    const pages = this.app.preview.pageElements
    if (pages.length === 0)
      return
    const popup = this._openPopup()
    if (!popup)
      return
    this._slides = pages.map(page => page.innerHTML)
    this._popup = popup
    this._active = true
    this._enterView()
  }

  /** Show the speaker view, render the first slide and start the clock. */

  _enterView() {
    this._view.classList.remove('hidden')
    this._show(0)
    this.clock.reset()
    this.clock.start()
    this._syncPauseBtn()
    this._watch = setInterval(() => this._checkPopup(), POPUP_POLL_MS)
  }

  /** Leave speaker mode: close the popup and restore the editor. */

  stop() {
    if (!this._active)
      return
    this._active = false
    clearInterval(this._watch)
    this._watch = null
    this._closePopup()
    this._view.classList.add('hidden')
    this._current.replaceChildren()
    this._next.replaceChildren()
    this._slides = []
    this.clock.clear()
  }

  /** Advance both windows to the next slide, staying put on the last one. */

  next() {
    if (this._active)
      this._show(this._index + SINGLE_ITEM)
  }

  /** Move both windows back a slide, staying put on the first one. */

  prev() {
    if (this._active)
      this._show(this._index - SINGLE_ITEM)
  }

  // ── Internal ──

  /**
   * Render a slide into the speaker view and the popup, clamping the index so
   * navigating past either end holds the outermost slide.
   */

  _show(index) {
    const total = this._slides.length
    this._index = Math.min(Math.max(index, 0), total - SINGLE_ITEM)
    renderSlide(this._current, this._slides[this._index])
    this._renderNext()
    if (this._popupSlide)
      renderSlide(this._popupSlide, this._slides[this._index])
    this._progress.textContent = `${this._index + SINGLE_ITEM} / ${total}`
  }

  /** Show the upcoming slide, or an end-of-deck note on the last one. */

  _renderNext() {
    const upcoming = this._slides[this._index + SINGLE_ITEM]
    if (upcoming) {
      renderSlide(this._next, upcoming)
      return
    }
    this._next.style.aspectRatio = ''
    this._next.innerHTML = '<p class="speaker-end">End of deck</p>'
  }

  /** Record a lap for the slide on screen. */

  _lap() {
    this.clock.lap(`Slide ${this._index + SINGLE_ITEM}`)
  }

  _togglePause() {
    this.clock.toggle()
    this._syncPauseBtn()
  }

  _syncPauseBtn() {
    const { running } = this.clock
    this._pauseBtn.title = running ? 'Pause' : 'Resume'
    this._pauseBtn.innerHTML =
      `<span class="material-symbols-outlined">${
        running ? 'pause' : 'play_arrow'}</span>`
  }

  /**
   * Open the audience window and write the presentation document into it.
   * Returns null when the browser blocked the popup, in which case speaker
   * mode does not start.
   */

  _openPopup() {
    const win = window.open('', POPUP_NAME, POPUP_FEATURES)
    if (!win) {
      this.app.toast.error(
        'Allow pop-ups for this site to use speaker mode.',
      )
      return null
    }
    win.document.write(POPUP_HTML)
    win.document.close()
    this._popupSlide = win.document.getElementById('slide')
    this._bindPopup(win.document)
    return win
  }

  /** Wire slide navigation and the fullscreen toggle inside the popup. */

  _bindPopup(doc) {
    doc.addEventListener('keydown', evt => this._onKey(evt))
    doc.addEventListener('click', () => this.next())
    doc.getElementById('fs-btn').addEventListener('click', evt => {
      // Without this the toggle click would also advance the deck.
      evt.stopPropagation()
      this._togglePopupFullscreen(doc)
    })
  }

  /**
   * Put the audience window into fullscreen, or leave it again. The popup owns
   * its own fullscreen session, so the editor window keeps the speaker view.
   */

  _togglePopupFullscreen(doc) {
    if (doc.fullscreenElement) {
      doc.exitFullscreen()
      return
    }
    const request = doc.documentElement.requestFullscreen()
    if (request)
      request.catch(err => this.app.toast.error(err.message))
  }

  _closePopup() {
    if (this._popup && !this._popup.closed)
      this._popup.close()
    this._popup = null
    this._popupSlide = null
  }

  /** End speaker mode when the presenter closes the audience window. */

  _checkPopup() {
    if (this._popup && this._popup.closed)
      this.stop()
  }

  _onViewClick(evt) {
    // Clicks on the stopwatch controls drive the clock, not the deck.
    if (!evt.target.closest('.speaker-clock'))
      this.next()
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

}
