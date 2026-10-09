// GLSL (original). All shaders output LINEAR HDR radiance; engine/post.js tone-maps.
// Quality is selected with #defines: OCT_MAX (noise octaves), ATMO_NV / ATMO_NL (scattering samples), CLOUD_SHADOW, CRATERS.
export const NOISE = `
float h3(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
vec3 h33(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= .5; } return s / .97; }
#ifndef OCT_MAX
#define OCT_MAX 7
#endif
float fbmN(vec3 p, float n){ float a = .5, s = 0., w = 0.; for (int i = 0; i < OCT_MAX; i++){ float k = clamp(n - float(i), 0., 1.); if (k <= 0.) break; s += a * vn(p) * k; w += a * k; p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= .5; } return s / max(w, 1e-3); }
float ridged(vec3 p, float n){ float a = .5, s = 0., w = 1., t = 0.; for (int i = 0; i < OCT_MAX; i++){ float k = clamp(n - float(i), 0., 1.); if (k <= 0.) break;
  float r = 1. - abs(vn(p) * 2. - 1.); r *= r; s += a * r * w * k; t += a * k; w = clamp(r * 1.8, 0., 1.); p = p * 2.07 + vec3(4.1, 1.3, 7.7); a *= .5; } return s / max(t, 1e-3); }
// crater field: bowl + raised rim, returns height offset (approx. -0.5..0.2) and a "freshness" value in .y
vec2 craters(vec3 p, float dens){ vec3 i = floor(p), f = fract(p); float h = 0., fr = 0.;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z)), o = h33(i + g); if (o.x > dens) continue;
    vec3 c = g + .2 + .6 * o.yzx - f; float r = .16 + .3 * o.z * o.z, d = length(c) / r;
    if (d < 1.6) { float bowl = d < 1. ? (d * d - 1.) : 0.; float rim = exp(-(d - 1.) * (d - 1.) * 14.) * .35; h += (bowl + rim) * r; fr = max(fr, (1. - smoothstep(.0, 1.4, d)) * fract(o.x * 13.)); } }
  return vec2(h, fr); }
`;
// sun reaching a point through an atmosphere with vertical optical depth uTau (Kasten-Young air mass)
const ATMO_TRANS = `vec3 sunTrans(vec3 tau, float mu){ if (dot(tau, tau) < 1e-8) return vec3(1.); float m = clamp(mu, -.2, 1.);
  float am = 1. / (max(m, 0.) + .50572 * pow(max(96.07995 - degrees(acos(m)), .5), -1.6364)); return exp(-tau * min(am, 40.)); }`;
const GGX = `float ggx(vec3 N, vec3 V, vec3 L, float a){ vec3 H = normalize(L + V); float nh = max(dot(N, H), 0.), nl = max(dot(N, L), 0.), nv = max(dot(N, V), 1e-3);
  float a2 = a * a, d = nh * nh * (a2 - 1.) + 1.; float D = a2 / (3.14159 * d * d); float F = .02 + .98 * pow(1. - max(dot(H, V), 0.), 5.);
  float k = a * .5; float G = nl / (nl * (1. - k) + k) * nv / (nv * (1. - k) + k); return D * F * G / (4. * nv * max(nl, 1e-3)) * nl; }`;
const BUMP = `vec3 bumpN(vec3 N, vec3 P, float h){ vec3 dpx = dFdx(P), dpy = dFdy(P); float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx); float det = dot(dpx, r1); if (abs(det) < 1e-30) return N; vec3 g = sign(det) * (dhx * r1 + dhy * r2); return normalize(abs(det) * N - g); }`;
const LIGHT_U = `uniform vec3 uS0, uS0c, uS1, uS1c, uTau, uPC; uniform float uAmb, uPRad;`;
const RINGSHADOW = `uniform vec3 uRingN; uniform vec2 uRing; uniform float uRingSeed;
  float ringShadow(vec3 W, vec3 L){ if (uRing.y <= 0.) return 1.; float dn = dot(L, uRingN); if (abs(dn) < 1e-4) return 1.;
    float t = dot(uPC - W, uRingN) / dn; if (t <= 0.) return 1.; float r = length(W + L * t - uPC); float x = (r - uRing.x) / (uRing.y - uRing.x);
    if (x < 0. || x > 1.) return 1.; float b = vn(vec3(x * 38. + uRingSeed, .5, .5)) * .6 + vn(vec3(x * 140. + uRingSeed, 2.5, .5)) * .4;
    float a = smoothstep(0., .06, x) * smoothstep(1., .9, x) * (.25 + .75 * smoothstep(.3, .7, b)); return 1. - a * .8; }`;

export const PLANET_VS = `varying vec3 vObj, vN, vW;
void main(){ vObj = position; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;

// cloud density shared by cloud shell and the cloud-shadow lookup (object space unit vector)
const CLOUDS = `uniform float uCloud, uTime; uniform vec3 uSeed;
  float cloudD(vec3 p, float n){ vec3 q = p * 2.1 + uSeed; float lat = p.y;
    // flow: rotate slowly with latitude-dependent winds, curl with a warp field
    float w = fbmN(q * 1.3 + vec3(0., uTime * .004, 0.), min(n, 4.));
    vec3 r = q * vec3(1.6, 2.6, 1.6) + vec3(w * 1.6, 0., w * 1.2) + vec3(uTime * .006 * (1. + abs(lat)), 0., 0.);
    float c = fbmN(r, n) + .12 * (vn(q * 14. + w * 3.) - .5);
    float belt = .55 + .45 * cos(lat * 6.2832 * 1.5);   // ITCZ / mid-latitude storm belts, drier subtropics
    return smoothstep(.62 - uCloud * .22, .9 - uCloud * .2, c * (.82 + .25 * belt)); }`;

export const PLANET_FS = NOISE + ATMO_TRANS + GGX + BUMP + `
uniform float uType, uSea, uIce, uBands, uTurb, uStorm, uTempK, uOct, uCity, uAirless, uRelief;
uniform vec3 uC1, uC2, uC3, uC4; uniform mat3 uCloudInv;
` + LIGHT_U + CLOUDS + RINGSHADOW + `
varying vec3 vObj, vN, vW;
vec3 rotY(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
void main(){
  vec3 p = normalize(vObj), q = p * 2.1 + uSeed; float lat = p.y, n = uOct;
  vec3 col; float h = 0., water = 0., ice = 0.; vec3 emis = vec3(0.); float relief = uRelief, land = 1.;
  if (uType < .5) {                       // rocky / airless
    float m = fbmN(q * 1.3, n), mare = smoothstep(.5, .62, fbmN(q * .65 + 3., 4.));
    vec2 cr = vec2(0.);
    #ifdef CRATERS
      if (uAirless > .5) { cr = craters(q * 3., .55) * .9; if (n > 4.) { vec2 c2 = craters(q * 9., .7) * .45; cr.x += c2.x; cr.y = max(cr.y, c2.y); }
        if (n > 6.) cr.x += craters(q * 27., .8).x * .2; }
    #endif
    float rd = ridged(q * 2.4, n - 1.);
    h = m * .5 + rd * .25 + cr.x - mare * .12;
    col = mix(uC2, uC1, smoothstep(.3, .72, m + rd * .2)); col = mix(col, uC3 * .7, mare * .55);
    col = mix(col, uC4, smoothstep(.62, .8, fbmN(q * 2.6 + 4., n - 2.)) * .3);
    col *= .9 + .25 * cr.y;                   // bright fresh ejecta
  } else if (uType < 1.5) {               // ocean / Earth-like with biomes
    float warp = fbmN(q * .9 + 7., 4.);
    float cont = fbmN(q * 1.15 + warp * .9, n);
    float mnt = ridged(q * 3.1 + warp * 1.4, n - 1.);
    land = smoothstep(uSea, uSea + .008, cont);
    float coast = smoothstep(uSea + .005, uSea + .1, cont);
    float elev = max(cont - uSea, 0.) * 2.2 + mnt * coast * .65;
    h = land > .5 ? elev : (cont - uSea) * .6;
    float moist = fbmN(q * 1.9 + 11., n - 2.) - (1. - coast) * -.05 + .08 * cos(lat * 9.42);
    float T = uTempK + 22. - 75. * pow(abs(lat), 1.5) - elev * 110. + (vn(q * 5.) - .5) * 10.;
    vec3 sand = mix(uC2, vec3(.62, .52, .36), .35), grass = uC1, forest = uC1 * vec3(.55, .7, .5), tundra = mix(uC2, uC1, .35) * .75, rock = mix(uC2 * .55, vec3(.24, .22, .2), .5);
    vec3 bio = mix(sand, grass, smoothstep(.40, .52, moist));
    bio = mix(bio, forest, smoothstep(.52, .64, moist) * smoothstep(262., 290., T));
    bio = mix(bio, tundra, smoothstep(274., 260., T));
    bio = mix(bio, rock, smoothstep(.35, .7, mnt * coast));
    float shallow = smoothstep(uSea - .1, uSea, cont);
    vec3 sea = mix(uC3 * .16, uC3 * .7, shallow * shallow);
    float seaIce = smoothstep(270., 262., T + 6.), snow = smoothstep(262., 252., T);
    col = mix(sea, bio, land);
    ice = max(snow * land, seaIce * (1. - land));
    col = mix(col, vec3(.86, .9, .95), ice);
    water = (1. - land) * (1. - ice);
    if (uCity > 0.) { float cty = smoothstep(.55, .85, vn(q * 70.) * .6 + vn(q * 9.) * .7) * land * (1. - ice) * smoothstep(.0, .2, moist - .3) * (1. - smoothstep(uSea + .05, uSea + .25, cont) * .6);
      emis = vec3(1., .72, .38) * cty * uCity; }
  } else if (uType < 2.5) {               // lava
    float m = fbmN(q * 2., n), k = abs(fbmN(q * 3.2 + 7., n - 1.) - .5), cracks = 1. - smoothstep(0., .03, k);
    h = m * .6 - cracks * .2;
    col = mix(uC2, uC1, m) * .6;
    float hot = cracks * 1.2 + smoothstep(.68, .82, m) * .7;
    emis = mix(vec3(1., .25, .03), vec3(1., .75, .3), hot * .5) * hot * (2.5 + .8 * sin(uTime * 1.5 + m * 20.));
  } else if (uType < 3.5) {               // ice
    float m = fbmN(q * 2., n), l = 1. - smoothstep(0., .02, abs(fbmN(q * 2.8 + 5., n - 1.) - .5));
    vec2 cr = vec2(0.);
    #ifdef CRATERS
      if (uAirless > .5) cr = craters(q * 4., .5) * .6;
    #endif
    h = m * .3 + cr.x - l * .1;
    col = mix(uC2, uC1, smoothstep(.25, .75, m)); col = mix(col, uC3 * .8, l * .7); ice = .3;
  } else if (uType < 4.5) {               // desert
    float m = fbmN(q * 1.5, n), mesa = smoothstep(.55, .58, fbmN(q * 2.2 + 2., n - 1.));
    float dunes = sin(dot(q, vec3(23., 6., 15.)) + fbmN(q * 3., 3.) * 12.) * .5 + .5;
    vec2 cr = vec2(0.);
    #ifdef CRATERS
      if (uAirless > .5) cr = craters(q * 3.5, .45) * .7;
    #endif
    h = m * .5 + mesa * .25 + dunes * .03 + cr.x;
    col = mix(uC2, uC1, smoothstep(.3, .7, m)); col = mix(col, uC3, dunes * .18 + mesa * .25);
    float pol = smoothstep(uIce, uIce + .03, abs(lat) + .06 * vn(q * 5.)); col = mix(col, vec3(.9, .9, .92), pol * .9); ice = pol;
  } else {                                // gas / ice giant: zonal jets, shear turbulence, vortices
    float B = uBands, t = uTime * .02;
    float jet = sin(lat * B * 3.14159) * (1. - abs(lat) * .5);
    vec3 pr = rotY(p, t * jet);
    float w = fbmN(pr * vec3(2.5, 9., 2.5) + uSeed, n);
    float lat2 = lat + (w - .5) * .07 * uTurb + (fbmN(pr * vec3(5., 22., 5.) + uSeed * 1.7, n - 1.) - .5) * .025 * uTurb;
    // vortices: the main storm (uStorm = latitude) + two small white ovals
    for (int k = 0; k < 3; k++) {
      float sl = k == 0 ? uStorm : -.35 + .6 * fract(uSeed.x * (.37 + float(k) * .21)); if (k == 0 && uStorm < -1.) continue;
      float slon = 1. + float(k) * 2.3 + t * (k == 0 ? .3 : .7);
      vec3 c = vec3(cos(slon) * sqrt(1. - sl * sl), sl, sin(slon) * sqrt(1. - sl * sl));
      vec3 d = p - c; float rs = k == 0 ? .16 : .06; float e = length(d * vec3(1., 1.8, 1.)) / rs;
      if (e < 2.5) { float sw = exp(-e * e) * 5.; vec3 ax = c; vec3 dd = d * cos(sw) + cross(ax, d) * sin(sw);
        lat2 += (dd.y - d.y) * .8; w = mix(w, fbmN((c + dd) * 9. + uSeed, n), smoothstep(2.5, .5, e)); }
    }
    float k1 = sin(lat2 * B * 3.14159) * .5 + .5, k2 = sin(lat2 * B * 7.1 + 1.3) * .5 + .5;
    col = mix(uC1, uC2, smoothstep(.15, .85, k1));
    col = mix(col, uC3, smoothstep(.45, .9, k2) * .45 + (w - .5) * .5 * uTurb);
    if (uStorm > -1.) { float slon = 1. + t * .3; vec3 c = vec3(cos(slon) * sqrt(1. - uStorm * uStorm), uStorm, sin(slon) * sqrt(1. - uStorm * uStorm));
      float e = length((p - c) * vec3(1., 1.8, 1.)) / .16; col = mix(col, uC4, smoothstep(1., .55, e + (w - .5) * .5) * .85); }
    for (int k = 1; k < 3; k++) { float sl = -.35 + .6 * fract(uSeed.x * (.37 + float(k) * .21)), slon = 1. + float(k) * 2.3 + t * .7;
      vec3 c = vec3(cos(slon) * sqrt(1. - sl * sl), sl, sin(slon) * sqrt(1. - sl * sl)); float e = length((p - c) * vec3(1., 1.8, 1.)) / .06;
      col = mix(col, vec3(.92, .9, .86), smoothstep(1., .5, e) * .8); }
    col *= .92 + .16 * w;
    relief = 0.;
  }
  // ----- lighting (no ambient wash: only the stars + faint starlight)
  vec3 N0 = normalize(vN), V = normalize(cameraPosition - vW), L = normalize(uS0 - vW), L1 = normalize(uS1 - vW);
  vec3 N = N0;
  if (relief > 0.) N = bumpN(N0, vW, h * relief * uPRad);
  float mu0 = dot(N0, L);
  vec3 sun = uS0c * sunTrans(uTau, mu0);
  float diff = max(dot(N, L), 0.) * smoothstep(-.03, .06, mu0);
  if (uType > 4.5) diff = max(mu0, 0.) * (.75 + .25 * pow(max(dot(N0, V), 0.), .3));   // giants: soft deep-atmosphere terminator
  float sh = ringShadow(vW, L);
  #ifdef CLOUD_SHADOW
    if (uCloud > 0.) { vec3 ps = normalize(uCloudInv * normalize(vW - uPC + L * uPRad * .02)); sh *= 1. - cloudD(ps, min(n, 5.)) * .65; }
  #endif
  vec3 lit = sun * diff * sh + uS1c * max(dot(N, L1), 0.) + vec3(uAmb);
  vec3 o = col * lit;
  if (water > 0.) o += sun * sh * ggx(N0, V, L, .18) * water * .9;
  if (ice > 0. && uType < 1.5) o += sun * sh * ggx(N0, V, L, .45) * ice * .15;
  float night = smoothstep(.08, -.12, mu0);
  o += emis * (uType == 1. ? night : 1.);
  gl_FragColor = vec4(o, 1.);
}`;

// textured bodies (Sol): same lighting model as procedural planets, optional Earth extras
export const TEX_FS = NOISE + ATMO_TRANS + GGX + LIGHT_U + RINGSHADOW + `
uniform sampler2D uMap, uNight, uSpec, uClouds; uniform float uHasNight, uHasSpec, uHasClouds, uLimb; uniform mat3 uToCloud;
uniform vec3 uSunObj; varying vec3 vObj, vN, vW; varying vec2 vUv;
vec2 uvOf(vec3 p){ float phi = atan(p.z, -p.x); if (phi < 0.) phi += 6.28318; return vec2(phi / 6.28318, 1. - acos(clamp(p.y, -1., 1.)) / 3.14159); }
void main(){
  vec3 col = texture2D(uMap, vUv).rgb;
  vec3 N = normalize(vN), V = normalize(cameraPosition - vW), L = normalize(uS0 - vW), L1 = normalize(uS1 - vW);
  float mu0 = dot(N, L); vec3 sun = uS0c * sunTrans(uTau, mu0);
  float diff = max(mu0, 0.); if (uLimb > 0.) diff = max(mu0, 0.) * (.75 + .25 * pow(max(dot(N, V), 0.), .3));
  float sh = ringShadow(vW, L);
  if (uHasClouds > 0.) { vec3 p = normalize(vObj); vec2 cuv = uvOf(normalize(uToCloud * normalize(p + uSunObj * .012))); sh *= 1. - texture2D(uClouds, cuv).r * .6; }
  vec3 o = col * (sun * diff * sh + uS1c * max(dot(N, L1), 0.) + vec3(uAmb));
  if (uHasSpec > 0.) { float w = texture2D(uSpec, vUv).r; o += sun * sh * ggx(N, V, L, .2) * w * .9; }
  if (uHasNight > 0.) { float night = smoothstep(.1, -.15, mu0); o += texture2D(uNight, vUv).rgb * vec3(1., .85, .6) * night * 1.6; }
  gl_FragColor = vec4(o, 1.);
}`;
export const TEX_VS = `varying vec3 vObj, vN, vW; varying vec2 vUv;
void main(){ vObj = position; vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;

// cloud shell: procedural (uTex = 0) or textured (Earth)
export const CLOUD_FS = NOISE + ATMO_TRANS + LIGHT_U + CLOUDS + `
uniform sampler2D uClouds; uniform float uTex, uOct; varying vec3 vObj, vN, vW; varying vec2 vUv;
void main(){
  vec3 p = normalize(vObj);
  float d = uTex > .5 ? texture2D(uClouds, vUv).r : cloudD(p, uOct);
  if (d < .01) discard;
  vec3 N = normalize(vN), L = normalize(uS0 - vW), V = normalize(cameraPosition - vW);
  float mu = dot(N, L); vec3 sun = uS0c * sunTrans(uTau * .7, mu);
  float lit = smoothstep(-.12, .25, mu) * (.35 + .65 * max(mu, 0.)) + pow(max(dot(-L, V), 0.), 8.) * .3 * smoothstep(-.2, .1, mu);
  vec3 c = vec3(.95) * sun * lit + uS1c * max(dot(N, normalize(uS1 - vW)), 0.) * .9 + uAmb;
  float a = d * (uTex > .5 ? .95 : .92);
  gl_FragColor = vec4(c * a, a);   // premultiplied
}`;

// physically based single scattering: Rayleigh + Mie, ray-marched through a spherical shell.
// Units: planet radii. Rendered on the shell (front faces from outside, back faces from inside) with blend ONE, SRC_ALPHA
// so the output adds in-scattered light and multiplies what's behind by the view transmittance.
export const ATMO_VS = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
export const ATMO_FS = `
#ifndef ATMO_NV
#define ATMO_NV 12
#endif
#ifndef ATMO_NL
#define ATMO_NL 4
#endif
uniform vec3 uPC, uS0, uS0c, uBR, uBM, uMieCol, uOz; uniform float uPRad, uTop, uHR, uHM, uG, uSunI;
varying vec3 vW;
vec2 rs(vec3 o, vec3 d, float r){ float b = dot(o, d), c = dot(o, o) - r * r, h = b * b - c; if (h < 0.) return vec2(1e9, -1e9); h = sqrt(h); return vec2(-b - h, -b + h); }
void main(){
  vec3 o = (cameraPosition - uPC) / uPRad, d = normalize(vW - cameraPosition);
  float Rt = 1. + uTop; vec2 ta = rs(o, d, Rt); if (ta.y < 0.) discard;
  vec2 tp = rs(o, d, 1.); float t0 = max(ta.x, 0.), t1 = tp.x > 0. ? min(ta.y, tp.x) : ta.y;
  vec3 Ls = normalize(uS0 - uPC); float mu = dot(d, Ls);
  float pR = .0596831 * (1. + mu * mu), g = uG, pM = .0795775 * (1. - g * g) / pow(1. + g * g - 2. * g * mu, 1.5);
  float ds = (t1 - t0) / float(ATMO_NV); vec3 sR = vec3(0.), sM = vec3(0.), sMS = vec3(0.); float odR = 0., odM = 0.;
  for (int i = 0; i < ATMO_NV; i++) {
    vec3 x = o + d * (t0 + (float(i) + .5) * ds); float hgt = length(x) - 1.;
    float dR = exp(-hgt / uHR) * ds, dM = exp(-hgt / uHM) * ds; odR += dR; odM += dM;
    sMS += exp(-((uBR + uOz) * odR + uBM * 1.1 * odM)) * dR * .09 * smoothstep(-.12, .25, dot(normalize(x), Ls));
    vec2 tl = rs(x, Ls, Rt); vec2 tpl = rs(x, Ls, .999); if (tpl.x > 0.) continue;   // planet shadow
    float dl = tl.y / float(ATMO_NL), lR = 0., lM = 0.;
    for (int j = 0; j < ATMO_NL; j++) { float hh = length(x + Ls * (float(j) + .5) * dl) - 1.; lR += exp(-hh / uHR) * dl; lM += exp(-hh / uHM) * dl; }
    vec3 tau = (uBR + uOz) * (odR + lR) + uBM * 1.1 * (odM + lM);
    vec3 att = exp(-tau); sR += att * dR; sM += att * dM;
  }
  vec3 Lin = uS0c * uSunI * (sR * uBR * pR + sM * uBM * uMieCol * pM + sMS * uBR);
  vec3 T = exp(-((uBR + uOz) * odR + uBM * 1.1 * odM));
  gl_FragColor = vec4(Lin, dot(T, vec3(.2126, .7152, .0722)));
}`;

// star photosphere: convection granulation (cellular), supergranulation, spots & faculae, wavelength-dependent limb darkening
export const STAR_VS = `varying vec3 vObj, vN, vW; void main(){ vObj = position; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
export const STAR_FS = NOISE + `uniform vec3 uColor; uniform float uTime, uGran, uI, uSpots, uDetail; varying vec3 vObj, vN, vW;
float cell(vec3 p){ vec3 i = floor(p), f = fract(p); float d1 = 8., d2 = 8.;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) { vec3 g = vec3(float(x), float(y), float(z)); vec3 o = h33(i + g);
    o = .5 + .45 * sin(uTime * .25 + 6.2831 * o); float d = length(g + o - f); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return d2 - d1; }
void main(){ vec3 p = normalize(vObj);
  float mu = max(dot(normalize(vN), normalize(cameraPosition - vW)), 0.);
  float gr = 1.;
  if (uDetail > 0.) { float c = cell(p * uGran); float cv = vn(floor(p * uGran) * 1.37 + 5.); gr = .78 + .3 * smoothstep(.0, .45, c) * (.75 + .5 * cv); if (uDetail > 1.) gr *= .93 + .14 * smoothstep(0., .4, cell(p * uGran * 2.7 + 3.)); }
  float sg = fbm(p * 5. + vec3(0., uTime * .01, 0.));
  float spots = smoothstep(.66, .74, fbm(p * 3.2 + 9.)) * smoothstep(.75, .2, abs(p.y)) * uSpots;
  float umbra = smoothstep(.71, .76, fbm(p * 3.2 + 9.)) * smoothstep(.75, .2, abs(p.y)) * uSpots;
  vec3 u = vec3(.52, .64, .78);   // limb darkening coefficients (red .. blue): limb looks redder
  vec3 limb = 1. - u * (1. - pow(mu, .9));
  float fac = smoothstep(.62, .7, sg) * (1. - mu) * 1.5;
  vec3 c = uColor * limb * gr * (.9 + .2 * sg) * (1. - spots * .55 - umbra * .35) * (1. + fac);
  float lc = dot(c, vec3(.2126, .7152, .0722)); c = max(vec3(0.), lc + (c - lc) * 1.6);   // keep the photosphere's hue after tone mapping
  gl_FragColor = vec4(c * uI, 1.); }`;
// corona / glow billboard around a star (view-space quad)
export const CORONA_VS = `uniform float uSize; varying vec2 vP; void main(){ vP = position.xy; vec4 mv = modelViewMatrix * vec4(0., 0., 0., 1.); mv.xy += position.xy * uSize; gl_Position = projectionMatrix * mv; }`;
export const CORONA_FS = NOISE + `uniform vec3 uColor; uniform float uI, uTime, uK; varying vec2 vP;
void main(){ float r = length(vP) * uK; if (r < .98) discard; float a = atan(vP.y, vP.x);
  float st = fbm(vec3(cos(a) * 3., sin(a) * 3., r * .6 - uTime * .02)) ; float rays = .75 + .5 * pow(st, 2.5);   // gentle streamers, not hard streaks
  float I = pow(r, -3.2) * rays * smoothstep(1., 1.02, r) + .25 * exp(-(r - 1.) * 9.);
  I *= smoothstep(1., .75, length(vP));
  gl_FragColor = vec4(uColor * I * uI, 1.); }`;

export const RING_VS = `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
export const RING_FS = NOISE + `uniform vec3 uColor, uS0, uS0c, uPC; uniform float uSeed, uPRad, uTex; uniform sampler2D uMap; varying vec2 vUv; varying vec3 vW;
void main(){ float r = vUv.x; vec3 c; float a;
  if (uTex > .5) { vec4 t = texture2D(uMap, vec2(r, .5)); c = t.rgb; a = t.a; }
  else { float b = vn(vec3(r * 38. + uSeed, .5, .5)) * .6 + vn(vec3(r * 140. + uSeed, 2.5, .5)) * .4;
    a = smoothstep(0., .06, r) * smoothstep(1., .9, r) * (.25 + .75 * smoothstep(.3, .7, b)) * (1. - smoothstep(.55, .6, r) * smoothstep(.65, .6, r) * .85);
    c = uColor * (.75 + .5 * b); a *= .85; }
  vec3 L = normalize(uS0 - vW); float t = dot(uPC - vW, L); float sh = 1.;
  if (t > 0.) { float d = length(vW + L * t - uPC); sh = smoothstep(uPRad * .97, uPRad * 1.03, d); }   // planet's shadow on the rings
  vec3 V = normalize(cameraPosition - vW); float fwd = pow(max(dot(-L, V), 0.), 6.);
  vec3 o = c * uS0c * sh * (.55 + .9 * fwd * (1. - a));
  gl_FragColor = vec4(o * a, a); }`;
export const DISK_VS = RING_VS;
export const DISK_FS = NOISE + `uniform float uTime; varying vec2 vUv; varying vec3 vW;
void main(){ float r = vUv.x, ang = vUv.y * 6.2832;
  float sw = fbm(vec3(r * 7., cos(ang) * 2. + sin(ang - uTime * .7 / (r + .25)), sin(ang) * 2. - uTime * .1));
  vec3 hot = mix(vec3(1., .93, .85), vec3(1., .32, .04), smoothstep(0., .7, r));
  float I = pow(1. - r, 1.6) * (.45 + .9 * sw) * smoothstep(0., .04, r) * (1. + .8 * sin(ang));   // Doppler beaming: approaching side brighter
  gl_FragColor = vec4(hot * I * 6., 1.); }`;
