// Video download backend.
//
// Two backends are supported. Prefer yt-dlp (more reliable, updated faster than
// ytdl-core, can fetch 1080p+ via stream merging). Fall back to @distube/ytdl-core
// when yt-dlp isn't installed.
//
//   yt-dlp install:
//     Windows:  winget install yt-dlp
//     macOS:    brew install yt-dlp
//     Linux:    pip install yt-dlp  (or your package manager)

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ytdl = require('@distube/ytdl-core');

// ---------- yt-dlp detection ----------

let ytdlpStatus = null; // null = unchecked, 'available' | 'unavailable'
let ytdlpBinary = null; // resolved binary path or 'yt-dlp' (PATH)

// Resolve which yt-dlp executable to invoke. Order:
//   1. Bundled binary inside the packaged app:  <resourcesPath>/bin/yt-dlp(.exe)
//   2. Bundled binary in dev:                   <projectRoot>/bin/yt-dlp(.exe)
//   3. System-installed yt-dlp on PATH (no path, just the name)
function resolveYtDlpBinary() {
  if (ytdlpBinary) return ytdlpBinary;
  const exe = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const candidates = [];
  // process.resourcesPath is set inside the packaged Electron app, pointing
  // at the app's resources/ directory. extraResources places bin/ there.
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'bin', exe));
  }
  // Dev: bin/ at the project root (one level up from src/)
  candidates.push(path.join(__dirname, '..', 'bin', exe));
  for (const c of candidates) {
    try { if (fs.existsSync(c)) { ytdlpBinary = c; return c; } } catch (_) { /* ignore */ }
  }
  // Last resort: rely on PATH
  ytdlpBinary = 'yt-dlp';
  return ytdlpBinary;
}

function spawnYtDlp(args, opts = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let proc;
    try {
      proc = spawn(resolveYtDlpBinary(), args, { windowsHide: true, ...opts });
    } catch (e) {
      return reject(e);
    }
    if (typeof opts.onStdoutLine === 'function') {
      let buf = '';
      proc.stdout.on('data', (d) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\n')) !== -1) {
          opts.onStdoutLine(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      });
    } else {
      proc.stdout.on('data', (d) => (stdout += d.toString()));
    }
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error('yt-dlp: ' + (stderr.trim() || `exit ${code}`)));
    });
  });
}

async function checkYtDlp() {
  if (ytdlpStatus !== null) return ytdlpStatus === 'available';
  try {
    await spawnYtDlp(['--version']);
    ytdlpStatus = 'available';
  } catch (_) {
    ytdlpStatus = 'unavailable';
  }
  return ytdlpStatus === 'available';
}

// ---------- public API ----------

async function listFormats(url) {
  if (await checkYtDlp()) {
    try {
      return await listFormatsYtDlp(url);
    } catch (e) {
      // fall through to ytdl-core only if the failure looks transient
    }
  }
  try {
    return await listFormatsYtdlCore(url);
  } catch (e) {
    throw enhanceError(e);
  }
}

async function download({ notePath, url, itag, qualityLabel, container }, onProgress) {
  if (await checkYtDlp()) {
    try {
      return await downloadYtDlp({ notePath, url, itag, qualityLabel, container }, onProgress);
    } catch (e) {
      throw enhanceError(e);
    }
  }
  try {
    return await downloadYtdlCore({ notePath, url, itag, qualityLabel }, onProgress);
  } catch (e) {
    throw enhanceError(e);
  }
}

function localPath(notePath) {
  if (!notePath || !fs.existsSync(notePath)) return null;
  for (const e of fs.readdirSync(notePath)) {
    if (/^video\.(mp4|webm|mkv|mov|m4a)$/i.test(e)) {
      return path.join(notePath, e);
    }
  }
  return null;
}

// ---------- yt-dlp implementation ----------

async function listFormatsYtDlp(url) {
  const { stdout } = await spawnYtDlp(['-J', '--no-warnings', url]);
  const info = JSON.parse(stdout);
  const all = info.formats || [];

  // We list ONLY video codecs that Chromium's <video> element plays natively:
  // H.264 (avc1), VP9, VP8. AV1 is excluded — even though some YouTube streams
  // are mp4+AV1, Chromium often can't decode AV1 (depends on Electron version
  // and platform) and the result is the dreaded MEDIA_ERR_SRC_NOT_SUPPORTED (4).
  // Skipping AV1 means losing access to the 4K-only-AV1 streams a few videos
  // have, but the VP9/H.264 alternatives at the same or one-step-down
  // resolution are always present and fully playable.
  const isPlayableVcodec = (f) => /avc1|h264|vp9|vp8/i.test(f.vcodec || '');

  // Already-combined audio+video streams (e.g. 360p mp4 + AAC)
  const combined = all.filter((f) =>
    f.acodec && f.acodec !== 'none' &&
    f.vcodec && f.vcodec !== 'none' &&
    f.height && isPlayableVcodec(f)
  );
  // Video-only streams for merging
  const videoOnly = all.filter((f) =>
    f.vcodec && f.vcodec !== 'none' &&
    (!f.acodec || f.acodec === 'none') &&
    f.height && isPlayableVcodec(f)
  );
  // Audio-only streams (codec safety isn't a concern here — we'll pair AAC
  // with H.264 and OPUS with VP9 below, both Chromium-safe combinations).
  const audioOnly = all.filter((f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none') && f.abr);

  // Pre-pick the best audio of each codec family. Pairing the right audio
  // codec to the right video codec is critical: Chromium's <video> element
  // rejects MP4-with-OPUS, and most external players reject WebM-with-AAC.
  const bestAac = audioOnly
    .filter((a) => /m4a|aac|mp4a/i.test((a.ext || '') + ' ' + (a.acodec || '')))
    .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
  const bestOpus = audioOnly
    .filter((a) => /opus/i.test(a.acodec || '') || a.ext === 'webm')
    .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

  // Score video by how "compatible" the resulting merged file will be.
  // H.264/AVC1 → highest (universally playable), VP9 → middle, VP8 → low.
  // Note: rank now keys ONLY on vcodec (no longer on f.ext) — the previous
  // "ext === 'mp4' implies H.264" shortcut wrongly promoted AV1-in-MP4.
  const codecRank = (f) => {
    const vcodec = f.vcodec || '';
    if (/avc1|h264/i.test(vcodec)) return 3;
    if (/vp9/i.test(vcodec)) return 2;
    if (/vp8/i.test(vcodec)) return 1;
    return 0; // unreachable after the isPlayableVcodec filter, but kept defensively
  };
  const sortedVideoOnly = [...videoOnly].sort((a, b) => {
    const r = codecRank(b) - codecRank(a);
    if (r !== 0) return r;
    return (b.height || 0) - (a.height || 0);
  });

  const seen = new Set();
  const formats = [];

  for (const v of sortedVideoOnly) {
    const label = v.height + 'p' + (v.fps && v.fps > 30 ? v.fps : '');
    if (seen.has(label)) continue;

    let audio = null;
    let outputExt = 'mp4';
    const rank = codecRank(v);
    if (rank >= 3) {
      // H.264 video → AAC audio → MP4 (best compatibility everywhere)
      audio = bestAac;
      outputExt = 'mp4';
    } else if (rank >= 1) {
      // VP9/VP8 video → OPUS audio → WebM (Chromium plays this; ffmpeg-less
      // remux into MP4 would produce the OPUS-in-MP4 file your last download hit)
      audio = bestOpus || bestAac;
      outputExt = audio === bestOpus ? 'webm' : 'mp4';
    } else {
      // AV1 / unknown → prefer AAC+mp4, else OPUS+webm
      audio = bestAac || bestOpus;
      outputExt = audio === bestAac ? 'mp4' : 'webm';
    }
    if (!audio) continue;

    seen.add(label);
    formats.push({
      itag: `${v.format_id}+${audio.format_id}`,
      qualityLabel: label,
      container: outputExt,
      fps: v.fps || null,
      contentLength: (v.filesize || v.filesize_approx || 0) + (audio.filesize || audio.filesize_approx || 0) || null,
      mimeType: `video/${outputExt}`,
      merged: true,
    });
  }

  // Add already-combined formats (no merge needed). YouTube's combined
  // streams use AAC audio inside MP4, so they're always Chromium-safe.
  for (const f of combined) {
    const label = f.height + 'p' + (f.fps && f.fps > 30 ? f.fps : '');
    if (seen.has(label)) continue;
    seen.add(label);
    formats.push({
      itag: String(f.format_id),
      qualityLabel: label,
      container: f.ext || 'mp4',
      fps: f.fps || null,
      contentLength: f.filesize || f.filesize_approx || null,
      mimeType: `video/${f.ext || 'mp4'}`,
      merged: false,
    });
  }

  formats.sort((a, b) => qualityRank(b.qualityLabel) - qualityRank(a.qualityLabel));

  return {
    videoId: info.id,
    title: info.title,
    durationSec: info.duration || 0,
    formats,
    backend: 'yt-dlp',
  };
}

async function downloadYtDlp({ notePath, url, itag, qualityLabel, container }, onProgress) {
  if (!notePath || !fs.existsSync(notePath)) throw new Error('Note folder not found.');
  // Clean up only stray temp/partial files from prior failed attempts. The
  // actual existing video.<ext> is left alone until the new one succeeds.
  cleanTempVideoFiles(notePath);
  // Download to video.tmp.%(ext)s — keeps the old video.<ext> intact in case
  // this download fails partway. We rename atomically on success below.
  const outputTemplate = path.join(notePath, 'video.tmp.%(ext)s');
  let lastTotal = null;
  // Build the yt-dlp arg list. The merge-output-format reflects the container
  // chosen for the row in listFormatsYtDlp — picking the one that matches the
  // audio codec so we never end up with OPUS-in-MP4 (which Chromium rejects).
  const args = [
    '-f', String(itag),
    '-o', outputTemplate,
    '--newline',
    '--no-warnings',
    '--no-mtime',
  ];
  if (container === 'mp4' || container === 'webm') {
    args.push('--merge-output-format', container);
  }
  args.push(url);
  try {
    await spawnYtDlp(
      args,
      {
        onStdoutLine: (line) => {
          // [download] 27.5% of 50.30MiB at 5.10MiB/s ETA 00:30
          const m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%(?:\s+of\s+~?\s*(\d+(?:\.\d+)?)\s*([KMG]i?B))?/);
          if (!m) return;
          const percent = parseFloat(m[1]) / 100;
          if (m[2] && m[3]) {
            const num = parseFloat(m[2]);
            const unit = m[3];
            const factor = unit.startsWith('G') ? 1024 ** 3
              : unit.startsWith('M') ? 1024 ** 2
              : unit.startsWith('K') ? 1024 : 1;
            lastTotal = Math.round(num * factor);
          }
          if (typeof onProgress === 'function') {
            onProgress({
              downloaded: lastTotal ? Math.round(lastTotal * percent) : null,
              total: lastTotal,
              percent,
            });
          }
        },
      }
    );
  } catch (e) {
    cleanTempVideoFiles(notePath); // remove any half-written temp file
    throw e;
  }
  // Locate the temp file yt-dlp produced (extension depends on the format)
  const tempFiles = fs.readdirSync(notePath).filter((f) => /^video\.tmp\.(mp4|webm|mkv|mov|m4a)$/i.test(f));
  if (!tempFiles.length) throw new Error('yt-dlp finished but no output file was found.');
  // Prefer mp4 if there are multiple temp files for some reason
  tempFiles.sort((a, b) => (b.endsWith('.mp4') ? 1 : 0) - (a.endsWith('.mp4') ? 1 : 0));
  const tempName = tempFiles[0];
  const ext = tempName.split('.').pop().toLowerCase();
  const tempPath = path.join(notePath, tempName);
  const finalName = `video.${ext}`;
  const finalPath = path.join(notePath, finalName);
  // Now (and only now) remove the old video, then promote the temp.
  removeExistingVideos(notePath);
  fs.renameSync(tempPath, finalPath);
  return {
    path: finalPath,
    filename: finalName,
    container: ext,
    resolution: qualityLabel || null,
    bytes: fs.statSync(finalPath).size,
  };
}

// Delete only video.tmp.* / .part stragglers (NOT the real video.<ext>)
function cleanTempVideoFiles(notePath) {
  for (const e of fs.readdirSync(notePath)) {
    if (/^video\.(tmp|part).*/i.test(e) || /^video\.tmp\.\w+$/i.test(e)) {
      try { fs.unlinkSync(path.join(notePath, e)); } catch (_) { /* ignore */ }
    }
  }
}

// Delete the real video.<ext> file(s) — used after a successful temp download.
function removeExistingVideos(notePath) {
  for (const e of fs.readdirSync(notePath)) {
    if (/^video\.(mp4|webm|mkv|mov|m4a)$/i.test(e)) {
      try { fs.unlinkSync(path.join(notePath, e)); } catch (_) { /* ignore */ }
    }
  }
}

// ---------- ytdl-core implementation (fallback) ----------

async function listFormatsYtdlCore(url) {
  const info = await ytdl.getInfo(url);
  const formats = [];
  for (const f of info.formats) {
    if (!f.hasAudio || !f.hasVideo) continue;
    if (!f.qualityLabel) continue;
    const existing = formats.find((x) => x.qualityLabel === f.qualityLabel);
    if (existing) {
      // prefer mp4 over webm
      if (existing.container !== 'mp4' && f.container === 'mp4') {
        const idx = formats.indexOf(existing);
        formats[idx] = simpleYtdlFormat(f);
      }
      continue;
    }
    formats.push(simpleYtdlFormat(f));
  }
  formats.sort((a, b) => qualityRank(b.qualityLabel) - qualityRank(a.qualityLabel));
  return {
    videoId: info.videoDetails.videoId,
    title: info.videoDetails.title,
    durationSec: parseInt(info.videoDetails.lengthSeconds, 10) || 0,
    formats,
    backend: 'ytdl-core',
  };
}

function simpleYtdlFormat(f) {
  return {
    itag: f.itag,
    qualityLabel: f.qualityLabel,
    container: f.container,
    fps: f.fps || null,
    contentLength: f.contentLength ? parseInt(f.contentLength, 10) : null,
    mimeType: f.mimeType,
    merged: false,
  };
}

async function downloadYtdlCore({ notePath, url, itag }, onProgress) {
  if (!notePath || !fs.existsSync(notePath)) throw new Error('Note folder not found.');
  const info = await ytdl.getInfo(url);
  // ytdl-core itags are numeric; coerce just in case the renderer sent a string
  const wantItag = typeof itag === 'string' ? parseInt(itag, 10) : itag;
  const format = info.formats.find((f) => f.itag === wantItag);
  if (!format) throw new Error('Selected format is no longer available.');
  if (!format.hasAudio || !format.hasVideo) {
    throw new Error('That format is video-only or audio-only.');
  }
  const container = format.container || 'mp4';
  const finalName = `video.${container}`;
  const finalPath = path.join(notePath, finalName);
  const tempName = `video.tmp.${container}`;
  const tempPath = path.join(notePath, tempName);
  cleanTempVideoFiles(notePath);
  const totalBytes = format.contentLength ? parseInt(format.contentLength, 10) : null;
  await new Promise((resolve, reject) => {
    const stream = ytdl.downloadFromInfo(info, { format });
    let downloaded = 0;
    stream.on('data', (chunk) => {
      downloaded += chunk.length;
      if (typeof onProgress === 'function') {
        onProgress({
          downloaded,
          total: totalBytes || null,
          percent: totalBytes ? downloaded / totalBytes : null,
        });
      }
    });
    stream.on('error', (err) => {
      try { fs.unlinkSync(tempPath); } catch (_) { /* ignore */ }
      reject(err);
    });
    const out = fs.createWriteStream(tempPath);
    out.on('error', (err) => {
      try { fs.unlinkSync(tempPath); } catch (_) { /* ignore */ }
      reject(err);
    });
    out.on('finish', resolve);
    stream.pipe(out);
  });
  // Promote temp → real, replacing any prior video.<ext>
  removeExistingVideos(notePath);
  fs.renameSync(tempPath, finalPath);
  return {
    path: finalPath,
    filename: finalName,
    container,
    resolution: format.qualityLabel,
    bytes: fs.statSync(finalPath).size,
  };
}

// ---------- helpers ----------

function qualityRank(label) {
  const m = String(label || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function enhanceError(err) {
  const msg = String(err && err.message || err);
  const looksLikeYouTubeBreakage =
    /Failed to find any playable formats/i.test(msg)
    || /Could not extract/i.test(msg)
    || /signature decipher/i.test(msg)
    || /functions could not be decoded/i.test(msg);
  if (looksLikeYouTubeBreakage && ytdlpStatus !== 'available') {
    return new Error(
      `Could not download via the built-in YouTube client. This usually means YouTube changed something internally and the bundled library needs an update. The reliable fix is to install yt-dlp once — the app will then use it automatically:\n\n` +
      `  Windows:  winget install yt-dlp\n` +
      `  macOS:    brew install yt-dlp\n` +
      `  Linux:    pip install yt-dlp\n\n` +
      `Then restart the app and try again. (You'll also get 1080p+ downloads.)\n\n` +
      `Original error: ${msg}`
    );
  }
  return err;
}

module.exports = { listFormats, download, localPath, checkYtDlp };
