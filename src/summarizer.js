const SYSTEM_PROMPT = `You are a meticulous note-taker. You turn YouTube video transcripts into thorough, organized study notes in Markdown.

Output requirements:
- Begin with a single H1 line containing the video title.
- Then an "## Overview" section: one short paragraph (2-4 sentences) summarizing the whole video.
- Then 4-10 topical sections (## headings) that mirror the structure of the video. Use descriptive section titles, not generic labels like "Part 1".
- Under each section, use detailed bullet points capturing every key idea, definition, example, name, number, and quotation. Use sub-bullets (indented two spaces) for supporting details.
- Be thorough enough that someone could skip the video and still learn the material.
- End with a "## Key Takeaways" section listing 5-10 of the most important points as bullets.
- Use clean Markdown only. Do NOT wrap the whole response in a code fence.

Use rich formatting whenever the content benefits from it — proactively, not sparingly. The renderer supports all of the following; pick the format that conveys the idea most clearly:
- LaTeX math — ALWAYS use the LaTeX-classic delimiters \\(inline\\) for short expressions and \\[display\\] on its own line for important / long equations. Do NOT use \$...\$ or \$\$...\$\$ — they conflict with currency and dollar-prefixed text.
- LaTeX environments inside \\[...\\]: \\begin{bmatrix}...\\end{bmatrix} for matrices (or pmatrix, vmatrix as needed), \\begin{aligned}...\\end{aligned} for multi-step derivations, \\begin{cases}...\\end{cases} for piecewise functions.
- Markdown tables (| col1 | col2 |\\n|---|---|\\n|...|...|) for comparisons, lookup tables, parameter lists, anything tabular — much clearer than bullet pairs.
- Fenced code blocks (\`\`\`language\\ncode\\n\`\`\`) when the video shows code, pseudocode, or algorithms.
- Blockquotes (>) for direct quotes from the speaker that are worth preserving verbatim.

Don't avoid these formats just to keep things simple — a matrix rendered as ASCII art or a comparison written as "X is faster than Y, but Z is slower than X..." is harder to read than the proper rendered form. Inside math expressions, never include literal dollar signs.`;

const PING_SYSTEM = 'You are a connectivity test. Reply with the single word: ok';
const PING_USER = 'ping';

function buildUserPrompt(meta, transcriptText) {
  return `Video title: ${meta.title}
Channel: ${meta.author || 'unknown'}
URL: ${meta.url}

Transcript (auto-captions, may contain minor errors):
"""
${transcriptText}
"""

Produce the detailed Markdown notes now.`;
}

async function summarize({ metadata, transcript }, settings) {
  if (!metadata || !transcript) throw new Error('Missing metadata or transcript.');
  const provider = settings.providers?.find((p) => p.id === settings.activeProviderId)
    || settings.providers?.[0];
  if (!provider) {
    throw new Error('No LLM provider configured. Open Settings (⚙) and add one.');
  }
  return callProvider(provider, SYSTEM_PROMPT, buildUserPrompt(metadata, transcript), { maxTokens: 8192 });
}

// Compress an existing detailed note into a fixed number of bullet points.
async function generateTldr({ content, length }, settings) {
  if (!content || !content.trim()) throw new Error('Note has no content to summarize.');
  const n = Math.max(3, Math.min(15, parseInt(length, 10) || 5));
  const provider = settings.providers?.find((p) => p.id === settings.activeProviderId)
    || settings.providers?.[0];
  if (!provider) {
    throw new Error('No LLM provider configured. Open Settings (⚙) and add one.');
  }
  const system = `You produce extreme TL;DR summaries. Given detailed Markdown notes for a video, output exactly:
1) ONE italicized sentence stating the video's thesis or central goal, written as Markdown italics (*like this*).
2) A blank line.
3) Exactly ${n} Markdown bullet points (each starting with "- ") covering the most important takeaways, in order of importance. Each bullet is one concise sentence.

Output ONLY this — no heading, no preamble, no closing remarks, no other formatting.

If the source notes use mathematical equations, you may use LaTeX inside bullets — ALWAYS use \\(...\\) for inline math and \\[...\\] for displayed equations. Do not use \$...\$.`;
  const user = `Notes to compress:
"""
${content}
"""

Produce one italicized thesis sentence, a blank line, then exactly ${n} bullets in order of importance.`;
  // Generous budget. Reasoning models (gpt-oss, DeepSeek R1, Qwen QwQ) spend
  // most of their token budget on hidden <think> reasoning before producing
  // visible output. 1024 was leaving them with ~300 tokens for the answer,
  // which truncated 4-bullet outputs and produced thesis-only at 8+. 4096
  // gives even slow reasoners room to think AND emit 15 bullets.
  const text = await callProvider(provider, system, user, { maxTokens: 4096, timeoutMs: 90000 });
  return text.trim();
}

async function testProvider(provider) {
  try {
    // Generous budget so reasoning models (QwQ, R1, gpt-oss, etc.) have room
    // to think *and* still produce a visible reply, plus time for LM Studio /
    // Ollama to JIT-load the model on the first request.
    const text = await callProvider(provider, PING_SYSTEM, PING_USER, { maxTokens: 512, timeoutMs: 90000 });
    return { ok: true, response: text.trim().slice(0, 120) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function fetchModels(provider) {
  if (provider.type === 'gemini') return fetchGeminiModels(provider);
  if (provider.type === 'openai-compatible') return fetchOpenAIModels(provider);
  throw new Error('Unknown provider type: ' + provider.type);
}

// ---------- core ----------

async function callProvider(provider, system, user, opts = {}) {
  if (provider.type === 'gemini') return callGemini(provider, system, user, opts);
  if (provider.type === 'openai-compatible') return callOpenAICompatible(provider, system, user, opts);
  throw new Error('Unknown provider type: ' + provider.type);
}

async function callGemini(provider, system, user, opts) {
  if (!provider.apiKey) {
    throw new Error(`Provider "${provider.label}" has no API key. Edit it in Settings and paste your free key from https://aistudio.google.com/apikey`);
  }
  const model = provider.model || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(provider.apiKey)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: user }] }],
    systemInstruction: { parts: [{ text: system }] },
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: opts.maxTokens || 8192,
    },
  };
  return withRetry(async () => {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, opts.timeoutMs);
    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(formatGeminiError(res.status, errText, model));
      err.httpStatus = res.status;
      throw err;
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    if (!text) throw new Error('Gemini returned an empty response.');
    return stripCodeFence(text);
  });
}

// When the user hits a quota on one Gemini model, suggest a different one
// with a different/looser quota profile. As of late 2025/early 2026:
//   gemini-2.5-flash      → 250 req/day, 250K TPM   (tightest)
//   gemini-2.5-flash-lite → 250 req/day, 250K TPM
//   gemini-2.0-flash      → 1500 req/day, 1M TPM    (most generous)
//   gemini-2.0-flash-lite → 1500 req/day, 4M TPM    (loosest TPM)
// Limits move around — keep the suggestion conservative.
function suggestAlternateGeminiModel(currentModel) {
  if (!currentModel) return 'gemini-2.0-flash';
  if (/2\.5-flash(?!-lite)/.test(currentModel)) return 'gemini-2.0-flash';
  if (/2\.0-flash(?!-lite)/.test(currentModel)) return 'gemini-2.0-flash-lite';
  if (/2\.0-flash-lite/.test(currentModel)) return 'gemini-2.5-flash-lite';
  return 'gemini-2.0-flash';
}

function approxDailyCap(model) {
  if (!model) return '';
  if (/2\.5-flash/.test(model)) return ' (~250/day on free tier)';
  if (/2\.0-flash/.test(model)) return ' (~1500/day on free tier)';
  return '';
}

function formatGeminiError(status, errText, model) {
  let parsed;
  try { parsed = JSON.parse(errText); } catch (_) { /* not JSON */ }
  const apiError = parsed?.error;
  const message = apiError?.message || truncate(errText, 500);
  const apiStatus = apiError?.status || '';

  // 429 / RESOURCE_EXHAUSTED is overloaded by Google for several distinct issues
  if (status === 429 || apiStatus === 'RESOURCE_EXHAUSTED') {
    const details = apiError?.details || [];
    const quotaFailure = details.find((d) => d['@type']?.includes('QuotaFailure'));
    const violations = quotaFailure?.violations || [];
    const metric = violations[0]?.quotaMetric || violations[0]?.quotaId || '';
    const alt = suggestAlternateGeminiModel(model);
    let hint = '';
    if (/day/i.test(metric)) {
      hint = ` Daily request cap hit for ${model}${approxDailyCap(model)}. Resets at midnight Pacific. Switch to ${alt} (more generous quota) via Settings, or use a different provider in the meantime (Groq is a solid free alternative).`;
    } else if (/minute|token/i.test(metric)) {
      hint = ` Per-minute quota for ${model}. The transcript may exceed free TPM, or this key's project has very low free-tier allocation (common when keys come from Google Cloud console rather than aistudio.google.com). Switch to ${alt}, generate a fresh key at https://aistudio.google.com/apikey, or wait a minute and retry.`;
    } else if (/not.enabled/i.test(message) || /Generative.Language.API/i.test(message)) {
      hint = ' The Generative Language API may not be enabled on the project this key belongs to. The simplest fix is to create a new key at aistudio.google.com/apikey (the AI Studio path auto-enables it for the free tier).';
    } else {
      hint = ` Most likely the per-day or per-minute quota for ${model} is exhausted. Switch to ${alt} via Settings (more generous limits), or pick a different provider (Groq is a free alternative). Click ↻ in Settings to list models available to this key.`;
    }
    return `Gemini quota/rate error (${status} ${apiStatus}): ${truncate(message, 300)}.${hint}`;
  }
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(message)) {
    return `Gemini API key is invalid. Generate a fresh one at https://aistudio.google.com/apikey and paste it in Settings.`;
  }
  if (status === 404) {
    return `Gemini model "${model}" not found. Click ↻ in Settings to list models your key can access.`;
  }
  if (status === 403) {
    return `Gemini API forbidden (403): ${truncate(message, 300)}. The key may be restricted by referrer/IP, or the API isn't enabled on this project.`;
  }
  if (status === 503 || apiStatus === 'UNAVAILABLE') {
    return `Gemini is temporarily unavailable (503 UNAVAILABLE). This is a transient Google-side overload, not your key. Retry in 30-60 s, switch the model to gemini-2.0-flash or gemini-2.0-flash-lite (less crowded), or use a different provider.`;
  }
  if (status === 500 || apiStatus === 'INTERNAL') {
    return `Gemini internal server error (500). Transient on Google's side. Retry, or try a different model.`;
  }
  if (status === 504 || apiStatus === 'DEADLINE_EXCEEDED') {
    return `Gemini deadline exceeded (504). The request took too long server-side. Retry, or shorten the transcript.`;
  }
  return `Gemini API error (${status}${apiStatus ? ' ' + apiStatus : ''}): ${truncate(message, 400)}`;
}

async function callOpenAICompatible(provider, system, user, opts) {
  const baseUrl = (provider.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error(`Provider "${provider.label}" has no base URL.`);
  if (!provider.model) throw new Error(`Provider "${provider.label}" has no model name.`);
  return withRetry(() => openAIOnce(provider, baseUrl, system, user, opts));
}

async function openAIOnce(provider, baseUrl, system, user, opts) {
  const res = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: provider.model,
      temperature: 0.3,
      max_tokens: opts.maxTokens || 8192,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  }, opts.timeoutMs);
  if (!res.ok) {
    const errText = await res.text();
    const err = new Error(`Provider error (${res.status}): ${truncate(errText, 500)}`);
    err.httpStatus = res.status;
    throw err;
  }
  const data = await res.json();
  const message = data?.choices?.[0]?.message || {};
  // Strip <think>...</think> blocks emitted by reasoning models (QwQ, R1, gpt-oss).
  let text = stripThinkingTags(message.content || '');
  // If the model put its visible answer in reasoning_content (LM Studio's
  // DeepSeek-style split) and content was empty, use that.
  if (!text && message.reasoning_content) {
    text = stripThinkingTags(message.reasoning_content);
  }
  if (!text) {
    const finishReason = data?.choices?.[0]?.finish_reason;
    const baseUrl = (provider.baseUrl || '').toLowerCase();
    const isLocal = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');
    const hadThinking = !!(message.content || '').match(/<think>/i) || !!message.reasoning_content;
    let hint = '';
    if (hadThinking && finishReason === 'length') {
      hint = ' The model is a reasoning model and the response hit max_tokens before the actual answer. Increase max_tokens, or pick a non-reasoning model.';
    } else if (isLocal) {
      hint = ' For LM Studio: confirm a model is loaded ("lms load <model>" or via the GUI). For Ollama: confirm the model name matches one from "ollama list".';
    } else if (finishReason === 'content_filter') {
      hint = ' The provider blocked the response with a content filter.';
    } else if (finishReason === 'length') {
      hint = ' The response hit the max-tokens cap before producing any visible content. Try a higher max_tokens or a smaller transcript.';
    }
    throw new Error(`Provider returned an empty response${finishReason ? ` (finish_reason="${finishReason}")` : ''}.${hint}`);
  }
  return stripCodeFence(text);
}

function stripThinkingTags(text) {
  if (!text) return '';
  // Remove balanced <think>...</think> blocks (Qwen QwQ, DeepSeek R1, gpt-oss, etc.)
  let out = text.replace(/<think>[\s\S]*?<\/think>\s*/gi, '');
  // Also handle dangling/unclosed <think> at the start (truncated reasoning)
  if (/^\s*<think>/i.test(out) && !/<\/think>/i.test(out)) {
    out = '';
  }
  return out.trim();
}

async function fetchGeminiModels(provider) {
  if (!provider.apiKey) throw new Error('Gemini API key required to list models.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(provider.apiKey)}`;
  const res = await fetchWithTimeout(url, { method: 'GET' }, 15000);
  if (!res.ok) throw new Error(`Gemini models list failed (${res.status}): ${truncate(await res.text(), 300)}`);
  const data = await res.json();
  const models = (data.models || [])
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => (m.name || '').replace(/^models\//, ''))
    .filter(Boolean)
    .sort();
  return models;
}

async function fetchOpenAIModels(provider) {
  const baseUrl = (provider.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Base URL required to list models.');
  const res = await fetchWithTimeout(`${baseUrl}/models`, {
    method: 'GET',
    headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
  }, 15000);
  if (!res.ok) throw new Error(`Models list failed (${res.status}): ${truncate(await res.text(), 300)}`);
  const data = await res.json();
  const list = data.data || data.models || [];
  return list
    .map((m) => (typeof m === 'string' ? m : m.id || m.name))
    .filter(Boolean)
    .sort();
}

// ---------- helpers ----------

// Retry transient 5xx errors once with short backoff. Does NOT retry 4xx
// (auth, quota, validation) since those won't fix themselves.
async function withRetry(fn, { maxAttempts = 2, baseDelayMs = 3000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !isTransient(err)) throw err;
      const jitter = 0.8 + Math.random() * 0.4;
      await new Promise((r) => setTimeout(r, baseDelayMs * attempt * jitter));
    }
  }
  throw lastErr;
}

function isTransient(err) {
  const status = err?.httpStatus;
  if (status === 502 || status === 503 || status === 504) return true;
  const msg = String(err?.message || '');
  return /\bUNAVAILABLE\b|\bINTERNAL\b|\bDEADLINE_EXCEEDED\b|temporarily unavailable|fetch failed|ECONNRESET/i.test(msg);
}

async function fetchWithTimeout(url, init, timeoutMs) {
  let controller, t;
  let opts = init;
  if (timeoutMs) {
    controller = new AbortController();
    t = setTimeout(() => controller.abort(), timeoutMs);
    opts = { ...init, signal: controller.signal };
  }
  try {
    return await globalThis.fetch(url, opts);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Request timed out after ${timeoutMs}ms.`);
    throw enhanceFetchError(err, url);
  } finally {
    if (t) clearTimeout(t);
  }
}

function enhanceFetchError(err, url) {
  const cause = err.cause || err;
  const code = cause.code || '';
  let host = '';
  let isLocal = false;
  try {
    const u = new URL(url);
    host = u.host;
    isLocal = /^(localhost|127\.0\.0\.1|::1)$/i.test(u.hostname);
  } catch (_) { /* bad URL */ }

  if (code === 'ECONNREFUSED') {
    if (isLocal) {
      return new Error(
        `Connection refused to ${host}. The local server is not accepting connections. ` +
        `In LM Studio: open the "Developer" tab and click "Start Server" (verify the port matches your Base URL). ` +
        `In Ollama: make sure the Ollama app is running, or run "ollama serve" in a terminal.`
      );
    }
    return new Error(`Connection refused to ${host}.`);
  }
  if (code === 'ENOTFOUND') {
    return new Error(`Could not resolve host "${host}". Check the Base URL.`);
  }
  if (code === 'ETIMEDOUT') {
    return new Error(`Connection to ${host} timed out. ${isLocal ? 'Is the local server running?' : 'The server is unreachable or too slow.'}`);
  }
  if (code === 'ECONNRESET') {
    return new Error(`Connection to ${host} was reset before any data was returned.`);
  }
  if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
    return new Error(`TLS certificate problem talking to ${host}: ${code}.`);
  }
  return new Error(cause.message || cause.code || String(cause));
}

function stripCodeFence(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  return fenced ? fenced[1] : trimmed;
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '...' : s;
}

module.exports = { summarize, generateTldr, testProvider, fetchModels };
