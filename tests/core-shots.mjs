// Vérification visuelle et fonctionnelle du cœur de l'UI (app.js : Accueil, Dossier, Live) avec API mockées.
// Usage : node tests/core-shots.mjs [filtre]  → captures dans tests/shots/core-*.png, contrôles et erreurs listés en fin.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'tests', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const FILTER = process.argv[2] || '';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${server.address().port}/src/index.html`;

const exe = process.env.CHROME || path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errors = [];
const checks = [];
const ok = (cond, label) => { checks.push(`${cond ? 'OK  ' : 'FAIL'} ${label}`); };

// ---------------------------------------------------------------- données fictives
const tomorrow = new Date(Date.now() + 86400e3);
const pad = (n) => String(n).padStart(2, '0');
const DATE = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T11:00`;
const PREP = {
  pitch: '**Contrôleur de gestion depuis 8 ans, je pilote la performance financière de structures de 200 à 1 500 personnes.**\n- **Parcours** : audit chez un cabinet, puis contrôle de gestion industriel\n- **Réussite** : clôture mensuelle ramenée de J+12 à J+6\n- **Projet** : rejoindre une équipe où la fiabilité des chiffres sert les décisions',
  questions: [
    { q: 'Pouvez-vous vous présenter ?', a: '**Contrôleur de gestion depuis 8 ans, j’allie rigueur comptable et sens du pilotage.**\n- **Parcours** : 3 ans d’audit, puis 5 ans en contrôle de gestion industriel\n- **Résultat** : clôture accélérée de J+12 à J+6\n- **Motivation** : un rôle de RAF plus transverse', tags: ['pitch'] },
    { q: 'Pourquoi souhaitez-vous quitter votre poste actuel ?', a: '**Je cherche un périmètre plus large, avec la trésorerie et les RH.**\n- **Constat** : mon poste actuel est très centré sur le reporting\n- **Envie** : piloter de bout en bout\n- **Timing** : mon projet de clôture est terminé', tags: ['motivation'] },
    { q: 'Quelles sont vos prétentions salariales ?', a: '**Je vise 58 à 62 k€ bruts annuels, selon le package.**\n- **Repère** : rémunération actuelle 54 k€ + variable\n- **Ouverture** : flexible sur le télétravail et la formation', tags: ['salaire'] },
    { q: 'Parlez-moi d’une situation de conflit que vous avez gérée.', a: '**J’ai désamorcé un désaccord budgétaire entre la production et les achats.**\n- **Situation** : écart de 400 k€ sur le budget matières\n- **Action** : atelier commun, hypothèses partagées\n- **Résultat** : budget validé en 2 semaines', tags: ['comportemental'] },
    { q: 'Quelle est votre plus grande faiblesse ?', a: '**J’ai longtemps eu du mal à déléguer les contrôles.**\n- **Correction** : check-lists partagées et revue hebdomadaire\n- **Effet** : équipe plus autonome, moins de goulots', tags: ['piège'] },
    { q: 'Que savez-vous de notre groupe ?', a: '**Un acteur régional des énergies renouvelables en forte croissance.**\n- **Chiffres** : 320 M€ de CA, 1 100 salariés\n- **Enjeu** : structurer la fonction finance après deux acquisitions', tags: ['entreprise'] }
  ],
  askThem: ['Quels sont les chantiers prioritaires des six premiers mois ?', 'Comment est organisée l’équipe finance ?', 'Quels outils de reporting utilisez-vous ?'],
  keyFacts: ['CA 2025 : 320 M€ (+18 %)', '1 100 salariés, 14 sites', 'Deux acquisitions en 2024'],
  watchouts: ['Ne pas dénigrer l’employeur actuel', 'Préparer un exemple chiffré sur la trésorerie'],
  generatedAt: new Date(Date.now() - 3 * 3600e3).toISOString(),
  model: 'gemini-3-flash-preview'
};
const DOCS = [
  { kind: 'offre', name: 'Offre RAF - Hélios Énergie.pdf', text: 'Missions : piloter la clôture… Profil recherché : 8 ans d’expérience…'.repeat(40), method: 'pdfjs' },
  { kind: 'cv', name: 'CV Camille.docx', text: 'Expérience professionnelle, formation, compétences…'.repeat(50), method: 'docx' },
  { kind: 'prepa', name: 'Notes de préparation.md', text: 'Questions possibles et réponses…'.repeat(20), method: 'text' }
];

// ---------------------------------------------------------------- utilitaires page
async function newPage(o = {}) {
  const ctx = await browser.newContext({ viewport: o.viewport || { width: 1440, height: 900 }, colorScheme: o.dark ? 'dark' : 'light', deviceScaleFactor: 1, serviceWorkers: 'block', permissions: ['microphone'] });
  await ctx.route(/googleapis|anthropic|jsdelivr/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(`[console] ${m.text()}`); });
  return page;
}
async function boot(page, { key = true, seed = true, onboarded = true } = {}) {
  await page.goto(URL0 + '#/');
  await page.waitForFunction(() => window.Souffleur && Souffleur.store && document.querySelector('#view .route'));
  await page.evaluate(async ({ key, seed, onboarded, PREP, DOCS, DATE }) => {
    const S = window.Souffleur;
    S.store.setSettings({ onboarded, geminiKey: key ? 'cle-de-test' : '', rememberKeys: true });
    document.querySelectorAll('.sheet-layer').forEach((n) => n.remove());
    if (seed && !(await S.store.list()).length) {
      const mk = async (p) => { const d = await S.store.create(p); return S.store.save(d); };
      await mk({ company: 'Hélios Énergie', role: 'Responsable administratif et financier', interviewer: 'Claire Martin, DRH', date: DATE, mode: 'visio', name: 'Hélios Énergie · RAF',
        docs: DOCS.map((x, i) => Object.assign({ id: 'doc' + i, addedAt: new Date().toISOString() }, x)), prep: JSON.parse(JSON.stringify(PREP)) });
      await mk({ company: 'Banque des Territoires', role: 'Contrôleur de gestion senior', date: '', mode: 'tel', docs: DOCS.slice(0, 1).map((x) => Object.assign({ id: 'd2', addedAt: new Date().toISOString() }, x)) });
      await mk({ company: 'Atelier Lumière', role: 'Chargé de mission finance', date: '', mode: 'presentiel' });
    }
    // IA mockée
    S.ai = S.ai || {};
    S.ai.hasKey = () => !!S.store.settings().geminiKey;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    S.ai.answer = async ({ question, onDelta, signal, mode }) => {
      if (/météo/i.test(question) && mode === 'auto') { onDelta('—'); return { text: '—', provider: 'gemini', model: 'gemini-3-flash-preview', ms: 400, firstTokenMs: 300 }; }
      const text = mode === 'shorter'
        ? '**Contrôleur de gestion, 8 ans, spécialiste des clôtures rapides.**'
        : '**Contrôleur de gestion depuis 8 ans, je veux élargir mon périmètre à la trésorerie et aux RH.**\n- **Audit** : 3 ans en cabinet, rigueur et méthode\n- **Industrie** : clôture mensuelle passée de J+12 à J+6\n- **Hélios** : votre croissance externe demande une finance structurée\n- **Envie** : piloter de bout en bout, au plus près des opérationnels';
      let out = '';
      await sleep(250);
      for (const w of text.split(/(?<= )/)) {
        if (signal && signal.aborted) throw new DOMException('Annulé', 'AbortError');
        out += w; onDelta(out); await sleep(12);
      }
      return { text, provider: 'gemini', model: 'gemini-3-flash-preview', ms: 1420, firstTokenMs: 640 };
    };
    S.ai.buildPrep = async (d, { onProgress } = {}) => {
      for (let i = 1; i <= 5; i++) { onProgress && onProgress({ pct: i / 6, label: `Étape ${i} sur 5 : rédaction des réponses…` }); await sleep(300); }
      return JSON.parse(JSON.stringify(PREP));
    };
    // Audio mocké : on garde les abonnés pour pouvoir simuler des événements.
    const subs = {};
    S.audio = Object.assign(S.audio || {}, {
      on(evt, fn) { (subs[evt] = subs[evt] || new Set()).add(fn); return () => subs[evt].delete(fn); },
      start() { setTimeout(() => { window.__emit('state', { who: 'them', state: 'listening' }); window.__emit('state', { who: 'me', state: 'listening' }); }, 50); return sleep(150); },
      stop() {}, pause() {}, resume() {},
      support() { return { getUserMedia: true, getDisplayMedia: true, displayAudio: true, webSpeech: true, audioWorklet: true, wakeLock: true, docPiP: true }; }
    });
    window.__emit = (evt, data) => (subs[evt] || []).forEach((f) => f(data));
  }, { key, seed, onboarded, PREP, DOCS, DATE });
  await page.evaluate(() => Souffleur.app.refresh());
  await page.waitForTimeout(250);
}
async function layoutAudit(page, name) {
  const r = await page.evaluate(() => {
    const out = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`défilement horizontal (${document.documentElement.scrollWidth}px)`);
    document.querySelectorAll('.doc-row:not(.pending)').forEach((row) => {
      const main = row.querySelector('.doc-main').getBoundingClientRect();
      const sel = row.querySelector('.kind-select').getBoundingClientRect();
      const btns = [...row.querySelectorAll('.icon-btn')].map((b) => b.getBoundingClientRect());
      if (main.width < 140) out.push(`nom de document trop étroit (${Math.round(main.width)}px)`);
      if (btns.some((b) => Math.abs(b.top - sel.top) > 6)) out.push('boutons du document mal alignés');
    });
    document.querySelectorAll('.btn, .icon-btn').forEach((b) => {
      const s = getComputedStyle(b);
      if (b.offsetParent && b.scrollWidth > b.clientWidth + 2 && s.overflow !== 'visible') out.push(`texte coupé : ${b.textContent.trim().slice(0, 30)}`);
    });
    return out;
  });
  ok(!r.length, `${name} mise en page${r.length ? ' : ' + [...new Set(r)].join(' ; ') : ''}`);
}
async function shot(page, name) {
  await layoutAudit(page, name);
  if (FILTER && !name.includes(FILTER)) return;
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(SHOTS, `core-${name}.png`) });
}
async function go(page, hash) {
  await page.evaluate((h) => Souffleur.app.go(h), hash);
  await page.waitForTimeout(400);
}
async function firstId(page) { return page.evaluate(async () => (await Souffleur.store.list()).find((d) => d.company === 'Hélios Énergie').id); }

// ---------------------------------------------------------------- scénarios
async function homeAndDossier(dark, mobile) {
  const tag = `${mobile ? 'mobile' : 'desktop'}-${dark ? 'dark' : 'light'}`;
  const page = await newPage({ dark, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
  // Accueil vide
  await boot(page, { key: false, seed: false });
  await shot(page, `home-empty-${tag}`);
  ok(await page.locator('.empty-home').count() === 1, `${tag} accueil vide affiché`);
  // Avec données
  await boot(page, { key: true, seed: true });
  await go(page, '#/');
  await shot(page, `home-${tag}`);
  ok(await page.locator('.dcard').count() === 3, `${tag} 3 cartes dossiers`);
  ok(await page.locator('.hero').count() === 1, `${tag} carte « Prochain entretien »`);
  // Dossier
  const id = await firstId(page);
  await go(page, '#/dossier/' + id);
  await shot(page, `dossier-${tag}`);
  ok(await page.locator('.doc-row').count() === 3, `${tag} 3 documents listés`);
  ok(await page.locator('details.qa').count() === 6, `${tag} 6 questions préparées`);
  if (!mobile) {
    await page.locator('details.qa').first().locator('summary').click();
    await page.evaluate(() => document.querySelector('.prep-card').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(200);
    await shot(page, `dossier-prep-open-${tag}`);
  } else {
    await page.evaluate(() => window.scrollTo(0, 900));
    await shot(page, `dossier-scrolled-${tag}`);
  }
  // Live : pré-vol
  await go(page, '#/live/' + id);
  await page.waitForTimeout(500);
  await shot(page, `live-setup-${tag}`);
  // Live : démarrage + simulation d'un appel
  await page.click('[data-act="start"]');
  await page.waitForSelector('.live-bar');
  await page.evaluate(() => {
    const e = window.__emit;
    e('level', { who: 'them', rms: 0.7 }); e('level', { who: 'me', rms: 0.45 });
    e('final', { who: 'them', text: 'Bonjour et merci d’être avec nous aujourd’hui.' });
    e('final', { who: 'me', text: 'Bonjour, merci à vous pour cette invitation.' });
    e('speech', { who: 'them', active: true });
    e('final', { who: 'them', text: 'Pour commencer, pouvez-vous vous présenter ?' });
    e('speech', { who: 'them', active: false });
  });
  await page.waitForTimeout(2600);
  const n1 = await page.evaluate(() => document.querySelector('[data-v="count"]').textContent);
  ok(/2\/2/.test(n1), `${tag} réponse préparée puis IA (compteur ${n1})`);
  await page.evaluate(() => { window.__emit('interim', { who: 'them', text: '…' }); window.__emit('level', { who: 'them', rms: 0.8 }); window.__emit('speech', { who: 'them', active: true }); });
  await shot(page, `live-${tag}`);
  // Question hors sujet : l'IA répond « — » → affichage conservé
  await page.evaluate(() => { window.__emit('speech', { who: 'them', active: false }); window.__emit('final', { who: 'them', text: 'Il fait beau, la météo est clémente.' }); });
  await page.waitForTimeout(2000);
  const n2 = await page.evaluate(() => document.querySelector('[data-v="count"]').textContent);
  ok(/2\/2/.test(n2), `${tag} « — » en auto : affichage conservé (${n2})`);
  if (!mobile) {
    await page.keyboard.press('c');
    await page.waitForTimeout(900);
    const n3 = await page.evaluate(() => document.querySelector('[data-v="count"]').textContent);
    ok(/3\/3/.test(n3), `${tag} raccourci C (plus court) → ${n3}`);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(150);
    ok(/2\/3/.test(await page.evaluate(() => document.querySelector('[data-v="count"]').textContent)), `${tag} flèche gauche → historique`);
    await page.keyboard.press('?');
    await page.waitForTimeout(400);
    await shot(page, `live-help-${tag}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // Fenêtre flottante : Document PiP si disponible, sinon popup de repli
    const [pip] = await Promise.all([page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null), page.click('[data-act="pip"]')]);
    if (pip) {
      await pip.waitForTimeout(700);
      try { await pip.setViewportSize({ width: 420, height: 560 }); } catch (e) { /* PiP : taille imposée */ }
      await pip.waitForTimeout(300);
      if (!FILTER || 'pip'.includes(FILTER) || `live-pip-${tag}`.includes(FILTER)) await pip.screenshot({ path: path.join(SHOTS, `core-live-pip-${tag}.png`) });
      ok(await pip.locator('.pip-answer').count() === 1, `${tag} fenêtre flottante ouverte (${await pip.evaluate(() => document.title)})`);
      await page.click('[data-act="pip"]');
      await page.waitForTimeout(300);
      ok(pip.isClosed(), `${tag} fenêtre flottante refermée`);
    } else ok(false, `${tag} fenêtre flottante non ouverte`);
    await page.fill('[data-b="askin"]', 'Quelles sont vos prétentions salariales ?');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await shot(page, `live-typed-${tag}`);
  }
  // Sauvegarde continue
  await page.waitForTimeout(3300);
  const saved = await page.evaluate(async (id) => { const d = await Souffleur.store.get(id); const s = d.sessions[d.sessions.length - 1]; return { tr: s.transcript.length, an: s.answers.length, ended: !!s.endedAt }; }, id);
  ok(saved.tr >= 4 && saved.an >= 2 && !saved.ended, `${tag} session sauvegardée (${saved.tr} répliques, ${saved.an} réponses)`);
  // Terminer → récap
  await page.click('[data-act="end"]');
  await page.waitForTimeout(450);
  await shot(page, `live-end-confirm-${tag}`);
  await page.click('.sheet .btn-danger');
  await page.waitForTimeout(600);
  ok(/#\/recap\//.test(page.url()), `${tag} fin de session → récap (${page.url().split('#')[1]})`);
  await page.context().close();
}

async function sheetsAndExport() {
  const page = await newPage({});
  await boot(page, {});
  await page.click('[data-act="new"]');
  await page.waitForTimeout(450);
  await shot(page, 'sheet-new-desktop-light');
  await page.fill('#nd-company', 'Société Test');
  await page.fill('#nd-role', 'Analyste financier');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  ok(/#\/dossier\//.test(page.url()), 'création via la feuille « Nouvel entretien » + Entrée');
  // Dossier vide : préparation par IA
  await shot(page, 'dossier-empty-desktop-light');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['Missions : piloter la clôture. Profil recherché : 5 ans. Poste basé à Lyon.'], 'offre.txt', { type: 'text/plain' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await page.waitForTimeout(700);
  ok(await page.locator('.doc-row:not(.pending)').count() === 1, 'Ctrl+V d’un fichier → document ajouté');
  await page.click('[data-pact="gen"]');
  await page.waitForTimeout(250);
  await shot(page, 'dossier-generating-desktop-light');
  await page.waitForTimeout(1800);
  ok(await page.locator('details.qa').count() === 6, 'préparation IA mockée → 6 questions');
  // Export
  await page.click('[data-act="export"]');
  await page.waitForTimeout(450);
  await shot(page, 'sheet-export-desktop-light');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-x="html"]')]);
  const file = path.join(SHOTS, '..', 'tmp-export.html');
  await dl.saveAs(file);
  const html = fs.readFileSync(file, 'utf8');
  ok(/id="souffleur-embedded"/.test(html) && /souffleur-single/.test(html) && !/<script src=/.test(html), `export HTML autonome (${Math.round(html.length / 1024)} Ko, scripts inlinés, dossier intégré)`);
  // Ouverture du fichier exporté dans un navigateur vierge (file://)
  const p2 = await newPage({});
  await p2.goto('file:///' + file.replace(/\\/g, '/'));
  await p2.waitForTimeout(1500);
  const embedded = await p2.evaluate(async () => (await Souffleur.store.list()).map((d) => d.company));
  ok(embedded.includes('Société Test'), `fichier exporté ouvert en file:// → dossier importé (${embedded.join(', ')})`);
  await shot(p2, 'export-opened-file');
  await p2.reload();
  await p2.waitForTimeout(1200);
  const again = await p2.evaluate(async () => (await Souffleur.store.list()).length);
  ok(again === 1, `rechargement du fichier exporté : pas de doublon (${again})`);
  // Ré-export depuis le fichier unique (source = HTML d'origine mémorisé au démarrage)
  await p2.evaluate(() => document.querySelectorAll('.sheet-layer').forEach((n) => n.remove()));
  await p2.evaluate(async () => { const d = (await Souffleur.store.list())[0]; Souffleur.app.go('#/dossier/' + d.id); });
  await p2.waitForTimeout(600);
  await p2.click('[data-act="export"]');
  await p2.waitForTimeout(400);
  const [dl2] = await Promise.all([p2.waitForEvent('download'), p2.click('[data-x="html"]')]);
  const file2 = path.join(SHOTS, '..', 'tmp-export2.html');
  await dl2.saveAs(file2);
  const html2 = fs.readFileSync(file2, 'utf8');
  ok((html2.match(/id="souffleur-embedded"/g) || []).length === 1 && (html2.match(/class="sheet-layer/g) || []).length === (html.match(/class="sheet-layer/g) || []).length && /<main id="view" class="view" tabindex="-1"><\/main>/.test(html2), `ré-export depuis le fichier unique (${Math.round(html2.length / 1024)} Ko, un seul dossier intégré, page vierge)`);
  if (!process.env.KEEP) fs.rmSync(file2, { force: true });
  await p2.context().close();
  fs.rmSync(file, { force: true });
  // Suppression via feuille de confirmation
  await page.click('[data-act="delete"]');
  await page.waitForTimeout(400);
  await shot(page, 'sheet-confirm-desktop-dark-check');
  await page.click('.sheet .btn-danger');
  await page.waitForTimeout(500);
  ok((await page.evaluate(async () => (await Souffleur.store.list()).length)) === 3, 'suppression du dossier confirmée');
  await page.context().close();
}

async function mobileSheet() {
  const page = await newPage({ viewport: { width: 390, height: 844 }, dark: true });
  await boot(page, {});
  await page.click('[data-act="new"]');
  await page.waitForTimeout(600);
  await shot(page, 'sheet-new-mobile-dark');
  await page.context().close();
}

async function misc() {
  // Sans clé, mode haut-parleur : réponses préparées uniquement
  const page = await newPage({ dark: false });
  await boot(page, { key: false, seed: true });
  const id = await firstId(page);
  await go(page, '#/live/' + id);
  await page.click('[data-preset="haut-parleur"]');
  await page.click('[data-act="start"]');
  await page.waitForSelector('.live-bar');
  await page.evaluate(() => {
    window.__emit('state', { who: 'mixed', state: 'listening' });
    window.__emit('level', { who: 'mixed', rms: 0.6 });
    window.__emit('final', { who: 'mixed', text: 'Bonjour, installez-vous.' });
    window.__emit('final', { who: 'mixed', text: 'Quelle est votre plus grande faiblesse ?' });
  });
  await page.waitForTimeout(1600);
  const c = await page.evaluate(() => ({ n: document.querySelector('[data-v="count"]').textContent, ai: document.querySelector('[data-b="ai"]').textContent }));
  ok(c.n === '1/1' && /Sans IA/.test(c.ai), `sans clé : réponse préparée seule (${c.n}, ${c.ai})`);
  await shot(page, 'live-nokey-desktop-light');
  // Hors ligne + bandeau de mise à jour
  await page.evaluate(() => { document.querySelector('[data-act="end"]'); });
  await page.context().setOffline(true);
  await page.waitForTimeout(300);
  await shot(page, 'live-offline-desktop-light');
  await page.context().setOffline(false);
  await page.context().close();
  const p2 = await newPage({ dark: true, viewport: { width: 390, height: 844 } });
  await boot(p2, {});
  await p2.evaluate(() => Souffleur.app.showUpdate());
  await p2.context().setOffline(true);
  await p2.waitForTimeout(500);
  await shot(p2, 'home-update-offline-mobile-dark');
  ok(await p2.locator('#netpill:not([hidden])').count() === 1, 'pastille « Hors ligne » visible');
  await p2.context().close();
}

try {
  await misc();
  await homeAndDossier(false, false);
  await homeAndDossier(true, false);
  await homeAndDossier(false, true);
  await homeAndDossier(true, true);
  await sheetsAndExport();
  await mobileSheet();
} catch (e) {
  errors.push('[script] ' + (e.stack || e.message));
}
await browser.close();
server.close();
console.log(checks.join('\n'));
console.log(errors.length ? '\nErreurs :\n' + [...new Set(errors)].join('\n') : '\nAucune erreur JS.');
process.exit(checks.some((c) => c.startsWith('FAIL')) || errors.length ? 1 : 0);
