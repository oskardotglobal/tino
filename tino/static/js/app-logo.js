/**
 * Header logo behaviour: the version tooltip and the source-repository link.
 */

/** Show the app version on hover over the header logo. */

export const setLogoVersionTooltip = app => {
  if (!app.config.version)
    return

  // Inline SVG ignores the HTML `title` attribute for tooltips; it needs a
  // <title> child element instead.
  const ns = 'http://www.w3.org/2000/svg'
  const title = document.createElementNS(ns, 'title')
  title.textContent = `TINO v${app.config.version}`
  app.els.logo.replaceChildren(title, ...app.els.logo.childNodes)
}

/**
 * Open the configured source repository (TINO_REPO_URL) in a new tab when the
 * logo is clicked. Without a configured URL the logo stays inert.
 */

export const bindLogoRepoLink = app => {
  const url = app.config.repoUrl
  if (!url)
    return
  app.els.logo.classList.add('clickable')
  app.els.logo.addEventListener('click', () => {
    window.open(url, '_blank', 'noopener')
  })
}
