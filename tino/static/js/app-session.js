/**
 * Session concerns of TinoApp: who the user is, and which actions their role
 * in the current project allows. Extracted from app.js to keep it within the
 * line limit.
 */

/* Applied synchronously, so an in-flight reload cannot interleave with it. */

const applyUser = (app, user) => {
  app.username = user ? user.username : 'anonymous'
  app.isAdmin = Boolean(user && user.is_admin)
  app.els.userLabel.textContent =
    (user && (user.display_name || user.username)) || 'anonymous'
  app.els.userLabel.title = app.username
  app.settingsModal.applyAdminVisibility(app.isAdmin)
}

const fetchUser = async app => {
  try {
    return await app.api.me()
  }
  catch {
    return null
  }
}

/**
 * Load the current user and show their identity in the toolbar. The label is
 * the profile display name when set, with the login name as its tooltip.
 * @param {TinoApp} app - Main application instance.
 */

export const loadUser = async app => {
  applyUser(app, await fetchUser(app))
}

/**
 * Show or hide editor actions based on the user's role in the current project.
 * @param {TinoApp} app - Main application instance.
 */

export const applyRoleVisibility = app => {
  const canView = Boolean(app.bucketRole)
  const canEdit = app.bucketRole === 'editor' || app.bucketRole === 'committer'
  const canCommit = app.bucketRole === 'committer'
  for (const [id, visible] of Object.entries({
    'btn-download': canView,
    'btn-git': canView,
    'btn-history': canView,
    'btn-history-restore': canEdit,
    'tree-new': canEdit,
  }))
    document.getElementById(id).classList.toggle('hidden', !visible)

  /* Committing and syncing with the remote both need the committer role, so
     the Changes tab and the remote actions appear and disappear together. */

  for (const id of ['btn-git-tab-changes', 'btn-git-pull', 'btn-git-push'])
    document.getElementById(id).classList.toggle('hidden', !canCommit)
}
