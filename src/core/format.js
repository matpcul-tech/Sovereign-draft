/* Architectural feet-and-inches formatting, rounded to the nearest half inch. */
export function fmtFtIn(ft){
  const neg = ft < 0; ft = Math.abs(ft);
  const half = Math.round(ft * 24) / 2;
  const f = Math.floor(half / 12), inch = half - f * 12;
  const frac = (inch - Math.floor(inch)) > 0.25 ? '½' : '';
  const istr = Math.floor(inch) + frac + '"';
  const s = f > 0 ? f + "'-" + istr : istr;
  return (neg ? '-' : '') + s;
}
