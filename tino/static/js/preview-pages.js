import { PAGE_PREFETCH_MARGIN, SINGLE_ITEM } from './constants.js'

/**
 * The page elements of the preview pane, and the lazy loading behind them.
 *
 * Short documents arrive fully compiled and are simply written into the pane.
 * Long ones (the backend decides, see `TINO_PAGED_THRESHOLD`) ship only their
 * first page plus a page count: one empty element per page is laid out, and
 * each page's SVG is compiled and fetched shortly before it scrolls into view.
 * The backend caches those pages, so scrolling back and forth costs nothing.
 *
 * Between revisions the elements are reused whenever the document keeps its
 * shape. That is what keeps the scroll position stable — and what lets the
 * previous revision stay on screen while the new one streams in page by page.
 */

export class PreviewPages {

  /**
   * @param {TinoApp} app - Main application instance.
   * @param {Function} onStale - Called when a page comes back for a revision
   *   other than the one on screen, i.e. the document changed mid-flight.
   */

  constructor(app, onStale) {
    this.app = app
    this.doc = null
    this._onStale = onStale
    this._observer = null
  }

  /** The page elements currently in the preview pane. */

  get elements() {
    return [...this.app.els.previewPage.querySelectorAll('.preview-svg-page')]
  }

  /** Forget the rendered document, e.g. when the preview is cleared. */

  reset() {
    this.doc = null
    this._stopObserving()
  }

  /**
   * Apply a compile result to the pane.
   * @param {string} path - The file that was compiled.
   * @param {object} result - The API's compile response.
   */

  render(path, result) {
    const reusable = this.doc && this.doc.path === path && this.doc.count === result.count
    this.doc = {
      count: result.count,
      fingerprint: result.fingerprint,
      paged: result.paged,
      path,
    }
    if (!reusable)
      this._build(result.count)
    Object.entries(result.pages || {}).forEach(
      ([number, svg]) => this._fill(this._element(Number(number)), svg),
    )
    if (result.paged)
      this._loadVisible()
  }

  /**
   * Make sure every page is rendered. Presentation and speaker mode project the
   * compiled SVGs, so they cannot start on a half-loaded deck.
   */

  async ensureAll() {
    if (!this.doc || !this.doc.paged)
      return
    for (const page of this._outdated()) {
      // eslint-disable-next-line no-await-in-loop -- one page compiles at a time
      await this.load(page)
    }
  }

  // ── Internal ──

  /** Lay out one element per page, empty until its SVG arrives. */

  _build(count) {
    this._stopObserving()
    const fragment = document.createDocumentFragment()
    for (let number = SINGLE_ITEM; number <= count; number += SINGLE_ITEM) {
      const page = document.createElement('div')
      page.className = 'preview-svg-page preview-svg-page-pending'
      page.dataset.page = String(number)
      fragment.appendChild(page)
    }
    this.app.els.previewPage.replaceChildren(fragment)
    this._observe()
  }

  _element(number) {
    return this.app.els.previewPage
      .querySelector(`.preview-svg-page[data-page="${number}"]`)
  }

  _fill(page, svg) {
    if (!page)
      return
    page.innerHTML = svg
    page.dataset.fingerprint = this.doc.fingerprint
    page.classList.remove('preview-svg-page-pending')
  }

  /** Pages whose SVG is missing or belongs to an older revision. */

  _outdated() {
    return this.elements.filter(
      page => page.dataset.fingerprint !== this.doc.fingerprint,
    )
  }

  /* Pages are fetched shortly before they scroll into view. The observer only
     fires when a page enters the viewport, so pages that are already visible
     when a new revision lands are requested explicitly. */

  _observe() {
    this._observer = new IntersectionObserver(entries => {
      entries
        .filter(entry => entry.isIntersecting)
        .forEach(entry => this.load(entry.target))
    }, {
      root: this.app.els.previewViewport,
      rootMargin: PAGE_PREFETCH_MARGIN,
    })
    this.elements.forEach(page => this._observer.observe(page))
  }

  _stopObserving() {
    if (this._observer)
      this._observer.disconnect()
    this._observer = null
  }

  _loadVisible() {
    const { bottom, top } = this.app.els.previewViewport.getBoundingClientRect()
    this._outdated()
      .filter(page => {
        const box = page.getBoundingClientRect()
        return box.bottom >= top && box.top <= bottom
      })
      .forEach(page => this.load(page))
  }

  /** Fetch one page of a paged document, unless it is current or in flight. */

  async load(page) {
    const { doc } = this
    if (!doc || !doc.paged || page.dataset.loading)
      return
    if (page.dataset.fingerprint === doc.fingerprint)
      return
    page.dataset.loading = 'true'
    try {
      const result = await this.app.api.compilePage(
        this.app.bucket, doc.path, Number(page.dataset.page),
      )
      this._apply(doc, page, result)
    }
    finally {
      delete page.dataset.loading
    }
  }

  /* A page that comes back for a different revision than the one on screen
     means the document changed underneath us, which is resolved by recompiling
     instead of mixing revisions into one render. */

  _apply(doc, page, result) {
    if (this.doc !== doc)
      return
    if (!result.ok || result.fingerprint !== doc.fingerprint) {
      this._onStale()
      return
    }
    this._fill(page, result.svg)
  }

}
