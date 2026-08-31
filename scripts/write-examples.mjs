#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'fs';
import { sampleCabin, samplePart, sampleGA, toJSON } from '../src/api.js';

mkdirSync('examples', { recursive: true });
const files = [
  ['examples/cabin.json', sampleCabin()],
  ['examples/part.json', samplePart()],
  ['examples/ga.json', sampleGA()]
];
files.forEach(([path, doc]) => {
  writeFileSync(path, toJSON(doc, true) + '\n');
  console.log(path, doc.entities.length, 'entities');
});
