// Render/motion config. Real values (km, AU, days, hours) are compressed into scene units
// by the scale functions in scene.js. Facts for display live in ../planets.json.
// L0 = mean longitude at J2000 (deg) so planets start roughly where they really are today.
export const BODIES = [
  { name: 'Sun', type: 'star', radiusKm: 695700, dayHours: 609.1, tex: 'sun' },
  { name: 'Mercury', type: 'planet', parent: 'Sun', radiusKm: 2439.7, au: 0.387, yearDays: 87.97, dayHours: 1407.6, tilt: 0.03, incl: 7.0, L0: 252.25, tex: 'mercury' },
  { name: 'Venus', type: 'planet', parent: 'Sun', radiusKm: 6051.8, au: 0.723, yearDays: 224.70, dayHours: -5832.5, tilt: 177.4, incl: 3.4, L0: 181.98, tex: 'venus', atmo: 0xffd9a0 },
  { name: 'Earth', type: 'planet', parent: 'Sun', radiusKm: 6371.0, au: 1.0, yearDays: 365.256, dayHours: 23.934, tilt: 23.44, incl: 0, L0: 100.46, tex: 'earth', atmo: 0x6fb7ff, clouds: true },
  { name: 'Moon', type: 'moon', parent: 'Earth', radiusKm: 1737.4, km: 384400, yearDays: 27.32, dayHours: 655.7, tilt: 6.7, incl: 5.1, tex: 'moon', locked: true },
  { name: 'Mars', type: 'planet', parent: 'Sun', radiusKm: 3389.5, au: 1.524, yearDays: 686.98, dayHours: 24.623, tilt: 25.19, incl: 1.85, L0: 355.45, tex: 'mars', atmo: 0xffa070 },
  { name: 'Jupiter', type: 'planet', parent: 'Sun', radiusKm: 69911, au: 5.203, yearDays: 4332.59, dayHours: 9.925, tilt: 3.13, incl: 1.3, L0: 34.40, tex: 'jupiter', atmo: 0xf0d8b0 },
  { name: 'Io', type: 'moon', parent: 'Jupiter', radiusKm: 1821.6, km: 421700, yearDays: 1.769, tex: 'io', locked: true },
  { name: 'Europa', type: 'moon', parent: 'Jupiter', radiusKm: 1560.8, km: 671100, yearDays: 3.551, tex: 'europa', locked: true },
  { name: 'Ganymede', type: 'moon', parent: 'Jupiter', radiusKm: 2634.1, km: 1070400, yearDays: 7.155, tex: 'ganymede', locked: true },
  { name: 'Callisto', type: 'moon', parent: 'Jupiter', radiusKm: 2410.3, km: 1882700, yearDays: 16.689, tex: 'callisto', locked: true },
  { name: 'Saturn', type: 'planet', parent: 'Sun', radiusKm: 58232, au: 9.537, yearDays: 10759.22, dayHours: 10.656, tilt: 26.73, incl: 2.49, L0: 49.94, tex: 'saturn', rings: true, atmo: 0xf2e2b8 },
  { name: 'Enceladus', type: 'moon', parent: 'Saturn', radiusKm: 252.1, km: 238000, yearDays: 1.370, tex: 'enceladus', locked: true },
  { name: 'Titan', type: 'moon', parent: 'Saturn', radiusKm: 2574.7, km: 1221900, yearDays: 15.945, tex: 'titan', locked: true, atmo: 0xffb050 },
  { name: 'Uranus', type: 'planet', parent: 'Sun', radiusKm: 25362, au: 19.19, yearDays: 30688.5, dayHours: -17.24, tilt: 97.77, incl: 0.77, L0: 313.23, tex: 'uranus', atmo: 0xa8f0ff },
  { name: 'Neptune', type: 'planet', parent: 'Sun', radiusKm: 24622, au: 30.07, yearDays: 60195, dayHours: 16.11, tilt: 28.32, incl: 1.77, L0: 304.88, tex: 'neptune', atmo: 0x6f9bff },
  { name: 'Triton', type: 'moon', parent: 'Neptune', radiusKm: 1353.4, km: 354800, yearDays: -5.877, tex: 'triton', locked: true, incl: 23 },
];
