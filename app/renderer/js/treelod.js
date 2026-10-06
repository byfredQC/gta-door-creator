// TREE LOD page: a ymap of vanilla trees -> LOD models + <ymap>_lod.ymap + LOD ytyp (DoorCore TreeLod)
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function initTreeLod({ api, toast, getSettings, saveSettings, chooseOutFolder }) {
  const L = { gta: null, ymap: null, scan: null, sel: new Set(), pts: null, busy: false };

  function log(msg, cls = '') { const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = msg; $('lod-log').appendChild(d); $('lod-log').scrollTop = 1e9; }

  async function setGta(dir, quiet) {
    if (!dir) return false;
    if (!(await api.isGta(dir))) { if (!quiet) toast('Not a GTA V Legacy folder (GTA5.exe + x64a.rpf needed)', 'err'); return false; }
    L.gta = dir;
    const s = getSettings();
    if (s.gtaFolder !== dir) { s.gtaFolder = dir; s.gtaKey = null; saveSettings(); }
    $('lod-gta').textContent = dir; $('lod-gta').classList.add('ok');
    if (L.ymap && !L.scan) scan();
    refresh();
    return true;
  }

  async function scan() {
    if (!L.gta || !L.ymap || L.busy) return;
    L.busy = true; refresh();
    $('lod-rows').innerHTML = '<tr><td colspan="6" class="muted">Reading your GTA files (the first time takes 10-60 s)…</td></tr>';
    log(`› scan ${L.ymap}`);
    try {
      const s = getSettings();
      const res = await api.treeScan({ gta: L.gta, key: s.gtaKey || null, ymap: L.ymap });
      if (res.key && res.key !== s.gtaKey) { s.gtaKey = res.key; saveSettings(); }
      L.scan = res;
      L.sel = new Set(res.groups.filter((g) => g.tree && g.ok).map((g) => g.hash));
      const b = Uint8Array.from(atob(res.points), (c) => c.charCodeAt(0));
      L.pts = new Float32Array(b.buffer);
      $('lod-ymap').innerHTML = `<b>${esc(res.ymapName)}.ymap</b> · ${res.entities} entities · ${res.groups.length} models` +
        (res.parent ? `<br>⚠ already has a parent ymap: ${esc(res.parent)}` : '') + (res.alreadyChained ? `<br>⚠ ${res.alreadyChained} entities already have a LOD` : '') +
        (res.brokenLodFlag ? `<br>⚠ ${res.brokenLodFlag} entities have the flag "LOD in Parented YMAP" with no LOD (they can vanish) - fixed by GENERATE` : '');
      log(`  ✓ ${res.entities} entities, ${res.groups.filter((g) => g.tree).length} tree models`, 'ok');
    } catch (e) { $('lod-rows').innerHTML = `<tr><td colspan="6" class="bad">${esc(e.message)}</td></tr>`; log('  ✗ ' + e.message, 'err'); L.scan = null; }
    L.busy = false; refresh();
  }

  function rows() {
    if (!L.scan) return;
    $('lod-rows').innerHTML = L.scan.groups.map((g) => {
      const on = L.sel.has(g.hash);
      const tris = g.ok ? `${g.tris[0].toLocaleString()} → <b>${g.lodTris.toLocaleString()}</b>` : '–';
      const st = !g.ok ? `<td class="bad">${esc(g.problem)}</td>` : g.lodLevel === 'High' ? '<td class="w">no low level - LOD = full model</td>' : '<td class="good">ready</td>';
      return `<tr class="${on ? '' : 'off'}"><td><input type="checkbox" data-h="${g.hash}" ${on ? 'checked' : ''} ${g.ok ? '' : 'disabled'}></td>` +
        `<td>${esc(g.name)}${g.tree ? '<span class="tag">TREE</span>' : ''}</td><td>${g.count}</td><td>${g.ok ? g.lodLevel : '–'}</td><td>${tris}</td>${st}</tr>`;
    }).join('');
    $('lod-rows').querySelectorAll('input[data-h]').forEach((c) => c.onchange = () => { if (c.checked) L.sel.add(c.dataset.h); else L.sel.delete(c.dataset.h); refresh(); });
  }

  function draw() {
    const cv = $('lod-map'), r = cv.getBoundingClientRect();
    cv.width = Math.max(300, Math.round(r.width * devicePixelRatio)); cv.height = Math.round(420 * devicePixelRatio);
    const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
    if (!L.pts || !L.scan) return;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < L.pts.length; i += 3) { x0 = Math.min(x0, L.pts[i]); x1 = Math.max(x1, L.pts[i]); y0 = Math.min(y0, L.pts[i + 1]); y1 = Math.max(y1, L.pts[i + 1]); }
    const pad = 20 * devicePixelRatio, sc = Math.min((cv.width - 2 * pad) / Math.max(1, x1 - x0), (cv.height - 2 * pad) / Math.max(1, y1 - y0));
    const ox = (cv.width - (x1 - x0) * sc) / 2, oy = (cv.height - (y1 - y0) * sc) / 2;
    const acc = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#22c55e';
    const rad = Math.max(1.5, 2.2 * devicePixelRatio);
    for (const pass of [0, 1]) {
      g.fillStyle = pass ? acc : '#4b5563';
      g.beginPath();
      for (let i = 0; i < L.pts.length; i += 3) {
        const grp = L.scan.groups[L.pts[i + 2]]; const on = grp && L.sel.has(grp.hash);
        if (on !== !!pass) continue;
        const px = ox + (L.pts[i] - x0) * sc, py = cv.height - (oy + (L.pts[i + 1] - y0) * sc);
        g.moveTo(px + rad, py); g.arc(px, py, rad, 0, 6.2832);
      }
      g.fill();
    }
    g.fillStyle = '#9ca3af'; g.font = `${11 * devicePixelRatio}px sans-serif`;
    g.fillText(`${Math.round(x1 - x0)} m × ${Math.round(y1 - y0)} m`, pad, cv.height - pad / 2);
  }

  function refresh() {
    const hd = +$('lod-hd').value, ld = +$('lod-lod').value;
    $('lod-v-hd').textContent = hd ? hd + ' m' : 'AUTO'; $('lod-v-lod').textContent = ld + ' m';
    rows(); draw();
    const n = L.scan ? L.scan.groups.filter((g) => L.sel.has(g.hash)).reduce((a, g) => a + g.count, 0) : 0;
    $('lod-sum').textContent = L.scan ? `${n} trees get a LOD` : '';
    $('lod-go').disabled = L.busy || !L.scan || n === 0;
    $('lod-go').textContent = L.busy ? 'WORKING…' : n ? `GENERATE LOD RESOURCE (${n} TREES)` : 'GENERATE LOD RESOURCE';
  }

  async function pickYmap(p) {
    if (!p) return;
    L.ymap = p; L.scan = null; L.pts = null;
    $('lod-ymap').textContent = p;
    if (!L.gta) { toast('Choose your GTA V folder first', 'err'); refresh(); return; }
    await scan();
  }

  async function generate() {
    if (!L.scan || L.busy) return;
    const parent = await chooseOutFolder(); if (!parent) return;
    const resName = (L.scan.ymapName || 'trees') + '_lodpack';
    const root = parent.replace(/[\\/]+$/, '') + (parent.includes('\\') ? '\\' : '/') + resName;
    const sep = root.includes('\\') ? '\\' : '/';
    L.busy = true; refresh();
    log(`› generate → ${root}`);
    try {
      const s = getSettings();
      const res = await api.treeBuild({ gta: L.gta, key: s.gtaKey || null, ymap: L.ymap, outDir: root + sep + 'stream', select: [...L.sel], hdDist: +$('lod-hd').value, lodDist: +$('lod-lod').value });
      for (const f of res.files) log('  ✓ ' + f.split(/[\\/]/).slice(-2).join('/'), 'ok');
      for (const m of res.models) log(`  ✓ ${m.lod}: ${m.count} trees, ${m.from} level, ${m.hdTris} → ${m.tris} triangles`, 'ok');
      for (const w of res.warnings) log('  ! ' + w, 'w');
      await api.writeText(root + sep + 'fxmanifest.lua', manifest(resName, res));
      await api.writeText(root + sep + 'README.txt', readme(resName, res));
      log('  ✓ fxmanifest.lua, README.txt', 'ok');
      log(`  ⚠ ${res.hdYmap} REPLACES your original ymap: remove the old one from its resource (never stream both).`, 'w');
      $('lod-out').innerHTML = `<b>${esc(resName)}/</b> ready: ${res.linked} trees linked to their LOD. Restart: disconnect + reconnect to the server.`;
      toast(`Tree LOD resource "${resName}" ready`, 'ok');
      api.openPath(root);
    } catch (e) { log('  ✗ ' + e.message, 'err'); toast(e.message, 'err'); }
    L.busy = false; refresh();
  }

  function manifest(resName, r) {
    return `-- Generated by GTA Door Creator (TREE LOD)
fx_version 'cerulean'
game 'gta5'

name '${resName}'
description 'Trees with LOD: ${r.hdYmap} + ${r.lodYmap}'
version '1.0.0'

this_is_a_map 'yes'

files {
  'stream/${r.ytyp}',
}

data_file 'DLC_ITYP_REQUEST' 'stream/${r.ytyp}'
`;
  }
  function readme(resName, r) {
    return `${resName}
${'='.repeat(resName.length)}
Generated by GTA Door Creator - TREE LOD.

${r.linked} trees of ${r.hdYmap} now have a LOD visible up to ${r.lodDist} m.

INSTALL
1. Remove the OLD ${r.hdYmap} from its resource (this one replaces it - never stream both).
2. Copy this folder into your server's resources, add  ensure ${resName}  to server.cfg.
3. Disconnect and reconnect to the server (FiveM caches streamed files - a restart is not enough).

FILES (stream/)
- ${r.hdYmap}        your trees (HD). Each tree: flag 8 "LOD in Parented YMAP", parentIndex -> its LOD, parent = ${r.lodYmap.replace('.ymap', '')}
- ${r.lodYmap}    one LOD per tree, same position / rotation / scale, lodLevel LOD, childLodDist = the tree's distance
${r.models.map((m) => `- ${m.lod}.ydr   LOD of ${m.tree} (${m.from} level of the GTA model, ${m.tris} triangles, no collision)`).join('\n')}
- ${r.ytyp}    the LOD archetypes (texture dictionary = GTA's own, nothing copied)

Edit the trees later in CodeWalker? Do it in your ORIGINAL ymap and generate again.
`;
  }

  // ---- bindings
  $('lod-gta-detect').onclick = async () => { const d = await api.detectGta(); if (d) setGta(d); else toast('GTA V not found - use Choose…', 'err'); };
  $('lod-gta-choose').onclick = async () => { const d = await api.chooseFolder('Choose your GTA V Legacy folder (with GTA5.exe)'); if (d) setGta(d); };
  $('lod-drop').onclick = async () => pickYmap(await api.openYmapDialog());
  $('lod-drop').ondragover = (e) => { e.preventDefault(); e.stopPropagation(); $('lod-drop').classList.add('over'); };
  $('lod-drop').ondragleave = () => $('lod-drop').classList.remove('over');
  $('lod-drop').ondrop = (e) => { e.preventDefault(); e.stopPropagation(); $('lod-drop').classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) pickYmap(api.pathForFile(f)); };
  $('lod-all').onclick = () => { if (!L.scan) return; L.sel = new Set(L.scan.groups.filter((g) => g.tree && g.ok).map((g) => g.hash)); refresh(); };
  $('lod-none').onclick = () => { L.sel.clear(); refresh(); };
  $('lod-hd').oninput = refresh; $('lod-lod').oninput = refresh;
  $('lod-go').onclick = generate;
  window.addEventListener('resize', () => { if (!$('lod-page').classList.contains('hidden')) draw(); });

  return {
    async show(on) {
      $('lod-page').classList.toggle('hidden', !on);
      if (!on) return;
      if (!L.gta) { const s = getSettings(); if (!(s.gtaFolder && await setGta(s.gtaFolder, true))) { const d = await api.detectGta(); if (d) await setGta(d, true); } }
      refresh();
    },
    openYmap: pickYmap,
    setGta,
  };
}
