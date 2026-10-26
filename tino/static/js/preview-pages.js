import { PAGE_BATCH_SIZE, PAGE_PREFETCH_MARGIN, SINGLE_ITEM } from './constants.js'

/**
 * The page elements of the preview pane, and the lazy loading behind them.
 *
 * Short documents arrive fully compiled and are simply written into the pane.
 * Long ones (the backend decides, see `TINO_PAGED_THRESHOLD`) ship only their
 * first page plus a page count: one empty element per page is laid out, and
 * the pages' SVGs are compiled and fetched in batches shortly before they
 * scroll into view. The backend caches those pages, so scrolling back and
 * forth costs nothing. Opening a document asks for every page up front (see
 * {@link PreviewManager}), so only later revisions load lazily.
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
    await this.load(this._outdated())
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
      this.load(entries
        .filter(entry => entry.isIntersecting)
        .map(entry => entry.target))
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
    this.load(this._outdated().filter(page => {
      const box = page.getBoundingClientRect()
      return box.bottom >= top && box.top <= bottom
    }))
  }

  /**
   * Fetch pages of a paged document in batches of {@link PAGE_BATCH_SIZE},
   * skipping those that are current or already in flight.
   * @param {HTMLElement[]} pages - Page elements, in document order.
   */

  async load(pages) {
    const { doc } = this
    if (!doc || !doc.paged)
      return
    const wanted = pages.filter(
      page => !page.dataset.loading && page.dataset.fingerprint !== doc.fingerprint,
    )
    wanted.forEach(page => {
      page.dataset.loading = 'true'
    })
    try {
      for (let start = 0; start < wanted.length; start += PAGE_BATCH_SIZE) {
        const batch = wanted.slice(start, start + PAGE_BATCH_SIZE)
        // eslint-disable-next-line no-await-in-loop -- one batch compiles at a time
        const result = await this.app.api.compilePages(
          this.app.bucket, doc.path, batch.map(page => Number(page.dataset.page)),
        )
        if (!this._apply(doc, batch, result))
          return
      }
    }
    finally {
      wanted.forEach(page => {
        delete page.dataset.loading
      })
    }
  }

  /* Pages that come back for a different revision than the one on screen
     mean the document changed underneath us, which is resolved by recompiling
     instead of mixing revisions into one render. Returns whether the batch
     was applied, i.e. whether further batches are still worth fetching. */

  _apply(doc, batch, result) {
    if (this.doc !== doc)
      return false
    if (!result.ok || result.fingerprint !== doc.fingerprint) {
      this._onStale()
      return false
    }
    batch
      .filter(page => page.dataset.page in result.pages)
      .forEach(page => this._fill(page, result.pages[page.dataset.page]))
    return true
  }

}
