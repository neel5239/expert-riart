// RI'S ART — AR nail try-on controller.
// Hand tracking: MediaPipe HandLandmarker. Nails: NailNet segmentation + WebGL recolour (ar-gl.js),
// with a Canvas 2D fallback (ar-2d.js) on devices without WebGL2 float render targets.
// Everything runs on the device; camera frames and photos are never uploaded.

import { SHAPES, LENGTHS, DESIGNS, nailSVG } from './nailshape.js';
import { drawHand2D } from './ar-2d.js';

const C = window.RISART;
const T = C.tryon;
const AR = 'assets/ar/';
const $ = s => document.querySelector(s);

/* ------------------------------------------------------------------ hand geometry */
const FINGERS = [[4, 3], [8, 7], [12, 11], [16, 15], [20, 19]];
const KNUCKLE = [2, 5, 9, 13, 17];
const PALM = [0, 1, 2, 5, 9, 13, 17];

// back of the hand = nails visible. Chirality of the palm triangle vs reported handedness (calibrated: T.chirality).
function isBackOfHand(lm, handed) {
  const ax = lm[5].x - lm[0].x, ay = lm[5].y - lm[0].y, bx = lm[17].x - lm[0].x, by = lm[17].y - lm[0].y;
  const z = ax * by - ay * bx;
  if (!handed || handed.score < 0.6) return true;
  return z * (handed.categoryName === 'Right' ? 1 : -1) * T.chirality > 0;
}
function insidePalm(pts, p) {
  let inside = false;
  const poly = PALM.map(i => pts[i]);
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
// fingertip deeper than its own knuckle = folded under the hand (measured: tucked +0.07…+0.10, visible below −0.05)
function tucked(raw, f, ti) {
  if (raw[ti].z === undefined) return false;
  const span = Math.hypot(raw[5].x - raw[17].x, raw[5].y - raw[17].y) || 1;
  const k = f === 0 ? (raw[5].z + raw[9].z) / 2 : raw[KNUCKLE[f]].z;
  return (raw[ti].z - k) / span > 0.02;
}
// which nails can the camera see? Back of hand: every finger not folded into the palm.
// Palm toward the camera: only fingers curled in (the "checking my manicure" pose) show their nails.
// Returns null when no nail can be visible (an open palm), for the "turn your hand over" hint.
// strict = landmarks only (2D fallback). Otherwise the nail model gets the final say on thumbs and
// folded fingers: tested on the hold-out video it finds far more real nails and paints almost no extra skin.
function visibleFingers(h, W, H, strict = false) {
  const px = h.raw.map(p => ({ x: p.x * W, y: p.y * H }));
  // the thumb's depth can't tell "lying flat" from "folded under" (both ~+0.09), so the thumb is never judged on depth
  if (isBackOfHand(h.raw, h.handed))
    return FINGERS.map(([ti], f) => f === 0 || (!insidePalm(px, px[ti]) && (!strict || !tucked(h.raw, f, ti))));
  const vis = FINGERS.map(([ti, di], f) => {
    if (f === 0) return !strict;
    const mcp = KNUCKLE[f], pip = mcp + 1;
    const ax = px[pip].x - px[mcp].x, ay = px[pip].y - px[mcp].y, bx = px[ti].x - px[di].x, by = px[ti].y - px[di].y;
    return (ax * bx + ay * by) / ((Math.hypot(ax, ay) * Math.hypot(bx, by)) || 1) < -0.25;
  });
  return vis.some(Boolean) ? vis : null;
}

// palm toward the camera with no curled finger: the hint asks the user to turn their hand
const palmOnly = vis => !vis || !vis.slice(1).some(Boolean);

class OneEuro {
  constructor(minCutoff = 1.4, beta = 6, dCutoff = 1.2) { Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: 0 }); }
  alpha(c, dt) { const r = 2 * Math.PI * c * dt; return r / (r + 1); }
  filter(x, t) {
    if (this.x === null) { this.x = x; this.t = t; return x; }
    const dt = Math.max(1e-3, t - this.t); this.t = t;
    this.dx += this.alpha(this.dCutoff, dt) * ((x - this.x) / dt - this.dx);
    this.x += this.alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt) * (x - this.x);
    return this.x;
  }
}

/* ------------------------------------------------------------------ DOM + state */
const dlg = $('#ar'), view = $('#ar-view'), video = $('#ar-video'), photoCv = $('#ar-photo');
const glCv = $('#ar-gl'), cv2d = $('#ar-canvas'), ctx2d = cv2d.getContext('2d');
const hint = $('#ar-hint'), flipBtn = $('#ar-flip'), fileIn = $('#ar-file');

const look = { shade: T.shades[0].hex, design: 'gloss', shape: 'almond', length: 'medium' };
let mode = 'live', facing = 'environment';
let stream = null, landmarker = null, renderer = null, rmode = null, loading = null;
let running = false, loopId = 0, lastVideoT = -1, lastTs = 0, hintTimer = 0;
let hands = [], photoHands = [], lastNails = 0, lastPalm = 0;
// The GPU and CPU hand trackers fail on different frames (the GPU one loses hands in washed-out, backlit video).
// When the active one sees no hand for a while, the other one gets a turn.
let makeSpare = null, spare = null, missCount = 0, swapping = false;
async function swapDetector() {
  if (swapping || !makeSpare) return;
  swapping = true;
  try {
    spare ||= await makeSpare().catch(() => null);
    if (spare) { await spare.setOptions({ runningMode: 'VIDEO' }); [landmarker, spare] = [spare, landmarker]; }
  } finally { swapping = false; missCount = 0; }
}
function noteDetection(res) {
  if (res.landmarks.length) missCount = 0;
  else if (++missCount >= 12) swapDetector();
  return res;
}
let dpr = 1, vw = 0, vh = 0;

function setHint(msg) { if (hint.textContent !== msg) hint.textContent = msg; hint.hidden = !msg; }

async function loadEngine() {
  if (landmarker) return;
  if (loading) return loading;
  loading = (async () => {
    setHint('Loading try-on… first time takes a few seconds');
    const { FilesetResolver, HandLandmarker } = await import(`./${AR}vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(new URL(`${AR}wasm`, location.href).href);
    const opts = delegate => ({
      baseOptions: { modelAssetPath: new URL(`${AR}hand_landmarker.task`, location.href).href, delegate },
      runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.35, minHandPresenceConfidence: 0.35, minTrackingConfidence: 0.4,
    });
    try { landmarker = await HandLandmarker.createFromOptions(fileset, opts('GPU')); landmarker.delegate = 'GPU'; }
    catch { landmarker = await HandLandmarker.createFromOptions(fileset, opts('CPU')); landmarker.delegate = 'CPU'; }
    makeSpare = async () => { const d = landmarker.delegate === 'GPU' ? 'CPU' : 'GPU';
      const l = await HandLandmarker.createFromOptions(fileset, opts(d)); l.delegate = d; return l; };
    try {
      const [{ GLRenderer }, spec, w] = await Promise.all([
        import('./ar-gl.js'),
        fetch(`${AR}nailnet.json`).then(r => r.json()),
        fetch(`${AR}nailnet.bin`).then(r => r.arrayBuffer()),
      ]);
      renderer = new GLRenderer(glCv, spec, new Float32Array(w));
      rmode = 'gl';
    } catch (e) {
      console.warn('try-on: WebGL nail renderer unavailable, using the simple renderer', e);
      rmode = '2d';
    }
    view.dataset.renderer = rmode;
  })();
  try { await loading; } finally { loading = null; }
}

/* ------------------------------------------------------------------ sizing + mapping */
function resize() {
  const r = view.getBoundingClientRect();
  vw = r.width; vh = r.height; dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const c of [glCv, cv2d]) { c.width = Math.round(vw * dpr); c.height = Math.round(vh * dpr); }
  if (mode === 'photo') draw();
}
new ResizeObserver(resize).observe(view);

function source() {
  return mode === 'photo' || mode === 'feed' ? { el: photoCv, w: photoCv.width, h: photoCv.height, fit: 'contain', mirror: false }
    : { el: video, w: video.videoWidth, h: video.videoHeight, fit: 'cover', mirror: facing === 'user' };
}
function mapper(sw, sh, fit, mirror) {    // normalized landmark -> view CSS px (2D fallback)
  const s = fit === 'cover' ? Math.max(vw / sw, vh / sh) : Math.min(vw / sw, vh / sh);
  const ox = (vw - sw * s) / 2, oy = (vh - sh * s) / 2;
  return p => { let x = ox + p.x * sw * s; const y = oy + p.y * sh * s; if (mirror) x = vw - x; return { x, y }; };
}
const tiltOf = lm => Math.atan2(lm[17].y - lm[5].y, lm[17].x - lm[5].x);

/* ------------------------------------------------------------------ auto levels
   Backlit or cheap cameras give washed-out, tinted frames where the hand tracker loses the hand and the nail
   model can't separate nail from skin. Low-contrast frames are stretched for tracking and for the network. The picture on screen is left as the camera shot it. */
const lvCv = document.createElement('canvas'); lvCv.width = 48; lvCv.height = 36;
const lvCtx = lvCv.getContext('2d', { willReadFrequently: true });
const detCv = document.createElement('canvas'), detCtx = detCv.getContext('2d', { willReadFrequently: true });
let levels = { lo: [0, 0, 0], hi: [1, 1, 1], k: 0 }, lvCount = 0;
function measureLevels(el, force = false) {
  if (!force && lvCount++ % 6) return levels;
  lvCtx.drawImage(el, 0, 0, 48, 36);
  const d = lvCtx.getImageData(0, 0, 48, 36).data, n = 48 * 36, lo = [], hi = [], v = new Uint8Array(n);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) v[i] = d[i * 4 + c];
    v.sort(); lo.push(v[Math.floor(n * 0.02)] / 255); hi.push(v[Math.floor(n * 0.98)] / 255);
  }
  // one stretch for all channels: a vivid scene (a blue wall) is not a colour cast and keeps its colours
  const L = Math.min(...lo), H = Math.max(...hi), range = H - L;
  const k = Math.min(1, Math.max(0, (0.8 - range) / 0.3));          // only low-contrast frames are touched
  const next = { lo: [L * k, L * k, L * k], hi: [1 - (1 - H) * k, 1 - (1 - H) * k, 1 - (1 - H) * k], k };
  const t = force ? 1 : 0.35;
  levels = { lo: levels.lo.map((x, c) => x + (next.lo[c] - x) * t), hi: levels.hi.map((x, c) => x + (next.hi[c] - x) * t), k: levels.k + (k - levels.k) * t };
  return levels;
}
// the frame the hand tracker sees: the source itself, or a levels-stretched copy (max 640 px wide)
function detectionInput(el, w, h) {
  if (levels.k < 0.05) return el;
  const s = Math.min(1, 640 / w); detCv.width = Math.round(w * s); detCv.height = Math.round(h * s);
  detCtx.drawImage(el, 0, 0, detCv.width, detCv.height);
  const img = detCtx.getImageData(0, 0, detCv.width, detCv.height), d = img.data;
  const lut = [0, 1, 2].map(c => { const t = new Uint8Array(256), lo = levels.lo[c] * 255, sc = 255 / Math.max(12, (levels.hi[c] - levels.lo[c]) * 255);
    for (let i = 0; i < 256; i++) t[i] = Math.max(0, Math.min(255, (i - lo) * sc)); return t; });
  for (let i = 0; i < d.length; i += 4) { d[i] = lut[0][d[i]]; d[i + 1] = lut[1][d[i + 1]]; d[i + 2] = lut[2][d[i + 2]]; }
  detCtx.putImageData(img, 0, 0);
  return detCv;
}

/* ------------------------------------------------------------------ per-frame work */
function segmentFrom(list, fresh) {
  const s = source();
  if (!s.w || !renderer) return { nails: 0, palm: 0 };
  renderer.upload(s.el);
  renderer.levels = levels;
  const hs = [];
  let palm = 0;
  for (const h of list) {
    const vis = visibleFingers(h, s.w, s.h);
    if (palmOnly(vis) && !isBackOfHand(h.raw, h.handed)) palm++;
    if (!vis) continue;
    hs.push({ slot: h.slot, px: h.lm.map(p => ({ x: p.x * s.w, y: p.y * s.h })), visible: vis });
  }
  const nails = renderer.segment(hs, s.w, s.h, fresh);
  return { nails: nails.filter(n => n.geo).length, palm };
}

function draw() {
  const s = source();
  if (!s.w) return;
  const list = mode === 'photo' ? photoHands : hands;
  const tilt = list[0] ? tiltOf(list[0].lm) : 0;
  if (rmode === 'gl') {
    cv2d.hidden = true; glCv.hidden = false;
    renderer.composite(look, { vw: glCv.width, vh: glCv.height, fit: s.fit, mirror: s.mirror, tilt });
    return;
  }
  // 2D fallback: camera stays visible underneath, nails drawn on top
  glCv.hidden = true; cv2d.hidden = false;
  ctx2d.setTransform(1, 0, 0, 1, 0, 0); ctx2d.clearRect(0, 0, cv2d.width, cv2d.height);
  const map = mapper(s.w, s.h, s.fit, s.mirror);
  let n = 0, palm = 0;
  for (const h of list) {
    const vis = visibleFingers(h, s.w, s.h, true);
    if (!vis) { palm++; continue; }
    n += drawHand2D(ctx2d, h.lm.map(map), vis, look, dpr);
  }
  lastNails = n; lastPalm = palm;
}

function matchHands(res, t) {
  const next = [];
  res.landmarks.forEach((lm, i) => {
    let prev = null, best = 0.15;
    for (const h of hands) {
      const d = Math.hypot(h.raw[0].x - lm[0].x, h.raw[0].y - lm[0].y);
      if (d < best && !next.includes(h)) { best = d; prev = h; }
    }
    const h = prev || { filters: lm.map(() => [new OneEuro(), new OneEuro()]), slot: -1 };
    h.raw = lm;
    h.lm = lm.map((p, j) => ({ x: h.filters[j][0].filter(p.x, t), y: h.filters[j][1].filter(p.y, t), z: p.z }));
    h.handed = res.handedness?.[i]?.[0];
    h.seen = t;
    next.push(h);
  });
  for (const h of hands) if (!next.includes(h) && t - h.seen < 0.15) next.push(h);
  const used = new Set(next.filter(h => h.slot >= 0).map(h => h.slot));
  const fresh = new Set();
  for (const h of next) if (h.slot < 0) { h.slot = used.has(0) ? 1 : 0; used.add(h.slot); for (let f = 0; f < 5; f++) fresh.add(h.slot * 5 + f); }
  hands = next.filter(h => h.slot < 2);
  return fresh;
}

function frame(id) {
  if (!running || id !== loopId) return;
  if (video.readyState >= 2 && video.currentTime !== lastVideoT && landmarker) {
    lastVideoT = video.currentTime;
    let ts = performance.now(); if (ts <= lastTs) ts = lastTs + 1; lastTs = ts;
    measureLevels(video);
    const fresh = matchHands(noteDetection(landmarker.detectForVideo(detectionInput(video, video.videoWidth, video.videoHeight), ts)), ts / 1000);
    if (rmode === 'gl') { const r = segmentFrom(hands, fresh); lastNails = r.nails; lastPalm = r.palm; }
  }
  draw();
  const now = performance.now();
  if (lastNails) { setHint(''); hintTimer = now; }
  else if (now - hintTimer > 700) setHint(lastPalm ? 'Turn your hand over. Nails show on the back of the hand.' : 'Show the back of your hand, fingers spread.');
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => frame(id));
  else requestAnimationFrame(() => frame(id));
}
function startLoop() { running = true; frame(++loopId); }

/* ------------------------------------------------------------------ camera + photo */
let camError = '';
const streamLive = () => !!stream && stream.getVideoTracks().some(t => t.readyState === 'live');
async function startCamera() {
  stopCamera();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    setHint(camError = 'The camera needs a secure (https) page. Use "Photo" to try on a picture instead.');
    return false;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  } catch (e) {
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    setHint(camError = denied ? 'Camera access is blocked. Allow it in your browser settings, or use "Photo".' : 'No camera found. Use "Photo" to try on a picture instead.');
    return false;
  }
  video.srcObject = stream;                       // <video autoplay muted playsinline> starts itself
  video.play().catch(() => {});                   // older iOS needs the nudge
  video.classList.toggle('mirror', facing === 'user');
  await new Promise(r => (video.readyState >= 2 ? r() : video.addEventListener('loadeddata', r, { once: true })));
  hands = [];
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
  flipBtn.hidden = cams.length < 2;
  return true;
}
function stopCamera() {
  running = false;
  stream?.getTracks().forEach(t => t.stop());
  stream = null; video.srcObject = null;
}

async function goLive() {
  mode = 'live'; view.dataset.mode = 'live';
  photoCv.hidden = true; video.hidden = false;
  // Ask for the camera the moment the visitor taps, so the browser's permission prompt shows at once
  // (Safari would otherwise wait for the engine download). The engine loads behind the prompt.
  // A camera that is already running is reused: restarting it makes Safari ask again.
  const cam = streamLive() ? Promise.resolve(true) : startCamera();
  await loadEngine().catch(() => setHint('Try-on could not load. Check your connection and try again.'));
  const ok = await cam;
  if (!landmarker) return;
  await landmarker.setOptions({ runningMode: 'VIDEO' });
  if (ok) { setHint('Show the back of your hand, fingers spread.'); hintTimer = performance.now(); if (!running) startLoop(); }
  else setHint(camError);
}

async function goPhoto(file) {
  stopCamera();
  mode = 'photo'; view.dataset.mode = 'photo';
  video.hidden = true;
  setHint('Finding your hand…');
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { setHint('That file could not be opened. Try a JPG or PNG photo.'); return; }
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  photoCv.width = Math.round(bmp.width * scale); photoCv.height = Math.round(bmp.height * scale);
  photoCv.getContext('2d').drawImage(bmp, 0, 0, photoCv.width, photoCv.height);
  await loadEngine().catch(() => {});
  if (!landmarker) { setHint('Try-on could not load. Check your connection and try again.'); return; }
  photoCv.hidden = rmode === 'gl';
  // photos can be smaller or busier than a live camera frame: detect more permissively
  await landmarker.setOptions({ runningMode: 'IMAGE', minHandDetectionConfidence: 0.25, minHandPresenceConfidence: 0.25 });
  measureLevels(photoCv, true);
  let res = landmarker.detect(detectionInput(photoCv, photoCv.width, photoCv.height));
  await landmarker.setOptions({ minHandDetectionConfidence: 0.35, minHandPresenceConfidence: 0.35 });
  if (!res.landmarks.length && makeSpare) {          // the other tracker may see the hand in this photo
    spare ||= await makeSpare().catch(() => null);
    if (spare) {
      await spare.setOptions({ runningMode: 'IMAGE', minHandDetectionConfidence: 0.25, minHandPresenceConfidence: 0.25 });
      res = spare.detect(detectionInput(photoCv, photoCv.width, photoCv.height));
      await spare.setOptions({ minHandDetectionConfidence: 0.35, minHandPresenceConfidence: 0.35 });
    }
  }
  photoHands = res.landmarks.slice(0, 2).map((lm, i) => ({ lm, raw: lm, handed: res.handedness?.[i]?.[0], slot: i }));
  if (rmode === 'gl') {
    const all = new Set([...Array(10).keys()]);
    const r = segmentFrom(photoHands, all);
    lastNails = r.nails; lastPalm = r.palm;
  }
  draw();
  if (!photoHands.length) setHint('No hand found. Use a clear photo of the back of your hand, fingers spread, in good light.');
  else if (!lastNails) setHint(lastPalm ? 'This photo shows a palm. Nails show on the back of the hand.' : 'No nails found. Try a closer, sharper photo of the back of your hand.');
  else setHint('');
}

/* ------------------------------------------------------------------ capture + share */
async function capture() {
  const s = source();
  if (!s.w) return;
  const out = document.createElement('canvas');
  out.width = s.w; out.height = s.h;
  const x = out.getContext('2d');
  const list = mode === 'photo' ? photoHands : hands;
  if (rmode === 'gl') {
    x.putImageData(renderer.captureImage(look, { mirror: s.mirror, tilt: list[0] ? tiltOf(list[0].lm) : 0 }), 0, 0);
  } else {
    if (s.mirror) { x.translate(s.w, 0); x.scale(-1, 1); }
    x.drawImage(s.el, 0, 0, s.w, s.h);
    x.setTransform(1, 0, 0, 1, 0, 0);
    for (const h of list) {
      const vis = visibleFingers(h, s.w, s.h, true); if (!vis) continue;
      drawHand2D(x, h.lm.map(p => ({ x: s.mirror ? s.w - p.x * s.w : p.x * s.w, y: p.y * s.h })), vis, look, 1);
    }
  }
  const pad = Math.round(s.w * 0.03);
  x.font = `500 ${Math.round(s.w * 0.026)}px "Bodoni Moda", Georgia, serif`;
  x.fillStyle = 'rgba(255,248,245,.92)'; x.shadowColor = 'rgba(36,18,22,.6)'; x.shadowBlur = 8;
  x.fillText(`RI'S ART · ${describe()}`, pad, s.h - pad);
  showShot(await new Promise(r => out.toBlob(r, 'image/jpeg', 0.92)));
}

function showShot(blob) {
  const url = URL.createObjectURL(blob);
  const file = new File([blob], 'risart-try-on.jpg', { type: 'image/jpeg' });
  $('#ar-result-img').src = url;
  $('#ar-save').href = url;
  const share = $('#ar-share');
  share.hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
  share.onclick = () => navigator.share({ files: [file], title: "My RI'S ART look", text: describe() }).catch(() => {});
  $('#ar-result').hidden = false;
  $('#ar-result-close').focus();
}

/* ------------------------------------------------------------------ controls */
const nameOf = (list, id) => (list.find(x => x.id === id) || {}).name || id;
function describe() {
  const s = T.shades.find(x => x.hex.toLowerCase() === look.shade.toLowerCase());
  return [s ? s.name : look.shade, nameOf(DESIGNS, look.design), nameOf(SHAPES, look.shape), nameOf(LENGTHS, look.length)].join(', ');
}

const rails = {
  shade: { el: $('#ar-rail-shade'), items: T.shades.map(s => ({ val: s.hex, name: s.name })) },
  design: { el: $('#ar-rail-design'), items: DESIGNS.map(d => ({ val: d.id, name: d.name })) },
  shape: { el: $('#ar-rail-shape'), items: SHAPES.map(d => ({ val: d.id, name: d.name })) },
  length: { el: $('#ar-rail-length'), items: LENGTHS.map(d => ({ val: d.id, name: d.name })) },
};
for (const [key, r] of Object.entries(rails)) {
  r.el.setAttribute('aria-label', key[0].toUpperCase() + key.slice(1));
  r.el.addEventListener('click', e => {
    const b = e.target.closest('.ar-chip'); if (!b) return;
    look[key] = b.dataset.val;
    syncControls();
    r.el.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
    if (mode === 'photo') draw();
  });
}

function syncControls() {
  for (const [key, r] of Object.entries(rails)) {
    const left = r.el.scrollLeft;
    r.el.innerHTML = r.items.map(it => {
      const on = look[key] === it.val;
      const svg = nailSVG({ ...look, [key]: it.val, accent: true, width: 34 });
      return `<button type="button" class="ar-chip" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-val="${it.val}">${svg}<span>${it.name}</span></button>`;
    }).join('');
    r.el.scrollLeft = left;
  }
  $('#ar-look').textContent = describe();
}

document.addEventListener('keydown', e => {
  const b = e.target.closest?.('.ar-chip'); if (!b || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const sib = e.key === 'ArrowRight' ? b.nextElementSibling : b.previousElementSibling;
  if (sib) { sib.click(); e.preventDefault(); }
});

const tabs = [...document.querySelectorAll('.ar-tab')];
tabs.forEach(t => t.addEventListener('click', () => {
  tabs.forEach(o => { o.setAttribute('aria-selected', o === t); $('#' + o.getAttribute('aria-controls')).hidden = o !== t; });
  $('#' + t.getAttribute('aria-controls')).querySelector('[aria-checked="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}));

/* ------------------------------------------------------------------ open / close */
async function open(preset, photo) {
  Object.assign(look, preset || {});
  $('#ar-result').hidden = true;
  if (!dlg.open) dlg.showModal();
  document.documentElement.classList.add('ar-open');
  requestAnimationFrame(() => { resize(); syncControls(); });
  if (photo) await goPhoto(photo); else await goLive();
}
function close() { stopCamera(); $('#ar-result').hidden = true; if (dlg.open) dlg.close(); }
dlg.addEventListener('close', () => { stopCamera(); document.documentElement.classList.remove('ar-open'); });

$('#ar-close').addEventListener('click', close);
flipBtn.addEventListener('click', async () => { facing = facing === 'user' ? 'environment' : 'user'; running = false; if (await startCamera()) startLoop(); });
$('#ar-live').addEventListener('click', goLive);
fileIn.addEventListener('change', () => { const f = fileIn.files[0]; if (f) goPhoto(f); fileIn.value = ''; });
$('#ar-shot').addEventListener('click', capture);
$('#ar-result-close').addEventListener('click', () => { $('#ar-result').hidden = true; });

$('#ar-book').addEventListener('click', () => {
  const form = $('#book-form');
  const d = look.design;
  form.service.value = ['french', 'microfrench'].includes(d) ? 'French, any colour'
    : ['chrome', 'cateye'].includes(d) ? 'Chrome & cat-eye'
    : ['glitter', 'foil', 'marble', 'tortoise', 'aura'].includes(d) ? 'Nail art, per set'
    : look.length !== 'natural' ? 'Gel extensions' : 'Gel polish';
  form.idea.value = `Try-on look: ${describe()} (${look.shade})`;
  close();
  $('#book').scrollIntoView({ behavior: 'instant', block: 'start' });
  form.name.focus({ preventScroll: true });
});

// Leaving the tab pauses tracking but keeps the camera for a minute, so a quick app switch doesn't
// trigger Safari's permission prompt again. After that the camera is released.
let hiddenTimer = 0;
document.addEventListener('visibilitychange', () => {
  if (!dlg.open || mode !== 'live') return;
  if (document.hidden) { running = false; hiddenTimer = setTimeout(stopCamera, 60000); return; }
  clearTimeout(hiddenTimer);
  if (streamLive()) { video.play().catch(() => {}); startLoop(); } else goLive();
});

document.addEventListener('click', e => {
  const t = e.target.closest('[data-tryon]');
  if (!t) return;
  e.preventDefault();
  let preset = {};
  try { preset = JSON.parse(t.dataset.tryon || '{}'); } catch {}
  open(preset);
});
$('#tryon-file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) open({}, f); });

// warm the engine while the visitor reads the menu, on a good connection only
const warm = new IntersectionObserver(([e]) => {
  if (!e.isIntersecting) return;
  warm.disconnect();
  if (navigator.connection?.saveData) return;
  (window.requestIdleCallback || (f => setTimeout(f, 1500)))(() => loadEngine().then(() => { if (!dlg.open) setHint(''); }).catch(() => {}));
}, { rootMargin: '400px' });
warm.observe($('#tryon'));

// test hook: lets automated checks drive the try-on without a camera
window.__risartTryOn = {
  open, goPhoto, look, describe, draw,
  get hands() { return mode === 'photo' ? photoHands : hands; },
  // test: push one video frame through the live path (tracking + smoothing), return painted coverage
  async feedFrame(blob, tMs, lookOver) {
    if (mode !== 'feed') { stopCamera(); mode = 'feed'; hands = []; video.hidden = true; await loadEngine(); await landmarker.setOptions({ runningMode: 'VIDEO' }); photoCv.hidden = rmode === 'gl'; }
    const bmp = await createImageBitmap(blob);
    photoCv.width = bmp.width; photoCv.height = bmp.height; photoCv.getContext('2d').drawImage(bmp, 0, 0);
    measureLevels(photoCv, true);
    const fresh = matchHands(noteDetection(landmarker.detectForVideo(detectionInput(photoCv, photoCv.width, photoCv.height), tMs)), tMs / 1000);
    segmentFrom(hands, fresh);
    Object.assign(look, lookOver || {});
    draw();
    return this.coverage({});
  },
  get renderer() { return rmode; },
  get levels() { return levels; },
  detectInput() { return detCv.toDataURL('image/jpeg', 0.9); },
  coverage(lookOver) {            // painted-pixel mask at source resolution (Uint8 0..255), for accuracy tests
    renderer.debug = true;
    const d = renderer.captureImage({ ...look, ...lookOver }, { mirror: false, tilt: 0 });
    renderer.debug = false;
    const c = document.createElement('canvas'); c.width = d.width; c.height = d.height; c.getContext('2d').putImageData(d, 0, 0);
    return c.toDataURL('image/png');
  },
  shot(lookOver) {                // the composited picture at source resolution, for visual tests
    const d = renderer.captureImage({ ...look, ...lookOver }, { mirror: false, tilt: 0 });
    const c = document.createElement('canvas'); c.width = d.width; c.height = d.height; c.getContext('2d').putImageData(d, 0, 0);
    return c.toDataURL('image/jpeg', 0.9);
  },
  debugTiles() { const d = renderer.debugTiles(); const c = document.createElement('canvas'); c.width = d.width; c.height = d.height; c.getContext('2d').putImageData(d, 0, 0); return c.toDataURL('image/png'); },
  get nails() { return renderer ? renderer.nails.filter(n => n.geo).map(n => ({ tile: n.tile, f: n.f, ...n.geo })) : []; },
};
