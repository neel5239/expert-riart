// RI'S ART nail shapes and designs — one source of truth for the menu chips, the try-on chips and the AR shader.
// Units: nail width W = 1. y runs from the cuticle (0) to the free edge (L). Half-width hw(y) is measured from the centre line.
// Shapes follow the standard salon chart: square, squoval, round, oval, almond, stiletto, coffin (ballerina), lipstick, flare.

export const SHAPES = [
  { id: 'almond', name: 'Almond', note: 'Tapers to a soft, rounded peak' },
  { id: 'oval', name: 'Oval', note: 'Long, soft elliptical tip' },
  { id: 'round', name: 'Round', note: 'Follows the fingertip curve' },
  { id: 'squoval', name: 'Squoval', note: 'Square with softened corners' },
  { id: 'square', name: 'Square', note: 'Straight sides, flat tip' },
  { id: 'coffin', name: 'Coffin', note: 'Tapered with a flat tip (ballerina)' },
  { id: 'stiletto', name: 'Stiletto', note: 'Tapers to a sharp point' },
  { id: 'lipstick', name: 'Lipstick', note: 'Slanted, angled tip' },
  { id: 'flare', name: 'Flare', note: 'Widens toward the tip (duck)' },
];
export const SHAPE_ID = Object.fromEntries(SHAPES.map((s, i) => [s.id, i]));

// extension beyond the natural free edge, in nail widths
export const LENGTHS = [
  { id: 'natural', name: 'Natural', ext: 0 },
  { id: 'short', name: 'Short', ext: 0.35 },
  { id: 'medium', name: 'Medium', ext: 0.8 },
  { id: 'long', name: 'Long', ext: 1.3 },
];
export const EXT = Object.fromEntries(LENGTHS.map(l => [l.id, l.ext]));

export const DESIGNS = [
  { id: 'gloss', name: 'Gel gloss' },
  { id: 'jelly', name: 'Jelly' },
  { id: 'milky', name: 'Milky' },
  { id: 'chrome', name: 'Glazed chrome' },
  { id: 'aura', name: 'Aura' },
  { id: 'cateye', name: 'Velvet cat-eye' },
  { id: 'french', name: 'Classic French' },
  { id: 'microfrench', name: 'Micro French' },
  { id: 'ombre', name: 'Ombré' },
  { id: 'glitter', name: 'Glitter' },
  { id: 'foil', name: 'Gold foil accent' },
  { id: 'marble', name: 'Marble' },
  { id: 'tortoise', name: 'Tortoiseshell' },
  { id: 'matte', name: 'Matte' },
];
export const DESIGN_ID = Object.fromEntries(DESIGNS.map((d, i) => [d.id, i]));

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// half width of the nail at height y (0 = cuticle, L = free edge). Lb = natural bed length.
export function hw(shape, y, Lb, L) {
  const side = 0.5 - 0.045 * Math.max(0, 1 - y / (0.3 * Lb));   // side walls ease in at the cuticle
  const ext = L - Lb;
  const corner = r => (y > L - r ? side - r + Math.sqrt(Math.max(0, r * r - (y - (L - r)) ** 2)) : side);
  let cap, t;
  switch (shape) {
    case 'square': return corner(0.06);
    case 'squoval': return corner(Math.min(0.2, L * 0.3));
    case 'round': cap = Math.min(0.5, L * 0.5); if (y < L - cap) return side; t = (y - (L - cap)) / cap; return side * Math.sqrt(Math.max(0, 1 - t * t));
    case 'oval': cap = Math.min(L * 0.7, 0.72 + 0.3 * ext); if (y < L - cap) return side; t = (y - (L - cap)) / cap; return side * Math.sqrt(Math.max(0, 1 - t * t));
    case 'almond': cap = Math.min(L * 0.78, 0.85 + 0.55 * ext); if (y < L - cap) return side; t = (y - (L - cap)) / cap; return side * Math.pow(Math.max(0, 1 - t * t), 0.62);
    case 'stiletto': cap = Math.min(L * 0.86, 1.0 + 0.75 * ext); if (y < L - cap) return side; t = (y - (L - cap)) / cap; return side * Math.pow(Math.max(0, 1 - t), 1.05) * (1 + 0.25 * t * (1 - t));
    case 'coffin': {
      cap = Math.min(L * 0.72, 0.55 + 0.7 * ext); if (y < L - cap) return side; t = (y - (L - cap)) / cap;
      const w = side * (1 - 0.48 * t), r = 0.035;
      return y > L - r ? w - r + Math.sqrt(Math.max(0, r * r - (y - (L - r)) ** 2)) : w;
    }
    case 'flare': { const w = side + 0.17 * smooth(Lb * 0.75, L, y); const r = 0.05; return y > L - r ? w - r + Math.sqrt(Math.max(0, r * r - (y - (L - r)) ** 2)) : w; }
    case 'lipstick': return side;
    default: return side;
  }
}

// where the free edge ends for a point across the nail (x in -0.5..0.5); only lipstick is slanted
export function tipEnd(shape, x, L) {
  if (shape !== 'lipstick') return L;
  return L - 0.5 * (x + 0.5) * Math.min(0.9, 0.35 + 0.35 * L);
}

// cuticle: a soft convex arc back toward the finger
export const cuticle = (x, hw0) => -0.13 * Math.sqrt(Math.max(0, 1 - (x / hw0) ** 2));

// outline as a list of [x, y] points, clockwise, nail pointing toward +y
export function outline(shape, Lb, L, n = 36) {
  const pts = [], hw0 = hw(shape, 0, Lb, L);
  for (let i = 0; i <= n; i++) { const y = (L * i) / n; const h = hw(shape, y, Lb, L); pts.push([-h, Math.min(y, tipEnd(shape, -h, L))]); }
  if (shape === 'lipstick') pts.push([-hw(shape, L, Lb, L), tipEnd(shape, -0.5, L)], [hw(shape, L, Lb, L), tipEnd(shape, 0.5, L)]);
  for (let i = n; i >= 0; i--) { const y = (L * i) / n; const h = hw(shape, y, Lb, L); pts.push([h, Math.min(y, tipEnd(shape, h, L))]); }
  for (let i = 1; i < 14; i++) { const x = hw0 - (2 * hw0 * i) / 14; pts.push([x, cuticle(x, hw0)]); }
  return pts;
}

/* ---------------------------------------------------------------- colour helpers */
export const hexRgb = h => { let x = h.replace('#', ''); if (x.length === 3) x = x.replace(/./g, c => c + c); const n = parseInt(x, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const mixHex = (a, b, k) => { const A = hexRgb(a), B = hexRgb(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',')})`; };
export const luma = h => { const [r, g, b] = hexRgb(h); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

/* ---------------------------------------------------------------- SVG chip (press-on tip look) */
let uid = 0;
export function nailSVG({ shape = 'almond', length = 'medium', design = 'gloss', shade = '#A8122E', accent = false, width = 40, finger = true } = {}) {
  const Lb = 1.05, L = Lb + (EXT[length] ?? 0.8);
  const id = `n${++uid}`;
  const pad = 0.14, vw = 1 + pad * 2, top = L + pad, vh = L + 0.13 + pad * 2 + (finger ? 0.55 : 0);
  const P = outline(shape, Lb, L).map(([x, y]) => `${(x + 0.5 + pad).toFixed(3)},${(top - y).toFixed(3)}`).join(' ');
  const dark = mixHex(shade, '#000', 0.35), light = mixHex(shade, '#fff', 0.45);
  const nude = '#E9C3B9';
  let fill = shade, extra = '';
  const defs = [];
  const lin = (name, x1, y1, x2, y2, stops) => defs.push(`<linearGradient id="${id}${name}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`);
  const clip = `clip-path="url(#${id}c)"`;
  const yTip = top - L, yCut = top;
  switch (design) {
    case 'jelly': fill = `url(#${id}j)`; lin('j', 0, 0, 0, 1, [[0, light, 0.75], [1, shade, 0.85]]); break;
    case 'milky': fill = mixHex('#FFFFFF', shade, 0.12); break;
    case 'matte': fill = mixHex(shade, '#fff', 0.06); break;
    case 'chrome': fill = `url(#${id}m)`; lin('m', 0, 0, 1, 0.2, [[0, dark], [0.3, mixHex(shade, '#fff', 0.8)], [0.5, mixHex(shade, '#E8F0FF', 0.4)], [0.68, mixHex(shade, '#FFE6F4', 0.75)], [1, dark]]); break;
    case 'aura': defs.push(`<radialGradient id="${id}a" cx="0.5" cy="0.55" r="0.55"><stop offset="0" stop-color="${mixHex(shade, '#FFD6E6', 0.75)}"/><stop offset="0.55" stop-color="${mixHex(shade, '#fff', 0.2)}"/><stop offset="1" stop-color="${shade}"/></radialGradient>`); fill = `url(#${id}a)`; break;
    case 'cateye': fill = mixHex(shade, '#000', 0.5); lin('k', 0, 0, 1, 0, [[0.25, light, 0], [0.5, mixHex(shade, '#fff', 0.7), 0.95], [0.75, light, 0]]); extra = `<rect x="0" y="0" width="${vw}" height="${vh}" fill="url(#${id}k)" ${clip}/>`; break;
    case 'french': case 'microfrench': {
      fill = nude;
      // smile line: the tip colour dips toward the cuticle at the side walls, rises at the centre
      const micro = design === 'microfrench';
      const y0 = micro ? L - 0.16 : Math.min(Lb * 0.72, L - 0.3) + (L - Lb) * 0.15, depth = micro ? 0.07 : 0.2;
      const pts = [];
      for (let i = 0; i <= 16; i++) { const x = -0.6 + 1.2 * i / 16; pts.push(`${(x + 0.5 + pad).toFixed(3)},${(top - (y0 + depth * (1 - Math.min(1, (2 * x) ** 2)))).toFixed(3)}`); }
      pts.push(`${(1.1 + pad).toFixed(3)},${(top - L - 0.3).toFixed(3)}`, `${(pad - 0.1).toFixed(3)},${(top - L - 0.3).toFixed(3)}`);
      extra = `<polygon points="${pts.join(' ')}" fill="${shade}" ${clip}/>`;
      break;
    }
    case 'ombre': fill = `url(#${id}o)`; lin('o', 0, 1, 0, 0, [[0, nude], [0.35, nude], [1, shade]]); break;
    case 'glitter': {
      let s = 7, dots = '';
      const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 40; i++) dots += `<circle cx="${(pad + r()).toFixed(3)}" cy="${(yTip + r() * L).toFixed(3)}" r="${(0.015 + r() * 0.03).toFixed(3)}" fill="${r() < 0.55 ? '#FFF6E6' : '#E6C27A'}" opacity="${(0.55 + r() * 0.45).toFixed(2)}"/>`;
      extra = `<g ${clip}>${dots}</g>`; break;
    }
    case 'foil': if (accent) extra = `<g ${clip}><path d="M${pad + 0.1},${yTip + L * 0.55} l0.22,-0.1 l0.1,0.12 l0.22,-0.14 l0.12,0.1 l0.14,-0.06 l-0.05,0.18 l-0.3,0.1 l-0.12,-0.08 l-0.2,0.1 Z" fill="#E6C27A"/><path d="M${pad + 0.25},${yTip + L * 0.35} l0.18,-0.05 l0.06,0.1 l-0.2,0.06 Z" fill="#F4D58A"/></g>`; break;
    case 'marble': fill = mixHex('#FFFFFF', shade, 0.08); extra = `<g ${clip} fill="none" stroke="${mixHex(shade, '#555', 0.3)}" stroke-width="0.025" opacity="0.8"><path d="M${pad},${yTip + L * 0.2} C${pad + 0.3},${yTip + L * 0.35} ${pad + 0.5},${yTip + L * 0.3} ${pad + 1},${yTip + L * 0.62}"/><path d="M${pad + 0.2},${yTip + L * 0.7} C${pad + 0.4},${yTip + L * 0.55} ${pad + 0.7},${yTip + L * 0.8} ${pad + 0.9},${yTip + L * 0.9}" stroke-width="0.015"/></g>`; break;
    case 'tortoise': fill = '#7A3E12'; extra = `<g ${clip}><circle cx="${pad + 0.3}" cy="${yTip + L * 0.3}" r="0.16" fill="#2B1206" opacity="0.8"/><circle cx="${pad + 0.7}" cy="${yTip + L * 0.55}" r="0.2" fill="#3A1A08" opacity="0.75"/><circle cx="${pad + 0.35}" cy="${yTip + L * 0.8}" r="0.13" fill="#C07A2A" opacity="0.8"/><circle cx="${pad + 0.75}" cy="${yTip + L * 0.2}" r="0.1" fill="#D89A3C" opacity="0.8"/></g>`; break;
  }
  const matte = design === 'matte';
  // soft curvature: darker side walls; gloss: one long highlight and a glint
  lin('s', 0, 0, 1, 0, [[0, '#2A0A10', matte ? 0.22 : 0.34], [0.2, '#2A0A10', 0], [0.8, '#2A0A10', 0], [1, '#2A0A10', matte ? 0.22 : 0.34]]);
  lin('h', 0, 0, 1, 0, [[0, '#fff', 0], [0.5, '#fff', design === 'chrome' ? 0.85 : 0.6], [1, '#fff', 0]]);
  const hx = pad + 0.22, hl = L * 0.6;
  const shine = matte ? '' : `<rect x="${hx}" y="${yTip + L * 0.14}" width="0.13" height="${hl}" rx="0.065" fill="url(#${id}h)" ${clip}/><ellipse cx="${pad + 0.72}" cy="${yTip + L * 0.2}" rx="0.06" ry="0.035" fill="#fff" opacity="0.5" ${clip}/>`;
  // fingertip: slightly wider than the nail, rounded pad ending just below the natural free edge
  const fx0 = pad - 0.1, fx1 = pad + 1.1, fTop = top - Lb * 0.92, fr = 0.6;
  const fingerSkin = finger ? `<path d="M${fx0},${vh} L${fx0},${fTop + fr} Q${fx0},${fTop} ${pad + 0.5},${fTop} Q${fx1},${fTop} ${fx1},${fTop + fr} L${fx1},${vh} Z" fill="#E6B9A2"/><path d="M${fx0},${vh} L${fx0},${fTop + fr} Q${fx0},${fTop} ${pad + 0.5},${fTop} Q${fx1},${fTop} ${fx1},${fTop + fr} L${fx1},${vh} Z" fill="url(#${id}f)"/><path d="M${pad + 0.08},${yCut + 0.02} Q${pad + 0.5},${yCut + 0.2} ${pad + 0.92},${yCut + 0.02}" fill="none" stroke="#B07C66" stroke-opacity="0.45" stroke-width="0.03"/>` : '';
  if (finger) lin('f', 0, 0, 1, 0, [[0, '#9E6A55', 0.6], [0.22, '#9E6A55', 0], [0.78, '#9E6A55', 0], [1, '#9E6A55', 0.6]]);
  const height = (width * vh) / vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw.toFixed(3)} ${vh.toFixed(3)}" width="${width}" height="${height.toFixed(1)}" aria-hidden="true">
<defs>${defs.join('')}<clipPath id="${id}c"><polygon points="${P}"/></clipPath><filter id="${id}d" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="0.03" stdDeviation="0.035" flood-color="#3A0A14" flood-opacity="0.35"/></filter></defs>
${fingerSkin}<polygon points="${P}" fill="${fill}" filter="url(#${id}d)" ${design === 'jelly' ? 'opacity="0.92"' : ''}/>${extra}<polygon points="${P}" fill="url(#${id}s)"/>${shine}<polygon points="${P}" fill="none" stroke="#2A0A10" stroke-opacity="0.18" stroke-width="0.012"/></svg>`;
}
