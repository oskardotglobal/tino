import { escapeHtml } from './constants.js'

/**
 * Access control rows of the project form. Each row grants a role to either an
 * OIDC group or a single user; the owner and administrators always have full
 * access and are not listed here.
 */

const LIST_ID = 'bucket-access-list'

/** @param {string} kind - Either `group` or `user`. */

export const subjectPlaceholder = kind => kind === 'user' ? 'Username' : 'Group'

/**
 * Append one access row to the list.
 * @param {HTMLElement|null} list - Row container, defaults to the form's list.
 * @param {string} kind - Either `group` or `user`.
 * @param {string} subject - Group name or username.
 * @param {string} role - One of `viewer`, `editor`, or `committer`.
 */

export const addAccessRow = (list, kind, subject, role) => {
  const container = list || document.getElementById(LIST_ID)
  const row = document.createElement('div')
  row.className = 'access-row'
  row.innerHTML =
    '<select class="access-kind">' +
    '<option value="group">Group</option>' +
    '<option value="user">User</option>' +
    '</select>' +
    '<input class="form-input access-subject" type="text" ' +
    `placeholder="${subjectPlaceholder(kind)}" ` +
    `value="${escapeHtml(subject || '')}">` +
    '<select class="access-role">' +
    '<option value="viewer">Viewer</option>' +
    '<option value="editor">Editor</option>' +
    '<option value="committer">Committer</option>' +
    '</select>' +
    '<button class="icon-btn access-remove">' +
    '<span class="material-symbols-outlined">' +
    'close</span></button>'
  row.querySelector('.access-kind').value = kind || 'group'
  if (role)
    row.querySelector('.access-role').value = role
  container.appendChild(row)
}

/** @param {Array<object>} entries - Access entries as returned by the API. */

export const renderAccessList = entries => {
  const list = document.getElementById(LIST_ID)
  list.innerHTML = ''
  entries.forEach(entry => {
    addAccessRow(list, entry.user ? 'user' : 'group', entry.user || entry.group, entry.role)
  })
}

/** @returns {Array<object>} The rows as API access entries, blanks skipped. */

export const collectAccessEntries = () => {
  const entries = []
  document.querySelectorAll(`#${LIST_ID} .access-row`).forEach(row => {
    const subject = row.querySelector('.access-subject').value.trim()
    const kind = row.querySelector('.access-kind').value
    const role = row.querySelector('.access-role').value
    if (subject)
      entries.push(kind === 'user' ? { role, user: subject } : { group: subject, role })
  })
  return entries
}
