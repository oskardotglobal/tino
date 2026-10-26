import { REMOTE_URL, escapeHtml } from './constants.js'
import {
  addAccessRow,
  collectAccessEntries,
  renderAccessList,
  subjectPlaceholder,
} from './bucket-access.js'

/**
 * Manages the project picker dialog and the project CRUD form. Projects are
 * called buckets in the API and on disk; only the wording differs.
 */

export class BucketPicker {

  /** @param {TinoApp} app - Main application instance. */

  constructor(app) {
    this.app = app
    this._editingSlug = null
  }

  /** Open the bucket picker dialog and populate the list. */

  async open() {
    this._showListView()
    await this._renderList()
    this.app.els.bucketPicker.classList.add('visible')
  }

  /** Close the bucket picker overlay. */

  close() {
    this.app.els.bucketPicker.classList.remove('visible')
  }

  /** Bind click events for the bucket picker, form buttons, and close. */

  bind() {
    this._bindPickerClicks()
    this._bindFormButtons()
    this._bindClose()
  }

  /* Projects owned by someone else are labelled with their owner. */

  static _ownerBadge(bucket, username) {
    if (!bucket.owner || bucket.owner === username)
      return ''
    return `<span class="bucket-pick-owner">${escapeHtml(bucket.owner)}</span>`
  }

  /* Only the owner and administrators may edit or delete a project, so the
     buttons are rendered per project from the API's can_manage flag. */

  static _manageButtons(bucket) {
    if (!bucket.can_manage)
      return ''
    return '<button class="icon-btn bucket-edit">' +
      '<span class="material-symbols-outlined">settings</span></button>' +
      '<button class="icon-btn bucket-delete">' +
      '<span class="material-symbols-outlined">delete</span></button>'
  }

  async _renderList() {
    this._buckets = await this.app.api.listBuckets()
    const list = this.app.els.bucketPickerList
    list.innerHTML = ''
    this._buckets.forEach(bkt => {
      const li = document.createElement('li')
      li.className = 'bucket-pick'
      li.dataset.slug = bkt.slug
      const desc = bkt.description ? '<div class="bucket-pick-desc">' +
        `${escapeHtml(bkt.description).replace(/\n/gu, '<br>')}</div>` : ''
      const owner = BucketPicker._ownerBadge(bkt, this.app.username)
      li.innerHTML =
        '<div class="bucket-pick-header">' +
        '<span class="material-symbols-outlined">' +
        'folder</span>' +
        '<span class="bucket-pick-name">' +
        `${escapeHtml(bkt.name || bkt.slug)}</span>${owner}` +
        `${BucketPicker._manageButtons(bkt)}` +
        `</div>${desc}`
      list.appendChild(li)
    })
  }

  _bindPickerClicks() {
    this.app.els.bucketPickerList
      .addEventListener('click', evt => {
        const item = evt.target.closest('.bucket-pick')
        if (!item)
          return
        const { slug } = item.dataset
        if (evt.target.closest('.bucket-edit'))
          this._openEditForm(slug)
        else if (evt.target.closest('.bucket-delete'))
          this._deleteBucket(slug)
        else
          this._selectFromPicker(slug)
      })
  }

  _selectFromPicker(slug) {
    const bkt = this._buckets.find(item => item.slug === slug)
    this.app.els.bucketLabel.textContent = (bkt && bkt.name) || slug
    this.close()
    this.app.selectBucket(slug, bkt ? bkt.role : null)
  }

  _bindClose() {
    document.getElementById('btn-picker-close')
      .addEventListener('click', () => {
        this.close()
      })
    document.getElementById('btn-picker-close-x')
      .addEventListener('click', () => {
        this.close()
      })
    this.app.els.bucketPicker
      .addEventListener('click', evt => {
        if (evt.target === this.app.els.bucketPicker)
          this.close()
      })
  }

  // ── Bucket form (edit/create) ──

  _showListView() {
    this.app.els.bucketDialogTitle
      .querySelector('span').textContent = 'Select Project'
    document.getElementById('bucket-view-list')
      .classList.remove('hidden')
    document.getElementById('bucket-view-form')
      .classList.add('hidden')
    this._editingSlug = null
  }

  _showFormView(bucket) {
    const isNew = !bucket
    this.app.els.bucketDialogTitle
      .querySelector('span').textContent =
      isNew ? 'New Project' : `Edit: ${bucket.name || bucket.slug}`
    document.getElementById('bucket-view-list')
      .classList.add('hidden')
    document.getElementById('bucket-view-form')
      .classList.remove('hidden')
    this._populateFormFields(bucket, isNew)
  }

  _populateFormFields(bucket, isNew) {
    const slugInput = this.app.els.bucketFormSlug
    slugInput.value = isNew ? '' : bucket.slug
    slugInput.readOnly = !isNew
    this.app.els.bucketFormName.value = isNew ? '' : bucket.name || ''
    this.app.els.bucketFormDesc.value =
      isNew ? '' : bucket.description || ''
    this.app.els.bucketFormRemote.value = isNew ? '' : bucket.remote || ''
    this._editingSlug = isNew ? null : bucket.slug
    BucketPicker._renderOwner(isNew ? this.app.username : bucket.owner)
    renderAccessList(bucket ? bucket.access : [])
    if (isNew)
      slugInput.focus()
    else
      this.app.els.bucketFormDesc.focus()
  }

  /* A project belongs to whoever created it and is private to them until an
     access entry shares it. Legacy projects have no owner. */

  static _renderOwner(owner) {
    const label = document.getElementById('bucket-form-owner')
    label.textContent = owner || 'nobody (created before projects had owners)'
    label.classList.toggle('bucket-owner-none', !owner)
  }

  _validateSlug(slug) {
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
      this.app.toast.error('Slug must be lowercase alphanumeric with hyphens (e.g. "my-project").')
      return false
    }
    return true
  }

  _validateRemote(remote) {
    if (remote && !REMOTE_URL.test(remote)) {
      this.app.toast.error(
        'Remote URL must start with https://, ssh:// or git@'
        + ' (e.g. "git@github.com:acme/docs.git").',
      )
      return false
    }
    return true
  }

  async _saveBucket() {
    const slug = this.app.els.bucketFormSlug.value.trim()
    const data = this._collectForm()
    if (!this._validateSlug(slug) || !this._validateRemote(data.remote))
      return
    if (!await this._withBusySave(this._saveRequest(slug, data)))
      return
    await this.app.fileTree.loadBuckets()
    this._showListView()
    await this._renderList()
  }

  /** @returns {{label: string, action: Function}} The request saving the form. */

  _saveRequest(slug, data) {
    const editing = this._editingSlug
    if (editing)
      return { action: () => this.app.api.updateBucket(editing, data), label: 'Saving…' }
    return {
      action: () => this.app.api.createBucket(slug, data),
      label: data.remote ? 'Cloning…' : 'Saving…',
    }
  }

  /* Creating a project with a remote clones it, which can take a while, so
     the save button says what is going on and cannot be pressed twice. */

  async _withBusySave({ label, action }) {
    const btn = document.getElementById('btn-bucket-save')
    const idle = btn.textContent
    Object.assign(btn, { disabled: true, textContent: label })
    try {
      await action()
      return true
    }
    catch (err) {
      this.app.toast.error(`Saving the project failed: ${err.message}`)
      return false
    }
    finally {
      Object.assign(btn, { disabled: false, textContent: idle })
    }
  }

  _collectForm() {
    return {
      access: collectAccessEntries(),
      description: this.app.els.bucketFormDesc.value.trim(),
      name: this.app.els.bucketFormName.value.trim(),
      remote: this.app.els.bucketFormRemote.value.trim(),
    }
  }

  async _deleteBucket(slug) {
    // eslint-disable-next-line no-alert
    if (!confirm(`Delete project "${slug}"?`))
      return
    await this.app.api.deleteBucket(slug)
    if (this.app.bucket === slug)
      this.app.clearBucket()
    await this._renderList()
    await this.app.fileTree.loadBuckets()
  }

  async _openEditForm(slug) {
    const bucket = await this.app.api.getBucket(slug)
    this._showFormView(bucket)
  }

  _bindFormButtons() {
    document.getElementById('btn-bucket-new')
      .addEventListener('click', () => {
        this._showFormView(null)
      })
    document.getElementById('btn-bucket-save')
      .addEventListener('click', () => {
        this._saveBucket()
      })
    document.getElementById('btn-bucket-back')
      .addEventListener('click', () => {
        this._showListView()
        this._renderList()
      })
    document.getElementById('btn-access-add')
      .addEventListener('click', () => {
        addAccessRow(null, 'group', '', 'viewer')
      })
    document.getElementById('bucket-access-list')
      .addEventListener('click', evt => {
        if (evt.target.closest('.access-remove'))
          evt.target.closest('.access-row').remove()
      })
    document.getElementById('bucket-access-list')
      .addEventListener('change', evt => {
        const kind = evt.target.closest('.access-kind')
        if (!kind)
          return
        kind.closest('.access-row').querySelector('.access-subject')
          .placeholder = subjectPlaceholder(kind.value)
      })
  }

}
