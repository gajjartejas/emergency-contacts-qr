(() => {
  'use strict';

  const APP_STORAGE_KEY = 'ecp_data_v1';
  const SETTINGS_STORAGE_KEY = 'ecp_settings_v1';
  const SCHEMA_VERSION = 1;
  const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

  const dom = {
    appRoot: document.getElementById('appRoot'),
    statusLine: document.getElementById('statusLine'),
    modeHint: document.getElementById('modeHint'),

    openContactDialogBtn: document.getElementById('openContactDialogBtn'),
    openQrDialogBtn: document.getElementById('openQrDialogBtn'),
    contactDialog: document.getElementById('contactDialog'),
    contactDialogTitle: document.getElementById('contactDialogTitle'),
    qrDialog: document.getElementById('qrDialog'),
    qrViewDialog: document.getElementById('qrViewDialog'),
    qrViewImage: document.getElementById('qrViewImage'),
    qrViewMeta: document.getElementById('qrViewMeta'),
    qrViewPayBtn: document.getElementById('qrViewPayBtn'),
    qrViewCloseBtn: document.getElementById('qrViewCloseBtn'),

    contactForm: document.getElementById('contactForm'),
    contactId: document.getElementById('contactId'),
    contactName: document.getElementById('contactName'),
    contactPhone: document.getElementById('contactPhone'),
    contactSubmit: document.getElementById('contactSubmit'),
    contactCancel: document.getElementById('contactCancel'),
    contactsList: document.getElementById('contactsList'),
    contactsEmpty: document.getElementById('contactsEmpty'),
    archivedWrap: document.getElementById('archivedWrap'),
    archivedList: document.getElementById('archivedList'),
    archivedEmpty: document.getElementById('archivedEmpty'),

    qrForm: document.getElementById('qrForm'),
    qrLabel: document.getElementById('qrLabel'),
    qrUpiId: document.getElementById('qrUpiId'),
    qrFile: document.getElementById('qrFile'),
    qrCancel: document.getElementById('qrCancel'),
    qrGrid: document.getElementById('qrGrid'),
    qrEmpty: document.getElementById('qrEmpty'),

    exportBtn: document.getElementById('exportBtn'),
    importFile: document.getElementById('importFile'),
    clearBtn: document.getElementById('clearBtn'),
    serverMode: document.getElementById('serverMode'),
    apiToken: document.getElementById('apiToken'),
    syncBtn: document.getElementById('syncBtn'),
    installBtn: document.getElementById('installBtn')
  };

  let state = defaultData();
  let settings = defaultSettings();
  let deferredInstallPrompt = null;
  let currentQrForView = null;

  function defaultData() {
    return {
      meta: {
        version: '1.0',
        schema_version: SCHEMA_VERSION,
        updated_at: new Date().toISOString()
      },
      contacts: [],
      qrcodes: []
    };
  }

  function defaultSettings() {
    return {
      useServer: true,
      apiToken: ''
    };
  }

  function safeStorageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function safeStorageRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }

  function makeId() {
    if (window.crypto && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeText(value, maxLen) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
  }

  function normalizePhone(value) {
    const cleaned = normalizeText(value, 32).replace(/[^0-9+()\-\s]/g, '');
    return cleaned;
  }

  function normalizeQrData(value) {
    return normalizeText(value, 5000);
  }

  function sanitizeData(payload) {
    const clean = defaultData();
    const contacts = Array.isArray(payload?.contacts) ? payload.contacts : [];
    const qrcodes = Array.isArray(payload?.qrcodes) ? payload.qrcodes : [];

    clean.contacts = contacts
      .map((contact) => {
        const name = normalizeText(contact?.name, 80);
        const phone = normalizePhone(contact?.phone);
        if (!name || !isValidPhone(phone)) return null;
        return {
          id: normalizeText(contact?.id, 80) || makeId(),
          name,
          phone,
          created_at: normalizeText(contact?.created_at, 80) || new Date().toISOString(),
          deleted_at: normalizeText(contact?.deleted_at || '', 80)
        };
      })
      .filter(Boolean);

    clean.qrcodes = qrcodes
      .map((qr) => {
        const label = normalizeText(qr?.label, 100);
        const data = normalizeQrData(qr?.data);
        const upiId = normalizeText(qr?.upi_id || '', 120);
        if (!label || !isAllowedQrSource(data)) return null;
        return {
          id: normalizeText(qr?.id, 80) || makeId(),
          label,
          upi_id: upiId,
          data,
          created_at: normalizeText(qr?.created_at, 80) || new Date().toISOString()
        };
      })
      .filter(Boolean);

    clean.meta.version = normalizeText(payload?.meta?.version || '1.0', 20);
    clean.meta.updated_at = new Date().toISOString();
    return clean;
  }

  function mergeData(current, incoming) {
    const contacts = new Map(current.contacts.map((item) => [item.id, item]));
    incoming.contacts.forEach((item) => contacts.set(item.id, item));

    const qrcodes = new Map(current.qrcodes.map((item) => [item.id, item]));
    incoming.qrcodes.forEach((item) => qrcodes.set(item.id, item));

    return {
      meta: {
        version: incoming.meta.version || current.meta.version || '1.0',
        schema_version: SCHEMA_VERSION,
        updated_at: new Date().toISOString()
      },
      contacts: [...contacts.values()],
      qrcodes: [...qrcodes.values()]
    };
  }

  function isValidPhone(phone) {
    return /^[0-9+()\-\s]{3,32}$/.test(phone);
  }

  function isValidUpiId(upiId) {
    return /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/.test(upiId);
  }

  function isAllowedQrSource(value) {
    if (!value) return false;
    if (value.startsWith('data:image/')) return true;
    if (value.startsWith('/uploads/')) return true;
    try {
      const parsed = new URL(value, window.location.origin);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }

  function setStatus(message, type = '') {
    dom.statusLine.textContent = message;
    dom.statusLine.classList.remove('error', 'success');
    if (type === 'error' || type === 'success') {
      dom.statusLine.classList.add(type);
    }
  }

  function getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const token = settings.apiToken.trim();
    if (token) {
      headers['x-api-token'] = token;
    }
    return headers;
  }

  async function apiGetData() {
    const res = await fetch('/api/v1/data', {
      method: 'GET',
      headers: getAuthHeaders()
    });

    if (!res.ok) {
      throw new Error(`Server read failed (${res.status})`);
    }

    return sanitizeData(await res.json());
  }

  async function apiSaveData(mode = 'overwrite') {
    const res = await fetch('/api/v1/data', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ ...state, mode })
    });

    if (!res.ok) {
      throw new Error(`Server save failed (${res.status})`);
    }

    const payload = await res.json();
    return sanitizeData(payload.data || state);
  }

  async function apiUploadDataUrl(dataUrl, fileName) {
    const res = await fetch('/api/v1/upload', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ dataUrl, fileName })
    });

    if (!res.ok) {
      throw new Error(`Upload failed (${res.status})`);
    }

    const payload = await res.json();
    if (!payload.url) {
      throw new Error('Upload failed (missing URL)');
    }
    return payload.url;
  }

  function openDialog(dialog) {
    if (!dialog) return;
    let usedFallback = false;
    try {
      if (typeof dialog.showModal === 'function') {
        if (!dialog.open) {
          dialog.showModal();
        }
      } else {
        dialog.setAttribute('open', 'open');
        usedFallback = true;
      }
    } catch {
      dialog.setAttribute('open', 'open');
      usedFallback = true;
    }
    if (usedFallback) {
      dialog.classList.add('dialog-fallback-open');
      dialog.setAttribute('data-fallback-open', 'true');
    } else {
      dialog.classList.remove('dialog-fallback-open');
      dialog.removeAttribute('data-fallback-open');
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    try {
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
    } catch {
      dialog.removeAttribute('open');
    }
    if (dialog.getAttribute('data-fallback-open') === 'true') {
      dialog.classList.remove('dialog-fallback-open');
      dialog.removeAttribute('data-fallback-open');
    }
  }

  function toDataUrlFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to convert QR image'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(blob);
    });
  }

  async function generateQrDataFromUpi(upiId, label) {
    const upiPayload = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(label)}`;
    const apiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=640x640&data=${encodeURIComponent(upiPayload)}`;

    try {
      const response = await fetch(apiUrl, { method: 'GET', mode: 'cors' });
      if (!response.ok) {
        throw new Error(`QR generation failed (${response.status})`);
      }
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) {
        throw new Error('Generated QR is not an image');
      }
      return await toDataUrlFromBlob(blob);
    } catch (error) {
      // Fallback: keep a live URL if conversion fails.
      return apiUrl;
    }
  }

  function buildUpiPayLink(qr) {
    const upiId = normalizeText(qr?.upi_id || '', 120);
    const label = normalizeText(qr?.label || '', 100);
    if (!upiId || !isValidUpiId(upiId)) {
      return '';
    }
    return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(label)}`;
  }

  function launchPaymentForQr(qr) {
    const link = buildUpiPayLink(qr);
    if (!link) {
      setStatus('UPI ID missing or invalid for this QR.', 'error');
      return;
    }
    window.location.href = link;
  }

  function openQrViewer(qr) {
    currentQrForView = qr;
    if (dom.qrViewImage) {
      dom.qrViewImage.src = qr.data;
      dom.qrViewImage.alt = `${qr.label} payment QR`;
    }
    if (dom.qrViewMeta) {
      dom.qrViewMeta.textContent = qr.upi_id ? `UPI: ${qr.upi_id}` : 'UPI ID not set';
    }
    openDialog(dom.qrViewDialog);
  }

  function persistDataLocal() {
    state.meta.updated_at = new Date().toISOString();
    const ok = safeStorageSet(APP_STORAGE_KEY, JSON.stringify(state));
    if (!ok) {
      setStatus('Storage full or unavailable. Export backup to avoid loss.', 'error');
      return false;
    }
    return true;
  }

  function persistSettings() {
    safeStorageSet(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    updateModeHint();
  }

  function loadSettings() {
    const raw = safeStorageGet(SETTINGS_STORAGE_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      settings = {
        ...defaultSettings(),
        useServer: Boolean(parsed.useServer),
        apiToken: normalizeText(parsed.apiToken || '', 128)
      };
    } catch {
      settings = defaultSettings();
    }
  }

  function loadDataLocal() {
    const raw = safeStorageGet(APP_STORAGE_KEY);
    if (!raw) {
      state = defaultData();
      return;
    }

    try {
      state = sanitizeData(JSON.parse(raw));
    } catch {
      state = defaultData();
    }
  }

  async function loadData() {
    loadDataLocal();
    renderAll();

    if (!settings.useServer) {
      setStatus('Using local browser storage.', 'success');
      return;
    }

    try {
      const remote = await apiGetData();
      state = remote;
      persistDataLocal();
      renderAll();
      setStatus('Loaded from server storage.', 'success');
    } catch (error) {
      setStatus(`Server unavailable, using local data. ${error.message}`, 'error');
    }
  }

  function updateModeHint() {
    if (settings.useServer) {
      dom.modeHint.textContent = 'Mode: Server-backed JSON with local cache for offline use.';
      return;
    }
    dom.modeHint.textContent = 'Mode: Local browser storage only (offline after load).';
  }

  async function saveState(mode = 'overwrite') {
    const savedLocal = persistDataLocal();
    if (!savedLocal) {
      return;
    }

    if (!settings.useServer) {
      setStatus('Saved locally.', 'success');
      return;
    }

    try {
      state = await apiSaveData(mode);
      persistDataLocal();
      renderAll();
      setStatus('Saved to server and local cache.', 'success');
    } catch (error) {
      setStatus(`Saved locally, server sync failed: ${error.message}`, 'error');
    }
  }

  function createActionButton(label, className, onClick, attrs = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn ${className || ''}`.trim();
    button.textContent = label;
    Object.keys(attrs).forEach((key) => button.setAttribute(key, attrs[key]));
    button.addEventListener('click', onClick);
    return button;
  }

  function on(element, eventName, handler) {
    if (!element) return;
    element.addEventListener(eventName, handler);
  }

  function renderContacts() {
    dom.contactsList.replaceChildren();
    dom.archivedList.replaceChildren();

    const activeContacts = state.contacts.filter((entry) => !entry.deleted_at);
    const archivedContacts = state.contacts.filter((entry) => entry.deleted_at);

    if (!activeContacts.length) {
      dom.contactsEmpty.classList.remove('hidden');
    } else {
      dom.contactsEmpty.classList.add('hidden');
    }

    activeContacts.forEach((contact) => {
      const item = document.createElement('li');

      const meta = document.createElement('div');
      meta.className = 'contact-meta';

      const name = document.createElement('strong');
      name.textContent = contact.name;

      const phone = document.createElement('span');
      phone.textContent = contact.phone;

      meta.append(name, phone);

      const actions = document.createElement('div');
      actions.className = 'actions';

      const callLink = document.createElement('a');
      callLink.className = 'btn primary';
      callLink.href = `tel:${contact.phone.replace(/\s+/g, '')}`;
      callLink.textContent = 'Call';
      callLink.setAttribute('aria-label', `Call ${contact.name}`);
      callLink.style.display = 'inline-flex';
      callLink.style.alignItems = 'center';
      callLink.style.justifyContent = 'center';
      callLink.style.textDecoration = 'none';

      const editBtn = createActionButton('Edit', '', () => {
        dom.contactId.value = contact.id;
        dom.contactName.value = contact.name;
        dom.contactPhone.value = contact.phone;
        dom.contactDialogTitle.textContent = 'Edit Contact';
        dom.contactSubmit.textContent = 'Save Contact';
        openDialog(dom.contactDialog);
        dom.contactName.focus();
      });

      const deleteBtn = createActionButton('Delete', 'danger', async () => {
        const softDelete = window.confirm(`Move "${contact.name}" to archive? Click Cancel for permanent delete.`);
        if (softDelete) {
          const target = state.contacts.find((entry) => entry.id === contact.id);
          if (target) {
            target.deleted_at = new Date().toISOString();
          }
          await saveState('overwrite');
          renderContacts();
          return;
        }

        const hardDelete = window.confirm(`Permanently delete "${contact.name}"? This cannot be undone.`);
        if (!hardDelete) return;

        state.contacts = state.contacts.filter((entry) => entry.id !== contact.id);
        await saveState('overwrite');
        renderContacts();
      });

      actions.append(callLink, editBtn, deleteBtn);
      item.append(meta, actions);
      dom.contactsList.append(item);
    });

    if (!archivedContacts.length) {
      dom.archivedWrap.classList.add('hidden');
      dom.archivedEmpty.classList.remove('hidden');
      return;
    }

    dom.archivedWrap.classList.remove('hidden');
    dom.archivedEmpty.classList.add('hidden');

    archivedContacts.forEach((contact) => {
      const item = document.createElement('li');

      const meta = document.createElement('div');
      meta.className = 'contact-meta';

      const name = document.createElement('strong');
      name.textContent = contact.name;

      const phone = document.createElement('span');
      phone.textContent = `${contact.phone} (archived)`;
      meta.append(name, phone);

      const actions = document.createElement('div');
      actions.className = 'actions';

      const restoreBtn = createActionButton('Restore', '', async () => {
        const target = state.contacts.find((entry) => entry.id === contact.id);
        if (target) {
          target.deleted_at = '';
        }
        await saveState('overwrite');
        renderContacts();
      });

      const deleteBtn = createActionButton('Delete Now', 'danger', async () => {
        const hardDelete = window.confirm(`Permanently delete archived contact "${contact.name}"?`);
        if (!hardDelete) return;

        state.contacts = state.contacts.filter((entry) => entry.id !== contact.id);
        await saveState('overwrite');
        renderContacts();
      });

      actions.append(restoreBtn, deleteBtn);
      item.append(meta, actions);
      dom.archivedList.append(item);
    });
  }

  function renderQrs() {
    dom.qrGrid.replaceChildren();

    if (!state.qrcodes.length) {
      dom.qrEmpty.classList.remove('hidden');
      return;
    }

    dom.qrEmpty.classList.add('hidden');

    state.qrcodes.forEach((qr) => {
      const card = document.createElement('article');
      card.className = 'qr-card';

      const img = document.createElement('img');
      img.src = qr.data;
      img.alt = `${qr.label} payment QR`;
      img.className = 'qr-preview';
      img.loading = 'lazy';

      const title = document.createElement('p');
      title.className = 'qr-title';
      title.textContent = qr.label;

      const upiMeta = document.createElement('p');
      upiMeta.className = 'hint';
      upiMeta.textContent = qr.upi_id ? `UPI: ${qr.upi_id}` : 'UPI ID not set';

      const openBtn = createActionButton('Open', 'primary', () => {
        openQrViewer(qr);
      }, { 'aria-label': `Open ${qr.label} QR popup` });

      const payBtn = createActionButton('Pay', '', () => {
        launchPaymentForQr(qr);
      }, { 'aria-label': `Pay using ${qr.label}` });

      const deleteBtn = createActionButton('Delete', 'danger', async () => {
        const shouldDelete = window.confirm(`Delete QR "${qr.label}"?`);
        if (!shouldDelete) return;

        state.qrcodes = state.qrcodes.filter((entry) => entry.id !== qr.id);
        await saveState('overwrite');
        renderQrs();
      });

      const actionWrap = document.createElement('div');
      actionWrap.className = 'actions';
      actionWrap.append(openBtn, payBtn, deleteBtn);

      card.append(img, title, upiMeta, actionWrap);
      dom.qrGrid.append(card);
    });
  }

  function renderAll() {
    renderContacts();
    renderQrs();

    dom.serverMode.checked = settings.useServer;
    dom.apiToken.value = settings.apiToken;
    updateModeHint();
  }

  function resetContactForm() {
    dom.contactId.value = '';
    dom.contactName.value = '';
    dom.contactPhone.value = '';
    dom.contactDialogTitle.textContent = 'Add Contact';
    dom.contactSubmit.textContent = 'Add Contact';
  }

  async function readFileAsDataUrl(file) {
    if (!file) {
      throw new Error('No file selected');
    }

    if (!file.type.startsWith('image/')) {
      throw new Error('File must be an image');
    }

    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const allowedExt = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];
    if (!allowedExt.includes(ext)) {
      throw new Error('Invalid image extension. Allowed: png, jpg, jpeg, webp, gif, svg');
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error('Image too large. Max 2 MB.');
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read image file'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        registration.update().catch(() => {});
      })
      .catch((error) => {
        setStatus(`Service worker registration failed: ${error.message}`, 'error');
      });
  }

  function setupInstallPrompt() {
    on(window, 'beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      if (dom.installBtn) {
        dom.installBtn.classList.remove('hidden');
      }
    });

    on(dom.installBtn, 'click', async () => {
      if (!deferredInstallPrompt) {
        setStatus('Install is not available on this browser.', 'error');
        return;
      }

      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice?.outcome === 'accepted') {
        setStatus('App installation accepted.', 'success');
      } else {
        setStatus('App installation dismissed.', 'error');
      }
      deferredInstallPrompt = null;
      if (dom.installBtn) {
        dom.installBtn.classList.add('hidden');
      }
    });
  }

  function bindEvents() {
    on(dom.openContactDialogBtn, 'click', () => {
      resetContactForm();
      openDialog(dom.contactDialog);
      if (dom.contactName) dom.contactName.focus();
    });

    on(dom.openQrDialogBtn, 'click', () => {
      if (dom.qrForm) dom.qrForm.reset();
      openDialog(dom.qrDialog);
      if (dom.qrLabel) dom.qrLabel.focus();
    });

    on(dom.contactForm, 'submit', async (event) => {
      event.preventDefault();

      const id = normalizeText(dom.contactId.value, 80);
      const name = normalizeText(dom.contactName.value, 80);
      const phone = normalizePhone(dom.contactPhone.value);

      if (!name || !isValidPhone(phone)) {
        setStatus('Enter a valid contact name and phone number.', 'error');
        return;
      }

      if (id) {
        const target = state.contacts.find((contact) => contact.id === id);
        if (target) {
          target.name = name;
          target.phone = phone;
          target.deleted_at = '';
        }
      } else {
        state.contacts.push({
          id: makeId(),
          name,
          phone,
          created_at: new Date().toISOString(),
          deleted_at: ''
        });
      }

      await saveState('overwrite');
      resetContactForm();
      closeDialog(dom.contactDialog);
      renderContacts();
    });

    on(dom.contactCancel, 'click', () => {
      resetContactForm();
      closeDialog(dom.contactDialog);
    });

    on(dom.qrCancel, 'click', () => {
      if (dom.qrForm) dom.qrForm.reset();
      closeDialog(dom.qrDialog);
    });

    on(dom.qrViewCloseBtn, 'click', () => {
      closeDialog(dom.qrViewDialog);
    });

    on(dom.qrViewPayBtn, 'click', () => {
      if (!currentQrForView) {
        setStatus('No QR selected.', 'error');
        return;
      }
      launchPaymentForQr(currentQrForView);
    });

    on(dom.qrForm, 'submit', async (event) => {
      event.preventDefault();

      const label = normalizeText(dom.qrLabel.value, 100);
      const upiId = normalizeText(dom.qrUpiId?.value || '', 120).toLowerCase();
      const file = dom.qrFile.files?.[0] || null;

      if (!label) {
        setStatus('QR label is required.', 'error');
        return;
      }

      if (!upiId || !isValidUpiId(upiId)) {
        setStatus('Enter a valid UPI ID (example@bank).', 'error');
        return;
      }

      let qrData = '';
      try {
        if (file) {
          const fileDataUrl = await readFileAsDataUrl(file);
          qrData = settings.useServer ? await apiUploadDataUrl(fileDataUrl, file.name) : fileDataUrl;
        } else {
          const generatedData = await generateQrDataFromUpi(upiId, label);
          if (settings.useServer && generatedData.startsWith('data:image/')) {
            qrData = await apiUploadDataUrl(generatedData, 'generated-qr.png');
          } else {
            qrData = generatedData;
          }
        }
      } catch (error) {
        setStatus(error.message, 'error');
        return;
      }

      state.qrcodes.push({
        id: makeId(),
        label,
        upi_id: upiId,
        data: qrData,
        created_at: new Date().toISOString()
      });

      await saveState('overwrite');
      dom.qrForm.reset();
      closeDialog(dom.qrDialog);
      renderQrs();
    });

    on(dom.exportBtn, 'click', () => {
      const payload = {
        meta: {
          exported_at: new Date().toISOString(),
          version: state.meta.version || '1.0',
          schema_version: SCHEMA_VERSION
        },
        contacts: state.contacts,
        qrcodes: state.qrcodes
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `emergency-contacts-backup-${Date.now()}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);

      setStatus('Backup exported.', 'success');
    });

    on(dom.importFile, 'change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const raw = await file.text();
        const parsed = sanitizeData(JSON.parse(raw));

        let mode = 'overwrite';
        if (window.confirm('Merge imported data with current data? Click Cancel for overwrite.')) {
          mode = 'merge';
          state = mergeData(state, parsed);
        } else if (window.confirm('Overwrite all current data with imported file?')) {
          state = parsed;
          mode = 'overwrite';
        } else {
          setStatus('Import cancelled.', 'error');
          dom.importFile.value = '';
          return;
        }

        await saveState(mode);
        renderAll();
        setStatus(`Import completed (${mode}).`, 'success');
      } catch (error) {
        setStatus(`Import failed: ${error.message}`, 'error');
      } finally {
        dom.importFile.value = '';
      }
    });

    on(dom.clearBtn, 'click', async () => {
      const shouldClear = window.confirm('Clear all contacts and QR codes? This cannot be undone.');
      if (!shouldClear) return;

      state = defaultData();
      await saveState('overwrite');
      renderAll();
      resetContactForm();
      setStatus('All data cleared.', 'success');
    });

    on(dom.serverMode, 'change', async () => {
      settings.useServer = dom.serverMode.checked;
      persistSettings();

      if (settings.useServer) {
        try {
          const remote = await apiGetData();
          state = remote;
          persistDataLocal();
          renderAll();
          setStatus('Server mode enabled.', 'success');
        } catch (error) {
          settings.useServer = false;
          dom.serverMode.checked = false;
          persistSettings();
          setStatus(`Could not enable server mode: ${error.message}`, 'error');
        }
      } else {
        setStatus('Switched to local-only mode.', 'success');
      }
    });

    on(dom.apiToken, 'change', () => {
      settings.apiToken = normalizeText(dom.apiToken.value, 128);
      persistSettings();
      setStatus('API token updated.', 'success');
    });

    on(dom.syncBtn, 'click', async () => {
      if (!settings.useServer) {
        setStatus('Server mode is disabled.', 'error');
        return;
      }

      try {
        const remote = await apiGetData();
        state = remote;
        persistDataLocal();
        renderAll();
        setStatus('Synced from server.', 'success');
      } catch (error) {
        setStatus(`Sync failed: ${error.message}`, 'error');
      }
    });

    on(window, 'offline', () => {
      setStatus('You are offline. Local cache remains available.', 'error');
    });

    on(window, 'online', () => {
      setStatus('Back online.', 'success');
    });
  }

  async function init() {
    loadSettings();
    bindEvents();
    registerServiceWorker();
    setupInstallPrompt();

    renderAll();
    await loadData();

    const storageAvailable = safeStorageSet('__ecp_probe__', '1');
    safeStorageRemove('__ecp_probe__');
    if (!storageAvailable) {
      setStatus('Local storage is unavailable. Use Export JSON to keep backups.', 'error');
    }
  }

  init().catch((error) => {
    setStatus(`Initialization failed: ${error.message}`, 'error');
  });
})();
