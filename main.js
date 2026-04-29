const { app, BrowserWindow, Menu, ipcMain, dialog, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('node:stream');
const dns = require('dns');
const { pathToFileURL } = require('url');

// Prefer IPv4 when resolving hostnames. Node 18+ defaults to IPv6-first, but
// LM Studio / Ollama / many local dev servers bind only to 127.0.0.1, so
// "localhost" resolves to ::1 and the connection is refused even though the
// server is running.
dns.setDefaultResultOrder('ipv4first');

// Custom protocol for safely serving local video files to renderer windows.
// This must be registered BEFORE app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } },
]);

// MIME types we'll serve through media://. Anything else falls back to
// application/octet-stream which the <video> element will refuse to play —
// that's intentional, since this protocol is meant for media files only.
const MEDIA_MIME_TYPES = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  m4a: 'audio/mp4',
};

// Serve a local file with HTTP Range support so <video controls> can seek.
// `request` is the Web Request from protocol.handle.
async function serveLocalFile(filePath, request) {
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (_) {
    return new Response('Not Found', { status: 404 });
  }
  const size = stat.size;
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = MEDIA_MIME_TYPES[ext] || 'application/octet-stream';

  const rangeHeader = request.headers.get('range');
  if (rangeHeader) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
    if (m) {
      const start = parseInt(m[1], 10);
      const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
      // Reject malformed or unsatisfiable ranges per RFC 7233.
      if (Number.isNaN(start) || start > end || start >= size) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' },
        });
      }
      const length = end - start + 1;
      const nodeStream = fs.createReadStream(filePath, { start, end });
      // Convert node stream → web ReadableStream so it can be the body of a Response.
      return new Response(Readable.toWeb(nodeStream), {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(length),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        },
      });
    }
  }

  // No Range header (or unparseable) → return the whole file but ALWAYS
  // advertise Accept-Ranges so the browser knows it can seek next time.
  const nodeStream = fs.createReadStream(filePath);
  return new Response(Readable.toWeb(nodeStream), {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    },
  });
}

const transcript = require('./src/transcript');
const metadata = require('./src/metadata');
const summarizer = require('./src/summarizer');
const storage = require('./src/storage');
const video = require('./src/video');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'YouTube Notes',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,        // preload needs to require('marked') from node_modules
      webviewTag: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  storage.init(app.getPath('userData'));
  Menu.setApplicationMenu(null); // hide the default File/Edit/View/... menu bar

  // Serve local video files via media:// to the player window with HTTP
  // Range support so the <video> element can seek/scrub. Validates that
  // the requested file is inside notesDir as a safety guard.
  //
  // Why we don't just net.fetch a file:// URL: Electron has long-standing
  // issues forwarding Range requests through custom protocols when the
  // backing source is the built-in file loader (electron/electron#38749),
  // which makes the timeline non-draggable. Reading the file ourselves
  // with fs.createReadStream({ start, end }) and returning a 206 with
  // Content-Range gives <video> exactly what it needs to seek.
  protocol.handle('media', async (request) => {
    let filePath;
    try {
      const u = new URL(request.url);
      filePath = decodeURIComponent(u.pathname);
    } catch (_) {
      return new Response('Bad URL', { status: 400 });
    }
    if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }
    const settings = storage.getSettings();
    const resolved = path.resolve(filePath);
    const resolvedNotes = path.resolve(settings.notesDir);
    if (resolved !== resolvedNotes && !resolved.startsWith(resolvedNotes + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    return serveLocalFile(resolved, request);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ----- IPC handlers -----

ipcMain.handle('settings:get', () => storage.getSettings());

ipcMain.handle('settings:save', (_e, settings) => storage.saveSettings(settings));

ipcMain.handle('settings:chooseNotesDir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose folder to store notes',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle('video:metadata', async (_e, url) => {
  return metadata.fetch(url);
});

ipcMain.handle('video:transcript', async (_e, url) => {
  return transcript.fetch(url);
});

ipcMain.handle('summarize', async (_e, args) => {
  const settings = storage.getSettings();
  return summarizer.summarize(args, settings);
});

ipcMain.handle('tldr:generate', async (_e, { notePath, length }) => {
  const note = storage.loadNote(notePath);
  const settings = storage.getSettings();
  const tldr = await summarizer.generateTldr({ content: note.content, length }, settings);
  const meta = storage.setNoteTldr({ path: notePath, tldr, tldrLength: length });
  return { tldr, meta };
});

// Clear the cached TL;DR for a note. Used after regenerating the main
// summary, since the cached TL;DR was built from the old content and
// would no longer reflect what's in notes.md.
ipcMain.handle('tldr:clear', async (_e, notePath) => {
  return storage.setNoteTldr({ path: notePath, tldr: '', tldrLength: null });
});

ipcMain.handle('provider:add', (_e, template) => storage.addProvider(template));
ipcMain.handle('provider:update', (_e, { id, patch }) => storage.updateProvider(id, patch));
ipcMain.handle('provider:delete', (_e, id) => storage.deleteProvider(id));
ipcMain.handle('provider:setActive', (_e, id) => storage.setActiveProvider(id));
ipcMain.handle('provider:test', async (_e, id) => {
  const provider = storage.getProvider(id);
  if (!provider) throw new Error('Provider not found.');
  return summarizer.testProvider(provider);
});
ipcMain.handle('provider:fetchModels', async (_e, id) => {
  const provider = storage.getProvider(id);
  if (!provider) throw new Error('Provider not found.');
  return summarizer.fetchModels(provider);
});

ipcMain.handle('note:create', async (_e, args) => {
  return storage.createNote(args);
});

ipcMain.handle('note:save', async (_e, args) => {
  return storage.saveNote(args);
});

ipcMain.handle('note:load', async (_e, notePath) => {
  return storage.loadNote(notePath);
});

ipcMain.handle('note:list', async () => {
  return storage.listNotes();
});

ipcMain.handle('note:toggleFavorite', async (_e, notePath) => {
  return storage.toggleFavorite(notePath);
});

ipcMain.handle('note:delete', async (_e, notePath) => {
  return storage.deleteNote(notePath);
});

ipcMain.handle('note:rename', async (_e, args) => {
  return storage.renameNote(args);
});

ipcMain.handle('folder:create', async (_e, args) => {
  return storage.createFolder(args);
});

ipcMain.handle('folder:delete', async (_e, folderPath) => {
  return storage.deleteFolder(folderPath);
});

ipcMain.handle('folder:rename', async (_e, args) => {
  return storage.renameFolder(args);
});

ipcMain.handle('folder:toggleFavorite', async (_e, folderPath) => {
  return storage.toggleFolderFavorite(folderPath);
});

ipcMain.handle('entry:move', async (_e, args) => {
  return storage.moveEntry(args);
});

ipcMain.handle('shell:openNotesDir', async () => {
  const dir = storage.getSettings().notesDir;
  if (dir && fs.existsSync(dir)) shell.openPath(dir);
});

// ---- video download / playback ----

ipcMain.handle('video:listFormats', async (_e, url) => {
  return video.listFormats(url);
});

ipcMain.handle('video:hasLocal', async (_e, notePath) => {
  const p = video.localPath(notePath);
  return p ? { path: p, filename: path.basename(p) } : null;
});

ipcMain.handle('video:download', async (event, { notePath, url, itag, qualityLabel, container }) => {
  const result = await video.download({ notePath, url, itag, qualityLabel, container }, (progress) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('video:progress', progress);
    }
  });
  storage.setNoteVideo({
    path: notePath,
    filename: result.filename,
    container: result.container,
    resolution: result.resolution,
  });
  return result;
});

// Tracks which video player windows are currently open, keyed by the note
// they belong to. Lets us enforce the one-window-per-note rule: a second
// click on ▶ Open for the same note focuses the existing window instead
// of opening a duplicate. Other notes can have their own windows open
// concurrently — the constraint is per-note, not global.
const videoWindows = new Map();

ipcMain.handle('video:openWindow', async (_e, { notePath, title }) => {
  // If a window for this note is still alive, just bring it to front.
  const existing = videoWindows.get(notePath);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return true;
  }
  const filePath = video.localPath(notePath);
  if (!filePath) throw new Error('No local video for this note. Download one first.');
  // Pull the saved playback position from the note's meta so we can resume.
  let startPosition = 0;
  try {
    const note = storage.loadNote(notePath);
    startPosition = Number(note.meta.videoLastPosition) || 0;
  } catch (_) { /* fresh start is fine */ }
  openVideoWindow(filePath, title, notePath, startPosition);
  return true;
});

// Save current playback position so the next ▶ Open can resume there.
// Fire-and-forget channel (ipcMain.on, not handle) — the renderer sends
// these every few seconds during playback and we don't want a Promise
// round-trip on each tick.
ipcMain.on('video:savePosition', (_e, { notePath, position }) => {
  if (!notePath) return;
  const settings = storage.getSettings();
  const resolved = path.resolve(notePath);
  const resolvedNotes = path.resolve(settings.notesDir);
  if (resolved !== resolvedNotes && !resolved.startsWith(resolvedNotes + path.sep)) return;
  storage.setNoteVideoPosition({ path: notePath, position });
});

ipcMain.handle('video:openExternal', async (_e, filePath) => {
  // Validate the path is inside notesDir before handing off to the OS,
  // so the in-window button can't be used to open arbitrary system files.
  if (!filePath) throw new Error('No file path.');
  const settings = storage.getSettings();
  const resolved = path.resolve(filePath);
  const resolvedNotes = path.resolve(settings.notesDir);
  if (resolved !== resolvedNotes && !resolved.startsWith(resolvedNotes + path.sep)) {
    throw new Error('File is outside the notes directory.');
  }
  const errMsg = await shell.openPath(filePath);
  if (errMsg) throw new Error(`Failed to open video: ${errMsg}`);
  return true;
});

function openVideoWindow(filePath, title, notePath, startPosition) {
  const win = new BrowserWindow({
    width: 960,
    height: 580,
    title: title || 'Video',
    backgroundColor: '#000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'media-player-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs require()
    },
  });
  win.removeMenu();

  // Register this window so a duplicate ▶ Open on the same note focuses
  // it instead of opening a second window. Auto-clean on close.
  if (notePath) {
    videoWindows.set(notePath, win);
    win.on('closed', () => {
      if (videoWindows.get(notePath) === win) videoWindows.delete(notePath);
    });
  }

  // Build media:// URL from the absolute file path. pathToFileURL gives
  // 'file:///C:/path/video.mp4'; we want 'media:///C:/path/video.mp4'.
  const fileHref = pathToFileURL(filePath).href; // 'file:///C:/...'
  const mediaUrl = 'media:' + fileHref.slice('file:'.length); // 'media:///C:/...'

  win.loadFile(path.join(__dirname, 'renderer', 'media-player.html'), {
    search:
      '?src=' + encodeURIComponent(mediaUrl)
      + '&title=' + encodeURIComponent(title || '')
      + '&filePath=' + encodeURIComponent(filePath)
      + '&notePath=' + encodeURIComponent(notePath || '')
      + '&position=' + encodeURIComponent(String(startPosition || 0)),
  });

  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}
