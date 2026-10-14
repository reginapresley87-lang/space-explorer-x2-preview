// HDR post-processing: linear half-float scene target -> bloom (dual-filter mip chain) -> auto exposure
// (GPU log-average luminance with temporal adaptation) -> diffraction spikes, glare & lens flare -> ACES filmic
// tone mapping -> sRGB. Quality tiers: low = tone mapping + exposure only, medium = + bloom + spikes, high = + flare + MSAA.
import * as THREE from '../scene/vendor/three.module.min.js?v=20261014b';

const QUAD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
const DOWN_FS = `uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uKaris; varying vec2 vUv;
  vec3 tap(vec2 o){ vec3 c = texture2D(uSrc, vUv + o * uTexel).rgb; c = min(c, vec3(4000.)); return uKaris > .5 ? c / (1. + dot(c, vec3(.2126, .7152, .0722)) * .25) : c; }
  void main(){ vec3 c = tap(vec2(0.)) * 4. + tap(vec2(-1., -1.)) + tap(vec2(1., -1.)) + tap(vec2(-1., 1.)) + tap(vec2(1., 1.));
    c /= 8.; if (uKaris > .5) c /= max(1. - dot(c, vec3(.2126, .7152, .0722)) * .25, .05); gl_FragColor = vec4(max(c, 0.), 1.); }`;
const UP_FS = `uniform sampler2D uLow, uCur; uniform vec2 uTexel; uniform float uMix; varying vec2 vUv;
  void main(){ vec2 t = uTexel; vec3 c = texture2D(uLow, vUv).rgb * 4.;
    c += (texture2D(uLow, vUv + vec2(t.x, 0.)).rgb + texture2D(uLow, vUv - vec2(t.x, 0.)).rgb + texture2D(uLow, vUv + vec2(0., t.y)).rgb + texture2D(uLow, vUv - vec2(0., t.y)).rgb) * 2.;
    c += texture2D(uLow, vUv + t).rgb + texture2D(uLow, vUv - t).rgb + texture2D(uLow, vUv + vec2(t.x, -t.y)).rgb + texture2D(uLow, vUv + vec2(-t.x, t.y)).rgb;
    gl_FragColor = vec4(texture2D(uCur, vUv).rgb + c / 16. * uMix, 1.); }`;
const LUM_FS = `uniform sampler2D uSrc; varying vec2 vUv;
  void main(){ float s = 0., w = 0.;
    for (int i = 0; i < 8; i++) for (int j = 0; j < 8; j++) { vec2 p = (vec2(float(i), float(j)) + .5) / 8.;
      float k = 1. - .6 * length(p - .5); float L = dot(texture2D(uSrc, p).rgb, vec3(.2126, .7152, .0722));
      s += log(max(L, 1e-4) + 1e-4) * k; w += k; }
    gl_FragColor = vec4(exp(s / w), 0., 0., 1.); }`;
const ADAPT_FS = `uniform sampler2D uPrev, uLum; uniform float uK, uKey, uMin, uMax, uReset; varying vec2 vUv;
  void main(){ float L = texture2D(uLum, vec2(.5)).r; float target = clamp(uKey / max(L, 1e-5), uMin, uMax);
    float prev = texture2D(uPrev, vec2(.5)).r; if (uReset > .5 || prev <= 0. || prev != prev) prev = target;
    float e = exp(mix(log(prev), log(target), uK)); gl_FragColor = vec4(e, L, 0., 1.); }`;
const COMP_FS = `uniform sampler2D uScene, uBloom, uExpo; uniform float uBloomK, uBias, uFlare, uTime, uAsp, uSpikes, uFixedE, uVig;
  uniform vec4 uL[4]; uniform vec3 uLC[4]; uniform vec2 uRes; varying vec2 vUv;
  vec3 aces(vec3 v){ // Stephen Hill's fitted ACES (sRGB -> ACEScg -> RRT+ODT -> sRGB)
    mat3 m1 = mat3(.59719, .07600, .02840, .35458, .90834, .13383, .04823, .01566, .83777);
    mat3 m2 = mat3(1.60475, -.10208, -.00327, -.53108, 1.10813, -.07276, -.07367, -.00605, 1.07602);
    v = m1 * v; vec3 a = v * (v + .0245786) - .000090537, b = v * (.983729 * v + .4329510) + .238081; return clamp(m2 * (a / b), 0., 1.); }
  vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
  float h12(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main(){
    vec3 c = texture2D(uScene, vUv).rgb;
    #ifdef BLOOM
      c = mix(c, texture2D(uBloom, vUv).rgb, uBloomK);
    #endif
    vec2 px = vUv * uRes;
    for (int i = 0; i < 4; i++) { vec4 L = uL[i]; if (L.z <= 0.) continue;
      vec2 d = px - L.xy * uRes; float r = length(d), sz = L.w;
      float halo = sz * sz / (sz * sz + r * r * 24.) * .35 + exp(-r / (sz * .35)) * .5;
      vec3 add = uLC[i] * L.z * halo * .3;
      #ifdef SPIKES
      if (uSpikes > 0.) {
        vec2 q = mat2(.866, .5, -.5, .866) * d;   // tilted cross, like a camera's diaphragm vanes
        float sp = exp(-abs(q.y) / 1.1) * exp(-abs(q.x) / (sz * 1.4)) + exp(-abs(q.x) / 1.1) * exp(-abs(q.y) / (sz * 1.4));
        add += uLC[i] * L.z * sp * uSpikes;
      }
      #endif
      c += add;
    }
    #ifdef FLARE
      if (uL[0].z > 0. && uFlare > 0.) {   // ghosts along the line through the screen centre
        vec2 Lp = uL[0].xy, ax = vec2(.5) - Lp; vec3 f = vec3(0.);
        for (int k = 0; k < 5; k++) { float t = float(k) * .45 + .35; vec2 gp = Lp + ax * t * 2.; float rr = .02 + .035 * fract(float(k) * .618);
          vec2 dd = (vUv - gp) * vec2(uAsp, 1.); float g = smoothstep(rr, rr * .7, length(dd));
          f += g * mix(vec3(.25, .5, 1.), vec3(1., .55, .3), fract(float(k) * .37)) * .05; }
        vec2 dh = (vUv - (vec2(.5) + ax)) * vec2(uAsp, 1.); float ring = exp(-pow((length(dh) - .32) / .012, 2.));
        // (no halo ring: it reads as a drawn line across the sky)
        c += f * uL[0].z * uFlare * uLC[0];
      }
    #endif
    float e = uFixedE > 0. ? uFixedE : texture2D(uExpo, vec2(.5)).r;
    c *= e * uBias;
    float lc = dot(c, vec3(.2126, .7152, .0722)); c = max(vec3(0.), lc + (c - lc) * 1.12);   // ACES desaturates highlights: a touch of colour back
    vec3 o = srgb(aces(c));
    vec2 v = vUv - .5; o *= 1. - uVig * dot(v, v) * 1.3;
    o += (h12(px + fract(uTime)) - .5) / 255.;
    gl_FragColor = vec4(o, 1.);
  }`;

export function createPost(renderer) {
  const gl2 = renderer.capabilities.isWebGL2;
  const half = gl2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
  const TYPE = half ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const mkRT = (w, h, depth = false) => new THREE.WebGLRenderTarget(w, h, { type: TYPE, depthBuffer: depth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const scene = mkRT(4, 4, true);
  const scene1 = new THREE.Scene(), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quad.frustumCulled = false; scene1.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = (fs, uniforms, defines = {}) => new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: fs, uniforms, defines, depthTest: false, depthWrite: false });
  const down = mat(DOWN_FS, { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uKaris: { value: 0 } });
  const up = mat(UP_FS, { uLow: { value: null }, uCur: { value: null }, uTexel: { value: new THREE.Vector2() }, uMix: { value: 1 } });
  const lum = mat(LUM_FS, { uSrc: { value: null } });
  const adapt = mat(ADAPT_FS, { uPrev: { value: null }, uLum: { value: null }, uK: { value: 0.05 }, uKey: { value: 0.18 }, uMin: { value: 0.08 }, uMax: { value: 1.3 }, uReset: { value: 1 } });
  // spikes off by default (they read as lines); post.uniforms.uSpikes.value > 0 re-enables them
  const L = Array.from({ length: 4 }, () => new THREE.Vector4()), LC = Array.from({ length: 4 }, () => new THREE.Vector3(1, 1, 1));
  const comp = mat(COMP_FS, { uScene: { value: scene.texture }, uBloom: { value: null }, uExpo: { value: null }, uBloomK: { value: 0.05 }, uBias: { value: 1 }, uFlare: { value: 1 },
    uTime: { value: 0 }, uAsp: { value: 1 }, uSpikes: { value: 0 }, uFixedE: { value: 0 }, uVig: { value: 0.35 }, uL: { value: L }, uLC: { value: LC }, uRes: { value: new THREE.Vector2() } });
  const lumRT = mkRT(1, 1), expRT = [mkRT(1, 1), mkRT(1, 1)];
  let downs = [], ups = [], tier = 'medium', W = 4, H = 4, ping = 0, reset = true;
  function pass(m, target) { quad.material = m; renderer.setRenderTarget(target); renderer.render(scene1, cam); }
  function build() {
    for (const r of [...downs, ...ups]) r.dispose(); downs = []; ups = [];
    const n = tier === 'ultra' ? 7 : tier === 'high' ? 6 : tier === 'medium' ? 5 : 4;
    let w = Math.max(1, W >> 1), h = Math.max(1, H >> 1);
    for (let i = 0; i < n; i++) { downs.push(mkRT(w, h)); if (tier !== 'low') ups.push(mkRT(w, h)); w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); }
    comp.defines = {}; if (tier !== 'low') { comp.defines.BLOOM = 1; comp.defines.SPIKES = 1; } if (tier === 'high' || tier === 'ultra') comp.defines.FLARE = 1;
    comp.needsUpdate = true;
    const ns = !gl2 ? 0 : tier === 'ultra' ? Math.min(8, renderer.capabilities.maxSamples || 4) : tier === 'high' ? 4 : 0; if (scene.samples !== ns) { scene.dispose(); scene.samples = ns; }
    comp.uniforms.uBloomK.value = tier === 'ultra' ? 0.075 : 0.05;   // ultra: stronger bloom
  }
  const post = {
    hdr: half, target: scene, lights: L, lightColors: LC, uniforms: comp.uniforms, adapt: adapt.uniforms,
    setSize(w, h) { w = Math.max(4, Math.round(w)); h = Math.max(4, Math.round(h)); if (w === W && h === H && downs.length) return; W = w; H = h; scene.setSize(w, h); build(); },
    setTier(t) { if (t === tier && downs.length) return; tier = t; build(); },
    resetExposure() { reset = true; },
    samples: () => scene.samples || 0,
    getExposure: () => post._e,
    begin() { renderer.setRenderTarget(scene); },
    end(dt, time) {
      // downsample chain
      let src = scene.texture, sw = W, sh = H;
      downs.forEach((rt, i) => { down.uniforms.uSrc.value = src; down.uniforms.uTexel.value.set(1 / sw, 1 / sh); down.uniforms.uKaris.value = i === 0 ? 1 : 0; pass(down, rt); src = rt.texture; sw = rt.width; sh = rt.height; });
      // bloom upsample
      if (ups.length) {
        let low = downs[downs.length - 1].texture;
        for (let i = ups.length - 2; i >= 0; i--) { up.uniforms.uLow.value = low; up.uniforms.uCur.value = downs[i].texture; up.uniforms.uTexel.value.set(1 / downs[i + 1].width, 1 / downs[i + 1].height); pass(up, ups[i]); low = ups[i].texture; }
        comp.uniforms.uBloom.value = ups[0].texture;
      }
      // exposure
      lum.uniforms.uSrc.value = downs[Math.min(2, downs.length - 1)].texture; pass(lum, lumRT);
      adapt.uniforms.uPrev.value = expRT[ping].texture; adapt.uniforms.uLum.value = lumRT.texture; adapt.uniforms.uK.value = 1 - Math.exp(-dt * 1.6); adapt.uniforms.uReset.value = reset ? 1 : 0;
      pass(adapt, expRT[1 - ping]); ping = 1 - ping; reset = false;
      comp.uniforms.uExpo.value = expRT[ping].texture; comp.uniforms.uTime.value = time; comp.uniforms.uAsp.value = W / H; comp.uniforms.uRes.value.set(W, H);
      pass(comp, null);
    },
  };
  return post;
}
