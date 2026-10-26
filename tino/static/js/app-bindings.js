/**
 * Toolbar, tab bar, theme toggle, explorer toggle, and panel resize bindings.
 * Extracted from TinoApp to keep app.js within the line limit.
 */

const bindBucketSelect = app => {
  app.els.bucketBtn.addEventListener(
    'click',
    () => app.fileTree.openBucketPicker(),
  )
}

/*
 * Files are saved automatically, so there is no manual save action left. The
 * browser's own Ctrl/Cmd-S ("save page as") would be confusing here, so it is
 * swallowed globally — CodeMirror does the same for its own focus.
 */

const bindSaveSuppression = () => {
  window.addEventListener('keydown', evt => {
    if ((evt.ctrlKey || evt.metaKey) && !evt.shiftKey
      && evt.key.toLowerCase() === 's')
      evt.preventDefault()
  })
}

const bindSearch = app => {
  document.getElementById('btn-search')
    .addEventListener('click', () => app.searchModal.open())
  window.addEventListener('keydown', evt => {
    if ((evt.ctrlKey || evt.metaKey) && evt.shiftKey
      && evt.key.toLowerCase() === 'f') {
      evt.preventDefault()
      app.searchModal.open()
    }
  })
}

const bindDownloadButton = app => {
  document.getElementById('btn-download')
    .addEventListener('click', () => {
      if (!app.bucket)
        return
      const slug = encodeURIComponent(app.bucket)
      const link = document.createElement('a')
      link.href = `api/buckets/${slug}/files/download`
      link.download = ''
      link.click()
    })
}

/* Close buttons, backdrop click, and the Changes/History tab strip. */

const bindGitDialogChrome = app => {
  for (const id of ['btn-commit-cancel', 'btn-history-cancel', 'btn-git-close-x'])
    document.getElementById(id).addEventListener('click', () => app.git.closeDialog())
  app.els.gitDialog.addEventListener('click', evt => {
    if (evt.target === app.els.gitDialog)
      app.git.closeDialog()
  })
  document.querySelectorAll('.git-tab').forEach(btn => {
    btn.addEventListener('click', () => app.git.selectTab(btn.dataset.tab))
  })
}

/* The dialog header: branch picker and remote actions. */

const bindGitHeaderControls = app => {
  document.getElementById('git-branch-select')
    .addEventListener('change', evt => {
      app.git.branches.switchTo(evt.target.value)
    })
  document.getElementById('btn-git-new-branch')
    .addEventListener('click', () => {
      app.git.branches.create()
    })
  document.getElementById('btn-git-pull')
    .addEventListener('click', () => {
      app.git.pull()
    })
  document.getElementById('btn-git-push')
    .addEventListener('click', () => {
      app.git.push()
    })
}

const bindGitButtons = app => {
  document.getElementById('btn-git')
    .addEventListener('click', () => {
      app.git.openDialog()
    })
  document.getElementById('btn-history')
    .addEventListener('click', () => {
      app.git.openHistory(app.currentFile)
    })
  document.getElementById('btn-commit-submit')
    .addEventListener('click', () => {
      app.git.submit()
    })
  bindGitDialogChrome(app)
  document.getElementById('btn-commit-all')
    .addEventListener('click', () => {
      app.git.selectAll(true)
    })
  document.getElementById('btn-commit-none')
    .addEventListener('click', () => {
      app.git.selectAll(false)
    })
  bindGitHeaderControls(app)
  app.els.commitFiles.addEventListener('click', evt => {
    const name = evt.target.closest('.commit-file-name')
    if (!name)
      return
    const li = name.closest('.commit-file-item')
    if (li && li.dataset.file)
      app.git.showDiffFor(li.dataset.file)
  })
  app.git.history.bind()
}

/* The saved theme is applied by the inline script in index.html, before the
   first paint; this only wires the toggle. */

const bindThemeToggle = () => {
  const target = document.documentElement
  document.getElementById('btn-theme')
    .addEventListener('click', () => {
      const current = target.getAttribute('data-theme')
      const next = current === 'dark' ? 'light' : 'dark'
      target.setAttribute('data-theme', next)
      localStorage.setItem('tino:theme', next)
    })
}

const EXPLORER_KEY = 'tino:explorer'

const setExplorerVisible = visible => {
  document.getElementById('file-explorer').classList.toggle('hidden', !visible)
  document.getElementById('resize-left').classList.toggle('hidden', !visible)
  document.getElementById('btn-toggle-explorer')
    .querySelector('.material-symbols-outlined')
    .textContent = visible ? 'left_panel_close' : 'left_panel_open'
}

const bindExplorerToggle = () => {
  let visible = localStorage.getItem(EXPLORER_KEY) !== 'off'
  setExplorerVisible(visible)
  document.getElementById('btn-toggle-explorer')
    .addEventListener('click', () => {
      visible = !visible
      setExplorerVisible(visible)
      localStorage.setItem(EXPLORER_KEY, visible ? 'on' : 'off')
    })
}

const bindTabBar = app => {
  app.els.tabBar.addEventListener('click', evt => {
    const closeBtn = evt.target.closest('.tab-close')
    if (closeBtn) {
      const tab = closeBtn.closest('.tab')
      app.editor.closeTab(tab.dataset.file)
      return
    }
    const tab = evt.target.closest('.tab')
    if (tab)
      app.editor.openFile(tab.dataset.file)
  })
  document.getElementById('btn-close-all-tabs')
    .addEventListener('click', () => app.editor.closeAllTabs())
}

const bindLogout = () => {
  document.getElementById('btn-logout')
    .addEventListener('click', () => {
      window.location.href = 'logout'
    })
}

const bindPanelResize = app => {
  const fileExplorer = document.getElementById('file-explorer')
  const previewPanel = document.getElementById('preview-panel')
  app.panelResize.init('resize-left', () => fileExplorer, 'left')
  app.panelResize.init('resize-right', () => previewPanel, 'right')
}

/** Bind all toolbar buttons, tab bar, theme toggle, and panel resize. */

export const bindToolbar = app => {
  bindBucketSelect(app)
  bindSearch(app)
  bindSaveSuppression()
  bindDownloadButton(app)
  bindGitButtons(app)
  bindThemeToggle()
  bindExplorerToggle()
  bindTabBar(app)
  bindLogout()
  bindPanelResize(app)
}
