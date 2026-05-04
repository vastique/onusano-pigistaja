# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running Locally

No build step required — this is a static site. Serve it with any static file server:

```bash
python3 -m http.server 8080
# or
npx http-server .
```

## Architecture

**Bänneripigistaja** (Estonian for "Banner Squeezer") is a single-page vanilla JS web app for compressing advertising banner images into a ZIP archive.

### File Structure

- [index.html](index.html) — HTML shell; references app.js and styles.css inline
- [app.js](app.js) — All application logic (~390 lines, no framework)
- [styles.css](styles.css) — All styles (CSS custom properties, animations)
- [assets/](assets/) — Logo SVG, splash animation (HTML/Hype), confetti sprite, error bubble SVG

### How It Works

1. **Splash screen** — An HTML animation (Tumult Hype) plays in an iframe on load; the app becomes interactive after it ends (or after a 10s timeout).
2. **File ingestion** — Drop zone accepts drag-and-drop or click-to-pick. Supports JPG, JPEG, PNG, GIF, BMP, TIFF, WEBP, HEIC. Directories are walked recursively.
3. **Compression** — Each file is drawn onto a canvas and re-encoded as JPEG. Target file size is determined by banner dimensions parsed from the filename (e.g. `banner_800x50px.jpg` → 19 KB target). The quality level is found via binary search. PNG files pass through unchanged.
4. **Output** — All compressed files are packed into a ZIP (JSZip 3.10.1 from CDN) and downloaded. The ZIP name is derived from a shared base name extracted from the input filenames.

### State & Patterns

- Global state: `files` (array), `isProcessing`, `splashDone`, `particles`, `stopWiggle`, `errorTimer`
- DOM helper: `$('id')` is shorthand for `getElementById`
- Async work uses plain Promises; no async/await
- Confetti uses a `Particle` class with a `requestAnimationFrame` render loop
- UI feedback: wiggle animation on file count, error bubble with 3s auto-dismiss

### Target Size Map

Hardcoded in `app.js` — if new banner sizes need different targets, add entries to the `TARGET_SIZES` object (dimensions key `"WxH"` → KB value).

### External Dependency

JSZip 3.10.1 is loaded from `cdnjs.cloudflare.com`. There is no lock file; if the CDN URL needs updating, change the `<script>` tag in [index.html](index.html).
