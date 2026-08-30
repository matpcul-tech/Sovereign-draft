/* Architectural feet-and-inches formatting and parsing.
 * World units are decimal feet. Display rounds to a style's precision.
 */

export function fmtFtIn(ft, precision){
  const neg = ft < 0; ft = Math.abs(ft);
  const step = precision === '1/4' ? 4 : (precision === 'decimal' ? null : 2);
  if (step == null){
    const s = (Math.round(ft * 100) / 100).toFixed(2);
    return (neg ? '-' : '') + s + "'";
  }
  const denom = step === 4 ? 4 : 2;
  const ticks = Math.round(ft * 12 * denom) / denom;
  const f = Math.floor(ticks / 12);
  const inch = ticks - f * 12;
  const whole = Math.floor(inch + 1e-9);
  const frac = inch - whole;
  let fracStr = '';
  if (denom === 4){
    const q = Math.round(frac * 4);
    if (q === 1) fracStr = '¼';
    else if (q === 2) fracStr = '½';
    else if (q === 3) fracStr = '¾';
    else if (q === 4){ /* carry */ }
  } else if (frac > 0.25) fracStr = '½';
  let istr;
  if (denom === 4 && Math.round(frac * 4) === 4){
    istr = (whole + 1) + '"';
    if (whole + 1 >= 12) return (neg ? '-' : '') + (f + 1) + "'-0\"";
  } else {
    istr = whole + fracStr + '"';
  }
  const s = f > 0 ? f + "'-" + istr : istr;
  return (neg ? '-' : '') + s;
}

/* Parse a length typed at the command line.
 *   10        → 10 ft
 *   12'6"     → 12.5
 *   12'-6"    → 12.5
 *   6"        → 0.5
 *   0'-6"     → 0.5
 *   3.25      → 3.25
 */
export function parseLength(s){
  if (s == null) return NaN;
  s = String(s).trim().replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4').replace(/\s+/g, '');
  if (!s) return NaN;
  const frac = (n) => {
    if (n.includes('/')){
      const [a, b] = n.split('/');
      const A = parseFloat(a), B = parseFloat(b);
      return B ? A / B : NaN;
    }
    return parseFloat(n);
  };
  if (s.includes("'") || s.includes('"')){
    let feet = 0, inches = 0;
    const m = s.match(/^(-)?(?:(\d+(?:\.\d+)?)')?(?:-)?(?:(\d+(?:\.\d+)?(?:\/\d+)?)")?$/);
    if (!m) return NaN;
    const sign = m[1] ? -1 : 1;
    if (m[2]) feet = parseFloat(m[2]);
    if (m[3]) inches = frac(m[3]);
    if (!m[2] && !m[3]) return NaN;
    return sign * (feet + inches / 12);
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : NaN;
}

/* Parse "x,y" with optional length syntax on each component. */
export function parseXY(s){
  const parts = String(s).split(',');
  if (parts.length !== 2) return null;
  const x = parseLength(parts[0]), y = parseLength(parts[1]);
  if (!isFinite(x) || !isFinite(y)) return null;
  return [x, y];
}

/* AutoCAD-style next-point:
 *   10            distance along rubber-band (or last angle)
 *   12'6"         same
 *   10,20         absolute
 *   #24,36        absolute
 *   @8,0          relative cartesian
 *   @8<45         relative polar (degrees, CCW from +X)
 */
export function parsePoint(input, lastPt, rubberDir){
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;
  const last = lastPt || [0, 0];
  if (s[0] === '#'){
    const xy = parseXY(s.slice(1));
    return xy;
  }
  if (s[0] === '@'){
    const rest = s.slice(1);
    const lt = rest.indexOf('<');
    if (lt >= 0){
      const d = parseLength(rest.slice(0, lt));
      const a = parseFloat(rest.slice(lt + 1));
      if (!isFinite(d) || !isFinite(a)) return null;
      const rad = a * Math.PI / 180;
      return [last[0] + d * Math.cos(rad), last[1] + d * Math.sin(rad)];
    }
    const xy = parseXY(rest);
    if (!xy) return null;
    return [last[0] + xy[0], last[1] + xy[1]];
  }
  if (s.includes(',')) return parseXY(s);
  const d = parseLength(s);
  if (!isFinite(d)) return null;
  let dx = 1, dy = 0;
  if (rubberDir && (rubberDir[0] || rubberDir[1])){
    dx = rubberDir[0]; dy = rubberDir[1];
  }
  const L = Math.sqrt(dx * dx + dy * dy) || 1;
  return [last[0] + dx / L * d, last[1] + dy / L * d];
}

export function parseAngleDeg(s){
  const n = parseFloat(String(s).trim().replace(/°/g, ''));
  return isFinite(n) ? n : NaN;
}
