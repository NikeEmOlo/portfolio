// @ts-nocheck
// ─── Tunable constants ────────────────────────────────────────────────────────
const TRAIL_FADE_SECONDS = 5.0;  // seconds for a fully-lit area to fade back to black
const DAB_RADIUS       = 0.06;
const TURBULENCE       = 0.27;
// Trail palette — the glow cycles through these (from --tarot-gradient + a blue).
// teal → blue → purple → pink. Tweak/reorder freely; keep it to 4 colours.
const TRAIL_COLORS     = ['#359E9D', '#0558ff', '#ff34ae', '#e190ff'];
const IRID_FREQUENCY   = 1.5;   // how many times the palette repeats across the text
const IRID_ANGLE       = 81.0 * (Math.PI / 180);
const IRID_SPEED       = 0.1;
const BLOOM_THRESHOLD  = 0.25;
const BLOOM_INTENSITY  = 0.6;
const RENDER_SCALE     = 0.5;
const REST_OPACITY     = 0.01;   // at-rest outline brightness — higher = more visible

// ─── Depth / bokeh (sits behind AND in front of the text) ─────────────────────
const DEPTH_TINT = '#05090F';                                       // very dark cool centre of the far gradient (→ black at edges)
const DEPTH_SEED = 1;                                               // stable bokeh layout across reloads/resizes
const BOKEH_FAR  = { count: 16, size: [0.004, 0.020], opacity: 0.55, core: 0.6 }; // tiny sharp specks behind the text
const BOKEH_NEAR = { count: 4,  size: [0.03,  0.10],  opacity: 0.18, core: 0   }; // soft out-of-focus motes in front

// ─── Text layout (easy to tweak) ──────────────────────────────────────────────
const FONT_CSS_VAR = '--main-font'; // Astro font var: --main-font | --secondary-font | --boldonse
const FONT_WEIGHT  = 400;           // 400 = regular; raise if the font ships heavier weights
const TEXT_SIZE    = 4;            // biggest text height as a % of the portal's height (auto-shrinks to fit)
const LINE_HEIGHT  = 1.2;           // line spacing × font size
const TEXT_ALIGN   = 'center';      // 'left' | 'center' | 'right'

// Hex "#rrggbb" → [r, g, b] in 0..1 for the shader.
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const TRAIL_RGB = TRAIL_COLORS.map(hexToRgb);

// ─── WebGL helpers ────────────────────────────────────────────────────────────
function compileShader(gl, src, type) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function linkProgram(gl, vsrc, fsrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compileShader(gl, vsrc, gl.VERTEX_SHADER));
  gl.attachShader(p, compileShader(gl, fsrc, gl.FRAGMENT_SHADER));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p));
  return p;
}

function makeFBO(gl, w, h, type, filter) {
  type   = type   || gl.UNSIGNED_BYTE;
  filter = filter || gl.LINEAR;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb };
}

// ─── Shared fullscreen quad vertex shader ────────────────────────────────────
const VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// ─── Pass 1: Trail (ping-pong) ────────────────────────────────────────────────
const TRAIL_FS = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_prev;
uniform vec2      u_mouse;      // normalised 0..1
uniform float     u_drain;        // amount subtracted from the trail each frame
uniform float     u_radius;
uniform float     u_turbulence;
uniform float     u_time;
uniform vec2      u_res;
uniform float     u_dab;          // 1 = paint dab at mouse, 0 = fade only

// Value noise for turbulence
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1,0));
  float c = hash(i + vec2(0,1));
  float d = hash(i + vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i=0; i<4; i++) { v += a * vnoise(p); p *= 2.0; a *= 0.5; }
  return v;
}

void main() {
  // Linear fade: subtract a fixed amount each frame so the lit text drains
  // smoothly and fully back to black over TRAIL_FADE_SECONDS. Driven by real
  // elapsed time (u_drain), so the duration is the same at any frame rate.
  vec4 prev = max(texture2D(u_prev, v_uv) - u_drain, 0.0);

  // Aspect-corrected distance to mouse
  vec2 ar   = vec2(u_res.x / u_res.y, 1.0);
  vec2 diff = (v_uv - u_mouse) * ar;

  // Turbulent perturbation
  float n   = fbm(v_uv * 8.0 + u_time * 0.5) * 2.0 - 1.0;
  float d   = length(diff + n * u_turbulence * u_radius);

  // Soft dab (gated: only added while the cursor is over the component)
  float dab = exp(-d * d / (u_radius * u_radius)) * u_dab;

  // Clamp accumulation to 1.0 so repeatedly swept areas don't over-charge and
  // outlast the fade time (the half-float buffer won't clamp for us).
  gl_FragColor = vec4(min(prev.rgb + vec3(dab), 1.0), 1.0);
}`;

// ─── Pass 2+3+4: Composite (mask + iridescence + bloom input) ────────────────
const COMP_FS = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_trail;
uniform sampler2D u_mask;
uniform sampler2D u_rest;
uniform float     u_time;
uniform float     u_irid_freq;
uniform float     u_irid_speed;
uniform float     u_irid_angle;
uniform vec3      u_c0, u_c1, u_c2, u_c3;   // trail palette stops
uniform float     u_bloom_thresh;
uniform float     u_rest_opacity;

const float PI = 3.14159265;

// Cycle through the four palette stops (teal → blue → purple → pink), looping.
vec3 palette(float t) {
  t = fract(t) * 4.0;
  float i = floor(t);
  float f = fract(t);
  vec3 a = i < 1.0 ? u_c0 : i < 2.0 ? u_c1 : i < 3.0 ? u_c2 : u_c3;
  vec3 b = i < 1.0 ? u_c1 : i < 2.0 ? u_c2 : i < 3.0 ? u_c3 : u_c0;
  return mix(a, b, f);
}

void main() {
  float trail    = texture2D(u_trail, v_uv).r;
  float maskA    = texture2D(u_mask,  v_uv).a;
  float restA    = texture2D(u_rest,  v_uv).a;

  // Mask trail to text shape
  float lit = clamp(trail * maskA, 0.0, 1.0);

  // Iridescence direction
  vec2  dir   = vec2(cos(u_irid_angle), sin(u_irid_angle));
  float coord = dot(v_uv, dir);
  float phase = coord * u_irid_freq + u_time * u_irid_speed;

  vec3 irid = palette(phase) * lit;

  // Rest (faint text outline from the mask channel)
  vec3 rest = vec3(restA * u_rest_opacity);

  gl_FragColor = vec4(irid + rest, 1.0);
}`;

// ─── Pass 4: Bloom bright-pass ────────────────────────────────────────────────
const BRIGHT_FS = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_src;
uniform float     u_threshold;
void main() {
  vec3 c = texture2D(u_src, v_uv).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(lum > u_threshold ? c : vec3(0.0), 1.0);
}`;

// ─── Pass 4: Gaussian blur (1D, run twice) ───────────────────────────────────
const BLUR_FS = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_src;
uniform vec2      u_dir;
void main() {
  vec3 acc = vec3(0.0);
  float weights[5];
  weights[0]=0.227027; weights[1]=0.194595; weights[2]=0.121622;
  weights[3]=0.054054; weights[4]=0.016216;
  acc += texture2D(u_src, v_uv).rgb * weights[0];
  for (int i=1; i<5; i++) {
    acc += texture2D(u_src, v_uv + u_dir * float(i)).rgb * weights[i];
    acc += texture2D(u_src, v_uv - u_dir * float(i)).rgb * weights[i];
  }
  gl_FragColor = vec4(acc, 1.0);
}`;

// ─── Pass 5: Final composite ──────────────────────────────────────────────────
const FINAL_FS = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform sampler2D u_depth_far;    // bokeh behind the text
uniform sampler2D u_depth_near;   // bokeh in front of the text
uniform float     u_bloom_intensity;
uniform float     u_time;
uniform vec2      u_parallax;   // eased cursor offset from card centre (−0.5..0.5)
void main() {
  vec3 scene = texture2D(u_scene, v_uv).rgb;
  vec3 bloom = texture2D(u_bloom, v_uv).rgb;
  // Inset the depth sampling so neither the float nor the parallax can reach the
  // texture edge (sampling past it clamps and smears the last row/col into a line).
  float M    = 0.10;
  vec2  base = v_uv * (1.0 - 2.0 * M) + M;
  // Each bokeh layer drifts on its own — independent floating inside the card…
  vec2 floatFar  = vec2(sin(u_time * 0.18),       cos(u_time * 0.13))       * 0.020;
  vec2 floatNear = vec2(sin(u_time * 0.21 + 1.7), cos(u_time * 0.16 + 0.6)) * 0.030;
  // …and the whole scene parallaxes with the cursor — the near layer shifts more
  // than the far, so the card reads like a 3D window as you move across it.
  vec3 far  = texture2D(u_depth_far,  base + floatFar  + u_parallax * 0.04).rgb;
  vec3 near = texture2D(u_depth_near, base + floatNear + u_parallax * 0.09).rgb;
  // Sandwich the unchanged glow between far (behind) and near (in front) bokeh.
  gl_FragColor = vec4(far + scene + bloom * u_bloom_intensity + near, 1.0);
}`;

// ─── Main initialiser ─────────────────────────────────────────────────────────
export function initPortalEffect(canvas, text) {
  // Respect reduced motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    renderStaticFallback(canvas, text);
    return () => {};
  }

  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false });
  if (!gl) { renderStaticFallback(canvas, text); return () => {}; }

  // The trail buffer needs finer-than-8-bit precision to fade slowly without
  // the fade stalling. Prefer a half-float target; fall back to 8-bit.
  const halfFloat = gl.getExtension('OES_texture_half_float');
  let trailType = halfFloat ? halfFloat.HALF_FLOAT_OES : gl.UNSIGNED_BYTE;

  // Drive the hidden .portal-effect-label's font from the constants above. Using
  // the font on a real DOM element makes the browser download it; we then read the
  // *resolved* family back off the label for the canvas — Astro's Fonts API hides
  // the real family name (e.g. "David Libre-3dcc…") behind the CSS variable, so it
  // can't be hardcoded.
  const label = canvas.parentElement && canvas.parentElement.querySelector('.portal-effect-label');
  if (label) {
    label.style.fontFamily = `var(${FONT_CSS_VAR}, sans-serif)`;
    label.style.fontWeight = FONT_WEIGHT;
  }
  const fontFamily = label ? getComputedStyle(label).fontFamily : 'sans-serif';
  const fontWeight = FONT_WEIGHT;

  // ── Geometry: fullscreen quad ──
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

  function bindQuad(prog) {
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }

  // ── Programs ──
  const trailProg  = linkProgram(gl, VS, TRAIL_FS);
  const compProg   = linkProgram(gl, VS, COMP_FS);
  const brightProg = linkProgram(gl, VS, BRIGHT_FS);
  const blurProg   = linkProgram(gl, VS, BLUR_FS);
  const finalProg  = linkProgram(gl, VS, FINAL_FS);

  // ── FBOs (sized to render resolution) ──
  let W, H, pingA, pingB, compFBO, brightFBO, blurFBO;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    W = Math.round(cssW * dpr * RENDER_SCALE);
    H = Math.round(cssH * dpr * RENDER_SCALE);
    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Trail buffers: half-float + NEAREST (sampled 1:1, so no linear filtering needed).
    pingA = makeFBO(gl, W, H, trailType, gl.NEAREST);
    pingB = makeFBO(gl, W, H, trailType, gl.NEAREST);
    // Confirm the half-float target is actually renderable here; fall back if not.
    gl.bindFramebuffer(gl.FRAMEBUFFER, pingA.fb);
    if (trailType !== gl.UNSIGNED_BYTE &&
        gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      trailType = gl.UNSIGNED_BYTE;
      pingA = makeFBO(gl, W, H, trailType, gl.NEAREST);
      pingB = makeFBO(gl, W, H, trailType, gl.NEAREST);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    compFBO  = makeFBO(gl, W, H);
    brightFBO= makeFBO(gl, W, H);
    blurFBO  = makeFBO(gl, W, H);

    buildMaskTexture();
    buildDepthTextures();
  }

  // ── Text mask texture ──
  let maskTex, restTex;
  // ── Depth bokeh textures (behind / in front of the text) ──
  let depthFarTex, depthNearTex;

  function buildMaskTexture() {
    const offW = W, offH = H;

    // Layout box (leave a margin on all sides).
    const pad       = 0.08;
    const maxWidth  = offW * (1 - 2 * pad);
    const maxHeight = offH * (1 - 2 * pad);
    const MIN_FONT  = 10;
    const MAX_FONT  = Math.round(offH * TEXT_SIZE / 100);
    const fontFor   = s => `${fontWeight} ${s}px ${fontFamily}`;

    // Scratch context used only for measuring during layout.
    const mctx = document.createElement('canvas').getContext('2d');

    // Greedy word-wrap at the given font size; returns the wrapped lines.
    function wrapLines(fontSize) {
      mctx.font = fontFor(fontSize);
      const words = text.split(/\s+/).filter(Boolean);
      const lines = [];
      let line = '';
      for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (!line || mctx.measureText(test).width <= maxWidth) {
          line = test;                            // word still fits this line
        } else {
          lines.push(line);                       // overflow → start a new line
          line = word;
        }
      }
      if (line) lines.push(line);
      return lines;
    }

    const widestLine = lines =>
      lines.reduce((m, l) => Math.max(m, mctx.measureText(l).width), 0);

    // Largest font size at which the WRAPPED text fits the box, via binary
    // search. This prefers wrapping — the font only shrinks when extra lines
    // still won't fit the available height (or a word is wider than the box).
    let lo = MIN_FONT, hi = MAX_FONT, fontSize = MIN_FONT;
    while (lo <= hi) {
      const mid   = (lo + hi) >> 1;
      const lines = wrapLines(mid);
      const fits  = lines.length * mid * LINE_HEIGHT <= maxHeight &&
                    widestLine(lines) <= maxWidth;
      if (fits) { fontSize = mid; lo = mid + 1; }
      else      { hi = mid - 1; }
    }

    // Last resort: a single unbreakable word still wider than the box → scale down.
    let lines = wrapLines(fontSize);
    const widest = widestLine(lines);
    if (widest > maxWidth) {
      fontSize = Math.max(1, Math.floor(fontSize * (maxWidth / widest)));
      lines = wrapLines(fontSize);
    }

    const fontStr    = fontFor(fontSize);
    const lineHeight = fontSize * LINE_HEIGHT;
    const blockH     = lines.length * lineHeight;
    const startY     = offH / 2 - blockH / 2 + lineHeight / 2;   // vertically centred

    // Horizontal anchor for the chosen alignment.
    const alignX = TEXT_ALIGN === 'left'  ? pad * offW
                 : TEXT_ALIGN === 'right' ? offW * (1 - pad)
                 :                          offW / 2;

    // Render the wrapped, aligned lines. mode: 'fill' (light mask) or
    // 'stroke' (faint at-rest outline).
    function renderLayer(mode) {
      const c  = document.createElement('canvas');
      c.width  = offW;
      c.height = offH;
      const cx = c.getContext('2d');
      cx.clearRect(0, 0, offW, offH);
      cx.font         = fontStr;
      cx.textAlign    = TEXT_ALIGN;
      cx.textBaseline = 'middle';
      cx.fillStyle    = 'white';
      cx.strokeStyle  = 'white';
      cx.lineWidth    = 1;
      lines.forEach((line, i) => {
        const y = startY + i * lineHeight;
        if (mode === 'stroke') cx.strokeText(line, alignX, y);
        else                   cx.fillText(line, alignX, y);
      });
      return c;
    }

    maskTex = uploadCanvasTex(gl, renderLayer('fill'),   maskTex);
    restTex = uploadCanvasTex(gl, renderLayer('stroke'), restTex);
  }

  // Seeded PRNG (mulberry32) so the bokeh layout is stable across reloads/resizes.
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Build one bokeh layer on an OPAQUE background (so its RGB can be added
  // directly in the shader — black areas add nothing). Far layer paints the dark
  // depth gradient; near layer is solid black. Bokeh are soft palette-tinted discs.
  function buildDepthLayer(opts, withGradient, seed) {
    // Build at full canvas resolution (not the half-res render buffer) so the
    // specks stay sharp instead of being upscaled/blurred in the final pass.
    const fw = canvas.width, fh = canvas.height;
    const c  = document.createElement('canvas');
    c.width  = fw;
    c.height = fh;
    const cx = c.getContext('2d');

    if (withGradient) {
      const g = cx.createRadialGradient(fw / 2, fh / 2, 0, fw / 2, fh / 2, Math.max(fw, fh) * 0.75);
      g.addColorStop(0, DEPTH_TINT);
      g.addColorStop(1, '#000000');
      cx.fillStyle = g;
    } else {
      cx.fillStyle = '#000000';
    }
    cx.fillRect(0, 0, fw, fh);

    const rng    = makeRng(seed);
    const minDim = Math.min(fw, fh);
    const core   = opts.core || 0;                // 0 = soft glow, ~0.6 = crisp solid core
    cx.globalCompositeOperation = 'lighter';      // bokeh add as light
    for (let i = 0; i < opts.count; i++) {
      const x   = rng() * fw;
      const y   = rng() * fh;
      const sr  = rng();                                              // bias toward small (most are tiny specks)
      const r   = (opts.size[0] + sr * sr * (opts.size[1] - opts.size[0])) * minDim;
      const a   = opts.opacity * (0.5 + 0.5 * rng());                 // vary brightness
      const rgb = hexToRgb(TRAIL_COLORS[(rng() * TRAIL_COLORS.length) | 0]);
      const csv = `${(rgb[0] * 255) | 0}, ${(rgb[1] * 255) | 0}, ${(rgb[2] * 255) | 0}`;
      const dot = cx.createRadialGradient(x, y, 0, x, y, r);
      dot.addColorStop(0, `rgba(${csv}, ${a})`);
      if (core > 0) dot.addColorStop(core, `rgba(${csv}, ${a})`);     // hold a solid core → sharper speck
      dot.addColorStop(1, `rgba(${csv}, 0)`);
      cx.fillStyle = dot;
      cx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    return c;
  }

  function buildDepthTextures() {
    depthFarTex  = uploadCanvasTex(gl, buildDepthLayer(BOKEH_FAR,  true,  DEPTH_SEED),      depthFarTex);
    depthNearTex = uploadCanvasTex(gl, buildDepthLayer(BOKEH_NEAR, false, DEPTH_SEED + 99), depthNearTex);
  }

  function uploadCanvasTex(gl, src, existing) {
    const t = existing || gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    // Canvas2D origin is top-left, WebGL texture origin is bottom-left — flip on
    // upload so the rasterised text reads upright in v_uv space.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // ── Mouse tracking ──
  // .portal sets pointer-events:none on its subtree, so the canvas never receives
  // its own pointer events. Listen on window and hit-test the canvas rect instead.
  let mouseX = -1, mouseY = -1, hasMouse = false;

  function onMouseMove(e) {
    const r = canvas.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right &&
                   e.clientY >= r.top  && e.clientY <= r.bottom;
    hasMouse = inside;
    if (inside) {
      mouseX = (e.clientX - r.left) / r.width;
      mouseY = 1.0 - (e.clientY - r.top) / r.height;
    }
  }

  window.addEventListener('mousemove', onMouseMove);

  // ── Visibility / intersection pausing ──
  let visible = true, inView = true;
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; });
  const io = new IntersectionObserver(entries => { inView = entries[0].isIntersecting; }, { threshold: 0 });
  io.observe(canvas);

  // ── Auto-sweep for touch/mobile ──
  let sweepT = 0;
  function getSweepMouse(t) {
    sweepT += 0.005;
    return { x: 0.5 + 0.4 * Math.sin(sweepT), y: 0.5 + 0.2 * Math.sin(sweepT * 1.3) };
  }

  const isMobile = window.matchMedia('(pointer: coarse)').matches;

  // ── Bind a texture unit helper ──
  function bindTex(unit, tex) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  // ── Render loop ──
  resize();
  window.addEventListener('resize', resize);

  // The first bake above may use a fallback if the font hasn't downloaded yet.
  // The label uses this font via CSS, so the browser fetches it; rebuild the
  // text once fonts are ready (and nudge the load explicitly, belt-and-braces).
  if (document.fonts) {
    document.fonts.load(`${fontWeight} 64px ${fontFamily}`).catch(() => {});
    document.fonts.ready.then(() => buildMaskTexture());
  }

  // ── Active only while the portal is revealed ──
  // Don't paint while hidden behind the tarot card (otherwise the text shows up
  // pre-lit when the portal is revealed). Track .portal's `.show` class — added
  // on open, removed by the close button. On open: clear the trail and drop the
  // stale mouse position so it always starts from black and lights up only as
  // the cursor moves over the revealed text.
  const portalEl = canvas.closest('.portal');
  let active = !portalEl;   // no .portal wrapper → run always (standalone use)

  function clearTrail() {
    for (const fbo of [pingA, pingB]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function syncActive() {
    const shown = !!portalEl && portalEl.classList.contains('show');
    if (shown && !active) { clearTrail(); hasMouse = false; }  // fresh start on reveal
    active = shown;
  }

  let portalObserver;
  if (portalEl) {
    portalObserver = new MutationObserver(syncActive);
    portalObserver.observe(portalEl, { attributes: true, attributeFilter: ['class'] });
    syncActive();
  }

  let ping = pingA, pong = pingB;
  let raf;
  let lastT = 0;
  let px = 0, py = 0;   // eased whole-scene parallax (depth shifts with the cursor)

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const t = ts * 0.001;
    // Keep lastT current while paused so we don't fade in one giant step on resume.
    if (!visible || !inView || !active) { lastT = t; return; }

    // Real elapsed seconds (clamped against tab-switch / hitch spikes).
    const dt    = Math.min(0.05, Math.max(0, t - lastT));
    lastT = t;
    const drain = dt / TRAIL_FADE_SECONDS;

    // Decide the dab source: real cursor on desktop, auto-sweep on touch.
    let mx, my, dab;
    if (isMobile) {
      const s = getSweepMouse(t);          // mobile fallback: no hover, sweep
      mx = s.x; my = s.y; dab = 1.0;
    } else if (hasMouse) {
      mx = mouseX; my = mouseY; dab = 1.0; // cursor over component: paint trail
    } else {
      mx = mouseX; my = mouseY; dab = 0.0; // cursor away: let the trail fade out
    }

    // Ease the whole-scene parallax toward the cursor's offset from centre
    // (eases back to centre when the cursor leaves). Used only by the depth layers.
    const ptx = hasMouse ? mouseX - 0.5 : 0.0;
    const pty = hasMouse ? mouseY - 0.5 : 0.0;
    px += (ptx - px) * 0.06;
    py += (pty - py) * 0.06;

    // ── Pass 1: Trail ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, pong.fb);
    gl.viewport(0, 0, W, H);
    gl.useProgram(trailProg);
    bindQuad(trailProg);
    bindTex(0, ping.tex);
    gl.uniform1i(gl.getUniformLocation(trailProg, 'u_prev'), 0);
    gl.uniform2f(gl.getUniformLocation(trailProg, 'u_mouse'), mx, my);
    gl.uniform1f(gl.getUniformLocation(trailProg, 'u_drain'),       drain);
    gl.uniform1f(gl.getUniformLocation(trailProg, 'u_radius'),      DAB_RADIUS);
    gl.uniform1f(gl.getUniformLocation(trailProg, 'u_turbulence'),  TURBULENCE);
    gl.uniform1f(gl.getUniformLocation(trailProg, 'u_time'),        t);
    gl.uniform2f(gl.getUniformLocation(trailProg, 'u_res'),         W, H);
    gl.uniform1f(gl.getUniformLocation(trailProg, 'u_dab'),         dab);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Swap ping-pong
    [ping, pong] = [pong, ping];

    // ── Pass 2+3: Composite (mask + iridescence) ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, compFBO.fb);
    gl.viewport(0, 0, W, H);
    gl.useProgram(compProg);
    bindQuad(compProg);
    bindTex(0, ping.tex);
    bindTex(1, maskTex);
    bindTex(2, restTex);
    gl.uniform1i(gl.getUniformLocation(compProg, 'u_trail'),        0);
    gl.uniform1i(gl.getUniformLocation(compProg, 'u_mask'),         1);
    gl.uniform1i(gl.getUniformLocation(compProg, 'u_rest'),         2);
    gl.uniform1f(gl.getUniformLocation(compProg, 'u_time'),         t);
    gl.uniform1f(gl.getUniformLocation(compProg, 'u_irid_freq'),    IRID_FREQUENCY);
    gl.uniform1f(gl.getUniformLocation(compProg, 'u_irid_speed'),   IRID_SPEED);
    gl.uniform1f(gl.getUniformLocation(compProg, 'u_irid_angle'),   IRID_ANGLE);
    gl.uniform3fv(gl.getUniformLocation(compProg, 'u_c0'), TRAIL_RGB[0]);
    gl.uniform3fv(gl.getUniformLocation(compProg, 'u_c1'), TRAIL_RGB[1]);
    gl.uniform3fv(gl.getUniformLocation(compProg, 'u_c2'), TRAIL_RGB[2]);
    gl.uniform3fv(gl.getUniformLocation(compProg, 'u_c3'), TRAIL_RGB[3]);
    gl.uniform1f(gl.getUniformLocation(compProg, 'u_rest_opacity'), REST_OPACITY);
    gl.uniform1f(gl.getUniformLocation(compProg, 'u_bloom_thresh'), BLOOM_THRESHOLD);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // ── Pass 4a: Bright-pass ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, brightFBO.fb);
    gl.viewport(0, 0, W, H);
    gl.useProgram(brightProg);
    bindQuad(brightProg);
    bindTex(0, compFBO.tex);
    gl.uniform1i(gl.getUniformLocation(brightProg, 'u_src'),        0);
    gl.uniform1f(gl.getUniformLocation(brightProg, 'u_threshold'),  BLOOM_THRESHOLD);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // ── Pass 4b: Blur horizontal ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurFBO.fb);
    gl.viewport(0, 0, W, H);
    gl.useProgram(blurProg);
    bindQuad(blurProg);
    bindTex(0, brightFBO.tex);
    gl.uniform1i(gl.getUniformLocation(blurProg, 'u_src'), 0);
    gl.uniform2f(gl.getUniformLocation(blurProg, 'u_dir'), 1.0 / W, 0.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // ── Pass 4c: Blur vertical (back into brightFBO) ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, brightFBO.fb);
    gl.viewport(0, 0, W, H);
    bindTex(0, blurFBO.tex);
    gl.uniform2f(gl.getUniformLocation(blurProg, 'u_dir'), 0.0, 1.0 / H);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // ── Pass 5: Final to screen ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(finalProg);
    bindQuad(finalProg);
    bindTex(0, compFBO.tex);
    bindTex(1, brightFBO.tex);
    bindTex(2, depthFarTex);
    bindTex(3, depthNearTex);
    gl.uniform1i(gl.getUniformLocation(finalProg, 'u_scene'),          0);
    gl.uniform1i(gl.getUniformLocation(finalProg, 'u_bloom'),          1);
    gl.uniform1i(gl.getUniformLocation(finalProg, 'u_depth_far'),      2);
    gl.uniform1i(gl.getUniformLocation(finalProg, 'u_depth_near'),     3);
    gl.uniform1f(gl.getUniformLocation(finalProg, 'u_bloom_intensity'), BLOOM_INTENSITY);
    gl.uniform1f(gl.getUniformLocation(finalProg, 'u_time'),            t);
    gl.uniform2f(gl.getUniformLocation(finalProg, 'u_parallax'),        px, py);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  raf = requestAnimationFrame(frame);

  return function destroy() {
    cancelAnimationFrame(raf);
    io.disconnect();
    if (portalObserver) portalObserver.disconnect();
    window.removeEventListener('resize', resize);
    window.removeEventListener('mousemove', onMouseMove);
  };
}

// ─── Static fallback (reduced motion / no WebGL) ─────────────────────────────
function renderStaticFallback(canvas, text) {
  canvas.style.display = 'none';
  const el = document.createElement('p');
  el.textContent = text;
  el.style.cssText = `
    color: #fff;
    font: 900 clamp(2rem,10vw,8rem)/1 'Arial Black', Arial, sans-serif;
    text-align: center;
    letter-spacing: -0.02em;
    margin: 0;
    -webkit-text-stroke: 1px rgba(255,255,255,0.3);
    color: transparent;
  `;
  canvas.parentElement.appendChild(el);
}
