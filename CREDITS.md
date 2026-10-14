# Credits — Space Explorer X 2

Made by Nova Labs ⭐

Space Explorer X 2 reuses the Solar System textures, surface walker, joystick, audio and planet facts of Space Explorer (v1). Everything else is new, original work.

## Planet imagery
| File (scene/textures/) | Source | License |
|---|---|---|
| earth_day_2k.jpg, earth_day_4k.jpg | NASA Visible Earth – Blue Marble: Next Generation, "world.topo.bathy.200412" (Reto Stöckli, NASA Earth Observatory) https://visibleearth.nasa.gov/images/73909 | Public domain (NASA) |
| earth_night_2k.jpg | NASA Earth Observatory – Earth at Night / Black Marble 2012 "dnb_land_ocean_ice" (NASA Earth Observatory / NOAA NGDC, Suomi NPP VIIRS) https://earthobservatory.nasa.gov/images/79765 | Public domain (NASA) |
| earth_clouds_2k.jpg | NASA Visible Earth – Blue Marble clouds "cloud_combined_2048" https://visibleearth.nasa.gov/images/57747 | Public domain (NASA) |
| earth_specular_1k.jpg | Ocean mask derived by us from the Blue Marble image above | Public domain (derived) |
| sun_2k.jpg, mercury_2k.jpg, venus_atmosphere_2k.jpg, moon_2k.jpg, mars_2k.jpg, jupiter_2k.jpg, saturn_2k.jpg, saturn_ring_1k.png, uranus_2k.jpg, neptune_2k.jpg, stars_milky_way_2k.jpg | Solar System Scope (INOVE) – https://www.solarsystemscope.com/textures/ (based on NASA imagery); copies obtained via Wikimedia Commons ("Solarsystemscope texture 2k …"), resized/recompressed | CC BY 4.0 – https://creativecommons.org/licenses/by/4.0/ |

All textures were downscaled to ≤2048×1024 (Earth day map also 4096×2048, loaded only on capable devices) and recompressed as JPEG.

## Procedural content
Small-moon textures, Pluto/Charon, surface terrain, skies, starfield, sun glow and the fallback textures are generated in code (scene/textures.js, scene/surface.js) – original work.

## Procedural universe (SE2)
Galaxies, cosmic web, star fields, star systems, planets, moons, rings, atmospheres, black-hole lensing, accretion disks, pulsars, names,
lava/water seas and all procedural planet surfaces are generated in code (engine/*.js) — original work, no third-party assets.
Real-star data: Alpha Centauri, Proxima Centauri b/d, Sirius, Betelgeuse, TRAPPIST-1 (Agol et al. 2021) from published values; exoplanet appearances are imagined.

## Code
- three.js r160 – MIT License, © 2010-2023 three.js authors (scene/vendor/THREE-LICENSE)

## Facts
planets.json: NASA planetary fact sheets (nssdc.gsfc.nasa.gov) and NASA Science; moon counts as of NASA, July 2026.

## Rendering techniques (realism pass)
All shaders and code are original implementations of published, freely usable techniques:
ACES filmic curve (Stephen Hill's fitted approximation), CIE 1931 colour-matching analytic fit (Wyman, Sloan & Shirley 2013)
for blackbody colours, Kasten–Young air-mass formula, Henyey–Greenstein / Cornette–Shanks phase functions, single-scattering
Rayleigh + Mie atmosphere, dual-filter bloom with Karis averaging, GGX specular.
