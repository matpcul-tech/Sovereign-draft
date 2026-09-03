import { openSheet } from './sheets.js';

export function guideHTML(){
  return `
<div class="guide-sticky">
  <div class="guide-chrome">
    <div class="sovereign">
      <div class="pulse"></div>
      <div>
        <div class="sovlabel">SOVEREIGN</div>
        <div class="guide-title">The Field <b>Guide</b></div>
      </div>
    </div>
    <div class="tb-spacer"></div>
    <div class="guide-cmd" aria-hidden="true"><span>Command:</span> HELP</div>
    <button type="button" class="tb-btn" id="guideClose" aria-label="Close guide">
      <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
    </button>
  </div>
  <nav class="guide-toc" aria-label="Contents">
    <a href="#g-minute">One minute</a>
    <a href="#g-screen">The screen</a>
    <a href="#g-draw">Draw</a>
    <a href="#g-open">Openings</a>
    <a href="#g-build">Build</a>
    <a href="#g-touch">Touch</a>
    <a href="#g-light">Light</a>
    <a href="#g-print">Sheets</a>
    <a href="#g-cheats">Cheat sheet</a>
    <a href="#g-stuck">Stuck</a>
  </nav>
</div>

<div class="guide-body">
  <p class="guide-lede">One plan becomes a documented building. Draw, build, touch, light, print — in that order.
  Units are decimal feet; dimensions print to the nearest ½″. Type <kbd>HELP</kbd>, <kbd>GUIDE</kbd> or <kbd>?</kbd>. Esc closes this.</p>

  <section id="g-minute">
    <h2>The one-minute <i>building</i></h2>
    <p class="guide-want">See what this thing does</p>
    <p>A sample cabin loads with a finished plan and a five-sheet set (tabs: <kbd>Model</kbd> <kbd>G-001</kbd> <kbd>A-101</kbd>…). Then, on the <b>Build</b> tab of the bottom rail:</p>
    <ol class="guide-steps">
      <li>Tap <kbd>MODEL</kbd> — every wall becomes an exact solid; doors and windows cut real openings with headers and sills.</li>
      <li>Tap <kbd>ROOF</kbd> — a hip roof lands on the massing, valleys included.</li>
      <li>Tap <kbd>DORMER</kbd>, then tap the roof slope where you want it — a 6-ft gabled dormer seats itself there.</li>
      <li>Tap <kbd>DWGS</kbd> — the documentation set regenerates: plans, four hidden-line elevations, a section, a roof plan, all on numbered sheets.</li>
    </ol>
    <p>That loop — plan in, documented building out — is the reason this app exists.</p>
  </section>

  <section id="g-screen">
    <h2>The <i>screen</i></h2>
    <p class="guide-want">Know what you are looking at</p>
    <figure class="guide-fig">
      <svg viewBox="0 0 640 400" role="img" aria-label="Map of the app: top bar, command line, canvas, tool rail, status bar">
        <rect width="640" height="400" fill="#07101f"/>
        <rect x="0.5" y="0.5" width="639" height="399" fill="none" stroke="#1b2c4a"/>
        <rect x="0" y="0" width="640" height="44" fill="#0b1830"/>
        <line x1="0" y1="44" x2="640" y2="44" stroke="#1b2c4a"/>
        <circle cx="16" cy="22" r="4" fill="#00d4b8"/>
        <text x="26" y="18" fill="#00d4b8" font-size="8" font-family="Outfit,sans-serif" letter-spacing="1.6" font-weight="600">SOVEREIGN</text>
        <text x="26" y="32" fill="#e8e4dd" font-size="13" font-family="Georgia,serif">Sovereign <tspan fill="#d4a843" font-weight="600">Draft</tspan></text>
        <rect x="318" y="10" width="52" height="24" rx="8" fill="none" stroke="#d4a843"/>
        <text x="344" y="26" text-anchor="middle" fill="#d4a843" font-size="10" font-family="Outfit,sans-serif">Model</text>
        <rect x="374" y="10" width="46" height="24" rx="8" fill="#0d1b33" stroke="#1b2c4a"/>
        <text x="397" y="26" text-anchor="middle" fill="#8fa3c0" font-size="10" font-family="Outfit,sans-serif">G-001</text>
        <rect x="424" y="10" width="46" height="24" rx="8" fill="#0d1b33" stroke="#1b2c4a"/>
        <text x="447" y="26" text-anchor="middle" fill="#8fa3c0" font-size="10" font-family="Outfit,sans-serif">A-101</text>
        <rect x="0" y="44" width="640" height="32" fill="#07101f"/>
        <line x1="0" y1="76" x2="640" y2="76" stroke="#1b2c4a"/>
        <text x="12" y="64" fill="#d4a843" font-size="11" font-family="ui-monospace,monospace">Command:</text>
        <rect x="96" y="50" width="532" height="22" rx="8" fill="#0b1830" stroke="#1b2c4a"/>
        <text x="108" y="65" fill="#8fa3c0" font-size="11" font-family="ui-monospace,monospace">LINE  MODEL  ROOF  DORMER  HELP</text>
        <rect x="0" y="76" width="640" height="228" fill="#07101f"/>
        <text x="320" y="178" text-anchor="middle" fill="#8fa3c0" font-size="14" font-family="Outfit,sans-serif">Canvas — plan, sheet, or 3D</text>
        <text x="320" y="198" text-anchor="middle" fill="#5d7394" font-size="11" font-family="Outfit,sans-serif">wheel / pinch zooms · drag pans · double-tap refits a sheet</text>
        <rect x="0" y="304" width="640" height="64" fill="#0b1830"/>
        <line x1="0" y1="304" x2="640" y2="304" stroke="#1b2c4a"/>
        <text x="12" y="322" fill="#8fa3c0" font-size="9" font-family="Outfit,sans-serif" letter-spacing="1.8">DRAW · MODIFY · ISSUE · BUILD</text>
        <rect x="12" y="330" width="50" height="30" rx="8" fill="#0d1b33" stroke="#d4a843"/>
        <text x="37" y="348" text-anchor="middle" fill="#d4a843" font-size="9" font-family="Outfit,sans-serif">MODEL</text>
        <rect x="66" y="330" width="50" height="30" rx="8" fill="#0d1b33" stroke="#1b2c4a"/>
        <text x="91" y="348" text-anchor="middle" fill="#8fa3c0" font-size="9" font-family="Outfit,sans-serif">ROOF</text>
        <rect x="120" y="330" width="50" height="30" rx="8" fill="#0d1b33" stroke="#1b2c4a"/>
        <text x="145" y="348" text-anchor="middle" fill="#8fa3c0" font-size="9" font-family="Outfit,sans-serif">DORMER</text>
        <rect x="174" y="330" width="50" height="30" rx="8" fill="#0d1b33" stroke="#1b2c4a"/>
        <text x="199" y="348" text-anchor="middle" fill="#8fa3c0" font-size="9" font-family="Outfit,sans-serif">DWGS</text>
        <rect x="0" y="368" width="640" height="32" fill="#07101f"/>
        <line x1="0" y1="368" x2="640" y2="368" stroke="#1b2c4a"/>
        <text x="12" y="388" fill="#8fa3c0" font-size="10" font-family="ui-monospace,monospace">X 0'-0"   Y 0'-0"</text>
        <rect x="168" y="374" width="44" height="20" rx="4" fill="none" stroke="#00d4b8"/>
        <text x="190" y="388" text-anchor="middle" fill="#00d4b8" font-size="9" font-family="Outfit,sans-serif">SNAP</text>
        <text x="628" y="388" text-anchor="end" fill="#d4a843" font-size="10" font-family="ui-monospace,monospace" letter-spacing="1.4">MODEL</text>
      </svg>
      <figcaption>Four bands of chrome. Press <kbd>/</kbd> to jump to the command line. Esc backs out of whatever is happening.</figcaption>
    </figure>
  </section>

  <section id="g-draw">
    <h2>Draw a <i>plan</i></h2>
    <p class="guide-want">Walls of your own instead of the sample</p>
    <ol class="guide-steps">
      <li>Draw tab → <kbd>WALL</kbd>. Tap start, tap end. Keep tapping corners — walls heal as you draw: L-corners miter, T-junctions recut.</li>
      <li>Mid-draw, type a length and Enter: <code>12'6"</code> runs exactly that far. <code>@8<45</code> is 8 feet at 45°.</li>
      <li>Turn on <kbd>ORTHO</kbd> (status bar or F8) to keep walls square while you learn.</li>
      <li>Close the loop. A closed wall loop is a room-in-waiting.</li>
    </ol>
    <p>Thickness lives in the <kbd>WALL 6"</kbd> chip — tap it to cycle 4″ / 6″ / 8″. Neighbours: <kbd>L</kbd> line, <kbd>R</kbd> rectangle, <kbd>C</kbd> circle.</p>
    <h3>Dimensions</h3>
    <p>Tap <kbd>DIM</kbd>, two points, then where the dimension line sits. Dimensions are associative — stretch the wall and the number follows.</p>
    <p class="guide-note">Coming from AutoCAD? Type <code>KEYMAP ACAD</code> once and E erases, M moves, U undoes, X explodes. Full words work in both maps.</p>
  </section>

  <section id="g-open">
    <h2>Doors, windows, <i>rooms</i></h2>
    <p class="guide-want">A plan that reads like architecture</p>
    <ul class="guide-list">
      <li><b>Doors and windows</b> live under <kbd>SYMB</kbd>. Tap one, tap the wall — it cuts the host. Selected, drag the square to resize (type <code>2'6"</code> for exact), tap the diamond to flip swing.</li>
      <li><b>Rooms</b> — type <kbd>ROOMS</kbd>. Every closed wall loop becomes a named room with live area. Place <kbd>TEXT</kbd> inside a loop to name it.</li>
      <li><b>Fixtures</b> (stove, bed, tub) are in the same drawer, with rotate and flip grips.</li>
    </ul>
  </section>

  <section id="g-build">
    <h2>Make it <i>3D</i></h2>
    <p class="guide-want">The building, not just the plan</p>
    <p>The <b>Build</b> tab runs the pipeline in order, one tap each:</p>
    <ul class="guide-list">
      <li><kbd>MODEL</kbd> — walls become exact solids, openings cut through with headers and sills.</li>
      <li><kbd>STACK</kbd> — replicates the storey upward (type <code>STACK 3</code> for three).</li>
      <li><kbd>ROOF</kbd> — hip roof at 6:12. Type <code>ROOF GABLE 8</code> for a gable at 8:12. L- and T-shaped plans get real valleys.</li>
      <li><kbd>DORMER</kbd> — then tap the roof (in 3D or on the plan) where the dormer goes.</li>
      <li><kbd>DWGS</kbd> — regenerates the entire sheet set from the model.</li>
      <li><kbd>QTO</kbd> — takeoff table: footprint, surface, volume per solid, measured from the meshes.</li>
    </ul>
    <p>Freeform solids too: <code>BOX 0 0 0 10 8 6</code> types a box; a closed shape plus <code>EXTRUDE 10</code> raises it; <kbd>UNI</kbd> and <kbd>SUB</kbd> union and subtract (subtract is how you drill holes).</p>
    <p class="guide-note">Mesh, not Fusion. Not B-rep, not STEP, not a PE stamp. Faces are triangles.</p>
  </section>

  <section id="g-touch">
    <h2>Touch the <i>model</i></h2>
    <p class="guide-want">Grab the thing and change it</p>
    <p>Type <code>3D</code> (or tap the globe). Drag orbits, pinch or scroll zooms. <b>Tap a solid to select it</b> — then the left rail:</p>
    <ul class="guide-list">
      <li><kbd>EDIT</kbd> (<kbd>E</kbd> or <kbd>Tab</kbd>) — grab a corner, an edge, or the middle of a face and drag. A gable becomes a saltbox by pulling the ridge sideways.</li>
      <li><kbd>PUSH</kbd> (<kbd>P</kbd>) — drag any face along its own direction to thicken, extend, or carve.</li>
      <li><kbd>ROT</kbd> (<kbd>R</kbd>) — drag turns the solid in 15° steps.</li>
      <li><kbd>MEAS</kbd> (<kbd>M</kbd>) — tap two points for the true 3D distance.</li>
    </ul>
    <p>Everything snaps to real geometry. Mid-drag, type a number and Enter for an exact distance. Every change is one undo away.</p>
  </section>

  <section id="g-light">
    <h2>Light & <i>renders</i></h2>
    <p class="guide-want">A building, and a picture to show for it</p>
    <span class="gcmd"><b>SUN</b> JUN 21 14 40.7 <span>— the real sun: month, day, hour, latitude. True shadows.</span></span>
    <span class="gcmd"><b>MAT</b> ROOF #7a3b2a <span>— paint a solid, layer, or kind with a colour.</span></span>
    <span class="gcmd"><b>RENDER</b> 1600 <span>— a print-resolution still. Add PLACE to pin it on the drawing. Add LEVEL to keep verticals vertical.</span></span>
    <span class="gcmd"><b>VIEW SAVE</b> HERO <span>— remember this camera. VIEW HERO returns to it exactly.</span></span>
    <span class="gcmd"><b>WALK</b> 12 <span>— a 12-second flythrough of saved views, as video.</span></span>
    <span class="gcmd"><b>TURNTABLE</b> 8 <span>— one full orbit of the model, as video.</span></span>
  </section>

  <section id="g-print">
    <h2>Sheets & <i>printing</i></h2>
    <p class="guide-want">Paper, or the file a consultant asked for</p>
    <ul class="guide-list">
      <li>Top tabs are sheets. <kbd>G-001</kbd> is the cover. Wheel or pinch zooms inside a sheet; double-tap refits.</li>
      <li>Menu → <b>Export PDF</b> issues 24×36 pages, title block, ISO lineweights.</li>
      <li>Menu → <b>Export DXF</b> is R2000 — the AutoCAD Open path. <b>DWG</b> is the same content in a wrapper this app reopens.</li>
      <li><b>STL / OBJ / GLB</b> in the 3D view export the mesh. Not STEP.</li>
      <li>The drawing autosaves on this device. Menu → Save project writes the <code>.json</code>.</li>
    </ul>
  </section>

  <section id="g-cheats">
    <h2>Cheat <i>sheet</i></h2>
    <p class="guide-want">Commands on one screen</p>
    <div class="guide-sheet">
      <table>
        <caption>Type these</caption>
        <thead><tr><th>Command</th><th>What it does</th></tr></thead>
        <tbody>
          <tr><td>MODEL</td><td>Plan becomes named solids</td></tr>
          <tr><td>ROOF HIP 6</td><td>Hip roof at 6:12 (GABLE works too)</td></tr>
          <tr><td>DORMER 12 6 6</td><td>Dormer at plan point (12, 6), 6 ft wide</td></tr>
          <tr><td>STACK 2</td><td>Two storeys, roof rides to the top</td></tr>
          <tr><td>DRAWINGS HIP 6 SHEETS</td><td>The whole set on numbered sheets</td></tr>
          <tr><td>QTO</td><td>Takeoff table from the meshes</td></tr>
          <tr><td>SUN JUN 21 14 40.7</td><td>Real sun and shadows</td></tr>
          <tr><td>RENDER 1600 PLACE</td><td>Render, pinned to the drawing</td></tr>
          <tr><td>WALK 12</td><td>Flythrough video of saved views</td></tr>
          <tr><td>ROOMS</td><td>Live rooms with square footage</td></tr>
          <tr><td>SE</td><td>Section cut with a true hatched section</td></tr>
          <tr><td>KEYMAP ACAD</td><td>AutoCAD hands: E erase, M move, U undo, X explode</td></tr>
          <tr><td>2D / 3D</td><td>Plan and model</td></tr>
          <tr><td>HELP</td><td>This guide</td></tr>
        </tbody>
      </table>
    </div>
    <p class="guide-note">Full words always work. Feet-and-inches (<code>12'6"</code>) or metric (<code>3.6m</code>). Tap <kbd>FT</kbd> in the status bar to change what the screen shows.</p>
  </section>

  <section id="g-stuck">
    <h2>When you're <i>stuck</i></h2>
    <p class="guide-want">Get out</p>
    <ul class="guide-list">
      <li><kbd>Esc</kbd> cancels the current tool, drag, 3D view, or this guide. <kbd>Ctrl-Z</kbd> undoes anything — including MODEL, ROOF, and whole sheet regenerations.</li>
      <li>Toasts at the bottom are honest. If a button needs something first, the message names it (<i>Nothing to roof: MODEL first</i>).</li>
      <li>Build order: <b>MODEL before ROOF before DORMER</b>. Walls first, always.</li>
      <li>A fresh visit (or a private window) replays the built-in tour where the cabin builds itself.</li>
    </ul>
    <p class="guide-foot">Free, no account. Mesh 3D, not Parasolid. Issued 2D is the print of record. No PE stamp.</p>
  </section>
</div>`;
}

export function bindGuide(root){
  if (!root) return;
  root.querySelectorAll('.guide-toc a').forEach(a => {
    a.addEventListener('click', ev => {
      ev.preventDefault();
      const id = (a.getAttribute('href') || '').replace('#', '');
      const el = id && root.querySelector('#' + id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

export function openGuide(){
  const root = document.getElementById('sheetGuide');
  if (!root) return;
  if (!root.dataset.bound){
    bindGuide(root);
    root.dataset.bound = '1';
  }
  openSheet('sheetGuide');
  const body = root.querySelector('.guide-body');
  if (body) body.scrollTop = 0;
  else root.scrollTop = 0;
}
