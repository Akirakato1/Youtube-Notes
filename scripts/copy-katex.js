// Copies KaTeX's CSS + font files from node_modules into renderer/vendor/katex/
// so the renderer can reference them via relative URL (renderer can't reach
// node_modules due to contextIsolation/CSP).
//
// Runs automatically on `npm install` via the "postinstall" script. Idempotent.
// Failure here is non-fatal: math just won't render until copy succeeds.

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'node_modules', 'katex', 'dist');
const DEST_DIR = path.join(__dirname, '..', 'renderer', 'vendor', 'katex');

if (!fs.existsSync(SRC_DIR)) {
  console.warn(`[copy-katex] node_modules/katex/dist not found — skipping`);
  process.exit(0);
}

try {
  fs.mkdirSync(DEST_DIR, { recursive: true });
  fs.mkdirSync(path.join(DEST_DIR, 'fonts'), { recursive: true });

  // Main CSS
  fs.copyFileSync(
    path.join(SRC_DIR, 'katex.min.css'),
    path.join(DEST_DIR, 'katex.min.css')
  );

  // All font files (woff/woff2/ttf for various weights and families)
  const fontsSrc = path.join(SRC_DIR, 'fonts');
  let fontCount = 0;
  for (const entry of fs.readdirSync(fontsSrc)) {
    fs.copyFileSync(path.join(fontsSrc, entry), path.join(DEST_DIR, 'fonts', entry));
    fontCount++;
  }

  console.log(`[copy-katex] Copied katex.min.css + ${fontCount} font files to ${DEST_DIR}`);
} catch (err) {
  console.warn(`[copy-katex] Copy failed: ${err.message}`);
  console.warn('[copy-katex] Math rendering will not work until this succeeds. Run `npm run copy-katex` to retry.');
  process.exit(0); // non-fatal
}
