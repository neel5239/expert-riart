// Fallback nail renderer (Canvas 2D) for devices without WebGL2 float render targets.
// Places nails from hand landmarks only (no segmentation); uses the same shape chart as the WebGL path.
import { hw, tipEnd, cuticle, EXT, hexRgb } from './nailshape.js';

const FINGERS = [[4, 3], [8, 7], [12, 11], [16, 15], [20, 19]];
const WIDTH = [0.22, 0.2, 0.21, 0.19, 0.155];     // nail width / knuckle span
const BED = [0.5, 0.42, 0.42, 0.42, 0.42];        // nail bed / last segment
const col = (h, t, k, a = 1) => { const A = hexRgb(h), B = hexRgb(t); return `rgba(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',')},${a})`; };

function path(shape, W, Lb, L) {
  const p = new Path2D(), n = 28, lb = Lb / W, l = L / W, hw0 = hw(shape, 0, lb, l);
  const pts = [];                                   // [along, across] in nail widths
  for (let i = 0; i <= n; i++) { const y = (l * i) / n, h = hw(shape, y, lb, l); pts.push([Math.min(y, tipEnd(shape, -h, l)), h]); }
  for (let i = n; i >= 0; i--) { const y = (l * i) / n, h = hw(shape, y, lb, l); pts.push([Math.min(y, tipEnd(shape, h, l)), -h]); }
  for (let i = 1; i < 12; i++) { const x = -hw0 + (2 * hw0 * i) / 12; pts.push([cuticle(x, hw0), x]); }
  pts.forEach(([s, w], i) => (i ? p.lineTo(s * W, w * W) : p.moveTo(s * W, w * W)));
  p.closePath();
  return p;
}

function drawNail(ctx, g, look, k) {
  const L = g.Lb + g.ext, W = g.W, hwpx = W / 2;
  if (W < 2) return;
  ctx.save();
  ctx.setTransform(k * g.ux, k * g.uy, k * -g.uy, k * g.ux, k * g.bx, k * g.by);
  const pth = path(look.shape, W, g.Lb, L), sh = look.shade;
  ctx.save(); ctx.shadowColor = 'rgba(40,10,15,.35)'; ctx.shadowBlur = Math.max(1, W * 0.12) * k; ctx.fillStyle = sh; ctx.fill(pth); ctx.restore();
  ctx.save(); ctx.clip(pth);
  const box = [-0.2 * W, -hwpx * 1.2, L + 0.4 * W, hwpx * 2.4];
  const d = look.design;
  if (d === 'french' || d === 'microfrench') {
    ctx.fillStyle = '#E9C3B9'; ctx.fillRect(...box);
    const S0 = d === 'french' ? g.Lb * 0.62 : L - 0.16 * W, depth = (d === 'french' ? 0.2 : 0.07) * W;
    ctx.beginPath(); ctx.moveTo(L + W, -hwpx * 1.2);
    for (let i = 0; i <= 16; i++) { const w = -hwpx + (2 * hwpx * i) / 16; ctx.lineTo(S0 + depth * (1 - (w / hwpx) ** 2), w); }
    ctx.lineTo(L + W, hwpx * 1.2); ctx.closePath(); ctx.fillStyle = sh; ctx.fill();
  } else if (d === 'ombre') {
    const gr = ctx.createLinearGradient(0, 0, L, 0); gr.addColorStop(0, '#E9C3B9'); gr.addColorStop(0.3, '#E9C3B9'); gr.addColorStop(1, sh); ctx.fillStyle = gr; ctx.fillRect(...box);
  } else if (d === 'chrome') {
    const gr = ctx.createLinearGradient(0, -hwpx, 0, hwpx);
    gr.addColorStop(0, col(sh, '#000', 0.5)); gr.addColorStop(0.3, col(sh, '#fff', 0.75)); gr.addColorStop(0.5, col(sh, '#000', 0.1)); gr.addColorStop(0.68, col(sh, '#fff', 0.85)); gr.addColorStop(1, col(sh, '#000', 0.4));
    ctx.fillStyle = gr; ctx.fillRect(...box);
  } else if (d === 'cateye') {
    ctx.fillStyle = col(sh, '#000', 0.5); ctx.fillRect(...box);
    const gr = ctx.createLinearGradient(0, -hwpx * 0.8, 0, hwpx * 0.8); gr.addColorStop(0, col(sh, '#fff', 0.2, 0)); gr.addColorStop(0.5, col(sh, '#fff', 0.55, 0.95)); gr.addColorStop(1, col(sh, '#fff', 0.2, 0));
    ctx.fillStyle = gr; ctx.fillRect(...box);
  } else {
    ctx.fillStyle = d === 'milky' ? col('#ffffff', sh, 0.14) : d === 'matte' ? col(sh, '#fff', 0.06) : sh;
    ctx.globalAlpha = d === 'jelly' ? 0.7 : 1; ctx.fillRect(...box); ctx.globalAlpha = 1;
  }
  const gr = ctx.createLinearGradient(0, -hwpx, 0, hwpx);
  gr.addColorStop(0, 'rgba(20,4,8,.3)'); gr.addColorStop(0.22, 'rgba(20,4,8,0)'); gr.addColorStop(0.78, 'rgba(20,4,8,0)'); gr.addColorStop(1, 'rgba(20,4,8,.3)');
  ctx.fillStyle = gr; ctx.fillRect(...box);
  if (d !== 'matte') {
    const hy = -hwpx * 0.34, len = L * 0.62;
    const hg = ctx.createLinearGradient(0, hy - W * 0.1, 0, hy + W * 0.1);
    hg.addColorStop(0, 'rgba(255,255,255,0)'); hg.addColorStop(0.5, 'rgba(255,255,255,.55)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(L * 0.14 + len / 2, hy, len / 2, W * 0.09, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.lineWidth = Math.max(0.5, W * 0.018); ctx.strokeStyle = 'rgba(30,6,10,.2)'; ctx.stroke(pth);
  ctx.restore();
}

// pts: 21 landmarks in canvas CSS px; visible: [bool x5]
export function drawHand2D(ctx, pts, visible, look, k = 1) {
  const span = Math.hypot(pts[5].x - pts[17].x, pts[5].y - pts[17].y);
  if (span < 12) return 0;
  let n = 0;
  FINGERS.forEach(([ti, di], f) => {
    if (!visible[f]) return;
    const tip = pts[ti], dip = pts[di];
    let ux = tip.x - dip.x, uy = tip.y - dip.y; const seg = Math.hypot(ux, uy); if (seg < 4) return;
    ux /= seg; uy /= seg;
    let W = span * WIDTH[f]; if (f === 0) W = Math.min(W, seg * 0.72);
    const Lb = seg * BED[f], ext = W * (EXT[look.length] ?? 0.8);
    const reach = seg * 0.09;
    drawNail(ctx, { bx: tip.x - ux * (Lb - reach), by: tip.y - uy * (Lb - reach), ux, uy, W, Lb, ext }, look, k);
    n++;
  });
  return n;
}
