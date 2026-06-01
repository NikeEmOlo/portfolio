// @ts-nocheck
// ─── Tunable constants ────────────────────────────────────────────────────────
const TRAIL_FADE_SECONDS = 5.0;  // seconds for a fully-lit area to fade back to black
const DAB_RADIUS       = 0.06;
const TURBULENCE       = 0.27;
const TINT             = [0x87 / 255, 0x12 / 255, 0xff / 255];
const IRID_FREQUENCY   = 3.0;
const IRID_ANGLE       = 81.0 * (Math.PI / 180);
const IRID_SPEED       = 0.1;
const BLOOM_THRESHOLD  = 0.25;
const BLOOM_INTENSITY  = 0.6;
const RENDER_SCALE     = 0.5;
const REST_OPACITY     = 0.02;   // at-rest outline brightness — higher = more visible
// NOTE: the portal's font is set in PortalEffect.astro on .portal-effect-label
// (font-family/weight). This file reads it from that element — see below.

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
uniform vec3      u_tint;
uniform float     u_bloom_thresh;
uniform float     u_rest_opacity;

const float PI = 3.14159265;

vec3 cospalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(2.0 * PI * (c * t + d));
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

  vec3 irid = cospalette(phase,
    vec3(0.5),
    vec3(0.5),
    vec3(1.0, 0.8, 0.6),
    vec3(0.0, 0.2, 0.5)
  );

  // Tint toward purple
  irid = mix(irid, u_tint, 0.45) * lit;

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
uniform float     u_bloom_intensity;
void main() {
  vec3 scene = texture2D(u_scene, v_uv).rgb;
  vec3 bloom = texture2D(u_bloom, v_uv).rgb;
  gl_FragColor = vec4(scene + bloom * u_bloom_intensity, 1.0);
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

  // The portal's font is controlled by the hidden .portal-effect-label via CSS.
  // Reading the family/weight off that element gives the canvas the real
  // (Astro-hashed) family name AND — because the label actually uses the font —
  // guarantees the browser downloads it. Astro's Fonts API hides the real family
  // name (e.g. "David Libre-3dcc…") behind the CSS variable, so we can't hardcode it.
  const label      = canvas.parentElement && canvas.parentElement.querySelector('.portal-effect-label');
  const labelStyle = label ? getComputedStyle(label) : null;
  const fontFamily = labelStyle ? labelStyle.fontFamily : 'Arial, sans-serif';
  const fontWeight = labelStyle ? labelStyle.fontWeight : '400';

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
  }

  // ── Text mask texture ──
  let maskTex, restTex;

  function buildMaskTexture() {
    const offW = W, offH = H;

    // Layout box (leave a margin on all sides).
    const pad       = 0.08;
    const maxWidth  = offW * (1 - 2 * pad);
    const maxHeight = offH * (1 - 2 * pad);
    const LINE_H    = 1.2;                         // line spacing × font size
    const MIN_FONT  = 10;
    const MAX_FONT  = Math.round(offH * 0.45);
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
      const fits  = lines.length * mid * LINE_H <= maxHeight &&
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
    const lineHeight = fontSize * LINE_H;
    const blockH     = lines.length * lineHeight;
    const startY     = offH / 2 - blockH / 2 + lineHeight / 2;   // vertically centred

    // Render the wrapped, centred lines. mode: 'fill' (light mask) or
    // 'stroke' (faint at-rest outline).
    function renderLayer(mode) {
      const c  = document.createElement('canvas');
      c.width  = offW;
      c.height = offH;
      const cx = c.getContext('2d');
      cx.clearRect(0, 0, offW, offH);
      cx.font         = fontStr;
      cx.textAlign    = 'center';
      cx.textBaseline = 'middle';
      cx.fillStyle    = 'white';
      cx.strokeStyle  = 'white';
      cx.lineWidth    = 1;
      lines.forEach((line, i) => {
        const y = startY + i * lineHeight;
        if (mode === 'stroke') cx.strokeText(line, offW / 2, y);
        else                   cx.fillText(line, offW / 2, y);
      });
      return c;
    }

    maskTex = uploadCanvasTex(gl, renderLayer('fill'),   maskTex);
    restTex = uploadCanvasTex(gl, renderLayer('stroke'), restTex);
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
    gl.uniform3f(gl.getUniformLocation(compProg, 'u_tint'),         TINT[0], TINT[1], TINT[2]);
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
    gl.uniform1i(gl.getUniformLocation(finalProg, 'u_scene'),          0);
    gl.uniform1i(gl.getUniformLocation(finalProg, 'u_bloom'),          1);
    gl.uniform1f(gl.getUniformLocation(finalProg, 'u_bloom_intensity'), BLOOM_INTENSITY);
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
