#!/usr/bin/env node
/* wireface — local test runner. No dependencies.
 *
 *   node test/run.mjs            run the suite against ../wireface.js
 *   node test/run.mjs --min      …against dist/wireface.min.js (run `npm run build` first)
 *   node test/run.mjs --headed   show the browser
 *   node test/run.mjs --only=stream   run the groups whose name contains the text
 *   node test/run.mjs --software software WebGL, as CI runs it (slow)
 *
 * It serves the repository over http, starts the installed Chrome, opens
 * test/index.html and the example pages over the DevTools protocol, and exits
 * non-zero when a check fails. Set CHROME_BIN to choose the browser.
 * Needs Node 22+ (global WebSocket).
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const flag = n => args.includes('--' + n);
const opt = n => (args.find(a => a.startsWith('--' + n + '=')) || '').split('=')[1] || '';
const MIN = flag('min'), HEADED = flag('headed'), ONLY = opt('only');
const SOFTWARE = flag('software') || !!process.env.CI;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
               '.mp3': 'audio/mpeg', '.png': 'image/png', '.css': 'text/css', '.md': 'text/plain' };

function serve() {
  return new Promise(res => {
    const srv = createServer(async (req, rsp) => {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path === '/favicon.ico') { rsp.writeHead(204).end(); return; }
      const file = normalize(join(ROOT, path));
      if (file !== ROOT && !file.startsWith(ROOT + sep)) { rsp.writeHead(403).end(); return; }
      try {
        const body = await readFile(file);
        rsp.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
      } catch { rsp.writeHead(404).end('not found'); }
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

function findChrome() {
  const c = [process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean);
  const hit = c.find(p => existsSync(p));
  if (!hit) throw new Error('no Chrome found — set CHROME_BIN to a Chrome or Chromium binary');
  return hit;
}

async function launch() {
  const profile = await mkdtemp(join(tmpdir(), 'wireface-test-'));
  const proc = spawn(findChrome(), [
    HEADED ? '' : '--headless=new',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    // software WebGL where there is no GPU (CI, or --software): slow, a few frames per second
    ...(SOFTWARE ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []), '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    process.env.CI ? '--no-sandbox' : '',
    '--window-size=1100,800', 'about:blank',
  ].filter(Boolean), { stdio: ['ignore', 'ignore', 'pipe'] });
  const ws = await new Promise((res, rej) => {
    let err = '';
    const t = setTimeout(() => rej(new Error('Chrome did not start:\n' + err.slice(-2000))), 30000);
    proc.stderr.on('data', d => {
      err += d;
      const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); res(m[1]); }
    });
    proc.on('exit', code => rej(new Error('Chrome exited early (' + code + '):\n' + err.slice(-2000))));
  });
  return { proc, ws, profile };
}

/* a minimal DevTools-protocol client */
function cdp(url) {
  return new Promise((res, rej) => {
    const sock = new WebSocket(url);
    let id = 0; const waits = new Map(); const subs = [];
    sock.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && waits.has(m.id)) { const w = waits.get(m.id); waits.delete(m.id); m.error ? w.rej(new Error(m.error.message)) : w.res(m.result); }
      else if (m.method) for (const s of subs) s(m);
    };
    sock.onerror = () => rej(new Error('DevTools socket failed'));
    sock.onopen = () => res({
      send: (method, params = {}, sessionId) => new Promise((r, j) => { const i = ++id; waits.set(i, { res: r, rej: j }); sock.send(JSON.stringify({ id: i, method, params, sessionId })); }),
      on: fn => subs.push(fn),
      close: () => sock.close(),
    });
  });
}

async function openPage(client, url) {
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  const errors = [];
  client.on(m => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text + ' ' + (m.params.entry.url || ''));
  });
  const send = (method, params) => client.send(method, params, sessionId);
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.navigate', { url });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { evaluate, errors, close: () => client.send('Target.closeTarget', { targetId }) };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const chrome = await launch();
  let failed = 0;
  try {
    const client = await cdp(chrome.ws);

    // ── 1. the suite ──
    const q = new URLSearchParams();
    if (MIN) q.set('min', '1');
    if (ONLY) q.set('only', ONLY);
    const page = await openPage(client, `${base}/test/index.html?${q}`);
    console.log(`wireface tests — ${MIN ? 'dist/wireface.min.js' : 'wireface.js'}${ONLY ? ' — only: ' + ONLY : ''}`);
    let seen = 0, done = null;
    const t0 = Date.now();
    while (!done) {
      if (Date.now() - t0 > 240000) throw new Error('suite timed out after 240 s');
      await sleep(500);
      const state = await page.evaluate('JSON.stringify(window.__wf || null)');
      const s = state && JSON.parse(state);
      if (!s) continue;
      for (; seen < s.results.length; seen++) {
        const r = s.results[seen];
        console.log(`  ${r.ok ? '✓' : '✗'} ${r.group} › ${r.name}${r.ok ? '' : '\n      ' + r.detail}${r.note ? '  [' + r.note + ']' : ''}`);
      }
      if (s.done) done = s;
    }
    failed += done.results.filter(r => !r.ok).length;
    if (done.measurements && Object.keys(done.measurements).length) {
      console.log('\n  measurements');
      for (const [k, v] of Object.entries(done.measurements)) console.log(`    ${k.padEnd(34)} ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
    for (const e of page.errors) { console.log('  ✗ page error: ' + e); failed++; }
    await page.close();

    // ── 2. every example page opens without an error ──
    if (!ONLY) {
      console.log('\n  examples');
      for (const ex of ['demo.html', 'behaviours.html', 'editor.html', 'playground.html']) {
        const p = await openPage(client, `${base}/examples/${ex}`);
        await sleep(2500);
        const canvases = await p.evaluate('document.querySelectorAll("canvas").length');
        const ok = p.errors.length === 0 && canvases > 0;
        console.log(`  ${ok ? '✓' : '✗'} examples/${ex} opens (${canvases} canvas)${ok ? '' : '\n      ' + p.errors.join('\n      ')}`);
        if (!ok) failed++;
        await p.close();
      }
    }
    client.close();
  } finally {
    chrome.proc.kill();
    srv.close();
    await sleep(300);
    await rm(chrome.profile, { recursive: true, force: true }).catch(() => {});
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('\ntest runner error: ' + (e.stack || e)); process.exit(2); });
