// Vérification visuelle et fonctionnelle des écrans secondaires (screens.js) avec API mockées.
// Usage : node tests/screens-shots.mjs  → captures dans tests/shots/screens-*.png, erreurs listées en fin.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'tests', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/tests/screens-harness.html`;
const REAL = `http://127.0.0.1:${server.address().port}/src/index.html`;

const exe = process.env.CHROME || path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe');
const browser = await chromium.launch({ executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errors = [];
const checks = [];
const ok = (cond, label) => { checks.push(`${cond ? 'OK  ' : 'FAIL'} ${label}`); };

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1180, height: 860 }, colorScheme: opts.dark ? 'dark' : 'light', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`[console] ${m.text()}`); });
  return page;
}
// Audit de mise en page (débordements, chevauchements, cibles trop petites, texte coupé).
async function audit(page, name) {
  const issues = await page.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) out.push(`débordement horizontal (${document.documentElement.scrollWidth} > ${vw})`);
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !el.closest('[hidden]') && !el.closest('details:not([open]) > :not(summary)'); };
    const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}${el.dataset.act ? `[${el.dataset.act}]` : ''} « ${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)} »`;
    const scope = document.querySelector('.hx-overlay, .sheet-layer') || document.getElementById('app') || document.getElementById('view') || document.body;
    const inter = [...scope.querySelectorAll('button, a[href], input:not([type="checkbox"]), select, textarea, label.switch')].filter(vis);
    inter.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1) out.push(`hors écran à droite : ${label(el)}`);
      if (r.height < 28 && !el.closest('.ob-steps') && !el.matches('.st-link')) out.push(`cible trop petite (${Math.round(r.height)} px) : ${label(el)}`);
    });
    for (let i = 0; i < inter.length; i++) {
      for (let j = i + 1; j < inter.length; j++) {
        const a = inter[i]; const b = inter[j];
        if (a.contains(b) || b.contains(a)) continue;
        const r1 = a.getBoundingClientRect(); const r2 = b.getBoundingClientRect();
        const ox = Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left);
        const oy = Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top);
        if (ox > 2 && oy > 2) out.push(`chevauchement : ${label(a)} / ${label(b)}`);
      }
    }
    [...scope.querySelectorAll('.btn, .pill, .badge, .h1, .h2, .h3, .dg-title, .rc-stat-v, .tr-question')].filter(vis).forEach((el) => {
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible') out.push(`texte coupé : ${label(el)}`);
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1) out.push(`hors écran : ${label(el)}`);
    });
    return out;
  });
  issues.forEach((i) => errors.push(`[layout ${name}] ${i}`));
}
const shot = async (page, name, full = true) => { await audit(page, name); return page.screenshot({ path: path.join(SHOTS, `screens-${name}.png`), fullPage: full }); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const only = (process.argv[2] || '').split(',').filter(Boolean);
const want = (k) => !only.length || only.includes(k);

try {
  /* ---------------- Réglages ---------------- */
  if (want('settings')) {
    const page = await newPage();
    await page.goto(`${BASE}#/settings`);
    await wait(700);
    await page.click('[data-act="test"][data-provider="gemini"]');
    await wait(900);
    ok(await page.locator('[data-status="gemini"] .pill-ok').count() === 1, 'settings: test clé Gemini OK');
    ok((await page.locator('select[data-model="answer"] option').count()) > 3, 'settings: modèles découverts');
    await page.click('[data-act="eye"] >> nth=0');
    ok(await page.getAttribute('[data-key="geminiKey"]', 'type') === 'text', 'settings: œil affiche la clé');
    await page.click('[data-act="seg"][data-set="theme"][data-v="dark"]');
    ok(await page.evaluate(() => window.Souffleur.store.settings().theme) === 'dark', 'settings: thème enregistré');
    await page.fill('[data-key="claudeKey"]', '  sk-ant-test  ');
    await page.locator('[data-key="claudeKey"]').blur();
    ok(await page.evaluate(() => window.Souffleur.store.settings().claudeKey) === 'sk-ant-test', 'settings: clé Claude nettoyée et enregistrée');
    await page.click('[data-act="seg"][data-set="theme"][data-v="light"]');
    await wait(300);
    await shot(page, 'settings');
    await page.click('[data-act="wipe"]');
    await wait(300);
    await shot(page, 'settings-confirm', false);
    await page.click('.hx-sheet-actions .btn-ghost');
    await page.close();
    const dark = await newPage({ dark: true });
    await dark.goto(`${BASE}#/settings`);
    await wait(900);
    await shot(dark, 'settings-dark');
    await dark.close();
  }

  /* ---------------- Diagnostic ---------------- */
  if (want('diag')) {
    const page = await newPage();
    await page.goto(`${BASE}#/diag`);
    await wait(1100);
    await shot(page, 'diag-initial');
    await page.click('.dg-row[data-key="mic"] [data-act="row"]');
    await wait(1500);
    await shot(page, 'diag-mic-running', false);
    await wait(2200);
    ok(await page.locator('.dg-row[data-key="mic"].is-ok').count() === 1, 'diag: test micro OK');
    await page.click('.dg-row[data-key="display"] [data-act="row"]');
    await wait(2500);
    await shot(page, 'diag-display-running', false);
    await wait(3300);
    ok(await page.locator('.dg-row[data-key="display"].is-ok').count() === 1, 'diag: test audio onglet OK');
    await shot(page, 'diag-done');
    await page.close();
    const p2 = await newPage({ dark: true });
    await p2.goto(`${BASE}?mic-denied&display-noaudio&badkey#/diag`);
    await wait(1100);
    await p2.click('.dg-row[data-key="mic"] [data-act="row"]');
    await p2.click('.dg-row[data-key="display"] [data-act="row"]');
    await wait(900);
    ok(await p2.locator('.dg-row[data-key="mic"].is-err').count() === 1, 'diag: micro refusé → erreur');
    ok(await p2.locator('.dg-row[data-key="display"].is-warn').count() === 1, 'diag: pas de son partagé → avertissement');
    ok(await p2.locator('.dg-row[data-key="gemini"].is-err').count() === 1, 'diag: clé refusée → erreur');
    await shot(p2, 'diag-errors-dark');
    await p2.close();
  }

  /* ---------------- Récap ---------------- */
  if (want('recap')) {
    const page = await newPage();
    await page.goto(`${BASE}#/recap/d1/s1`);
    await wait(700);
    await page.click('.rc-transcript summary');
    await page.click('.rc-answers summary');
    await wait(400);
    ok(await page.locator('.rc-mail').count() === 1, 'recap: section mail');
    await shot(page, 'recap');
    await page.goto(`${BASE}#/recap/d1/s2`);
    await wait(400);
    await shot(page, 'recap-loading', false);
    await wait(1800);
    ok(await page.evaluate(() => !!window.__dossiers.get('d1').sessions.find((s) => s.id === 's2').recap), 'recap: récap généré sauvegardé');
    await shot(page, 'recap-generated', false);
    await page.goto(`${BASE}?recap-fail#/recap/d1/s2`);
    await page.reload();
    await wait(300);
    await page.evaluate(() => { window.__dossiers.get('d1').sessions.find((s) => s.id === 's2').recap = null; location.hash = '#/'; location.hash = '#/recap/d1/s2'; });
    await wait(2000);
    ok(await page.locator('.sc-note.is-err').count() === 1, 'recap: échec IA → récap simplifié + message');
    await shot(page, 'recap-fallback');
    await page.close();
    const m = await newPage({ viewport: { width: 390, height: 844 }, dark: true });
    await m.goto(`${BASE}#/recap/d1/s1`);
    await wait(700);
    await shot(m, 'recap-mobile-dark');
    await m.close();
  }

  /* ---------------- Entraînement ---------------- */
  if (want('training')) {
    const page = await newPage();
    await page.goto(`${BASE}#/training/d1`);
    await wait(500);
    await shot(page, 'training-intro');
    await page.click('[data-act="seg"][data-k="total"][data-v="5"]');
    await page.click('[data-act="start"]');
    await wait(450 + 400 + 1500);
    await shot(page, 'training-listening', false);
    // fin de la réponse simulée (~2,3 s) + 2,5 s de silence + notation (0,65 s), sans clic
    const autoOk = await page.waitForSelector('.tr-result', { timeout: 9000 }).then(() => true, () => false);
    ok(autoOk, 'training: auto-validation après silence et note affichée');
    ok(await page.evaluate(() => (window.__lastAnswer || '').startsWith('J’ai piloté')), 'training: réponse reconnue transmise à trainingFeedback');
    await shot(page, 'training-feedback');
    await page.click('[data-act="next"]');
    await wait(700);
    await page.click('[data-act="toggle-input"]');
    await page.fill('.tr-text', 'Je prends du recul, j’analyse les écarts et je propose un plan.');
    await shot(page, 'training-text', false);
    await page.keyboard.press('Control+Enter');
    await wait(900);
    ok(await page.locator('.tr-result').count() === 1, 'training: réponse écrite + Ctrl+Entrée');
    await page.click('[data-act="finish"]');
    await wait(400);
    ok(await page.evaluate(() => { const s = window.__dossiers.get('d1').sessions.filter((x) => x.kind === 'training'); const last = s[s.length - 1]; return last.scores.length === 2 && !!last.endedAt; }), 'training: session sauvegardée (2 notes, terminée)');
    await shot(page, 'training-summary');
    await page.close();
    const m = await newPage({ viewport: { width: 390, height: 844 }, dark: true });
    await m.goto(`${BASE}?nokey#/training/d1`);
    await wait(500);
    await shot(m, 'training-nokey-mobile-dark');
    await m.click('[data-act="start"]');
    await wait(400 + 1500);
    await shot(m, 'training-mobile-question', false);
    await m.close();
  }

  /* ---------------- Prise en main ---------------- */
  if (want('onboarding')) {
    const page = await newPage();
    await page.goto(`${BASE}?nokey#/`);
    await wait(300);
    await page.evaluate(() => window.Souffleur.app.onboarding());
    await wait(400);
    await shot(page, 'onboarding-1', false);
    await page.fill('[data-ob="key"]', 'AIzaSyFAKE-onboarding-000000000000000');
    await page.click('[data-act="verify"]');
    await wait(800);
    await shot(page, 'onboarding-1-verified', false);
    await page.click('[data-act="next"]');
    await wait(300);
    await page.click('.ob-preset[data-v="visio-casque"]');
    await shot(page, 'onboarding-2', false);
    await page.click('[data-act="next"]');
    await wait(300);
    await page.fill('[data-ob="company"]', 'Groupe Exemple');
    await page.fill('[data-ob="role"]', 'Responsable administratif et financier');
    await shot(page, 'onboarding-3', false);
    await page.click('[data-act="create"]');
    await wait(400);
    const st = await page.evaluate(() => window.Souffleur.store.settings());
    ok(st.onboarded === true && st.geminiKey.startsWith('AIza') && st.audioPreset === 'visio-casque', 'onboarding: réglages enregistrés');
    ok(/#\/dossier\//.test(await page.evaluate(() => location.hash)), 'onboarding: redirection vers le nouveau dossier');
    await page.close();
    const m = await newPage({ viewport: { width: 390, height: 844 }, dark: true });
    await m.goto(`${BASE}#/`);
    await wait(300);
    await m.evaluate(() => window.Souffleur.app.onboarding());
    await m.click('[data-act="next"]');
    await wait(300);
    await shot(m, 'onboarding-2-mobile-dark', false);
    await m.close();
  }
  /* ---------------- Intégration avec le vrai cœur (index.html + app.js + store.js), IA mockée ---------------- */
  if (want('real') && fs.existsSync(path.join(ROOT, 'src', 'js', 'app.js'))) {
    const realPage = async (opts = {}) => {
      const page = await newPage(opts);
      await page.route(/generativelanguage\.googleapis\.com|api\.anthropic\.com|cdn\.jsdelivr\.net/, (r) => r.abort());
      await page.addInitScript({ path: path.join(ROOT, 'tests', 'screens-fakes.js') });
      await page.addInitScript(() => {
        if (!localStorage.getItem('souffleur.settings')) {
          localStorage.setItem('souffleur.settings', JSON.stringify({ onboarded: true, geminiKey: 'AIzaSyFAKE-real-000000000000000000000' }));
        }
      });
      return page;
    };
    const mockAI = () => {
      const S = window.Souffleur;
      const sl = (ms) => new Promise((r) => setTimeout(r, ms));
      S.ai.test = async () => { await sl(300); return [{ provider: 'gemini', model: 'gemini-3-flash-preview', ok: true, ms: 512, error: null }]; };
      S.ai.discover = async () => ({ gemini: ['gemini-3-flash-preview', 'gemini-2.5-flash'], claude: [] });
      S.ai.trainingNext = async (d, asked) => { await sl(300); return { question: ['Présentez-vous.', 'Quel budget avez-vous piloté ?', 'Pourquoi ce poste ?'][asked.length % 3] }; };
      S.ai.trainingFeedback = async () => { await sl(300); return { score: 8, feedback: '- ✓ Clair et structuré', better: '**Réponse améliorée.**\n- **Point** : fait', model: 'gemini-3-flash-preview' }; };
      S.ai.recap = async () => { await sl(500); return '## Synthèse\nÉchange positif.\n\n## Points forts\n- Clarté\n\n## Mail de remerciement\nBonjour Monsieur Durand,\n\nMerci pour cet échange.\n\nBien cordialement,'; };
    };
    const seed = async () => {
      const S = window.Souffleur;
      const d = await S.store.create({ name: 'RAF · Groupe Exemple', company: 'Groupe Exemple', role: 'Responsable administratif et financier', interviewer: 'Monsieur Durand' });
      d.prep = { pitch: 'Pitch', questions: [{ id: 'q1', q: 'Présentez-vous.', a: '**Moi.**', tags: [] }], askThem: [], keyFacts: [], watchouts: [], generatedAt: new Date().toISOString(), model: 'x' };
      d.sessions = [{ id: 'sx', kind: 'live', startedAt: new Date(Date.now() - 3600e3).toISOString(), endedAt: new Date(Date.now() - 1800e3).toISOString(),
        transcript: [{ t: 1000, who: 'them', text: 'Pouvez-vous vous présenter ?' }, { t: 4000, who: 'me', text: 'Je suis responsable administratif et financier.' }],
        answers: [{ t: 1500, question: 'Pouvez-vous vous présenter ?', answer: '**Moi.**', source: 'prep', model: '' }], scores: null, recap: null }];
      const saved = await S.store.save(d);
      return saved.id;
    };
    const nav = async (page, hash, ms = 700) => { await page.evaluate((h) => { location.hash = h; }, hash); await wait(ms); };

    const page = await realPage();
    await page.goto(`${REAL}#/`);
    await page.waitForFunction(() => window.Souffleur && window.Souffleur.store && document.querySelector('#view .route'), null, { timeout: 10000 });
    await wait(400);
    await page.evaluate(mockAI);
    const id = await page.evaluate(seed);

    await nav(page, '#/settings');
    ok((await page.inputValue('[data-key="geminiKey"]')).startsWith('AIza'), 'réel/settings: clé lue depuis le vrai store');
    await page.click('[data-act="test"][data-provider="gemini"]');
    await wait(600);
    ok(await page.locator('[data-status="gemini"] .pill-ok').count() === 1, 'réel/settings: test de clé');
    await page.click('[data-act="seg"][data-set="theme"][data-v="dark"]');
    await wait(200);
    ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'réel/settings: thème appliqué par le cœur');
    await shot(page, 'real-settings-dark');
    await page.click('[data-act="seg"][data-set="theme"][data-v="light"]');
    await page.fill('input[data-set="fontScale"]', '1.3');
    await page.dispatchEvent('input[data-set="fontScale"]', 'change');
    await wait(300);
    ok(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-scale').trim()) === '1.3', 'réel/settings: taille du texte appliquée');
    await shot(page, 'real-settings');

    await nav(page, '#/diag', 1500);
    await page.click('.dg-row[data-key="mic"] [data-act="row"]');
    await wait(3800);
    const micState = await page.getAttribute('.dg-row[data-key="mic"]', 'class');
    ok(/is-(ok|warn|err)/.test(micState), `réel/diag: test micro terminé (${micState})`);
    await shot(page, 'real-diag');

    await nav(page, `#/recap/${id}/sx`, 1200);
    ok(await page.locator('.rc-sec').count() >= 2, 'réel/recap: récap généré et affiché');
    ok(await page.evaluate(async (i) => !!(await window.Souffleur.store.get(i)).sessions[0].recap, id), 'réel/recap: récap sauvegardé dans IndexedDB');
    await shot(page, 'real-recap');

    await nav(page, `#/training/${id}`, 600);
    await page.click('[data-act="start"]');
    const fb = await page.waitForSelector('.tr-result', { timeout: 9000 }).then(() => true, () => false);
    ok(fb, 'réel/training: question → réponse dictée → note');
    await shot(page, 'real-training-feedback');
    await page.click('[data-act="finish"]');
    await wait(500);
    ok(await page.evaluate(async (i) => (await window.Souffleur.store.get(i)).sessions.some((s) => s.kind === 'training' && s.scores && s.scores.length === 1), id), 'réel/training: session enregistrée');
    await shot(page, 'real-training-summary');

    await page.evaluate(() => window.Souffleur.app.onboarding());
    await wait(500);
    ok(await page.locator('.sheet .ob').count() === 1, 'réel/onboarding: feuille ouverte via S.ui.sheet');
    await shot(page, 'real-onboarding-1', false);
    await page.click('.ob [data-act="next"]');
    await wait(300);
    await page.click('.ob [data-act="next"]');
    await wait(300);
    await page.fill('[data-ob="company"]', 'Société Test');
    await page.press('[data-ob="company"]', 'Enter');
    await wait(800);
    ok(/#\/dossier\//.test(await page.evaluate(() => location.hash)), 'réel/onboarding: Entrée crée le dossier et ouvre le dossier');
    await page.close();

    const m = await realPage({ viewport: { width: 390, height: 844 }, dark: true });
    await m.goto(`${REAL}#/`);
    await m.waitForFunction(() => document.querySelector('#view .route'), null, { timeout: 10000 });
    await m.evaluate(mockAI);
    const id2 = await m.evaluate(seed);
    await nav(m, '#/settings');
    await shot(m, 'real-settings-mobile');
    await nav(m, '#/diag', 1500);
    await shot(m, 'real-diag-mobile');
    await nav(m, `#/recap/${id2}/sx`, 1200);
    await shot(m, 'real-recap-mobile');
    await m.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(checks.join('\n'));
console.log(errors.length ? `\nERREURS (${errors.length}) :\n${[...new Set(errors)].join('\n')}` : '\nAucune erreur JS.');
process.exitCode = checks.some((c) => c.startsWith('FAIL')) || errors.length ? 1 : 0;
