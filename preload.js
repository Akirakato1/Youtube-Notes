const { contextBridge, ipcRenderer } = require('electron');
const { marked } = require('marked');
const katex = require('katex');

marked.setOptions({ gfm: true, breaks: false });

// Math is rendered to KaTeX HTML BEFORE markdown parsing and replaced with
// opaque placeholders, then restored after. This bypasses marked-katex's
// $...$ tokenizer, which mispairs delimiters when one paragraph contains
// multiple inline math spans separated by punctuation. It also shields
// formula bodies from markdown (so `_`, `*`, `^` inside math aren't eaten
// as emphasis), and lets stray `$` in prose pass through untouched.
function renderMathToHtml(body, displayMode) {
  try {
    return katex.renderToString(body, { displayMode, throwOnError: false, output: 'html' });
  } catch (err) {
    try { console.warn('[KaTeX]', err && err.message ? err.message : err); } catch (_) {}
    const safe = body.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    return `<span class="katex-error">${safe}</span>`;
  }
}

function renderMarkdownWithMath(text) {
  if (!text) return '';

  // Per-call nonce so placeholders can't collide with literal text the
  // user (or LLM) happened to write, e.g. "MATH3" appearing in prose.
  const nonce = Math.random().toString(36).slice(2, 10);
  const mathTag = (i) => `xKxMxX${nonce}M${i}xKxMxX`;
  const codeTag = (i) => `xKxCxX${nonce}C${i}xKxCxX`;
  const mathRe = new RegExp(`xKxMxX${nonce}M(\\d+)xKxMxX`, 'g');
  const codeRe = new RegExp(`xKxCxX${nonce}C(\\d+)xKxCxX`, 'g');

  let out = text;

  // 1. Mask code blocks / inline code so the math regex doesn't touch
  //    sequences inside them (e.g. literal `\(x\)` in a code sample).
  const codes = [];
  out = out.replace(/```[\s\S]*?```/g, (m) => codeTag(codes.push(m) - 1));
  out = out.replace(/`[^`\n]+?`/g, (m) => codeTag(codes.push(m) - 1));

  // 2. Render math, replacing each span with a placeholder. Display math
  //    placeholders get blank lines so marked treats them as their own
  //    block (avoids invalid <p>...<span class="katex-display">... nesting).
  const maths = [];
  out = out.replace(/\\\[([\s\S]+?)\\\]/g, (_, body) =>
    `\n\n${mathTag(maths.push(renderMathToHtml(body.trim(), true)) - 1)}\n\n`);
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_, body) =>
    `\n\n${mathTag(maths.push(renderMathToHtml(body.trim(), true)) - 1)}\n\n`);
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_, body) =>
    mathTag(maths.push(renderMathToHtml(body.trim(), false)) - 1));

  // 3. Restore code so marked renders it normally.
  out = out.replace(codeRe, (_, i) => codes[+i]);

  // 4. Run markdown on the masked text.
  let html = marked.parse(out);

  // 5. Restore math (KaTeX HTML).
  html = html.replace(mathRe, (_, i) => maths[+i]);

  return html;
}

contextBridge.exposeInMainWorld('api', {
  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  chooseNotesDir: () => ipcRenderer.invoke('settings:chooseNotesDir'),

  // providers
  addProvider: (template) => ipcRenderer.invoke('provider:add', template),
  updateProvider: (id, patch) => ipcRenderer.invoke('provider:update', { id, patch }),
  deleteProvider: (id) => ipcRenderer.invoke('provider:delete', id),
  setActiveProvider: (id) => ipcRenderer.invoke('provider:setActive', id),
  testProvider: (id) => ipcRenderer.invoke('provider:test', id),
  fetchModels: (id) => ipcRenderer.invoke('provider:fetchModels', id),

  // video pipeline
  fetchMetadata: (url) => ipcRenderer.invoke('video:metadata', url),
  fetchTranscript: (url) => ipcRenderer.invoke('video:transcript', url),
  summarize: (args) => ipcRenderer.invoke('summarize', args),
  generateTldr: ({ notePath, length }) => ipcRenderer.invoke('tldr:generate', { notePath, length }),
  clearTldr: (notePath) => ipcRenderer.invoke('tldr:clear', notePath),

  // notes
  createNote: (args) => ipcRenderer.invoke('note:create', args),
  saveNote: (args) => ipcRenderer.invoke('note:save', args),
  loadNote: (notePath) => ipcRenderer.invoke('note:load', notePath),
  listNotes: () => ipcRenderer.invoke('note:list'),
  toggleFavorite: (notePath) => ipcRenderer.invoke('note:toggleFavorite', notePath),
  deleteNote: (notePath) => ipcRenderer.invoke('note:delete', notePath),
  renameNote: (args) => ipcRenderer.invoke('note:rename', args),

  // folders
  createFolder: ({ parent, name }) => ipcRenderer.invoke('folder:create', { parent, name }),
  renameFolder: ({ path, newName }) => ipcRenderer.invoke('folder:rename', { path, newName }),
  deleteFolder: (folderPath) => ipcRenderer.invoke('folder:delete', folderPath),
  toggleFolderFavorite: (folderPath) => ipcRenderer.invoke('folder:toggleFavorite', folderPath),
  moveEntry: ({ sourcePath, targetParent }) => ipcRenderer.invoke('entry:move', { sourcePath, targetParent }),

  // misc
  openNotesDir: () => ipcRenderer.invoke('shell:openNotesDir'),
  renderMarkdown: (text) => renderMarkdownWithMath(text || ''),

  // video download / playback
  listVideoFormats: (url) => ipcRenderer.invoke('video:listFormats', url),
  hasLocalVideo: (notePath) => ipcRenderer.invoke('video:hasLocal', notePath),
  downloadVideo: ({ notePath, url, itag, qualityLabel, container }) => ipcRenderer.invoke('video:download', { notePath, url, itag, qualityLabel, container }),
  openVideoWindow: ({ notePath, title }) => ipcRenderer.invoke('video:openWindow', { notePath, title }),
  onVideoProgress: (cb) => {
    const wrapped = (_e, progress) => cb(progress);
    ipcRenderer.on('video:progress', wrapped);
    return () => ipcRenderer.removeListener('video:progress', wrapped);
  },
});
