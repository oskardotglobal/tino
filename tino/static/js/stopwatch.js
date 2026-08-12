/**
 * Presentation stopwatch used by the speaker view.
 *
 * Elapsed time is derived from timestamps rather than accumulated per tick, so
 * a throttled background tab never makes the clock drift. The tick interval
 * only drives the display.
 */

const MS_PER_SECOND = 1000

const SECONDS_PER_MINUTE = 60

const MINUTES_PER_HOUR = 60

const TIME_PART_DIGITS = 2

const TICK_MS = 200

export class Stopwatch {

  /**
   * @param {Element} display - Element showing the running time.
   * @param {Element} laps - List element the recorded laps are appended to.
   */

  constructor(display, laps) {
    this._display = display
    this._laps = laps
    this._elapsed = 0
    this._startedAt = null
    this._timer = null
  }

  /** Whether the clock is currently running. */

  get running() {
    return this._startedAt !== null
  }

  /** Elapsed time in milliseconds, including the currently running stretch. */

  get elapsed() {
    if (!this.running)
      return this._elapsed
    return this._elapsed + (Date.now() - this._startedAt)
  }

  /** Start (or resume) the clock. */

  start() {
    if (this.running)
      return
    this._startedAt = Date.now()
    this._timer = setInterval(() => this._render(), TICK_MS)
    this._render()
  }

  /** Pause the clock, keeping the elapsed time. */

  pause() {
    if (!this.running)
      return
    this._elapsed = this.elapsed
    this._startedAt = null
    clearInterval(this._timer)
    this._timer = null
    this._render()
  }

  /** Pause when running, resume when paused. Returns the new running state. */

  toggle() {
    if (this.running)
      this.pause()
    else
      this.start()
    return this.running
  }

  /** Zero the clock and clear the laps, leaving it running if it was. */

  reset() {
    this._elapsed = 0
    if (this.running)
      this._startedAt = Date.now()
    this._laps.replaceChildren()
    this._render()
  }

  /** Record the current time as a lap. */

  lap() {
    const item = document.createElement('li')
    item.className = 'speaker-lap'
    item.textContent = Stopwatch.format(this.elapsed)
    this._laps.append(item)
    this._laps.scrollTop = this._laps.scrollHeight
  }

  /** Stop the clock and clear all recorded state. */

  clear() {
    this.pause()
    this._elapsed = 0
    this._laps.replaceChildren()
    this._render()
  }

  /** Format a duration in milliseconds as HH:MM:SS. */

  static format(ms) {
    const seconds = Math.floor(ms / MS_PER_SECOND)
    const parts = [
      Math.floor(seconds / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR)),
      Math.floor(seconds / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR,
      seconds % SECONDS_PER_MINUTE,
    ]
    return parts
      .map(part => String(part).padStart(TIME_PART_DIGITS, '0'))
      .join(':')
  }

  _render() {
    this._display.textContent = Stopwatch.format(this.elapsed)
  }

}
