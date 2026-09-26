// NailNet inference in WebGL2 — runs the fingertip nail-mask network for up to N fingertips at once.
// Tensors are RGBA16F texture arrays: 4 channels per layer, tiles laid out in a grid (one tile per fingertip).
// Semantics match PyTorch exactly: zero padding inside each tile, bilinear upsampling with align_corners=false.

const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2DArray;
uniform int uR, uRin, uStride, uLayer;
uniform sampler2DArray uSrc0, uSrc1;
uniform int uG0, uG1;
uniform highp sampler2D uW;
out vec4 o;
ivec2 tileOf(ivec2 p){ return p / uR; }
vec4 at(sampler2DArray t, ivec2 tile, ivec2 l, int layer){
  if (l.x < 0 || l.y < 0 || l.x >= uRin || l.y >= uRin) return vec4(0.0);
  return texelFetch(t, ivec3(tile * uRin + l, layer), 0);
}
vec4 src(ivec2 tile, ivec2 l, int g){ return g < uG0 ? at(uSrc0, tile, l, g) : at(uSrc1, tile, l, g - uG0); }
vec4 W(int i){ return texelFetch(uW, ivec2(i % 1024, i / 1024), 0); }
uniform int uAct, uWBias;
vec4 act(vec4 v){ return uAct == 1 ? clamp(v, 0.0, 6.0) : uAct == 2 ? 1.0 / (1.0 + exp(-v)) : v; }
`;

const FS = {
  // standard 3x3 conv, any stride. weights: ((co*G + g)*3 + ky)*3 + kx -> vec4 over 4 input channels
  full: HEAD + `
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy), tile = tileOf(p), lo = p - tile * uR;
  int G = uG0 + uG1, co0 = uLayer * 4;
  vec4 acc = W(uWBias + uLayer);
  for (int ky = 0; ky < 3; ky++) for (int kx = 0; kx < 3; kx++) {
    ivec2 q = lo * uStride + ivec2(kx - 1, ky - 1);
    for (int g = 0; g < G; g++) {
      vec4 v = src(tile, q, g);
      for (int c = 0; c < 4; c++) acc[c] += dot(v, W(((co0 + c) * G + g) * 9 + ky * 3 + kx));
    }
  }
  o = act(acc);
}`,
  // depthwise 3x3: weights (g*3 + ky)*3 + kx -> vec4 over the group's 4 channels
  dw: HEAD + `
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy), tile = tileOf(p), lo = p - tile * uR;
  vec4 acc = W(uWBias + uLayer);
  for (int ky = 0; ky < 3; ky++) for (int kx = 0; kx < 3; kx++)
    acc += src(tile, lo * uStride + ivec2(kx - 1, ky - 1), uLayer) * W((uLayer * 3 + ky) * 3 + kx);
  o = act(acc);
}`,
  // pointwise 1x1: weights co*G + g -> vec4 over 4 input channels
  pw: HEAD + `
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy), tile = tileOf(p), lo = p - tile * uR;
  int G = uG0 + uG1, co0 = uLayer * 4;
  vec4 acc = W(uWBias + uLayer);
  for (int g = 0; g < G; g++) {
    vec4 v = src(tile, lo, g);
    for (int c = 0; c < 4; c++) acc[c] += dot(v, W((co0 + c) * G + g));
  }
  o = act(acc);
}`,
  // bilinear upsample, align_corners = false (PyTorch)
  up: HEAD + `
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy), tile = tileOf(p), lo = p - tile * uR;
  vec2 s = max((vec2(lo) + 0.5) * float(uRin) / float(uR) - 0.5, 0.0);
  ivec2 i0 = ivec2(floor(s)); ivec2 i1 = min(i0 + 1, ivec2(uRin - 1)); vec2 f = s - vec2(i0);
  vec4 a = at(uSrc0, tile, i0, uLayer), b = at(uSrc0, tile, ivec2(i1.x, i0.y), uLayer);
  vec4 c = at(uSrc0, tile, ivec2(i0.x, i1.y), uLayer), d = at(uSrc0, tile, i1, uLayer);
  o = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`,
};

function compile(gl, vs, fs) {
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x);
    if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}

export class NailNetGL {
  constructor(gl, spec, weights, maxTiles = 10) {
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float'))
      throw new Error('float render targets not supported');
    this.spec = spec;
    this.cols = Math.min(maxTiles, 5);
    this.rows = Math.ceil(maxTiles / this.cols);
    this.maxTiles = maxTiles;
    this.R = spec.input;
    this.progs = Object.fromEntries(Object.entries(FS).map(([k, fs]) => [k, compile(gl, VS, fs)]));
    this.quad = gl.createVertexArray();
    gl.bindVertexArray(this.quad);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.fb = gl.createFramebuffer();

    // tensor shapes
    this.t = { x: { r: this.R, g: 1 } };
    for (const op of spec.ops) {
      if (op.op === 'up') { this.t[op.dst] = { r: this.t[op.like].r, g: this.t[op.src].g }; continue; }
      const r0 = this.t[op.src[0]].r;
      const gin = op.src.reduce((a, s) => a + this.t[s].g, 0);
      this.t[op.dst] = { r: r0 / op.stride, g: op.type === 'dw' ? gin : Math.ceil(op.cout / 4) };
    }
    for (const [name, t] of Object.entries(this.t)) t.tex = this._array(t.r, t.g);

    // weights -> one RGBA32F texture per conv op (texel = 4 input channels or 4 depthwise channels)
    for (const op of spec.ops) if (op.op === 'conv') op._w = this._weights(op, weights);
  }

  _array(r, g) {
    const gl = this.gl, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA16F, this.cols * r, this.rows * r, g);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, gl.NEAREST);
    return tex;
  }

  _weights(op, all) {
    const w = all.subarray(op.w[0], op.w[0] + op.w[1]), b = all.subarray(op.b[0], op.b[0] + op.b[1]);
    const gin = op.src.reduce((a, s) => a + this.t[s].g, 0);
    const cin = op.cin, cout = op.cout, gout = op.type === 'dw' ? gin : Math.ceil(cout / 4);
    const texels = [];
    const vec = f => { const v = [0, 0, 0, 0]; for (let c = 0; c < 4; c++) v[c] = f(c); texels.push(v); };
    if (op.type === 'full') {
      for (let co = 0; co < gout * 4; co++) for (let g = 0; g < gin; g++) for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++)
        vec(c => { const ci = g * 4 + c; return co < cout && ci < cin ? w[((co * cin + ci) * 3 + ky) * 3 + kx] : 0; });
    } else if (op.type === 'pw') {
      for (let co = 0; co < gout * 4; co++) for (let g = 0; g < gin; g++)
        vec(c => { const ci = g * 4 + c; return co < cout && ci < cin ? w[co * cin + ci] : 0; });
    } else {
      for (let g = 0; g < gin; g++) for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++)
        vec(c => { const ch = g * 4 + c; return ch < cin ? w[ch * 9 + ky * 3 + kx] : 0; });
    }
    const biasAt = texels.length;
    for (let g = 0; g < gout; g++) vec(c => (g * 4 + c < cout ? b[g * 4 + c] : 0));
    const n = texels.length, W = 1024, H = Math.ceil(n / W);
    const data = new Float32Array(W * H * 4);
    texels.forEach((v, i) => data.set(v, i * 4));
    const gl = this.gl, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, data);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    return { tex, bias: biasAt, gout };
  }

  // framebuffer bound to a layer of the input tensor, so a crop pass can render fingertips straight in
  bindInput() {
    const gl = this.gl, t = this.t.x;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, t.tex, 0, 0);
    gl.viewport(0, 0, this.cols * t.r, this.rows * t.r);
  }

  uploadInput(float32, tiles = 1) {       // test helper: CHW float tensor(s) -> input atlas
    const gl = this.gl, R = this.R, data = new Float32Array(this.cols * R * this.rows * R * 4);
    for (let n = 0; n < tiles; n++) {
      const tx = (n % this.cols) * R, ty = Math.floor(n / this.cols) * R;
      for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) for (let c = 0; c < 4; c++)
        data[((ty + y) * this.cols * R + tx + x) * 4 + c] = float32[n * 4 * R * R + c * R * R + y * R + x];
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.t.x.tex);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, this.cols * R, this.rows * R, 1, gl.RGBA, gl.FLOAT, data);
  }

  run(tiles = this.maxTiles) {
    const gl = this.gl;
    const rowsUsed = Math.ceil(tiles / this.cols);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.bindVertexArray(this.quad);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    for (const op of this.spec.ops) {
      const out = this.t[op.dst];
      const kind = op.op === 'up' ? 'up' : op.type;
      const { p, u } = this.progs[kind];
      gl.useProgram(p);
      const srcs = Array.isArray(op.src) ? op.src : [op.src];
      const s0 = this.t[srcs[0]], s1 = srcs[1] ? this.t[srcs[1]] : null;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, s0.tex); gl.uniform1i(u.uSrc0, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, (s1 || s0).tex); gl.uniform1i(u.uSrc1, 1);
      gl.uniform1i(u.uR, out.r); gl.uniform1i(u.uRin, s0.r);
      if (u.uG0) gl.uniform1i(u.uG0, s0.g);
      if (u.uG1) gl.uniform1i(u.uG1, s1 ? s1.g : 0);
      if (op.op === 'conv') {
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, op._w.tex); gl.uniform1i(u.uW, 2);
        gl.uniform1i(u.uStride, op.stride); gl.uniform1i(u.uWBias, op._w.bias);
        gl.uniform1i(u.uAct, op.act === 'relu6' ? 1 : op.act === 'sigmoid' ? 2 : 0);
      }
      gl.viewport(0, 0, this.cols * out.r, rowsUsed * out.r);
      for (let L = 0; L < out.g; L++) {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, out.tex, 0, L);
        gl.uniform1i(u.uLayer, L);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }
    gl.bindVertexArray(null);
    return this.t.mask.tex;           // channel .r of layer 0 = nail probability, one tile per fingertip
  }

  readMask(tiles = 1) {                // debug / geometry helper: Float32 masks [tiles][R*R]
    const gl = this.gl, R = this.R, W = this.cols * R, H = Math.ceil(tiles / this.cols) * R;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.t.mask.tex, 0, 0);
    const buf = new Float32Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, buf);
    const out = [];
    for (let n = 0; n < tiles; n++) {
      const tx = (n % this.cols) * R, ty = Math.floor(n / this.cols) * R, m = new Float32Array(R * R);
      for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) m[y * R + x] = buf[((ty + y) * W + tx + x) * 4];
      out.push(m);
    }
    return out;
  }
}
