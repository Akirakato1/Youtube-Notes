const { extractVideoId } = require('./transcript');

async function fetch(url) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('Could not parse a YouTube video ID from that input.');

  const canonical = `https://www.youtube.com/watch?v=${videoId}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`;

  let data = {};
  try {
    const res = await globalThis.fetch(oembedUrl);
    if (res.ok) {
      data = await res.json();
    }
  } catch (_) {
    // oEmbed is best-effort; we still return what we can.
  }

  return {
    videoId,
    url: canonical,
    title: data.title || `YouTube video ${videoId}`,
    author: data.author_name || '',
    authorUrl: data.author_url || '',
    thumbnail: data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

module.exports = { fetch };
