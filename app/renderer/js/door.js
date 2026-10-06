// Door logic shared by the UI, the 3D preview, the YTYP generator and the FiveM exporter.
// Coordinates are GTA model space (Z up). The pivot is expressed in the ORIGINAL model space;
// on export it becomes the new model origin.

export const SPEEDS = {
  normal:  { slow: 2.2, normal: 1.3, fast: 0.7 },   // seconds for a full open
  sliding: { slow: 2.6, normal: 1.6, fast: 0.9 },
  garage:  { slow: 7.0, normal: 4.5, fast: 2.6 },
};

export const FLAG_DEFS = [
  { bit: 17, name: 'Dynamic' },
  { bit: 26, name: 'Enable Door Physics' },
  { bit: 5, name: 'Static' },
  { bit: 13, name: "Don't Cast Shadows" },
  { bit: 22, name: 'No AI Cover' },
  { bit: 23, name: 'No Player Cover' },
  { bit: 16, name: 'Double-sided' },
  { bit: 2, name: "Don't Fade" },
  { bit: 8, name: 'Tough For Bullets' },
  { bit: 9, name: 'Has Anim (YCD)' },
  { bit: 19, name: 'Auto Start Anim' },
  { bit: 29, name: 'Use Ambient Scale' },
];
export const FLAG_DYNAMIC = 1 << 17;          // 131072
export const FLAG_DOOR_PHYSICS = 1 << 26;      // 67108864

export const SPECIAL_ATTR = { none: 0, garage: 5, normal: 7, sliding: 8, slidingVertical: 10 };
export const SPECIAL_ATTR_NAMES = { 0: 'None (scripted)', 5: 'Garage Door', 7: 'Normal Door', 8: 'Sliding Door', 10: 'Sliding Vertical Door' };

export function defaultDoor() {
  return {
    created: false,
    typeChosen: false,
    name: 'door',
    type: 'normal',
    engine: 'native',
    speed: 'normal',
    normal: { hinge: 'left', flip: false, angle: 90 },
    sliding: { dir: 'right', distance: 1.0, preset: 'auto' },
    garage: { kind: 'sectional', height: 2.4, distance: 2.4, panels: 5, panelSize: 0, autoHeight: true, previewInGame: false },
    pivot: { mode: 'auto', x: 0, y: 0, z: 0 },
    collision: { mode: 'auto', shape: 'box', material: 70, boxMin: null, boxMax: null, ybnPath: null, ybnFile: null },
    sound: { mode: 'auto', id: null },
    ytyp: { archetypeName: '', modelName: '', ytypName: '', lodDist: 100, hdTextureDist: 15, flags: FLAG_DYNAMIC | FLAG_DOOR_PHYSICS, flagsAuto: true, textureDictionary: null },
    export: { folder: null, streamYbn: false, withScript: false },
    destruct: { pieces: 12, seed: 1, strength: 'normal', anchored: true, collision: 'mesh', mode: 'physics', anim: { force: 'normal', intact: 1.5, rest: 3, rebuild: 1.5 } },
    custom: { interp: 'linear', keys: [{ t: 0, r: [0, 0, 0], p: [0, 0, 0] }, { t: 4, r: [0, 0, 360], p: [0, 0, 0] }] },
  };
}

const v3 = (a) => ({ x: a[0], y: a[1], z: a[2] });

// ---------------------------------------------------------------- model analysis
export function analyzeModel(model) {
  // positions of every mesh -> bounds + handle detection
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  const all = [];
  for (const m of model.meshes) {
    const p = m._pos;
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) { const v = p[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
    }
    all.push(p);
  }
  if (!isFinite(mn[0])) { mn = model.bbMin.slice(); mx = model.bbMax.slice(); }
  const size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  const widthAxis = size[0] >= size[1] ? 0 : 1;
  const thickAxis = 1 - widthAxis;
  const center = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];

  // Main slab = the 70% central thickness band. Vertices sticking out of it are handles / trims.
  const th = size[thickAxis];
  const offs = [];
  for (const p of all) for (let i = thickAxis; i < p.length; i += 3) offs.push(Math.abs(p[i] - center[thickAxis]));
  offs.sort((a, b) => a - b);
  const slabHalf = offs.length ? offs[Math.floor(offs.length * 0.6)] : th / 2;
  let hs = 0, hn = 0;
  if (th > 0.001) {
    for (const p of all) {
      for (let i = 0; i < p.length; i += 3) {
        const o = Math.abs(p[i + thickAxis] - center[thickAxis]);
        const z = p[i + 2];
        if (o > slabHalf * 1.35 + 0.004 && z > mn[2] + size[2] * 0.2 && z < mx[2] - size[2] * 0.2) { hs += p[i + widthAxis]; hn++; }
      }
    }
  }
  let handle = null;
  if (hn >= 4) {
    const hpos = hs / hn;
    const rel = (hpos - mn[widthAxis]) / Math.max(1e-4, size[widthAxis]); // 0 = min edge, 1 = max edge
    if (rel < 0.4 || rel > 0.6) handle = { rel, side: rel > 0.5 ? 'max' : 'min', count: hn };
  }
  return { min: mn, max: mx, size, center, widthAxis, thickAxis, handle };
}

// screen-left/right in FRONT view (camera on the -thickness side looking +thickness, Z up)
export function frontBasis(an) {
  const n = [0, 0, 0]; n[an.thickAxis] = 1;                     // into the door (away from the front camera)
  const right = [n[1] * 1 - 0, 0 - n[0] * 1, 0];                 // n x up(0,0,1)
  return { n, right };
}

// Which end of the width axis is on screen-left?
function leftEnd(an) {
  const { right } = frontBasis(an);
  return right[an.widthAxis] > 0 ? 'min' : 'max';
}

// Is the model origin already on a vertical edge of the width axis? -> 'min' | 'max' | null
export function originEdge(an) {
  const tol = Math.max(0.012, an.size[an.widthAxis] * 0.02);
  if (Math.abs(an.min[an.widthAxis]) <= tol) return 'min';
  if (Math.abs(an.max[an.widthAxis]) <= tol) return 'max';
  return null;
}
// Is the origin inside (or on) the model bounds?
export function originInside(an) {
  for (let k = 0; k < 3; k++) if (0 < an.min[k] - 0.012 || 0 > an.max[k] + 0.012) return false;
  return true;
}

export function pivotFor(mode, an, door) {
  // custom animation: AUTO = centre of the model (a logo spins around its middle)
  if (door.type === 'custom' && (mode === 'auto' || mode === 'center')) return { x: an.center[0], y: an.center[1], z: an.center[2] };
  // sliding / garage doors don't rotate around the pivot: keep the model's own origin so existing
  // ymap/MLO placements stay valid
  if (mode === 'auto' && door.type !== 'normal' && originInside(an)) return { x: 0, y: 0, z: 0 };
  const p = { x: an.center[0], y: an.center[1], z: 0 };
  const zKeep = (0 >= an.min[2] - 1e-4 && 0 <= an.max[2] + 1e-4) ? 0 : an.min[2];
  p.z = zKeep;
  const axKey = an.widthAxis === 0 ? 'x' : 'y';
  const thKey = an.thickAxis === 0 ? 'x' : 'y';
  p[thKey] = an.center[an.thickAxis];
  const minW = an.min[an.widthAxis], maxW = an.max[an.widthAxis];
  const le = leftEnd(an);
  const L = le === 'min' ? minW : maxW, R = le === 'min' ? maxW : minW;
  let m = mode;
  if (m === 'auto') {
    if (door.type === 'normal') m = door.normal.hinge;
    else m = 'center';
  }
  if (m === 'left') p[axKey] = L;
  else if (m === 'right') p[axKey] = R;
  else if (m === 'center') p[axKey] = an.center[an.widthAxis];
  else if (m === 'custom') return { x: door.pivot.x, y: door.pivot.y, z: door.pivot.z };
  // snap to the original origin when we are within a centimetre of it (pre-pivoted vanilla doors)
  for (const k of ['x', 'y']) if (Math.abs(p[k]) < 0.012) p[k] = 0;
  return p;
}

// ---------------------------------------------------------------- auto detection
export function autoDetect(model, an) {
  const name = (model.name || '').toLowerCase();
  const shaders = (model.materials || []).map((m) => m.name).join(' ');
  const W = an.size[an.widthAxis], H = an.size[2], T = an.size[an.thickAxis];
  const scores = { normal: 0.15, sliding: 0.1, garage: 0.1 };
  const why = [];
  if (/gar(age)?|shutter|roller|rollup|roll_up|gate_ga/.test(name)) { scores.garage += 0.55; why.push('name suggests a garage door'); }
  if (/slid|elev|lift|auto_?door|_sl_|doorsl|_sld|sldoor/.test(name)) { scores.sliding += 0.6; why.push('name suggests a sliding door'); }
  if (/door|_dr|dr_|gate/.test(name) && !/gar/.test(name)) { scores.normal += 0.3; why.push('name contains "door"'); }
  if (W >= 0.55 && W <= 1.6 && H >= 1.7 && H <= 3.2) { scores.normal += 0.35; why.push(`size ${W.toFixed(2)}×${H.toFixed(2)} m fits a person door`); }
  if (W > 2.2 && H > 1.8) { scores.garage += 0.4; why.push(`wide opening (${W.toFixed(2)} m)`); }
  if (T < 0.25) scores.normal += 0.05;
  if (/glass/.test(shaders) && W >= 0.8) { scores.sliding += 0.2; why.push('glass shader'); }
  if (an.handle) { scores.normal += 0.25; scores.sliding -= 0.05; why.push('handle detected near one edge'); }
  if (H < 1.2 && W < 1.2) { scores.normal -= 0.1; why.push('small prop (cabinet/hatch?)'); }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [type, best] = sorted[0];
  const total = sorted.reduce((s, [, v]) => s + Math.max(0, v), 0) || 1;
  let confidence = Math.round(Math.min(0.97, Math.max(0.35, (best / total) * 0.75 + Math.min(best, 1) * 0.35)) * 100);

  // pivot: (1) a model whose origin already sits on a vertical edge is pre-pivoted (vanilla doors are),
  //        (2) otherwise the hinge is opposite the handle, (3) then the _l/_r name suffix
  const le = leftEnd(an);
  let hinge = 'left', hingeWhy = '';
  const oe = originEdge(an);
  if (oe) { hinge = oe === le ? 'left' : 'right'; hingeWhy = 'origin already on the ' + hinge + ' edge'; }
  else if (an.handle) { hinge = an.handle.side === le ? 'right' : 'left'; hingeWhy = 'opposite the handle'; }
  else if (/_r(\d*)$/.test(name)) { hinge = 'right'; hingeWhy = 'name ends in _r'; }
  else if (/_l(\d*)$/.test(name)) { hinge = 'left'; hingeWhy = 'name ends in _l'; }
  if (hingeWhy) why.push('hinge: ' + hingeWhy);
  if (oe) scores.normal += 0.05;
  // sliding leaf direction: _l leaf slides left, _r leaf slides right
  const slideDir = /_l(\d*)$/.test(name) ? 'left' : 'right';
  let garageKind = 'sectional';
  if (/roll|shutter/.test(name)) garageKind = 'rollup';
  const res = { type, confidence, hinge, garageKind, slideDir, why };
  if (type === 'normal') { res.pivotLabel = hinge === 'left' ? 'Left' : 'Right'; res.opening = '90°'; }
  else if (type === 'sliding') { res.pivotLabel = originInside(an) ? 'Original origin' : 'Center'; res.opening = `${W.toFixed(2)} m ${slideDir === 'left' ? '← left' : '→ right'}`; }
  else { res.pivotLabel = originInside(an) ? 'Original origin' : 'Bottom'; res.opening = `${H.toFixed(2)} m up (${garageKind})`; }
  return res;
}

// ---------------------------------------------------------------- motion
export const DESTRUCT_STRENGTH = { fragile: 50, normal: 300, solid: 1500, verysolid: 5000 };
export const destructYcd = (door) => door.type === 'destruct' && door.destruct?.mode === 'ycd';
export function duration(door) { if (door.type === 'destruct') return destructYcd(door) ? (door._desDur || 8) : 2.5; return door.type === 'custom' ? customDuration(door) : (SPEEDS[door.type]?.[door.speed] ?? 1.5); }

// ---------------------------------------------------------------- custom animation (whole object, keyframes)
// keys: { t seconds, r [x,y,z] degrees (any value, 360 = one turn), p [x,y,z] metres } relative to the pivot
export function customKeys(door) {
  const ks = (door.custom?.keys || []).map((k) => ({ t: Math.max(0, +k.t || 0), r: (k.r || [0, 0, 0]).map((v) => +v || 0), p: (k.p || [0, 0, 0]).map((v) => +v || 0) }));
  ks.sort((a, b) => a.t - b.t);
  if (!ks.length) ks.push({ t: 0, r: [0, 0, 0], p: [0, 0, 0] });
  if (ks.length === 1) ks.push({ ...ks[0], t: ks[0].t + 1 });
  return ks;
}
export function customDuration(door) { const ks = customKeys(door); return Math.max(0.1, ks[ks.length - 1].t); }
function qmul(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
// rotation X, then Y, then Z (degrees) -> quaternion [x,y,z,w]
export function eulerQuat(r) {
  const h = r.map((d) => d * Math.PI / 360);
  const qx = [Math.sin(h[0]), 0, 0, Math.cos(h[0])], qy = [0, Math.sin(h[1]), 0, Math.cos(h[1])], qz = [0, 0, Math.sin(h[2]), Math.cos(h[2])];
  return qmul(qz, qmul(qy, qx));
}
// pose at time t (seconds): { q, p, r }
export function customPose(door, t) {
  const ks = customKeys(door);
  let a = ks[0], b = ks[ks.length - 1];
  if (t <= ks[0].t) b = a; else if (t >= b.t) a = b;
  else for (let i = 0; i < ks.length - 1; i++) if (t >= ks[i].t && t <= ks[i + 1].t) { a = ks[i]; b = ks[i + 1]; break; }
  let u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  if (door.custom?.interp === 'smooth') u = ease(u);
  const r = a.r.map((v, i) => v + (b.r[i] - v) * u), p = a.p.map((v, i) => v + (b.p[i] - v) * u);
  return { q: eulerQuat(r), p, r };
}
// frames for the .ycd: [qx,qy,qz,qw,px,py,pz]
export function customSamples(door, fps = 30) {
  const dur = customDuration(door);
  const n = Math.max(2, Math.round(dur * fps) + 1);
  const frames = [];
  for (let i = 0; i < n; i++) { const s = customPose(door, (i / (n - 1)) * dur); frames.push([...s.q.map((v) => +v.toFixed(7)), ...s.p.map((v) => +v.toFixed(5))]); }
  return { fps: (n - 1) / dur, frames };
}
export const ANIM_PRESETS = {
  spinz: { interp: 'linear', keys: [{ t: 0, r: [0, 0, 0], p: [0, 0, 0] }, { t: 4, r: [0, 0, 360], p: [0, 0, 0] }] },
  spinx: { interp: 'linear', keys: [{ t: 0, r: [0, 0, 0], p: [0, 0, 0] }, { t: 4, r: [360, 0, 0], p: [0, 0, 0] }] },
  spiny: { interp: 'linear', keys: [{ t: 0, r: [0, 0, 0], p: [0, 0, 0] }, { t: 4, r: [0, 360, 0], p: [0, 0, 0] }] },
  swing: { interp: 'smooth', keys: [{ t: 0, r: [0, 0, 0], p: [0, 0, 0] }, { t: 1.5, r: [0, 0, 30], p: [0, 0, 0] }, { t: 4.5, r: [0, 0, -30], p: [0, 0, 0] }, { t: 6, r: [0, 0, 0], p: [0, 0, 0] }] },
  bob: { interp: 'smooth', keys: [{ t: 0, r: [0, 0, 0], p: [0, 0, 0] }, { t: 1.5, r: [0, 0, 0], p: [0, 0, 0.25] }, { t: 3, r: [0, 0, 0], p: [0, 0, 0] }] },
  spinbob: { interp: 'linear', keys: [{ t: 0, r: [0, 0, 0], p: [0, 0, 0] }, { t: 2, r: [0, 0, 180], p: [0, 0, 0.2] }, { t: 4, r: [0, 0, 360], p: [0, 0, 0] }] },
};

export function slideDistance(door, an) {
  if (door.sliding.preset === 'auto') return an ? an.size[an.widthAxis] : door.sliding.distance;
  return door.sliding.distance;
}

// rotation sign for a normal door so that by default it opens away from the front (+n)
export function swingSign(door, an, pivot) {
  const { n } = frontBasis(an);
  const c = an.center;
  const e = [c[0] - pivot.x, c[1] - pivot.y];                 // pivot -> door body
  let s = Math.sign(-e[1] * n[0] + e[0] * n[1]);
  if (s === 0) s = 1;
  return door.normal.flip ? -s : s;
}

export function slideVector(door, an) {
  const { right } = frontBasis(an);
  switch (door.sliding.dir) {
    case 'left': return [-right[0], -right[1], 0];
    case 'right': return [right[0], right[1], 0];
    case 'up': return [0, 0, 1];
    case 'down': return [0, 0, -1];
  }
  return [right[0], right[1], 0];
}

// eased progress (doors accelerate/decelerate)
export function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

// Rigid motion of the whole door, in PIVOT space (the exported model origin).
// Rotation of `angle` degrees about `axis` through `center`, plus a translation `offset` (all at fully open).
// Used by the 3D preview AND written into the generated Lua, so the game plays exactly what you preview.
export function motionSpec(door, an, pivot) {
  const P = [pivot.x, pivot.y, pivot.z];
  const spec = { axis: [0, 0, 1], angle: 0, center: [0, 0, 0], offset: [0, 0, 0], kind: 'none' };
  if (door.type === 'custom') { spec.kind = 'custom'; return spec; }
  if (door.type === 'destruct') { spec.kind = 'destruct'; return spec; }
  if (door.type === 'normal') {
    spec.kind = 'rotate';
    spec.angle = swingSign(door, an, pivot) * door.normal.angle;
  } else if (door.type === 'sliding') {
    spec.kind = 'translate';
    const v = slideVector(door, an), d = slideDistance(door, an);
    spec.offset = [v[0] * d, v[1] * d, v[2] * d];
  } else if (door.type === 'garage') {
    if (door.garage.kind === 'sectional') {
      // in-game: up-and-over, the leaf tilts inward about its top edge
      spec.kind = 'tilt';
      spec.axis = an.widthAxis === 0 ? [1, 0, 0] : [0, 1, 0];
      spec.angle = an.widthAxis === 0 ? 90 : -90;
      const c = [0, 0, an.max[2] - P[2]];
      c[an.thickAxis] = an.center[an.thickAxis] - P[an.thickAxis];
      spec.center = c;
    } else {
      spec.kind = 'translate';
      spec.offset = [0, 0, door.garage.height];
    }
  }
  return spec;
}

// Sectional / roll-up track: position (n, z) and tilt for a path length s measured from the door bottom.
export function trackPoint(door, an, s) {
  const zmin = an.min[2], H = an.size[2];
  if (door.garage.kind === 'rollup') {
    const top = zmin + H, Rd = 0.22;
    if (s <= H) return { n: 0, z: zmin + s, phi: 0 };
    const a = (s - H) / Rd;
    return { n: Rd - Rd * Math.cos(a), z: top + Rd * Math.sin(a), phi: a };
  }
  const rail = Math.max(0.2, door.garage.height), R = 0.35;
  if (s <= rail) return { n: 0, z: zmin + s, phi: 0 };
  const arc = R * Math.PI / 2;
  if (s <= rail + arc) { const a = (s - rail) / R; return { n: R - R * Math.cos(a), z: zmin + rail + R * Math.sin(a), phi: a }; }
  return { n: R + (s - rail - arc), z: zmin + rail + R, phi: Math.PI / 2 };
}

export function panelLayout(door, an) {
  const H = an.size[2];
  const count = Math.max(1, Math.min(40, door.garage.panels | 0));
  const size = door.garage.panelSize > 0 ? door.garage.panelSize : H / count;
  const out = [];
  for (let i = 0; i < count; i++) {
    const z0 = an.min[2] + i * size, z1 = i === count - 1 ? an.max[2] + 0.001 : an.min[2] + (i + 1) * size;
    out.push({ index: i, z0: i === 0 ? an.min[2] - 0.001 : z0, z1 });
  }
  return out;
}

// ---------------------------------------------------------------- archetype helpers
export const FLAGS_ANIM_FRAGMENT = 537526816; // vanilla animated fragment (Has Anim + Dynamic + Auto Start Anim + Use Ambient Scale) + Static
export function recommendedFlags(door) {
  if (destructYcd(door)) return FLAGS_ANIM_FRAGMENT;   // animated fragment, the clip named like the archetype auto-starts and loops
  if (door.type === 'destruct') return 536870912 + 131072 + (door.destruct?.anchored === false ? 0 : 32); // ambient scale + dynamic (+ static)
  if (door.engine === 'ycd') return FLAGS_ANIM_FRAGMENT;
  return door.engine === 'native' ? (FLAG_DYNAMIC | FLAG_DOOR_PHYSICS) : FLAG_DYNAMIC;
}
export const isAnim = (door) => door.engine === 'ycd';
export const animNames = (model) => ({ dict: model + '_anim', open: model + '_open', close: model + '_close' });
export function specialAttribute(door) {
  if (door.engine !== 'native') return SPECIAL_ATTR.none;
  if (door.type === 'normal') return SPECIAL_ATTR.normal;
  if (door.type === 'sliding') return (door.sliding.dir === 'up' || door.sliding.dir === 'down') ? SPECIAL_ATTR.slidingVertical : SPECIAL_ATTR.sliding;
  // roll-up / lift doors behave like vanilla shutters (Sliding Vertical Door), sectional = Garage Door
  return door.garage.kind === 'sectional' ? SPECIAL_ATTR.garage : SPECIAL_ATTR.slidingVertical;
}
export function defaultEngine(type) { return type === 'custom' ? 'ycd' : type === 'destruct' ? 'destruct' : 'native'; } // GTA door system, no script needed

export function sanitizeName(s) {
  return (s || 'door').toLowerCase().trim().replace(/\.(ydr|ytyp|ybn|ytd)$/, '').replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'door';
}

export function fmt(n, d = 3) { return (Math.round(n * 10 ** d) / 10 ** d).toFixed(d); }

export function pivotSpaceBounds(model, an, pivot, colBox) {
  // model bounds (drawable bbox) shifted to the pivot, united with collision (already in pivot space)
  const mn = [model.bbMin[0] - pivot.x, model.bbMin[1] - pivot.y, model.bbMin[2] - pivot.z];
  const mx = [model.bbMax[0] - pivot.x, model.bbMax[1] - pivot.y, model.bbMax[2] - pivot.z];
  if (colBox) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], colBox.min[k]); mx[k] = Math.max(mx[k], colBox.max[k]); }
  const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
  const r = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2;
  return { min: mn, max: mx, center: c, radius: r };
}

export { v3 };

// ---------------------------------------------------------------- hashing
export function joaat(str) {
  let h = 0;
  for (const c of String(str).toLowerCase()) {
    h = (h + c.charCodeAt(0)) >>> 0; h = (h + (h << 10)) >>> 0; h = (h ^ (h >>> 6)) >>> 0;
  }
  h = (h + (h << 3)) >>> 0; h = (h ^ (h >>> 11)) >>> 0; h = (h + (h << 15)) >>> 0;
  return h >>> 0;
}
export const hex8 = (n) => (n >>> 0).toString(16).padStart(8, '0');
