/* Embeddable CAD. Hide the chrome, keep the drawing.
 *
 *   <script type="module" src="/src/embed.js"></script>
 *   <sovereign-draft src="plan.json"></sovereign-draft>
 *
 * Or iframe:  embed.html?src=plan.json
 * Or postMessage: { type: 'sovereign-draft', action: 'load', project }
 */
import { boot } from './main.js';
import { state, afterChange } from './core/state.js';
import { applyProject, validateProject } from './io/project.js';
import { zoomFit } from './core/viewport.js';
import { draw as redraw } from './render/draw.js';
import { open, openAsync, toPDF, toDXF, toDWG, toJSON, sheetset } from './api.js';

function params(){
  try { return new URLSearchParams(location.search || ''); }
  catch (e){ return new URLSearchParams(); }
}

export function isEmbed(){
  if (typeof document === 'undefined') return false;
  if (document.body && document.body.classList.contains('embed')) return true;
  const q = params();
  return q.get('embed') === '1' || q.has('embed') || q.has('src');
}

export function applyEmbedChrome(){
  if (typeof document === 'undefined') return;
  document.body.classList.add('embed');
  document.documentElement.classList.add('embed');
}

async function loadSrc(src){
  if (!src) return;
  const res = await fetch(src);
  if (!res.ok) throw new Error('Could not load ' + src);
  const url = String(src).toLowerCase();
  if (url.endsWith('.dwg')){
    const buf = await res.arrayBuffer();
    const doc = await openAsync(buf, src);
    applyProject(state, projectFromDoc(doc));
    return;
  }
  const text = await res.text();
  const doc = open(text, src);
  applyProject(state, projectFromDoc(doc));
}

function projectFromDoc(doc){
  return validateProject({
    name: doc.name,
    firm: doc.firm,
    layers: doc.layers,
    entities: doc.entities,
    layouts: doc.layouts,
    userBlocks: doc.userBlocks,
    dimStyles: doc.dimStyles,
    currentDimStyle: doc.currentDimStyle,
    currentLayout: doc.currentLayout,
    space: doc.space,
    dxfVer: doc.dxfVer,
    v: 7
  });
}

function reply(source, payload){
  if (source && source.postMessage) source.postMessage(payload, '*');
}

function onMessage(ev){
  const data = ev.data;
  if (!data || data.type !== 'sovereign-draft') return;
  const action = data.action;
  try {
    if (action === 'load' && data.project){
      applyProject(state, validateProject(data.project));
      afterChange(); zoomFit(); redraw();
      reply(ev.source, { type: 'sovereign-draft', action: 'loaded', name: state.projectName });
    } else if (action === 'sheetset'){
      const doc = sheetset({
        name: state.projectName, firm: state.firm, layers: state.layers,
        entities: state.entities, layouts: state.layouts, userBlocks: state.userBlocks
      });
      applyProject(state, projectFromDoc(doc));
      afterChange(); zoomFit(); redraw();
      reply(ev.source, { type: 'sovereign-draft', action: 'sheets', count: state.layouts.length });
    } else if (action === 'pdf'){
      const pdf = toPDF({
        name: state.projectName, firm: state.firm, layers: state.layers,
        entities: state.entities, layouts: state.layouts
      });
      reply(ev.source, { type: 'sovereign-draft', action: 'pdf', pdf });
    } else if (action === 'dxf'){
      reply(ev.source, { type: 'sovereign-draft', action: 'dxf', dxf: toDXF({ entities: state.entities, layers: state.layers, userBlocks: state.userBlocks, dxfVer: state.dxfVer }) });
    } else if (action === 'dwg'){
      const bytes = toDWG({
        entities: state.entities, layers: state.layers, userBlocks: state.userBlocks,
        storyHeight: state.storyHeight, heightAssumed: state.heightAssumed
      });
      reply(ev.source, { type: 'sovereign-draft', action: 'dwg', dwg: Array.from(bytes) });
    } else if (action === 'json'){
      reply(ev.source, { type: 'sovereign-draft', action: 'json', json: toJSON({
        name: state.projectName, firm: state.firm, layers: state.layers,
        entities: state.entities, layouts: state.layouts, userBlocks: state.userBlocks,
        dimStyles: state.dimStyles, currentDimStyle: state.currentDimStyle,
        currentLayout: state.currentLayout, space: state.space, dxfVer: state.dxfVer
      }) });
    }
  } catch (err){
    reply(ev.source, { type: 'sovereign-draft', action: 'error', message: err.message || String(err) });
  }
}

export async function mount(el, opts){
  const o = opts || {};
  if (o.embed !== false) applyEmbedChrome();
  const root = el || document.getElementById('app');
  const cleanup = boot(root);
  if (o.project){
    applyProject(state, validateProject(o.project));
    afterChange(); zoomFit(); redraw();
  } else if (o.src){
    await loadSrc(o.src);
    afterChange(); zoomFit(); redraw();
  }
  window.addEventListener('message', onMessage);
  window.parent && window.parent.postMessage({ type: 'sovereign-draft', action: 'ready' }, '*');
  return cleanup;
}

class SovereignDraftElement extends HTMLElement {
  async connectedCallback(){
    this.style.display = this.style.display || 'block';
    this.style.height = this.style.height || '100%';
    const root = document.createElement('div');
    root.style.height = '100%';
    this.appendChild(root);
    const src = this.getAttribute('src');
    this._cleanup = await mount(root, { src, embed: this.getAttribute('chrome') !== 'full' });
  }
  disconnectedCallback(){
    if (typeof this._cleanup === 'function') this._cleanup();
  }
}

export function defineElement(){
  if (typeof customElements === 'undefined') return;
  if (!customElements.get('sovereign-draft')) customElements.define('sovereign-draft', SovereignDraftElement);
}

if (typeof window !== 'undefined'){
  defineElement();
  const q = params();
  const auto = document.currentScript && document.currentScript.dataset.boot === '1';
  if (auto || q.has('src') || q.get('embed') === '1'){
    const start = () => {
      applyEmbedChrome();
      const app = document.getElementById('app') || document.body;
      mount(app, { src: q.get('src') || undefined, embed: true }).catch(err => {
        console.error(err);
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }
}
