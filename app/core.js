// Bridge to the DoorCore engine (.NET, CodeWalker.Core). One long-running child process, JSON lines.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

class Core {
  constructor(app) {
    this.app = app;
    this.proc = null;
    this.pending = new Map();
    this.nextId = 1;
    this.ready = null;
    this.status = { ok: false, message: 'Engine not started' };
  }

  // Where DoorCore lives: packaged -> resources/core, dev -> core/bin/out
  locate() {
    const candidates = [
      path.join(process.resourcesPath || '', 'core'),
      path.join(__dirname, '..', 'core', 'bin', 'out'),
      path.join(__dirname, '..', 'core', 'bin', 'Release', 'net8.0'),
    ];
    for (const dir of candidates) {
      const exe = path.join(dir, process.platform === 'win32' ? 'DoorCore.exe' : 'DoorCore');
      const dll = path.join(dir, 'DoorCore.dll');
      if (fs.existsSync(exe) && process.platform === 'win32') return { cmd: exe, args: [], dir };
      if (fs.existsSync(dll)) return { cmd: 'dotnet', args: [dll], dir };
    }
    return null;
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve) => {
      const loc = this.locate();
      if (!loc) {
        this.status = { ok: false, message: 'DoorCore engine not found. Reinstall the app or run "npm run build:core".' };
        return resolve(this.status);
      }
      let settled = false;
      const done = (st) => { this.status = st; if (!settled) { settled = true; resolve(st); } };
      try {
        this.proc = spawn(loc.cmd, loc.args, { cwd: loc.dir, windowsHide: true });
      } catch (e) {
        return done({ ok: false, message: 'Could not start DoorCore: ' + e.message });
      }
      this.proc.on('error', (e) => {
        const msg = e.code === 'ENOENT'
          ? 'The .NET 8 Runtime is required (the same one CodeWalker uses). Install it from https://dotnet.microsoft.com/download/dotnet/8.0 then restart.'
          : 'DoorCore error: ' + e.message;
        done({ ok: false, message: msg });
        this.failAll(msg);
      });
      let errBuf = '';
      this.proc.on('exit', (code) => {
        const msg = 'DoorCore engine stopped (code ' + code + ').';
        const needRuntime = /framework|runtime|install|\.NET/i.test(errBuf);
        done({ ok: false, message: needRuntime ? 'The .NET 8 Runtime is required (the same one CodeWalker uses). Install it from https://dotnet.microsoft.com/download/dotnet/8.0 then restart.' : msg + (errBuf ? ' ' + errBuf.slice(0, 300) : '') });
        this.failAll(msg);
        this.proc = null; this.ready = null;
      });
      this.proc.stderr.on('data', (d) => { errBuf += d.toString(); if (errBuf.length > 4000) errBuf = errBuf.slice(-4000); });
      const rl = readline.createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.ready) return done({ ok: true, message: msg.engine });
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || 'Engine error'));
      });
      setTimeout(() => done({ ok: false, message: 'DoorCore did not answer. ' + (errBuf ? errBuf.slice(0, 400) : 'Is the .NET 8 Runtime installed?') }), 20000);
    });
    return this.ready;
  }

  failAll(msg) {
    for (const [, p] of this.pending) p.reject(new Error(msg));
    this.pending.clear();
  }

  async request(cmd, payload = {}) {
    const st = await this.start();
    if (!st.ok || !this.proc) throw new Error(st.message);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ id, cmd, ...payload }) + '\n');
    });
  }

  stop() { if (this.proc) { try { this.proc.kill(); } catch { } } }
}

module.exports = { Core };
