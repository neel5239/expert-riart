// RI'S ART — WebGL2 nail renderer.
// Camera frame + per-fingertip nail segmentation (NailNetGL) + recolour of the real nail pixels, all on the GPU.
// Pipeline per frame: crop fingertips -> nail mask -> temporal smoothing -> geometry readback -> composite.

import { NailNetGL } from './nailnet-gl.js';
import { SHAPE_ID, DESIGN_ID, EXT, hexRgb } from './nailshape.js';

const MAXN = 10;
let R = 128;                      // fingertip tile size, set from the model spec
const FINGERS = [[4, 3], [8, 7], [12, 11], [16, 15], [20, 19]];

const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

// fingertip crop: tile texel (x, y) -> source pixel M * (x, y, 1)  (same maths as nailcrop.py / cv2.warpAffine)
const FS_CROP = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uSrcSize, uOrg; uniform mat3 uM;
uniform vec3 uLo, uHi;          // auto levels: a washed-out or tinted camera is stretched before the network sees it
out vec4 o;
void main(){
  vec2 l = floor(gl_FragCoord.xy - uOrg);
  vec2 p = (uM * vec3(l, 1.0)).xy;
  vec3 c = clamp((texture(uSrc, (p + 0.5) / uSrcSize).rgb - uLo) / max(uHi - uLo, vec3(0.05)), 0.0, 1.0);
  o = vec4((c - 0.5) / 0.25, 0.0);
}`;

// temporal smoothing in the fingertip's own frame; r = nail probability, g = crop luminance
const FS_EMA = `#version 300 es
precision highp float; precision highp sampler2DArray;
uniform sampler2DArray uMask, uIn; uniform sampler2D uPrev; uniform float uA;
out vec4 o;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  float m = texelFetch(uMask, ivec3(p, 0), 0).r;
  vec3 c = texelFetch(uIn, ivec3(p, 0), 0).rgb * 0.25 + 0.5;
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec4 prev = texelFetch(uPrev, p, 0);
  o = mix(prev, vec4(m, y, 0.0, 1.0), uA);
}`;

const FS_PACK = `#version 300 es
precision highp float; precision highp sampler2DArray;
uniform sampler2D uS; uniform sampler2DArray uIn; out vec4 o;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 v = texelFetch(uS, p, 0);
  vec3 c = clamp(texelFetch(uIn, ivec3(p, 0), 0).rgb * 0.25 + 0.5, 0.0, 1.0);
  o = vec4(clamp(v.r, 0.0, 1.0), c);
}`;

const FS_COMP = () => `#version 300 es
precision highp float;
#define MAXN ${MAXN}
uniform sampler2D uSrc, uMask;
uniform vec2 uSrcSize, uView, uAtlas;
uniform mat3 uV2S;              // view px -> source px (cover/contain + mirror)
uniform bool uFlipY;
uniform int uN;
uniform mat3 uS2C[MAXN];        // source px -> crop coords of each nail
uniform vec2 uOrg[MAXN];        // tile origin in the mask atlas
uniform vec4 uGeo[MAXN];        // yTop (free edge), yBot (cuticle), width, centre x   (crop px)
uniform vec4 uGeo2[MAXN];       // extension (nail widths), finger, nail luminance, px per crop px
uniform vec3 uGeo3[MAXN];       // centre-line slope (dx/dy in crop px), y of the fitted centre, presence 0..1
uniform vec3 uLo, uHi;          // levels applied to the network input (washed-out cameras), for colour comparisons
uniform vec3 uNailCol[MAXN], uSkinCol[MAXN];   // measured nail colour and surrounding skin colour
uniform vec3 uShade; uniform int uShape, uDesign; uniform float uTilt, uTime;
uniform int uDebug;              // 1 = output painted coverage only (for accuracy tests)
uniform int uChip;               // 1 = press-on chip: a clean chart-shaped nail placed on the real nail (default)
out vec4 o;

float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }

// ---- shape chart (mirrors nailshape.js hw / tipEnd)
float corner(float y, float L, float side, float r){ return y > L - r ? side - r + sqrt(max(0.0, r * r - (y - (L - r)) * (y - (L - r)))) : side; }
float hw(int s, float y, float Lb, float L){
  float side = 0.5 - 0.045 * max(0.0, 1.0 - y / (0.3 * Lb));
  float ext = L - Lb, cap, t;
  // on a real hand the whole natural nail is painted, so tapers start near its free edge, not inside the bed
  float capMax = L - Lb * 0.85;
  if (s == 4) return corner(y, L, side, 0.06);                                   // square
  if (s == 3) return corner(y, L, side, min(0.2, L * 0.3));                      // squoval
  if (s == 2) { cap = min(min(0.5, L * 0.5), max(capMax, 0.15)); if (y < L - cap) return side; t = (y - (L - cap)) / cap; return side * sqrt(max(0.0, 1.0 - t * t)); }  // round
  if (s == 1) { cap = min(min(L * 0.7, 0.72 + 0.3 * ext), max(capMax, 0.2)); if (y < L - cap) return side; t = (y - (L - cap)) / cap; return side * sqrt(max(0.0, 1.0 - t * t)); }  // oval
  if (s == 0) { cap = min(min(L * 0.78, 0.85 + 0.55 * ext), max(capMax, 0.2)); if (y < L - cap) return side; t = (y - (L - cap)) / cap; return side * pow(max(0.0, 1.0 - t * t), 0.62); }  // almond
  if (s == 6) { cap = min(min(L * 0.86, 1.0 + 0.75 * ext), max(capMax, 0.2)); if (y < L - cap) return side; t = (y - (L - cap)) / cap; return side * pow(max(0.0, 1.0 - t), 1.05) * (1.0 + 0.25 * t * (1.0 - t)); }  // stiletto
  if (s == 5) { cap = min(min(L * 0.72, 0.55 + 0.7 * ext), max(capMax, 0.15)); if (y < L - cap) return side; t = (y - (L - cap)) / cap; return corner(y, L, side * (1.0 - 0.48 * t), 0.035); }  // coffin
  if (s == 8) { return corner(y, L, side + 0.17 * smoothstep(Lb * 0.75, L, y), 0.05); }  // flare
  return side;                                                                     // lipstick (tip cut below)
}
float tipEnd(int s, float x, float L){ return s == 7 ? L - 0.5 * (x + 0.5) * min(0.9, 0.35 + 0.35 * L) : L; }
float cuticle(float x, float hw0){ return -0.13 * sqrt(max(0.0, 1.0 - (x / hw0) * (x / hw0))); }   // soft arc (nailshape.js)

vec3 pal(float t){ return 0.72 + 0.28 * cos(6.2832 * (t + vec3(0.0, 0.33, 0.67))); }

// design colour at nail coords (X across, -0.5..0.5; Y from cuticle; s = Y / L). a = opacity, k = gloss strength
vec3 design(int d, vec3 sh, float X, float Y, float s, float L, float Lb, float finger, out float a, out float k){
  vec3 nude = vec3(0.914, 0.765, 0.725);
  a = 1.0; k = 1.0;
  if (d == 1) { a = 0.76; k = 1.25; return mix(sh, vec3(1.0), 0.1); }                          // jelly
  if (d == 2) { a = 0.88; return mix(vec3(0.99, 0.98, 0.97), sh, 0.14); }                       // milky
  if (d == 3) { k = 1.6; vec3 pearl = mix(vec3(1.0), pal(X * 0.35 + uTilt * 0.3 + s * 0.12), 0.18);
                return mix(sh, pearl, 0.22 + 0.16 * smoothstep(0.35, -0.25, X)); }                  // glazed chrome (soft pearl sheen)
  if (d == 4) { float r = length(vec2(X * 1.7, (s - 0.48) * 1.25)); return mix(mix(sh, vec3(1.0, 0.84, 0.9), 0.72), sh, smoothstep(0.08, 0.72, r)); }  // aura
  if (d == 5) { float c = 0.28 * sin(uTilt * 2.3 + finger * 0.6); float band = exp(-pow((X - c) / 0.17, 2.0));
                vec3 base = sh * 0.42; float sp = step(0.82, hash(floor(vec2(X, Y) * 90.0))) * band;
                return base + mix(sh, vec3(1.0), 0.45) * band * 0.95 + sp * 0.5; }                // velvet cat-eye
  if (d == 6 || d == 7) {
    bool micro = d == 7;
    float y0 = micro ? L - 0.16 : min(Lb * 0.72, L - 0.3) + (L - Lb) * 0.15, depth = micro ? 0.07 : 0.2;
    float line = y0 + depth * (1.0 - min(1.0, 4.0 * X * X));
    float t = smoothstep(line - 0.015, line + 0.015, Y);
    a = mix(0.93, 1.0, t); return mix(nude, sh, t);                                             // French / micro French
  }
  if (d == 8) return mix(nude, sh, smoothstep(0.22, 0.95, s));                                   // ombré
  if (d == 9) { vec2 g = vec2(X, Y) * 26.0; float h = hash(floor(g)); float sp = step(0.72, h) * smoothstep(0.5, 0.0, length(fract(g) - 0.5));
                return mix(sh, mix(vec3(1.0, 0.97, 0.9), vec3(0.9, 0.76, 0.45), step(0.86, h)), sp); }  // glitter
  if (d == 10) { if (finger > 2.5 && finger < 3.5) { float n = fbm(vec2(X, Y) * 5.0 + 3.0); float band = smoothstep(0.35, 0.0, abs(Y - (0.35 + X * 0.9) * L * 0.8));
                 float f = step(0.52, n) * band; return mix(sh, mix(vec3(0.78, 0.6, 0.28), vec3(0.97, 0.85, 0.55), n), f); } return sh; }  // gold foil accent (ring)
  if (d == 11) { float n = fbm(vec2(X * 2.5, Y * 1.4) + 7.0); float v = abs(sin((X * 3.0 + Y * 1.6 + n * 4.0))); float vein = smoothstep(0.06, 0.0, v);
                 a = 0.95; return mix(mix(vec3(0.97, 0.96, 0.95), sh, 0.1), mix(sh, vec3(0.35), 0.4), vein * 0.8); }  // marble
  if (d == 12) { float n = fbm(vec2(X * 3.0, Y * 2.0) + 11.0);
                 vec3 c = mix(vec3(0.75, 0.47, 0.16), vec3(0.45, 0.22, 0.07), smoothstep(0.4, 0.55, n));
                 a = 0.94; return mix(c, vec3(0.16, 0.07, 0.03), smoothstep(0.58, 0.72, n)); }     // tortoiseshell
  if (d == 13) { k = 0.0; return mix(sh, vec3(1.0), 0.05); }                                     // matte
  return sh;                                                                                      // gel gloss
}

void main(){
  vec2 v = vec2(gl_FragCoord.x, uFlipY ? uView.y - gl_FragCoord.y : gl_FragCoord.y);
  vec2 sp = (uV2S * vec3(v, 1.0)).xy;
  vec2 suv = sp / uSrcSize;
  vec3 col = (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) ? vec3(0.05, 0.027, 0.035) : texture(uSrc, suv).rgb;
  vec3 base = col;
  float Lp = luma(base);
  float cover = 0.0;
  for (int i = 0; i < MAXN; i++) {
    if (i >= uN) break;
    vec2 q = (uS2C[i] * vec3(sp - 0.5, 1.0)).xy;              // crop coords (texel centres at integers)
    vec4 g = uGeo[i], g2 = uGeo2[i];
    float W = max(g.z, 1.0);
    vec3 g3 = uGeo3[i];
    if (g3.z < 0.01) continue;
    float Y = (g.y - q.y) / W, X = (q.x - (g.w + g3.x * (q.y - g3.y))) / W;   // nail frame along its fitted centre line, width = 1
    float Lb = max((g.y - g.x) / W, 0.4), L = Lb + g2.x;
    if (X < -1.0 || X > 1.0 || Y < -0.6 || Y > L + 0.25) continue;
    if (uChip == 1) {
      // press-on chip: the outline is the chart shape only, so it is always clean; the model just placed it
      float Xc = X / 0.95;                                        // a hair inside the real nail so it never overhangs skin
      float hw0 = hw(uShape, 0.0, Lb, L);
      float dc0 = min(min(hw(uShape, Y, Lb, L) - abs(Xc), tipEnd(uShape, Xc, L) - Y), Y - cuticle(Xc, hw0));
      float pxc = W * g2.w;
      float ac = clamp(dc0 * pxc * 0.95 + 0.5, 0.0, 1.0) * g3.z;
      // soft contact shadow hugging the chip edge
      float shc = smoothstep(-0.07, 0.0, dc0) * step(dc0, 0.0) * g3.z;
      col *= 1.0 - 0.3 * shc;
      if (ac < 0.002) continue;
      float opc, gkc;
      vec3 dcol = design(uDesign, uShade, Xc, Y, clamp(Y / L, 0.0, 1.0), L, Lb, g2.y, opc, gkc);
      float Lmc = max(g2.z, 0.06);
      float expoc = clamp(pow(Lmc / 0.55, 0.6), 0.55, 1.15);
      float cam = pow(clamp(Lp / Lmc, 0.6, 1.4), 0.35);          // keeps the finger's own shadows, not its texture
      float curve = 0.86 + 0.14 * cos(Xc * 2.8);                  // rounded nail surface
      vec3 cc = dcol * expoc * curve * (uDesign == 13 ? 1.0 : cam);
      float st = exp(-pow((Xc + 0.2) / 0.08, 2.0)) * smoothstep(0.05, 0.25, Y / L) * smoothstep(0.95, 0.7, Y / L);
      cc += (1.0 - cc) * st * gkc * 0.45;                         // gel highlight
      cc *= 1.0 - 0.28 * (1.0 - smoothstep(0.0, 0.07, dc0));      // thin darker rim
      col = mix(col, cc, ac * mix(1.0, opc, 0.6));
      cover = max(cover, ac);
      continue;
    }
    // real nail probability (inside the tile only)
    float m = 0.0;
    if (q.x > -0.5 && q.y > -0.5 && q.x < ${R}.0 - 0.5 && q.y < ${R}.0 - 0.5)
      m = texture(uMask, (uOrg[i] + clamp(q, 0.0, ${R}.0 - 1.0) + 0.5) / uAtlas).r;
    // snap the uncertain border to the real nail edge: is this pixel nail-coloured or skin-coloured?
    vec3 nc = uNailCol[i], sc = uSkinCol[i];
    float sep = length(nc - sc);
    if (sep > 0.06 && m > 0.03 && m < 0.97) {
      vec3 bn = clamp((base - uLo) / max(uHi - uLo, vec3(0.05)), 0.0, 1.0);   // same levels as the measured colours
      float dn = length(bn - nc), ds = length(bn - sc);
      float pc = smoothstep(-0.35, 0.35, (ds - dn) / max(sep, 1e-3));   // 1 = looks like nail
      m = mix(m, pc * smoothstep(0.02, 0.25, m), 4.0 * m * (1.0 - m));
    }
    m = smoothstep(0.3, 0.62, m);
    // stray mask below the cuticle or beside the nail (skin folds, shadows) is never painted
    m *= smoothstep(-0.1, 0.02, Y) * (1.0 - smoothstep(0.56, 0.7, abs(X)));
    // chart shape (anti-aliased in screen pixels)
    float px = W * g2.w;
    float d = min(hw(uShape, Y, Lb, L) - abs(X), tipEnd(uShape, X, L) - Y);
    float aShape = clamp(d * px + 0.5, 0.0, 1.0);
    // the extension overlays the top of the natural nail; at natural length only the real nail pixels are painted
    float up = smoothstep(Lb * 0.45, Lb * 0.6, Y) * smoothstep(0.02, 0.12, g2.x);
    float a = max(m, aShape * up) * g3.z;
    // soft contact shadow just outside the extension (it sits above the skin / background)
    float sh = smoothstep(-0.07, 0.0, d) * step(d, 0.0) * smoothstep(Lb * 0.85, Lb * 1.05, Y) * (1.0 - m);
    col *= 1.0 - 0.28 * sh * step(0.0001, g2.x);
    if (a < 0.002) continue;
    float real = m;                                           // 1 where camera pixels are the real nail
    float op, gk;
    vec3 dc = design(uDesign, uShade, X, Y, clamp(Y / L, 0.0, 1.0), L, Lb, g2.y, op, gk);
    // lighting: real part keeps the camera's own shading; extension gets curvature + matched brightness
    float Lm = max(g2.z, 0.06);
    float rel = Lp / Lm;
    float realShade = pow(clamp(rel, 0.35, 1.6), uDesign == 13 ? 0.4 : 0.8);
    // both parts share the scene exposure so the real nail and the extension read as one surface (no seam)
    float expo = clamp(pow(Lm / 0.55, 0.6), 0.55, 1.15);
    float synth = 0.9 + 0.1 * cos(X * 2.6);
    real *= 1.0 - 0.75 * up * smoothstep(0.02, 0.12, g2.x) * smoothstep(Lb * 0.6, Lb * 0.95, Y);   // blend into the extension
    vec3 c = dc * expo * mix(synth, realShade, real);
    float spec = smoothstep(1.25, 1.9, rel) * real;           // the camera's own reflections
    c = mix(c, vec3(1.0), spec * 0.45 * min(gk, 1.2));
    float streak = exp(-pow((X + 0.2) / 0.085, 2.0)) * smoothstep(0.12, 0.3, Y / L) * smoothstep(0.92, 0.7, Y / L);
    c += (1.0 - c) * streak * gk * mix(0.42, 0.18, real);     // gel highlight
    float rim = 1.0 - smoothstep(0.05, 0.9, a);
    c *= 1.0 - 0.22 * rim;
    col = mix(col, c, a * op);
    cover = max(cover, a);
  }
  o = uDebug == 1 ? vec4(cover, cover, cover, 1.0) : vec4(col, 1.0);
}`;

function program(gl, fs) {
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x);
    if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = new Proxy({}, { get: (c, k) => (k in c ? c[k] : (c[k] = gl.getUniformLocation(p, k))) });
  return { p, u };
}

// 2x3 affine helpers: [a, b, c, d, e, f] maps (x, y) -> (a x + b y + c, d x + e y + f)
const mul = (A, B) => [A[0] * B[0] + A[1] * B[3], A[0] * B[1] + A[1] * B[4], A[0] * B[2] + A[1] * B[5] + A[2],
                       A[3] * B[0] + A[4] * B[3], A[3] * B[1] + A[4] * B[4], A[3] * B[2] + A[4] * B[5] + A[5]];
const inv = A => { const det = A[0] * A[4] - A[1] * A[3];
  const a = A[4] / det, b = -A[1] / det, d = -A[3] / det, e = A[0] / det;
  return [a, b, -(a * A[2] + b * A[5]), d, e, -(d * A[2] + e * A[5])]; };
const mat3 = A => new Float32Array([A[0], A[3], 0, A[1], A[4], 0, A[2], A[5], 1]);   // column-major

// canonical fingertip crop (crop px -> source px). Must match nailcrop.crop_matrix.
export function cropMatrix(tip, dip, span) {
  const vx = tip.x - dip.x, vy = tip.y - dip.y, seg = Math.hypot(vx, vy) || 1;
  const ux = vx / seg, uy = vy / seg, rx = -uy, ry = ux;
  const S = Math.max(1.5 * seg, 0.46 * span), k = S / R;
  const cx = tip.x - ux * 0.05 * seg, cy = tip.y - uy * 0.05 * seg;
  const a = rx * k, b = -ux * k, d = ry * k, e = -uy * k;
  return [a, b, cx - (R / 2) * (a + b), d, e, cy - (R / 2) * (d + e)];
}

// typical nail size relative to the finger's last segment (tip to DIP), measured on the benchmark video
const NAIL_W = 0.52, NAIL_L = 0.64;

export class GLRenderer {
  constructor(canvas, spec, weights) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl; this.canvas = canvas;
    R = spec.input;
    this.pComp = null;
    this.net = new NailNetGL(gl, spec, weights, MAXN);
    this.pCrop = program(gl, FS_CROP); this.pEma = program(gl, FS_EMA); this.pPack = program(gl, FS_PACK); this.pComp = program(gl, FS_COMP());
    this.aw = this.net.cols * R; this.ah = this.net.rows * R;
    const tex2d = (fmt, type, filter) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, this.aw, this.ah);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, filter);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
      return t; };
    this.ema = [tex2d(gl.RGBA16F, gl.HALF_FLOAT, gl.LINEAR), tex2d(gl.RGBA16F, gl.HALF_FLOAT, gl.LINEAR)];
    this.pack = tex2d(gl.RGBA8, gl.UNSIGNED_BYTE, gl.NEAREST);
    this.cur = 0;
    this.fb = gl.createFramebuffer();
    this.src = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    this.quad = this.net.quad;
    this.geo = new Array(MAXN).fill(null);
    this.readBuf = new Uint8Array(this.aw * this.ah * 4);
    this.nails = [];
    this.levels = { lo: [0, 0, 0], hi: [1, 1, 1] };
    this.chip = true;
  }

  _fbTex(tex) { const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); }

  upload(el) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
  }

  // hands: [{ slot, px: [{x,y}] in source px, visible: [bool x5] }]
  // fresh: tiles whose history should be dropped (new hand)
  segment(hands, sw, sh, fresh = new Set()) {
    const gl = this.gl, net = this.net;
    this.sw = sw; this.sh = sh;
    const nails = [];
    for (const h of hands) {
      const span = Math.hypot(h.px[5].x - h.px[17].x, h.px[5].y - h.px[17].y);
      FINGERS.forEach(([ti, di], f) => {
        if (!h.visible[f]) return;
        const tile = h.slot * 5 + f;
        if (tile >= MAXN) return;
        const seg = Math.hypot(h.px[ti].x - h.px[di].x, h.px[ti].y - h.px[di].y) || 1;
        const last = this.lastTip?.[tile];
        const motion = last ? Math.hypot(h.px[ti].x - last.x, h.px[ti].y - last.y) / seg : 1;
        (this.lastTip ||= {})[tile] = { x: h.px[ti].x, y: h.px[ti].y };
        const segCrop = seg * R / Math.max(1.5 * seg, 0.46 * span);   // finger's last segment, in crop px
        nails.push({ tile, f, M: cropMatrix(h.px[ti], h.px[di], span), fresh: fresh.has(tile), motion, segCrop });
      });
    }
    // a tile that was not tracked last frame starts its smoothing from scratch
    const was = this.prevTiles || new Set();
    for (const n of nails) if (!was.has(n.tile)) n.fresh = true;
    this.prevTiles = new Set(nails.map(n => n.tile));
    this.nails = nails;
    if (!nails.length) return nails;
    // 1. crops
    net.bindInput();
    gl.useProgram(this.pCrop.p); gl.bindVertexArray(this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.src); gl.uniform1i(this.pCrop.u.uSrc, 0);
    gl.uniform2f(this.pCrop.u.uSrcSize, sw, sh);
    gl.uniform3fv(this.pCrop.u.uLo, this.levels.lo); gl.uniform3fv(this.pCrop.u.uHi, this.levels.hi);
    gl.enable(gl.SCISSOR_TEST);
    for (const n of nails) {
      const ox = (n.tile % net.cols) * R, oy = Math.floor(n.tile / net.cols) * R;
      gl.viewport(0, 0, this.aw, this.ah); gl.scissor(ox, oy, R, R);
      gl.uniform2f(this.pCrop.u.uOrg, ox, oy);
      gl.uniformMatrix3fv(this.pCrop.u.uM, false, mat3(n.M));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.SCISSOR_TEST);
    // 2. network
    net.run(MAXN);
    // 3. temporal smoothing into the other ema buffer
    const prev = this.ema[this.cur], next = this.ema[1 - this.cur];
    this._fbTex(next);
    gl.viewport(0, 0, this.aw, this.ah);
    gl.useProgram(this.pEma.p); gl.bindVertexArray(this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, net.t.mask.tex); gl.uniform1i(this.pEma.u.uMask, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, net.t.x.tex); gl.uniform1i(this.pEma.u.uIn, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, prev); gl.uniform1i(this.pEma.u.uPrev, 2);
    gl.enable(gl.SCISSOR_TEST);
    for (const n of nails) {
      const ox = (n.tile % net.cols) * R, oy = Math.floor(n.tile / net.cols) * R;
      gl.scissor(ox, oy, R, R);
      // steady hand: smooth; moving hand: follow the new mask at once so nothing trails
      gl.uniform1f(this.pEma.u.uA, n.fresh ? 1.0 : Math.min(1, 0.45 + 4 * n.motion));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.SCISSOR_TEST);
    this.cur = 1 - this.cur;
    // 4. geometry: read the smoothed masks back (small: 480 x 192)
    this._fbTex(this.pack);
    gl.useProgram(this.pPack.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.ema[this.cur]); gl.uniform1i(this.pPack.u.uS, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, net.t.x.tex); gl.uniform1i(this.pPack.u.uIn, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, this.aw, this.ah, gl.RGBA, gl.UNSIGNED_BYTE, this.readBuf);
    for (const n of nails) n.geo = this._measure(n);
    gl.bindVertexArray(null);
    return nails;
  }

  _measure(n) {
    const ox = (n.tile % this.net.cols) * R, oy = Math.floor(n.tile / this.net.cols) * R, b = this.readBuf, W = this.aw;
    const widths = new Float32Array(R), centres = new Float32Array(R);
    let area = 0, lsum = 0, maxW = 0, spans = 0, psum = 0;
    for (let y = 0; y < R; y++) {
      let x0 = -1, x1 = -1, c = 0;
      for (let x = 0; x < R; x++) {
        const i = ((oy + y) * W + ox + x) * 4;
        if (b[i] > 127) { if (x0 < 0) x0 = x; x1 = x; c++; psum += b[i]; lsum += 0.2126 * b[i + 1] + 0.7152 * b[i + 2] + 0.0722 * b[i + 3]; }
      }
      widths[y] = c; centres[y] = c ? (x0 + x1) / 2 : 0; area += c; if (c > maxW) maxW = c; if (c) spans += x1 - x0 + 1;
    }
    const prev = this.geo[n.tile];
    if (area < 40 || maxW < 5) { this.geo[n.tile] = null; return null; }
    let top = -1, bot = -1;
    for (let y = 0; y < R; y++) if (widths[y] >= maxW * 0.3) { if (top < 0) top = y; bot = y; }
    const ws = [...widths.slice(top, bot + 1)].sort((a, b) => a - b);
    const w85 = ws[Math.floor(ws.length * 0.85)] || maxW;
    // centre line: least-squares x = xc + slope * (y - ym) over the middle of the nail
    let sy = 0, sx = 0, syy = 0, sxy = 0, cn = 0;
    for (let y = Math.round(top + (bot - top) * 0.15); y <= Math.round(top + (bot - top) * 0.85); y++) if (widths[y]) { sy += y; sx += centres[y]; syy += y * y; sxy += y * centres[y]; cn++; }
    const ym = cn ? sy / cn : (top + bot) / 2, xc = cn ? sx / cn : R / 2;
    const slope = cn > 3 ? Math.max(-0.6, Math.min(0.6, (sxy / cn - ym * xc) / Math.max(1e-3, syy / cn - ym * ym))) : 0;
    // width near the free edge, where the extension is attached
    let we = 0, wn = 0;
    for (let y = Math.round(top + (bot - top) * 0.15); y <= Math.round(top + (bot - top) * 0.4); y++) if (widths[y]) { we += widths[y]; wn++; }
    const w = wn ? Math.max(0.5 * (w85 + we / wn), 0.8 * w85) : w85;
    // seen side-on (thin strip) or cut by the tile edge: repaint only, don't grow an extension from bad geometry
    const len = bot - top + 1;
    let edge = 0;
    for (let y = 0; y < R; y++) if (widths[y] && (centres[y] - widths[y] / 2 < 2 || centres[y] + widths[y] / 2 > R - 3)) edge++;
    // how much this looks like one real nail: a confident, solid blob of plausible width.
    // Finger pads, skin edges in backlight and folded fingertips give faint, torn or thin masks.
    let gaps = 0;
    for (let y = top; y <= bot; y++) if (!widths[y]) gaps++;
    const conf = psum / area / 255, fill = area / spans;
    const quality = Math.min(1, Math.max(0, (conf - 0.72) / 0.12)) * Math.min(1, Math.max(0, (fill - 0.72) / 0.14))
                  * Math.min(1, Math.max(0, (w / R - 0.07) / 0.06)) * (gaps > len * 0.1 ? 0 : 1);
    const reliable = w / len > 0.42 && w / len < 1.6 && edge < len * 0.25 && top > 2 && quality > 0.6;
    // colours: nail = confident inside; skin = a thin ring just outside the mask (for edge snapping)
    const nail = [0, 0, 0], skin = [0, 0, 0]; let nn = 0, ns = 0;
    const at = (x, y) => ((oy + y) * W + ox + x) * 4;
    for (let y = 2; y < R - 2; y++) for (let x = 2; x < R - 2; x++) {
      const v = b[at(x, y)];
      if (v > 220) { const i = at(x, y); nail[0] += b[i + 1]; nail[1] += b[i + 2]; nail[2] += b[i + 3]; nn++; }
      else if (v < 30) {
        let near = false;
        for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) if (b[at(x + dx, y + dy)] > 200) { near = true; break; }
        if (near) { const i = at(x, y); skin[0] += b[i + 1]; skin[1] += b[i + 2]; skin[2] += b[i + 3]; ns++; }
      }
    }
    const nailCol = nn ? nail.map(v => v / nn / 255) : [0.8, 0.6, 0.6], skinCol = ns ? skin.map(v => v / ns / 255) : nailCol;
    // sanity-check the size against the finger, so a partial or torn mask can't make a tiny or giant nail
    const s0 = n.segCrop || R / 1.5, w0 = NAIL_W * s0, l0 = NAIL_L * s0;
    const gw = Math.min(1.35 * w0, Math.max(0.6 * w0, w));
    const gbot = top + Math.min(1.45 * l0, Math.max(0.4 * l0, len - 1));
    const g = { top, bot: gbot + 0.5, w: gw, len, rawW: w, segCrop: s0, xc, lum: lsum / area / 255, slope, ym, reliable, nailCol, skinCol, ext: reliable ? 1 : 0,
                quality, conf, fill, show: quality };
    if (prev && !n.fresh) {
      // fade nails in and out; a nail already on screen needs clearly bad masks to go (hysteresis)
      const target = quality > (prev.show > 0.5 ? 0.25 : 0.55) ? 1 : 0;
      g.show = prev.show + (target - prev.show) * (target ? 0.35 : 0.3);
      // grow / retract the extension over a few frames instead of popping when the geometry is briefly unreliable
      g.ext = prev.ext + ((reliable ? 1 : 0) - prev.ext) * (reliable ? 0.3 : 0.15);
      for (const k of ['top', 'bot', 'w', 'xc', 'lum', 'slope', 'ym']) g[k] = prev[k] + (g[k] - prev[k]) * 0.5;
      for (const k of ['nailCol', 'skinCol']) g[k] = g[k].map((v, j) => prev[k][j] + (v - prev[k][j]) * 0.4);
    }
    this.geo[n.tile] = g;
    return g;
  }

  // view: { w, h } canvas pixels; fit 'cover' | 'contain'; mirror for the selfie camera
  viewToSource(vw, vh, fit, mirror) {
    const s = fit === 'cover' ? Math.max(vw / this.sw, vh / this.sh) : Math.min(vw / this.sw, vh / this.sh);
    const ox = (vw - this.sw * s) / 2, oy = (vh - this.sh * s) / 2;
    // source = (view - o) / s, with the view flipped horizontally for the selfie camera
    return mirror ? [-1 / s, 0, (vw - ox) / s, 0, 1 / s, -oy / s] : [1 / s, 0, -ox / s, 0, 1 / s, -oy / s];
  }

  composite(look, { vw, vh, fit = 'cover', mirror = false, tilt = 0, target = null, flipY = true }) {
    const gl = this.gl, p = this.pComp;
    const V2S = this.viewToSource(vw, vh, fit, mirror);
    const pxPerSrc = 1 / Math.abs(V2S[0]);
    if (target) { gl.bindFramebuffer(gl.FRAMEBUFFER, target); } else gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, vw, vh);
    gl.useProgram(p.p); gl.bindVertexArray(this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.src); gl.uniform1i(p.u.uSrc, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.ema[this.cur]); gl.uniform1i(p.u.uMask, 1);
    gl.uniform2f(p.u.uSrcSize, this.sw, this.sh); gl.uniform2f(p.u.uView, vw, vh); gl.uniform2f(p.u.uAtlas, this.aw, this.ah);
    gl.uniformMatrix3fv(p.u.uV2S, false, mat3(V2S));
    gl.uniform3fv(p.u.uLo, this.levels.lo); gl.uniform3fv(p.u.uHi, this.levels.hi);
    gl.uniform1i(p.u.uFlipY, flipY ? 1 : 0);
    gl.uniform1i(p.u.uChip, this.chip ? 1 : 0);
    const nails = this.nails.filter(n => n.geo);
    gl.uniform1i(p.u.uN, nails.length);
    const S2C = new Float32Array(MAXN * 9), org = new Float32Array(MAXN * 2), geo = new Float32Array(MAXN * 4), geo2 = new Float32Array(MAXN * 4), geo3 = new Float32Array(MAXN * 3);
    const ncol = new Float32Array(MAXN * 3), scol = new Float32Array(MAXN * 3);
    nails.forEach((n, i) => {
      S2C.set(mat3(inv(n.M)), i * 9);
      org.set([(n.tile % this.net.cols) * R, Math.floor(n.tile / this.net.cols) * R], i * 2);
      geo.set([n.geo.top, n.geo.bot, n.geo.w, n.geo.xc], i * 4);
      const cropPx = Math.hypot(n.M[0], n.M[3]);              // source px per crop px
      geo2.set([n.geo.ext * (EXT[look.length] ?? 0.8), n.f, n.geo.lum, cropPx * pxPerSrc], i * 4);
      geo3.set([n.geo.slope, n.geo.ym, n.geo.show], i * 3);
      ncol.set(n.geo.nailCol, i * 3); scol.set(n.geo.skinCol, i * 3);
    });
    if (nails.length) {
      gl.uniformMatrix3fv(p.u['uS2C[0]'], false, S2C);
      gl.uniform2fv(p.u['uOrg[0]'], org); gl.uniform4fv(p.u['uGeo[0]'], geo); gl.uniform4fv(p.u['uGeo2[0]'], geo2); gl.uniform3fv(p.u['uGeo3[0]'], geo3);
      gl.uniform3fv(p.u['uNailCol[0]'], ncol); gl.uniform3fv(p.u['uSkinCol[0]'], scol);
    }
    const [r, g, b] = hexRgb(look.shade);
    gl.uniform3f(p.u.uShade, r / 255, g / 255, b / 255);
    gl.uniform1i(p.u.uShape, SHAPE_ID[look.shape] ?? 0);
    gl.uniform1i(p.u.uDesign, DESIGN_ID[look.design] ?? 0);
    gl.uniform1f(p.u.uTilt, tilt); gl.uniform1f(p.u.uTime, performance.now() / 1000);
    gl.uniform1i(p.u.uDebug, this.debug ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    return nails.length;
  }

  // debug: the fingertip tiles the network saw, with its nail mask outlined in red (ImageData)
  debugTiles() {
    const gl = this.gl, net = this.net, W = this.aw, H = this.ah;
    gl.bindFramebuffer(gl.FRAMEBUFFER, net.fb);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, net.t.x.tex, 0, 0);
    const inp = new Float32Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, inp);
    const out = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const m = this.readBuf[i * 4] / 255;
      for (let c = 0; c < 3; c++) { const v = (inp[i * 4 + c] * 0.25 + 0.5) * 255; out[i * 4 + c] = c === 0 ? v * (1 - m * 0.5) + 255 * m * 0.5 : v * (1 - m * 0.5); }
      out[i * 4 + 3] = 255;
    }
    return new ImageData(out, W, H);
  }

  // full-resolution still of the current frame with nails, as ImageData (rows top-first)
  captureImage(look, opts) {
    const gl = this.gl, w = this.sw, h = this.sh;
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    this.composite(look, { ...opts, vw: w, vh: h, fit: 'contain', target: fb, flipY: false });
    const px = new Uint8ClampedArray(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(t);
    return new ImageData(px, w, h);
  }
}
