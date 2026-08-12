/**
 * Shared slide helpers for the presentation and speaker modes: the keyboard
 * mapping both modes navigate with, and the slide rendering that keeps the
 * white page area matched to the compiled SVG.
 */

/** Maps a key to the slide action it triggers. */

const SLIDE_ACTIONS = {
  ' ': 'next',
  ArrowLeft: 'prev',
  ArrowRight: 'next',
  Escape: 'exit',
  PageDown: 'next',
  PageUp: 'prev',
}

/**
 * The navigation action for a key press, or null when the key is not bound.
 * @param {string} key - KeyboardEvent.key value.
 */

export const slideAction = key => SLIDE_ACTIONS[key] || null

/**
 * Render a slide's SVG into a host element, sizing the host to the page's
 * aspect ratio so its white background matches the SVG instead of leaking
 * behind the letterboxing.
 *
 * @param {Element} host - Container to render into.
 * @param {string} html - Slide SVG markup, as compiled for the preview.
 */

export const renderSlide = (host, html) => {
  host.innerHTML = html
  const svg = host.querySelector('svg')
  if (!svg)
    return
  const { baseVal } = svg.viewBox
  host.style.aspectRatio = `${baseVal.width} / ${baseVal.height}`
}
