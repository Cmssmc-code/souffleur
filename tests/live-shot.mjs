// Capture de l'écran d'entretien (disposition « scène ») avec un dossier local passé en argument.
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../tools/serve.mjs';
import { launchBrowser, newContext, createMock, ensureSpeechWav, SHOTS, sleep, GEMINI_KEY } from './e2e-lib.mjs';

const file = process.argv[2];
const dark = process.argv.includes('--dark');
const srv = await startServer({ port: 0, dir: 'src', quiet: true });
const wav = ensureSpeechWav();
const browser = await launchBrowser({ wav: wav.file });
const mock = createMock();
const ctx = await newContext(browser, mock, { dark, viewport: { width: 1536, height: 864 } });
await ctx.addInitScript(() => {
  // Faux recruteur : un visage dessiné, animé, à la place de l'onglet Meet.
  const orig = navigator.mediaDevices.getDisplayMedia;
  navigator.mediaDevices.getDisplayMedia = async function (c) {
    const s = await orig.call(this, c);
    const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720;
    const g = cv.getContext('2d'); let t = 0;
    (function draw() {
      t++; const gr = g.createLinearGradient(0, 0, 1280, 720); gr.addColorStop(0, '#2b3a55'); gr.addColorStop(1, '#5c4a72');
      g.fillStyle = gr; g.fillRect(0, 0, 1280, 720);
      g.fillStyle = '#e8c4a0'; g.beginPath(); g.arc(640, 330 + Math.sin(t / 10) * 4, 130, 0, 7); g.fill();
      g.fillStyle = '#3a2a1e'; g.beginPath(); g.arc(640, 250, 130, Math.PI, 0); g.fill();
      g.fillStyle = '#1f2937'; g.fillRect(470, 470, 340, 250);
      requestAnimationFrame(draw);
    })();
    return new MediaStream([...cv.captureStream(24).getVideoTracks(), ...s.getAudioTracks()]);
  };
});
const page = await ctx.newPage();
await page.goto(srv.url + 'index.html#/');
await page.waitForFunction(() => window.Souffleur && Souffleur.store && document.querySelector('#view .route'));
const id = await page.evaluate(async ({ txt, key }) => {
  document.querySelectorAll('.sheet-layer').forEach((n) => n.remove());
  Souffleur.store.setSettings({ onboarded: true, geminiKey: key, audioPreset: 'visio-casque' });
  const d = await Souffleur.store.importFile(txt);
  return d.id;
}, { txt: fs.readFileSync(file, 'utf8'), key: GEMINI_KEY });
await page.goto(srv.url + 'index.html?x=1#/live/' + id);
await page.waitForSelector('[data-act="start"]');
await page.evaluate(() => document.querySelectorAll('.sheet-layer').forEach((n) => n.remove()));
await page.click('[data-preset="visio-casque"]');
await page.click('[data-act="start"]');
await page.waitForSelector('.faq-item', { timeout: 10000 });
await sleep(2500);
await page.click('.faq-item');
await sleep(1200);
const out = path.join(SHOTS, `live-stage-${dark ? 'dark' : 'light'}.png`);
await page.screenshot({ path: out });
console.log(out);
console.log(JSON.stringify(await page.evaluate(() => {
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return [sel, Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height), e.hidden ? 'hidden' : '']; };
  const v = document.querySelector('.stage video');
  return { boxes: ['.live-bar', '.stage', '.answer', '.actions-bar', '.live-chat', '.live-faq', '.faq-list', '.live-faq .ask'].map(r), video: v && [v.videoWidth, v.videoHeight, v.readyState], faq: document.querySelectorAll('.faq-item').length, first: [...document.querySelectorAll('.faq-item')].slice(0, 5).map((x) => x.textContent), answer: (document.querySelector('.answer-text') || {}).textContent?.slice(0, 120), overflowY: document.documentElement.scrollHeight - innerHeight };
})));
await browser.close(); srv.server.close();
