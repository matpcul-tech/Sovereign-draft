/* Command registry, aliases, and AutoCAD-style numeric point input. */
import { parseLength, parsePoint, parseAngleDeg, fmtFtIn } from './format.js';

export const COMMANDS = {
  SELECT:  { aliases: ['SELECT', 'SEL', 'V'],           tool: 'select',  prompt: 'Select objects' },
  PAN:     { aliases: ['PAN', 'H'],                     tool: 'pan',     prompt: 'Pan' },
  LINE:    { aliases: ['LINE', 'L'],                    tool: 'line',    prompt: 'Specify first point' },
  PLINE:   { aliases: ['PLINE', 'POLY', 'P'],           tool: 'poly',    prompt: 'Specify start point' },
  RECT:    { aliases: ['RECT', 'RECTANGLE', 'REC'],     tool: 'rect',    prompt: 'Specify first corner' },
  CIRCLE:  { aliases: ['CIRCLE', 'C'],                  tool: 'circle',  prompt: 'Specify center point' },
  ARC:     { aliases: ['ARC', 'A'],                     tool: 'arc',     prompt: 'Specify start point of arc' },
  WALL:    { aliases: ['WALL', 'WL'],                   tool: 'wall',    prompt: 'Specify start of wall' },
  OFFSET:  { aliases: ['OFFSET', 'O'],                  tool: 'offset',  prompt: 'Specify offset distance', numeric: 'distance' },
  TRIM:    { aliases: ['TRIM', 'TR', 'X'],              tool: 'trim',    prompt: 'Select object to trim' },
  EXTEND:  { aliases: ['EXTEND', 'EX', 'E'],            tool: 'extend',  prompt: 'Select object to extend' },
  FILLET:  { aliases: ['FILLET', 'FILLE', 'B'],         tool: 'fillet',  prompt: 'Specify radius', numeric: 'radius' },
  CHAMFER: { aliases: ['CHAMFER', 'CHA', 'N'],          tool: 'chamfer', prompt: 'Specify chamfer distance', numeric: 'distance' },
  MIRROR:  { aliases: ['MIRROR', 'MI', 'I'],            tool: 'mirror',  prompt: 'Select objects to mirror' },
  SCALE:   { aliases: ['SCALE', 'SC', 'G'],             tool: 'scale',   prompt: 'Specify base point', numeric: 'factor' },
  ROTATE:  { aliases: ['ROTATE', 'RO'],                 tool: 'rotate',  prompt: 'Specify base point', numeric: 'angle' },
  MOVE:    { aliases: ['MOVE', 'W'],                    tool: 'move',    prompt: 'Specify base point' },
  COPY:    { aliases: ['COPY', 'CO', 'U'],              tool: 'copy',    prompt: 'Specify base point' },
  ARRAY:   { aliases: ['ARRAY', 'AR', 'Y'],             tool: 'array',   prompt: 'Select objects to array' },
  JOIN:    { aliases: ['JOIN', 'J'],                    tool: 'join',    prompt: 'Select objects to join' },
  HATCH:   { aliases: ['HATCH', 'HATCHING', 'K'],       tool: 'hatch',   prompt: 'Pick internal point or polyline' },
  DIM:     { aliases: ['DIM', 'DIMLIN', 'D'],           tool: 'dim',     prompt: 'Specify first extension origin' },
  DIMALI:  { aliases: ['DIMALIGNED', 'DIMALI', 'DAL'],  tool: 'dimali',  prompt: 'Specify first extension origin' },
  DIMCON:  { aliases: ['DIMCONTINUE', 'DIMCONT', 'DCO'], tool: 'dimcont', prompt: 'Specify next extension origin' },
  DIMBASE: { aliases: ['DIMBASELINE', 'DIMBASE', 'DBA'], tool: 'dimbase', prompt: 'Specify next extension origin' },
  TEXT:    { aliases: ['TEXT', 'T'],                    tool: 'text',    prompt: 'Specify start point of text' },
  MEASURE: { aliases: ['MEASURE', 'DIST', 'M'],         tool: 'measure', prompt: 'Specify first point' },
  ERASE:   { aliases: ['ERASE', 'ER', 'Q'],             tool: 'erase',   prompt: 'Select objects to erase' },
  SYMBOL:  { aliases: ['SYMBOL', 'BLOCK', 'S', 'INSERT'], tool: 'symbol', prompt: 'Specify insertion point' },
  EXPLODE: { aliases: ['EXPLODE', 'XP'],                 tool: null,     action: 'explode' },
  FLIP:    { aliases: ['FLIP'],                          tool: null,     action: 'flip' },
  ZFIT:    { aliases: ['ZOOMFIT', 'ZFIT'],              tool: null,     action: 'zoomfit' }
};

const ALIAS = {};
for (const [name, c] of Object.entries(COMMANDS)){
  for (const a of c.aliases) ALIAS[a] = name;
}

export function lookupCommand(s){
  if (!s) return null;
  const k = String(s).trim().toUpperCase();
  const name = ALIAS[k];
  if (!name) return null;
  return { name, ...COMMANDS[name] };
}

export function defaultPrompt(tool, state){
  const r = state && state.filletR != null ? state.filletR : 0.5;
  const d = state && state.chamferD != null ? state.chamferD : 0.5;
  const off = state && state.offsetDist != null ? state.offsetDist : 0.5;
  const map = {
    fillet:  'FILLET Specify radius <' + fmtFtIn(r) + '>:',
    chamfer: 'CHAMFER Specify distance <' + fmtFtIn(d) + '>:',
    offset:  'OFFSET Specify distance <' + fmtFtIn(off) + '>:',
    scale:   'SCALE Specify scale factor <1.0>:',
    rotate:  'ROTATE Specify rotation angle <90>:',
    line:    'LINE Specify next point:',
    poly:    'PLINE Specify next point:',
    rect:    'RECT Specify opposite corner:',
    circle:  'CIRCLE Specify radius:',
    arc:     'ARC Specify next point:',
    wall:    'WALL Specify next point:',
    dim:     'DIM Specify second extension origin:',
    dimali:  'DIMALIGNED Specify second origin:',
    dimcont: 'DIMCONTINUE Specify next origin:',
    dimbase: 'DIMBASELINE Specify next origin:',
    move:    'MOVE Specify destination:',
    copy:    'COPY Specify destination:',
    mirror:  'MIRROR Specify second point of mirror line:',
    array:   'ARRAY Specify columns,rows,colDist,rowDist:',
    hatch:   'HATCH Pick a closed shape or internal point:',
    measure: 'MEASURE Specify second point:',
    text:    'TEXT Specify start point:',
    select:  'SELECT objects:',
    trim:    'TRIM Select object to trim:',
    extend:  'EXTEND Select object to extend:',
    erase:   'ERASE Select object:',
    join:    'JOIN Select objects and press Enter:',
    symbol:  'INSERT Specify insertion point:'
  };
  return map[tool] || ((tool || 'Command') + ':');
}

export { parseLength, parsePoint, parseAngleDeg };
