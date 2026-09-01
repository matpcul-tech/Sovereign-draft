/* CAD chrome. Injected into the React host so the kernel stays vanilla JS. */

const SVG = {
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg>',
  fit: '<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
  props: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 12h8M8 15h5"/></svg>'
};

function tool(id, label, title, path){
  return `<button class="tool" data-tool="${id}" title="${title}"><svg viewBox="0 0 24 24">${path}</svg><span>${label}</span></button>`;
}

export function shellHTML(){
  return `
<div id="wrap"><canvas id="cv"></canvas></div>
<div id="hint" class="empty">
  <h2>CAD editor</h2>
  <p>Open a DXF or DWG, drop a file, or tap <span class="k">AI</span> to describe a plan.<br>
  Type <span class="k">SHEETSET</span> to break a build into pages with a legend on each sheet.</p>
  <div class="hint-actions">
    <button type="button" id="hintOpen">Open drawing</button>
    <button type="button" id="hintSample">Sample cabin</button>
  </div>
</div>
<div id="topbar">
  <div class="sovereign">
    <div class="pulse"></div>
    <div>
      <div class="sovlabel">SOVEREIGN</div>
      <div id="title">Sovereign <b>Draft</b></div>
    </div>
  </div>
  <div class="tb-spacer"></div>
  <div id="spacetabs">
    <button class="stab on" data-space="model">Model</button>
    <button class="stab" data-space="layout" id="tabLayout">A-1</button>
  </div>
  <button class="tb-btn" id="btnUndo" aria-label="Undo">${SVG.undo}</button>
  <button class="tb-btn" id="btnRedo" aria-label="Redo">${SVG.redo}</button>
  <button class="tb-btn" id="btn3d" aria-label="3D orbit">
    <svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="9" ry="4"/><path d="M3 12c2 6 6 9 9 9s7-3 9-9"/><path d="M3 12c2-6 6-9 9-9s7 3 9 9"/></svg>
  </button>
  <button class="tb-btn" id="btnFit" aria-label="Zoom to fit">${SVG.fit}</button>
  <button class="tb-btn" id="btnProps" aria-label="Properties">${SVG.props}</button>
  <button class="tb-btn" id="btnMenu" aria-label="Menu">${SVG.menu}</button>
</div>
<div id="cmdline">
  <span id="cmdprompt">Command:</span>
  <input id="cmdinput" autocomplete="off" spellcheck="false" placeholder="LINE  FILLET  SHEETSET  12'6"">
</div>
<div id="bottom">
  <div id="ctxrow">
    <button class="chip gold" id="chipAI">AI</button>
    <button class="chip" id="chipLayer"><span class="sw" id="chipLayerSw"></span><span id="chipLayerNm">WALLS</span></button>
    <button class="chip on" id="chipSnap">SNAP</button>
    <button class="chip" id="chipOrtho">ORTHO</button>
    <button class="chip" id="chipPolar">POLAR</button>
    <button class="chip" id="chipWall">WALL 6"</button>
    <button class="chip" id="chipLt">LT CONT</button>
    <button class="chip" id="chipLw">LW DEF</button>
    <button class="chip" id="chipDimSt">DIM ARCH</button>
    <button class="chip" id="chipHatchPat" style="display:none">ANSI31</button>
    <button class="chip" id="chipBox" style="display:none">BOX SELECT</button>
    <button class="chip" id="chipOffDist" style="display:none">OFFSET 6"</button>
    <button class="chip" id="chipFilletR" style="display:none">RADIUS 6"</button>
    <button class="chip" id="chipChamferD" style="display:none">CHAMFER 6"</button>
    <button class="chip" id="chipClose" style="display:none">Close shape</button>
    <button class="chip" id="chipDone" style="display:none">Done</button>
    <button class="chip warn" id="chipDelete" style="display:none">Delete</button>
    <button class="chip" id="chipRotate" style="display:none">Rotate 90°</button>
    <button class="chip" id="chipDup" style="display:none">Duplicate</button>
    <button class="chip" id="chipAssign" style="display:none">Layer</button>
    <button class="chip" id="chipBlock" style="display:none">Save block</button>
    <button class="chip" id="chipExplode" style="display:none">Explode</button>
    <button class="chip" id="chipEditTxt" style="display:none">Edit text</button>
    <button class="chip" id="chipFlip" style="display:none">Flip dim</button>
    <button class="chip" id="chipDoor" style="display:none">Door</button>
    <button class="chip" id="chipWindow" style="display:none">Window</button>
  </div>
  <div id="toolstrip">
    <div class="toolrow-label">Draw</div>
    <div id="toolrow-draw" class="toolrow">
      ${tool('select','SELECT','Select (V)','<path d="M5 3l14 7-6 2-2 6z"/>')}
      ${tool('pan','PAN','Pan (H)','<path d="M12 3v18M3 12h18"/><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9 3 12l3 3M18 9l3 3-3 3"/>')}
      ${tool('line','LINE','Line (L)','<path d="M5 19 19 5"/><circle cx="5" cy="19" r="1.5"/><circle cx="19" cy="5" r="1.5"/>')}
      ${tool('poly','POLY','Polyline (P)','<path d="M4 18 9 7l6 8 5-11"/>')}
      ${tool('rect','RECT','Rectangle (R)','<rect x="4" y="6" width="16" height="12" rx="1"/>')}
      ${tool('circle','CIRCLE','Circle (C)','<circle cx="12" cy="12" r="8"/>')}
      ${tool('arc','ARC','3-point Arc (A)','<path d="M5 18a9 9 0 0 1 14-12"/>')}
      ${tool('wall','WALL','Wall','<path d="M4 8h16M4 16h16M4 8v8M20 8v8"/>')}
      ${tool('xline','XLINE','Construction line (XL)','<path d="M3 21 21 3"/><path d="M3 3h.01M21 21h.01"/>')}
      ${tool('grid','GRID','Column grid','<path d="M4 4h16v16H4zM4 10h16M4 16h16M10 4v16M16 4v16"/>')}
      ${tool('symbol','SYMB','Symbols (S)','<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><path d="M17 13v8M13 17h8"/>')}
      ${tool('dim','DIM','Dimension (D)','<path d="M4 6v12M20 6v12M4 12h16"/>')}
      ${tool('dimali','ALN','Aligned dim','<path d="M5 19 19 5M7 17h3M14 7h3"/>')}
      ${tool('text','TEXT','Text (T)','<path d="M5 6V4h14v2M12 4v16M9 20h6"/>')}
      ${tool('hatch','HATCH','Hatch (K)','<path d="M4 20 20 4M4 14l10-10M4 8l4-4M10 20l10-10M16 20l4-4"/>')}
      ${tool('ellipse','ELPS','Ellipse','<ellipse cx="12" cy="12" rx="8" ry="5"/>')}
      ${tool('cloud','CLOUD','Revision cloud','<path d="M5 16a3 3 0 0 1 1-5 4 4 0 0 1 7-2 4 4 0 0 1 6 4 3 3 0 0 1-1 6H6"/>')}
      ${tool('leader','LEAD','Leader','<path d="M4 20 14 8M14 8h6M14 8v6"/>')}
      ${tool('image','IMG','Image underlay','<rect x="3" y="5" width="18" height="14" rx="1"/><circle cx="9" cy="11" r="2"/><path d="m21 16-5-5-4 4-2-2-5 5"/>')}
      ${tool('measure','MEAS','Measure (M)','<path d="m3 17 4 4L21 7l-4-4z"/>')}
      ${tool('erase','ERASE','Erase (Q)','<path d="M19 13 9 3 3 9l10 10h6"/>')}
    </div>
    <div class="toolrow-label">Modify</div>
    <div id="toolrow-mod" class="toolrow">
      ${tool('offset','OFFS','Offset (O)','<path d="M5 4v16M12 4v16"/><path d="m16 8 4 4-4 4"/>')}
      ${tool('trim','TRIM','Trim (X)','<path d="M8 8 21 21M8 16 21 3"/>')}
      ${tool('extend','EXT','Extend (E)','<path d="M3 12h11"/><path d="m11 8 4 4-4 4"/><path d="M19 5v14"/>')}
      ${tool('fillet','FILLET','Fillet (B)','<path d="M5 19V5h6"/><path d="M11 5a8 8 0 0 1 8 8v6"/>')}
      ${tool('chamfer','CHAM','Chamfer (N)','<path d="M5 19V5h8l6 6v8z"/>')}
      ${tool('mirror','MIRR','Mirror (I)','<path d="M12 3v18M5 8l7 4-7 4M19 8l-7 4 7 4"/>')}
      ${tool('scale','SCALE','Scale (G)','<path d="M4 20V8h12"/><path d="M8 4h12v12"/>')}
      ${tool('rotate','ROT','Rotate by angle','<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>')}
      ${tool('move','MOVE','Move (W)','<path d="M5 12h14"/><path d="m15 8 4 4-4 4"/>')}
      ${tool('copy','COPY','Copy (U)','<rect x="8" y="8" width="10" height="10" rx="1"/><path d="M6 16V6h10"/>')}
      ${tool('array','ARRAY','Array (Y)','<rect x="3" y="3" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/><rect x="3" y="15" width="6" height="6"/><rect x="15" y="15" width="6" height="6"/>')}
      ${tool('arraypolar','POLAR','Polar array','<circle cx="12" cy="12" r="2"/><circle cx="12" cy="4" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="12" cy="20" r="2"/><circle cx="5" cy="12" r="2"/>')}
      ${tool('join','JOIN','Join (J)','<path d="M4 12h6M14 12h6M10 8v8M14 8v8"/>')}
      ${tool('dimcont','CONT','Continue dim','<path d="M4 12h7M13 12h7M4 8v8M11 8v8M20 8v8"/>')}
      ${tool('dimbase','BASE','Baseline dim','<path d="M4 18h16M4 12h12M4 6h8"/>')}
      ${tool('dimang','ANG','Angular dim','<path d="M12 20a8 8 0 0 1 0-16"/><path d="M12 12h8M12 12v-8"/>')}
      ${tool('dimrad','RAD','Radius dim','<circle cx="12" cy="12" r="8"/><path d="M12 12 18 7"/>')}
      ${tool('dimdia','DIA','Diameter dim','<circle cx="12" cy="12" r="8"/><path d="M5 12h14"/>')}
      ${tool('stretch','STR','Stretch','<path d="M4 8h10v8H4zM14 10h6v4h-6"/>')}
      ${tool('match','MATCH','Match properties','<path d="M7 4h6l4 4v12H7z"/><path d="M13 4v4h4"/><path d="m8 14 2 2 4-4"/>')}
      ${tool('area','AREA','Area','<path d="M4 20V8l6-4 6 4v12z"/>')}
      ${tool('list','LIST','List object','<path d="M8 6h12M8 12h12M8 18h8M4 6h.01M4 12h.01M4 18h.01"/>')}
      ${tool('schedule','SCH','Place schedule','<path d="M4 4h16v16H4zM4 9h16M9 4v16"/>')}
    </div>
    <div class="toolrow-label">Issue</div>
    <div id="toolrow-issue" class="toolrow">
      ${tool('section','SECT','Section cut (SE)','<path d="M4 20 20 4"/><path d="M8 4v4M16 16v4"/><path d="M5 8h3M16 16h3"/>')}
      ${tool('detail','DET','Isolated detail','<circle cx="12" cy="12" r="7"/><path d="M12 8v8M8 12h8"/>')}
      ${tool('fcf','FCF','Feature control frame','<rect x="3" y="8" width="6" height="8"/><rect x="9" y="8" width="7" height="8"/><rect x="16" y="8" width="5" height="8"/>')}
      ${tool('datum','DATUM','Datum feature','<rect x="8" y="6" width="8" height="8"/><path d="m8 14 4 5 4-5"/>')}
      ${tool('finish','SF','Surface finish','<path d="M5 18 9 6l6 10"/>')}
      ${tool('view3d','3D','Orbit 3D (3D)','<ellipse cx="12" cy="12" rx="9" ry="4"/><path d="M3 12c2 6 6 9 9 9s7-3 9-9"/>')}
    </div>
  </div>
</div>
<div id="statusbar">
  <span id="stXY">X 0'-0"&nbsp;&nbsp;Y 0'-0"</span>
  <span id="stLen">L —</span>
  <span id="stAng">A —</span>
  <button type="button" id="stSnap" class="on">SNAP</button>
  <button type="button" id="stOrtho">ORTHO</button>
  <button type="button" id="stPolar">POLAR</button>
  <button type="button" id="stWall">WALL</button>
  <button type="button" id="stUnits">FT</button>
  <span id="stSpace">MODEL</span>
  <span id="stHeight">H 8'-0" · ASSUMED</span>
</div>
<div id="backdrop"></div>
<div class="sheet" id="sheetLayers">
  <h3><i>Layers</i></h3>
  <div id="assignNote">Tap a layer to move the selection onto it</div>
  <div id="layerlist"></div>
  <button class="addlayer" id="btnAddLayer">+ New layer</button>
</div>
<div class="sheet" id="sheetSymbols">
  <h3><i>Symbols</i></h3>
  <div id="symgrid"></div>
  <div id="blkwrap" style="display:none">
    <h4>Your blocks</h4>
    <div id="blkgrid"></div>
  </div>
  <div class="subtle">Pick one, then tap the sheet to place it. Doors and windows cut walls they land on.</div>
</div>
<div class="sheet" id="sheetAI">
  <h3><i>AI</i> Drafting</h3>
  <textarea id="aiprompt" placeholder="Two bed one bath cabin, 24 by 36 feet, front porch, kitchen on the north wall"></textarea>
  <button class="chip on" id="chipCtx" style="margin-top:10px">Sheet context: ON</button>
  <button class="primary" id="btnGenerate">Generate blueprint</button>
  <div id="aistatus"></div>
  <div class="subtle">Grok drafts for free in this app — plans, elevations, sections and parts. A rocket comes back as an outline with callouts, not as a floor plan. AI only adds; undo drops a pass. Optional Anthropic key if you want your own model.</div>
  <button class="linkish" id="btnAISettings">AI settings…</button>
</div>
<div class="sheet" id="sheetSettings">
  <h3><i>AI settings</i></h3>
  <h4>Anthropic API key (optional)</h4>
  <input id="setKey" type="password" class="field" placeholder="sk-ant-... fallback only" autocomplete="off" style="height:44px">
  <h4>Model</h4>
  <select id="setModel" class="field" style="height:44px">
    <option value="claude-opus-4-5">Claude Opus 4.5</option>
    <option value="claude-sonnet-4-5">Claude Sonnet 4.5</option>
    <option value="claude-haiku-4-5">Claude Haiku 4.5</option>
    <option value="claude-opus-5">Claude Opus 5</option>
    <option value="claude-sonnet-5">Claude Sonnet 5</option>
  </select>
  <button class="primary" id="btnSaveSettings">Save settings</button>
  <div class="subtle">Grok is the default drafter and needs no key. An Anthropic key is stored only in this browser and sent only to api.anthropic.com if Grok is unavailable.</div>
</div>
<div class="sheet" id="sheetScript">
  <h3><i>Script</i></h3>
  <div style="display:flex;gap:8px">
    <select id="scList" class="field" style="height:40px;flex:1"></select>
    <input id="scName" type="text" class="field" placeholder="MY SCRIPT" style="height:40px;flex:1">
  </div>
  <textarea id="scCode" class="field" spellcheck="false" style="height:180px;font-family:ui-monospace,monospace;font-size:12px;margin-top:8px" placeholder="sd.add.line(0, 0, 20, 0);&#10;print('drew a line');"></textarea>
  <div style="display:flex;gap:8px;margin-top:8px">
    <button class="primary" id="scRun" style="flex:1;height:42px">Run</button>
    <button id="scSave" style="flex:1;height:42px">Save</button>
    <button id="scDelete" style="height:42px">x</button>
  </div>
  <pre id="scOut" class="cmdhist" style="max-height:120px;overflow:auto;margin-top:8px"></pre>
  <div class="subtle">JavaScript against the sd API: sd.add.line/circle/poly/spline/text/note/hatch/dim, sd.query.byType/byLayer/where, sd.move/rotate/scale/mirror/copy/delete, sd.boolean, sd.measure, sd.layer, print(). A run is one undo step; a script that throws is rolled back completely.</div>
</div>
<div class="sheet" id="sheetDraft">
  <h3><i>Drafting standards</i></h3>
  <h4>Working scale (annotative text)</h4>
  <select id="dsScale" class="field" style="height:44px">
    <option value="9">1/8" = 1'-0"</option>
    <option value="13.5">3/16" = 1'-0"</option>
    <option value="18">1/4" = 1'-0"</option>
    <option value="27">3/8" = 1'-0"</option>
    <option value="36">1/2" = 1'-0"</option>
    <option value="72">1" = 1'-0"</option>
  </select>
  <h4>Plot style</h4>
  <select id="dsPlot" class="field" style="height:44px"></select>
  <h4>Text style</h4>
  <select id="dsTextStyle" class="field" style="height:44px"></select>
  <h4>Layer states</h4>
  <div id="dsStates"></div>
  <div style="display:flex;gap:8px;margin-top:6px">
    <input id="dsStateName" type="text" class="field" placeholder="STRUCTURE ONLY" style="height:40px;flex:1">
    <button class="primary" id="dsSaveState" style="height:40px">Save current</button>
  </div>
  <h4>Constraints on selection</h4>
  <div id="dsCons" class="subtle">Nothing selected</div>
  <div style="display:flex;gap:8px;margin-top:6px">
    <button class="primary" id="dsSolve" style="height:40px;flex:1">Solve</button>
    <button id="dsUnconstrain" style="height:40px;flex:1">Remove from selection</button>
  </div>
</div>
<div class="sheet" id="sheetText">
  <h3><i>Text</i></h3>
  <input id="txtval" type="text" class="field" placeholder="KITCHEN" style="height:44px">
  <button class="primary" id="btnPlaceText">Place text</button>
</div>
<div class="sheet" id="sheetBlock">
  <h3><i>Save block</i></h3>
  <input id="blkname" type="text" class="field" placeholder="Kitchen island" style="height:44px">
  <button class="primary" id="btnSaveBlock">Save selection as block</button>
</div>
<div class="sheet" id="sheetPDF">
  <h3><i>Export PDF</i></h3>
  <div class="subtle" style="margin-top:0">Plots the active layout at a true architectural scale. Switch to a layout tab first for title-block sheets.</div>
  <div id="pdfscl">
    <button class="chip on" data-ppf="fit">FIT</button>
    <button class="chip" data-ppf="9">1/8"</button>
    <button class="chip" data-ppf="18">1/4"</button>
    <button class="chip" data-ppf="36">1/2"</button>
  </div>
  <button class="primary" id="btnExportPDF">Export PDF</button>
</div>
<div class="sheet" id="sheetLayouts">
  <h3><i>Sheet set</i></h3>
  <div class="subtle" style="margin-top:0">Break the model into pages — cover, overall, and one sheet per room or labeled section, each with its own legend.</div>
  <button class="primary" id="btnSheetSet">Generate sheet set</button>
  <div id="layoutlist"></div>
  <button class="addlayer" id="btnAddSheet">+ New sheet</button>
  <button class="addlayer" id="btnAddView">+ Add view to this sheet</button>
  <button class="addlayer" id="btnAddDetail">+ Detail callout to next sheet</button>
  <h4>Sheet size</h4>
  <div id="sheetSizes" class="chiprow">
    <button class="chip" data-sheet="letter">Letter</button>
    <button class="chip" data-sheet="tabloid">Tabloid</button>
    <button class="chip on" data-sheet="archd">Arch D</button>
    <button class="chip" data-sheet="archdp">D Portrait</button>
  </div>
  <h4>Plot scale</h4>
  <div id="layoutScl" class="chiprow">
    <button class="chip" data-ppf="9">1/8"</button>
    <button class="chip on" data-ppf="18">1/4"</button>
    <button class="chip" data-ppf="36">1/2"</button>
  </div>
  <button class="primary" id="btnFitVP">Fit viewport to drawing</button>
  <button class="addlayer" id="btnAddLayout">+ New layout</button>
</div>
<div class="sheet" id="sheetProps">
  <h3><i>Properties</i></h3>
  <div id="proplist" class="proplist"></div>
  <div class="subtle" id="propHint">Select an object to edit layer, linetype, lineweight.</div>
</div>
<div class="sheet" id="sheetHistory">
  <h3><i>Command history</i></h3>
  <pre id="cmdhist" class="cmdhist"></pre>
</div>
<div class="sheet" id="sheetMenu">
  <h3><i>Sheet</i></h3>
  <h4>Project name</h4>
  <input id="projName" type="text" class="field" placeholder="Untitled" style="height:44px;margin-bottom:6px">
  <h4>Issued by</h4>
  <input id="firmCompany" type="text" class="field" placeholder="Your company" style="height:44px;margin-bottom:6px">
  <input id="firmCopyright" type="text" class="field" placeholder="© 2026 Your Company. All rights reserved." style="height:44px;margin-bottom:6px">
  <input id="firmDrawn" type="text" class="field" placeholder="Drawn by" style="height:44px;margin-bottom:6px">
  <div style="display:flex;gap:8px;margin-bottom:6px">
    <button id="firmLogoBtn" class="field" style="height:40px;flex:1">Firm logo…</button>
    <button id="firmLogoClear" class="field" style="height:40px">Remove</button>
  </div>
  <input type="file" id="fileLogo" accept="image/*" style="display:none">
  <div class="subtle" style="margin-top:0;margin-bottom:10px">Stamped on every printed sheet — company, copyright, drawing title, sheet number.</div>
  <button class="mrow" id="mOpenDrawing"><svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>Open drawing<small>DXF · DWG · JSON · drop a file</small></button>
  <button class="mrow" id="mImportDXF"><svg viewBox="0 0 24 24"><path d="M12 21V9m0 0 4 4m-4-4-4 4"/><path d="M4 3v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3"/></svg>Insert DXF<small>merge into this sheet</small></button>
  <button class="mrow" id="mScript"><svg viewBox="0 0 24 24"><path d="M8 6l-5 6 5 6M16 6l5 6-5 6"/></svg>Scripts<small>automate this drawing · JS</small></button>
  <button class="mrow" id="mDraft"><svg viewBox="0 0 24 24"><path d="M4 20h16M6 16l4-8 4 8M8 12h4"/><circle cx="18" cy="8" r="2"/></svg>Drafting standards<small>scales · plot styles · layer states</small></button>
  <button class="mrow" id="mSTL"><svg viewBox="0 0 24 24"><path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 12l9-5M12 12v10M12 12L3 7"/></svg>Export STL<small>3D print · mesh solids</small></button>
  <button class="mrow" id="mOBJ"><svg viewBox="0 0 24 24"><path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5"/></svg>Export OBJ<small>3D model exchange</small></button>
  <button class="mrow" id="mFont"><svg viewBox="0 0 24 24"><path d="M5 20V5h9a4 4 0 0 1 0 8H5"/><path d="M12 13l5 7"/></svg>Embed a font<small>TrueType · plots any script</small></button>
  <button class="mrow" id="mXref"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="9" height="9" rx="1"/><rect x="12" y="12" width="9" height="9" rx="1"/><path d="M8 12v4h4"/></svg>Attach xref<small>JSON · DXF as underlay</small></button>
  <button class="mrow" id="mSaveJSON"><svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/></svg>Save project<small>.json</small></button>
  <button class="mrow" id="mShare"><svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>Copy share link<small>no server · URL hash</small></button>
  <button class="mrow" id="mExportHTML"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>Export HTML<small>email a drawing</small></button>
  <button class="mrow" id="mExportDXF"><svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>Export DXF<small>R12 / R2000 · feet</small></button>
  <button class="mrow" id="mExportDWG"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/><path d="M8 8h8v8H8z"/></svg>Export DWG<small>R2000 · 3D faces</small></button>
  <button class="mrow" id="mExportPDF"><svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>Export PDF<small>to print scale</small></button>
  <button class="mrow" id="mExportAllPDF"><svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v12"/><path d="M16 7H9a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V11z"/><path d="M16 7v4h4"/></svg>Export all sheets<small>one PDF</small></button>
  <button class="mrow" id="mExportSVG"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 16c1.5-4 6.5-4 8 0"/></svg>Export SVG<small>for Illustrator / web</small></button>
  <button class="mrow" id="mExportPNG"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>Export PNG<small>with title block</small></button>
  <button class="mrow" id="mLayouts"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="14" rx="1"/><path d="M3 16h18"/></svg>Sheet set<small>pages + legends</small></button>
  <button class="mrow" id="mSheetSet"><svg viewBox="0 0 24 24"><path d="M4 4h10v16H4zM16 8h4v12h-4z"/></svg>Generate sheets<small>one page per section</small></button>
  <button class="mrow" id="mSchedules"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4zM4 9h16M9 4v16"/></svg>Place schedules<small>door · window · room</small></button>
  <button class="mrow" id="mKeynotes"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h7"/><circle cx="19" cy="15" r="3"/></svg>Keynote legend<small>this sheet</small></button>
  <button class="mrow" id="mMarkSched"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/></svg>Mark schedule<small>marks + qty</small></button>
  <button class="mrow" id="mSchedCSV"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4zM8 4v16M4 9h16M4 14h16"/></svg>Door schedule CSV<small>takeoff</small></button>
  <button class="mrow" id="mCleanup"><svg viewBox="0 0 24 24"><path d="M4 20V10h6M14 4v10h6"/></svg>Heal wall joints<small>L-corners + T-junctions</small></button>
  <button class="mrow" id="mRooms"><svg viewBox="0 0 24 24"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4z"/><path d="M16 16h4v4h-4z"/></svg>Detect rooms<small>live area from walls</small></button>
  <button class="mrow" id="mTakeoff"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4zM4 9h16M9 4v16"/></svg>Quantity takeoff<small>walls · doors · rooms</small></button>
  <button class="mrow" id="mOverkill"><svg viewBox="0 0 24 24"><path d="M4 12h16M9 7l-5 5 5 5M15 7l5 5-5 5"/></svg>Overkill<small>drop duplicates</small></button>
  <button class="mrow" id="mTrace"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1"/><circle cx="9" cy="11" r="2"/><path d="m21 16-5-5-4 4-2-2-5 5"/></svg>Trace image<small>place an underlay</small></button>
  <button class="mrow" id="mHistory"><svg viewBox="0 0 24 24"><path d="M4 5h16M4 12h10M4 19h13"/></svg>Command history<small>this session</small></button>
  <button class="mrow" id="mSettings"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/></svg>AI settings<small>API key, model</small></button>
  <div class="row" style="margin-top:8px">
    <span class="nm">DXF version</span>
    <button class="chip on" id="chipDxfVer">R2000</button>
  </div>
  <button class="mrow" id="mSample"><svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="1"/><path d="M9 6v12"/></svg>Sample 24×36 cabin<small>walls, doors, hatch, dims</small></button>
  <button class="mrow" id="mSamplePart"><svg viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="8" rx="1"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/></svg>Sample plate<small>12" × 8" · GD&T</small></button>
  <button class="mrow" id="mSampleGA"><svg viewBox="0 0 24 24"><path d="M12 3 6 9v12h12V9z"/></svg>Sample GA<small>arrangement — not a spec</small></button>
  <button class="mrow" id="mNew"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg><span id="mNewLabel">New drawing</span></button>
  <div class="subtle" id="menuFooter">Issued 2D, free, DXF/DWG out. Open a DXF from AutoCAD, LibreCAD or DraftSight — units follow $INSUNITS. Drawing stays on this device until you export.</div>
</div>
<input type="file" id="fileOpen" accept=".dxf,.json,.dwg,application/json,application/dxf" style="display:none">
<input type="file" id="fileDXF" accept=".dxf,application/dxf" style="display:none">
<input type="file" id="fileXref" accept=".dxf,.json,.dwg,application/json,application/dxf" style="display:none">
<input type="file" id="fileFont" accept=".ttf,.otf,font/ttf,font/sfnt" style="display:none">
<input type="file" id="fileImage" accept="image/*" style="display:none">
<div id="dropmask"><span>Drop a DXF, DWG or JSON to open it as the drawing</span></div>
<div id="toast"></div>`;
}
