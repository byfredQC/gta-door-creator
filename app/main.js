const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Core } = require('./core');

const core = new Core(app);
let win = null;
let dirty = false;

function send(channel, ...args) { if (win && !win.isDestroyed()) win.webContents.send(channel, ...args); }

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'open') },
        { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => send('menu', 'save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu', 'saveAs') },
        { type: 'separator' },
        { label: 'Import Prop…', accelerator: 'CmdOrCtrl+I', click: () => send('menu', 'import') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Perspective', accelerator: '5', click: () => send('menu', 'view:persp') },
        { label: 'Front', accelerator: '1', click: () => send('menu', 'view:front') },
        { label: 'Side', accelerator: '3', click: () => send('menu', 'view:side') },
        { label: 'Top', accelerator: '7', click: () => send('menu', 'view:top') },
        { type: 'separator' },
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Create desktop shortcut', click: () => { const ok = desktopShortcut(true); send('menu', ok ? 'shortcut:ok' : 'shortcut:fail'); } },
        { label: 'Install .NET 8 Runtime', click: () => shell.openExternal('https://dotnet.microsoft.com/download/dotnet/8.0') },
        { label: 'About GTA Door Creator', click: () => send('menu', 'about') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1180, minHeight: 720,
    backgroundColor: '#050407', autoHideMenuBar: true,
    title: 'GTA Door Creator',
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // double-clicked .doorproject (file association)
  const projArg = process.argv.slice(1).find((a) => a.toLowerCase().endsWith('.doorproject') && fs.existsSync(a));
  if (projArg) win.webContents.once('did-finish-load', () => setTimeout(() => send('open-project', projArg), 1500));
  win.on('close', (e) => {
    if (!dirty || process.env.GDC_NO_PROMPT) return;
    const r = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Quit without saving', 'Cancel'], defaultId: 1, cancelId: 1,
      title: 'Unsaved project', message: 'This door project has unsaved changes. Quit anyway?',
    });
    if (r !== 0) e.preventDefault();
  });
}

// ---------------------------------------------------------------- IPC
const PROP_FILTERS = [{ name: 'GTA files', extensions: ['ydr', 'xml', 'ytyp', 'ybn', 'ytd'] }, { name: 'All files', extensions: ['*'] }];

ipcMain.handle('core:status', () => core.start());
ipcMain.handle('core:load', (_e, p) => core.request('load', { path: p }));
ipcMain.handle('core:export', (_e, job) => core.request('export', job));
ipcMain.handle('core:buildSample', (_e, out, kind) => core.request('build', { out, kind }));
ipcMain.handle('core:audio', (_e, out, links) => core.request('audio', { out, links }));
ipcMain.handle('core:splitPreview', (_e, source, pieces, seed) => core.request('splitpreview', { source, pieces, seed }));

ipcMain.handle('dialog:openProp', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Import GTA prop', properties: ['openFile', 'multiSelections'], filters: PROP_FILTERS });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('dialog:openYbn', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Import collision (YBN)', properties: ['openFile'], filters: [{ name: 'Collision', extensions: ['ybn'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:chooseFolder', async (_e, title) => {
  const r = await dialog.showOpenDialog(win, { title: title || 'Choose folder', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:saveProject', async (_e, defName) => {
  const r = await dialog.showSaveDialog(win, { title: 'Save door project', defaultPath: defName || 'door.doorproject', filters: [{ name: 'Door project', extensions: ['doorproject'] }] });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('dialog:openProject', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Open door project', properties: ['openFile'], filters: [{ name: 'Door project', extensions: ['doorproject'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:message', async (_e, opts) => (await dialog.showMessageBox(win, opts)).response);

ipcMain.handle('fs:readText', (_e, p) => fs.readFileSync(p, 'utf8'));
ipcMain.handle('fs:writeText', (_e, p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text, 'utf8'); return p; });
ipcMain.handle('fs:readB64', (_e, p) => fs.readFileSync(p).toString('base64'));
ipcMain.handle('fs:writeB64', (_e, p, b64) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(b64, 'base64')); return p; });
ipcMain.handle('fs:exists', (_e, p) => fs.existsSync(p));
ipcMain.handle('fs:mkdir', (_e, p) => { fs.mkdirSync(p, { recursive: true }); return p; });
ipcMain.handle('fs:move', (_e, from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(from, to); return to; });
ipcMain.handle('fs:remove', (_e, p) => { fs.rmSync(p, { force: true, recursive: true }); return true; });
ipcMain.handle('fs:tempDir', (_e, sub) => { const d = path.join(os.tmpdir(), 'gta-door-creator', sub || ''); fs.mkdirSync(d, { recursive: true }); return d; });
ipcMain.handle('fs:list', (_e, p) => fs.existsSync(p) ? fs.readdirSync(p) : []);
ipcMain.handle('shell:open', (_e, p) => shell.openPath(p));
ipcMain.handle('shell:show', (_e, p) => shell.showItemInFolder(p));

const presetFile = () => path.join(app.getPath('userData'), 'presets.json');
ipcMain.handle('presets:load', () => { try { return JSON.parse(fs.readFileSync(presetFile(), 'utf8')); } catch { return []; } });
ipcMain.handle('presets:save', (_e, list) => { fs.mkdirSync(path.dirname(presetFile()), { recursive: true }); fs.writeFileSync(presetFile(), JSON.stringify(list, null, 2)); return true; });
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
ipcMain.handle('settings:load', () => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } });
ipcMain.handle('settings:save', (_e, s) => { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); return true; });

ipcMain.on('win:title', (_e, t) => { if (win) win.setTitle(t); });
ipcMain.on('win:dirty', (_e, d) => { dirty = !!d; });
ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, argv: process.argv }));

// ---------------------------------------------------------------- uninstall (Settings)
function uninstallerPath() {
  if (process.platform !== 'win32' || !app.isPackaged) return null;
  const dir = path.dirname(process.execPath);
  try {
    const f = fs.readdirSync(dir).find((x) => /^uninstall.*\.exe$/i.test(x));
    return f ? path.join(dir, f) : null;
  } catch { return null; }
}
ipcMain.handle('app:uninstallInfo', () => ({
  installed: !!uninstallerPath(),
  portable: process.env.PORTABLE_EXECUTABLE_FILE || null,
  exe: process.execPath,
  folder: path.dirname(process.execPath),
  userData: app.getPath('userData'),
}));
ipcMain.handle('app:uninstall', (_e, wipeData) => {
  const u = uninstallerPath();
  if (!u) return false;
  if (wipeData) for (const f of ['settings.json', 'presets.json', 'shortcut.json']) { try { fs.rmSync(path.join(app.getPath('userData'), f), { force: true }); } catch { } }
  require('child_process').spawn(u, [], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); app.quit(); }, 400);
  return true;
});
ipcMain.handle('app:openFolder', (_e, which) => shell.openPath(which === 'data' ? app.getPath('userData') : path.dirname(process.execPath)));

// ---------------------------------------------------------------- desktop shortcut (Windows)
function desktopShortcut(force = false) {
  if (process.platform !== 'win32' || !app.isPackaged) return false;
  const flag = path.join(app.getPath('userData'), 'shortcut.json');
  if (!force && fs.existsSync(flag)) return false;
  const lnk = path.join(app.getPath('desktop'), 'GTA Door Creator.lnk');
  const ico = path.join(process.resourcesPath, 'icon.ico');
  const ok = shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'replace' : 'create', {
    target: process.execPath, cwd: path.dirname(process.execPath), description: 'GTA Door Creator',
    icon: fs.existsSync(ico) ? ico : process.execPath, iconIndex: 0,
  });
  try { fs.mkdirSync(path.dirname(flag), { recursive: true }); fs.writeFileSync(flag, JSON.stringify({ lnk, ok, at: new Date().toISOString() })); } catch { }
  return ok;
}
ipcMain.handle('app:shortcut', () => desktopShortcut(true));

app.whenReady().then(() => {
  try { desktopShortcut(false); } catch { }
  buildMenu();
  createWindow();
  core.start();
});
app.on('window-all-closed', () => { core.stop(); app.quit(); });
