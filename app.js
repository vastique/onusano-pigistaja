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
const splashVideo  = $('splash-video');
const appEl        = $('app');
const dropZone     = $('drop-zone');
const dropBorder   = $('drop-border');
const dashRect     = $('dash-rect');
const emptyState   = $('empty-state');
const filesReady   = $('files-ready');
const filesLabel   = $('files-label');
const processingEl = $('processing-state');
const statusMsg    = $('status-msg');
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

splashVideo.addEventListener('ended', showApp);
splashVideo.addEventListener('error', showApp);
splashVideo.play().catch(showApp);
setTimeout(showApp, 10000); // hard fallback

// ── SVG dash rect ─────────────────────────────────────────────────────────────

function fitDashRect() {
  const w = dropZone.offsetWidth;
  const h = dropZone.offsetHeight;
  dropBorder.setAttribute('viewBox', `0 0 ${w} ${h}`);
  dashRect.setAttribute('width',  w - 4);
  dashRect.setAttribute('height', h - 4);
}

new ResizeObserver(fitDashRect).observe(dropZone);
fitDashRect();

// ── UI state ──────────────────────────────────────────────────────────────────

function updateUI() {
  const hasFiles = files.length > 0;
  emptyState.classList.toggle('hidden',   isProcessing || hasFiles);
  filesReady.classList.toggle('hidden',   isProcessing || !hasFiles);
  processingEl.classList.toggle('hidden', !isProcessing);

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
    const tx  = (Math.random() - .5) * 10;
    const ty  = (Math.random() - .5) *  4;
    const rot = (Math.random() - .5) *  5;
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
    statusMsg.textContent = `Pigistan pilte… (${i + 1}/${toProcess.length})`;
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

dropZone.addEventListener('dragenter', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', e => {
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', async e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const items   = Array.from(e.dataTransfer.items || []);
  const entries = items.filter(i => i.kind === 'file').map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length) {
    addFiles((await Promise.all(entries.map(filesFromEntry))).flat());
  } else {
    addFiles(Array.from(e.dataTransfer.files || []));
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
