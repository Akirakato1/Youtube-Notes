const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_FOLDER = '_Inbox';
const META_FILE = 'meta.json';
const NOTES_FILE = 'notes.md';
const FOLDER_META = '.folder.json';   // hidden per-folder metadata (favorite flag, etc.)

let userDataDir = null;
let configPath = null;

function init(userDataPath) {
  userDataDir = userDataPath;
  configPath = path.join(userDataDir, 'config.json');
  ensureSettingsExist();
  ensureNotesDir();
}

// ---------- settings ----------

function defaultSettings() {
  const geminiId = 'gemini-default';
  return {
    notesDir: path.join(os.homedir(), 'YouTubeNotes'),
    activeProviderId: geminiId,
    providers: [
      {
        id: geminiId,
        label: 'Gemini (free)',
        type: 'gemini',
        apiKey: '',
        model: 'gemini-2.0-flash',
      },
    ],
  };
}

function ensureSettingsExist() {
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(defaultSettings(), null, 2), 'utf8');
  }
}

function migrateSettings(raw) {
  if (!raw || typeof raw !== 'object') return defaultSettings();
  // Already in new shape
  if (Array.isArray(raw.providers)) return raw;
  // Old flat shape: convert to providers list
  const providers = [];
  if (raw.geminiApiKey || raw.geminiModel) {
    providers.push({
      id: 'gemini-default',
      label: 'Gemini',
      type: 'gemini',
      apiKey: raw.geminiApiKey || '',
      model: raw.geminiModel || 'gemini-2.0-flash',
    });
  }
  if (raw.openaiBaseUrl || raw.openaiModel || raw.openaiApiKey) {
    providers.push({
      id: 'openai-default',
      label: detectProviderLabel(raw.openaiBaseUrl) || 'OpenAI-compatible',
      type: 'openai-compatible',
      baseUrl: raw.openaiBaseUrl || '',
      apiKey: raw.openaiApiKey || '',
      model: raw.openaiModel || '',
    });
  }
  if (providers.length === 0) {
    providers.push(defaultSettings().providers[0]);
  }
  const activeProviderId = raw.provider === 'openai-compatible' && providers.find((p) => p.id === 'openai-default')
    ? 'openai-default'
    : providers[0].id;
  return {
    notesDir: raw.notesDir || defaultSettings().notesDir,
    activeProviderId,
    providers,
  };
}

function detectProviderLabel(baseUrl) {
  if (!baseUrl) return null;
  const url = String(baseUrl).toLowerCase();
  if (url.includes('groq.com')) return 'Groq';
  if (url.includes('openrouter.ai')) return 'OpenRouter';
  if (url.includes('localhost:11434') || url.includes('127.0.0.1:11434')) return 'Ollama (local)';
  if (url.includes('localhost:1234') || url.includes('127.0.0.1:1234')) return 'LM Studio (local)';
  if (url.includes('together.xyz')) return 'Together AI';
  if (url.includes('deepseek.com')) return 'DeepSeek';
  return null;
}

function getSettings() {
  ensureSettingsExist();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (_) {
    return defaultSettings();
  }
  const migrated = migrateSettings(raw);
  // Persist migration if shape changed
  if (!Array.isArray(raw.providers)) {
    fs.writeFileSync(configPath, JSON.stringify(migrated, null, 2), 'utf8');
  }
  return migrated;
}

function writeSettings(settings) {
  fs.writeFileSync(configPath, JSON.stringify(settings, null, 2), 'utf8');
  return settings;
}

function saveSettings(patch) {
  const current = getSettings();
  // Only allow patching top-level scalars (notesDir, activeProviderId).
  // Provider list mutations go through the dedicated helpers below.
  const merged = { ...current };
  if (patch.notesDir !== undefined) merged.notesDir = patch.notesDir;
  if (patch.activeProviderId !== undefined) merged.activeProviderId = patch.activeProviderId;
  writeSettings(merged);
  ensureNotesDir();
  return merged;
}

// ---------- providers ----------

function newProviderId(type) {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function sanitizeProvider(p) {
  if (!p || typeof p !== 'object') throw new Error('Invalid provider object.');
  if (p.type !== 'gemini' && p.type !== 'openai-compatible') {
    throw new Error('Provider type must be "gemini" or "openai-compatible".');
  }
  const out = {
    id: p.id || newProviderId(p.type),
    label: (p.label || '').trim() || (p.type === 'gemini' ? 'Gemini' : 'OpenAI-compatible'),
    type: p.type,
    apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
    model: (typeof p.model === 'string' ? p.model : '').trim(),
  };
  if (p.type === 'openai-compatible') {
    out.baseUrl = (typeof p.baseUrl === 'string' ? p.baseUrl : '').trim().replace(/\/+$/, '');
  }
  return out;
}

function addProvider(template) {
  const settings = getSettings();
  const provider = sanitizeProvider({ ...template, id: newProviderId(template.type) });
  settings.providers.push(provider);
  if (!settings.activeProviderId) settings.activeProviderId = provider.id;
  writeSettings(settings);
  return { settings, provider };
}

function updateProvider(id, patch) {
  const settings = getSettings();
  const idx = settings.providers.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error('Provider not found: ' + id);
  const merged = sanitizeProvider({ ...settings.providers[idx], ...patch, id });
  settings.providers[idx] = merged;
  writeSettings(settings);
  return { settings, provider: merged };
}

function deleteProvider(id) {
  const settings = getSettings();
  settings.providers = settings.providers.filter((p) => p.id !== id);
  if (settings.activeProviderId === id) {
    settings.activeProviderId = settings.providers[0]?.id || null;
  }
  writeSettings(settings);
  return settings;
}

function setActiveProvider(id) {
  const settings = getSettings();
  if (!settings.providers.find((p) => p.id === id)) throw new Error('Provider not found: ' + id);
  settings.activeProviderId = id;
  writeSettings(settings);
  return settings;
}

function getProvider(id) {
  const settings = getSettings();
  return settings.providers.find((p) => p.id === id) || null;
}

function getActiveProvider() {
  const settings = getSettings();
  return settings.providers.find((p) => p.id === settings.activeProviderId) || settings.providers[0] || null;
}

function ensureNotesDir() {
  const { notesDir } = getSettings();
  fs.mkdirSync(notesDir, { recursive: true });
  // Only seed _Inbox on first launch (when notesDir has no subfolders).
  // Once the user has any folder structure, don't recreate _Inbox if they
  // renamed/deleted it.
  const entries = fs.readdirSync(notesDir, { withFileTypes: true });
  const hasSubfolders = entries.some((e) => e.isDirectory());
  if (!hasSubfolders) {
    fs.mkdirSync(path.join(notesDir, DEFAULT_FOLDER), { recursive: true });
  }
}

function readFolderMeta(folderPath) {
  return readJson(path.join(folderPath, FOLDER_META)) || {};
}

function writeFolderMeta(folderPath, meta) {
  fs.writeFileSync(path.join(folderPath, FOLDER_META), JSON.stringify(meta, null, 2), 'utf8');
}

function toggleFolderFavorite(folderPath) {
  if (!folderPath || !fs.existsSync(folderPath)) {
    throw new Error('Folder not found.');
  }
  if (!isInsideNotesDir(folderPath)) {
    throw new Error('Folder is outside the notes directory.');
  }
  const meta = readFolderMeta(folderPath);
  meta.favorite = !meta.favorite;
  writeFolderMeta(folderPath, meta);
  return meta;
}

// ---------- helpers ----------

function sanitizeName(name) {
  // strip characters illegal on Windows + control chars, collapse whitespace
  return (name || 'Untitled')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Untitled';
}

function uniqueDir(parent, baseName) {
  let candidate = path.join(parent, baseName);
  if (!fs.existsSync(candidate)) return candidate;
  let i = 2;
  while (fs.existsSync(path.join(parent, `${baseName} (${i})`))) i++;
  return path.join(parent, `${baseName} (${i})`);
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function isNoteDir(dir) {
  return fs.existsSync(path.join(dir, META_FILE)) && fs.existsSync(path.join(dir, NOTES_FILE));
}

// Guard: any user-supplied path must resolve under the configured notes dir,
// so that "create"/"delete" operations can't escape via "..".
function isInsideNotesDir(p) {
  const { notesDir } = getSettings();
  const resolvedNotes = path.resolve(notesDir);
  const resolved = path.resolve(p);
  return resolved === resolvedNotes || resolved.startsWith(resolvedNotes + path.sep);
}

// ---------- notes ----------

function createNote({ folderPath, metadata, content }) {
  ensureNotesDir();
  const { notesDir } = getSettings();
  const targetFolder = folderPath || path.join(notesDir, DEFAULT_FOLDER);
  if (!isInsideNotesDir(targetFolder)) {
    throw new Error('Cannot create note outside the notes directory.');
  }
  fs.mkdirSync(targetFolder, { recursive: true });

  const baseName = sanitizeName(metadata.title || `Video ${metadata.videoId}`);
  const noteDir = uniqueDir(targetFolder, baseName);
  fs.mkdirSync(noteDir, { recursive: true });

  const now = new Date().toISOString();
  const meta = {
    videoId: metadata.videoId,
    url: metadata.url,
    title: metadata.title,
    author: metadata.author || '',
    authorUrl: metadata.authorUrl || '',
    thumbnail: metadata.thumbnail || '',
    favorite: false,
    createdAt: now,
    updatedAt: now,
  };

  fs.writeFileSync(path.join(noteDir, META_FILE), JSON.stringify(meta, null, 2), 'utf8');
  fs.writeFileSync(path.join(noteDir, NOTES_FILE), content || '', 'utf8');

  return { path: noteDir, meta, content: content || '' };
}

function loadNote(notePath) {
  if (!notePath || !fs.existsSync(notePath)) throw new Error('Note not found.');
  const meta = readJson(path.join(notePath, META_FILE));
  if (!meta) throw new Error('Note metadata missing or corrupted.');
  const content = fs.readFileSync(path.join(notePath, NOTES_FILE), 'utf8');
  return { path: notePath, meta, content };
}

function saveNote({ path: notePath, content }) {
  if (!notePath || !fs.existsSync(notePath)) throw new Error('Note path does not exist.');
  fs.writeFileSync(path.join(notePath, NOTES_FILE), content, 'utf8');
  const metaFile = path.join(notePath, META_FILE);
  const meta = readJson(metaFile) || {};
  meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf8');
  return { path: notePath, meta };
}

function setNoteVideo({ path: notePath, filename, container, resolution }) {
  if (!notePath || !fs.existsSync(notePath)) throw new Error('Note not found.');
  const metaFile = path.join(notePath, META_FILE);
  const meta = readJson(metaFile) || {};
  meta.videoFile = filename;
  meta.videoContainer = container;
  meta.videoResolution = resolution;
  // Reset last position when a fresh download replaces the file — the new
  // video might have a different length, and resuming partway through a
  // freshly-downloaded video is rarely what the user wants.
  meta.videoLastPosition = 0;
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

// Persist the current playback position for a note's video, so reopening
// the player resumes where the user left off. Called frequently during
// playback (throttled at the renderer side), so this is best-effort and
// should not throw on transient errors.
function setNoteVideoPosition({ path: notePath, position }) {
  try {
    if (!notePath || !fs.existsSync(notePath)) return;
    const metaFile = path.join(notePath, META_FILE);
    const meta = readJson(metaFile) || {};
    meta.videoLastPosition = Math.max(0, Number(position) || 0);
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf8');
  } catch (_) { /* best-effort */ }
}

function setNoteTldr({ path: notePath, tldr, tldrLength }) {
  if (!notePath || !fs.existsSync(notePath)) throw new Error('Note not found.');
  const metaFile = path.join(notePath, META_FILE);
  const meta = readJson(metaFile) || {};
  meta.tldr = tldr || '';
  meta.tldrLength = tldrLength;
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

function toggleFavorite(notePath) {
  const metaFile = path.join(notePath, META_FILE);
  const meta = readJson(metaFile);
  if (!meta) throw new Error('Note metadata missing.');
  meta.favorite = !meta.favorite;
  meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

function deleteNote(notePath) {
  if (!notePath || !fs.existsSync(notePath)) return;
  fs.rmSync(notePath, { recursive: true, force: true });
}

function renameNote({ path: notePath, newTitle }) {
  if (!notePath || !fs.existsSync(notePath)) throw new Error('Note not found.');
  const parent = path.dirname(notePath);
  const newDir = uniqueDir(parent, sanitizeName(newTitle));
  fs.renameSync(notePath, newDir);

  const metaFile = path.join(newDir, META_FILE);
  const meta = readJson(metaFile) || {};
  meta.title = newTitle;
  meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf8');
  return { path: newDir, meta };
}

// ---------- folders (now nestable) ----------

function createFolder({ parent, name }) {
  ensureNotesDir();
  const { notesDir } = getSettings();
  const parentDir = parent || notesDir;
  if (!isInsideNotesDir(parentDir)) {
    throw new Error('Parent folder is outside the notes directory.');
  }
  const folderPath = path.join(parentDir, sanitizeName(name));
  fs.mkdirSync(folderPath, { recursive: true });
  return folderPath;
}

function renameFolder({ path: folderPath, newName }) {
  if (!folderPath || !fs.existsSync(folderPath)) {
    throw new Error('Folder not found.');
  }
  if (!isInsideNotesDir(folderPath)) {
    throw new Error('Folder is outside the notes directory.');
  }
  const sanitized = sanitizeName(newName);
  const currentName = path.basename(folderPath);
  if (sanitized === currentName) return { path: folderPath }; // no change
  const parent = path.dirname(folderPath);
  const newPath = uniqueDir(parent, sanitized);
  fs.renameSync(folderPath, newPath);
  return { path: newPath };
}

function deleteFolder(folderPath) {
  if (!folderPath) return;
  const { notesDir } = getSettings();
  const resolved = path.resolve(folderPath);
  const resolvedNotes = path.resolve(notesDir);
  if (resolved === resolvedNotes) return; // never delete the root
  if (!isInsideNotesDir(resolved)) return; // safety
  // Refuse to delete favorited folders. User must unfavorite first.
  const meta = readFolderMeta(resolved);
  if (meta.favorite) {
    throw new Error('Folder is marked favorite. Click the ★ to unfavorite it before deleting.');
  }
  if (fs.existsSync(resolved)) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

// Walk notesDir recursively. A directory containing meta.json + notes.md
// is treated as a "note" leaf; anything else is a "folder" that can contain
// further folders and notes.
function walkTree(dir, favorites) {
  const folders = [];
  const notes = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return { folders, notes };
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const childPath = path.join(dir, e.name);
    if (isNoteDir(childPath)) {
      const meta = readJson(path.join(childPath, META_FILE));
      if (!meta) continue;
      const noteEntry = {
        path: childPath,
        title: meta.title || e.name,
        videoId: meta.videoId,
        thumbnail: meta.thumbnail,
        favorite: !!meta.favorite,
        updatedAt: meta.updatedAt,
      };
      notes.push(noteEntry);
      if (noteEntry.favorite) favorites.push(noteEntry);
    } else {
      const sub = walkTree(childPath, favorites);
      folders.push({
        name: e.name,
        path: childPath,
        favorite: !!readFolderMeta(childPath).favorite,
        folders: sub.folders,
        notes: sub.notes,
      });
    }
  }
  notes.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  folders.sort((a, b) => {
    if (a.name === DEFAULT_FOLDER) return -1;
    if (b.name === DEFAULT_FOLDER) return 1;
    return a.name.localeCompare(b.name);
  });
  return { folders, notes };
}

// Move a folder or a note into a different parent folder. Works for both
// because notes ARE directories on disk (they just contain meta.json + notes.md).
function moveEntry({ sourcePath, targetParent }) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error('Source not found.');
  }
  ensureNotesDir();
  const { notesDir } = getSettings();
  const targetDir = targetParent || notesDir;

  if (!isInsideNotesDir(sourcePath)) throw new Error('Source is outside the notes directory.');
  if (!isInsideNotesDir(targetDir)) throw new Error('Target is outside the notes directory.');

  const src = path.resolve(sourcePath);
  const tgt = path.resolve(targetDir);

  // Drop on self → no-op
  if (src === tgt) return { path: src };
  // Can't move a folder into itself or any of its descendants
  if (tgt === src || tgt.startsWith(src + path.sep)) {
    throw new Error('Cannot move a folder into itself or one of its descendants.');
  }
  // Already inside the target parent → no-op
  if (path.dirname(src) === tgt) return { path: src };

  fs.mkdirSync(tgt, { recursive: true });
  const baseName = path.basename(src);
  const newPath = uniqueDir(tgt, baseName);
  fs.renameSync(src, newPath);

  // For a note, bump updatedAt so it sorts to the top of its new folder
  if (isNoteDir(newPath)) {
    const metaFile = path.join(newPath, META_FILE);
    const meta = readJson(metaFile);
    if (meta) {
      meta.updatedAt = new Date().toISOString();
      fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf8');
    }
  }
  return { path: newPath };
}

function listNotes() {
  ensureNotesDir();
  const { notesDir } = getSettings();
  const favorites = [];
  const root = walkTree(notesDir, favorites);
  favorites.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return {
    notesDir,
    folders: root.folders,   // root-level folders, each with nested folders/notes
    notes: root.notes,       // any notes saved at root (rare)
    favorites,
  };
}

module.exports = {
  init,
  getSettings,
  saveSettings,
  addProvider,
  updateProvider,
  deleteProvider,
  setActiveProvider,
  getProvider,
  getActiveProvider,
  createNote,
  loadNote,
  saveNote,
  setNoteVideo,
  setNoteVideoPosition,
  setNoteTldr,
  toggleFavorite,
  deleteNote,
  renameNote,
  createFolder,
  renameFolder,
  deleteFolder,
  toggleFolderFavorite,
  moveEntry,
  listNotes,
};
