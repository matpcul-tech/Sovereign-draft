import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* Every free identifier a module calls has to come from somewhere.
 *
 * Three separate bugs in this codebase were a function used in a module that
 * never imported it: the constraint commands, and twice while wiring new
 * actions. Syntax checks pass, the build passes, and the tests pass, because
 * nothing evaluates that line until a user runs the command. This test walks
 * the source for calls to names a module is known to export and checks the
 * calling module actually imports them.
 */
function sources(dir){
  const out = [];
  for (const name of readdirSync(dir)){
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const ROOT = new URL('../src', import.meta.url).pathname;
const FILES = sources(ROOT);

/* Names exported somewhere in src, mapped to the file that exports them. */
const exported = new Map();
for (const f of FILES){
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/^export function ([A-Za-z_$][\w$]*)/gm)) {
    if (!exported.has(m[1])) exported.set(m[1], f);
  }
}

function importedNames(src){
  const names = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)){
    m[1].split(',').forEach(part => {
      const t = part.trim();
      if (!t) return;
      const as = t.split(/\s+as\s+/);
      names.add((as[1] || as[0]).trim());
    });
  }
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) names.add(m[1]);
  for (const m of src.matchAll(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  return names;
}

function declaredNames(src){
  const names = new Set();
  const pats = [
    /(?:^|\s)(?:export\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /(?:^|\s)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /(?:^|\s)(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g,
    /\b([A-Za-z_$][\w$]*)\s*(?:=|:)\s*(?:async\s*)?\(/g,
    /\b([A-Za-z_$][\w$]*)\s*(?:=|:)\s*(?:async\s*)?function/g
  ];
  for (const p of pats) for (const m of src.matchAll(p)) names.add(m[1]);
  /* Destructured bindings and parameters are close enough to catch by name. */
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}/g)){
    m[1].split(',').forEach(part => {
      const t = part.trim().split(/[:=]/)[0].trim();
      if (t) names.add(t);
    });
  }
  for (const m of src.matchAll(/function[^(]*\(([^)]*)\)/g)){
    m[1].split(',').forEach(part => {
      const t = part.trim().split(/[:=]/)[0].trim().replace(/^\.\.\./, '');
      if (t && /^[A-Za-z_$][\w$]*$/.test(t)) names.add(t);
    });
  }
  for (const m of src.matchAll(/\(([^)]*)\)\s*=>/g)){
    m[1].split(',').forEach(part => {
      const t = part.trim().split(/[:=]/)[0].trim().replace(/^\.\.\./, '');
      if (t && /^[A-Za-z_$][\w$]*$/.test(t)) names.add(t);
    });
  }
  for (const m of src.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1]);
  return names;
}

describe('every module imports what it calls', () => {
  it('no source file calls an exported function it never imported', () => {
    const problems = [];
    for (const f of FILES){
      const src = readFileSync(f, 'utf8');
      const imported = importedNames(src);
      const declared = declaredNames(src);
      const seen = new Set();
      for (const m of src.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g)){
        const name = m[1];
        if (seen.has(name)) continue;
        seen.add(name);
        if (!exported.has(name)) continue;      /* not one of ours */
        if (exported.get(name) === f) continue; /* defined right here */
        if (imported.has(name) || declared.has(name)) continue;
        problems.push(f.replace(ROOT, 'src') + ' calls ' + name +
          ' but never imports it (exported by ' + exported.get(name).replace(ROOT, 'src') + ')');
      }
    }
    expect(problems).toEqual([]);
  });
});
