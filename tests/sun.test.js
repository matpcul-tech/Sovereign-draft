import { describe, it, expect } from 'vitest';
import { sunPosition, sunVector, declination, dayOfYear, parseSun, monthFromName } from '../src/core/sun.js';

/* The sun is held to the almanac, not to taste. */
describe('solar position matches the almanac', () => {
  it('solstice and equinox noon elevations at 40N', () => {
    /* Noon elevation = 90 - lat + declination. */
    const jun = sunPosition({ month: 6, day: 21, hour: 12, lat: 40 });
    expect(jun.elevation).toBeCloseTo(90 - 40 + jun.declination, 6);
    expect(jun.declination).toBeCloseTo(23.45, 1);
    const dec = sunPosition({ month: 12, day: 21, hour: 12, lat: 40 });
    expect(dec.elevation).toBeCloseTo(90 - 40 + dec.declination, 6);
    expect(dec.declination).toBeCloseTo(-23.45, 1);
    /* Equinox noon at 40N is 50 degrees, to the accuracy of Cooper's
     * declination on that date. */
    const eq = sunPosition({ month: 3, day: 21, hour: 12, lat: 40 });
    expect(eq.elevation).toBeCloseTo(50, 0);
  });

  it('the equator at equinox noon puts the sun overhead', () => {
    const p = sunPosition({ dayOfYear: 81, hour: 12, lat: 0 });
    expect(p.elevation).toBeGreaterThan(89.5);
  });

  it('solar noon is due south in the northern hemisphere', () => {
    expect(sunPosition({ month: 6, day: 21, hour: 12, lat: 40 }).azimuth).toBeCloseTo(180, 4);
    /* Morning east of south, afternoon west of it. */
    expect(sunPosition({ month: 6, day: 21, hour: 9, lat: 40 }).azimuth).toBeLessThan(180);
    expect(sunPosition({ month: 6, day: 21, hour: 15, lat: 40 }).azimuth).toBeGreaterThan(180);
  });

  it('equinox six o clock has the sun exactly on the horizon, due east', () => {
    /* At declination zero: sin(el) = cos(lat) cos(90 deg) = 0, exactly. */
    const p = sunPosition({ dayOfYear: 81, hour: 6, lat: 40 });
    expect(Math.abs(p.elevation)).toBeLessThan(0.05);
    expect(p.azimuth).toBeCloseTo(90, 0);
  });

  it('declination stays inside the tropics all year', () => {
    for (let n = 1; n <= 365; n += 7){
      expect(Math.abs(declination(n))).toBeLessThanOrEqual(23.45 + 1e-9);
    }
  });

  it('the sun vector is unit length and points up during the day', () => {
    const v = sunVector({ month: 6, day: 21, hour: 14, lat: 40 });
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 9);
    expect(v.z).toBeGreaterThan(0);
    /* Afternoon in the north: the sun stands south-west, so the vector
     * points south (negative y) and west (negative x, since x is east). */
    expect(v.y).toBeLessThan(0);
    expect(v.x).toBeLessThan(0);
  });

  it('dates and command parsing behave', () => {
    expect(dayOfYear(1, 1)).toBe(1);
    expect(dayOfYear(12, 31)).toBe(365);
    expect(monthFromName('June')).toBe(6);
    expect(parseSun('JUN 21 14 40.7')).toEqual({ month: 6, day: 21, hour: 14, lat: 40.7 });
    expect(parseSun('6 21 9')).toEqual({ month: 6, day: 21, hour: 9, lat: 40 });
    expect(parseSun('OFF')).toBe(null);
    expect(parseSun('')).toEqual({ month: 6, day: 21, hour: 14, lat: 40 });
    expect(() => parseSun('NOPE')).toThrow();
  });
});

describe('appearance is document data', () => {
  it('materials and the sun round trip through the project file', async () => {
    const { state, defaultLayers } = await import('../src/core/state.js');
    const { serializeProject, validateProject, applyProject } = await import('../src/io/project.js');
    state.entities = [];
    state.layers = defaultLayers();
    state.solids = [];
    state.idSeq = 1;
    state.materials = { ROOF: { color: '#7a3b2a', rough: 0.85, metal: 0 }, WALLS: { color: '#d8cfc0', rough: 0.7, metal: 0 } };
    state.sun = { month: 6, day: 21, hour: 14, lat: 40.7 };
    const p = validateProject(JSON.parse(serializeProject(state, true)));
    expect(p.materials.ROOF.color).toBe('#7a3b2a');
    expect(p.sun).toEqual({ month: 6, day: 21, hour: 14, lat: 40.7 });
    const target = { ...state, materials: {}, sun: null };
    applyProject(target, p);
    expect(target.materials.WALLS.rough).toBeCloseTo(0.7, 9);
    expect(target.sun.lat).toBeCloseTo(40.7, 9);
    /* Junk is dropped, not stored. */
    expect(validateProject({ ...JSON.parse(serializeProject(state, true)), materials: { X: { color: 'red' } }, sun: { month: 99 } }).sun).toBe(null);
  });

  it('saved 3D views round trip and junk views are dropped', async () => {
    const { state, defaultLayers } = await import('../src/core/state.js');
    const { serializeProject, validateProject, applyProject } = await import('../src/io/project.js');
    state.entities = [];
    state.layers = defaultLayers();
    state.solids = [];
    state.idSeq = 1;
    state.views3d = [
      { name: 'HERO', pos: [60, -40, 18], target: [12, 12, 6], fov: 50 },
      { name: 'AERIAL', pos: [80, 80, 90], target: [12, 12, 0], fov: 35 },
    ];
    const p = validateProject(JSON.parse(serializeProject(state, true)));
    expect(p.views3d.length).toBe(2);
    expect(p.views3d[0].pos).toEqual([60, -40, 18]);
    const target = { ...state, views3d: [] };
    applyProject(target, p);
    expect(target.views3d[1].name).toBe('AERIAL');
    expect(target.views3d[1].fov).toBeCloseTo(35, 9);
    /* Bad positions, duplicate names and wild fov never make it into the file. */
    const junk = validateProject({ ...JSON.parse(serializeProject(state, true)), views3d: [
      { name: 'ok', pos: [1, 2, 3], target: [0, 0, 0], fov: 500 },
      { name: 'OK', pos: [4, 5, 6], target: [0, 0, 0], fov: 50 },
      { name: 'BAD', pos: [1, 'x', 3], target: [0, 0, 0], fov: 50 },
      { pos: [1, 2, 3], target: [0, 0, 0], fov: 50 },
    ] });
    expect(junk.views3d.length).toBe(1);
    expect(junk.views3d[0].name).toBe('OK');
    expect(junk.views3d[0].fov).toBe(120);
  });

  it('the commands exist', async () => {
    const { lookupCommand } = await import('../src/core/command.js');
    expect(lookupCommand('SUN').action).toBe('sun');
    expect(lookupCommand('MAT').action).toBe('mat');
    expect(lookupCommand('RENDER').action).toBe('render');
    expect(lookupCommand('VIEW').action).toBe('view3dcam');
    expect(lookupCommand('VIEWS').action).toBe('view3dcam');
    expect(lookupCommand('TURNTABLE').action).toBe('turntable');
  });
});
