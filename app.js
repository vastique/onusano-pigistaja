'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['jpg','jpeg','png','gif','bmp','tiff','tif','webp','heic']);

// ── State ─────────────────────────────────────────────────────────────────────

let files        = [];
let isProcessing = false;
let stopWiggle   = null;
let errorTimer   = null;
let splashDone   = false;

// ── DOM ───────────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const splashEl     = $('splash');
const splashFrame  = $('splash-frame');
const appEl        = $('app');
const dropZone     = $('drop-zone');
const dropBorder   = $('drop-border');
const dashRect     = $('dash-rect');
const emptyState   = $('empty-state');
const filesReady   = $('files-ready');
const filesLabel   = $('files-label');
const compressBtn  = $('compress-btn');
const errorBubble  = $('error-bubble');
const fileInput    = $('file-input');
const confettiCvs  = $('confetti-canvas');
const confettiCtx  = confettiCvs.getContext('2d');

// ── Splash ─────────────────────────────────────────────────────────────────────

function showApp() {
  if (splashDone) return;
  splashDone = true;
  splashEl.classList.add('done');
  requestAnimationFrame(() => appEl.classList.add('visible'));
}

splashFrame.src = 'assets/splash/onusano-html.html';
(function waitForHype() {
  if (splashDone) return;
  try {
    const hype = splashFrame.contentWindow.HYPE;
    const doc  = hype && hype.documents && hype.documents['onusano-html'];
    if (doc && typeof doc.startTimelineNamed === 'function') {
      doc.startTimelineNamed('Main Timeline', 1);
      requestAnimationFrame(() => {
        splashFrame.style.visibility = 'visible';
        setTimeout(showApp, 2200);
      });
      return;
    }
  } catch(e) {}
  requestAnimationFrame(waitForHype);
}());
setTimeout(showApp, 10000); // hard fallback

function scaleSplashFrame() {
  const scale = window.innerWidth < 600 ? (window.innerWidth * 0.9) / 500 : 1;
  splashFrame.style.transform = scale < 1 ? `scale(${scale})` : '';
}
scaleSplashFrame();
window.addEventListener('resize', scaleSplashFrame);

// ── SVG dash rect ─────────────────────────────────────────────────────────────

const DASH_RX = 16; // must match rx/ry on the SVG rect element

let dashCycle = 14; // kept in sync by fitDashRect

function fitDashRect() {
  const w  = dropZone.offsetWidth;
  const h  = dropZone.offsetHeight;
  const rw = w - 4;
  const rh = h - 4;
  dropBorder.setAttribute('viewBox', `0 0 ${w} ${h}`);
  dashRect.setAttribute('width',  rw);
  dashRect.setAttribute('height', rh);

  // Use pathLength to tell SVG the logical total length = n*14, so the
  // browser normalises stroke-dasharray: 8 6 into exactly n full cycles
  // with zero remainder — no broken dash at the seam.
  const perimeter = 2 * (rw + rh) - 8 * DASH_RX + 2 * Math.PI * DASH_RX;
  const n = Math.round(perimeter / 14);
  dashRect.setAttribute('pathLength', n * 14);
  dashCycle = 14; // animation space is now the normalised 0‥14 cycle
}

new ResizeObserver(fitDashRect).observe(dropZone);
fitDashRect();

// ── Animated dash border ──────────────────────────────────────────────────────

const DASH_SLOW = 14 / 3;   // px/s at rest  (matches old 3s CSS animation)
const DASH_FAST = 14 / 0.7; // px/s on hover (0.7s per cycle)
const DASH_LERP = 5;         // smoothing — higher = snappier

let dashOffset = 0;
let dashSpeed  = DASH_SLOW;
let dashTarget = DASH_SLOW;
let dashPrevTS = null;

function dashFrame(ts) {
  const dt = dashPrevTS === null ? 0 : Math.min((ts - dashPrevTS) / 1000, 0.05);
  dashPrevTS = ts;

  dashSpeed  += (dashTarget - dashSpeed) * Math.min(DASH_LERP * dt, 1);
  dashOffset  = (dashOffset - dashSpeed * dt) % dashCycle;
  dashRect.setAttribute('stroke-dashoffset', dashOffset);
  requestAnimationFrame(dashFrame);
}
requestAnimationFrame(dashFrame);

dropZone.addEventListener('mouseenter', () => { dashTarget = DASH_FAST; });
dropZone.addEventListener('mouseleave', () => { dashTarget = DASH_SLOW; });

// ── UI state ──────────────────────────────────────────────────────────────────

function updateUI() {
  const hasFiles = files.length > 0;
  emptyState.classList.toggle('hidden', isProcessing || hasFiles);
  filesReady.classList.toggle('hidden', isProcessing || !hasFiles);

  if (!isProcessing && hasFiles) {
    filesLabel.textContent = files.length === 1
      ? '1 fail on valmis pigistuseks'
      : `${files.length} faili on valmis pigistuseks`;
    if (!stopWiggle) stopWiggle = startWiggle(filesLabel);
  } else {
    if (stopWiggle) { stopWiggle(); stopWiggle = null; }
  }
}

// ── Wiggle ────────────────────────────────────────────────────────────────────

function startWiggle(el) {
  let alive = true;
  (function tick() {
    if (!alive) return;
    const tx  = (Math.random() - .5) * 7.5;
    const ty  = (Math.random() - .5) * 3;
    const rot = (Math.random() - .5) * 3.75;
    el.style.transition = 'transform .14s cubic-bezier(.34,1.56,.64,1)';
    el.style.transform  = `translate(${tx}px,${ty}px) rotate(${rot}deg)`;
    setTimeout(tick, 140);
  }());
  return () => { alive = false; el.style.transition = ''; el.style.transform = ''; };
}

// ── Error bubble ──────────────────────────────────────────────────────────────

function showErrorBubble() {
  clearTimeout(errorTimer);
  errorBubble.classList.add('visible');
  errorTimer = setTimeout(() => errorBubble.classList.remove('visible'), 3000);
}

// ── File handling ─────────────────────────────────────────────────────────────

function isImage(file) {
  return IMAGE_EXTS.has(file.name.split('.').pop().toLowerCase());
}

async function filesFromEntry(entry) {
  if (entry.isFile) {
    return new Promise(res => entry.file(f => res([f]), () => res([])));
  }
  if (entry.isDirectory) {
    const all = await readAllEntries(entry.createReader());
    const nested = await Promise.all(all.map(filesFromEntry));
    return nested.flat();
  }
  return [];
}

function readAllEntries(reader) {
  return new Promise((res, rej) => {
    const acc = [];
    (function read() {
      reader.readEntries(batch => {
        if (!batch.length) return res(acc);
        acc.push(...batch);
        read();
      }, rej);
    }());
  });
}

function addFiles(newFiles) {
  const key = f => `${f.name}|${f.size}`;
  const existing = new Set(files.map(key));
  const added = newFiles.filter(f => isImage(f) && !existing.has(key(f)));
  if (!added.length) return;
  files = [...files, ...added];
  updateUI();
}

// ── Compression ───────────────────────────────────────────────────────────────

function targetKB(name) {
  if (name.includes('800x50px'))   return 19;
  if (name.includes('600x250px'))  return 105;
  if (name.includes('600x100px'))  return 43;
  if (name.includes('1600x300px')) return 105;
  if (name.includes('1600x100px')) return 43;
  return 98;
}

function dataURLBytes(dataURL) {
  const b64 = dataURL.split(',')[1];
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor(b64.length * 3 / 4) - pad;
}

function b64ToBuffer(dataURL) {
  const bin = atob(dataURL.split(',')[1]);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function compressJPEG(file, maxKB) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const cvs = document.createElement('canvas');
      cvs.width  = img.naturalWidth;
      cvs.height = img.naturalHeight;
      cvs.getContext('2d').drawImage(img, 0, 0);

      let lo = .1, hi = 1;
      let best = cvs.toDataURL('image/jpeg', lo);

      while (hi - lo > .01) {
        const mid  = (lo + hi) / 2;
        const data = cvs.toDataURL('image/jpeg', mid);
        if (dataURLBytes(data) > maxKB * 1024) { hi = mid; }
        else { lo = mid; best = data; }
      }
      res(b64ToBuffer(best));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('load failed')); };
    img.src = url;
  });
}

async function processFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'png') return { name: file.name, data: await file.arrayBuffer() };
  return { name: file.name, data: await compressJPEG(file, targetKB(file.name)) };
}

// ── Output naming ─────────────────────────────────────────────────────────────

function zipName(fileList) {
  const bases = fileList.map(f => {
    const m = f.name.match(/^(.+?)_\d+x\d+px\./);
    return m ? m[1] : null;
  }).filter(Boolean);

  const uniq = [...new Set(bases)];
  if (uniq.length === 1) return `${uniq[0]}-squeezed.zip`;

  if (bases.length > 1) {
    let p = bases[0];
    for (let i = 1; i < bases.length; i++) {
      let j = 0;
      while (j < p.length && j < bases[i].length && p[j] === bases[i][j]) j++;
      p = p.slice(0, j);
    }
    p = p.replace(/[_\- ]+$/, '');
    if (p) return `${p}-squeezed.zip`;
  }
  return 'squeezed.zip';
}

// ── Process & download ────────────────────────────────────────────────────────

async function processFiles() {
  if (!files.length || isProcessing) return;
  isProcessing = true;
  updateUI();

  const toProcess = [...files];
  const name      = zipName(toProcess);
  const entries   = [];

  for (let i = 0; i < toProcess.length; i++) {
    try { entries.push(await processFile(toProcess[i])); }
    catch (e) { console.error('Skipping', toProcess[i].name, e); }
  }

  if (entries.length) {
    const zip    = new JSZip();
    const folder = zip.folder(name.replace('.zip', ''));
    entries.forEach(({ name: n, data }) => folder.file(n, data));

    const blob = await zip.generateAsync({ type: 'blob' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: name
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);

    files = [];
    launchConfetti();
  }

  isProcessing = false;
  updateUI();
}

// ── Confetti ──────────────────────────────────────────────────────────────────

let particles = [];
let lastTS    = 0;
let animating = false;

const confettiImg = new Image();
confettiImg.src = 'assets/os-confetti.png';

class Particle {
  constructor(x, y) {
    const angle  = Math.random() * Math.PI;
    const speed  = 250 + Math.random() * 500;
    this.x       = x;    this.y       = y;
    this.vx      = Math.cos(angle) * speed;
    this.vy      = -Math.sin(angle) * speed;
    this.rot     = Math.random() * Math.PI * 2;
    this.spin    = (Math.random() - .5) * 16;
    this.scale   = .4 + Math.random();
    this.alpha   = .8 + Math.random() * .2;
    this.maxLife = 3.5 + Math.random();
    this.age     = 0;
  }

  update(dt) {
    this.vy  += 350 * dt;
    this.x   += this.vx  * dt;
    this.y   += this.vy  * dt;
    this.rot += this.spin * dt;
    this.alpha -= .25 * dt;
    this.age   += dt;
    return this.age < this.maxLife && this.alpha > 0;
  }

  draw(ctx) {
    if (!confettiImg.complete || !confettiImg.naturalWidth) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.alpha);
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    const w = confettiImg.naturalWidth  * this.scale * .9;
    const h = confettiImg.naturalHeight * this.scale * .9;
    ctx.drawImage(confettiImg, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

function confettiFrame(ts) {
  const dt = Math.min((ts - lastTS) / 1000, .05);
  lastTS = ts;

  const w = window.innerWidth, h = window.innerHeight;
  if (confettiCvs.width !== w || confettiCvs.height !== h) {
    confettiCvs.width = w; confettiCvs.height = h;
  }
  confettiCtx.clearRect(0, 0, w, h);
  particles = particles.filter(p => { const a = p.update(dt); if (a) p.draw(confettiCtx); return a; });

  if (particles.length) requestAnimationFrame(confettiFrame);
  else animating = false;
}

function burst(x, y, n) {
  for (let i = 0; i < n; i++) particles.push(new Particle(x, y));
}

function launchConfetti() {
  const cx = window.innerWidth  / 2;
  const cy = window.innerHeight * .6;
  burst(cx, cy, 15);
  setTimeout(() => burst(cx, cy, 15), 500);
  setTimeout(() => burst(cx, cy, 15), 1000);
  if (!animating) {
    animating = true;
    lastTS = performance.now();
    requestAnimationFrame(confettiFrame);
  }
  setTimeout(() => { particles = []; }, 5000);
}

// ── Drag & drop ───────────────────────────────────────────────────────────────

let dragCount = 0;

document.addEventListener('dragenter', e => {
  e.preventDefault();
  if (++dragCount === 1) dropZone.classList.add('drag-over');
});
document.addEventListener('dragover', e => { e.preventDefault(); });
document.addEventListener('dragleave', () => {
  if (--dragCount <= 0) { dragCount = 0; dropZone.classList.remove('drag-over'); }
});
document.addEventListener('drop', async e => {
  e.preventDefault();
  dragCount = 0;
  dropZone.classList.remove('drag-over');

  // Capture everything synchronously — DataTransfer becomes invalid after any await
  const items    = Array.from(e.dataTransfer.items || []);
  const entries  = items.filter(i => i.kind === 'file').map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  const fallback = Array.from(e.dataTransfer.files || []);

  if (entries.length) {
    const resolved = (await Promise.all(entries.map(filesFromEntry))).flat();
    addFiles(resolved.length ? resolved : fallback);
  } else {
    addFiles(fallback);
  }
});

// ── Click / keyboard to open picker ──────────────────────────────────────────

dropZone.addEventListener('click', () => { if (!files.length && !isProcessing) fileInput.click(); });
dropZone.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && !files.length && !isProcessing) {
    e.preventDefault(); fileInput.click();
  }
});
fileInput.addEventListener('change', () => {
  addFiles(Array.from(fileInput.files));
  fileInput.value = '';
});

// ── Compress button ───────────────────────────────────────────────────────────

compressBtn.addEventListener('click', () => {
  if (isProcessing) return;
  if (!files.length) showErrorBubble();
  else processFiles();
});

// ── Init ──────────────────────────────────────────────────────────────────────

confettiCvs.width  = window.innerWidth;
confettiCvs.height = window.innerHeight;
updateUI();
