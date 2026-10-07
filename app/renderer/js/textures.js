// TEXTURES page: name of a prop / shell -> every texture it uses -> .dds files (DoorCore TexExport)
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function initTextures({ api, toast, getSettings, saveSettings, chooseOutFolder }) {
  const T = { gta: null, folder: null, res: null, sel: new Set(), busy: false };
  const log = (msg, cls = '') => { const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = msg; $('tex-log').appendChild(d); $('tex-log').scrollTop = 1e9; };

  async function setGta(dir, quiet) {
    if (!dir) return false;
    if (!(await api.isGta(dir))) { if (!quiet) toast('Not a GTA V Legacy folder (GTA5.exe + x64a.rpf needed)', 'err'); return false; }
    T.gta = dir; const s = getSettings();
    if (s.gtaFolder !== dir) { s.gtaFolder = dir; s.gtaKey = null; saveSettings(); }
    $('tex-gta').textContent = dir; $('tex-gta').classList.add('ok');
    return true;
  }
  function setFolder(dir) {
    T.folder = dir || null; const s = getSettings(); s.texFolder = T.folder; saveSettings();
    $('tex-folder').textContent = T.folder || '–'; $('tex-folder').classList.toggle('ok', !!T.folder);
  }

  async function search() {
    const name = $('tex-name').value.trim();
    if (!name || T.busy) return;
    if (!T.gta && !T.folder) { toast('Choose your GTA V folder or your own folder first', 'err'); return; }
    T.busy = true; refresh();
    $('tex-grid').innerHTML = '<div class="muted">Searching… (the first GTA search takes 10-60 s)</div>';
    log(`› ${name}`);
    try {
      const s = getSettings();
      const res = await api.texFind({ name, gta: T.gta, key: s.gtaKey || null, folder: T.folder });
      if (res.key && res.key !== s.gtaKey) { s.gtaKey = res.key; saveSettings(); }
      T.res = res; T.sel = new Set(res.textures.map((t) => t.name));
      $('tex-info').innerHTML = `<b>${esc(res.name)}</b>${res.mlo ? ' · MLO shell' : ''} · ${res.models.length} model(s) · ${res.textures.length} textures` +
        res.models.slice(0, 6).map((m) => `<br>· ${esc(m.name)}.${esc(m.kind || '?')} <span class="muted">${esc(m.from || 'not found')}</span>`).join('') + (res.models.length > 6 ? `<br>· … ${res.models.length - 6} more` : '');
      log(`  ✓ ${res.textures.length} textures`, 'ok');
      for (const w of res.warnings) log('  ! ' + w, 'w');
      if (res.missing.length) log(`  ! ${res.missing.length} used textures not found (in another GTA .ytd): ${res.missing.slice(0, 12).join(', ')}${res.missing.length > 12 ? '…' : ''}`, 'w');
      grid();
    } catch (e) { $('tex-grid').innerHTML = `<div class="tex-missing">${esc(e.message)}</div>`; log('  ✗ ' + e.message, 'err'); T.res = null; }
    T.busy = false; refresh();
  }

  function grid() {
    const r = T.res; if (!r) return;
    $('tex-grid').innerHTML = r.textures.map((t, i) => `<label class="tex-card ${T.sel.has(t.name) ? '' : 'off'}" title="${esc(t.from)}">` +
      `<input type="checkbox" data-t="${esc(t.name)}" ${T.sel.has(t.name) ? 'checked' : ''}><canvas width="128" height="128" data-i="${i}"></canvas>` +
      `<b>${esc(t.name)}</b><span>${t.w}×${t.h} · ${esc(t.format)}</span><span>${esc(t.from)}</span></label>`).join('') +
      (r.missing.length ? `<div class="tex-missing">⚠ ${r.missing.length} not found (used by the model but stored in another GTA .ytd): ${r.missing.map(esc).join(', ')}` +
        (T.gta ? `<br><button class="btn tiny" id="tex-deep">SEARCH THEM IN ALL GTA .YTD</button> <span class="muted">the first time takes a few minutes, then it is instant</span>` : '') + '</div>' : '');
    $('tex-grid').querySelectorAll('canvas[data-i]').forEach((cv) => {
      const t = r.textures[+cv.dataset.i]; if (!t.thumb) return;
      const px = Uint8ClampedArray.from(atob(t.thumb), (c) => c.charCodeAt(0));
      const img = new ImageData(px, t.tw, t.th);
      const tmp = document.createElement('canvas'); tmp.width = t.tw; tmp.height = t.th; tmp.getContext('2d').putImageData(img, 0, 0);
      const g = cv.getContext('2d'), k = Math.min(128 / t.tw, 128 / t.th), w = t.tw * k, h = t.th * k;
      g.drawImage(tmp, (128 - w) / 2, (128 - h) / 2, w, h);
    });
    if ($('tex-deep')) $('tex-deep').onclick = deep;
    $('tex-grid').querySelectorAll('input[data-t]').forEach((c) => c.onchange = () => {
      if (c.checked) T.sel.add(c.dataset.t); else T.sel.delete(c.dataset.t);
      c.closest('.tex-card').classList.toggle('off', !c.checked); refresh();
    });
  }

  async function deep() {
    if (!T.res || T.busy) return;
    T.busy = true; refresh(); $('tex-deep').disabled = true; $('tex-deep').textContent = 'SEARCHING ALL GTA .YTD…';
    log(`› search ${T.res.missing.length} missing textures in every GTA .ytd`);
    try {
      const r = await api.texDeep({ names: T.res.missing });
      for (const t of r.textures) if (!T.res.textures.some((x) => x.name === t.name)) { T.res.textures.push(t); T.sel.add(t.name); }
      T.res.missing = r.missing;
      log(`  ✓ ${r.added} found` + (r.missing.length ? `, ${r.missing.length} still missing` : ''), r.added ? 'ok' : 'w');
    } catch (e) { log('  ✗ ' + e.message, 'err'); toast(e.message, 'err'); }
    T.busy = false; grid(); refresh();
  }

  function refresh() {
    const n = T.res ? T.sel.size : 0;
    $('tex-sum').textContent = T.res ? `${n} / ${T.res.textures.length} selected` : '';
    $('tex-go').disabled = T.busy; $('tex-go').textContent = T.busy ? '…' : 'SEARCH';
    $('tex-export').disabled = T.busy || !n;
    $('tex-export').textContent = n ? `EXPORT ${n} .DDS` : 'EXPORT .DDS';
  }

  async function exportDds() {
    if (!T.res || !T.sel.size || T.busy) return;
    const parent = await chooseOutFolder(); if (!parent) return;
    const sep = parent.includes('\\') ? '\\' : '/';
    const out = parent.replace(/[\\/]+$/, '') + sep + T.res.name + '_textures';
    T.busy = true; refresh(); log(`› export → ${out}`);
    try {
      const r = await api.texExport({ outDir: out, names: [...T.sel] });
      log(`  ✓ ${r.files.length} .dds written`, 'ok');
      for (const e of r.errors) log('  ✗ ' + e, 'err');
      $('tex-out').innerHTML = `<b>${r.files.length}</b> .dds in <b>${esc(T.res.name)}_textures/</b>`;
      toast(`${r.files.length} textures exported`, 'ok');
      api.openPath(out);
    } catch (e) { log('  ✗ ' + e.message, 'err'); toast(e.message, 'err'); }
    T.busy = false; refresh();
  }

  $('tex-gta-detect').onclick = async () => { const d = await api.detectGta(); if (d) setGta(d); else toast('GTA V not found - use Choose…', 'err'); };
  $('tex-gta-choose').onclick = async () => { const d = await api.chooseFolder('Choose your GTA V Legacy folder (with GTA5.exe)'); if (d) setGta(d); };
  $('tex-folder-choose').onclick = async () => { const d = await api.chooseFolder('Choose your folder (server resources, shells…)'); if (d) setFolder(d); };
  $('tex-folder-clear').onclick = () => setFolder(null);
  $('tex-go').onclick = search;
  $('tex-name').onkeydown = (e) => { if (e.key === 'Enter') search(); };
  $('tex-all').onclick = () => { if (!T.res) return; T.sel = new Set(T.res.textures.map((t) => t.name)); grid(); refresh(); };
  $('tex-none').onclick = () => { T.sel.clear(); grid(); refresh(); };
  $('tex-export').onclick = exportDds;

  return {
    async show(on) {
      $('tex-page').classList.toggle('hidden', !on);
      if (!on) return;
      const s = getSettings();
      if (!T.gta) { if (!(s.gtaFolder && await setGta(s.gtaFolder, true))) { const d = await api.detectGta(); if (d) await setGta(d, true); } }
      if (!T.folder && s.texFolder) setFolder(s.texFolder);
      refresh(); setTimeout(() => $('tex-name').focus(), 50);
    },
    setGta, setFolder, search: (n) => { $('tex-name').value = n; return search(); },
  };
}
