// Surface ("landed") view, SE2 realism pass: quadtree-LOD terrain (CPU heightfield with ridged multifractal mountains,
// craters, dunes; skirts; planet curvature), horizon-traced terrain shadows, physically based sky (Rayleigh + Mie single
// scattering into a sky-view LUT – the same model and constants as the orbital atmosphere), aerial perspective,
// sun disc + glare, water / lava seas, normal-lit rocks. Outputs linear HDR (tone-mapped by engine/post.js).
import * as THREE from './vendor/three.module.min.js?v=20261014b';
import { makeNoise, groundTexture } from './textures.js?v=20261014b';

const EYE = 1.7, ROOT = 16384;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const SKY_COMMON = `
uniform vec3 uBR, uBM, uMieCol, uSunCol, uOz; uniform float uTop, uHR, uHM, uG, uSunI, uHas;
vec2 rs(vec3 o, vec3 d, float r){ float b = dot(o, d), c = dot(o, o) - r * r, h = b * b - c; if (h < 0.) return vec2(1e9, -1e9); h = sqrt(h); return vec2(-b - h, -b + h); }
vec3 scatter(vec3 d, vec3 Ls){   // observer just above the ground of a unit planet
  if (uHas < .5) return vec3(0.);
  vec3 o = vec3(0., 1.00002, 0.); float Rt = 1. + uTop;
  vec2 ta = rs(o, d, Rt); vec2 tp = rs(o, d, 1.); float t1 = tp.x > 0. ? tp.x : ta.y;
  float mu = dot(d, Ls), g = uG;
  float pR = .0596831 * (1. + mu * mu), pM = .0795775 * (1. - g * g) / pow(1. + g * g - 2. * g * mu, 1.5);
  const int NV = 32; const int NL = 8;
  vec3 sR = vec3(0.), sM = vec3(0.), sMS = vec3(0.); float odR = 0., odM = 0., tPrev = 0.;
  for (int i = 0; i < NV; i++) {   // quadratic step distribution: dense near the observer, where the air is thick
    float u1 = (float(i) + 1.) / float(NV), tN = t1 * u1 * u1, ds = tN - tPrev, t = (tPrev + tN) * .5; tPrev = tN;
    vec3 x = o + d * t; float h = max(length(x) - 1., 0.);
    float dR = exp(-h / uHR) * ds, dM = exp(-h / uHM) * ds; odR += dR * .5; odM += dM * .5;
    vec2 tl = rs(x, Ls, Rt); vec2 tpl = rs(x, Ls, .99999);
    if (tpl.x <= 0.) {
      float lR = 0., lM = 0., lp = 0.;
      for (int j = 0; j < NL; j++) { float v1 = (float(j) + 1.) / float(NL), lN = tl.y * v1 * v1, dl = lN - lp, lt = (lp + lN) * .5; lp = lN;
        float hh = max(length(x + Ls * lt) - 1., 0.); lR += exp(-hh / uHR) * dl; lM += exp(-hh / uHM) * dl; }
      vec3 att = exp(-((uBR + uOz) * (odR + lR) + uBM * 1.1 * (odM + lM))); sR += att * dR; sM += att * dM;
    }
    // cheap multiple-scattering term: isotropic skylight re-scattered along the view ray (keeps twilight zeniths blue)
    vec3 av = exp(-((uBR + uOz) * odR + uBM * 1.1 * odM)); float msk = .09 * smoothstep(-.12, .25, dot(normalize(x), Ls)); sMS += av * dR * msk;
    odR += dR * .5; odM += dM * .5;
  }
  return uSunCol * uSunI * (sR * uBR * pR + sM * uBM * uMieCol * pM + sMS * uBR);
}`;
const LUT_FS = SKY_COMMON + `uniform vec3 uSun; varying vec2 vUv;
void main(){ float az = (vUv.x - .5) * 6.2831853, el = vUv.y * vUv.y * 1.5707963;
  vec3 d = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az)); gl_FragColor = vec4(scatter(d, uSun), 1.); }`;
const SKYFN = `uniform sampler2D uSky;
vec3 skyL(vec3 d){ float az = atan(d.z, d.x) / 6.2831853 + .5; float v = sqrt(clamp(asin(clamp(d.y, -1., 1.)) / 1.5707963, 0., 1.)); return texture2D(uSky, vec2(az, v)).rgb; }`;

export function createSurface(opts = {}) {
  const renderer = opts.renderer;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 90000);
  const sunDir = new THREE.Vector3(0.55, 0.42, -0.72).normalize();
  let quality = opts.quality || 'medium', SEG = 24;
  const half = renderer && renderer.capabilities.isWebGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));

  // ---------- sky-view LUT (azimuth x elevation, sqrt-mapped toward the horizon) ----------
  const lutRT = new THREE.WebGLRenderTarget(128, 64, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: false, wrapS: THREE.RepeatWrapping, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const atmoU = { uBR: { value: new THREE.Vector3() }, uBM: { value: new THREE.Vector3() }, uMieCol: { value: new THREE.Vector3(1, 1, 1) }, uOz: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Vector3(1, 1, 1) },
    uTop: { value: 0.03 }, uHR: { value: 0.004 }, uHM: { value: 0.0012 }, uG: { value: 0.76 }, uSunI: { value: 4 }, uHas: { value: 0 }, uSun: { value: sunDir } };
  const lutMat = new THREE.ShaderMaterial({ uniforms: atmoU, vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`, fragmentShader: LUT_FS, depthTest: false, depthWrite: false });
  const lutScene = new THREE.Scene(), lutQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lutMat); lutQuad.frustumCulled = false; lutScene.add(lutQuad);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const shared = { uSky: { value: lutRT.texture }, uSunDir: { value: sunDir }, uSunCol: { value: new THREE.Vector3(1, 1, 1) }, uSkyAmb: { value: new THREE.Vector3() }, uExt: { value: new THREE.Vector3() },
    uCamW: { value: new THREE.Vector3() }, uCurv: { value: 0 }, uTime: { value: 0 } };

  // ---------- sky dome: LUT + sun disc ----------
  const skyU = { ...shared, uSunAng: { value: 0.0046 }, uDisc: { value: new THREE.Vector3(1, 1, 1) }, uHasAtmo: { value: 1 } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(80000, 48, 24), new THREE.ShaderMaterial({
    uniforms: skyU, side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: SKYFN + `uniform vec3 uSunDir, uDisc; uniform float uSunAng; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); vec3 c = skyL(vec3(d.x, max(d.y, .002), d.z));
        float a = acos(clamp(dot(d, uSunDir), -1., 1.)), x = a / uSunAng;
        if (x < 1.) { float mu = sqrt(1. - x * x); c += uDisc * (1. - .6 * (1. - mu)); }
        c += uDisc * .002 * exp(-a * 60.) ;
        gl_FragColor = vec4(c, 1.); }`,
  }));
  sky.renderOrder = -3; sky.frustumCulled = false; scene.add(sky);

  // ---------- stars (visible when the sky is dark) ----------
  const sg = new THREE.BufferGeometry(), sp = [], sc = [];
  let s = 7; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 3000; i++) { const u = r() * 2 - 1, t = r() * 6.283, q = Math.sqrt(1 - u * u); sp.push(q * Math.cos(t) * 70000, Math.abs(u) * 70000, q * Math.sin(t) * 70000); const b = Math.pow(r(), 6) * 2 + 0.05; const w = r(); sc.push(b * (0.8 + w * 0.2), b * 0.9, b * (1.1 - w * 0.3)); }
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
  const starMat = new THREE.ShaderMaterial({ uniforms: { uVis: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec3 color; varying vec3 vC; void main(){ vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_PointSize = 2.; }`,
    fragmentShader: `uniform float uVis; varying vec3 vC; void main(){ float r = length(gl_PointCoord - .5) * 2.; gl_FragColor = vec4(vC * uVis * (1. - r * r) * .25, 1.); }` });
  const stars = new THREE.Points(sg, starMat); stars.renderOrder = -2; stars.frustumCulled = false; scene.add(stars);

  // ---------- parent planet / moon in the sky ----------
  const sunLight = new THREE.DirectionalLight(0xffffff, Math.PI); sunLight.position.copy(sunDir); scene.add(sunLight, sunLight.target);
  const hemi = new THREE.HemisphereLight(0x000000, 0x000000, Math.PI); scene.add(hemi);
  const skyBody = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), new THREE.MeshLambertMaterial({ fog: false, transparent: true }));
  skyBody.renderOrder = -1; scene.add(skyBody);
  const skyRing = new THREE.Mesh(new THREE.RingGeometry(1.24, 2.27, 96, 1), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, transparent: true, fog: false, depthWrite: false }));
  { const p = skyRing.geometry.attributes.position, uv = skyRing.geometry.attributes.uv, v = new THREE.Vector3();
    for (let k = 0; k < p.count; k++) { v.fromBufferAttribute(p, k); uv.setXY(k, (v.length() - 1.24) / 1.03, 0.5); } }
  skyRing.rotation.x = -Math.PI / 2 + 0.35; skyBody.add(skyRing);

  // ---------- terrain material ----------
  const detail = groundTexture(0xffffff, 0x777777, 5); detail.colorSpace = THREE.NoColorSpace;
  const terrU = { ...shared, uDetail: { value: detail }, uGA: { value: new THREE.Color() }, uGB: { value: new THREE.Color() }, uRock: { value: new THREE.Color() }, uVeg: { value: new THREE.Color() },
    uSeaLevel: { value: -1e6 }, uSnowLine: { value: 1e6 }, uVegAmt: { value: 0 }, uAmbK: { value: 1 }, uGlow: { value: new THREE.Vector3() } };
  const terrMat = new THREE.ShaderMaterial({ uniforms: terrU,
    vertexShader: `attribute float aShadow; uniform vec3 uCamW; uniform float uCurv; varying vec3 vWp, vN; varying float vSh, vH;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.); vH = w.y; vec2 d = w.xz - uCamW.xz; w.y -= dot(d, d) * uCurv; vWp = w.xyz; vN = normal; vSh = aShadow; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: SKYFN + `uniform sampler2D uDetail; uniform vec3 uGA, uGB, uRock, uVeg, uSunDir, uSunCol, uSkyAmb, uExt, uCamW; uniform float uSeaLevel, uSnowLine, uVegAmt, uAmbK; uniform vec3 uGlow;
      varying vec3 vWp, vN; varying float vSh, vH;
      void main(){
        vec3 N = normalize(vN); float slope = 1. - N.y; float dist = length(vWp - uCamW);
        float d1 = texture2D(uDetail, vWp.xz / 9.).r, d2 = texture2D(uDetail, vWp.xz / 83.).r, d3 = texture2D(uDetail, vWp.xz / 761.).r;
        float fade = smoothstep(400., 60., dist);
        float dt = mix(.5, d1, fade) * .5 + d2 * .3 + d3 * .4;
        vec3 alb = mix(uGB, uGA, smoothstep(.35, .75, dt));
        alb = mix(alb, uVeg * (.7 + .6 * d2), uVegAmt * (1. - smoothstep(.18, .4, slope)) * smoothstep(uSnowLine - 100., uSnowLine - 900., vH) * smoothstep(uSeaLevel + 2., uSeaLevel + 10., vH) * smoothstep(.3, .6, d3 + d2 * .3));
        alb = mix(alb, uRock * (.6 + .7 * dt), smoothstep(.32, .6, slope + (d2 - .5) * .2));
        alb = mix(alb, vec3(.8, .74, .6), smoothstep(uSeaLevel + 5., uSeaLevel + 1., vH) * (1. - smoothstep(.3, .5, slope)));
        float snow = smoothstep(uSnowLine - 60., uSnowLine + 60., vH + (d2 - .5) * 300.) * (1. - smoothstep(.45, .7, slope));
        alb = mix(alb, vec3(.85, .88, .92), snow);
        { // per-pixel detail bump (matches the detail texture), screen-space derivatives
          float hb = d2 * 1.6 + d3 * 9.; vec3 dpx = dFdx(vWp), dpy = dFdy(vWp); float dhx = dFdx(hb), dhy = dFdy(hb);
          vec3 r1 = cross(dpy, N), r2 = cross(N, dpx); float det = dot(dpx, r1);
          if (abs(det) > 1e-8) N = normalize(abs(det) * N - sign(det) * (dhx * r1 + dhy * r2)); }
        float NdL = max(dot(N, uSunDir), 0.);
        vec3 lit = uSunCol * NdL * vSh + uSkyAmb * uAmbK * (.55 + .45 * N.y) * (.6 + .4 * vSh) + vec3(.0006) + uGlow * (.7 + .3 * (1. - N.y));   // uGlow: lava light
        vec3 c = alb * lit;
        vec3 T = exp(-uExt * dist); vec3 V = normalize(vWp - uCamW);
        c = c * T + skyL(vec3(V.x, max(V.y, .003), V.z)) * (1. - T);
        gl_FragColor = vec4(c, 1.); }` });
  const terrain = new THREE.Group(); scene.add(terrain);

  // ---------- sea (water or lava) ----------
  const seaU = { ...shared, uCol: { value: new THREE.Color() }, uLava: { value: 0 } };
  const sea = new THREE.Mesh(new THREE.CircleGeometry(60000, 96, 0, Math.PI * 2).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ uniforms: seaU,
    vertexShader: `uniform vec3 uCamW; uniform float uCurv; varying vec3 vWp; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vec2 d = w.xz - uCamW.xz; w.y -= dot(d, d) * uCurv; vWp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: SKYFN + `uniform vec3 uCol, uSunDir, uSunCol, uExt, uCamW; uniform float uLava, uTime; varying vec3 vWp;
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        vec3 V = normalize(uCamW - vWp); float dist = length(vWp - uCamW); vec2 p = vWp.xz;
        vec3 c;
        if (uLava > .5) {
          // smooth molten surface: broad slow cells, fine detail fades with distance (no speckle), soft crust edges
          float fine = 1. / (1. + dist / 60.);
          float n = vn2(p / 18. + uTime * .04) * .6 + vn2(p / 6. - uTime * .06) * .4 * fine + .2 * (1. - fine), k = abs(vn2(p / 30. + 3.) - .5);
          float crust = smoothstep(.06, .22, k) * smoothstep(.45, .8, n) * .85;
          vec3 hot = mix(vec3(1., .25, .03), vec3(1., .62, .22), n) * (4. + 1.2 * sin(uTime * .8 + n * 6.));
          c = mix(hot, uCol * .05 * (uSunCol * max(uSunDir.y, 0.) + .1) + hot * .04, crust);
        } else {
          float fall = 1. / (1. + dist / 150.); vec2 g = vec2(0.);
          for (int i = 0; i < 4; i++) { float fi = float(i); vec2 dir = vec2(cos(fi * 1.7 + .3), sin(fi * 1.7 + .3)); float k = 6.2831 / (3. + fi * 7.); float ph = dot(dir, p) * k + uTime * sqrt(9.8 * k);
            g += dir * cos(ph) * .35 / (1. + fi); }
          vec3 N = normalize(vec3(-g.x * fall, 1., -g.y * fall));
          float F = .02 + .98 * pow(1. - max(dot(N, V), 0.), 5.);
          vec3 R = reflect(-V, N); vec3 refl = skyL(vec3(R.x, max(R.y, .01), R.z));
          vec3 H = normalize(uSunDir + V); float a = .03 + .2 * (1. - fall); float nh = max(dot(N, H), 0.), dd = nh * nh * (a * a - 1.) + 1.;
          float spec = a * a / (3.14159 * dd * dd) * F * .25 * step(0., uSunDir.y);
          vec3 body = uCol * .06 * (uSunCol * max(uSunDir.y, 0.) + skyL(vec3(0., 1., 0.)) * 2.);
          c = mix(body, refl, F) + uSunCol * spec;
        }
        vec3 T = exp(-uExt * dist); c = c * T + skyL(vec3(-V.x, max(-V.y, .003), -V.z)) * (1. - T);
        gl_FragColor = vec4(c, 1.); }` }));
  sea.visible = false; sea.frustumCulled = false; scene.add(sea);

  // ---------- rocks (displaced icosahedra, flat-shaded normals, PBR) ----------
  const rockGeo = (() => { const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position, v = new THREE.Vector3(), n = makeNoise(99);
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 1 + 0.35 * n(v.x * 1.3, v.y * 1.3, v.z * 1.3) + 0.12 * n(v.x * 4, v.y * 4, v.z * 4); v.multiplyScalar(k); v.y *= 0.65; p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals(); return g; })();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, flatShading: true });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 361); rocks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(361 * 3), 3); scene.add(rocks);

  // ---------- height field ----------
  let N1 = makeNoise(1), N2 = makeNoise(2), N3 = makeNoise(3), spec = null, crK = 0, duneK = 0, R = 1, RID = 0.5;
  const f2 = (n, x, z, o, y = 0.5) => { let a = 1, f = 1, s = 0, t = 0; for (let i = 0; i < o; i++) { s += a * n(x * f, y + i * 1.7, z * f); t += a; a *= 0.5; f *= 2.03; } return s / t; };
  const hsh = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
  function craters(x, z, cell) {
    const ix = Math.floor(x / cell), iz = Math.floor(z / cell); let h = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const cx = ix + i, cz = iz + j, a = hsh(cx, cz); if (a > 0.6) continue;
      const px = (cx + 0.2 + 0.6 * hsh(cz, cx + 7)) * cell, pz = (cz + 0.2 + 0.6 * hsh(cx + 3, cz)) * cell, rad = cell * (0.12 + 0.3 * hsh(cx + 9, cz + 1) ** 2);
      const d = Math.hypot(x - px, z - pz) / rad; if (d > 1.6) continue;
      h += ((d < 1 ? d * d - 1 : 0) * 0.45 + Math.exp(-(d - 1) * (d - 1) * 14) * 0.12) * rad;
    }
    return h;
  }
  function hLow(x, z) {
    const c = f2(N1, x / 9000, z / 9000, 4);
    const wx = x + 1500 * N2(x / 7000, 0.3, z / 7000), wz = z + 1500 * N2(x / 7000, 5.1, z / 7000);
    let m = 0, a = 1, f = 1 / 3000, w = 1, t = 0;
    for (let i = 0; i < 6; i++) { let rr = 1 - Math.abs(N3(wx * f, 1.7 + i, wz * f)); rr *= rr; m += rr * a * w; t += a; w = clamp(rr * 1.8, 0, 1); a *= 0.5; f *= 2.1; }
    m /= t;
    const mask = sm(-0.15, 0.35, c + 0.25 * RID);
    let h = (c * 380 + m * mask * 1500 * RID + f2(N2, x / 700, z / 700, 3) * 80) * R;
    if (crK) h += (craters(x, z, 1400) + craters(x, z, 380) * 0.8) * crK;
    if (duneK) { const ph = (x * 0.8 + z * 0.6) / 95 + 3 * N1(x / 600, 9.1, z / 600); h += Math.pow(1 - Math.abs(Math.sin(ph)), 1.6) * 16 * duneK * sm(150, -50, h); }
    return h;
  }
  const hDet = (x, z) => (f2(N1, x / 60, z / 60, 3) * 5 + N3(x / 9, 4.4, z / 9) * 0.7) * R * (crK ? 0.6 : 1) + (crK ? craters(x, z, 70) * crK * 0.7 : 0);
  const height = (x, z) => hLow(x, z) + hDet(x, z);

  // ---------- quadtree tiles ----------
  const tiles = new Map(); let queue = [], lru = 0;
  function buildTile(level, ix, iz) {
    const size = ROOT / 2 ** level, x0 = ix * size, z0 = iz * size, S = SEG, st = size / S, W = S + 3;
    // H: full height (geometry); HL: large-scale relief only, used for normals so that every LOD level shades alike
    // (small-scale detail is added back per pixel by the detail bump in the shader; fine tiles add the detail normals)
    const H = new Float32Array(W * W), HL = new Float32Array(W * W), detW = 0;   // detail normals come from the per-pixel bump instead (identical at every LOD)
    for (let i = 0; i < W; i++) for (let j = 0; j < W; j++) { const x = x0 + (j - 1) * st, z = z0 + (i - 1) * st, hl = hLow(x, z), hd = hDet(x, z); H[i * W + j] = hl + hd; HL[i * W + j] = hl + hd * detW; }
    // horizon-traced shadow on a half-resolution grid
    const S2 = S / 2, W2 = S2 + 1, SH = new Float32Array(W2 * W2), el = Math.max(Math.asin(sunDir.y), -0.2), tanE = Math.tan(el), hx = sunDir.x, hz = sunDir.z, hl = Math.hypot(hx, hz) || 1;
    for (let i = 0; i < W2; i++) for (let j = 0; j < W2; j++) {
      const x = x0 + j * 2 * st, z = z0 + i * 2 * st, h0 = H[(i * 2 + 1) * W + j * 2 + 1] + 1;
      if (el <= -0.02) { SH[i * W2 + j] = 0; continue; }
      let minK = 1;
      for (let k = 0, d = Math.max(6, st * 1.5); k < 9; k++, d *= 1.75) { const hh = hLow(x + hx / hl * d, z + hz / hl * d); const diff = h0 + d * tanE - hh; minK = Math.min(minK, diff / (d * 0.035 + 2)); }
      SH[i * W2 + j] = sm(-0.4, 0.6, minK) * sm(-0.02, 0.05, el);
    }
    const sh = (gi, gj) => { const fi = gi / 2, fj = gj / 2, i0 = Math.min(Math.floor(fi), S2 - 1), j0 = Math.min(Math.floor(fj), S2 - 1), ti = fi - i0, tj = fj - j0;
      return (SH[i0 * W2 + j0] * (1 - tj) + SH[i0 * W2 + j0 + 1] * tj) * (1 - ti) + (SH[(i0 + 1) * W2 + j0] * (1 - tj) + SH[(i0 + 1) * W2 + j0 + 1] * tj) * ti; };
    const V = S + 3, pos = new Float32Array(V * V * 3), nor = new Float32Array(V * V * 3), shd = new Float32Array(V * V), skirt = size * 0.02 + 2;
    for (let i = 0; i < V; i++) for (let j = 0; j < V; j++) {
      const gi = clamp(i - 1, 0, S), gj = clamp(j - 1, 0, S), edge = i === 0 || j === 0 || i === V - 1 || j === V - 1, k = i * V + j;
      const hc = H[(gi + 1) * W + gj + 1];
      pos[k * 3] = gj * st - size / 2; pos[k * 3 + 1] = hc - (edge ? skirt : 0); pos[k * 3 + 2] = gi * st - size / 2;
      const dx = HL[(gi + 1) * W + gj + 2] - HL[(gi + 1) * W + gj], dz = HL[(gi + 2) * W + gj + 1] - HL[gi * W + gj + 1];
      const nx = -dx, ny = 2 * st, nz = -dz, nl = Math.hypot(nx, ny, nz); nor[k * 3] = nx / nl; nor[k * 3 + 1] = ny / nl; nor[k * 3 + 2] = nz / nl;
      shd[k] = sh(gi, gj);
    }
    const idx = []; for (let i = 0; i < V - 1; i++) for (let j = 0; j < V - 1; j++) { const a = i * V + j, b = a + 1, c = a + V, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('aShadow', new THREE.BufferAttribute(shd, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, terrMat); m.position.set(x0 + size / 2, 0, z0 + size / 2); m.visible = false; terrain.add(m);
    return m;
  }
  const key = (l, i, j) => l + ':' + i + ':' + j;
  function tile(l, i, j, gen) {
    const k = key(l, i, j); let t = tiles.get(k);
    if (t) { t.used = lru; return t.mesh; }
    if (gen) { t = { mesh: buildTile(l, i, j), used: lru }; tiles.set(k, t); return t.mesh; }
    queue.push([l, i, j]); return null;
  }
  const MAXL = 8;   // 16384 m -> 64 m tiles
  function selectTiles(cam, budgetMs) {
    lru++; queue = []; const draw = [];
    const cx = Math.floor(cam.x / ROOT), cz = Math.floor(cam.z / ROOT);
    const alt = Math.max(0, cam.y - hLowCache);
    const visit = (l, i, j) => {
      const size = ROOT / 2 ** l, mx = (i + 0.5) * size, mz = (j + 0.5) * size;
      { const t = tiles.get(key(l, i, j)); if (t) t.used = lru; }   // keep every visited ancestor alive: an evicted parent left black holes when its kids changed
      const dx = Math.max(Math.abs(cam.x - mx) - size / 2, 0), dz = Math.max(Math.abs(cam.z - mz) - size / 2, 0), d = Math.hypot(dx, dz, alt * 0.7);
      const want = l < MAXL && d < size * 1.25;
      if (want) {
        const kids = [[2 * i, 2 * j], [2 * i + 1, 2 * j], [2 * i, 2 * j + 1], [2 * i + 1, 2 * j + 1]];
        if (kids.every(([a, b]) => tiles.has(key(l + 1, a, b)))) { kids.forEach(([a, b]) => visit(l + 1, a, b)); return; }
        kids.forEach(([a, b]) => queue.push([l + 1, a, b, d]));
      }
      let m = tile(l, i, j, l === 0);
      if (!m) { queue.pop(); m = tile(l, i, j, true); }   // never leave a hole: build the missing fallback tile right now
      if (m) draw.push(m);
    };
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) visit(0, cx + a, cz + b);
    for (const t of tiles.values()) t.mesh.visible = false;
    for (const m of draw) m.visible = true;
    // build queued tiles (coarse / near first) within the time budget
    queue.sort((p, q) => p[0] - q[0] || (p[3] || 0) - (q[3] || 0));
    const t0 = performance.now();
    for (const [l, i, j] of queue) { if (performance.now() - t0 > budgetMs) break; if (!tiles.has(key(l, i, j))) tile(l, i, j, true); }
    if (tiles.size > 260) { const old = [...tiles.entries()].filter(([, t]) => t.used < lru - 2).sort((p, q) => p[1].used - q[1].used).slice(0, tiles.size - 220);
      for (const [k, t] of old) { t.mesh.geometry.dispose(); t.mesh.removeFromParent(); tiles.delete(k); } }
  }
  function clearTiles() { for (const t of tiles.values()) { t.mesh.geometry.dispose(); t.mesh.removeFromParent(); } tiles.clear(); }
  let hLowCache = 0;

  // ---------- rocks scatter ----------
  const rockCenter = new THREE.Vector2(1e9, 1e9);
  function scatterRocks(cx, cz) {
    rockCenter.set(cx, cz);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), scl = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color();
    // each rock belongs to a fixed 29 m world cell (seeded by the cell), so rocks stay put when the set is re-centred
    const CELL = 29, N = 9, c0x = Math.floor(cx / CELL), c0z = Math.floor(cz / CELL); let rs = 0;
    const rr = () => ((rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296);
    const sea = spec.water || spec.lava;
    for (let i = 0; i < rocks.count; i++) {
      const gx = c0x + (i % (2 * N + 1)) - N, gz = c0z + Math.floor(i / (2 * N + 1)) - N;
      if (gz > c0z + N) { m.makeScale(0, 0, 0); rocks.setMatrixAt(i, m); continue; }
      rs = (Math.imul(gx, 73856093) ^ Math.imul(gz, 19349663) ^ (spec.seed || 1)) >>> 0; rr(); rr();
      const x = (gx + rr()) * CELL, z = (gz + rr()) * CELL, size = (0.15 + Math.pow(rr(), 5) * 4) * spec.rocks;
      const h = height(x, z);
      if (sea && h < sea.level + 0.5) { m.makeScale(0, 0, 0); rocks.setMatrixAt(i, m); continue; }
      ps.set(x, h + size * 0.15, z); q.setFromEuler(e.set(rr() * 0.6, rr() * 6.3, rr() * 0.6)); scl.set(size * (0.8 + rr() * 0.8), size, size * (0.8 + rr() * 0.8));
      rocks.setMatrixAt(i, m.compose(ps, q, scl));
      // terrain shadow at the rock (quick horizon test)
      const el = Math.asin(clamp(sunDir.y, -1, 1)); let lit = el > 0 ? 1 : 0; const hl = Math.hypot(sunDir.x, sunDir.z) || 1;
      if (lit) for (let k = 0, d = 8; k < 7; k++, d *= 1.9) if (hLow(x + sunDir.x / hl * d, z + sunDir.z / hl * d) > h + d * Math.tan(el) + 2) { lit = 0.15; break; }
      col.setRGB(lit, lit, lit); rocks.setColorAt(i, col);
    }
    rocks.instanceMatrix.needsUpdate = true; rocks.instanceColor.needsUpdate = true;
  }

  // ---------- atmosphere / lighting setup ----------
  const sunCol = new THREE.Vector3(1, 1, 1), tmpV = new THREE.Vector3();
  let skyLum = 0;
  function airmass(mu) { const m = clamp(mu, -0.2, 1); return Math.min(40, 1 / (Math.max(m, 0) + 0.50572 * Math.pow(Math.max(96.07995 - Math.acos(m) * 180 / Math.PI, 0.5), -1.6364))); }
  function setupLight() {
    const A = spec.atmo, sc = spec.sunColor || [1, 1, 1], E = spec.sunLight ?? 1;
    const el = sunDir.y, am = airmass(el);
    const tr = A ? A.tau.map(t => Math.exp(-t * am)) : [1, 1, 1];
    const horizon = el > -0.01 ? sm(-0.02, 0.03, el) : 0;
    sunCol.set(sc[0] * tr[0] * E * horizon, sc[1] * tr[1] * E * horizon, sc[2] * tr[2] * E * horizon);
    shared.uSunCol.value.copy(sunCol);
    atmoU.uHas.value = A ? 1 : 0;
    if (A) {
      atmoU.uBR.value.set(...A.betaR); atmoU.uOz.value.set(...(A.betaO || [0, 0, 0])); atmoU.uBM.value.setScalar(A.betaM); atmoU.uMieCol.value.set(...A.mc); atmoU.uTop.value = A.top; atmoU.uHR.value = A.HR; atmoU.uHM.value = A.HM; atmoU.uG.value = A.g;
      atmoU.uSunCol.value.set(sc[0] * E, sc[1] * E, sc[2] * E);
      // ground-level extinction per metre (scale heights are exaggerated ~3x, so haze is boosted to match)
      const Rm = spec.radiusM || 6.371e6, hz = 2.2;
      shared.uExt.value.set(...A.betaR.map((b, i) => (b + A.betaM * 1.1) / Rm * hz));
    } else shared.uExt.value.set(0, 0, 0);
    if (renderer) { const prev = renderer.getRenderTarget(); renderer.setRenderTarget(lutRT); renderer.render(lutScene, ortho); renderer.setRenderTarget(prev); }
    // sky irradiance for the ambient term ~ average sky radiance; estimate from the scattering optical depth
    const skyK = A ? (A.tauR[2] * 1.6 + A.tauM * 0.6) : 0;
    const skyTint = A ? [A.tauR[0] / A.tauR[2] * 0.7 + A.tauM * A.mc[0] * 0.3, A.tauR[1] / A.tauR[2] * 0.8 + A.tauM * A.mc[1] * 0.3, 1 * 0.9 + A.tauM * A.mc[2] * 0.3] : [0, 0, 0];
    const day = sm(-0.14, 0.1, el) * (0.55 + 0.45 * sm(0.02, 0.3, el));
    // low sun: the sky around the horizon turns warm, so the ambient light picks up the transmitted sun colour
    const warm = 1 - sm(0.04, 0.35, el), trm = Math.max(tr[0], tr[1], tr[2], 1e-4), tn = tr.map(t => t / trm);
    shared.uSkyAmb.value.set(...skyTint.map((t, i) => (t * (1 - warm * 0.6) + tn[i] * warm * 0.6) * skyK * day * (sc[i] * E) * 1.5));
    skyLum = (shared.uSkyAmb.value.x + shared.uSkyAmb.value.y + shared.uSkyAmb.value.z) / 3;
    starMat.uniforms.uVis.value = clamp(1 - skyLum * 25, 0, 1);
    // sun disc
    const ang = Math.max(0.0012, spec.sunAngle || 0.0046);
    skyU.uSunAng.value = ang; skyU.uDisc.value.copy(sunCol).multiplyScalar(spec.sunAngle > 0 ? 60 : 0);
    sunLight.color.setRGB(sunCol.x, sunCol.y, sunCol.z); sunLight.intensity = Math.PI; sunLight.position.copy(sunDir);
    const amb = shared.uSkyAmb.value; hemi.color.setRGB(amb.x, amb.y, amb.z); hemi.groundColor.setRGB(amb.x * 0.3, amb.y * 0.3, amb.z * 0.3);
    scene.fog = A ? new THREE.FogExp2(new THREE.Color(0, 0, 0), 0) : null;
    if (A) { const e = shared.uExt.value; scene.fog.density = (e.x + e.y + e.z) / 3 * 0.7; }
  }

  const state = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, hover: 0, vel: new THREE.Vector3() };
  function setSunDir(elevDeg, azDeg) {
    const e = elevDeg * Math.PI / 180, a = azDeg * Math.PI / 180;
    sunDir.set(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)).normalize();
  }
  function enter(sp) {
    spec = Object.assign({ ridges: 0.5, rocks: 1, rough: 1, sunAngle: 0.0046, skyBody: null, sunElev: 30, sunAz: -40 }, sp);
    N1 = makeNoise((sp.seed || 1) >>> 0); N2 = makeNoise(((sp.seed || 1) * 7 + 3) >>> 0); N3 = makeNoise(((sp.seed || 1) * 13 + 5) >>> 0);
    R = spec.rough; RID = spec.ridges; crK = spec.craters || 0; duneK = spec.dunes || 0;
    setSunDir(spec.sunElev, spec.sunAz);
    terrU.uGA.value.set(spec.ground[0]); terrU.uGB.value.set(spec.ground[1]);
    terrU.uRock.value.set(spec.rock ?? spec.ground[1]).multiplyScalar(0.8);
    terrU.uVeg.value.set(spec.veg ?? 0x3a5a28); terrU.uVegAmt.value = spec.veg ? 0.85 : 0;
    terrU.uSnowLine.value = Math.max(-1e6, Math.min(1e6, spec.snowLine ?? 1e6)); terrU.uAmbK.value = 1; terrU.uGlow.value.set(spec.lava ? 0.09 : 0, spec.lava ? 0.026 : 0, spec.lava ? 0.007 : 0);
    rockMat.color.set(spec.rock ?? spec.ground[1]).lerp(new THREE.Color(spec.ground[0]), 0.3);
    shared.uCurv.value = 1 / (2 * (spec.radiusM || 6.371e6));
    const liquid = spec.water || spec.lava;
    sea.visible = !!liquid; terrU.uSeaLevel.value = liquid ? liquid.level : -1e6;   // (not -1e9: float32 would collapse the beach smoothstep edges)
    if (liquid) { sea.position.y = liquid.level; seaU.uCol.value.set(liquid.color); seaU.uLava.value = spec.lava ? 1 : 0; }
    clearTiles();
    state.pos.set(0, 0, 0); state.hover = 0; state.vel.set(0, 0, 0);
    if (liquid) {   // spiral search for dry land near the landing point
      for (let k = 0; k < 600; k++) { const a = k * 2.4, rr = k * 25; const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        if (height(x, z) > liquid.level + 4) { state.pos.set(x, 0, z); break; } }
    }
    setupLight();
    // sky body
    const sb = spec.skyBody; skyBody.visible = !!sb;
    if (sb) {
      const R2 = 60000 * Math.tan(sb.ang * Math.PI / 360);
      skyBody.scale.setScalar(R2);
      skyBody.material.map = sb.map || null; skyBody.material.color.set(sb.map ? 0xffffff : (sb.color ?? 0xcccccc));
      skyBody.material.opacity = spec.atmo ? clamp(1 - (spec.atmo.tauM * 0.4), 0.15, 1) : 1; skyBody.material.needsUpdate = true;
      skyBody.rotation.set(0, 0, sb.tilt || 0);
      skyRing.visible = !!sb.ringMap; skyRing.material.map = sb.ringMap || null; skyRing.material.opacity = skyBody.material.opacity; skyRing.material.needsUpdate = true;
    }
    // face the sun / sky body, preferring an open view (avoid staring into a hillside)
    const look = sb ? new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - (sb.elev ?? 0.5), sb.azim ?? -0.6) : sunDir.clone();
    const yaw0 = Math.atan2(-look.x, -look.z) + 0.25;
    { const px = state.pos.x, pz = state.pos.z, h0 = height(px, pz); let best = -1e9, by = yaw0;
      for (let k = 0; k < 24; k++) { const yw = yaw0 + (k / 24) * Math.PI * 2, fx = -Math.sin(yw), fz = -Math.cos(yw); let worst = -1e9;
        for (const d of [25, 60, 140, 300, 700]) worst = Math.max(worst, (height(px + fx * d, pz + fz * d) - h0) / d);
        const scr = -worst * 6 + 0.5 * Math.cos(yw - yaw0); if (scr > best) { best = scr; by = yw; } }
      state.yaw = by; }
    state.pitch = 0.06;
    hLowCache = height(state.pos.x, state.pos.z);
    camera.position.set(state.pos.x, hLowCache + EYE + 160, state.pos.z);
    selectTiles(camera.position, 400);
    scatterRocks(Math.round(state.pos.x / 20) * 20, Math.round(state.pos.z / 20) * 20);
  }
  const fwd = new THREE.Vector3(), right = new THREE.Vector3();
  let budget = 6;
  // input: x strafe, y hover up/down, z forward (each -1..1)
  function update(dt, input, alt = null, pitchOverride = null) {
    if (!spec) return;
    shared.uTime.value += dt;
    fwd.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw)); right.set(-fwd.z, 0, fwd.x);
    const speed = 6 + state.hover * 0.6;
    const target = new THREE.Vector3().addScaledVector(fwd, input.z * speed).addScaledVector(right, input.x * speed);
    state.vel.lerp(target, 1 - Math.exp(-dt * 6));
    state.pos.addScaledVector(state.vel, dt);
    state.hover = Math.min(3000, Math.max(0, state.hover + input.y * (12 + state.hover * 0.8) * dt));
    if (Math.abs(state.pos.x - rockCenter.x) > 160 || Math.abs(state.pos.z - rockCenter.y) > 160) scatterRocks(Math.round(state.pos.x / 20) * 20, Math.round(state.pos.z / 20) * 20);
    let g = height(state.pos.x, state.pos.z); hLowCache = g;
    if (sea.visible) { g = Math.max(g, sea.position.y + 0.3); sea.position.x = state.pos.x; sea.position.z = state.pos.z; }
    camera.position.set(state.pos.x, g + EYE + (alt ?? state.hover), state.pos.z);
    camera.quaternion.setFromEuler(new THREE.Euler(pitchOverride ?? state.pitch, state.yaw, 0, 'YXZ'));
    camera.updateMatrixWorld();
    shared.uCamW.value.copy(camera.position);
    sky.position.copy(camera.position); stars.position.copy(camera.position);
    if (spec.skyBody) skyBody.position.setFromSphericalCoords(60000, Math.PI / 2 - (spec.skyBody.elev ?? 0.5), spec.skyBody.azim ?? -0.6).add(camera.position);
    skyBody.rotation.y += dt * 0.02;
    selectTiles(camera.position, budget);
  }
  function look(dx, dy) { state.yaw -= dx * 0.004; state.pitch = Math.min(1.4, Math.max(-1.2, state.pitch - dy * 0.004)); }
  // sun for glare: direction in camera space + visibility (terrain occlusion, horizon) + brightness
  function sunInfo() {
    if (!spec || !(spec.sunAngle > 0)) return null;
    const el = Math.asin(clamp(sunDir.y, -1, 1)); if (el < -0.01) return null;
    const hl = Math.hypot(sunDir.x, sunDir.z) || 1; let vis = 1;
    for (let k = 0, d = 10; k < 10; k++, d *= 1.8) { const hh = hLow(camera.position.x + sunDir.x / hl * d, camera.position.z + sunDir.z / hl * d) - d * d * shared.uCurv.value; const ray = camera.position.y + d * Math.tan(el); if (hh > ray) { vis = 0; break; } }
    if (sea.visible && el < 0.002) vis = 0;
    return { dir: sunDir.clone(), vis, color: sunCol.clone(), elev: el };
  }
  function setSun(elevDeg, azDeg) { if (!spec) return false; spec.sunElev = elevDeg; if (azDeg != null) spec.sunAz = azDeg; setSunDir(spec.sunElev, spec.sunAz); setupLight(); clearTiles(); selectTiles(camera.position, 300); scatterRocks(rockCenter.x, rockCenter.y); return true; }
  function setQuality(q) { quality = q; const s2 = q === 'ultra' ? 48 : q === 'high' ? 32 : q === 'medium' ? 24 : 16; if (s2 !== SEG) { SEG = s2; clearTiles(); } budget = q === 'low' ? 4 : q === 'ultra' ? 8 : 6; }
  setQuality(quality);
  const fadeColor = () => { const v = spec && spec.atmo ? shared.uSkyAmb.value : null; return v ? new THREE.Color(Math.min(1, v.x * 2), Math.min(1, v.y * 2), Math.min(1, v.z * 2)) : new THREE.Color(0, 0, 0); };
  return { _u: { shared, terrU }, scene, camera, enter, update, look, state, setQuality, setSun, sunInfo, fadeColor, height, get spec() { return spec; }, get tileCount() { return [...tiles.values()].filter(t => t.mesh.visible).length; } };
}
