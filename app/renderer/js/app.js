import * as THREE from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { Viewer, b64ToF32 } from './viewer.js';
import * as D from './door.js';
import { buildResource } from './fivem.js';
import { BUILTIN_PRESETS } from './presets.js';
import { DOOR_SOUNDS, VANILLA_DOOR_SOUND } from './doorsounds.js';

const api = window.api;
const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ------------------------------------------------------------------ state
const S = {
  model: null, an: null, door: D.defaultDoor(),
  extraTextures: [], ybn: null,
  project: { path: null, dirty: false },
  preview: { t: 0, playing: false, dir: 1, loop: false, played: false },
  ytypGenerated: false, exported: false,
  userPresets: [], settings: {}, hullCache: null,
  ypMode: 'text', gizmo: false,
};

// ------------------------------------------------------------------ ui helpers
let toastTimer;
function toast(msg, kind = '') {
  const t = $('toast'); t.textContent = msg; t.className = 'toast show ' + kind;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = 'toast ' + kind), kind === 'err' ? 6000 : 3200);
}
function modal(title, bodyHtml, buttons) {
  return new Promise((resolve) => {
    $('modal-title').textContent = title; $('modal-body').innerHTML = bodyHtml;
    const acts = $('modal-actions'); acts.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button'); el.className = 'btn' + (b.accent ? ' accent' : ''); el.textContent = b.label;
      el.onclick = () => { $('modal').classList.add('hidden'); resolve(b.value); };
      acts.appendChild(el);
    }
    $('modal').classList.remove('hidden');
    const inp = $('modal-body').querySelector('input'); if (inp) { inp.focus(); inp.select(); inp.onkeydown = (e) => { if (e.key === 'Enter') acts.lastChild.click(); }; }
  });
}
async function prompt(title, label, value) {
  const r = await modal(title, `<label class="lbl">${label}</label><input type="text" id="modal-input" value="${value || ''}" spellcheck="false" />`,
    [{ label: 'Cancel', value: false }, { label: 'OK', value: true, accent: true }]);
  return r ? $('modal-input').value : null;
}
function seg(containerId, attr, value) { for (const b of $$(`#${containerId} [data-${attr}]`)) b.classList.toggle('on', b.dataset[attr] === String(value)); }
function setDirty(d = true) { S.project.dirty = d; api?.setDirty(d); updateTitle(); }
function updateTitle() {
  const name = S.project.path ? S.project.path.split(/[\\/]/).pop() : 'Untitled project';
  $('project-name').textContent = name; $('project-name').classList.toggle('dirty', S.project.dirty);
  api?.setTitle(`${S.project.dirty ? '• ' : ''}${name} — GTA Door Creator`);
}
function log(msg, cls = '') { const el = $('export-log'); const d = document.createElement('div'); d.className = cls; d.textContent = msg; el.appendChild(d); el.scrollTop = el.scrollHeight; }
const basename = (p) => (p || '').split(/[\\/]/).pop();
const joinPath = (...p) => p.filter(Boolean).join(api && navigator.platform.startsWith('Win') ? '\\' : '/').replace(/([\\/])[\\/]+/g, '$1');

// ------------------------------------------------------------------ viewer
const viewer = new Viewer($('viewport'), $('vp-axes'), $('vp-hud'));
window.__viewer = viewer; window.__state = S; // handy for debugging

viewer.onFrame = (dt) => {
  const p = S.preview;
  if (p.playing && S.door.created) {
    const dur = D.duration(S.door);
    if (S.door.type === 'custom' || S.door.type === 'destruct') {   // play forward (and wrap when looping)
      p.t += dt / dur;
      if (p.t >= 1) { if (p.loop) p.t %= 1; else { p.t = 1; p.playing = false; } }
      applyPreview(); return;
    }
    p.t += p.dir * dt / dur;
    if (p.t >= 1) { p.t = 1; if (p.loop) p.dir = -1; else { p.playing = false; } }
    if (p.t <= 0) { p.t = 0; if (p.loop) p.dir = 1; else { p.playing = false; } }
    applyPreview();
  }
};

function applyPreview() {
  viewer.setOpen(S.preview.t);
  $('pv-slider').value = Math.round(S.preview.t * 1000);
  $('pv-pct').textContent = Math.round(S.preview.t * 100) + '%';
  $('pv-play').classList.toggle('on', S.preview.playing);
  updateReadout(); updateHud();
}

function updateReadout() {
  const d = S.door, an = S.an;
  if (!S.model || !d.created) { $('pv-readout').textContent = '–'; return; }
  if (d.type === 'destruct') {
    if (D.destructYcd(d)) {
      const dur = D.duration(d), t = S.preview.t * dur, da = S.desAnim && S.desAnim.key === desAnimKey() ? S.desAnim : null;
      const phase = !da ? 'computing…' : t < da.explodeAt ? 'intact' : t < da.landedAt ? 'explosion' : t < da.rebuildAt ? 'on the ground' : 'rebuild';
      $('pv-readout').textContent = `${t.toFixed(2)} / ${dur.toFixed(2)} s · ${phase} · .ycd loop`;
      return;
    }
    $('pv-readout').textContent = `${S.shards?.pieces?.length ?? d.destruct.pieces} pieces · strength ${d.destruct.strength} · break preview`;
    return;
  }
  if (d.type === 'custom') {
    const dur = D.customDuration(d), pose = D.customPose(d, S.preview.t * dur);
    $('pv-readout').textContent = `${(S.preview.t * dur).toFixed(2)} / ${dur.toFixed(2)} s · rot ${pose.r.map((v) => v.toFixed(0)).join(' ')}° · loop`;
    return;
  }
  const e = D.ease(S.preview.t);
  const ms = D.motionSpec(d, an, pivot());
  let txt = '';
  if (d.type === 'garage' && !d.garage.previewInGame && (d.garage.kind === 'sectional' || d.garage.kind === 'rollup'))
    txt = `lift ${(d.garage.height * e).toFixed(2)} m · ${d.garage.panels} panels`;
  else if (ms.angle !== 0) txt = `angle ${(ms.angle * e).toFixed(1)}°`;
  else txt = `offset ${(Math.hypot(...ms.offset) * e).toFixed(3)} m`;
  $('pv-readout').textContent = `${txt} · ${D.duration(d).toFixed(1)} s · ${d.speed}`;
}

function updateHud() {
  if (!S.model) { $('vp-hud').textContent = ''; return; }
  const p = pivot();
  $('vp-hud').textContent = `${S.model.file}  ·  ${S.model.triangleCount} tris\n` +
    (S.door.created ? `pivot  ${D.fmt(p.x)}  ${D.fmt(p.y)}  ${D.fmt(p.z)}   ·  ${S.door.type.toUpperCase()}  ${Math.round(S.preview.t * 100)}%` : 'press CREATE DOOR');
}

// ------------------------------------------------------------------ derived values
function pivot() {
  if (!S.an) return { x: 0, y: 0, z: 0 };
  const d = S.door;
  if (!d.created) return { x: 0, y: 0, z: 0 };
  return d.pivot.mode === 'custom' ? { x: d.pivot.x, y: d.pivot.y, z: d.pivot.z } : D.pivotFor(d.pivot.mode, S.an, d);
}

function hull() {
  if (S.hullCache) return S.hullCache;
  const pts = [];
  for (const m of S.model.meshes) { const p = m._pos; const step = p.length > 600000 ? 9 : 3; for (let i = 0; i < p.length; i += step) pts.push(new THREE.Vector3(p[i], p[i + 1], p[i + 2])); }
  const h = new ConvexHull().setFromPoints(pts);
  const verts = [], map = new Map(), tris = [];
  const idx = (v) => { if (!map.has(v)) { map.set(v, verts.length / 3); verts.push(v.point.x, v.point.y, v.point.z); } return map.get(v); };
  for (const f of h.faces) {
    const loop = []; let e = f.edge;
    do { loop.push(e.head()); e = e.next; } while (e !== f.edge);
    for (let i = 1; i + 1 < loop.length; i++) tris.push(idx(loop[0]), idx(loop[i]), idx(loop[i + 1]));
  }
  S.hullCache = { verts, tris };
  return S.hullCache;
}

function boxTris(mn, mx) {
  const c = []; for (let i = 0; i < 8; i++) c.push([(i & 1) ? mx[0] : mn[0], (i & 2) ? mx[1] : mn[1], (i & 4) ? mx[2] : mn[2]]);
  const f = [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5];
  return new Float32Array(f.flatMap((i) => c[i]));
}

// collision in ORIGINAL model space for display + its pivot-space box for the archetype
function collisionInfo() {
  const d = S.door, c = d.collision, an = S.an, P = pivot();
  if (!S.model) return null;
  let tris = null, label = '', job = { mode: c.mode, material: Number(c.material) };
  if (c.mode === 'none') { label = 'No collision - players walk through the door.'; }
  else if (c.mode === 'keep') {
    if (S.model.collision) { tris = b64ToF32(S.model.collision.triangles); label = `Embedded collision kept (${S.model.collision.parts.join(', ')}).`; }
    else label = 'Model has no embedded collision.';
  } else if (c.mode === 'import') {
    if (S.ybn) { tris = b64ToF32(S.ybn.triangles); label = `${S.ybn.file}: ${S.ybn.parts.join(', ')} - embedded into the YDR.`; job.ybnPath = S.ybn.path; }
    else label = 'Choose a .ybn file.';
  } else {
    const shape = c.shape;
    if (shape === 'convex') {
      const h = hull();
      tris = new Float32Array(h.tris.flatMap((i) => [h.verts[i * 3], h.verts[i * 3 + 1], h.verts[i * 3 + 2]]));
      job.shape = 'convex';
      job.hull = { vertices: h.verts.map((v, i) => +(v - [P.x, P.y, P.z][i % 3]).toFixed(5)), triangles: h.tris };
      label = `Convex hull: ${h.verts.length / 3} vertices, ${h.tris.length / 3} faces.`;
    } else {
      let mn = [an.min[0] - P.x, an.min[1] - P.y, an.min[2] - P.z], mx = [an.max[0] - P.x, an.max[1] - P.y, an.max[2] - P.z];
      if (shape === 'custom') {
        if (!c.boxMin) { c.boxMin = mn.map((v) => +v.toFixed(3)); c.boxMax = mx.map((v) => +v.toFixed(3)); }
        mn = c.boxMin; mx = c.boxMax;
      }
      tris = boxTris([mn[0] + P.x, mn[1] + P.y, mn[2] + P.z], [mx[0] + P.x, mx[1] + P.y, mx[2] + P.z]);
      job.shape = 'box'; job.boxMin = mn; job.boxMax = mx;
      label = `Box ${(mx[0] - mn[0]).toFixed(2)} × ${(mx[1] - mn[1]).toFixed(2)} × ${(mx[2] - mn[2]).toFixed(2)} m (primitive - best for dynamic doors).`;
    }
  }
  let box = null;
  if (tris && tris.length >= 9) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) { const v = tris[i + k] - [P.x, P.y, P.z][k]; mn[k] = Math.min(mn[k], v); mx[k] = Math.max(mx[k], v); }
    box = { min: mn, max: mx };
  }
  return { tris, label, job, box };
}

function archetype() {
  const d = S.door, P = pivot(), col = collisionInfo();
  const b = D.pivotSpaceBounds(S.model, S.an, P, col?.box);
  const y = d.ytyp;
  const sa = D.specialAttribute(d);
  return {
    archetypeName: D.sanitizeName(y.archetypeName || d.name),
    modelName: D.sanitizeName(y.modelName || d.name),
    ytypName: y.mergePath ? basename(y.mergePath).replace(/\.ytyp$/i, '') : D.sanitizeName(y.ytypName || d.name),
    mergePath: y.mergePath || null,
    lodDist: Number(y.lodDist), hdTextureDist: Number(y.hdTextureDist),
    flags: y.flagsAuto ? D.recommendedFlags(d) : Number(y.flags),
    specialAttribute: sa,
    destruct: d.type === 'destruct',
    desYcd: D.destructYcd(d) ? { dict: D.sanitizeName(y.modelName || d.name) + '_anim', clip: D.sanitizeName(y.archetypeName || d.name) } : null,
    textureDictionary: D.isAnim(d) || d.type === 'destruct' ? '' : (y.textureDictionary ?? (S.model.hasEmbeddedTextures ? D.sanitizeName(y.modelName || d.name) : '')),
    bounds: b,
    anim: !D.isAnim(d) ? null : d.type === 'custom'
      ? { dict: D.sanitizeName(y.modelName || d.name) + '_anim', clip: D.sanitizeName(y.archetypeName || d.name), auto: true }
      : D.animNames(D.sanitizeName(y.modelName || d.name)),
  };
}

// ------------------------------------------------------------------ loading
async function loadPaths(paths) {
  if (!paths || !paths.length) return;
  showHome(false);
  const order = { '.ydr': 0, '.xml': 0, '.ytyp': 1, '.ybn': 2, '.ytd': 3 };
  const ext = (p) => (p.match(/\.[^.\\/]+$/) || [''])[0].toLowerCase();
  paths = [...paths].sort((a, b) => (order[ext(a)] ?? 9) - (order[ext(b)] ?? 9));
  for (const p of paths) {
    const e = ext(p);
    if (!(e in order)) { toast(`Unsupported file: ${basename(p)} (use .ydr, .ydr.xml, .ytyp, .ybn, .ytd)`, 'err'); continue; }
    try {
      document.body.style.cursor = 'progress';
      const res = await api.load(p);
      if (res.kind === 'ydr') await onYdr(res);
      else if (res.kind === 'ytyp') onYtyp(res);
      else if (res.kind === 'ybn') onYbn(res);
      else if (res.kind === 'ytd') onYtd(res);
    } catch (err) {
      toast(`${basename(p)}: ${err.message}`, 'err');
      console.error(err);
    } finally { document.body.style.cursor = ''; }
  }
  if (S.pendingType && S.model) applyPendingType();
}
async function onYdr(res, keepDoor = null) {
  for (const m of res.meshes) m._pos = b64ToF32(m.positions);
  S.model = res; S.hullCache = null; S.shards = null;
  S.an = D.analyzeModel(res);
  S.ybn = keepDoor ? S.ybn : null;
  if (keepDoor) S.door = keepDoor;
  else {
    const d = D.defaultDoor();
    d.name = D.sanitizeName(res.name);
    d.collision.mode = res.collision ? 'keep' : 'auto';
    d.garage.height = +S.an.size[2].toFixed(3);
    d.garage.distance = +S.an.size[2].toFixed(3);
    d.export.folder = S.door.export.folder || S.settings.outFolder || null;
    S.door = d;
    S.preview.t = 0; S.preview.playing = false; S.preview.played = false;
    S.ytypGenerated = false; S.exported = false;
  }
  viewer.setModel(res);
  if (S.extraTextures.length) viewer.addTextures(S.extraTextures);
  $('vp-empty').classList.add('hidden');
  $('dropzone').classList.add('hidden');
  $('prop-info').classList.remove('hidden');
  const sz = S.an.size;
  $('pi-model').textContent = res.file;
  $('pi-type').textContent = (res.sourceXml ? 'YDR XML' : 'YDR') + (res.gen9 ? ' (Gen9)' : '');
  $('pi-sx').textContent = sz[0].toFixed(3); $('pi-sy').textContent = sz[1].toFixed(3); $('pi-sz').textContent = sz[2].toFixed(3);
  $('pi-verts').textContent = res.vertexCount.toLocaleString();
  $('pi-mats').textContent = String(res.materials.length).padStart(2, '0');
  $('pi-col').textContent = res.collision ? `embedded (${res.collision.parts.join(', ')})` : 'none';
  const warns = [...(res.warnings || [])];
  if (!res.hasEmbeddedTextures && res.materials.some((m) => Object.keys(m.textures).length)) warns.push('Textures are in an external .ytd - drop it to see them in Material Preview, and set its name in YTYP › Texture Dict.');
  if (/^(v_ilev_|v_res_|v_corp_|prop_|p_|hei_|apa_|ba_|ch_|xm_|gr_|bkr_|ex_|imp_|sm_|tr_|h4_|sf_)/.test(res.name)) warns.push(`"${res.name}" looks like a vanilla GTA model: streaming it with that name replaces the original everywhere in the game. Rename it in DOOR SETTINGS (e.g. ${res.name.replace(/^[a-z0-9]+_/, 'my_')}).`);
  $('pi-warn').classList.toggle('hidden', !warns.length); $('pi-warn').textContent = warns.join(' ');
  runDetect();
  refresh();
  viewer.setView('persp');
  if (!keepDoor) { setDirty(true); toast(`Loaded ${res.file} - ${res.vertexCount} vertices`, 'ok'); }
}

function onYtyp(res) {
  const a = res.archetypes.find((x) => S.model && x.name === S.model.name) || res.archetypes[0];
  if (!a) { toast(`${res.file}: no archetypes`, 'err'); return; }
  const y = S.door.ytyp;
  y.lodDist = a.lodDist; y.hdTextureDist = a.hdTextureDist;
  if (!a.name.startsWith('hash_')) { y.archetypeName = a.name; }
  if (!a.textureDictionary.startsWith('hash_')) y.textureDictionary = a.textureDictionary;
  toast(`${res.file}: ${res.archetypes.length} archetype(s). Using "${a.name}" (LOD ${a.lodDist}, flags ${a.flags}, specialAttribute ${a.specialAttribute}).`, 'ok');
  if (!S.model) toast('YTYP read. Now drop the matching .ydr to build the door.', '');
  refresh(); setDirty();
}

function onYbn(res) {
  S.ybn = res;
  S.door.collision.mode = 'import'; S.door.collision.ybnFile = res.file; S.door.collision.ybnPath = res.path;
  toast(`Collision ${res.file} imported (${res.parts.join(', ')})`, 'ok');
  refresh(); setDirty();
}

function onYtd(res) {
  S.extraTextures.push(...res.textures);
  viewer.addTextures(res.textures);
  if (viewer.shading !== 'material') { viewer.setShading('material'); seg('shade-seg', 'shade', 'material'); }
  toast(`${res.file}: ${res.textures.length} texture(s) loaded for preview`, 'ok');
}

// ------------------------------------------------------------------ door actions
function runDetect() {
  if (!S.model) return;
  const r = D.autoDetect(S.model, S.an);
  S.detect = r;
  const label = { normal: 'Normal Door', sliding: 'Sliding Door', garage: 'Garage Door' }[r.type];
  $('ad-type').textContent = label;
  $('ad-conf').textContent = r.confidence + '%';
  $('ad-bar').style.width = r.confidence + '%';
  $('ad-pivot').textContent = r.pivotLabel;
  $('ad-open').textContent = r.opening;
  $('ad-why').textContent = r.why.length ? 'Why: ' + r.why.join(' · ') : '';
}

function acceptDetect() {
  const r = S.detect; if (!r) return;
  if (!S.door.created) createDoor(false);
  setType(r.type);
  if (r.type === 'normal') { S.door.normal.hinge = r.hinge; S.door.normal.angle = 90; S.door.pivot.mode = 'auto'; }
  if (r.type === 'garage') S.door.garage.kind = r.garageKind;
  if (r.type === 'sliding') { S.door.sliding.preset = 'auto'; S.door.sliding.dir = r.slideDir; }
  S.door.typeChosen = true;
  refresh(); setDirty(); toast('Suggestion applied', 'ok');
}

function createDoor(announce = true) {
  if (!S.model) return;
  const d = S.door;
  d.created = true;
  const r = S.detect || D.autoDetect(S.model, S.an);
  d.type = r.type; d.engine = D.defaultEngine(r.type);
  d.normal.hinge = r.hinge; d.garage.kind = r.garageKind; d.sliding.dir = r.slideDir;
  if (r.garageKind === 'rollup') d.garage.panels = 12;
  d.pivot.mode = 'auto';
  S.preview.t = 0;
  if (S.mode === 'anim' || S.mode === 'destruct') { setType(S.mode === 'anim' ? 'custom' : 'destruct'); S.configured = true; refresh(); setDirty(); return; }
  refresh(); setDirty();
  if (announce) toast(`Door created: ${r.type} door, pivot ${r.type === 'normal' ? 'on the ' + r.hinge + ' edge' : '= ' + r.pivotLabel.toLowerCase()}, YTYP data ready. Check the door type.`, 'ok');
}

function setType(type) {
  const d = S.door;
  if (d.type !== type) { d.engine = D.defaultEngine(type); d.export.withScript = false; }
  if (type !== 'destruct') viewer.setShards(null); else if (S.shards && S.shards.key === shardKey()) viewer.setShards(S.shards.pieces);
  d.type = type; d.typeChosen = true;
  if (d.pivot.mode !== 'custom') d.pivot.mode = 'auto';
  S.preview.t = 0; S.preview.playing = false;
}

// ------------------------------------------------------------------ door sound (vanilla GTA audio, no script)
const SOUND_TYPE_NAMES = { 4: 'Hinged doors', 0: 'Sliding doors', 1: 'Shutters / vertical', 2: 'Garage doors', 3: 'Barriers' };
const SOUND_DEFAULT = { 4: '86e5cee2', 0: '5c5c68cb', 1: '098b9ab5', 2: 'a04a33e1', 3: '981ef0a5' };
function wantedSoundType(d) {
  if (d.type === 'normal') return 4;
  if (d.type === 'sliding') return (d.sliding.dir === 'up' || d.sliding.dir === 'down') ? 1 : 0;
  return d.garage.kind === 'sectional' ? 2 : 1;
}
function originalSoundId() {
  if (!S.model) return null;
  const names = [S.model.name, (S.model.drawableName || '').replace(/\.#dr$/, '')];
  for (const n of names) { if (!n) continue; const id = VANILLA_DOOR_SOUND[D.hex8(D.joaat(n))]; if (id) return { id, from: n }; }
  return null;
}
function soundById(id) {
  const set = DOOR_SOUNDS.find((x) => x.id === id);
  if (set) return set;
  // a vanilla door's own settings that is not the representative of its set
  for (const [mh, sid] of Object.entries(VANILLA_DOOR_SOUND)) if (sid === id) return null;
  return null;
}
function resolveSound() {
  const d = S.door, snd = d.sound || { mode: 'auto' };
  if (snd.mode === 'none') return null;
  const want = wantedSoundType(d);
  if (snd.mode === 'set' && snd.id) {
    const set = soundById(snd.id);
    return { id: snd.id, label: set ? set.label : 'GTA sound ' + snd.id, examples: set ? set.examples : [], mismatch: set && set.type !== want, auto: false };
  }
  const orig = originalSoundId();
  if (orig) {
    const set = DOOR_SOUNDS.find((x) => x.examples.includes(orig.from)) || null;
    return { id: orig.id, label: 'Original sound of ' + orig.from, examples: set ? [set.label] : [], auto: true, original: true };
  }
  const set = DOOR_SOUNDS.find((x) => x.id === SOUND_DEFAULT[want]);
  return { id: set.id, label: set.label, examples: set.examples, auto: true, mismatch: false };
}
function fillSoundSelect() {
  const sel = $('snd-select');
  let html = '<option value="auto">AUTO (recommended)</option><option value="none">No sound</option>';
  for (const t of [4, 0, 1, 2, 3]) {
    html += `<optgroup label="${SOUND_TYPE_NAMES[t]}">` + DOOR_SOUNDS.filter((x) => x.type === t).map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join('') + '</optgroup>';
  }
  sel.innerHTML = html;
}
function refreshSound() {
  const d = S.door; if (!d.sound) d.sound = { mode: 'auto', id: null };
  $('snd-select').value = d.sound.mode === 'set' ? d.sound.id : d.sound.mode;
  const r = S.model && d.created ? resolveSound() : null;
  const info = $('snd-info');
  if (!r) { info.innerHTML = d.sound.mode === 'none' ? 'The door will use no sound.' : ''; return; }
  info.innerHTML = `♪ ${esc(r.label)}${r.auto && !r.original ? ' <span class="muted">(default for this door type)</span>' : ''}` +
    (r.examples.length ? `<span class="ex">${r.original ? '' : 'like '}${esc(r.examples.slice(0, 3).join(', '))}</span>` : '') +
    (r.mismatch ? `<span class="w">⚠ This sound belongs to another door type (${SOUND_TYPE_NAMES[DOOR_SOUNDS.find((x) => x.id === r.id).type].toLowerCase()}) - GTA may not play it at the right moments.</span>` : '');
}
async function writeAudio(dir, a) {
  const r = resolveSound(); if (!r) return null;
  const file = `${a.modelName}_game.dat151.rel`;
  await api.mkdir(dir);
  await api.buildAudio(joinPath(dir, file), [{ model: a.archetypeName, settings: r.id }]);
  return { file, label: r.label };
}

// ------------------------------------------------------------------ SOUND ONLY tool (doors already made)
const SO = { sound: '86e5cee2' };
function soNames() {
  return [...new Set($('so-names').value.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean).map((x) => D.sanitizeName(x)))];
}
function soFileBase() { return D.sanitizeName($('so-file').value || 'door_sounds'); }
function soRefresh() {
  const names = soNames(), file = soFileBase() + '_game.dat151.rel';
  const set = DOOR_SOUNDS.find((x) => x.id === SO.sound);
  $('so-info').innerHTML = set ? `♪ ${esc(set.label)}<span class="ex">like ${esc(set.examples.slice(0, 3).join(', '))}</span>` : '';
  $('so-fx').textContent = names.length
    ? `-- GTA Door Creator : door sound (${names.join(', ')})\nfiles {\n  'audio/${file}',\n}\ndata_file 'AUDIO_GAMEDATA' 'audio/${file.replace('.dat151.rel', '.dat')}'\n`
    : '-- type at least one door model name';
  $('so-create').disabled = !names.length; $('so-copy').disabled = !names.length;
}
function openSoundOnly() {
  const sel = $('so-sound');
  if (!sel.options.length) {
    sel.innerHTML = [4, 0, 1, 2, 3].map((t) => `<optgroup label="${SOUND_TYPE_NAMES[t]}">` + DOOR_SOUNDS.filter((x) => x.type === t).map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join('') + '</optgroup>').join('');
  }
  if (S.model && S.door.created && !$('so-names').value.trim()) {
    const r = resolveSound(); $('so-names').value = archetype().archetypeName;
    if (r && DOOR_SOUNDS.some((x) => x.id === r.id)) SO.sound = r.id;
  }
  sel.value = SO.sound;
  if (!$('so-file').value) $('so-file').value = soNames()[0] || 'door_sounds';
  $('so-modal').classList.remove('hidden');
  soRefresh();
}
async function soFromYtyp() {
  const paths = await api.openPropDialog(); const p = (paths || []).find((x) => /\.ytyp$/i.test(x));
  if (!p) { if (paths && paths.length) toast('Choose a .ytyp file', 'err'); return; }
  try {
    const res = await api.load(p);
    const names = res.archetypes.map((a) => a.name).filter((n) => !n.startsWith('hash_'));
    const unknown = res.archetypes.length - names.length;
    const cur = $('so-names').value.trim();
    $('so-names').value = (cur ? cur + '\n' : '') + names.join('\n');
    if (!$('so-file').value || $('so-file').value === 'door_sounds') $('so-file').value = D.sanitizeName(res.name.startsWith('hash_') ? basename(p).replace(/\.ytyp$/i, '') : res.name);
    toast(`${names.length} archetype(s) added${unknown ? `, ${unknown} unnamed (put the .ydr files next to the .ytyp to read their names)` : ''} - remove the ones that are not doors`, unknown ? '' : 'ok');
    soRefresh();
  } catch (e) { toast(e.message, 'err'); }
}
async function soCreate() {
  const names = soNames(); if (!names.length) return;
  const dir = await api.chooseFolder('Where should the audio file go? (your resource\'s audio folder)');
  if (!dir) return;
  const file = soFileBase() + '_game.dat151.rel';
  try {
    await api.buildAudio(joinPath(dir, file), names.map((n) => ({ model: n, settings: SO.sound })));
    api.copyText($('so-fx').textContent);
    toast(`${file} created for ${names.length} door(s) - fxmanifest lines copied (Ctrl+V)`, 'ok');
    log(`› Sound only → ${joinPath(dir, file)} (${names.join(', ')})`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

// ------------------------------------------------------------------ refresh: state -> UI + viewer
function refresh() {
  const d = S.door, has = !!S.model, created = has && d.created;
  $('btn-create').disabled = !has;
  $('btn-create').classList.toggle('created', created);
  const what = S.mode === 'anim' ? 'ANIMATION' : S.mode === 'destruct' ? 'DESTRUCTIBLE' : 'DOOR';
  $('btn-create').querySelector('.bc-title').textContent = created ? `✓ ${what} CREATED` : `CREATE ${what}`;
  for (const id of ['panel-detect']) $(id).classList.toggle('locked', !has);
  for (const id of ['panel-type', 'panel-settings', 'panel-pivot', 'panel-collision', 'panel-sound', 'panel-doorsettings']) $(id).classList.toggle('locked', !created);
  for (const id of ['panel-ytyp', 'panel-export']) $(id).classList.toggle('locked', !created);
  $('preview').style.opacity = created ? 1 : 0.4;
  $('preview').style.pointerEvents = created ? '' : 'none';

  // type + settings
  for (const b of $$('.type-btn')) b.classList.toggle('on', created && d.typeChosen && b.dataset.type === d.type);
  for (const el of $$('.type-settings')) el.classList.toggle('on', el.dataset.for === d.type);
  $('settings-tag').textContent = d.type === 'garage' ? `GARAGE · ${d.garage.kind.toUpperCase()}` : d.type === 'custom' ? 'CUSTOM ANIMATION' : d.type === 'destruct' ? `DESTRUCTIBLE · ${d.destruct.pieces} PIECES` : d.type.toUpperCase();
  $('panel-settings').dataset.gkind = d.type === 'garage' ? d.garage.kind : '';
  $('panel-settings').dataset.type = d.type;
  if (d.type === 'custom') refreshCustom();
  if (d.type === 'destruct') refreshDestruct();
  seg('panel-settings', 'hinge', d.normal.hinge);
  $('in-angle').value = d.normal.angle; $('v-angle').textContent = d.normal.angle + '°';
  seg('panel-settings', 'sdir', d.sliding.dir);
  seg('sdist-presets', 'sd', d.sliding.preset === 'custom' || d.sliding.preset === 'auto' ? d.sliding.preset : Number(d.sliding.distance).toFixed(2));
  $('sdist-custom').style.display = d.sliding.preset === 'custom' ? '' : 'none';
  if (document.activeElement !== $('in-sdist')) $('in-sdist').value = Number(d.sliding.distance).toFixed(2);
  $('v-sdist').textContent = (S.an ? D.slideDistance(d, S.an) : d.sliding.distance).toFixed(2) + ' m';
  seg('panel-settings', 'gkind', d.garage.kind);
  const setNum = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
  setNum('in-gheight', d.garage.height); setNum('in-gdist', d.garage.distance); setNum('in-gpanels', d.garage.panels);
  const psize = S.an ? (d.garage.panelSize > 0 ? d.garage.panelSize : S.an.size[2] / Math.max(1, d.garage.panels)) : 0;
  setNum('in-gpsize', psize.toFixed(3));
  $('panel-list').innerHTML = Array.from({ length: Math.min(40, d.garage.panels) }, (_, i) => `<span>Panel ${String(i + 1).padStart(2, '0')}</span>`).join('');
  $('in-ingame').checked = !!d.garage.previewInGame;
  $('ingame-note').textContent = d.garage.kind === 'sectional' ? '(single model: up-and-over)' : d.garage.kind === 'rollup' ? '(single model: vertical lift)' : '';
  $('in-ingame').closest('label').style.display = d.type === 'garage' && d.garage.kind !== 'sliding' ? '' : 'none';
  seg('speed-seg', 'speed', d.speed);
  seg('engine-seg', 'engine', d.engine);
  $('engine-hint').textContent = engineHint(d);

  // swing info
  if (S.an && created && d.type === 'normal') {
    const s = D.swingSign(d, S.an, pivot());
    $('swing-info').textContent = `Hinge ${d.normal.hinge.toUpperCase()} · opens ${d.normal.flip ? 'toward the front (pull)' : 'away from the front (push)'} · ${s > 0 ? '+' : '−'}${d.normal.angle}° heading`;
  }

  // pivot
  const P = pivot();
  seg('pivot-seg', 'pmode', d.pivot.mode);
  for (const k of ['x', 'y', 'z']) setNum('pv-' + k, D.fmt(P[k]));
  $('btn-gizmo').classList.toggle('on', S.gizmo);

  // collision
  seg('col-mode', 'cmode', d.collision.mode);
  $('col-keep').disabled = !(S.model && S.model.collision);
  seg('col-shape', 'cshape', d.collision.shape);
  $('col-auto').style.display = d.collision.mode === 'auto' ? '' : 'none';
  $('col-import').style.display = d.collision.mode === 'import' ? '' : 'none';
  $('col-custom').classList.toggle('on', d.collision.shape === 'custom');
  $('col-material').value = String(d.collision.material);
  $('ybn-name').textContent = S.ybn ? S.ybn.file : 'none';
  const col = has ? collisionInfo() : null;
  if (col && d.collision.shape === 'custom' && d.collision.boxMin) {
    ['x', 'y', 'z'].forEach((k, i) => { setNum('cb-min' + k, d.collision.boxMin[i]); setNum('cb-max' + k, d.collision.boxMax[i]); });
  }
  $('col-info').textContent = col ? col.label + (d.collision.mode !== 'none' ? ' → embedded in the .ydr' : '') : '';

  // viewer
  if (has) {
    viewer.setCollision(col && col.tris);
    viewer.updateDoor(d, S.an, P);
    applyPreview();
  }

  refreshSound();
  fillDoorSettings();
  refreshYtyp();
  refreshExport();
  refreshSteps();
}

// ------------------------------------------------------------------ CUSTOM ANIMATION panel (whole object, keyframes)
function refreshCustom(force = false) {
  const d = S.door, c = d.custom;
  seg('anim-interp', 'ai', c.interp);
  const tbl = $('kf-table');
  if (!force && tbl.contains(document.activeElement)) { updateAnimInfo(); return; } // don't rebuild while typing
  const n = (v) => +(+v).toFixed(3);
  tbl.innerHTML = '<div class="kf-row head"><span>TIME s</span><span>ROT X°</span><span>ROT Y°</span><span>ROT Z°</span><span>MOVE X</span><span>MOVE Y</span><span>MOVE Z</span><span></span></div>' +
    c.keys.map((k, i) => `<div class="kf-row" data-i="${i}"><input type="number" step="0.1" min="0" data-f="t" value="${n(k.t)}" title="time (seconds)"${i === 0 ? ' disabled' : ''} />` +
      [0, 1, 2].map((j) => `<input class="rot" type="number" step="15" data-f="r${j}" value="${n(k.r[j])}" title="rotation ${'XYZ'[j]} (degrees, 360 = one turn)" />`).join('') +
      [0, 1, 2].map((j) => `<input type="number" step="0.05" data-f="p${j}" value="${n(k.p[j])}" title="move ${'XYZ'[j]} (metres)" />`).join('') +
      `<button class="del" data-del="${i}" title="Delete this key"${c.keys.length <= 2 || i === 0 ? ' disabled' : ''}>✕</button></div>`).join('');
  updateAnimInfo();
}
function updateAnimInfo() {
  const d = S.door, ks = D.customKeys(d), a = ks[0], b = ks[ks.length - 1];
  const turn = (x) => { const m = ((x % 360) + 360) % 360; return Math.min(m, 360 - m) < 1e-3; };
  const seamless = a.p.every((v, i) => Math.abs(v - b.p[i]) < 1e-4) && a.r.every((v, i) => turn(b.r[i] - v));
  const big = ks.some((k, i) => i > 0 && k.r.some((v, j) => Math.abs(v - ks[i - 1].r[j]) > 180.001));
  $('anim-info').innerHTML = `Loop of <b>${D.customDuration(d).toFixed(2)} s</b> · ${ks.length} keys · turns around the pivot (AUTO = centre of the model). ` +
    'In-game it starts and loops by itself - <b>no script</b> - and the collision turns with it.' +
    (seamless ? '' : '<br><span class="w">⚠ The last key is not the same as the first (or a full turn): the loop will jump back.</span>') +
    (big ? '<br><span class="muted">Tip: more than 180° between two keys is fine (360° spins work).</span>' : '');
}

// ------------------------------------------------------------------ SETTINGS
async function openSettings() {
  let inf = {}, ui = {};
  try { inf = await api.info(); ui = await api.uninstallInfo(); } catch { }
  const how = ui.installed ? 'Installed version - the Windows uninstaller will open.'
    : ui.portable ? `Single .exe version - nothing is installed: just delete <b>${esc(ui.portable)}</b>.`
      : 'Portable / zip version - nothing is installed: just delete the folder.';
  const r = await modal('SETTINGS', `
    <div class="set-row"><span>Version</span><b>v${esc(inf.version || '?')}</b></div>
    <div class="set-row"><span>Program folder</span><button class="btn" id="set-open-app">Open</button></div>
    <div class="set-row"><span>Settings &amp; presets</span><button class="btn" id="set-open-data">Open</button></div>
    <div class="set-row"><span>Desktop shortcut</span><button class="btn" id="set-shortcut">Create</button></div>
    <div class="set-danger">
      <b>Uninstall GTA Door Creator</b>
      <p class="muted">${how}</p>
      ${ui.installed ? '<label class="check"><input type="checkbox" id="set-wipe" checked /> Also delete my settings and presets</label>' : ''}
    </div>`, [{ label: 'Close', value: false }, ...(ui.installed ? [{ label: 'UNINSTALL…', value: 'uninstall', accent: true }] : [])]);
  if (r !== 'uninstall') return;
  const wipe = $('set-wipe')?.checked;
  if (S.project.dirty) {
    const ok = await modal('Unsaved project', '<p>Your project has unsaved changes. Uninstall anyway?</p>', [{ label: 'Cancel', value: false }, { label: 'Uninstall', value: true, accent: true }]);
    if (!ok) return;
  }
  const sure = await modal('Uninstall GTA Door Creator?', '<p>The app will close and the Windows uninstaller will open.</p><p class="muted">Your exported resources and .doorproject files are not touched.</p>',
    [{ label: 'Cancel', value: false }, { label: 'Uninstall', value: true, accent: true }]);
  if (!sure) return;
  const done = await api.uninstall(!!wipe);
  if (!done) toast('Uninstaller not found - delete the program folder by hand', 'err');
}
document.addEventListener('click', (e) => {
  const id = e.target?.id;
  if (id === 'set-open-app') api.openAppFolder('app');
  else if (id === 'set-open-data') api.openAppFolder('data');
  else if (id === 'set-shortcut') window.api.shortcut().then((ok) => toast(ok ? 'Desktop shortcut created' : 'Could not create the shortcut', ok ? 'ok' : 'err'));
});

// ------------------------------------------------------------------ HOME
function showHome(on = true) { $('home').classList.toggle('hidden', !on); if (on) { $('so-modal').classList.add('hidden'); } }
const MODE_TITLES = { door: 'CREATE DOOR', sound: 'DOOR SOUND', anim: 'ANIMATION', destruct: 'DESTRUCT' };
const MODE_PAGES = {
  door: { sub: 'Hinged, sliding or garage door for your MLO / ymap.', steps: ['Import prop', 'Create door', 'Type & side', 'Preview', 'Export'] },
  anim: { sub: 'Make any prop move - it loops by itself in-game, no script.', steps: ['Import prop', 'Preset or keyframes', 'Pivot', '▶ Preview', 'Export'] },
  destruct: { sub: 'Cut a prop in pieces that break with explosions, cars and bullets - or play an explosion loop (.ycd).', steps: ['Import prop', 'Pieces & strength', '💥 Preview break', 'Export'] },
};
function setMode(mode) {
  S.mode = mode;
  document.body.dataset.mode = mode || '';
  $('page-title').textContent = MODE_TITLES[mode] || '';
  $('pv-title').textContent = mode === 'anim' ? 'ANIMATION PREVIEW' : mode === 'destruct' ? 'BREAK PREVIEW' : 'DOOR PREVIEW';
  const pg = MODE_PAGES[mode];
  if (pg) { $('pb-title').textContent = MODE_TITLES[mode]; $('pb-sub').textContent = pg.sub; $('pb-steps').innerHTML = pg.steps.map((x) => `<li>${esc(x)}</li>`).join(''); }
  $('so-modal').classList.toggle('as-page', mode === 'sound');
  $('so-close').textContent = mode === 'sound' ? '← Home' : 'Close';
  // a model already loaded follows the page: door types on the door page, custom / destruct on theirs
  if (S.model && S.door.created) {
    if (mode === 'door' && (S.door.type === 'custom' || S.door.type === 'destruct')) { setType('normal'); touch(); }
    if (mode === 'anim' && S.door.type !== 'custom') { setType('custom'); touch(); }
    if (mode === 'destruct' && S.door.type !== 'destruct') { setType('destruct'); touch(); }
  }
  refresh();
}
async function homePick(mode) {
  showHome(false);
  setMode(mode === 'custom' ? 'anim' : mode);
  if (mode === 'sound') { openSoundOnly(); return; }
  S.pendingType = mode === 'door' ? null : mode;   // 'custom' | 'destruct' : chosen right after the prop is imported
  if (S.model) { applyPendingType(); return; }
  const paths = await api.openPropDialog();
  if (paths && paths.length) await loadPaths(paths);
}
function applyPendingType() {
  const t = S.pendingType; S.pendingType = null;
  if (!S.model || !t) return;
  if (!S.door.created) createDoor(false);
  setType(t); touch();
  toast(t === 'destruct' ? 'DESTRUCT: choose the number of pieces, then EXPORT FIVEM RESOURCE' : 'ANIMATION: pick a preset or edit the keyframes, then EXPORT FIVEM RESOURCE', 'ok');
}

// ------------------------------------------------------------------ DESTRUCTIBLE panel
let shardTimer = null;
function refreshDestruct() {
  const d = S.door, ds = d.destruct;
  if (document.activeElement !== $('in-pieces')) $('in-pieces').value = ds.pieces;
  $('v-pieces').textContent = ds.pieces;
  seg('des-strength', 'ds', ds.strength);
  seg('des-col', 'dcol', ds.collision || 'mesh');
  $('in-anchored').checked = ds.anchored !== false;
  const ycd = D.destructYcd(d), da0 = ds.anim || (ds.anim = D.defaultDoor().destruct.anim);
  seg('des-mode', 'dm', ycd ? 'ycd' : 'physics');
  $('des-phys').style.display = ycd ? 'none' : ''; $('des-ycd').style.display = ycd ? '' : 'none';
  seg('des-force', 'df', da0.force);
  for (const [k, id] of [['intact', 'dintact'], ['rest', 'drest'], ['rebuild', 'drebuild']]) {
    if (document.activeElement !== $('in-' + id)) $('in-' + id).value = da0[k];
    $('v-' + id).textContent = (+da0[k]).toFixed(1) + ' s';
  }
  const got = S.shards && S.shards.key === shardKey() ? S.shards : null;
  const cut = got ? `<b>${got.pieces.length} pieces</b> (${got.triangles.toLocaleString()} triangles after cutting) · ` : 'Cutting… · ';
  const colTxt = `Collision = ${(ds.collision || 'mesh') === 'mesh' ? 'the real shape of every piece' : 'one box per piece'} (material from COLLISION)`;
  if (ycd) {
    const da = S.desAnim && S.desAnim.key === desAnimKey() ? S.desAnim : null;
    $('des-info').innerHTML = cut + (da ? `loop of <b>${da.duration.toFixed(1)} s</b> (explodes at ${da.explodeAt.toFixed(1)} s, on the ground at ${da.landedAt.toFixed(1)} s). ` : 'computing the explosion… ') +
      `Export = <b>.yft + .ycd + .yed + .ytyp</b>: GTA starts the clip by itself and loops it - <b>no script</b>. The collision of every piece follows the animation. ${colTxt}.`;
    if (got && !da) requestDesAnim();
  } else {
    $('des-info').innerHTML = cut + `strength ${D.DESTRUCT_STRENGTH[ds.strength]}. In-game every piece breaks off by itself when an explosion, a vehicle or bullets hit it hard enough, then falls with real GTA physics - <b>no script</b>. ${colTxt}.`;
    viewer.setDesAnim(null);
  }
  if (!got) requestShards();
}
function desAnimKey() { const ds = S.door.destruct, a = ds.anim || {}; return `${shardKey()}|${a.force}|${a.intact}|${a.rest}|${a.rebuild}`; }
let desAnimTimer = null;
function requestDesAnim() {
  clearTimeout(desAnimTimer);
  desAnimTimer = setTimeout(async () => {
    if (!S.model || !D.destructYcd(S.door) || !S.shards || S.shards.key !== shardKey()) return;
    const key = desAnimKey();
    if (S.desAnim && S.desAnim.key === key) return;
    try {
      const res = await api.destructAnim(S.shards.pieces.map((p) => ({ min: p.min, max: p.max })), S.door.destruct.anim, S.door.destruct.seed);
      if (key !== desAnimKey()) return;
      S.desAnim = { key, ...res };
      S.door._desDur = res.duration;
      viewer.setDesAnim(res);
      refreshDestruct(); applyPreview();
    } catch (e) { toast('Explosion preview failed: ' + e.message, 'err'); }
  }, 200);
}
function shardKey() { return `${S.model?.path}|${S.door.destruct.pieces}|${S.door.destruct.seed}`; }
function requestShards() {
  clearTimeout(shardTimer);
  shardTimer = setTimeout(async () => {
    if (!S.model || S.door.type !== 'destruct') return;
    const key = shardKey();
    if (S.shards && S.shards.key === key) return;
    try {
      const res = await api.splitPreview(S.model.path, S.door.destruct.pieces, S.door.destruct.seed);
      if (key !== shardKey()) return;
      S.shards = { key, pieces: res.pieces, triangles: res.triangles };
      viewer.setShards(res.pieces);
      if (S.desAnim && S.desAnim.key === desAnimKey()) viewer.setDesAnim(S.desAnim);
      refreshDestruct(); updateReadout();
    } catch (e) { toast('Cut failed: ' + e.message, 'err'); }
  }, 250);
}

function engineHint(d) {
  if (d.type === 'custom' || d.type === 'destruct') return '';
  if (d.engine === 'ycd') return 'ANIMATED .YCD: the export makes a GTA animated fragment (.yft) + its open/close clips (.ycd) + an expression (.yed) so the COLLISION FOLLOWS the animation. A small Lua plays the clips with E, synced for every player. No GTA door sound in this mode.';
  if (d.engine === 'scripted') return 'SCRIPTED: the export adds client/server Lua that plays exactly this preview (angle, distance, speed), synced for every player (E in-game).';
  if (d.type === 'normal') return 'NATIVE (default, no script): GTA door system - a physics door players push open. Collision is embedded in the .ydr. Angle & speed only apply in SCRIPTED mode.';
  if (d.type === 'sliding') return `GTA ${D.specialAttribute(d) === 10 ? 'vertical ' : ''}sliding door: opens by itself when peds approach. Distance & speed are decided by the game - use SCRIPTED for exact values.`;
  return D.specialAttribute(d) === 10
    ? 'GTA vertical sliding door (specialAttribute 10, like vanilla shutters): the door system lifts it. Height & speed are decided by the game - use SCRIPTED for exact values.'
    : 'GTA garage door (specialAttribute 5): the door system moves it (usually opened by a script or door lock resource). Use SCRIPTED to get this exact motion.';
}

// ------------------------------------------------------------------ DOOR SETTINGS panel (apply-on-click)
function fillDoorSettings() {
  const d = S.door;
  if (document.activeElement && $('panel-doorsettings').contains(document.activeElement)) return;
  $('ds-name').value = d.name;
  $('ds-type').value = d.type;
  const dir = $('ds-dir');
  const opts = d.type === 'normal' ? [['left', 'Left (hinge)'], ['right', 'Right (hinge)'], ['left-flip', 'Left · flipped'], ['right-flip', 'Right · flipped']]
    : d.type === 'sliding' ? [['left', '← Left'], ['right', 'Right →'], ['up', '↑ Up'], ['down', '↓ Down']]
      : d.type === 'custom' ? [['loop', 'Loop (auto, no script)']] : d.type === 'destruct' ? [['pieces', 'Breaks in pieces']]
      : [['sliding', 'Garage sliding'], ['rollup', 'Garage roll up'], ['sectional', 'Garage sectional']];
  dir.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  dir.value = d.type === 'normal' ? d.normal.hinge + (d.normal.flip ? '-flip' : '') : d.type === 'sliding' ? d.sliding.dir : d.type === 'custom' ? 'loop' : d.type === 'destruct' ? 'pieces' : d.garage.kind;
  const P = pivot();
  $('ds-pivot').value = `${d.pivot.mode.toUpperCase()}  ${D.fmt(P.x, 2)}, ${D.fmt(P.y, 2)}, ${D.fmt(P.z, 2)}`;
  $('ds-angle').value = d.normal.angle;
  $('ds-dist').value = d.type === 'garage' ? d.garage.height : (S.an ? D.slideDistance(d, S.an).toFixed(2) : d.sliding.distance);
  $('ds-speed').value = d.speed;
  $('ds-col').value = d.collision.mode;
  $('ds-lod').value = d.ytyp.lodDist;
}

function applyDoorSettings() {
  const d = S.door;
  const newName = D.sanitizeName($('ds-name').value);
  if (newName !== d.name) { d.name = newName; d.ytyp.archetypeName = ''; d.ytyp.modelName = ''; d.ytyp.ytypName = ''; }
  const t = $('ds-type').value; if (t !== d.type) setType(t);
  const dir = $('ds-dir').value;
  if (d.type === 'normal' && dir.includes('-') || ['left', 'right'].includes(dir) && d.type === 'normal') { d.normal.hinge = dir.split('-')[0]; d.normal.flip = dir.endsWith('-flip'); }
  else if (d.type === 'sliding' && ['left', 'right', 'up', 'down'].includes(dir)) d.sliding.dir = dir;
  else if (d.type === 'garage' && ['sliding', 'rollup', 'sectional'].includes(dir)) d.garage.kind = dir;
  d.normal.angle = Math.max(0, Math.min(180, Number($('ds-angle').value) || 0));
  const dist = Math.max(0, Number($('ds-dist').value) || 0);
  if (d.type === 'garage') d.garage.height = dist;
  else if (d.type === 'sliding' && Math.abs(dist - (S.an ? D.slideDistance(d, S.an) : 0)) > 1e-4) { d.sliding.distance = dist; d.sliding.preset = 'custom'; }
  d.speed = $('ds-speed').value;
  const cm = $('ds-col').value; if (cm !== 'keep' || S.model?.collision) d.collision.mode = cm;
  d.ytyp.lodDist = Math.max(1, Number($('ds-lod').value) || 100);
  if (document.activeElement) document.activeElement.blur();
  refresh(); setDirty(); toast('Door settings applied', 'ok');
}

// ------------------------------------------------------------------ YTYP
function ytypXml(a) {
  const f = (v) => +v.toFixed(6);
  const v = (t, x) => `<${t} x="${f(x[0])}" y="${f(x[1])}" z="${f(x[2])}" />`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<CMapTypes>
 <extensions />
 <archetypes>
  <Item type="CBaseArchetypeDef">
   <lodDist value="${f(a.lodDist)}" />
   <flags value="${a.flags}" />
   <specialAttribute value="${a.specialAttribute}" />
   ${v('bbMin', a.bounds.min)}
   ${v('bbMax', a.bounds.max)}
   ${v('bsCentre', a.bounds.center)}
   <bsRadius value="${f(a.bounds.radius)}" />
   <hdTextureDist value="${f(a.hdTextureDist)}" />
   <name>${a.archetypeName}</name>
   ${a.textureDictionary ? `<textureDictionary>${a.textureDictionary}</textureDictionary>` : '<textureDictionary />'}
   ${a.anim || a.desYcd ? `<clipDictionary>${(a.anim || a.desYcd).dict}</clipDictionary>` : '<clipDictionary />'}
   <drawableDictionary />
   <physicsDictionary>${a.archetypeName}</physicsDictionary>
   <assetType>${a.anim || a.destruct ? 'ASSET_TYPE_FRAGMENT' : 'ASSET_TYPE_DRAWABLE'}</assetType>
   <assetName>${a.modelName}</assetName>
   ${a.anim || a.desYcd ? `<extensions>
    <Item type="CExtensionDefExpression">
     <name>${a.modelName}</name>
     <offsetPosition x="0" y="0" z="0" />
     <expressionDictionaryName>${a.modelName}</expressionDictionaryName>
     <expressionName>${a.modelName}</expressionName>
     <creatureMetadataName />
     <initialiseOnCollision value="false" />
    </Item>
   </extensions>` : '<extensions />'}
  </Item>
 </archetypes>
 <name>${a.ytypName}</name>
 <dependencies />
 <compositeEntityTypes />
</CMapTypes>`;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// lines to paste in an existing resource's fxmanifest.lua (files from EXPORT ALL: .ydr/.ytyp in stream/, sound in audio/)
function fxmanifestLines() {
  if (!S.model || !S.door.created) return '';
  const a = archetype();
  if (a.destruct) {
    if (a.desYcd) return `-- GTA Door Creator : ${a.archetypeName} (destruct .ycd, explosion loop by itself)\n-- stream/${a.modelName}.yft + ${a.desYcd.dict}.ycd + ${a.modelName}.yed + ${a.ytypName}.ytyp\n` +
      `data_file 'DLC_ITYP_REQUEST' 'stream/${a.ytypName}.ytyp'\n`;
    return `-- GTA Door Creator : ${a.archetypeName} (destructible, breaks by itself)\n-- stream/${a.modelName}.yft + ${a.ytypName}.ytyp\n` +
      `data_file 'DLC_ITYP_REQUEST' 'stream/${a.ytypName}.ytyp'\n`;
  }
  if (a.anim && a.anim.auto) {
    return `-- GTA Door Creator : ${a.archetypeName} (custom animation, loops by itself)\n-- stream/${a.modelName}.yft + ${a.anim.dict}.ycd + ${a.modelName}.yed + ${a.ytypName}.ytyp\n` +
      `data_file 'DLC_ITYP_REQUEST' 'stream/${a.ytypName}.ytyp'\n`;
  }
  if (a.anim) {
    return `-- GTA Door Creator : ${a.archetypeName} (animated .ycd)\n-- stream/${a.modelName}.yft + ${a.anim.dict}.ycd + ${a.modelName}.yed + ${a.ytypName}.ytyp\n` +
      `data_file 'DLC_ITYP_REQUEST' 'stream/${a.ytypName}.ytyp'\n-- + the client.lua / server.lua from EXPORT FIVEM RESOURCE (plays ${a.anim.open} / ${a.anim.close})\n`;
  }
  const snd = resolveSound();
  const audio = snd ? `${a.modelName}_game.dat151.rel` : null;
  let t = `-- GTA Door Creator : ${a.archetypeName}\n`;
  t += `-- stream/${a.modelName}.ydr + stream/${a.ytypName}.ytyp${audio ? ` + audio/${audio}` : ''}\n`;
  if (audio) t += `files {\n  'audio/${audio}',\n}\n`;
  t += `data_file 'DLC_ITYP_REQUEST' 'stream/${a.ytypName}.ytyp'\n`;
  if (audio) t += `data_file 'AUDIO_GAMEDATA' 'audio/${audio.replace('.dat151.rel', '.dat')}'\n`;
  return t;
}
async function copyFxmanifest() {
  const t = fxmanifestLines();
  if (!t) { toast('Create a door first', 'err'); return; }
  try { api.copyText(t); } catch { await navigator.clipboard.writeText(t); }
  const b = $('btn-copy-fx'); b.classList.add('done'); b.textContent = '✓ COPIED';
  setTimeout(() => { b.classList.remove('done'); b.textContent = '⧉ COPY'; }, 1600);
  toast('fxmanifest.lua lines copied - paste them in your resource (Ctrl+V)', 'ok');
}

function refreshYtyp() {
  if (!S.model || !S.door.created) { $('ytyp-preview').innerHTML = '<span class="h">Create a door to see its archetype.</span>'; return; }
  const a = archetype(), d = S.door, y = d.ytyp;
  const setVal = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
  setVal('y-arch', a.archetypeName); setVal('y-model', a.modelName); setVal('y-file', a.ytypName + '.ytyp');
  $('y-type').value = a.desYcd ? 'Destruct animation (.ycd)' : a.destruct ? 'Destructible fragment' : a.anim ? 'Animated fragment (.ycd)' : `Door · ${D.SPECIAL_ATTR_NAMES[a.specialAttribute]} (${a.specialAttribute})`;
  const b = a.bounds;
  $('y-bounds').value = `${D.fmt(b.max[0] - b.min[0], 2)} × ${D.fmt(b.max[1] - b.min[1], 2)} × ${D.fmt(b.max[2] - b.min[2], 2)}`;
  $('y-center').value = `${D.fmt(b.center[0])}, ${D.fmt(b.center[1])}, ${D.fmt(b.center[2])}`;
  $('y-radius').value = D.fmt(b.radius);
  setVal('y-lod', a.lodDist); setVal('y-hd', a.hdTextureDist); setVal('y-txd', a.textureDictionary); setVal('y-flags', a.flags);
  $('y-flags-auto').classList.toggle('on', y.flagsAuto);
  $('y-flagchips').innerHTML = D.FLAG_DEFS.map((fd) => `<button data-bit="${fd.bit}" class="${(a.flags >>> fd.bit) & 1 ? 'on' : ''}" title="${(1 << fd.bit) >>> 0}">${fd.name}</button>`).join('');
  $('ytyp-state').textContent = S.ytypGenerated ? 'generated' : 'live';
  $('ytyp-state').classList.toggle('ok', S.ytypGenerated);

  if (S.ypMode === 'fx') {
    $('ytyp-preview').innerHTML = esc(fxmanifestLines()).replace(/^(--.*)$/gm, '<span class="h">$1</span>').replace(/'([^']*)'/g, "'<span class=\"v\">$1</span>'").replace(/\b(files|data_file)\b/g, '<span class="k">$1</span>');
    return;
  }
  if (S.ypMode === 'xml') { $('ytyp-preview').innerHTML = esc(ytypXml(a)).replace(/(&lt;\/?)([A-Za-z?]+)|(\w+)=("[^"]*")/g, (m, lt, tag, k, v) => lt ? `${lt}<span class="t">${tag}</span>` : `<span class="k">${k}</span>=<span class="v">${v}</span>`); return; }
  const K = (k) => `<span class="k">${k}</span>`, V = (v) => `<span class="v">${esc(v)}</span>`;
  const xyz = (arr) => `   X: ${V(D.fmt(arr[0]))}\n   Y: ${V(D.fmt(arr[1]))}\n   Z: ${V(D.fmt(arr[2]))}`;
  const ms = D.motionSpec(d, S.an, pivot());
  $('ytyp-preview').innerHTML =
    `<span class="t">ARCHETYPE</span>  <span class="h">${esc(a.ytypName)}.ytyp</span>
<span class="h">----------------</span>
${K('Name:')}
   ${V(a.archetypeName)}
${K('Model:')}
   ${V(a.modelName)}${a.anim || a.destruct ? '.yft' : '.ydr'}
${K('Type:')}
   ${a.desYcd ? `${V('Destruct animation (.ycd)')} <span class="h">· ${S.door.destruct.pieces} pieces · expression ${esc(a.modelName)}</span>
${K('Clips:')}
   ${V(a.desYcd.dict)}.ycd <span class="h">→ ${esc(a.desYcd.clip)} (auto start, loops - no script)</span>` : a.destruct ? `${V('Destructible fragment')} <span class="h">· ${S.door.destruct.pieces} pieces · strength ${D.DESTRUCT_STRENGTH[S.door.destruct.strength]}${S.door.destruct.anchored === false ? '' : ' · anchored'}</span>` : a.anim ? `${V('Animated fragment')} <span class="h">· ASSET_TYPE_FRAGMENT · expression ${esc(a.modelName)}</span>
${K('Clips:')}
   ${V(a.anim.dict)}.ycd <span class="h">→ ${a.anim.auto ? esc(a.anim.clip) + ' (auto start, loops - no script)' : esc(a.anim.open) + ' / ' + esc(a.anim.close)}</span>` : `${V('Door')} <span class="h">· specialAttribute ${a.specialAttribute} (${D.SPECIAL_ATTR_NAMES[a.specialAttribute]})</span>`}
${K('Bounds:')}  <span class="h">min → max</span>
   X: ${V(D.fmt(b.min[0]))} → ${V(D.fmt(b.max[0]))}
   Y: ${V(D.fmt(b.min[1]))} → ${V(D.fmt(b.max[1]))}
   Z: ${V(D.fmt(b.min[2]))} → ${V(D.fmt(b.max[2]))}
${K('Center:')}
${xyz(b.center)}
${K('Radius:')}
   ${V(D.fmt(b.radius))}
${K('LOD:')}
   ${V(a.lodDist)}
${K('HD LOD:')}
   ${V(a.hdTextureDist)}
${K('Flags:')}
   ${V(a.flags)} <span class="h">${D.FLAG_DEFS.filter((f) => (a.flags >>> f.bit) & 1).map((f) => f.name).join(' + ') || 'none'}</span>
${K('Texture Dict:')}
   ${V(a.textureDictionary || '(none)')}
${K('Physics Dict:')}
   ${V(a.archetypeName)}
${K('Sound:')}
   ${V(a.anim || a.destruct ? 'none (fragment)' : (resolveSound() || { label: 'none' }).label)}
<span class="h">----------------</span>
<span class="t">MOTION</span> <span class="h">(pivot space, used by preview + Lua)</span>
   ${K('kind')} ${V(ms.kind)}  ${K('angle')} ${V(ms.angle.toFixed(1) + '°')}  ${K('offset')} ${V(ms.offset.map((x) => x.toFixed(2)).join(', '))}`;
}

// ------------------------------------------------------------------ export
function refreshExport() {
  const d = S.door;
  seg('ytyp-target', 'yt', d.ytyp.mergePath ? 'mine' : 'new');
  $('ytyp-mine').classList.toggle('hidden', !d.ytyp.mergePath);
  $('ytyp-mine-name').textContent = d.ytyp.mergePath ? '+ ' + basename(d.ytyp.mergePath) : '';
  $('ytyp-mine-name').title = d.ytyp.mergePath || '';
  $('out-folder').textContent = d.export.folder || 'No output folder';
  $('out-folder').title = d.export.folder || '';
  $('ex-streamybn').checked = !!d.export.streamYbn;
  $('ex-script').checked = d.export.withScript === true;
  const a = S.model && d.created ? archetype() : null;
  const n = a ? a.modelName : 'my_door';
  const col = d.collision.mode !== 'none';
  if (d.type === 'destruct') {
    if (D.destructYcd(d)) {
      $('fivem-tree').textContent = `${n}/ stream/{${n}.yft, ${n}_anim.ycd, ${n}.yed, ${a ? a.ytypName : n}.ytyp} · fxmanifest.lua · no script (explosion loop)`;
      $('ex-ydr').textContent = 'EXPORT YFT+YCD'; $('ex-ybn').disabled = true;
      return;
    }
    $('fivem-tree').textContent = `${n}/ stream/{${n}.yft, ${a ? a.ytypName : n}.ytyp} · fxmanifest.lua · no script (breaks with explosions / impacts)`;
    $('ex-ydr').textContent = 'EXPORT YFT'; $('ex-ybn').disabled = true;
    return;
  }
  if (D.isAnim(d)) {
    $('fivem-tree').textContent = `${n}/ stream/{${n}.yft, ${n}_anim.ycd, ${n}.yed, ${a ? a.ytypName : n}.ytyp} · fxmanifest.lua${d.type === 'custom' ? ' · no script (auto loop)' : ' · client/server.lua'}`;
    $('ex-ydr').textContent = 'EXPORT YFT+YCD'; $('ex-ybn').disabled = true;
    return;
  }
  $('ex-ydr').textContent = 'EXPORT YDR';
  $('fivem-tree').textContent = `${n}/ stream/{${n}.ydr, ${a ? a.ytypName : n}.ytyp${col && d.export.streamYbn ? `, ${n}.ybn` : ''}} · fxmanifest.lua${d.export.withScript === true ? ' · client/server.lua' : ' · no script'}`;
  $('ex-ybn').disabled = !col;
}

async function ensureFolder() {
  if (S.door.export.folder) return S.door.export.folder;
  const f = await api.chooseFolder('Choose the export folder');
  if (!f) return null;
  S.door.export.folder = f; S.settings.outFolder = f; api.saveSettings(S.settings);
  refreshExport(); setDirty();
  return f;
}

function exportJob(outDir, outputs) {
  const a = archetype(), col = collisionInfo();
  return {
    source: S.model.path, outDir, name: a.modelName, pivot: [pivot().x, pivot().y, pivot().z], outputs,
    collision: col.job,
    ytyp: {
      ytypName: a.ytypName, archetypeName: a.archetypeName, assetName: a.modelName, lodDist: a.lodDist, hdTextureDist: a.hdTextureDist,
      flags: a.flags, specialAttribute: a.specialAttribute, textureDictionary: a.textureDictionary, physicsDictionary: a.archetypeName,
      mergeInto: a.mergePath || undefined,
    },
    destruct: a.destruct ? { pieces: S.door.destruct.pieces, seed: S.door.destruct.seed, strength: D.DESTRUCT_STRENGTH[S.door.destruct.strength], anchored: S.door.destruct.anchored !== false, collision: S.door.destruct.collision || 'mesh',
      anim: D.destructYcd(S.door) ? { on: true, ...S.door.destruct.anim, dict: a.modelName + '_anim' } : undefined } : undefined,
    anim: a.anim ? (() => {
      if (a.anim.auto) return { dict: a.anim.dict, samples: D.customSamples(S.door) };
      const ms = D.motionSpec(S.door, S.an, pivot());
      return { kind: ms.kind, axis: ms.axis, angle: ms.angle, center: ms.center, offset: ms.offset, duration: D.duration(S.door), dict: a.anim.dict };
    })() : undefined,
  };
}

async function doExport(outputs, label) {
  if (!S.model || !S.door.created) return null;
  const dir = await ensureFolder(); if (!dir) return null;
  try {
    log(`› ${label}…`);
    const res = await api.exportFiles(exportJob(dir, outputs));
    for (const f of res.files) log(`  ✓ ${f}`, 'ok');
    if (archetype().mergePath) log(`  ⚠ ${archetype().ytypName}.ytyp = YOUR ytyp + this prop. Use it in place of your original (MLO resource) - never stream both. A .bak copy of your file was kept.`, 'w');
    if (outputs.ydr && outputs.ytyp && S.door.type === 'destruct') {
      log(D.destructYcd(S.door) ? '  ⧉ Put these 4 files in stream/ + the data_file line (COPY FXMANIFEST): the explosion loops by itself, no script'
        : '  ⧉ Put the .yft + .ytyp in stream/ + the data_file line (COPY FXMANIFEST): it breaks by itself, no script', 'w');
    } else if (outputs.ydr && outputs.ytyp && D.isAnim(S.door)) {
      log(S.door.type === 'custom' ? '  ⧉ Put these 4 files in stream/ + the data_file line (COPY FXMANIFEST): the animation loops by itself, no script' : '  ⧉ Put these 4 files in stream/ and use EXPORT FIVEM RESOURCE for the Lua that plays the clips', 'w');
    } else if (outputs.ydr && outputs.ytyp) {
      const a = archetype();
      const audio = await writeAudio(dir, a);
      if (audio) log(`  ✓ ${joinPath(dir, audio.file)}  (sound: ${audio.label}) → put it in your resource's audio/ folder`, 'ok');
      log('  ⧉ Click "COPY FXMANIFEST" (YTYP PREVIEW) to get the lines for your fxmanifest.lua', 'w');
    }
    for (const w of res.warnings || []) log(`  ! ${w}`, 'w');
    if (outputs.ytyp) { S.ytypGenerated = true; }
    S.exported = S.exported || (outputs.ydr && outputs.ytyp);
    refreshYtyp(); refreshSteps();
    toast(`${label}: ${res.files.length} file(s) written`, 'ok');
    return res;
  } catch (err) { log(`  ✗ ${err.message}`, 'err'); toast(err.message, 'err'); return null; }
}

async function exportFiveM() {
  if (!S.model || !S.door.created) return;
  let parent = S.door.export.folder || await api.chooseFolder('Where should the FiveM resource folder be created?');
  if (!parent) return;
  if (!S.door.export.folder) { S.door.export.folder = parent; S.settings.outFolder = parent; api.saveSettings(S.settings); }
  const a = archetype();
  const resName = a.modelName;
  const root = joinPath(parent, resName);
  if (await api.exists(root)) {
    const r = await modal('Resource exists', `<p>The folder <b>${esc(resName)}</b> already exists in<br><span class="muted">${esc(parent)}</span></p><p>Overwrite its files?</p>`,
      [{ label: 'Cancel', value: false }, { label: 'Overwrite', value: true, accent: true }]);
    if (!r) return;
  }
  const anim = D.isAnim(S.door), destruct = S.door.type === 'destruct';
  const withScript = (anim && S.door.type !== 'custom') || S.door.export.withScript === true;
  if (!withScript && !anim && !destruct && S.door.engine !== 'native') {
    S.door.engine = 'native'; refresh();
    toast('No-script resource: switched to NATIVE DOOR (the GTA door system moves it)', 'ok');
  }
  const stream = joinPath(root, 'stream');
  const hasCol = S.door.collision.mode !== 'none' && S.door.export.streamYbn;
  try {
    log(`› FiveM resource → ${root}`);
    await api.mkdir(stream);
    const res = await api.exportFiles(exportJob(stream, { ydr: true, ytyp: true, ybn: hasCol }));
    const streamFiles = [];
    for (const f of res.files) {
      const b = basename(f);
      if (b.endsWith('.ybn') && !S.door.export.streamYbn) {
        const dest = joinPath(root, 'collision', b);
        await api.remove(dest); await api.move(f, dest);
        log(`  ✓ collision/${b}  (not streamed - collision is embedded in the .ydr)`, 'ok');
      } else { streamFiles.push(b); log(`  ✓ stream/${b}`, 'ok'); }
    }
    if (destruct && D.destructYcd(S.door)) log(`  ✓ ${res.archetype?.pieces ?? ''} pieces · explosion loop ${res.archetype?.duration ?? ''} s (.ycd) · collision follows the pieces (.yed)`, 'ok');
    else if (destruct) log(`  ✓ ${res.archetype?.pieces ?? ''} breakable pieces, one collision box each`, 'ok');
    else if (anim) log('  ✓ collision follows the animation (fragment + expression)', 'ok');
    else if (S.door.collision.mode !== 'none') log('  ✓ collision embedded in ' + a.modelName + '.ydr', 'ok');
    const audio = anim || destruct ? null : await writeAudio(joinPath(root, 'audio'), a);
    if (audio) log(`  ✓ audio/${audio.file}  (sound: ${audio.label})`, 'ok');
    const files = buildResource({ door: S.door, an: S.an, pivot: pivot(), resourceName: resName, ytypFile: a.ytypName + '.ytyp', streamFiles, withScript, anim: a.anim, destruct: destruct ? { pieces: res.archetype?.pieces ?? S.door.destruct.pieces, strength: D.DESTRUCT_STRENGTH[S.door.destruct.strength], anchored: S.door.destruct.anchored !== false, ycd: D.destructYcd(S.door) ? { dict: res.archetype?.dict, clip: res.archetype?.clips?.[0], duration: res.archetype?.duration, explodeAt: res.archetype?.explodeAt } : null } : null, modelName: a.modelName, audioFile: audio && audio.file, soundLabel: audio && audio.label });
    for (const [fname, text] of Object.entries(files)) { await api.writeText(joinPath(root, fname), text); log(`  ✓ ${fname}`, 'ok'); }
    if (archetype().mergePath) log(`  ⚠ ${archetype().ytypName}.ytyp = YOUR ytyp + this prop. Use it in place of your original (MLO resource) - never stream both. A .bak copy of your file was kept.`, 'w');
    for (const w of res.warnings || []) log(`  ! ${w}`, 'w');
    S.ytypGenerated = true; S.exported = true; refreshYtyp(); refreshSteps();
    toast(`FiveM resource "${resName}" ready`, 'ok');
    const r = await modal('FiveM resource ready', `<p><b>${esc(resName)}/</b> was created in<br><span class="muted">${esc(parent)}</span></p><p>Add <code>ensure ${esc(resName)}</code> to server.cfg and place <b>${esc(a.archetypeName)}</b> in your ymap / MLO.</p>`,
      [{ label: 'Close', value: false }, { label: 'Open folder', value: true, accent: true }]);
    if (r) api.openPath(root);
  } catch (err) { log(`  ✗ ${err.message}`, 'err'); toast(err.message, 'err'); }
}

// ------------------------------------------------------------------ steps
function refreshSteps() {
  const d = S.door;
  const done = [!!S.model, d.created, d.created && d.typeChosen, d.created && d.typeChosen && S.configured, S.preview.played, S.ytypGenerated, S.exported];
  const cur = done.indexOf(false);
  $$('#steps li').forEach((li, i) => { li.classList.toggle('done', done[i]); li.classList.toggle('current', i === cur); });
}

// ------------------------------------------------------------------ presets
function presetPayload() {
  const d = S.door;
  return {
    type: d.type, engine: d.engine, speed: d.speed,
    normal: { ...d.normal }, sliding: { ...d.sliding },
    garage: { kind: d.garage.kind, panels: d.garage.panels, panelSize: d.garage.panelSize },
    collision: { mode: d.collision.mode === 'import' || d.collision.mode === 'keep' ? 'auto' : d.collision.mode, shape: d.collision.shape === 'custom' ? 'box' : d.collision.shape, material: d.collision.material },
    lodDist: d.ytyp.lodDist,
  };
}
function applyPreset(p) {
  if (!S.model) { toast('Import a prop first', 'err'); return; }
  if (!S.door.created) createDoor(false);
  const d = S.door, c = p.config;
  setType(c.type);
  if (c.engine) { d.engine = c.engine; d.export.withScript = c.engine !== 'native'; }
  if (c.speed) d.speed = c.speed;
  if (c.normal) Object.assign(d.normal, c.normal);
  if (c.sliding) Object.assign(d.sliding, c.sliding);
  if (c.garage) Object.assign(d.garage, c.garage);
  if (c.collision) { if (c.collision.mode && !['keep', 'import'].includes(d.collision.mode)) d.collision.mode = c.collision.mode; if (c.collision.shape) d.collision.shape = c.collision.shape; if (c.collision.material) d.collision.material = c.collision.material; }
  if (c.lodDist) d.ytyp.lodDist = c.lodDist;
  if (d.type === 'garage' && S.an) { d.garage.height = +S.an.size[2].toFixed(3); }
  S.configured = true;
  refresh(); setDirty(); toast(`Preset "${p.name}" applied`, 'ok');
}
function renderPresets() {
  const list = [...BUILTIN_PRESETS.map((p) => ({ ...p, builtin: true })), ...S.userPresets];
  $('preset-list').innerHTML = list.map((p, i) => `<button data-i="${i}" class="${p.builtin ? '' : 'user'}">${esc(p.name)}<small>${esc(p.sub || p.config.type)}</small>${p.builtin ? '' : '<span class="del" data-del="' + i + '">delete</span>'}</button>`).join('');
  $$('#preset-list button').forEach((b) => b.onclick = async (e) => {
    const i = +b.dataset.i;
    if (e.target.dataset.del) {
      const ui = i - BUILTIN_PRESETS.length; S.userPresets.splice(ui, 1); await api.savePresets(S.userPresets); renderPresets(); return;
    }
    applyPreset(list[i]);
  });
}
async function savePreset() {
  if (!S.door.created) { toast('Create a door first', 'err'); return; }
  const name = await prompt('Save preset', 'Preset name', `${S.door.type} ${S.door.type === 'normal' ? S.door.normal.angle + '°' : ''}`.trim());
  if (!name) return;
  const sub = S.door.type === 'normal' ? `${S.door.normal.angle}° · ${S.door.speed}` : S.door.type === 'sliding' ? `${S.door.sliding.dir} · ${S.door.speed}` : `${S.door.garage.kind} · ${S.door.speed}`;
  S.userPresets.push({ name, sub, config: presetPayload() });
  await api.savePresets(S.userPresets); renderPresets(); toast(`Preset "${name}" saved`, 'ok');
}

// ------------------------------------------------------------------ project
async function newProject() {
  if (S.project.dirty && S.model) {
    const r = await modal('New project', '<p>Discard the current unsaved door?</p>', [{ label: 'Cancel', value: false }, { label: 'Discard', value: true, accent: true }]);
    if (!r) return;
  }
  S.model = null; S.an = null; S.door = D.defaultDoor(); S.door.export.folder = S.settings.outFolder || null;
  S.ybn = null; S.extraTextures = []; S.project = { path: null, dirty: false };
  S.ytypGenerated = false; S.exported = false; S.preview = { t: 0, playing: false, dir: 1, loop: S.preview.loop, played: false }; S.configured = false;
  viewer.clearModel(); viewer.textures.clear();
  $('vp-empty').classList.remove('hidden'); $('dropzone').classList.remove('hidden'); $('prop-info').classList.add('hidden');
  $('export-log').innerHTML = '';
  refresh(); setDirty(false);
}

async function saveProject(as = false) {
  if (!S.model) { toast('Nothing to save yet - import a prop first', 'err'); return; }
  let p = S.project.path;
  if (!p || as) { p = await api.saveProjectDialog((S.door.name || 'door') + '.doorproject'); if (!p) return; }
  const proj = {
    format: 'gta-door-creator-project', version: 1, savedAt: new Date().toISOString(),
    door: S.door, preview: { loop: S.preview.loop }, state: { ytypGenerated: S.ytypGenerated, exported: S.exported, configured: !!S.configured },
    model: { file: basename(S.model.path), data: await api.readB64(S.model.path) },
    ybn: S.ybn ? { file: S.ybn.file, data: await api.readB64(S.ybn.path) } : null,
    textures: S.extraTextures,
  };
  await api.writeText(p, JSON.stringify(proj));
  S.project.path = p; setDirty(false); toast(`Project saved: ${basename(p)}`, 'ok');
}

async function openProject(path) {
  if (!path) path = await api.openProjectDialog();
  if (!path) return;
  try {
    const proj = JSON.parse(await api.readText(path));
    if (proj.format !== 'gta-door-creator-project') throw new Error('Not a .doorproject file');
    const tmp = await api.tempDir('project-' + Date.now());
    const mp = joinPath(tmp, proj.model.file);
    await api.writeB64(mp, proj.model.data);
    S.extraTextures = proj.textures || [];
    viewer.textures.clear();
    if (proj.ybn) {
      const yp = joinPath(tmp, proj.ybn.file); await api.writeB64(yp, proj.ybn.data);
      S.ybn = await api.load(yp);
    } else S.ybn = null;
    const res = await api.load(mp);
    const door = Object.assign(D.defaultDoor(), proj.door);
    for (const k of ['normal', 'sliding', 'garage', 'pivot', 'collision', 'sound', 'ytyp', 'export', 'custom', 'destruct']) door[k] = Object.assign(D.defaultDoor()[k], proj.door[k] || {});
    if (S.ybn) door.collision.ybnPath = S.ybn.path;
    if (proj.door.export && proj.door.export.withScript === undefined) door.export.withScript = proj.door.engine !== 'native';
    S.ytypGenerated = !!proj.state?.ytypGenerated; S.exported = !!proj.state?.exported; S.configured = !!proj.state?.configured;
    S.preview = { t: 0, playing: false, dir: 1, loop: !!proj.preview?.loop, played: false };
    await onYdr(res, door);
    S.project.path = path; setDirty(false);
    toast(`Project opened: ${basename(path)}`, 'ok');
  } catch (err) { toast('Could not open project: ' + err.message, 'err'); }
}

// ------------------------------------------------------------------ events
function touch() { S.configured = true; setDirty(); refresh(); }

function bind() {
  // menu
  $('menu-file').onclick = (e) => { e.stopPropagation(); $('menu-file').classList.toggle('open'); };
  document.addEventListener('click', () => $('menu-file').classList.remove('open'));
  $$('#menu-file [data-cmd]').forEach((b) => b.onclick = () => menuCmd(b.dataset.cmd));
  api?.onMenu(menuCmd);
  api?.onOpenProject?.((p) => { showHome(false); openProject(p); });
  $('btn-home').onclick = () => showHome(true);
  $('btn-settings').onclick = openSettings;
  $$('[data-home]').forEach((b) => b.onclick = () => homePick(b.dataset.home));
  $('home-open').onclick = () => { showHome(false); setMode(null); openProject(); };
  $('home-continue').onclick = () => { showHome(false); if (!S.mode || S.mode === 'sound') setMode('door'); };

  // import
  const importDialog = async () => loadPaths(await api.openPropDialog());
  $('btn-import').onclick = importDialog; $('dropzone').onclick = importDialog;
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
    const proj = paths.find((p) => p.toLowerCase().endsWith('.doorproject'));
    if (proj) openProject(proj); else loadPaths(paths);
  });

  // create / detect
  $('btn-create').onclick = () => createDoor(true);
  $('btn-detect').onclick = () => { runDetect(); toast('Prop analysed'); };
  $('btn-accept').onclick = acceptDetect;

  // type
  $$('.type-btn').forEach((b) => b.onclick = () => { setType(b.dataset.type); touch(); });

  // normal
  $$('[data-hinge]').forEach((b) => b.onclick = () => { S.door.normal.hinge = b.dataset.hinge; if (S.door.pivot.mode !== 'custom') S.door.pivot.mode = 'auto'; touch(); });
  $('btn-flip').onclick = () => { S.door.normal.flip = !S.door.normal.flip; touch(); };
  $('btn-autopivot').onclick = () => {
    runDetect(); S.door.normal.hinge = S.detect.hinge; S.door.pivot.mode = 'auto'; touch();
    toast(`Auto pivot: hinge on the ${S.detect.hinge.toUpperCase()} edge${S.an.handle ? ' (opposite the handle)' : ''}`, 'ok');
  };
  $('in-angle').oninput = () => { S.door.normal.angle = +$('in-angle').value; touch(); };

  // sliding
  $$('[data-sdir]').forEach((b) => b.onclick = () => { S.door.sliding.dir = b.dataset.sdir; touch(); });
  $$('[data-sd]').forEach((b) => b.onclick = () => {
    const v = b.dataset.sd;
    if (v === 'auto' || v === 'custom') S.door.sliding.preset = v;
    else { S.door.sliding.preset = 'fixed'; S.door.sliding.distance = +v; }
    touch();
  });
  $('in-sdist').oninput = () => { S.door.sliding.distance = Math.max(0, +$('in-sdist').value || 0); S.door.sliding.preset = 'custom'; touch(); };

  // garage
  $$('[data-gkind]').forEach((b) => b.onclick = () => {
    S.door.garage.kind = b.dataset.gkind;
    if (b.dataset.gkind === 'rollup' && S.door.garage.panels < 8) S.door.garage.panels = 12;
    if (b.dataset.gkind === 'sectional' && S.door.garage.panels > 8) S.door.garage.panels = 5;
    S.door.garage.panelSize = 0; touch();
  });
  $('in-gheight').oninput = () => { S.door.garage.height = Math.max(0, +$('in-gheight').value || 0); touch(); };
  $('in-gdist').oninput = () => { S.door.garage.distance = Math.max(0, +$('in-gdist').value || 0); touch(); };
  $('in-gpanels').oninput = () => { S.door.garage.panels = Math.max(1, Math.min(40, Math.round(+$('in-gpanels').value || 1))); S.door.garage.panelSize = 0; touch(); };
  $('in-gpsize').oninput = () => { S.door.garage.panelSize = Math.max(0.05, +$('in-gpsize').value || 0); if (S.an) S.door.garage.panels = Math.max(1, Math.ceil(S.an.size[2] / S.door.garage.panelSize - 1e-6)); touch(); };
  $('in-ingame').onchange = () => { S.door.garage.previewInGame = $('in-ingame').checked; touch(); };

  $$('[data-speed]').forEach((b) => b.onclick = () => { S.door.speed = b.dataset.speed; touch(); });
  $$('[data-engine]').forEach((b) => b.onclick = () => { S.door.engine = b.dataset.engine; S.door.export.withScript = b.dataset.engine !== 'native'; touch(); });

  // pivot
  $$('[data-pmode]').forEach((b) => b.onclick = () => {
    const m = b.dataset.pmode;
    if (m === 'custom') { const P = pivot(); Object.assign(S.door.pivot, P); }
    else if (m === 'left' || m === 'right') { if (S.door.type === 'normal') S.door.normal.hinge = m; }
    S.door.pivot.mode = m; touch();
  });
  for (const k of ['x', 'y', 'z']) $('pv-' + k).oninput = () => {
    const P = pivot(); Object.assign(S.door.pivot, P, { mode: 'custom' });
    S.door.pivot[k] = +$('pv-' + k).value || 0; touch();
  };
  $('btn-gizmo').onclick = () => {
    S.gizmo = !S.gizmo;
    viewer.enableGizmo(S.gizmo, (pos) => {
      Object.assign(S.door.pivot, { mode: 'custom', x: +pos.x.toFixed(4), y: +pos.y.toFixed(4), z: +pos.z.toFixed(4) });
      viewer.gizmoDragging = true; touch(); viewer.gizmoDragging = false;
    });
    refresh();
  };

  // collision
  $$('[data-cmode]').forEach((b) => b.onclick = async () => {
    const m = b.dataset.cmode;
    if (m === 'import' && !S.ybn) { const p = await api.openYbnDialog(); if (!p) return; await loadPaths([p]); return; }
    S.door.collision.mode = m; touch();
  });
  $$('[data-cshape]').forEach((b) => b.onclick = () => { S.door.collision.shape = b.dataset.cshape; touch(); });
  $('btn-ybn').onclick = async () => { const p = await api.openYbnDialog(); if (p) loadPaths([p]); };
  $('col-material').onchange = () => { S.door.collision.material = +$('col-material').value; touch(); };
  ['x', 'y', 'z'].forEach((k, i) => {
    $('cb-min' + k).oninput = () => { S.door.collision.boxMin[i] = +$('cb-min' + k).value; touch(); };
    $('cb-max' + k).oninput = () => { S.door.collision.boxMax[i] = +$('cb-max' + k).value; touch(); };
  });

  // sound only tool
  $('btn-soundonly').onclick = () => { showHome(false); setMode('sound'); openSoundOnly(); };
  $('so-close').onclick = () => { $('so-modal').classList.add('hidden'); if (S.mode === 'sound') showHome(true); };
  $('so-names').oninput = soRefresh; $('so-file').oninput = soRefresh;
  $('so-sound').onchange = () => { SO.sound = $('so-sound').value; soRefresh(); };
  $('so-fromytyp').onclick = soFromYtyp;
  $('so-fromcurrent').onclick = () => { if (!S.model || !S.door.created) { toast('No door in the editor', 'err'); return; } const n = archetype().archetypeName; if (!soNames().includes(n)) $('so-names').value = ($('so-names').value.trim() ? $('so-names').value.trim() + '\n' : '') + n; soRefresh(); };
  $('so-copy').onclick = () => { api.copyText($('so-fx').textContent); toast('fxmanifest lines copied (Ctrl+V)', 'ok'); };
  $('so-create').onclick = soCreate;

  // door sound
  $('snd-select').onchange = () => {
    const v = $('snd-select').value;
    S.door.sound = v === 'auto' || v === 'none' ? { mode: v, id: null } : { mode: 'set', id: v };
    touch();
  };

  // door settings
  $('btn-apply').onclick = applyDoorSettings;

  // destructible
  $('in-pieces').oninput = () => { S.door.destruct.pieces = +$('in-pieces').value; $('v-pieces').textContent = S.door.destruct.pieces; touch(); };
  $('btn-recut').onclick = () => { S.door.destruct.seed = (S.door.destruct.seed | 0) + 1; touch(); };
  $('btn-breakprev').onclick = () => { S.preview.t = 0; play(); };
  $$('[data-ds]').forEach((b) => b.onclick = () => { S.door.destruct.strength = b.dataset.ds; touch(); });
  $$('[data-dcol]').forEach((b) => b.onclick = () => { S.door.destruct.collision = b.dataset.dcol; touch(); });
  $('in-anchored').onchange = () => { S.door.destruct.anchored = $('in-anchored').checked; touch(); };
  $$('[data-dm]').forEach((b) => b.onclick = () => { S.door.destruct.mode = b.dataset.dm; S.preview.t = 0; touch(); });
  $$('[data-df]').forEach((b) => b.onclick = () => { S.door.destruct.anim.force = b.dataset.df; touch(); });
  for (const [k, id] of [['intact', 'dintact'], ['rest', 'drest'], ['rebuild', 'drebuild']])
    $('in-' + id).oninput = () => { S.door.destruct.anim[k] = +$('in-' + id).value; $('v-' + id).textContent = (+$('in-' + id).value).toFixed(1) + ' s'; touch(); };

  // custom animation
  $$('[data-ap]').forEach((b) => b.onclick = () => { S.door.custom = JSON.parse(JSON.stringify(D.ANIM_PRESETS[b.dataset.ap])); S.preview.t = 0; touch(); refreshCustom(true); play(); });
  $$('[data-ai]').forEach((b) => b.onclick = () => { S.door.custom.interp = b.dataset.ai; touch(); });
  $('kf-table').addEventListener('input', (e) => {
    const inp = e.target, row = inp.closest('.kf-row');
    if (!row || !inp.dataset.f) return;
    const k = S.door.custom.keys[+row.dataset.i], f = inp.dataset.f, v = Number(inp.value) || 0;
    if (f === 't') k.t = Math.max(0, v); else k[f[0]][+f[1]] = v;
    touch();
  });
  $('kf-table').addEventListener('change', () => { S.door.custom.keys.sort((a, b) => a.t - b.t); refreshCustom(true); });
  $('kf-table').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]'); if (!b || b.disabled) return;
    S.door.custom.keys.splice(+b.dataset.del, 1); touch(); refreshCustom(true);
  });
  $('kf-add').onclick = () => { const ks = S.door.custom.keys, last = ks[ks.length - 1]; ks.push({ t: +(last.t + 1).toFixed(2), r: [...last.r], p: [...last.p] }); touch(); refreshCustom(true); };
  $('kf-addnow').onclick = () => {
    const d = S.door, t = +(S.preview.t * D.customDuration(d)).toFixed(2);
    if (d.custom.keys.some((k) => Math.abs(k.t - t) < 1e-3)) { toast(`There is already a key at ${t} s`, 'err'); return; }
    const pose = D.customPose(d, t);
    d.custom.keys.push({ t, r: pose.r.map((v) => +v.toFixed(2)), p: pose.p.map((v) => +v.toFixed(3)) });
    d.custom.keys.sort((a, b) => a.t - b.t); touch(); refreshCustom(true);
  };
  $('ds-type').onchange = () => { const d = S.door; const t = $('ds-type').value; const save = d.type; d.type = t; fillDirOptionsOnly(); d.type = save; };

  // presets
  $('btn-savepreset').onclick = savePreset;

  // viewport
  $$('#view-seg [data-view]').forEach((b) => b.onclick = () => { viewer.setView(b.dataset.view); seg('view-seg', 'view', b.dataset.view); });
  $$('#shade-seg [data-shade]').forEach((b) => b.onclick = () => { viewer.setShading(b.dataset.shade); seg('shade-seg', 'shade', b.dataset.shade); });
  $('btn-frame').onclick = () => viewer.frame();
  const toggle = (id, fn) => { $(id).onclick = () => { const on = !$(id).classList.contains('on'); $(id).classList.toggle('on', on); fn(on); }; };
  toggle('btn-grid', (on) => viewer.setGrid(on));
  toggle('btn-colvis', (on) => viewer.setCollisionVisible(on));
  toggle('btn-ghost', (on) => viewer.setGhostVisible(on));

  // preview transport
  $('pv-play').onclick = play;
  $('pv-pause').onclick = () => { S.preview.playing = false; applyPreview(); };
  $('pv-stop').onclick = () => { S.preview.playing = false; S.preview.t = 0; S.preview.dir = 1; applyPreview(); };
  $('pv-reset').onclick = () => { S.preview.playing = false; S.preview.t = 0; S.preview.dir = 1; applyPreview(); viewer.setView(viewer.viewName); };
  $('pv-slider').oninput = () => { S.preview.playing = false; S.preview.t = +$('pv-slider').value / 1000; S.preview.played = true; applyPreview(); refreshSteps(); };
  $('pv-loop').onclick = () => { S.preview.loop = !S.preview.loop; $('pv-loop').classList.toggle('on', S.preview.loop); if (S.preview.loop && !S.preview.playing) play(); };

  // ytyp
  $('y-arch').oninput = () => { S.door.ytyp.archetypeName = $('y-arch').value; setDirty(); refreshYtyp(); refreshExport(); };
  $('y-model').oninput = () => { S.door.ytyp.modelName = $('y-model').value; setDirty(); refreshYtyp(); refreshExport(); };
  $('y-file').oninput = () => { S.door.ytyp.ytypName = $('y-file').value.replace(/\.ytyp$/i, ''); setDirty(); refreshYtyp(); refreshExport(); };
  $('y-lod').oninput = () => { S.door.ytyp.lodDist = Math.max(1, +$('y-lod').value || 1); setDirty(); refreshYtyp(); };
  $('y-hd').oninput = () => { S.door.ytyp.hdTextureDist = Math.max(0, +$('y-hd').value || 0); setDirty(); refreshYtyp(); };
  $('y-txd').oninput = () => { S.door.ytyp.textureDictionary = $('y-txd').value.trim().toLowerCase(); setDirty(); refreshYtyp(); };
  $('y-flags').oninput = () => { S.door.ytyp.flags = Math.max(0, Math.floor(+$('y-flags').value || 0)) >>> 0; S.door.ytyp.flagsAuto = false; setDirty(); refreshYtyp(); };
  $('y-flags-auto').onclick = () => { S.door.ytyp.flagsAuto = true; setDirty(); refreshYtyp(); };
  $('y-flagchips').onclick = (e) => {
    const bit = e.target.dataset.bit; if (bit === undefined) return;
    const cur = archetype().flags; S.door.ytyp.flags = (cur ^ (1 << +bit)) >>> 0; S.door.ytyp.flagsAuto = false; setDirty(); refreshYtyp();
  };
  $$('#yp-mode [data-yp]').forEach((b) => b.onclick = () => { S.ypMode = b.dataset.yp; seg('yp-mode', 'yp', S.ypMode); refreshYtyp(); });
  $('btn-copy-fx').onclick = copyFxmanifest;
  $('btn-genytyp').onclick = () => doExport({ ydr: false, ytyp: true, ybn: false }, 'Generate YTYP');

  // export
  const pickMyYtyp = async () => {
    const p = await api.openYtypDialog();
    if (p) { S.door.ytyp.mergePath = p; touch(); toast(`The archetype will be added to ${basename(p)} (a .bak copy of your file is kept)`, 'ok'); }
  };
  $$('[data-yt]').forEach((b) => b.onclick = () => { if (b.dataset.yt === 'new') { S.door.ytyp.mergePath = null; touch(); } else pickMyYtyp(); });
  $('ytyp-mine-change').onclick = pickMyYtyp;
  $('btn-outfolder').onclick = async () => { const f = await api.chooseFolder('Choose the export folder'); if (f) { S.door.export.folder = f; S.settings.outFolder = f; api.saveSettings(S.settings); refreshExport(); setDirty(); } };
  $('ex-ydr').onclick = () => doExport({ ydr: true, ytyp: false, ybn: false }, 'Export YDR');
  $('ex-ytyp').onclick = () => doExport({ ydr: false, ytyp: true, ybn: false }, 'Export YTYP');
  $('ex-ybn').onclick = () => doExport({ ydr: false, ytyp: false, ybn: true }, 'Export YBN');
  $('ex-all').onclick = () => doExport({ ydr: true, ytyp: true, ybn: !!S.door.export.streamYbn && S.door.collision.mode !== 'none' }, 'Export all (collision embedded in the .ydr)');
  $('ex-fivem').onclick = exportFiveM;
  $('ex-script').onchange = () => { S.door.export.withScript = $('ex-script').checked; S.door.engine = S.door.export.withScript ? (S.door.engine === 'ycd' ? 'ycd' : 'scripted') : 'native'; touch(); };
  $('ex-streamybn').onchange = async () => {
    if ($('ex-streamybn').checked) {
      const ok = await modal('Stream the .ybn?', `<p>The door's collision is already <b>embedded in the .ydr</b> - that is what makes it solid and lets it move.</p>
        <p>A streamed .ybn is loaded by GTA as <b>static world collision at its own coordinates</b>. Since it is authored around the model origin, it would create an invisible block near the map origin (0,0,0) unless you placed it there on purpose.</p>
        <p class="muted">Leave this off unless you know you need it; the .ybn is still saved in the resource's collision/ folder.</p>`,
        [{ label: 'Keep off', value: false }, { label: 'Stream it anyway', value: true }]);
      $('ex-streamybn').checked = ok;
    }
    S.door.export.streamYbn = $('ex-streamybn').checked; setDirty(); refreshExport();
  };

  // keyboard
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); saveProject(e.shiftKey); }
      else if (k === 'o') { e.preventDefault(); openProject(); }
      else if (k === 'n') { e.preventDefault(); newProject(); }
      else if (k === 'i') { e.preventDefault(); importDialog(); }
      return;
    }
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); S.preview.playing ? (S.preview.playing = false, applyPreview()) : play(); }
    else if (k === 'f') viewer.frame();
    else if (k === 'g') $('btn-grid').click();
    else if (k === 'c') $('btn-colvis').click();
    else if (k === 'z') { const order = ['wire', 'solid', 'material']; const n = order[(order.indexOf(viewer.shading) + 1) % 3]; viewer.setShading(n); seg('shade-seg', 'shade', n); }
    else if (['1', '3', '7', '5'].includes(k)) { const v = { 1: 'front', 3: 'side', 7: 'top', 5: 'persp' }[k]; viewer.setView(v); seg('view-seg', 'view', v); }
  });
}

function fillDirOptionsOnly() { const keep = S.door.type; fillDoorSettingsDirOnly(keep); }
function fillDoorSettingsDirOnly(type) {
  const opts = type === 'normal' ? [['left', 'Left (hinge)'], ['right', 'Right (hinge)'], ['left-flip', 'Left · flipped'], ['right-flip', 'Right · flipped']]
    : type === 'sliding' ? [['left', '← Left'], ['right', 'Right →'], ['up', '↑ Up'], ['down', '↓ Down']]
      : type === 'custom' ? [['loop', 'Loop (auto, no script)']] : type === 'destruct' ? [['pieces', 'Breaks in pieces']]
      : [['sliding', 'Garage sliding'], ['rollup', 'Garage roll up'], ['sectional', 'Garage sectional']];
  $('ds-dir').innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
}

function play() {
  if (!S.door.created) return;
  const p = S.preview;
  if (S.door.type === 'custom' || S.door.type === 'destruct') { if (p.t >= 0.999) p.t = 0; p.dir = 1; p.playing = true; p.played = true; refreshSteps(); applyPreview(); return; }
  if (!p.loop) p.dir = p.t >= 0.999 ? -1 : 1;
  else if (p.t >= 0.999) p.dir = -1; else if (p.t <= 0.001) p.dir = 1;
  p.playing = true; p.played = true; refreshSteps(); applyPreview();
}

async function menuCmd(cmd) {
  if (cmd === 'new') newProject();
  else if (cmd === 'open') openProject();
  else if (cmd === 'save') saveProject(false);
  else if (cmd === 'saveAs') saveProject(true);
  else if (cmd === 'import') loadPaths(await api.openPropDialog());
  else if (cmd === 'sample' || cmd === 'sampleGarage') {
    const dir = await api.tempDir('samples');
    const out = joinPath(dir, cmd === 'sample' ? 'gdc_sample_door.ydr' : 'gdc_sample_garage.ydr');
    try { await api.buildSample(out, cmd === 'sample' ? 'door' : 'garage'); await loadPaths([out]); } catch (e) { toast(e.message, 'err'); }
  }
  else if (cmd === 'soundOnly') { if (S.mode === 'sound') setMode('door'); openSoundOnly(); }
  else if (cmd === 'home') showHome(true);
  else if (cmd === 'settings') openSettings();
  else if (cmd === 'shortcut' ) { const ok = await window.api.shortcut(); toast(ok ? 'Desktop shortcut created' : 'Could not create the shortcut', ok ? 'ok' : 'err'); }
  else if (cmd === 'shortcut:ok') toast('Desktop shortcut created', 'ok');
  else if (cmd === 'shortcut:fail') toast('Could not create the shortcut', 'err');
  else if (cmd.startsWith('view:')) { const v = cmd.slice(5); viewer.setView(v); seg('view-seg', 'view', v); }
  else if (cmd === 'about') modal('GTA Door Creator', `<p>Standalone door builder for GTA V / FiveM mappers.</p><p class="muted">Engine: DoorCore (CodeWalker.Core, MIT) · three.js · Electron</p>`, [{ label: 'Close', value: true, accent: true }]);
}

// ------------------------------------------------------------------ boot
async function boot() {
  if (!api) { document.body.innerHTML = '<p style="padding:40px">This page must run inside the GTA Door Creator app.</p>'; return; }
  fillSoundSelect();
  bind();
  seg('view-seg', 'view', 'persp'); seg('shade-seg', 'shade', 'material'); seg('yp-mode', 'yp', 'text');
  try { const inf = await api.info(); $('home-version').textContent = 'v' + (inf.version || ''); } catch { }
  S.settings = await api.loadSettings();
  S.door.export.folder = S.settings.outFolder || null;
  S.userPresets = await api.loadPresets();
  renderPresets();
  refresh(); updateTitle();
  const st = await api.coreStatus();
  const el = $('engine-status');
  el.textContent = st.ok ? '● ENGINE READY' : '● ENGINE ERROR';
  el.className = 'engine-status ' + (st.ok ? 'ok' : 'err'); el.title = st.message;
  if (!st.ok) modal('DoorCore engine unavailable', `<p>${esc(st.message)}</p>`, [{ label: 'OK', value: true, accent: true }]);
}
boot();

export { S, loadPaths, createDoor, setType, refresh, exportFiveM, doExport, saveProject, openProject, applyPreset, menuCmd };
window.__app = { S, loadPaths, createDoor, setType, refresh, exportFiveM, doExport, saveProject, openProject, applyPreset, menuCmd, play, touch, archetype, collisionInfo };
