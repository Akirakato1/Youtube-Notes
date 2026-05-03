# YouTube Notes

An Electron desktop app that turns any YouTube video into thorough, organized, editable Markdown study notes. The transcript is pulled from YouTube's auto-captions (no API key required), sent to the LLM provider of your choice, and saved as plain `.md` files in a folder you control.

![Main window with a saved note open](screenshots/01-main-window.png)

---

## Table of contents

- [Features at a glance](#features-at-a-glance)
- [How a note gets generated](#how-a-note-gets-generated)
- [The note view](#the-note-view)
- [Sidebar: folders, favorites, drag & drop](#sidebar-folders-favorites-drag--drop)
- [LLM providers](#llm-providers)
- [Video download & playback](#video-download--playback)
- [LaTeX math support](#latex-math-support)
- [On-disk format](#on-disk-format)
- [Setup](#setup)
- [Building a distributable .exe](#building-a-distributable-exe)
- [Key dependencies](#key-dependencies)
- [Limitations](#limitations)

---

## Features at a glance

- **Paste a URL → get detailed notes** — overview, 4–10 topical sections with sub-bullets, and key takeaways.
- **Edit, Preview, and TL;DR modes** — split-pane editor with live Markdown preview, full-width preview, or a lazy-generated condensed bullet summary.
- **Bring-your-own LLM** — Gemini (free), Groq, OpenRouter, Ollama, LM Studio, or any OpenAI-compatible endpoint. Save as many providers as you want and switch from a top-bar dropdown.
- **First-class LaTeX math** — KaTeX renders `\(inline\)` and `\[display\]` math, including matrices, aligned environments, and piecewise functions.
- **Nested folders, favorites, drag & drop** — organize notes in a folder tree on disk; star individual notes or whole folders; drag entries between folders.
- **Optional video download** — pick a resolution and save the YouTube video into the note folder. Plays in an embedded player window with resume-where-you-left-off.
- **Auto-saving Markdown files** — notes are saved as plain `notes.md` 1.2 s after typing stops (or `Ctrl+S` to flush immediately). Open them in any other editor; the format is portable.

> **Screenshot — fresh launch (no note selected):** save as `screenshots/02-empty-state.png`

![Empty state](screenshots/02-empty-state.png)

---

## How a note gets generated

1. Paste a YouTube URL (or bare 11-char video ID) into the top bar.
2. Pick a destination folder in the sidebar (click any folder name to select it).
3. Click **Generate Notes**. A progress overlay tracks four steps:
   - **Fetching video info** — YouTube oEmbed gives title, author, thumbnail.
   - **Pulling transcript** — auto-captions via the `youtube-transcript` package (no API key, no rate limit beyond YouTube's own).
   - **Summarizing with LLM** — your active provider produces structured Markdown notes.
   - **Saving notes** — written as `notes.md` + `meta.json` in a folder named after the video.

Supported URL forms: `youtube.com/watch?v=...`, `youtu.be/...`, `/shorts/...`, `/embed/...`, `/live/...`, or just the bare video ID.

> **Screenshot — generation progress overlay:** save as `screenshots/03-generate-progress.png`

![Generate progress overlay](screenshots/03-generate-progress.png)

---

## The note view

Once a note is open, the toolbar exposes everything you can do with it:

| Control | What it does |
|---|---|
| **Title (linked)** | Click to open the original video on YouTube in your browser. |
| **☆ / ★** | Toggle favorite. Favorited notes appear in the sidebar's Favorites section. |
| **⬇ Video** | Download the YouTube video to this note's folder (resolution picker dialog). |
| **▶ Open** | Play the downloaded video in an embedded player window (resumes from last position). |
| **TL;DR slider** | Choose the bullet count (3–15) for the TL;DR view. |
| **✎ Rename** | Rename the note — also renames its folder on disk. |
| **🗑 Delete** | Permanently delete the note folder (and any downloaded video inside it). |
| **Preview / TL;DR / Edit** | Switch between full-width preview, lazy-generated TL;DR, and split editor. |
| **↻ Regenerate** | Re-fetch the transcript and re-summarize. Overwrites your current notes (asks for confirmation). |
| **Save status** | "Saved" / "Unsaved..." — auto-save fires 1.2 s after typing stops; `Ctrl+S` flushes immediately. |

> **Screenshot — Preview mode with rendered Markdown + math:** save as `screenshots/04-note-preview.png`

![Preview mode](screenshots/04-note-preview.png)

> **Screenshot — Edit mode (editor + live preview side-by-side):** save as `screenshots/05-note-edit.png`

![Edit mode](screenshots/05-note-edit.png)

> **Screenshot — TL;DR mode (italic thesis line + N bullets):** save as `screenshots/06-note-tldr.png`

![TL;DR mode](screenshots/06-note-tldr.png)

### Edit mode behavior

- The left pane is a plain `<textarea>` editing the raw `notes.md` file.
- The right pane re-renders the Markdown 150 ms after each keystroke.
- Changes are auto-saved to disk 1.2 s after the last keystroke.
- `Ctrl+S` saves immediately (and `meta.json`'s `updatedAt` timestamp is bumped).

### TL;DR mode behavior

- TL;DR is generated **on demand** the first time you switch into TL;DR mode for a note.
- The result is cached in `meta.json` so subsequent opens are instant.
- Move the slider (3–15 bullets) and the cached TL;DR is regenerated for the new length.
- The TL;DR is automatically cleared when you regenerate the main summary, since it would otherwise be based on stale content.

---

## Sidebar: folders, favorites, drag & drop

The sidebar has two sections:

- **★ Favorites** — every note (and folder) you've starred, sorted by most-recently-updated.
- **📁 All Notes** — the folder tree, mirroring your notes directory on disk.

Folder operations:

- **＋** at the top of "All Notes" creates a new folder at the root.
- **＋** that appears next to any folder on hover creates a nested sub-folder.
- **★** on a folder marks the whole folder as favorite (favorites can't be deleted until you unstar them).
- **×** deletes the folder and all notes inside it.
- Triangles (▸ / ▾) collapse and expand sub-trees.

Drag & drop:

- Drag any **note** into a folder to move it into that folder.
- Drag any **folder** into another folder to nest it.
- Drop on the empty space inside the folder tree to move an entry to the root.
- Self-and-descendant moves are blocked.
- Filename collisions are resolved by appending ` (2)`, ` (3)`, etc.

> **Screenshot — sidebar with nested folders + favorites:** save as `screenshots/07-sidebar-folders.png`

![Sidebar with folders](screenshots/07-sidebar-folders.png)

---

## LLM providers

Open Settings (⚙) to configure providers. You can save as many as you want and switch the active one from the top-bar dropdown without reopening Settings.

Each provider row in Settings has:

- A **radio button** to mark it active (the radio is the source of truth for which one runs).
- A **Test** button that sends a one-token ping (`"reply with: ok"`) so you can verify the connection before generating a multi-second summary.
- An **Edit** button that opens an inline form for the label, base URL (OpenAI-compatible only), API key, and model name.
- A **↻** next to the Model field that asks the endpoint what models it has and pops up a dropdown to pick one. Especially handy for Ollama / LM Studio (only your locally-installed models).
- A **×** to delete the provider.

> **Screenshot — Settings dialog with several providers configured:** save as `screenshots/08-settings.png`

![Settings dialog](screenshots/08-settings.png)

> **Screenshot — Add-provider buttons + an open edit form:** save as `screenshots/09-settings-edit.png`

![Edit provider form](screenshots/09-settings-edit.png)

### Provider templates

| Provider | Template default | Notes |
|---|---|---|
| **Google Gemini** | `gemini-2.0-flash` | Free key from <https://aistudio.google.com/apikey>. ~1500 req/day, 1M token context. The default for new installs. |
| **Groq** | `llama-3.3-70b-versatile` | Free key from <https://console.groq.com/keys>. OpenAI-compatible. Very fast. |
| **OpenRouter** | `meta-llama/llama-3.3-70b-instruct:free` | OpenAI-compatible. Free models list at <https://openrouter.ai/models?max_price=0>. |
| **Ollama (local)** | base URL `http://localhost:11434/v1` | Run `ollama pull <model>` first. Leave the API key blank. |
| **LM Studio (local)** | base URL `http://localhost:1234/v1` | Load a model in LM Studio and start its local server. Leave the API key blank. |
| **Custom** | empty | Any OpenAI-compatible endpoint — provide base URL, optional API key, model name. |

### Error handling

- Gemini quota errors (`429 RESOURCE_EXHAUSTED`) are parsed in detail: the dialog tells you whether the per-day or per-minute cap was hit and suggests a different model with a more generous quota.
- 5xx errors from any provider are retried once with backoff. 4xx errors (auth, validation) are not — those won't fix themselves.
- Reasoning models (DeepSeek R1, Qwen QwQ, gpt-oss) that emit `<think>...</think>` blocks are handled — the thinking is stripped before the answer is saved.
- Local-server connection errors get human-readable hints (e.g. "Start LM Studio's server in the Developer tab", "Run `ollama serve`").

---

## Video download & playback

Click **⬇ Video** in any note's toolbar to open the resolution picker. The list of formats is built from whichever backend is available:

- **yt-dlp** (preferred) — supports merging separate video+audio streams, so 1080p / 1440p / 4K work. Bundled in `bin/` if installed via the `npm run fetch-yt-dlp` script, otherwise picked up from your `PATH`.
- **`@distube/ytdl-core`** (fallback) — pure JavaScript, only lists already-merged formats (typically 720p and below).

The picker filters out formats that wouldn't play in the embedded player: only H.264, VP9, and VP8 video are offered (AV1 is excluded — Chromium often can't decode it). Audio is paired sensibly with video (AAC with H.264 in MP4, OPUS with VP9 in WebM) so the merged file is always playable.

> **Screenshot — video format picker:** save as `screenshots/10-video-download.png`

![Video download dialog](screenshots/10-video-download.png)

Once downloaded:

- The file lands as `video.<ext>` inside the note's folder.
- **▶ Open** launches a separate player window (one window per note — clicking again focuses the existing one).
- The player resumes from the last saved position (persisted every ~5 s during playback, plus on pause / seek / window close).
- If Chromium can't play the file, the window shows a detailed error report (codec self-test, MediaError code, networkState, readyState) with a one-click **Open in your default video player** button.
- The local file is served via a custom `media://` protocol with HTTP Range support, so the timeline scrubber works for seeking.

> **Screenshot — embedded player window:** save as `screenshots/11-video-player.png`

![Video player window](screenshots/11-video-player.png)

---

## LaTeX math support

The system prompt instructs the LLM to use LaTeX-classic delimiters:

- `\(...\)` for inline math
- `\[...\]` for display math
- LaTeX environments inside `\[...\]`: `\begin{bmatrix}`, `\begin{aligned}`, `\begin{cases}`, etc.

Rendering uses a custom KaTeX integration (in `preload.js`) that:

1. Masks code blocks first (so `\(x\)` shown literally inside a `` ` `` code span isn't accidentally rendered).
2. Pre-renders each math span to KaTeX HTML and replaces it with an opaque placeholder.
3. Runs Markdown on the masked text.
4. Substitutes the placeholders back with rendered math.

This bypasses the common pitfall of `$...$` tokenizers mispairing delimiters when a paragraph has multiple inline math spans separated by punctuation, and shields formula bodies from Markdown emphasis (`_x_`, `*y*`, `^z^` etc.).

> **Screenshot — close-up of rendered LaTeX (inline + display + matrix):** save as `screenshots/12-math-rendering.png`

![Math rendering](screenshots/12-math-rendering.png)

---

## On-disk format

```
<notesDir>/
├── _Inbox/                          ← created on first launch
│   └── How transformers work/       ← one folder per note
│       ├── notes.md                 ← the editable Markdown
│       ├── meta.json                ← video id, url, title, author, favorite,
│       │                              tldr cache, video file metadata, last-played position
│       └── video.mp4                ← optional, only if you clicked ⬇ Video
│
├── My ML course/                    ← any folder you create
│   └── Attention is all you need/
│       └── ...
│
└── .folder.json                     ← hidden per-folder metadata (favorite flag) — only present in starred folders
```

Settings live in your platform's app-data directory:

- **Windows:** `%APPDATA%\youtube-notes\config.json`
- **macOS:** `~/Library/Application Support/youtube-notes/config.json`
- **Linux:** `~/.config/youtube-notes/config.json`

The on-disk format is intentionally portable — `notes.md` is just plain Markdown, openable in any editor (Obsidian, VS Code, etc.) without losing anything except the cached TL;DR (which lives in `meta.json` and is regenerable on demand).

---

## Setup

```bash
cd "youtube detailed notes summarizer"
npm install
npm start
```

On first launch:

1. Click **⚙** in the top-right.
2. Pick a folder to store your notes (defaults to `~/YouTubeNotes`).
3. Click an **+ Add provider** button (Gemini, Groq, OpenRouter, Ollama, LM Studio, or Custom). The new row's edit form opens automatically — paste your API key (or leave blank for local) and click **Save**.
4. Click **Test** to verify the connection.
5. (Optional) Click **↻** next to the Model field to fetch the list of models the endpoint exposes.
6. Click **Done**.

---

## Building a distributable .exe

End users don't need Node, npm, or any of this. Build once with `electron-builder` and ship the resulting installer.

```bash
npm run build              # NSIS installer → dist/YouTube Notes Setup x.y.z.exe
npm run build:portable     # single-file portable .exe (no install)
npm run build:dir          # unpacked folder for testing without making an installer
```

The first build downloads Electron binaries (~80 MB) and takes 2–5 minutes. Subsequent builds are faster (cached). Output lands in `dist/`. End users do NOT need to `npm install` anything — the `.exe` contains all production dependencies pre-resolved.

For code signing, auto-update setup, and other distribution details, see the comments in `package.json`.

---

## Key dependencies

### Runtime

| Package | Version | What it does |
|---|---|---|
| **electron** | `^31` | App framework. Main process (`main.js`) handles the file system, IPC, custom protocols; renderer process is the UI. |
| **marked** | `^12` | Markdown → HTML parser. GFM tables, fenced code, etc. |
| **katex** | `^0.16` | LaTeX math rendering. `katex.renderToString` is called directly from `preload.js` (the `marked-katex-extension` `$...$` tokenizer is bypassed). |
| **youtube-transcript** | `^1.2` | Scrapes YouTube auto-captions. No API key, no rate limit beyond YouTube's own. |
| **@distube/ytdl-core** | `^4.16` | Pure-JS video downloader. Fallback when `yt-dlp` isn't installed. Limited to already-merged formats (≤ 720p typically). |
| **yt-dlp** *(external CLI, recommended)* | latest | Preferred video backend. Auto-detected from `bin/` or `PATH`. Required for 1080p+ (which need stream merging). Install with `winget install yt-dlp` (Windows), `brew install yt-dlp` (macOS), or `pip install yt-dlp`. |

### Development / build

| Package | Version | What it does |
|---|---|---|
| **electron-builder** | `^26` | Packages the app into NSIS installer / portable `.exe` / unpacked folder. |

### Supporting scripts

- `scripts/fetch-yt-dlp.js` — runs as a postinstall hook, downloads the platform's `yt-dlp` binary into `bin/` so it ships with the app.
- `scripts/copy-katex.js` — runs as a postinstall hook, copies KaTeX's CSS + fonts from `node_modules/katex/dist/` into `renderer/vendor/katex/` so the renderer can load them via the strict CSP without needing a CDN.

---

## Limitations

- **Transcript availability:** the app uses YouTube's auto-captions. If the uploader disabled captions, or the video is brand new and YouTube hasn't generated them yet, generation will fail with a clear error. Live streams typically don't have transcripts until the VOD is processed.
- **Long videos:** very long transcripts (multi-hour podcasts) may exceed your model's context window.
- **AV1 video:** Chromium often can't decode AV1 in Electron, so AV1-only formats aren't offered in the download picker. The H.264 / VP9 alternatives at the same or one-step-down resolution are always present.
- **Network:** transcript scraping needs internet. Generation needs internet for cloud providers; Ollama / LM Studio run fully offline once the model is pulled.


