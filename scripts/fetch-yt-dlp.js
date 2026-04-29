// Downloads the platform-appropriate yt-dlp binary from yt-dlp's official
// GitHub Releases into bin/, so electron-builder can bundle it into the .exe.
// Runs automatically on `npm install` via the "postinstall" script.
//
// Failure here is non-fatal: the app still ships and falls back to ytdl-core
// (or to a system-installed yt-dlp on PATH).

const fs = require('fs');
const path = require('path');
const https = require('https');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const platform = process.platform;

let url, filename;
if (platform === 'win32') {
  url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
  filename = 'yt-dlp.exe';
} else if (platform === 'darwin') {
  url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
  filename = 'yt-dlp';
} else {
  url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
  filename = 'yt-dlp';
}
const dest = path.join(BIN_DIR, filename);

if (process.env.SKIP_FETCH_YT_DLP === '1') {
  console.log('[fetch-yt-dlp] SKIP_FETCH_YT_DLP=1 — skipping');
  process.exit(0);
}
if (fs.existsSync(dest)) {
  console.log(`[fetch-yt-dlp] ${dest} already exists — skipping (delete it to refetch)`);
  process.exit(0);
}

fs.mkdirSync(BIN_DIR, { recursive: true });

function download(currentUrl, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('Too many redirects'));
    https.get(currentUrl, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        return download(res.headers.location, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}`));
      }
      const tmp = dest + '.partial';
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          fs.renameSync(tmp, dest);
          if (platform !== 'win32') fs.chmodSync(dest, 0o755);
          resolve();
        });
      });
      file.on('error', (e) => {
        try { fs.unlinkSync(tmp); } catch (_) {}
        reject(e);
      });
    }).on('error', reject);
  });
}

console.log(`[fetch-yt-dlp] Downloading ${url}...`);
download(url).then(
  () => console.log(`[fetch-yt-dlp] Saved to ${dest}`),
  (err) => {
    console.warn(`[fetch-yt-dlp] Download failed: ${err.message}`);
    console.warn('[fetch-yt-dlp] The app will still work; it will fall back to ytdl-core or a system-installed yt-dlp on PATH.');
    console.warn('[fetch-yt-dlp] You can retry later with: node scripts/fetch-yt-dlp.js');
    // Exit 0 so npm install doesn't fail when offline / behind a proxy.
    process.exit(0);
  }
);
