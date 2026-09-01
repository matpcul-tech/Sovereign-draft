/* Solar position, the closed-form astronomy.
 *
 * A shadow study is a real deliverable: planning boards ask for them and
 * neighbours litigate over them, so the sun here is not a mood light. The
 * position comes from the standard declination and hour-angle formulas in
 * local solar time, and the tests hold it to almanac values: solstice and
 * equinox noon elevations to the tenth of a degree, due south at solar
 * noon in the northern hemisphere, elevation exactly zero at equinox
 * six o'clock. Refraction and the equation of time are omitted, stated
 * here rather than hidden: this is the geometry sun, accurate to well
 * under a degree, not an ephemeris.
 */

const RAD = Math.PI / 180;

export const MONTH_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
export const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function dayOfYear(month, day){
  const m = Math.min(12, Math.max(1, Math.round(Number(month) || 1)));
  const d = Math.min(31, Math.max(1, Math.round(Number(day) || 1)));
  return MONTH_DAYS[m - 1] + d;
}

export function monthFromName(name){
  const i = MONTH_NAMES.indexOf(String(name || '').slice(0, 3).toUpperCase());
  return i >= 0 ? i + 1 : null;
}

/* Cooper's declination: 23.45 sin(360 (284+n)/365). */
export function declination(n){
  return 23.45 * Math.sin(RAD * 360 * (284 + n) / 365);
}

/* Elevation and azimuth in degrees for local solar time. Azimuth is
 * measured from north, clockwise, so due east is 90 and due south 180. */
export function sunPosition(opts){
  const o = opts || {};
  const lat = Number(o.lat != null ? o.lat : 40);
  const hour = Number(o.hour != null ? o.hour : 12);
  const n = o.dayOfYear != null ? Number(o.dayOfYear) : dayOfYear(o.month, o.day);
  const dec = declination(n);
  const H = 15 * (hour - 12);
  const phi = lat * RAD, del = dec * RAD, h = H * RAD;
  const sinEl = Math.sin(phi) * Math.sin(del) + Math.cos(phi) * Math.cos(del) * Math.cos(h);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl))) / RAD;
  const cosAz = (Math.sin(del) - sinEl * Math.sin(phi)) / (Math.cos(el * RAD) * Math.cos(phi) || 1e-12);
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz))) / RAD;
  if (hour > 12) az = 360 - az;
  return { elevation: el, azimuth: az, declination: dec, dayOfYear: n };
}

/* Unit vector pointing FROM the model TOWARD the sun, in CAD coordinates:
 * x east, y north, z up. Below the horizon the vector still points where
 * the sun is; callers decide whether to light with it. */
export function sunVector(opts){
  const p = sunPosition(opts);
  const el = p.elevation * RAD, az = p.azimuth * RAD;
  return {
    x: Math.cos(el) * Math.sin(az),
    y: Math.cos(el) * Math.cos(az),
    z: Math.sin(el),
    elevation: p.elevation,
    azimuth: p.azimuth
  };
}

/* Parse the SUN command's arguments: "JUN 21 14 40.7", "6 21 14",
 * "OFF", or nothing for the default study sun. */
export function parseSun(rest){
  const toks = String(rest || '').trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return { month: 6, day: 21, hour: 14, lat: 40 };
  if (/^OFF$/i.test(toks[0])) return null;
  let month = monthFromName(toks[0]);
  if (month == null) month = Number(toks[0]);
  const day = Number(toks[1]);
  const hour = Number(toks[2]);
  const lat = Number(toks[3]);
  if (!Number.isFinite(month) || month < 1 || month > 12) throw new Error('SUN month day hour [lat], or SUN OFF');
  return {
    month: Math.round(month),
    day: Number.isFinite(day) ? day : 21,
    hour: Number.isFinite(hour) ? hour : 14,
    lat: Number.isFinite(lat) ? lat : 40
  };
}
