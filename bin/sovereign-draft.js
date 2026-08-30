#!/usr/bin/env node
/* Plot a drawing from the command line. No browser.
 *
 *   sovereign-draft plan.json --pdf plan.pdf
 *   sovereign-draft plan.dxf --dxf out.dxf --sheets
 *   sovereign-draft --prompt "24x36 cabin, 3 rooms" --pdf cabin.pdf
 *   sovereign-draft rocket.dwg --json rocket.json
 */
import { readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';
import { open, openAsync, draw, sheetset, toPDF, toDXF, toJSON, toSVG, toHTML, sampleCabin } from '../src/api.js';

function parseArgs(argv){
  const opts = { files: [] };
  for (let i = 0; i < argv.length; i++){
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--prompt') opts.prompt = next();
    else if (a === '--pdf') opts.pdf = next();
    else if (a === '--dxf') opts.dxf = next();
    else if (a === '--json') opts.json = next();
    else if (a === '--svg') opts.svg = next();
    else if (a === '--html') opts.html = next();
    else if (a === '--name') opts.name = next();
    else if (a === '--key') opts.apiKey = next();
    else if (a === '--model') opts.model = next();
    else if (a === '--sheets') opts.sheets = true;
    else if (a === '--model-pdf') opts.modelPdf = true;
    else if (a === '--sample') opts.sample = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('-')) throw new Error('Unknown flag ' + a);
    else opts.files.push(a);
  }
  return opts;
}

function help(){
  return [
    'sovereign-draft — cheapest CAD, from a file or a sentence',
    '',
    '  sovereign-draft <file.json|.dxf|.dwg> --pdf out.pdf',
    '  sovereign-draft <file> --dxf out.dxf',
    '  sovereign-draft <file> --json out.json',
    '  sovereign-draft <file> --svg out.svg',
    '  sovereign-draft <file> --html out.html',
    '  sovereign-draft --sheets <file> --pdf set.pdf',
    '  sovereign-draft --prompt "24x36 cabin" --pdf cabin.pdf',
    '  sovereign-draft --sample --pdf cabin.pdf',
    '',
    'ANTHROPIC_API_KEY (or --key) is required for --prompt.',
    'PDF is written as latin1. JSON is the git source of truth.'
  ].join('\n');
}

async function loadDoc(opts){
  if (opts.sample) return sampleCabin();
  if (opts.prompt){
    return draw(opts.prompt, {
      apiKey: opts.apiKey,
      model: opts.model,
      name: opts.name,
      sheets: opts.sheets !== false
    });
  }
  const file = opts.files[0];
  if (!file) throw new Error('Pass a file, --prompt, or --sample. Try --help.');
  const buf = readFileSync(file);
  const name = opts.name || basename(file);
  const lower = file.toLowerCase();
  if (lower.endsWith('.dwg')) return openAsync(buf, name);
  if (lower.endsWith('.json')) return open(buf.toString('utf8'), name);
  return open(buf.toString('latin1'), name);
}

async function main(){
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || (!opts.files.length && !opts.prompt && !opts.sample && !opts.pdf && !opts.dxf && !opts.json && !opts.svg && !opts.html)){
    console.log(help());
    process.exit(opts.help ? 0 : 1);
  }
  let doc = await loadDoc(opts);
  if (opts.sheets && !opts.prompt && !opts.sample) doc = sheetset(doc, { name: opts.name || doc.name });
  if (opts.name) doc.name = opts.name;
  if (opts.pdf){
    const pdf = toPDF(doc, { model: !!opts.modelPdf });
    writeFileSync(opts.pdf, pdf, 'latin1');
    console.log('wrote ' + opts.pdf + (doc.layouts ? ' (' + doc.layouts.length + ' sheets)' : ''));
  }
  if (opts.dxf){
    writeFileSync(opts.dxf, toDXF(doc), 'utf8');
    console.log('wrote ' + opts.dxf);
  }
  if (opts.json){
    writeFileSync(opts.json, toJSON(doc, true), 'utf8');
    console.log('wrote ' + opts.json);
  }
  if (opts.svg){
    writeFileSync(opts.svg, toSVG(doc), 'utf8');
    console.log('wrote ' + opts.svg);
  }
  if (opts.html){
    writeFileSync(opts.html, toHTML(doc), 'utf8');
    console.log('wrote ' + opts.html);
  }
  if (!opts.pdf && !opts.dxf && !opts.json && !opts.svg && !opts.html){
    writeFileSync(1, toJSON(doc, true) + '\n');
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
