# Space Explorer X 2 — preview

A mobile-first 3D browser explorer of a procedurally generated universe: zoom seamlessly from
Earth's surface out past the Milky Way to the cosmic web, then dive into any galaxy, star, planet
and land on it. Everything (except the real Solar System textures inherited from v1) is generated
in code from a single seed — the same seed always produces the same universe.

Static site, no build step: serve the folder and open `index.html` (three.js r160 is vendored in `scene/vendor`).

```
python3 -m http.server 8000   # then open http://localhost:8000/
```

## Features
- **Seamless scales**: universe (galaxies + cosmic web, ~10 Mly sectors) → galaxy (particle clouds,
  dust lanes, bulge) → star field (lazy sector streaming, 5 LOD levels) → star system → planet orbit → surface.
- **Real places**: Milky Way + M31, M33, LMC, SMC; Sol with v1's real textures, moons and landing; Alpha Centauri A/B,
  Proxima Centauri b/d, Sirius A/B, Betelgeuse, TRAPPIST-1 b–h, Sagittarius A*. Appearance of exoplanets is imagined.
- **Procedural stars**: O–M main sequence, giants, white dwarfs, neutron stars (pulsar beams), black holes
  (accretion disk + screen-space gravitational-lensing shader), binaries.
- **Procedural planets**: rocky, ocean, lava, ice, desert, gas giants; rings, moons, atmospheres; shader textures.
- **Info card**: type, radius, mass, gravity, temperature, orbit, moons, atmosphere, "✨ Discovered by you!".
- **Landing** on rocky/ocean/lava/ice/desert worlds (and Sol bodies): terrain, rocks, sky colour from atmosphere,
  seas of water or lava, the parent star / planet in the sky.
- **Navigation**: tap to select, double-tap or "Go to" for logarithmic flights, drag/pinch orbit, thumbstick free-fly
  with distance-scaled speed and boost (1×/30×/1k×/100k×), 🏠 Home, 🎲 random procedural planet, search, ★ bookmarks
  and discoveries (localStorage).
- **Mobile performance**: adaptive pixel ratio (target ~50 fps), sphere LOD, particle caps per quality level,
  lazy texture queue, sector caches.

## Rendering (realism pass)
- **HDR pipeline** (`engine/post.js`): everything renders linear into a half-float target → dual-filter bloom →
  GPU log-average **auto exposure** with eye adaptation → soft round glare halos for the brightest
  on-screen stars → subtle **lens flare** → **ACES** filmic tone mapping → sRGB + dither + vignette. Realistic
  camera FOV (70° diagonal, adapted to the screen aspect).
- **Planets**: single-scattering **Rayleigh + Mie** atmosphere (+ ozone absorption, cheap multiple-scattering term)
  ray-marched per pixel — blue limbs, red terminators, haze colour per atmosphere type; the same model and constants
  drive the landed sky. Procedural surfaces with fractional-octave fBm (more octaves as you approach), ridged
  mountain ranges, 3D crater fields on airless worlds, biomes by temperature/moisture/latitude, sea ice & polar caps,
  GGX ocean glint, derivative bump mapping, animated cloud layer with cloud shadows, city lights on some temperate
  ocean worlds, gas giants with zonal jets/turbulence/vortices, soft ring shadows (planet ↔ ring both ways).
  Lighting comes from the star(s) only — no ambient wash; night sides are dark.
- **Stars**: blackbody colour (Planck × CIE 1931 fit), photosphere granulation (cellular convection, faculae, spots,
  wavelength-dependent limb darkening), corona; star-field brightness by apparent magnitude as HDR points.
- **Galaxies**: layered sprites (unresolved glow, stars, absorbing dust) + face-on impostor with a yellow bulge,
  blue ragged arms, HII knots and dust lanes; from inside the Milky Way the sky band is ray-marched from the same
  star + dust density model into a cube map (one face per frame). **Nebulae** (Orion, Carina, Eagle, Lagoon, Helix +
  procedural emission/planetary nebulae) are ray-marched volumes (emission + dust absorption).
- **Surface**: quadtree-LOD terrain (CPU heightfield, ridged multifractal mountains, craters, dunes; skirts; planet
  curvature), horizon-traced terrain shadows, sky-view LUT from the physical atmosphere, aerial perspective,
  sun disc + glare, sunsets when the star is low, normal-lit rocks, water/lava seas.
- **Quality tiers**: `low` = tone mapping + exposure, 3-6 noise octaves, low-res sky; `medium` = + bloom,
  craters, cloud shadows; `high` = + lens flare, 4× MSAA, more octaves / ray-march steps, 256² sky cube.

## Files
| Path | Purpose |
|---|---|
| `index.html` | page shell; loads engine, joystick and UI |
| `engine/main.js` | engine: camera frames, render passes, flights, landing, picking, `window.SE2` |
| `engine/universe.js` | galaxies (real + procedural), cosmic web, galaxy density & particles |
| `engine/stars.js` | star sectors/streaming, star classes, real nearby stars, `StarField` |
| `engine/sysgen.js` | star-system generation (procedural, Sol, real systems), layout |
| `engine/sysview.js`, `engine/views.js`, `engine/shaders.js` | rendering of systems, galaxies/universe, GLSL |
| `engine/util.js` | hashing, seeded RNG, name generator, blackbody colour, formatting |
| `engine/post.js` | HDR post-processing: bloom, auto exposure, glare/spikes/flare, ACES |
| `engine/nebulae.js` | real + procedural nebulae, ray-marched nebula volumes |
| `scene/` | reused from v1: three.js, textures, joystick, Solar System bodies, surface walker (extended with seas) |
| `ui/` | HUD, search, card, bookmarks, buttons, gestures, title screen |
| `audio/` | music/sfx reused from v1 |

## Coordinates and scale
Camera location is hierarchical `{gal, sys, p}`: universe light-years, galaxy-local light-years, or system units
(1 su = 2.5e-5 ly). Rendering is camera-relative in several passes (universe → galaxy → stars → system) so precision holds
from metres to billions of light-years. Inside star systems sizes and orbital distances are **compressed for
visibility** (as in v1); info cards always show the real values. The 📏 button / `SE2.setRealScale(true)` switches to
**true sizes and distances** (1 AU = 0.6325 su; star, planet and moon radii and orbits from real data).

## URL parameters
| Param | Effect |
|---|---|
| `seed=N` | universe seed (default 1) |
| `quality=low\|medium\|high` | quality tier (post effects, shader detail, particle caps, max pixel ratio) |
| `at=<id>` | start focused on an entity (default `sol#earth`) |
| `autostart` | skip the title screen |
| `noui`, `nojoy` | engine only / no thumbstick (testing, embedding) |
| `nocube` | disable the ray-marched in-galaxy sky |
| `orbits` | start with orbit lines shown |

## IDs
- Galaxies: `mw`, `m31`, `m33`, `lmc`, `smc`, procedural `g:sx:sy:sz:i`
- Stars/systems: `sol`, `alphacen`, `proxima`, `sirius`, `betelgeuse`, `trappist1`, `sgra`, procedural `mw/s:L:sx:sy:sz:i`,
  galaxy cores `<gal>/core`
- Nebulae: `neb:orion`, `neb:carina`, `neb:eagle`, `neb:lagoon`, `neb:helix`, procedural `mw/n:sx:sy:sz:i` (kind `nebula`)
- Bodies: `<systemId>#<key>`, e.g. `sol#earth`, `sol#moon`, `trappist1#e`, `proxima#b`, `mw/s:1:-6:2:721:4#p3`

## JavaScript API — `window.SE2`
Available after the `se2:ready` event (dispatched on `window`).

| Member | Description |
|---|---|
| `version`, `seed` | build version and current seed |
| `goTo(id, {dur, dist, phi})` | fly to an entity (logarithmic flight); returns `true` if found |
| `select(id)` / `getSelected()` | select an entity (opens the card in the UI) |
| `home()` | fly back to Earth |
| `getFocus()` | id of the entity the camera orbits |
| `getInfo(id)` | info object: name, kind, type label, rows (radius, mass, gravity, temperature, …), children, parent, discovered |
| `search(query)` | search real places, bookmarks, discoveries and loaded names → `[{id, name, kind}]` |
| `randomPlanet({n, from:'here', type, galaxy})` | deterministic id of a procedural planet (`type`: rocky/ocean/lava/ice/desert/gas) |
| `zoom(delta)`, `setZoom(ly, instant)`, `getZoom()` | orbit distance (light-years); in free-fly `zoom` moves forward |
| `look(dx, dy)` | rotate the view (pixels) |
| `fly(x, y, z)` | free-fly / walk input, each −1..1 (`z` forward, `y` up) |
| `setBoost(k)`, `getBoost()` | free-fly speed multiplier |
| `land(id?, {sunElevation, sunAzimuth}?)`, `takeOff()`, `canLand(id?)`, `getSurface()` | surface landing (optional sun position in degrees, e.g. `{sunElevation: 4}` for a sunset) |
| `setSunElevation(deg, az?)` | move the sun while landed |
| `setOrbits(on)`, `getOrbits()` | orbit lines (off by default; ◎ button; URL `orbits`; remembered in localStorage) |
| `setRealScale(on)`, `getRealScale()` | true sizes and distances on/off (event `se2:realscale`) |
| `pick(x, y)`, `screenPos(id)`, `getLabels()` | screen-space picking & labels |
| `getState()` | `{mode, scale, galaxy, system, focus, selected, distanceLy, distanceText, speedLyps, frame, position, galacticPosition, boost}` |
| `getSystem(id)` | stars & bodies of a system (deterministic JSON) |
| `nearbyStars(n)` | nearest stars to the camera (deterministic) |
| `getBookmarks()`, `addBookmark(id)`, `removeBookmark(id)`, `getDiscoveries()` | persistence (localStorage) |
| `setTimeSpeed(x)`, `getTimeSpeed()`, `getDate()` | orbital time |
| `setQuality(name)`, `getQuality()`, `getStats()` | quality tier + performance (fps, pixel ratio, draw calls, tier, hdr, realScale, terrain tiles, stars/galaxies/particles loaded) |
| `getMode()` | `orbit`, `flight`, `free`, `landing`, `surface`, `takeoff` |
| `getScale()` | `universe`, `galaxy`, `stars`, `system`, `planet`, `surface` |
| `enableJoystick(on)`, `fmtDist(ly)` | helpers |

### Events (on `window`, `CustomEvent.detail`)
`se2:ready {seed}`, `se2:selected {id, name, info}`, `se2:arrived {id, name}`, `se2:modechange {mode}`, `se2:scalechange {scale}`,
`se2:system {id, name}`, `se2:landed {id, name}`, `se2:tookoff {id, name}`, `se2:discovered {id, name}`, `se2:bookmarks {bookmarks}`, `se2:realscale {on}`.

### Example
```js
addEventListener('se2:ready', async () => {
  const id = SE2.randomPlanet({ type: 'ocean' });
  SE2.goTo(id);
  addEventListener('se2:arrived', () => SE2.land(id), { once: true });
});
```

## Credits
See `CREDITS.md`. Original code; inspired by the idea of universe-scale explorers but contains no code or assets from Space Engine.
