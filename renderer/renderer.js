const App = window.api;

const state = {
  settings: null,
  tree: null,                    // { notesDir, folders, notes, favorites }
  current: null,                 // loaded note { path, meta, content }
  dirty: false,
  saveTimer: null,
  selectedFolderPath: null,      // absolute path to the "active" destination folder
  collapsedFolders: new Set(),   // absolute paths of collapsed folders (in-memory only)
};

// ---------- elements ----------
const el = {
  url: document.getElementById('url-input'),
  generate: document.getElementById('generate-btn'),
  openFolder: document.getElementById('open-folder-btn'),
  settings: document.getElementById('settings-btn'),

  favoritesList: document.getElementById('favorites-list'),
  folderTree: document.getElementById('folder-tree'),
  newFolderBtn: document.getElementById('new-folder-btn'),
  openNotesDirBtn: document.getElementById('open-notes-dir-btn'),

  emptyState: document.getElementById('empty-state'),
  noteView: document.getElementById('note-view'),

  noteTitle: document.getElementById('note-title'),  // <a> element now
  noteAuthor: document.getElementById('note-author'),
  noteUpdated: document.getElementById('note-updated'),

  favoriteBtn: document.getElementById('favorite-btn'),
  renameBtn: document.getElementById('rename-btn'),
  deleteBtn: document.getElementById('delete-btn'),
  downloadVideoBtn: document.getElementById('download-video-btn'),
  downloadStatus: document.getElementById('download-video-status'),
  openVideoBtn: document.getElementById('open-video-btn'),
  videoDialog: document.getElementById('video-dialog'),
  videoInfo: document.getElementById('video-info'),
  videoFormats: document.getElementById('video-formats'),
  videoProgress: document.getElementById('video-progress'),
  videoCancelBtn: document.getElementById('video-cancel-btn'),
  videoDownloadBtn: document.getElementById('video-download-btn'),

  modeEdit: document.getElementById('mode-edit'),
  modePreview: document.getElementById('mode-preview'),
  modeTldr: document.getElementById('mode-tldr'),
  regenerateBtn: document.getElementById('regenerate-btn'),
  notesBody: document.querySelector('.notes-body'),
  editor: document.getElementById('notes-editor'),
  preview: document.getElementById('notes-preview'),
  tldr: document.getElementById('notes-tldr'),
  saveStatus: document.getElementById('save-status'),
  tldrSlider: document.getElementById('tldr-length-slider'),
  tldrLabel: document.getElementById('tldr-length-label'),

  overlay: document.getElementById('progress-overlay'),
  progressText: document.getElementById('progress-text'),
  progressSteps: document.querySelectorAll('#progress-steps li'),

  // top-bar quick switcher
  activeProviderSelect: document.getElementById('active-provider-select'),

  // settings dialog
  dialog: document.getElementById('settings-dialog'),
  notesDir: document.getElementById('setting-notes-dir'),
  chooseDir: document.getElementById('choose-dir-btn'),
  providerList: document.getElementById('provider-list'),
  providerRowTemplate: document.getElementById('provider-row-template'),
  settingsClose: document.getElementById('settings-close'),
};

// ---------- provider templates ----------
const PROVIDER_TEMPLATES = {
  gemini: {
    label: 'Gemini',
    type: 'gemini',
    apiKey: '',
    model: 'gemini-2.0-flash',
    help: 'Free tier — get a key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>. ~1500 req/day on gemini-2.0-flash, 1M token context.',
  },
  groq: {
    label: 'Groq',
    type: 'openai-compatible',
    baseUrl: 'https://App.groq.com/openai/v1',
    apiKey: '',
    model: 'llama-3.3-70b-versatile',
    help: 'Free key at <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a>. Very fast, generous free quota.',
  },
  openrouter: {
    label: 'OpenRouter',
    type: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    help: 'Free models list at <a href="https://openrouter.ai/models?max_price=0" target="_blank" rel="noopener">openrouter.ai/models?max_price=0</a>. Get a key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>.',
  },
  ollama: {
    label: 'Ollama (local)',
    type: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    model: 'llama3.1:8b',
    help: 'Run <code>ollama pull llama3.1:8b</code> first. Leave the API key blank. Click ↻ next to Model to list installed models.',
  },
  lmstudio: {
    label: 'LM Studio (local)',
    type: 'openai-compatible',
    baseUrl: 'http://localhost:1234/v1',
    apiKey: '',
    model: '',
    help: 'In LM Studio, load a model and start the local server. Leave the API key blank. Click ↻ to fetch the loaded model name.',
  },
  custom: {
    label: 'Custom',
    type: 'openai-compatible',
    baseUrl: '',
    apiKey: '',
    model: '',
    help: 'Any OpenAI-compatible endpoint. Provide base URL (ending in /v1 or equivalent), key (if required), and model name.',
  },
};

// ---------- init ----------
async function init() {
  // Bind events FIRST so the UI is responsive even if the data load below fails.
  bindEvents();
  attachRootDropTarget(el.folderTree);
  try {
    state.settings = await App.getSettings();
    renderProviderSwitcher();
    await refreshTree();
  } catch (err) {
    showError('Startup error: ' + (err.message || err));
    console.error('Startup error:', err);
  }
}

function bindEvents() {
  el.generate.addEventListener('click', onGenerate);
  el.url.addEventListener('keydown', (e) => { if (e.key === 'Enter') onGenerate(); });

  el.openFolder.addEventListener('click', () => App.openNotesDir());
  el.settings.addEventListener('click', openSettings);
  el.settingsClose.addEventListener('click', onSettingsDone);
  el.chooseDir.addEventListener('click', async () => {
    const dir = await App.chooseNotesDir();
    if (dir) {
      state.settings = await App.saveSettings({ notesDir: dir });
      el.notesDir.value = dir;
      await refreshTree();
    }
  });

  // template buttons
  el.dialog.querySelectorAll('.add-provider button').forEach((btn) => {
    btn.addEventListener('click', () => onAddProvider(btn.dataset.template));
  });

  // top-bar provider switcher
  el.activeProviderSelect.addEventListener('change', async (e) => {
    state.settings = await App.setActiveProvider(e.target.value);
    renderProviderSwitcher();
    if (el.dialog.open) renderProviderList();
  });

  el.newFolderBtn.addEventListener('click', onNewFolder);
  el.openNotesDirBtn.addEventListener('click', () => App.openNotesDir());
  el.downloadVideoBtn.addEventListener('click', onDownloadVideo);
  el.openVideoBtn.addEventListener('click', onOpenVideo);
  el.videoCancelBtn.addEventListener('click', () => el.videoDialog.close());
  el.favoriteBtn.addEventListener('click', onToggleFavorite);
  el.renameBtn.addEventListener('click', onRename);
  el.deleteBtn.addEventListener('click', onDelete);

  el.modeEdit.addEventListener('click', () => setMode('edit'));
  el.modePreview.addEventListener('click', () => setMode('preview'));
  el.modeTldr.addEventListener('click', () => setMode('tldr'));
  el.regenerateBtn.addEventListener('click', onRegenerateSummary);
  el.tldrSlider.addEventListener('input', onTldrSliderInput);

  el.editor.addEventListener('input', onEditorInput);

  // Ctrl+S to save
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      flushSave();
    }
  });
}

// ---------- sidebar / tree ----------
async function refreshTree() {
  state.tree = await App.listNotes();
  renderFavorites();
  renderFolders();
}

function renderFavorites() {
  el.favoritesList.innerHTML = '';
  if (!state.tree.favorites.length) {
    el.favoritesList.innerHTML = `<li class="empty" style="color:var(--text-mute);font-style:italic;cursor:default;">No favorites yet</li>`;
    return;
  }
  for (const note of state.tree.favorites) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="star">★</span>${escapeHtml(note.title)}`;
    li.title = note.title;
    li.dataset.path = note.path;
    li.addEventListener('click', () => loadNote(note.path));
    if (state.current && state.current.path === note.path) li.classList.add('active');
    el.favoritesList.appendChild(li);
  }
}

function renderFolders() {
  el.folderTree.innerHTML = '';
  const { folders = [], notes = [] } = state.tree || {};
  if (!folders.length && !notes.length) {
    el.folderTree.innerHTML = '<div class="hint" style="padding:8px 14px;">No folders yet. Click + above to create one.</div>';
    return;
  }
  for (const folder of folders) {
    el.folderTree.appendChild(buildFolderNode(folder, /*isRoot=*/ true));
  }
  for (const note of notes) {
    el.folderTree.appendChild(buildNoteNode(note, /*hasArrow=*/ false));
  }
}

function buildFolderNode(folder, isRoot) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tree-folder';
  if (state.collapsedFolders.has(folder.path)) wrapper.classList.add('collapsed');

  const header = document.createElement('div');
  header.className = 'tree-folder-header';
  if (state.selectedFolderPath === folder.path) header.classList.add('selected');

  // drag-and-drop: the header IS the folder for DnD purposes (children are
  // their own draggables and contained inside .tree-children).
  attachDragSource(header, folder.path);
  attachDropTarget(header, folder.path);

  // arrow (toggles collapse, separate from the row click)
  const arrow = document.createElement('span');
  arrow.className = 'tree-arrow clickable';
  arrow.textContent = '▾';
  arrow.title = 'Collapse / expand';
  arrow.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.collapsedFolders.has(folder.path)) {
      state.collapsedFolders.delete(folder.path);
    } else {
      state.collapsedFolders.add(folder.path);
    }
    wrapper.classList.toggle('collapsed');
  });

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = '📁';

  const name = document.createElement('span');
  name.className = 'tree-folder-name';
  name.textContent = folder.name;
  name.title = folder.name;

  // Click anywhere on the row (except arrow / action buttons) selects this folder
  header.addEventListener('click', () => {
    state.selectedFolderPath = folder.path;
    renderFolders();
  });

  // ★ favorite toggle — always visible when favorited (acts as the indicator);
  // hidden until hover when not. Click toggles. Favorited folders refuse delete.
  const favBtn = document.createElement('button');
  favBtn.className = 'tree-fav-btn' + (folder.favorite ? ' is-favorite' : '');
  favBtn.title = folder.favorite
    ? `Unfavorite "${folder.name}" (re-enables delete)`
    : `Favorite "${folder.name}" (protects from deletion)`;
  favBtn.textContent = folder.favorite ? '★' : '☆';
  favBtn.draggable = false;
  favBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await App.toggleFolderFavorite(folder.path);
      await refreshTree();
    } catch (err) {
      showError(err.message || String(err));
    }
  });

  // other actions only appear on hover
  const actions = document.createElement('span');
  actions.className = 'tree-folder-actions';

  const addBtn = document.createElement('button');
  addBtn.className = 'tree-add-btn';
  addBtn.title = `New folder inside "${folder.name}"`;
  addBtn.textContent = '+';
  addBtn.draggable = false;
  addBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const subname = await promptModal({
      title: 'New folder',
      message: `Folder name (inside "${folder.name}"):`,
    });
    if (!subname) return;
    try {
      const newPath = await App.createFolder({ parent: folder.path, name: subname });
      state.collapsedFolders.delete(folder.path); // expand parent so new child is visible
      state.selectedFolderPath = newPath;          // auto-select the new folder
      await refreshTree();
    } catch (err) {
      showError(err.message || String(err));
    }
  });
  actions.appendChild(addBtn);

  const renameBtn = document.createElement('button');
  renameBtn.className = 'tree-rename-btn';
  renameBtn.title = `Rename "${folder.name}"`;
  renameBtn.textContent = '✎';
  renameBtn.draggable = false;
  renameBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const newName = await promptModal({
      title: 'Rename folder',
      message: 'New folder name:',
      defaultValue: folder.name,
      selectAll: true,
    });
    if (!newName || newName === folder.name) return;
    try {
      const res = await App.renameFolder({ path: folder.path, newName });
      // Remap any in-memory paths that point inside the renamed subtree
      if (state.current?.path) {
        state.current.path = remapPath(state.current.path, folder.path, res.path);
      }
      if (state.selectedFolderPath) {
        state.selectedFolderPath = remapPath(state.selectedFolderPath, folder.path, res.path);
      }
      const remappedCollapsed = new Set();
      for (const p of state.collapsedFolders) {
        remappedCollapsed.add(remapPath(p, folder.path, res.path));
      }
      state.collapsedFolders = remappedCollapsed;
      await refreshTree();
    } catch (err) {
      showError(err.message || String(err));
    }
  });
  actions.appendChild(renameBtn);

  // delete is always shown; backend refuses if folder is favorited
  const delBtn = document.createElement('button');
  delBtn.className = 'tree-delete-btn';
  delBtn.title = `Delete "${folder.name}" and everything inside it`;
  delBtn.textContent = '×';
  delBtn.draggable = false;
  delBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete folder "${folder.name}" and ALL its notes/subfolders? This cannot be undone.`)) return;
    try {
      await App.deleteFolder(folder.path);
      if (state.selectedFolderPath === folder.path
          || (state.selectedFolderPath && state.selectedFolderPath.startsWith(folder.path))) {
        state.selectedFolderPath = null;
      }
      if (state.current && state.current.path.startsWith(folder.path)) clearNoteView();
      await refreshTree();
    } catch (err) {
      showError(err.message || String(err));
    }
  });
  actions.appendChild(delBtn);

  header.append(arrow, icon, name, favBtn, actions);
  wrapper.appendChild(header);

  // children
  const children = document.createElement('div');
  children.className = 'tree-children';
  for (const sub of folder.folders || []) {
    children.appendChild(buildFolderNode(sub, /*isRoot=*/ false));
  }
  for (const note of folder.notes || []) {
    children.appendChild(buildNoteNode(note, /*hasArrow=*/ true));
  }
  wrapper.appendChild(children);
  return wrapper;
}

function buildNoteNode(note, hasArrowSlot) {
  const node = document.createElement('div');
  node.className = 'tree-note';
  if (state.current?.path === note.path) node.classList.add('active');

  // notes are draggable but NOT drop targets (they're not containers)
  attachDragSource(node, note.path);

  // empty arrow slot keeps note icons aligned with folder icons
  const arrowSlot = document.createElement('span');
  arrowSlot.className = 'tree-arrow empty';
  if (hasArrowSlot) node.appendChild(arrowSlot);

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = '📄';

  const name = document.createElement('span');
  name.className = 'tree-note-name';
  name.textContent = note.title;
  name.title = note.title;

  node.append(icon, name);

  if (note.favorite) {
    const star = document.createElement('span');
    star.className = 'tree-star';
    star.textContent = '★';
    node.appendChild(star);
  }

  node.addEventListener('click', () => loadNote(note.path));
  return node;
}

// ---------- drag and drop ----------

let dragSourcePath = null;

function attachDragSource(node, sourcePath) {
  node.draggable = true;
  node.dataset.path = sourcePath;
  node.addEventListener('dragstart', (e) => {
    // Don't start a drag when the gesture began on an interactive child
    // (action buttons, collapse arrow, input). Chromium otherwise enters a
    // drag-pending state that swallows the subsequent click on those
    // elements — which broke the New-Folder prompt's OK/Cancel path.
    if (e.target.closest('button, .tree-arrow, input, textarea')) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    dragSourcePath = sourcePath;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', sourcePath);
    node.classList.add('dragging');
  });
  node.addEventListener('dragend', () => {
    dragSourcePath = null;
    node.classList.remove('dragging');
    document.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
    el.folderTree.classList.remove('drop-target-root');
  });
}

function attachDropTarget(node, targetParentPath) {
  node.addEventListener('dragover', (e) => {
    if (!dragSourcePath) return;
    if (isSelfOrDescendant(dragSourcePath, targetParentPath)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    node.classList.add('drop-target');
  });
  node.addEventListener('dragleave', () => {
    node.classList.remove('drop-target');
  });
  node.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    node.classList.remove('drop-target');
    const sourcePath = e.dataTransfer.getData('text/plain') || dragSourcePath;
    if (!sourcePath) return;
    if (isSelfOrDescendant(sourcePath, targetParentPath)) return;
    await performMove(sourcePath, targetParentPath);
  });
}

function attachRootDropTarget(treeEl) {
  treeEl.addEventListener('dragover', (e) => {
    if (!dragSourcePath) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    treeEl.classList.add('drop-target-root');
  });
  treeEl.addEventListener('dragleave', (e) => {
    // only remove highlight when actually leaving the tree element
    if (e.target === treeEl) treeEl.classList.remove('drop-target-root');
  });
  treeEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    treeEl.classList.remove('drop-target-root');
    const sourcePath = e.dataTransfer.getData('text/plain') || dragSourcePath;
    if (!sourcePath) return;
    await performMove(sourcePath, null); // null = root (notesDir)
  });
}

async function performMove(sourcePath, targetParentPath) {
  try {
    const res = await App.moveEntry({ sourcePath, targetParent: targetParentPath });
    // Remap any in-memory paths that pointed inside the moved subtree
    if (state.current?.path) {
      state.current.path = remapPath(state.current.path, sourcePath, res.path);
    }
    if (state.selectedFolderPath) {
      state.selectedFolderPath = remapPath(state.selectedFolderPath, sourcePath, res.path);
    }
    // Remap collapsed-folder set too
    const remappedCollapsed = new Set();
    for (const p of state.collapsedFolders) {
      remappedCollapsed.add(remapPath(p, sourcePath, res.path));
    }
    state.collapsedFolders = remappedCollapsed;
    await refreshTree();
  } catch (err) {
    showError(err.message || String(err));
  }
}

// Returns true iff `child` is the same as `parent` or lives inside it.
// Handles both / and \ separators.
function isSelfOrDescendant(parent, child) {
  if (!parent || !child) return false;
  const p = parent.replace(/\\/g, '/');
  const c = child.replace(/\\/g, '/');
  return c === p || c.startsWith(p + '/');
}

// If `oldPath` lived inside `oldRoot`, rewrite it to live under `newRoot`.
function remapPath(oldPath, oldRoot, newRoot) {
  if (!oldPath || !oldRoot || !newRoot) return oldPath;
  const op = oldPath.replace(/\\/g, '/');
  const or = oldRoot.replace(/\\/g, '/');
  if (op === or) return newRoot;
  if (op.startsWith(or + '/')) {
    return newRoot + oldPath.slice(oldRoot.length);
  }
  return oldPath;
}

async function onNewFolder() {
  const name = await promptModal({ title: 'New folder', message: 'Folder name (at top level):' });
  if (!name) return;
  try {
    const newPath = await App.createFolder({ parent: null, name });
    state.selectedFolderPath = newPath; // auto-select so Generate works immediately
    await refreshTree();
  } catch (err) {
    showError(err.message || String(err));
  }
}

// ---------- promptModal: replacement for window.prompt() (which Electron disables) ----------
//
// Cleanup is driven by the dialog's native `close` event so the promise always
// resolves exactly once regardless of how the dialog ended (OK click, Cancel
// click, Escape, or external code calling dialog.close()).
function promptModal({ title = 'Enter value', message = '', defaultValue = '', selectAll = false } = {}) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('prompt-dialog');
    const input = document.getElementById('prompt-input');
    const ok = document.getElementById('prompt-ok');
    const cancel = document.getElementById('prompt-cancel');

    document.getElementById('prompt-title').textContent = title;
    document.getElementById('prompt-message').textContent = message;
    input.value = defaultValue || '';

    let result = null;
    const submit = () => {
      result = (input.value || '').trim() || null;
      dialog.close();
    };
    const dismiss = () => {
      result = null;
      dialog.close();
    };
    const onKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
      // Escape is handled by the browser's native <dialog> behavior, which
      // fires the close event — onClose below resolves with result=null.
    };
    const onClose = () => {
      ok.removeEventListener('click', submit);
      cancel.removeEventListener('click', dismiss);
      input.removeEventListener('keydown', onKey);
      dialog.removeEventListener('close', onClose);
      resolve(result);
    };

    ok.addEventListener('click', submit);
    cancel.addEventListener('click', dismiss);
    input.addEventListener('keydown', onKey);
    dialog.addEventListener('close', onClose);

    dialog.showModal();

    // Focus on the next animation frame so it lands AFTER the browser's
    // own dialog auto-focus (which would otherwise clobber ours).
    requestAnimationFrame(() => {
      input.focus();
      if (selectAll && input.value) {
        input.select();
      } else {
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    });
  });
}

// ---------- note loading / view ----------
async function loadNote(notePath) {
  await flushSave();
  try {
    const note = await App.loadNote(notePath);
    state.current = note;
    state.dirty = false;
    renderNoteView();
    renderFavorites();
    renderFolders(); // refresh active highlight
  } catch (err) {
    showError(err.message || String(err));
  }
}

function clearNoteView() {
  state.current = null;
  el.noteView.classList.add('hidden');
  el.emptyState.classList.remove('hidden');
  el.downloadStatus.hidden = true;
  el.downloadStatus.textContent = '';
}

function renderNoteView() {
  el.emptyState.classList.add('hidden');
  el.noteView.classList.remove('hidden');

  const { meta, content } = state.current;
  el.noteTitle.textContent = meta.title;
  el.noteTitle.href = meta.url || '#';
  el.noteAuthor.textContent = meta.author ? `by ${meta.author}` : '';
  el.noteUpdated.textContent = meta.updatedAt ? `updated ${formatDate(meta.updatedAt)}` : '';

  el.editor.value = content;
  el.preview.innerHTML = App.renderMarkdown(content);

  el.favoriteBtn.textContent = meta.favorite ? '★' : '☆';
  el.favoriteBtn.classList.toggle('active', !!meta.favorite);

  // Refresh the download-status caption ("✓ 720p saved" or hidden)
  updateDownloadStatus();

  // Restore this note's TL;DR slider value (default 5)
  const len = clampTldrLength(meta.tldrLength) || 5;
  el.tldrSlider.value = len;
  el.tldrLabel.textContent = `TL;DR: ${len}`;
  // Render any cached TL;DR markdown immediately (no LLM call until user enters TL;DR mode)
  el.tldr.innerHTML = meta.tldr
    ? App.renderMarkdown(meta.tldr)
    : `<p class="tldr-loading">Switch to TL;DR mode to generate a ${len}-bullet summary.</p>`;

  setSaveStatus('saved');
}

// ---------- editor ----------
let previewTimer = null;
function onEditorInput() {
  state.dirty = true;
  setSaveStatus('dirty');
  // debounce live preview render
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    el.preview.innerHTML = App.renderMarkdown(el.editor.value);
  }, 150);
  // debounced auto-save
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushSave, 1200);
}

async function flushSave() {
  if (!state.current || !state.dirty) return;
  clearTimeout(state.saveTimer);
  try {
    const res = await App.saveNote({ path: state.current.path, content: el.editor.value });
    state.current.content = el.editor.value;
    state.current.meta = res.meta;
    state.dirty = false;
    setSaveStatus('saved');
  } catch (err) {
    showError('Save failed: ' + (err.message || err));
  }
}

function setSaveStatus(s) {
  el.saveStatus.classList.remove('saved', 'dirty');
  if (s === 'saved') {
    el.saveStatus.textContent = 'Saved';
    el.saveStatus.classList.add('saved');
  } else if (s === 'dirty') {
    el.saveStatus.textContent = 'Unsaved...';
    el.saveStatus.classList.add('dirty');
  } else {
    el.saveStatus.textContent = s;
  }
}

function setMode(mode) {
  // 'edit' = editor + live preview side-by-side (default)
  // 'preview' = full-width preview
  // 'tldr' = full-width condensed-bullet summary (lazy-generated)
  el.modeEdit.classList.toggle('active', mode === 'edit');
  el.modePreview.classList.toggle('active', mode === 'preview');
  el.modeTldr.classList.toggle('active', mode === 'tldr');
  el.notesBody.classList.toggle('preview-only', mode === 'preview');
  el.notesBody.classList.toggle('tldr-only', mode === 'tldr');
  el.preview.innerHTML = App.renderMarkdown(el.editor.value);
  if (mode === 'tldr') ensureTldr();
}

function getCurrentMode() {
  if (el.notesBody.classList.contains('tldr-only')) return 'tldr';
  if (el.notesBody.classList.contains('preview-only')) return 'preview';
  return 'edit';
}

// ---------- TL;DR ----------

let tldrSliderTimer = null;
let tldrPending = false;

function onTldrSliderInput() {
  const len = clampTldrLength(parseInt(el.tldrSlider.value, 10));
  el.tldrLabel.textContent = `TL;DR: ${len}`;
  // If currently viewing TL;DR, debounce-regenerate so users can drag the
  // slider without firing N LLM calls.
  if (getCurrentMode() === 'tldr') {
    clearTimeout(tldrSliderTimer);
    tldrSliderTimer = setTimeout(ensureTldr, 800);
  }
}

function clampTldrLength(n) {
  if (!Number.isFinite(n)) return 5;
  return Math.max(3, Math.min(15, n));
}

async function ensureTldr() {
  if (!state.current) return;
  if (tldrPending) return; // a generation is already in flight
  const length = clampTldrLength(parseInt(el.tldrSlider.value, 10));
  const meta = state.current.meta;
  // Cache hit: same length AND a stored TL;DR exists -> render and stop.
  if (meta.tldr && meta.tldrLength === length) {
    el.tldr.innerHTML = App.renderMarkdown(meta.tldr);
    return;
  }
  // Cache miss: regenerate via the active LLM provider.
  tldrPending = true;
  el.tldr.innerHTML = `<p class="tldr-loading">Generating ${length}-bullet TL;DR... (a few seconds)</p>`;
  try {
    const res = await App.generateTldr({ notePath: state.current.path, length });
    state.current.meta = res.meta;
    el.tldr.innerHTML = App.renderMarkdown(res.tldr);
  } catch (err) {
    el.tldr.innerHTML = `<p class="tldr-error">Failed to generate TL;DR: ${escapeHtml(err.message || String(err))}</p>`;
  } finally {
    tldrPending = false;
  }
}

// ---------- note actions ----------
async function onToggleFavorite() {
  if (!state.current) return;
  const meta = await App.toggleFavorite(state.current.path);
  state.current.meta = meta;
  el.favoriteBtn.textContent = meta.favorite ? '★' : '☆';
  el.favoriteBtn.classList.toggle('active', !!meta.favorite);
  await refreshTree();
}

async function onRename() {
  if (!state.current) return;
  const newTitle = await promptModal({
    title: 'Rename note',
    message: 'New title:',
    defaultValue: state.current.meta.title,
    selectAll: true,
  });
  if (!newTitle || newTitle === state.current.meta.title) return;
  await flushSave();
  try {
    const res = await App.renameNote({ path: state.current.path, newTitle });
    state.current.path = res.path;
    state.current.meta = res.meta;
    el.noteTitle.textContent = res.meta.title;
    await refreshTree();
  } catch (err) {
    showError(err.message || err);
  }
}

async function onDelete() {
  if (!state.current) return;
  if (!confirm(`Delete "${state.current.meta.title}"? This cannot be undone.`)) return;
  await App.deleteNote(state.current.path);
  clearNoteView();
  await refreshTree();
}

// ---------- video download / playback ----------

async function onDownloadVideo() {
  if (!state.current) return;
  const url = state.current.meta.url;
  if (!url) {
    showError('This note has no associated YouTube URL.');
    return;
  }
  el.videoInfo.textContent = 'Loading available formats...';
  el.videoFormats.innerHTML = '';
  el.videoProgress.style.display = 'none';
  el.videoDownloadBtn.disabled = true;
  el.videoDialog.showModal();

  let info;
  try {
    info = await App.listVideoFormats(url);
  } catch (err) {
    el.videoInfo.textContent = 'Failed to load formats: ' + (err.message || err);
    return;
  }
  if (!info.formats.length) {
    el.videoInfo.textContent = 'No combined audio+video formats available for this video. (Pure JS download can\'t merge separate streams without ffmpeg.)';
    return;
  }

  const dur = info.durationSec;
  const minutes = dur ? `${Math.floor(dur/60)}m ${dur%60}s` : 'unknown duration';
  el.videoInfo.textContent = `${info.title} · ${minutes}`;

  let selectedItag = null;
  let selectedQuality = null;
  let selectedContainer = null;
  for (const f of info.formats) {
    const row = document.createElement('label');
    row.className = 'video-format-row';
    const sizeMb = f.contentLength ? `${(f.contentLength / 1024 / 1024).toFixed(1)} MB` : 'size unknown';
    const fps = f.fps ? `${f.fps} fps` : '';
    row.innerHTML = `
      <input type="radio" name="video-format" value="${f.itag}" />
      <span class="video-format-quality">${escapeHtml(f.qualityLabel)}</span>
      <span class="video-format-meta">${escapeHtml(f.container)}${fps ? ' · ' + fps : ''} · ${sizeMb}</span>
    `;
    row.querySelector('input').addEventListener('change', () => {
      selectedItag = f.itag;
      selectedQuality = f.qualityLabel;
      selectedContainer = f.container;
      el.videoDownloadBtn.disabled = false;
      [...el.videoFormats.querySelectorAll('.video-format-row')].forEach((r) => r.classList.remove('selected'));
      row.classList.add('selected');
    });
    el.videoFormats.appendChild(row);
  }

  // pre-select highest quality
  const first = el.videoFormats.querySelector('input[type="radio"]');
  if (first) first.click();

  el.videoDownloadBtn.onclick = async () => {
    if (!selectedItag) return;
    el.videoDownloadBtn.disabled = true;
    el.videoCancelBtn.disabled = true;
    el.videoProgress.style.display = '';
    el.videoProgress.textContent = 'Starting download...';
    const off = App.onVideoProgress((p) => {
      const dl = (p.downloaded / 1024 / 1024).toFixed(1);
      const tot = p.total ? (p.total / 1024 / 1024).toFixed(1) : '?';
      const pct = p.percent != null ? ` (${(p.percent * 100).toFixed(0)}%)` : '';
      el.videoProgress.textContent = `Downloading: ${dl} MB / ${tot} MB${pct}`;
    });
    try {
      const result = await App.downloadVideo({
        notePath: state.current.path,
        url,
        itag: selectedItag,
        qualityLabel: selectedQuality,
        container: selectedContainer,
      });
      const resolution = result.resolution || selectedQuality || '';
      // refresh the local note's meta in memory
      state.current.meta.videoFile = result.filename;
      state.current.meta.videoContainer = result.container;
      state.current.meta.videoResolution = resolution;
      el.videoProgress.textContent = `Done — saved as ${result.filename}${resolution ? ` (${resolution})` : ''}`;
      showInfo(resolution ? `Downloaded ${resolution} video.` : 'Video downloaded.');
      updateDownloadStatus();
      setTimeout(() => el.videoDialog.close(), 700);
    } catch (err) {
      el.videoProgress.textContent = 'Download failed: ' + (err.message || err);
    } finally {
      off();
      el.videoCancelBtn.disabled = false;
      el.videoDownloadBtn.disabled = false;
    }
  };
}

// Update the "✓ <resolution> saved" indicator under the Download Video button.
// Verifies the file actually exists on disk so a manually-deleted video doesn't
// leave a stale status visible.
async function updateDownloadStatus() {
  if (!state.current) {
    el.downloadStatus.hidden = true;
    return;
  }
  let local;
  try {
    local = await App.hasLocalVideo(state.current.path);
  } catch (_) {
    local = null;
  }
  if (!local) {
    el.downloadStatus.hidden = true;
    el.downloadStatus.textContent = '';
    return;
  }
  const res = state.current.meta.videoResolution;
  el.downloadStatus.textContent = res ? `✓ ${res} saved` : '✓ saved';
  el.downloadStatus.hidden = false;
}

async function onOpenVideo() {
  if (!state.current) return;
  const local = await App.hasLocalVideo(state.current.path);
  if (!local) {
    showInfo('No video downloaded yet — click "⬇ Video" first.');
    return;
  }
  try {
    await App.openVideoWindow({
      notePath: state.current.path,
      title: state.current.meta.title || 'Video',
    });
  } catch (err) {
    showError(err.message || String(err));
  }
}

// ---------- generate flow ----------
async function onGenerate() {
  const url = el.url.value.trim();
  if (!url) {
    showError('Paste a YouTube URL first.');
    return;
  }
  if (!state.selectedFolderPath) {
    showError('Pick a destination folder in the sidebar first — click any folder name to select it.');
    return;
  }
  if (!hasApiCreds()) {
    showError('Open Settings (⚙) and add an API key first.');
    openSettings();
    return;
  }

  el.generate.disabled = true;
  showOverlay(true);
  resetSteps();

  let metadata, transcript, summary, note;
  try {
    setStep('metadata', 'active', 'Fetching video info...');
    metadata = await App.fetchMetadata(url);
    setStep('metadata', 'done');

    setStep('transcript', 'active', 'Pulling transcript from YouTube...');
    const t = await App.fetchTranscript(url);
    transcript = t.text;
    setStep('transcript', 'done', `Transcript: ${t.segments} segments, ${transcript.length.toLocaleString()} chars`);

    setStep('summarize', 'active', 'Summarizing with LLM (this can take ~20-60s)...');
    summary = await App.summarize({ metadata, transcript });
    setStep('summarize', 'done');

    setStep('save', 'active', 'Saving notes...');
    note = await App.createNote({
      folderPath: state.selectedFolderPath,
      metadata,
      content: summary,
    });
    setStep('save', 'done');

    el.url.value = '';
    await refreshTree();
    await loadNote(note.path);
    showOverlay(false);
  } catch (err) {
    const stage = currentActiveStep();
    if (stage) setStep(stage, 'failed');
    showError(err.message || String(err));
    setTimeout(() => showOverlay(false), 1200);
  } finally {
    el.generate.disabled = false;
  }
}

// Regenerate the current note's summary from scratch. Re-fetches metadata,
// re-pulls the transcript, calls the active LLM, overwrites notes.md, and
// clears the TL;DR cache so it'll be rebuilt from the new content next
// time TL;DR is opened. Uses the same progress overlay as initial generation.
async function onRegenerateSummary() {
  if (!state.current) return;
  const url = state.current.meta.url;
  if (!url) {
    showError('This note has no associated YouTube URL.');
    return;
  }
  if (!hasApiCreds()) {
    showError('Open Settings (⚙) and add an API key first.');
    openSettings();
    return;
  }
  if (!confirm(
    'Regenerate the summary for this note?\n\n'
    + 'The current notes will be overwritten (any manual edits will be lost) '
    + 'and the cached TL;DR will be cleared so it rebuilds from the new content. '
    + 'The downloaded video file (if any) is unaffected.'
  )) return;

  // Make sure any in-flight auto-save lands on disk before we replace the file.
  await flushSave();

  el.regenerateBtn.disabled = true;
  el.regenerateBtn.classList.add('spinning');
  showOverlay(true);
  resetSteps();

  try {
    setStep('metadata', 'active', 'Refreshing video info...');
    const metadata = await App.fetchMetadata(url);
    setStep('metadata', 'done');

    setStep('transcript', 'active', 'Re-pulling transcript from YouTube...');
    const t = await App.fetchTranscript(url);
    setStep('transcript', 'done', `Transcript: ${t.segments} segments, ${t.text.length.toLocaleString()} chars`);

    setStep('summarize', 'active', 'Re-summarizing with LLM (this can take ~20-60s)...');
    const summary = await App.summarize({ metadata, transcript: t.text });
    setStep('summarize', 'done');

    setStep('save', 'active', 'Saving notes...');
    await App.saveNote({ path: state.current.path, content: summary });
    await App.clearTldr(state.current.path);
    // Reload from disk so state.current.meta reflects updatedAt + cleared tldr.
    const reloaded = await App.loadNote(state.current.path);
    state.current = reloaded;
    state.dirty = false;
    renderNoteView();
    setStep('save', 'done');

    showOverlay(false);
    showInfo('Summary regenerated.');
  } catch (err) {
    const stage = currentActiveStep();
    if (stage) setStep(stage, 'failed');
    showError(err.message || String(err));
    setTimeout(() => showOverlay(false), 1500);
  } finally {
    el.regenerateBtn.disabled = false;
    el.regenerateBtn.classList.remove('spinning');
  }
}

function hasApiCreds() {
  const provider = activeProvider();
  if (!provider) return false;
  if (provider.type === 'gemini') return !!provider.apiKey;
  if (provider.type === 'openai-compatible') return !!provider.baseUrl && !!provider.model;
  return false;
}

function activeProvider() {
  const s = state.settings || {};
  return (s.providers || []).find((p) => p.id === s.activeProviderId) || (s.providers || [])[0] || null;
}


function showOverlay(show) {
  el.overlay.classList.toggle('hidden', !show);
}
function resetSteps() {
  el.progressSteps.forEach((li) => li.classList.remove('active', 'done', 'failed'));
  el.progressText.textContent = 'Working...';
}
function setStep(name, status, msg) {
  el.progressSteps.forEach((li) => {
    if (li.dataset.step === name) {
      li.classList.remove('active', 'done', 'failed');
      li.classList.add(status);
    }
  });
  if (msg) el.progressText.textContent = msg;
}
function currentActiveStep() {
  for (const li of el.progressSteps) {
    if (li.classList.contains('active')) return li.dataset.step;
  }
  return null;
}

// ---------- settings dialog ----------
async function onSettingsDone() {
  // Auto-save any provider edit forms left open with unsaved changes,
  // then close. If a save fails we keep the dialog open so the user
  // can read the error and retry.
  const openForms = el.providerList.querySelectorAll('.provider-edit:not(.hidden)');
  let savedAny = false;
  for (const form of openForms) {
    if (typeof form._performSave === 'function') {
      try {
        await form._performSave();
        savedAny = true;
      } catch (err) {
        showError('Could not save changes: ' + (err.message || err));
        return; // leave the dialog open
      }
    }
  }
  if (savedAny) {
    renderProviderSwitcher();
    renderProviderList();
    showInfo('Saved.');
  }
  el.dialog.close();
}

async function openSettings() {
  state.settings = await App.getSettings();
  el.notesDir.value = state.settings.notesDir || '';
  renderProviderList();
  el.dialog.showModal();
}

function renderProviderList() {
  el.providerList.innerHTML = '';
  const providers = state.settings.providers || [];
  if (!providers.length) {
    el.providerList.innerHTML = `<div class="hint" style="padding:8px;">No providers yet — add one below.</div>`;
    return;
  }
  for (const provider of providers) {
    el.providerList.appendChild(buildProviderRow(provider));
  }
}

function buildProviderRow(provider) {
  const node = el.providerRowTemplate.content.firstElementChild.cloneNode(true);
  const isActive = state.settings.activeProviderId === provider.id;
  if (isActive) node.classList.add('active');

  // summary
  const radio = node.querySelector('input[type="radio"]');
  radio.value = provider.id;
  radio.checked = isActive;
  radio.addEventListener('change', async () => {
    state.settings = await App.setActiveProvider(provider.id);
    renderProviderSwitcher();
    renderProviderList();
  });

  node.querySelector('.provider-label-text').textContent = provider.label;
  node.querySelector('.provider-type-tag').textContent = provider.type === 'gemini' ? 'gemini' : 'openai-api';
  node.querySelector('.provider-detail').textContent = describeProvider(provider);

  const editForm = node.querySelector('.provider-edit');
  const testBtn = node.querySelector('.test-btn');
  const editBtn = node.querySelector('.edit-btn');
  const deleteBtn = node.querySelector('.delete-btn');

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    const oldText = testBtn.textContent;
    testBtn.textContent = 'Testing...';
    try {
      const result = await App.testProvider(provider.id);
      const pill = document.createElement('div');
      pill.className = 'test-result ' + (result.ok ? 'ok' : 'err');
      pill.textContent = result.ok ? `OK · "${result.response}"` : `Failed: ${result.error}`;
      // Place the pill on its own row below the summary so long error
      // messages wrap freely without squashing the action buttons.
      node.querySelectorAll('.test-result').forEach((p) => p.remove());
      node.querySelector('.provider-summary').insertAdjacentElement('afterend', pill);
      // Errors stay until next test or click-to-dismiss; OK auto-clears.
      pill.title = 'Click to dismiss';
      pill.style.cursor = 'pointer';
      pill.addEventListener('click', () => pill.remove());
      if (result.ok) setTimeout(() => pill.remove(), 7000);
    } catch (err) {
      showError(err.message || String(err));
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = oldText;
    }
  });

  editBtn.addEventListener('click', () => toggleEditForm(node, provider));
  deleteBtn.addEventListener('click', async () => {
    if (!confirm(`Delete provider "${provider.label}"?`)) return;
    state.settings = await App.deleteProvider(provider.id);
    renderProviderSwitcher();
    renderProviderList();
  });

  // Pre-populate edit form (kept hidden until Edit clicked)
  populateEditForm(editForm, provider);

  return node;
}

function describeProvider(provider) {
  if (provider.type === 'gemini') {
    const key = provider.apiKey ? 'key set' : 'no key';
    return `${provider.model || '(no model)'} · ${key}`;
  }
  const url = provider.baseUrl || '(no URL)';
  const key = provider.apiKey ? 'key set' : 'no key';
  return `${url} · ${provider.model || '(no model)'} · ${key}`;
}

function populateEditForm(form, provider) {
  form.querySelector('.f-label').value = provider.label || '';
  const baseWrap = form.querySelector('.f-baseurl-wrap');
  baseWrap.classList.toggle('hidden-field', provider.type === 'gemini');
  form.querySelector('.f-baseurl').value = provider.baseUrl || '';
  form.querySelector('.f-apikey').value = provider.apiKey || '';
  form.querySelector('.f-model').value = provider.model || '';
  form.querySelector('.provider-help').innerHTML = templateHelpFor(provider);
  const select = form.querySelector('.f-model-select');
  select.innerHTML = '';
  select.classList.add('hidden');
}

function templateHelpFor(provider) {
  // Match against known templates by base URL or type
  if (provider.type === 'gemini') return PROVIDER_TEMPLATES.gemini.help;
  const url = (provider.baseUrl || '').toLowerCase();
  if (url.includes('groq.com')) return PROVIDER_TEMPLATES.groq.help;
  if (url.includes('openrouter.ai')) return PROVIDER_TEMPLATES.openrouter.help;
  if (url.includes('11434')) return PROVIDER_TEMPLATES.ollama.help;
  if (url.includes('1234')) return PROVIDER_TEMPLATES.lmstudio.help;
  return PROVIDER_TEMPLATES.custom.help;
}

function toggleEditForm(node, provider) {
  const form = node.querySelector('.provider-edit');
  const open = !form.classList.contains('hidden');
  if (open) {
    form.classList.add('hidden');
    return;
  }
  populateEditForm(form, provider);
  form.classList.remove('hidden');

  // wire one-time handlers each open (overwrite by replacing with cloned nodes is overkill; track with dataset)
  if (!form.dataset.wired) {
    form.dataset.wired = '1';

    form.querySelector('.cancel-edit').addEventListener('click', () => {
      form.classList.add('hidden');
    });

    // Expose the save action on the form node so Done can invoke it for any
    // edit form left open with unsaved changes.
    form._performSave = async () => {
      const patch = {
        label: form.querySelector('.f-label').value.trim(),
        apiKey: form.querySelector('.f-apikey').value,
        model: form.querySelector('.f-model').value.trim(),
      };
      if (provider.type === 'openai-compatible') {
        patch.baseUrl = form.querySelector('.f-baseurl').value.trim();
      }
      const res = await App.updateProvider(provider.id, patch);
      state.settings = res.settings;
      return res;
    };

    form.querySelector('.save-edit').addEventListener('click', async () => {
      try {
        await form._performSave();
        renderProviderSwitcher();
        renderProviderList();
        showInfo('Saved.');
      } catch (err) {
        showError(err.message || String(err));
      }
    });

    form.querySelector('.refresh-models-btn').addEventListener('click', async () => {
      const btn = form.querySelector('.refresh-models-btn');
      btn.disabled = true;
      const oldText = btn.textContent;
      btn.textContent = '...';
      // Save current edit values first so test uses them
      try {
        const tempPatch = {
          label: form.querySelector('.f-label').value.trim(),
          apiKey: form.querySelector('.f-apikey').value,
          model: form.querySelector('.f-model').value.trim(),
        };
        if (provider.type === 'openai-compatible') {
          tempPatch.baseUrl = form.querySelector('.f-baseurl').value.trim();
        }
        const updated = await App.updateProvider(provider.id, tempPatch);
        state.settings = updated.settings;

        const models = await App.fetchModels(provider.id);
        const select = form.querySelector('.f-model-select');
        select.innerHTML = '<option value="">— pick a model —</option>' +
          models.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
        select.classList.remove('hidden');
        select.onchange = () => {
          if (select.value) {
            form.querySelector('.f-model').value = select.value;
          }
        };
        if (!models.length) showInfo('Endpoint returned an empty model list.');
        else showInfo(`Found ${models.length} model${models.length === 1 ? '' : 's'}.`);
      } catch (err) {
        showError('Failed to fetch models: ' + (err.message || err));
      } finally {
        btn.disabled = false;
        btn.textContent = oldText;
      }
    });
  }
}

async function onAddProvider(templateName) {
  const template = PROVIDER_TEMPLATES[templateName];
  if (!template) return;
  const { settings, provider } = await App.addProvider({
    label: template.label,
    type: template.type,
    apiKey: template.apiKey || '',
    model: template.model || '',
    baseUrl: template.baseUrl || '',
  });
  state.settings = settings;
  renderProviderSwitcher();
  renderProviderList();
  // auto-expand the new provider's edit form
  setTimeout(() => {
    const newRow = el.providerList.querySelector(`input[type="radio"][value="${CSS.escape(provider.id)}"]`)
      ?.closest('.provider-row');
    if (newRow) toggleEditForm(newRow, provider);
  }, 50);
}

function renderProviderSwitcher() {
  const providers = (state.settings || {}).providers || [];
  const activeId = state.settings?.activeProviderId;
  if (!providers.length) {
    el.activeProviderSelect.innerHTML = `<option value="">none configured</option>`;
    return;
  }
  el.activeProviderSelect.innerHTML = providers
    .map((p) => `<option value="${escapeHtml(p.id)}"${p.id === activeId ? ' selected' : ''}>${escapeHtml(p.label)}</option>`)
    .join('');
}

// ---------- toast / utils ----------
function showError(msg) {
  toast(msg, 'error');
}
function showInfo(msg) {
  toast(msg, 'info');
}
function toast(msg, kind) {
  const t = document.createElement('div');
  t.className = 'toast' + (kind === 'info' ? ' info' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch (_) {
    return iso;
  }
}

init();
