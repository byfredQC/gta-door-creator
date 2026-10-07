// CREATE TEXTURES: seamless procedural textures (colour + relief _n + shine _s) -> .dds / .ytd (DoorCore TexBuild)
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------- seamless noise (every lattice wraps, so the texture tiles)
function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
const fade = (t) => t * t * (3 - 2 * t);
function vnoise(u, v, f, s) {       // u, v in [0,1), f = integer cells per side
  f = Math.max(1, Math.round(f));
  const x = u * f, y = v * f, x0 = Math.floor(x), y0 = Math.floor(y), tx = fade(x - x0), ty = fade(y - y0);
  const m = (a) => ((a % f) + f) % f;
  const a = hash(m(x0), m(y0), s), b = hash(m(x0 + 1), m(y0), s), c = hash(m(x0), m(y0 + 1), s), d = hash(m(x0 + 1), m(y0 + 1), s);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}
function vnoise2(u, v, fx, fy, s) {   // different number of cells along X and Y (still seamless)
  const x = u * fx, y = v * fy, x0 = Math.floor(x), y0 = Math.floor(y), tx = fade(x - x0), ty = fade(y - y0);
  const mx = (a) => ((a % fx) + fx) % fx, my = (a) => ((a % fy) + fy) % fy;
  const a = hash(mx(x0), my(y0), s), b = hash(mx(x0 + 1), my(y0), s), c = hash(mx(x0), my(y0 + 1), s), d = hash(mx(x0 + 1), my(y0 + 1), s);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}
function fbm(u, v, f, oct, s, gain = 0.5) { let sum = 0, amp = 1, norm = 0; for (let o = 0; o < oct; o++) { sum += vnoise(u, v, f << o, s + o * 101) * amp; norm += amp; amp *= gain; } return sum / norm; }
function worley(u, v, f, s) {       // distance to the 2 nearest jittered cell points + cell id
  f = Math.max(1, Math.round(f));
  const x = u * f, y = v * f, xi = Math.floor(x), yi = Math.floor(y); let d1 = 9, d2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, mx = ((cx % f) + f) % f, my = ((cy % f) + f) % f;
    const px = cx + 0.15 + 0.7 * hash(mx, my, s), py = cy + 0.15 + 0.7 * hash(mx, my, s + 7);
    const d = Math.hypot(px - x, py - y);
    if (d < d1) { d2 = d1; d1 = d; id = hash(mx, my, s + 13); } else if (d < d2) d2 = d;
  }
  return [d1, d2, id];
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (x) => Math.max(0, Math.min(1, x));
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

// ---------------------------------------------------------------- the presets: (u, v, P) -> [rgb 0..1, height 0..1]
export const PRESETS = {
  solid: { label: 'SOLID', c1: '#8a8f96', c2: '#6b7079', scale: 4, detail: 3, contrast: 0.15, shine: 0.3, normal: 0.5,
    f: (u, v, P) => { const n = fbm(u, v, P.scale, P.detail, P.seed); return [mix(P.c1, P.c2, n * P.contrast * 2), n * P.contrast]; } },
  concrete: { label: 'CONCRETE', c1: '#9a9892', c2: '#6e6c66', scale: 4, detail: 6, contrast: 0.6, shine: 0.15, normal: 1.2,
    f: (u, v, P) => { const n = fbm(u, v, P.scale, P.detail, P.seed); const sp = vnoise(u, v, P.scale * 32, P.seed + 5); const pit = sp > 0.82 ? 0.6 : 1; return [shade(mix(P.c1, P.c2, clamp((n - 0.5) * P.contrast * 3 + 0.5)), pit), n * 0.8 + (pit < 1 ? -0.2 : 0)]; } },
  asphalt: { label: 'ASPHALT', c1: '#2e2f31', c2: '#77736b', scale: 8, detail: 5, contrast: 0.5, shine: 0.1, normal: 1.5,
    f: (u, v, P) => { const n = fbm(u, v, P.scale, P.detail, P.seed); const g = vnoise(u, v, P.scale * 24, P.seed + 3); const stone = g > 0.78 ? (g - 0.78) * 4.5 : 0; return [mix(shade(P.c1, 0.8 + n * P.contrast), P.c2, stone), n * 0.5 + stone * 0.5]; } },
  bricks: { label: 'BRICKS', c1: '#8e4a33', c2: '#bdb5a6', scale: 8, detail: 4, contrast: 0.35, shine: 0.1, normal: 2, extra: 0.06,
    f: (u, v, P) => { const rows = Math.max(1, Math.round(P.scale)), cols = Math.max(1, Math.round(rows / 2)); const r = Math.floor(v * rows); const x = u * cols + (r % 2 ? 0.5 : 0); const c = Math.floor(x);
      const fx = x - c, fy = v * rows - r, m = P.extra * 2; const mortar = fx < m / 2 || fx > 1 - m / 2 || fy < m || fy > 1 - m;
      const id = hash(((c % cols) + cols) % cols, r, P.seed); const n = fbm(u, v, P.scale * 2, P.detail, P.seed + 9);
      return mortar ? [shade(P.c2, 0.85 + n * 0.3), 0.1 + n * 0.1] : [shade(P.c1, 0.75 + id * P.contrast + n * 0.25), 0.7 + n * 0.3]; } },
  tiles: { label: 'TILES', c1: '#e6e3dc', c2: '#8d8a84', scale: 6, detail: 3, contrast: 0.2, shine: 0.8, normal: 1.5, extra: 0.04,
    f: (u, v, P) => { const k = Math.max(1, Math.round(P.scale)); const fx = u * k % 1, fy = v * k % 1, m = P.extra; const grout = fx < m || fx > 1 - m || fy < m || fy > 1 - m;
      const id = hash(Math.floor(u * k), Math.floor(v * k), P.seed); const n = fbm(u, v, k * 4, P.detail, P.seed + 2);
      return grout ? [shade(P.c2, 0.9 + n * 0.2), 0] : [shade(P.c1, 1 - id * P.contrast * 0.4 - n * 0.06), 0.8 + n * 0.1]; } },
  planks: { label: 'WOOD PLANKS', c1: '#9b6a3e', c2: '#5d3b20', scale: 6, detail: 5, contrast: 0.6, shine: 0.3, normal: 1.2, extra: 0.02,
    f: (u, v, P) => { const k = Math.max(1, Math.round(P.scale)); const p = Math.floor(v * k), fy = v * k - p; const id = hash(p, 0, P.seed);
      const off = id; const fx = (u + off) % 1; const seam = fy < P.extra * 2 || fy > 1 - P.extra * 2 || fx < P.extra;
      const g = fbm((u + off) % 1, v, 2, P.detail, P.seed + p); const grain = 0.5 + 0.5 * Math.sin((fy * 6 + g * 8 * P.contrast + id * 10) * Math.PI * 2);
      const fib = vnoise(u, v, 64, P.seed + 41) * 0.15;
      const col = shade(mix(P.c1, P.c2, grain * 0.6 * P.contrast + fib), 0.85 + id * 0.3);
      return seam ? [shade(P.c2, 0.4), 0] : [col, 0.6 + grain * 0.2 + fib]; } },
  metal: { label: 'BRUSHED METAL', c1: '#a9adb3', c2: '#7d8187', scale: 2, detail: 4, contrast: 0.4, shine: 0.9, normal: 0.4, f: null },
  rust: { label: 'RUSTY METAL', c1: '#7c8086', c2: '#8a4a22', scale: 4, detail: 6, contrast: 0.55, shine: 0.4, normal: 1.4,
    f: (u, v, P) => { const n = fbm(u, v, P.scale, P.detail, P.seed); const r = clamp((n - (1 - P.contrast)) * 6); const fine = vnoise(u, v, P.scale * 32, P.seed + 4);
      const metal = shade(P.c1, 0.85 + fine * 0.2), rust = shade(P.c2, 0.7 + fine * 0.5);
      return [mix(metal, rust, r), 0.5 + r * 0.3 * fine]; } },
  checker: { label: 'CHECKER', c1: '#eeeeee', c2: '#222222', scale: 8, detail: 1, contrast: 0, shine: 0.5, normal: 0.3,
    f: (u, v, P) => { const k = Math.max(1, Math.round(P.scale)); const on = (Math.floor(u * k) + Math.floor(v * k)) % 2 === 0; return [on ? P.c1 : P.c2, on ? 1 : 0]; } },
  dirt: { label: 'DIRT / GROUND', c1: '#6b5238', c2: '#3f3022', scale: 4, detail: 6, contrast: 0.7, shine: 0.05, normal: 1.6,
    f: (u, v, P) => { const n = fbm(u, v, P.scale, P.detail, P.seed); const [d1, , id] = worley(u, v, P.scale * 6, P.seed + 3); const peb = d1 < 0.22 && id > 0.6 ? 1 - d1 / 0.22 : 0;
      return [mix(mix(P.c2, P.c1, clamp(n * (1 + P.contrast) - P.contrast * 0.3)), [0.55, 0.52, 0.47], peb * 0.8), n * 0.6 + peb * 0.4]; } },
  marble: { label: 'MARBLE', c1: '#ece8e1', c2: '#5c5a57', scale: 3, detail: 6, contrast: 0.6, shine: 0.95, normal: 0.3, f: null },
  fabric: { label: 'FABRIC', c1: '#3b5b8c', c2: '#24395a', scale: 64, detail: 3, contrast: 0.5, shine: 0.1, normal: 1,
    f: (u, v, P) => { const k = Math.max(4, Math.round(P.scale)); const a = Math.sin(u * k * Math.PI * 2), b = Math.sin(v * k * Math.PI * 2); const over = (Math.floor(u * k * 2) + Math.floor(v * k * 2)) % 2;
      const w = over ? 0.5 + 0.5 * a : 0.5 + 0.5 * b; const n = fbm(u, v, 8, P.detail, P.seed); return [mix(P.c2, P.c1, clamp(w * P.contrast + (1 - P.contrast) * 0.7 + (n - 0.5) * 0.2)), w]; } },
  stones: { label: 'STONES', c1: '#8b8680', c2: '#3a3733', scale: 6, detail: 4, contrast: 0.4, shine: 0.25, normal: 2, extra: 0.08,
    f: (u, v, P) => { const [d1, d2, id] = worley(u, v, Math.max(1, Math.round(P.scale)), P.seed); const edge = d2 - d1; const gap = edge < P.extra * 2; const n = fbm(u, v, P.scale * 4, P.detail, P.seed + 6);
      return gap ? [shade(P.c2, 0.8 + n * 0.3), 0] : [shade(P.c1, 0.75 + id * P.contrast + n * 0.2), clamp(0.4 + edge * 2) * 0.8 + n * 0.2]; } },
};
// marble veins and brushed metal streaks
PRESETS.marble.f = (u, v, P) => { const n = fbm(u, v, 3, P.detail, P.seed); const s = Math.abs(Math.sin((u * Math.max(1, Math.round(P.scale)) + n * 4) * Math.PI * 2)); const vein = Math.pow(1 - s, 6 + 20 * (1 - P.contrast)); return [mix(shade(P.c1, 0.95 + n * 0.08), P.c2, clamp(vein * 1.5)), 0.5 - vein * 0.2]; };
PRESETS.metal.f = (u, v, P) => {   // streaks along X: few cells in X, many in Y
  const big = fbm(u, v, Math.max(1, Math.round(P.scale)), 3, P.seed); let line = 0, a = 1, nr = 0;
  for (let o = 0; o < Math.max(1, P.detail); o++) { line += vnoise2(u, v, 2 << o, 128 << o, P.seed + 50 + o) * a; nr += a; a *= 0.55; }
  line /= nr; const t = clamp((line - 0.5) * P.contrast * 3 + 0.5 + (big - 0.5) * 0.3);
  return [mix(P.c2, P.c1, t), 0.5 + (line - 0.5) * 0.25]; };

// ---------------------------------------------------------------- render one map set
export function render(key, P, size) {
  const pr = PRESETS[key]; const n = size * size;
  const col = new Uint8ClampedArray(n * 4), hgt = new Float32Array(n);
  const Q = { ...P, c1: hex(P.c1), c2: hex(P.c2) };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [c, h] = pr.f((x + 0.5) / size, (y + 0.5) / size, Q); const i = y * size + x;
    col[i * 4] = clamp(c[0]) * 255; col[i * 4 + 1] = clamp(c[1]) * 255; col[i * 4 + 2] = clamp(c[2]) * 255; col[i * 4 + 3] = 255; hgt[i] = h;
  }
  // relief (normal map, DirectX convention) from the height, wrapping at the borders
  const nrm = new Uint8ClampedArray(n * 4), spec = new Uint8ClampedArray(n * 4), k = P.normal * size / 64;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, H = (xx, yy) => hgt[((yy + size) % size) * size + ((xx + size) % size)];
    let nx = -(H(x + 1, y) - H(x - 1, y)) * k, ny = (H(x, y + 1) - H(x, y - 1)) * k, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    nrm[i * 4] = (nx * 0.5 + 0.5) * 255; nrm[i * 4 + 1] = (ny * 0.5 + 0.5) * 255; nrm[i * 4 + 2] = (nz * 0.5 + 0.5) * 255; nrm[i * 4 + 3] = 255;
    const s = clamp(P.shine * (0.6 + 0.4 * hgt[i])) * 255; spec[i * 4] = s; spec[i * 4 + 1] = s; spec[i * 4 + 2] = s; spec[i * 4 + 3] = 255;
  }
  return { col, nrm, spec, size };
}

const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

export function initTexGen({ api, toast, chooseOutFolder }) {
  const G = { key: 'concrete', P: null, view: 'col', list: [], busy: false, prev: null };
  const fresh = (key) => { const p = PRESETS[key]; return { c1: p.c1, c2: p.c2, scale: p.scale, detail: p.detail, contrast: p.contrast, shine: p.shine, normal: p.normal, extra: p.extra ?? 0.05, seed: 1 }; };
  G.P = fresh(G.key);
  const log = (msg, cls = '') => { const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = msg; $('tg-log').appendChild(d); $('tg-log').scrollTop = 1e9; };

  // preset chips with a tiny live thumbnail
  $('tg-presets').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<button data-tg="${k}"><canvas width="48" height="48"></canvas><span>${p.label}</span></button>`).join('');
  $('tg-presets').querySelectorAll('button').forEach((b) => {
    const r = render(b.dataset.tg, fresh(b.dataset.tg), 48); const cv = b.querySelector('canvas'); cv.getContext('2d').putImageData(new ImageData(r.col, 48, 48), 0, 0);
    b.onclick = () => { G.key = b.dataset.tg; G.P = fresh(G.key); if (!$('tg-name').dataset.touched) $('tg-name').value = 'my_' + G.key; sync(); draw(); };
  });

  function sync() {
    $('tg-presets').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tg === G.key));
    $('tg-c1').value = G.P.c1; $('tg-c2').value = G.P.c2;
    for (const k of ['scale', 'detail', 'contrast', 'shine', 'normal', 'extra']) { $('tg-' + k).value = G.P[k]; $('tg-v-' + k).textContent = (+G.P[k]).toFixed(k === 'scale' || k === 'detail' ? 0 : 2); }
    $('tg-extra-row').style.display = PRESETS[G.key].extra != null ? '' : 'none';
    $$('[data-tgv]').forEach((b) => b.classList.toggle('on', b.dataset.tgv === G.view));
  }
  const $$ = (s) => document.querySelectorAll(s);

  let pending = 0;
  function draw() {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      const r = render(G.key, G.P, 256); G.prev = r;
      const cv = $('tg-canvas'), g = cv.getContext('2d'), img = new ImageData(G.view === 'col' ? r.col : G.view === 'nrm' ? r.nrm : r.spec, 256, 256);
      const t = document.createElement('canvas'); t.width = t.height = 256; t.getContext('2d').putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true; for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) g.drawImage(t, x * 256, y * 256);
      $('tg-cap').textContent = `${$('tg-name').value || 'texture'}${G.view === 'nrm' ? '_n' : G.view === 'spec' ? '_s' : ''} · ${$('tg-size').value} px · seamless (2×2 tiles shown)`;
    });
  }

  function listUi() {
    $('tg-list').innerHTML = G.list.length ? G.list.map((t, i) => `<div class="tg-item"><canvas width="40" height="40" data-li="${i}"></canvas><b>${esc(t.name)}</b><span>${t.size} px${t.maps ? ' · + _n + _s' : ''}</span><button class="btn tiny" data-rm="${i}">✕</button></div>`).join('')
      : '<div class="muted">Add textures with ＋ ADD TO THE .YTD - they all go in one .ytd.</div>';
    $('tg-list').querySelectorAll('canvas[data-li]').forEach((cv) => { const t = G.list[+cv.dataset.li]; cv.getContext('2d').putImageData(new ImageData(t.thumb, 40, 40), 0, 0); });
    $('tg-list').querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { G.list.splice(+b.dataset.rm, 1); listUi(); });
    $('tg-ytd-go').disabled = !G.list.length || G.busy;
    $('tg-ytd-go').textContent = G.list.length ? `CREATE THE .YTD (${G.list.length})` : 'CREATE THE .YTD';
  }

  function current() {
    const name = ($('tg-name').value || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!name) { toast('Give the texture a name', 'err'); return null; }
    return { name, key: G.key, P: { ...G.P }, size: +$('tg-size').value, maps: $('tg-maps').checked, thumb: render(G.key, G.P, 40).col };
  }
  function images(t) {     // full size maps -> engine items
    const r = render(t.key, t.P, t.size); const out = [{ name: t.name, w: t.size, h: t.size, rgba: b64(new Uint8Array(r.col.buffer)), usage: 'diffuse' }];
    if (t.maps) out.push({ name: t.name + '_n', w: t.size, h: t.size, rgba: b64(new Uint8Array(r.nrm.buffer)), usage: 'normal' }, { name: t.name + '_s', w: t.size, h: t.size, rgba: b64(new Uint8Array(r.spec.buffer)), usage: 'spec' });
    return out;
  }
  async function build(list, ytd) {
    if (G.busy) return;
    const parent = await chooseOutFolder(); if (!parent) return;
    const sep = parent.includes('\\') ? '\\' : '/', out = parent.replace(/[\\/]+$/, '') + sep + (ytd || list[0].name) + '_textures';
    G.busy = true; listUi(); $('tg-dds').disabled = true; log(`› ${ytd ? ytd + '.ytd' : list[0].name} → ${out}`);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const textures = list.flatMap(images);
      const res = await api.texBuild({ outDir: out, ytd: ytd || null, dds: true, textures });
      for (const t of res.textures) log(`  ✓ ${t.name}.dds  ${t.w}×${t.h} ${t.format} · ${t.mips} mips`, 'ok');
      if (ytd) log(`  ✓ ${ytd}.ytd (${res.textures.length} textures)`, 'ok');
      toast(ytd ? `${ytd}.ytd created` : `${res.textures.length} .dds created`, 'ok');
      api.openPath(out);
    } catch (e) { log('  ✗ ' + e.message, 'err'); toast(e.message, 'err'); }
    G.busy = false; $('tg-dds').disabled = false; listUi();
  }

  // ---- bindings
  $('tg-c1').oninput = () => { G.P.c1 = $('tg-c1').value; draw(); };
  $('tg-c2').oninput = () => { G.P.c2 = $('tg-c2').value; draw(); };
  for (const k of ['scale', 'detail', 'contrast', 'shine', 'normal', 'extra'])
    $('tg-' + k).oninput = () => { G.P[k] = +$('tg-' + k).value; $('tg-v-' + k).textContent = G.P[k].toFixed(k === 'scale' || k === 'detail' ? 0 : 2); draw(); };
  $('tg-seed').onclick = () => { G.P.seed = (G.P.seed | 0) + 1; draw(); };
  $('tg-size').onchange = draw;
  $('tg-name').oninput = () => { $('tg-name').dataset.touched = '1'; draw(); };
  $$('[data-tgv]').forEach((b) => b.onclick = () => { G.view = b.dataset.tgv; sync(); draw(); });
  $('tg-add').onclick = () => { const t = current(); if (!t) return; if (G.list.some((x) => x.name === t.name)) { toast('A texture with this name is already in the list', 'err'); return; } G.list.push(t); listUi(); toast(`${t.name} added`, 'ok'); };
  $('tg-dds').onclick = () => { const t = current(); if (t) build([t], null); };
  $('tg-ytd-go').onclick = () => { const y = ($('tg-ytd').value || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'); if (!y) { toast('Give the .ytd a name', 'err'); return; } build(G.list, y); };

  $('tg-name').value = 'my_' + G.key;
  sync(); listUi();
  return { show() { draw(); } };
}
