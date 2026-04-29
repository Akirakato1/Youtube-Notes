const { YoutubeTranscript } = require('youtube-transcript');

function extractVideoId(url) {
  if (!url) return null;
  const trimmed = url.trim();
  // Already a bare 11-char id
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.slice(1).split('/')[0];
    }
    if (u.hostname.includes('youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      // /shorts/ID, /embed/ID, /live/ID
      const parts = u.pathname.split('/').filter(Boolean);
      const idx = parts.findIndex((p) => ['shorts', 'embed', 'live', 'v'].includes(p));
      if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
    }
  } catch (_) {
    // not a URL
  }
  return null;
}

async function fetch(url) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('Could not parse a YouTube video ID from that input.');

  let entries;
  try {
    entries = await YoutubeTranscript.fetchTranscript(videoId);
  } catch (err) {
    const msg = String(err && err.message || err);
    if (msg.toLowerCase().includes('disabled') || msg.toLowerCase().includes('transcript')) {
      throw new Error(
        'No transcript available for this video. The uploader may have disabled captions, ' +
        'or YouTube has not generated auto-captions for it yet.'
      );
    }
    throw new Error('Failed to fetch transcript: ' + msg);
  }

  if (!entries || entries.length === 0) {
    throw new Error('Transcript came back empty.');
  }

  const text = entries
    .map((e) => decodeEntities(e.text).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');

  return { videoId, text, segments: entries.length };
}

function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

module.exports = { fetch, extractVideoId };
