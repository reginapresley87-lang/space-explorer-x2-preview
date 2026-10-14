// Inside a gas / ice giant: full-screen ray-cast of the upper atmosphere, three banded cloud layers and a deep
// cloud-deck floor (no solid ground). Drawn over the system render while the camera is below ~ +180 km. Original code.
import * as THREE from '../scene/vendor/three.module.min.js?v=20261014b';

// heights relative to the 1-bar radius (metres)
export const GAS_LAYERS = { haze: 45e3, ammonia: 12e3, water: -25e3, floor: -60e3 };
export const GAS_FADE = [190e3, 120e3];     // interior pass fades in between these altitudes

const VS = `uniform mat4 uInvVP; varying vec3 vRay; void main(){ vec4 r = uInvVP * vec4(position.xy, 1., 1.); vRay = r.xyz / r.w; gl_Position = vec4(position.xy, 0., 1.); }`;
const FS = `precision highp float;
uniform float uR, uH, uAlpha, uTex, uB, uTurb, uTime, uSunI; uniform vec3 uUp, uCamB, uSun, uSunC, uC1, uC2, uC3, uC4, uSeed; uniform mat3 uToB; uniform sampler2D uMap;
varying vec3 vRay;
float h31(vec3 p){ p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p, float oct){ float a = .5, s = 0., n = 0.; for (int i = 0; i < 7; i++) { if (float(i) >= oct) break; s += a * vn(p); n += a; p = p * 2.03 + 17.1; a *= .5; } return s / n; }
vec3 band(vec3 d){   // planet colour at a body-frame direction (same palette as seen from orbit)
  float lat = asin(clamp(d.y, -1., 1.)) / 1.5708;
  if (uTex > .5) { float phi = atan(d.z, -d.x); if (phi < 0.) phi += 6.28318; return texture2D(uMap, vec2(phi / 6.28318, .5 + lat * .5)).rgb; }
  float w = fbm(d * vec3(2.5, 9., 2.5) + uSeed, 4.);
  float l2 = lat + (w - .5) * .07 * uTurb, k1 = sin(l2 * uB * 3.14159) * .5 + .5, k2 = sin(l2 * uB * 7.1 + 1.3) * .5 + .5;
  vec3 c = mix(uC1, uC2, smoothstep(.15, .85, k1)); return mix(c, uC3, smoothstep(.45, .9, k2) * .45 + (w - .5) * .5 * uTurb);
}
vec3 bandLite(vec3 d, float n){   // cheap version for cloud layers (noise passed in)
  float lat = asin(clamp(d.y, -1., 1.)) / 1.5708;
  if (uTex > .5) { float phi = atan(d.z, -d.x); if (phi < 0.) phi += 6.28318; return texture2D(uMap, vec2(phi / 6.28318, .5 + lat * .5)).rgb; }
  float l2 = lat + (n - .5) * .05 * uTurb, k1 = sin(l2 * uB * 3.14159) * .5 + .5, k2 = sin(l2 * uB * 7.1 + 1.3) * .5 + .5;
  vec3 c = mix(uC1, uC2, smoothstep(.15, .85, k1)); return mix(c, uC3, smoothstep(.45, .9, k2) * .45 + (n - .5) * .4 * uTurb);
}
// ray (unit d) from the camera at height uH vs the shell at height hs: distance or -1
float shell(float hs, float mu, bool above){
  float rc = uR + uH, b = rc * mu, c = (uH - hs) * (2. * uR + uH + hs), D = b * b - c;
  if (D < 0.) return -1.; float s = sqrt(D);
  if (!above) return -b + s;            // camera below the shell: always hits from inside
  float t = -b - s; return t > 0. ? t : -1.;
}
void main(){
  vec3 d = normalize(vRay); float mu = dot(d, uUp), sunE = dot(uUp, uSun);
  float day = smoothstep(-.12, .25, sunE), lit = .08 + .92 * day;
  vec3 sunC = uSunC * uSunI;
  vec3 tint = band(uCamB);
  float depth = smoothstep(${GAS_LAYERS.haze.toFixed(1)}, ${GAS_LAYERS.floor.toFixed(1)}, uH);          // 0 high up .. 1 at the floor
  // sky: dark blue-black above the haze, warm planet-tinted glow deeper down
  vec3 zen = mix(vec3(.02, .035, .08), tint * .55, depth) * lit, hor = mix(tint * .7 + vec3(.05, .07, .12), tint * .9, depth) * lit;
  vec3 col = mix(hor, zen, pow(max(mu, 0.), .45));
  float sd = max(dot(d, uSun), 0.);
  col += sunC * (pow(sd, 1600.) * 30. * (1. - depth * .9) + pow(sd, 12.) * .25 * day);
  float fogD = mix(260e3, 18e3, depth);
  // layers, front to back: shells below the camera (descending) when looking down, then shells above (ascending)
  vec4 acc = vec4(0.);
  float hs[4]; hs[0] = ${GAS_LAYERS.haze.toFixed(1)}; hs[1] = ${GAS_LAYERS.ammonia.toFixed(1)}; hs[2] = ${GAS_LAYERS.water.toFixed(1)}; hs[3] = ${GAS_LAYERS.floor.toFixed(1)};
  float al[4]; al[0] = .32; al[1] = .9; al[2] = .85; al[3] = 1.;
  float sc[4]; sc[0] = 90e3; sc[1] = 30e3; sc[2] = 22e3; sc[3] = 40e3;
  for (int pass = 0; pass < 2; pass++) {
    for (int j = 0; j < 4; j++) {
      int i = pass == 0 ? j : 3 - j;
      bool below = hs[i] < uH;
      if ((pass == 0) != below) continue;
      float t = shell(hs[i], mu, below); if (t < 0.) continue;
      vec3 pb = normalize(uCamB * (uR + uH) + uToB * d * t);
      float lat = pb.y;
      vec3 q = pb * (uR / sc[i]);
      float fd = smoothstep(sc[i] * 40., sc[i] * 2., t);                 // fine octaves fade with distance
      float n = fbm(q + uSeed + float(i) * 7.3, 2. + 3. * fd);
      float bandm = sin(lat * uB * 3.14159 * (i == 3 ? 1. : 1.7) + n * 3.) * .5 + .5;
      float dens = i == 3 ? 1. : smoothstep(.38, .7, n * .75 + bandm * .35 + (i == 1 ? .05 : 0.)) ;
      float a = dens * al[i]; if (a < .003) continue;
      vec3 c = bandLite(pb, n) * (i == 3 ? .55 + .45 * n : .8 + .4 * n);
      float shade = i == 3 ? .55 : (below ? 1. : .55);                      // undersides of layers above us are darker
      c *= lit * shade * mix(vec3(1.), sunC, .5) + vec3(.03);
      c = mix(c, hor, 1. - exp(-t / fogD));
      acc.rgb += (1. - acc.a) * c * a; acc.a += (1. - acc.a) * a;
      if (acc.a > .985) break;
    }
    if (acc.a > .985) break;
  }
  col = acc.rgb + (1. - acc.a) * col;
  gl_FragColor = vec4(col * uAlpha, uAlpha);   // premultiplied
}`;

export function createGasInterior() {
  const U = { uInvVP: { value: new THREE.Matrix4() }, uR: { value: 7e7 }, uH: { value: 1e5 }, uAlpha: { value: 0 }, uTex: { value: 0 }, uB: { value: 6 }, uTurb: { value: .5 }, uTime: { value: 0 }, uSunI: { value: 1 },
    uUp: { value: new THREE.Vector3(0, 1, 0) }, uCamB: { value: new THREE.Vector3(0, 1, 0) }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uSunC: { value: new THREE.Vector3(1, 1, 1) },
    uC1: { value: new THREE.Color(.8, .7, .6) }, uC2: { value: new THREE.Color(.6, .45, .3) }, uC3: { value: new THREE.Color(.9, .85, .8) }, uC4: { value: new THREE.Color(.7, .3, .2) }, uSeed: { value: new THREE.Vector3() },
    uToB: { value: new THREE.Matrix3() }, uMap: { value: null } };
  const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: U, depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const vp = new THREE.Matrix4();
  // drawn at reduced resolution (soft clouds) and blended up: keeps phones and software GL fast
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
  const blitM = new THREE.ShaderMaterial({ uniforms: { tMap: { value: rt.texture } }, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: 'uniform sampler2D tMap; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tMap, vUv); }', depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
  const blit = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitM); blit.frustumCulled = false; const blitScene = new THREE.Scene(); blitScene.add(blit);
  const sz = new THREE.Vector2(); let scale = 0.45;
  return {
    U,
    // it: system-view item of the giant; o: {h (m above 1-bar), up, camB (unit, body frame), toB (Matrix3 world->body), sun (world unit), sunC (Vector3)}
    set(it, o) {
      const bu = it.mesh.material.uniforms || {};
      U.uR.value = it.b.radiusKm * 1000; U.uH.value = o.h; U.uUp.value.copy(o.up); U.uCamB.value.copy(o.camB); U.uToB.value.copy(o.toB); U.uSun.value.copy(o.sun);
      if (o.sunC) U.uSunC.value.copy(o.sunC);
      const tex = bu.uMap && bu.uMap.value && bu.uMap.value.image && (bu.uMap.value.image.width || 0) > 4;
      U.uTex.value = tex ? 1 : 0; U.uMap.value = tex ? bu.uMap.value : null;
      for (const k of ['uC1', 'uC2', 'uC3', 'uC4']) if (bu[k]) U[k].value.copy(bu[k].value);
      if (bu.uBands) U.uB.value = bu.uBands.value; else U.uB.value = it.b.key === 'saturn' ? 9 : it.b.key === 'jupiter' ? 7 : 3;
      if (bu.uTurb) U.uTurb.value = bu.uTurb.value; if (bu.uSeed) U.uSeed.value.copy(bu.uSeed.value);
      U.uAlpha.value = o.alpha;
    },
    render(renderer, camera) {
      if (U.uAlpha.value <= 0.001) return;
      vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert(); U.uInvVP.value.copy(vp);
      const prev = renderer.getRenderTarget(); if (prev) sz.set(prev.width, prev.height); else renderer.getDrawingBufferSize(sz);
      const w = Math.max(16, Math.round(sz.x * scale)), h = Math.max(16, Math.round(sz.y * scale)); if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
      const ac = renderer.autoClear; renderer.autoClear = false;
      renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false); renderer.setClearColor(0x000000, 1); renderer.render(scene, ortho);
      renderer.setRenderTarget(prev); renderer.render(blitScene, ortho); renderer.autoClear = ac;
    },
    setScale(k) { scale = k; },
    dispose() { quad.geometry.dispose(); mat.dispose(); rt.dispose(); blit.geometry.dispose(); blitM.dispose(); },
  };
}
