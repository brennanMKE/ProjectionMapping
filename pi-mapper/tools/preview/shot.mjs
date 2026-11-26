// Screenshot a page with headless Chrome/Chromium, optionally evaluating JS first.
// usage: node shot.mjs <url> <w> <h> <out.png> [waitMs] [js-to-eval-before-shot]
//   e.g. node shot.mjs http://127.0.0.1:8777/tools/preview/preview.html 640 360 water.png 300 "run('water', 5)"
// Set CHROME to the browser binary if it isn't in the default macOS location.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [url, w, h, out, wait='2500', js=''] = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), 'shot-'));
const port = 9300 + Math.floor(Math.random()*500);
const ch = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, `--window-size=${w},${h}`, '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', 'about:blank'], {stdio:'ignore'});
const sleep = ms => new Promise(r=>setTimeout(r,ms));
let targets; for (let i=0;i<50;i++){ try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
const page = targets.find(t=>t.type==='page');
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
let id=0; const pend={};
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
  if (m.method==='Runtime.consoleAPICalled') { const t=m.params.type; if (t!=='log' || process.env.ALL) console.log('console.'+t+':', m.params.args.map(a=>a.value ?? a.description).join(' ')); }
  if (m.method==='Runtime.exceptionThrown') console.log('EXCEPTION:', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method==='Log.entryAdded' && m.params.entry.level!=='verbose') console.log('log.'+m.params.entry.level+':', m.params.entry.text, m.params.entry.url||''); };
const send = (method, params={}) => new Promise(r => { pend[++id]=r; ws.send(JSON.stringify({id, method, params})); });
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {width:+w, height:+h, deviceScaleFactor:1, mobile: +w < 600});
await send('Page.navigate', {url});
await sleep(+wait);
if (js) { const r = await send('Runtime.evaluate', {expression: js, awaitPromise:true, returnByValue:true}); console.log('eval:', JSON.stringify(r.result?.result?.value ?? r.result)); await sleep(800); }
if (process.env.DRAG) { const [x1,y1,x2,y2] = process.env.DRAG.split(',').map(Number);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:x1,y:y1,button:'left',clickCount:1});
  for (let i=1;i<=10;i++) { await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x1+(x2-x1)*i/10,y:y1+(y2-y1)*i/10,button:'left',buttons:1}); await sleep(30); }
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x2,y:y2,button:'left',clickCount:1}); await sleep(800); }
const shot = await send('Page.captureScreenshot', {format:'png', captureBeyondViewport: +w<600});
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
ch.kill(); process.exit(0);
