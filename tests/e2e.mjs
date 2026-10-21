#!/usr/bin/env node
// Souffleur — tests de bout en bout dans Chromium (playwright-core), sans framework.
//   node tests/e2e.mjs [filtre] [--headed] [--keep]
// API Gemini / Claude mockées (page.route : liste des modèles, generateContent, streamGenerateContent SSE, messages),
// fausse reconnaissance vocale pilotable, faux micro alimenté par un WAV de parole française (voix Windows),
// partage d'onglet simulé. Vérifie aussi le fichier unique dist/site/souffleur.html en file:// et le garde-fou
// anti-secrets du build. Aucune requête ne sort de la machine (hors téléchargement initial de pdf.js en cache).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { startServer } from '../tools/serve.mjs';
import {
  ROOT, SHOTS, FIXTURES, sleep, createMock, ensurePdfJs, ensureSpeechWav, launchBrowser, newContext, watchErrors, tmpDir,
  GEMINI_KEY, CLAUDE_KEY, QUESTION_FR, ANSWER_MARK, CLAUDE_MARK, PREP, TRAINING_Q
} from './e2e-lib.mjs';

const argv = process.argv.slice(2);
const HEADED = argv.includes('--headed');
const KEEP = argv.includes('--keep');
const FILTER = argv.filter((a) => !a.startsWith('--')).join(' ').toLowerCase();
const T_START = Date.now();

/* ------------------------------------------------------------------ mini-runner */

const results = [];
const errors = [];
let currentTest = '(démarrage)';
let activePage = null;
const state = {};

class Fail extends Error {}
const assert = (cond, msg) => { if (!cond) throw new Fail(msg); };

async function test(name, fn, { requires = [] } = {}) {
  if (FILTER && !name.toLowerCase().includes(FILTER) && !requires.some((r) => FILTER.includes(r))) {
    // Les étapes préalables (requires) tournent quand même si le filtre vise une étape qui en dépend.
    if (!FILTER_DEPS.has(name)) return;
  }
  currentTest = name;
  const t0 = Date.now();
  process.stdout.write(`  … ${name}\r`);
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: e });
    console.log(`  ✗ ${name}\n      ${String(e && e.message || e).split('\n').join('\n      ')}`);
    if (!(e instanceof Fail) && e && e.stack) console.log('      ' + e.stack.split('\n').slice(1, 4).join('\n      '));
    if (activePage && !activePage.isClosed()) {
      const file = path.join(SHOTS, `e2e-fail-${name.replace(/[^\w]+/g, '-').slice(0, 60)}.png`);
      await activePage.screenshot({ path: file }).catch(() => {});
    }
  }
  currentTest = '(entre deux tests)';
}
// Étapes dont d'autres dépendent (création du dossier, documents, prépa) : toujours exécutées.
const FILTER_DEPS = new Set(['prise en main (onboarding 3 étapes)', 'import de documents (DOCX, TXT, PDF, texte collé)', 'préparation par l’IA (JSON mocké, streaming)']);

const sinkError = (msg) => errors.push({ test: currentTest, msg });

/* ------------------------------------------------------------------ helpers page */

let navSeq = 0;
async function gotoApp(page, base, hash) {
  // Un paramètre de requête différent force un vrai rechargement (état IA, audio, etc. remis à zéro).
  const sep = base.includes('?') ? '&' : '?';
  await page.goto(`${base}${base.startsWith('file:') ? '' : `${sep}n=${++navSeq}`}${hash || '#/'}`);
  await page.waitForFunction(() => window.Souffleur && Souffleur.app && Souffleur.store && document.querySelector('#view .route'), null, { timeout: 15000 });
  await closeOnboarding(page);
}

async function closeOnboarding(page) {
  await page.evaluate(() => document.querySelectorAll('.sheet-layer').forEach((n) => n.remove()));
}

async function waitHash(page, re, timeout = 10000) {
  await page.waitForFunction((src) => new RegExp(src).test(location.hash), re.source, { timeout });
  return page.evaluate(() => location.hash);
}

async function toastText(page) {
  return page.$$eval('#toasts .toast .toast-msg', (n) => n.map((x) => x.textContent));
}

async function expectToast(page, re, timeout = 8000) {
  try {
    await page.waitForFunction((src) => Array.from(document.querySelectorAll('#toasts .toast .toast-msg')).some((n) => new RegExp(src).test(n.textContent)), re.source, { timeout });
  } catch (e) {
    throw new Fail(`toast attendu ${re} ; toasts visibles : ${JSON.stringify(await toastText(page))}`);
  }
}

async function answerState(page) {
  return page.evaluate(() => {
    const t = document.querySelector('.live [data-v="text"]');
    const b = document.querySelector('.live [data-v="meta"] .src-badge');
    return {
      text: t ? t.textContent : '', streaming: !!(t && t.classList.contains('streaming')),
      badge: b ? (b.textContent.trim() + (b.title ? ' ' + b.title : '')) : '', source: b ? (b.classList.contains('src-prep') ? 'prep' : b.classList.contains('src-ai') ? 'ai' : 'info') : '',
      count: (document.querySelector('.live [data-v="count"]') || {}).textContent || ''
    };
  });
}

async function waitAnswer(page, pred, label, timeout = 15000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    last = await answerState(page);
    if (pred(last)) return last;
    await sleep(80);
  }
  throw new Fail(`${label} : non obtenu en ${timeout} ms ; carte réponse = ${JSON.stringify(last)}`);
}

async function startManualLive(page, base, id) {
  await gotoApp(page, base, `#/live/${id}`);
  await page.click('[data-act="manual"]');
  await page.waitForSelector('.live [data-b="askin"]');
}

async function ask(page, q) {
  await page.fill('.live [data-b="askin"]', q);
  await page.press('.live [data-b="askin"]', 'Enter');
}

async function leaveLive(page) {
  // Quitter un entretien en cours demande confirmation (canLeave) : on confirme.
  await page.evaluate(() => Souffleur.app.go('#/'));
  const confirm = await page.waitForSelector('.sheet-confirm .btn-danger', { timeout: 3000 }).catch(() => null);
  if (confirm) await confirm.click();
  await page.waitForFunction(() => document.body.dataset.route === 'home', null, { timeout: 5000 });
}

async function getDossier(page, id) {
  return page.evaluate((x) => Souffleur.store.get(x), id);
}

function tomorrowAt(h) {
  const d = new Date(Date.now() + 86400e3);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(h)}:00`;
}

const OFFRE_TEXT = `Responsable administratif et financier (H/F) — Hélios Énergie
Missions : piloter la clôture mensuelle et annuelle, superviser la trésorerie, produire le reporting mensuel pour la direction.
Profil recherché : 8 ans d’expérience minimum en contrôle de gestion ou en audit, maîtrise d’un ERP, sens du dialogue avec les opérationnels.
Poste basé à Lyon, télétravail partiel.`;

/* ------------------------------------------------------------------ préparation */

console.log('\nSouffleur — tests de bout en bout\n');
const wav = ensureSpeechWav();
const pdfReady = await ensurePdfJs();
console.log(`  faux micro : ${path.relative(ROOT, wav.file)} (${wav.kind === 'tts' ? 'voix française Windows' : 'signal synthétique'}) · pdf.js ${pdfReady ? 'en cache' : 'indisponible (repli IA mocké)'}`);

const build = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build.mjs'), '--strict'], { cwd: ROOT, encoding: 'utf8' });
const DIST = path.join(ROOT, 'dist', 'site', 'souffleur.html');
console.log(`  build --strict : ${build.status === 0 ? 'OK' : 'ÉCHEC'}\n`);

const srv = await startServer({ port: 0, dir: 'src', quiet: true });
const BASE = `${srv.url}index.html`;
const browser = await launchBrowser({ wav: wav.file, headed: HEADED });
const mock = createMock();
const ctx = await newContext(browser, mock);
watchErrors(ctx, sinkError);
const page = await ctx.newPage();
activePage = page;
const OUT = tmpDir('e2e');

/* ------------------------------------------------------------------ scénarios */

await test('prise en main (onboarding 3 étapes)', async () => {
  await page.goto(BASE);
  await page.waitForSelector('.ob-sheet .ob-step [data-ob="key"]', { timeout: 15000 });
  await page.fill('[data-ob="key"]', GEMINI_KEY);
  await page.click('.ob-step [data-act="verify"]');
  await page.waitForSelector('.ob-status .pill-ok', { timeout: 15000 });
  assert(mock.count((x) => x.kind === 'ping' && x.status === 200) >= 1, 'le bouton Vérifier doit appeler l’IA (ping)');
  await page.click('.ob-foot [data-act="next"]');
  await page.click('[data-act="preset"][data-v="haut-parleur"]');
  await page.click('.ob-foot [data-act="next"]');
  await page.fill('[data-ob="company"]', 'Hélios Énergie');
  await page.fill('[data-ob="role"]', 'Responsable administratif et financier');
  await page.fill('[data-ob="date"]', tomorrowAt(11));
  await page.selectOption('[data-ob="mode"]', 'visio');
  await page.click('.ob-foot [data-act="create"]');
  const hash = await waitHash(page, /^#\/dossier\/[^/]+$/);
  state.d1 = decodeURIComponent(hash.split('/')[2]);
  await page.waitForSelector('.screen.dossier [data-b="company"]');
  assert((await page.textContent('[data-b="company"]')).includes('Hélios Énergie'), 'titre du dossier');
  assert((await page.textContent('[data-b="meta"]')).includes('demain 11:00'), 'date relative « demain 11:00 »');
  const s = await page.evaluate(() => Souffleur.store.settings());
  assert(s.onboarded === true, 'onboarded');
  assert(s.geminiKey === GEMINI_KEY, 'clé Gemini enregistrée');
  assert(s.audioPreset === 'haut-parleur', `mode audio mémorisé (${s.audioPreset})`);
  assert(await page.$('.sheet-layer:not(.out) .ob-sheet') === null, 'la feuille de prise en main est fermée');
});

await test('création de dossier depuis l’accueil', async () => {
  await gotoApp(page, BASE, '#/');
  await page.click('.section-head [data-act="new"]');
  await page.fill('#nd-company', 'Banque des Territoires');
  await page.fill('#nd-role', 'Contrôleur de gestion senior');
  await page.click('.sheet [data-mode] button[data-v="tel"]');
  await page.click('.sheet-actions .btn-primary');
  const hash = await waitHash(page, /^#\/dossier\/[^/]+$/);
  state.d2 = decodeURIComponent(hash.split('/')[2]);
  assert(state.d2 !== state.d1, 'nouvel identifiant');
  const d = await getDossier(page, state.d2);
  assert(d && d.company === 'Banque des Territoires' && d.mode === 'tel', `dossier enregistré : ${JSON.stringify(d && { c: d.company, m: d.mode })}`);
  await gotoApp(page, BASE, '#/');
  const n = await page.$$eval('.dgrid .dcard', (x) => x.length);
  assert(n === 2, `2 cartes de dossier sur l’accueil (${n})`);
  assert(await page.$('.hero') !== null, 'le prochain entretien (demain) est mis en avant');
});

await test('synchronisation entre onglets (accueil rafraîchi)', async () => {
  await gotoApp(page, BASE, '#/');
  const other = await ctx.newPage();
  try {
    await other.goto(`${BASE}#/`);
    await other.waitForFunction(() => window.Souffleur && Souffleur.store && document.querySelector('#view .route'));
    const n0 = await page.$$eval('.dgrid .dcard', (x) => x.length);
    const id = await other.evaluate(async () => (await Souffleur.store.create({ company: 'Onglet voisin', role: 'Test' })).id);
    await page.waitForFunction((n) => document.querySelectorAll('.dgrid .dcard').length === n + 1, n0, { timeout: 5000 });
    await other.evaluate((x) => Souffleur.store.remove(x), id);
    await page.waitForFunction((n) => document.querySelectorAll('.dgrid .dcard').length === n, n0, { timeout: 5000 });
  } finally { await other.close(); }
});

await test('import de documents (DOCX, TXT, PDF, texte collé)', async () => {
  await gotoApp(page, BASE, `#/dossier/${state.d1}`);
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="pick"]')]);
  await fc.setFiles(['sample.docx', 'sample.txt', 'sample.pdf'].map((f) => path.join(FIXTURES, f)));
  await page.waitForFunction(() => document.querySelectorAll('.doc-row:not(.pending)').length >= 3 && !document.querySelector('.doc-row.pending'), null, { timeout: 40000 });
  const metas = await page.$$eval('.doc-row .doc-meta', (n) => n.map((x) => x.textContent));
  assert(metas.some((m) => /Word/.test(m)), `DOCX lu (méthode Word) : ${metas}`);
  assert(metas.some((m) => /PDF|lu par l’IA/.test(m)), `PDF lu : ${metas}`);
  assert(metas.some((m) => /texte/.test(m)), `TXT lu : ${metas}`);
  if (pdfReady) assert(metas.some((m) => /PDF/.test(m)), `PDF lu par pdf.js (cache local) : ${metas}`);
  await page.click('[data-act="paste"]');
  await page.fill('#ps-text', OFFRE_TEXT);
  await page.fill('#ps-name', 'Offre RAF Hélios');
  await page.click('.sheet-actions .btn-primary');
  await page.waitForFunction(() => document.querySelectorAll('.doc-row:not(.pending)').length >= 4, null, { timeout: 5000 });
  await sleep(900); // enregistrement différé (650 ms)
  const d = await getDossier(page, state.d1);
  const kinds = d.docs.map((x) => `${x.name}=${x.kind}`);
  assert(d.docs.length === 4, `4 documents enregistrés (${kinds})`);
  assert(d.docs.find((x) => x.name === 'Offre RAF Hélios').kind === 'offre', `texte collé détecté comme offre (${kinds})`);
  assert(d.docs.every((x) => x.text && x.text.length > 20), 'textes extraits non vides');
});

await test('préparation par l’IA (JSON mocké, streaming)', async () => {
  mock.reset();
  await gotoApp(page, BASE, `#/dossier/${state.d1}`);
  await page.click('[data-pact="gen"]');
  await page.waitForSelector('.qa-list details.qa', { timeout: 30000 });
  const n = await page.$$eval('.qa-list details.qa', (x) => x.length);
  assert(n === PREP.questions.length, `${PREP.questions.length} questions affichées (${n})`);
  const req = mock.log.find((x) => x.kind === 'prep');
  assert(req && req.stream && req.json, `requête de prépa en streaming JSON : ${JSON.stringify(req)}`);
  await expectToast(page, /Préparation prête/);
  const d = await getDossier(page, state.d1);
  assert(d.prep && d.prep.questions.length === PREP.questions.length && d.prep.questions.every((q) => q.id), 'prépa enregistrée avec des ids');
  assert(d.prep.askThem.length === 3 && d.prep.pitch.length > 50, 'pitch et questions à poser');
  // Éditer une réponse : clic sur l'aperçu, saisie, enregistrement.
  await page.click('.qa-list details.qa:first-child summary');
  await page.fill('.qa-list details.qa:first-child input[data-k="q"]', 'Pouvez-vous vous présenter en une minute ?');
  await sleep(900);
  const d2 = await getDossier(page, state.d1);
  assert(d2.prep.questions[0].q === 'Pouvez-vous vous présenter en une minute ?', 'modification de question enregistrée');
});

await test('live « haut-parleur » : réponse préparée instantanée puis IA en streaming', async () => {
  mock.reset();
  mock.delays.answer = 1600;
  await gotoApp(page, BASE, `#/live/${state.d1}`);
  await page.click('[data-preset="haut-parleur"]');
  await page.click('[data-act="start"]');
  await page.waitForSelector('.live [data-src="mixed"][data-state="listening"]', { timeout: 8000, state: 'attached' });
  assert(await page.evaluate(() => window.__sr.active.size) >= 1, 'reconnaissance vocale démarrée');
  const t0 = Date.now();
  await page.evaluate((q) => window.__sr.say(q), QUESTION_FR);
  const prep = await waitAnswer(page, (a) => a.source === 'prep', 'réponse préparée', 5000);
  const tPrep = Date.now() - t0;
  assert(/croissance demande une fonction finance/.test(prep.text), `texte de la réponse préparée : ${prep.text.slice(0, 80)}`);
  assert(mock.count((x) => x.kind === 'answer') <= 1, 'la réponse préparée s’affiche avant la réponse IA');
  const ai = await waitAnswer(page, (a) => a.source === 'ai' && a.text.includes(ANSWER_MARK) && !a.streaming, 'réponse IA', 15000);
  const req = mock.log.find((x) => x.kind === 'answer');
  assert(req && req.stream && req.provider === 'gemini', `réponse IA en streaming SSE : ${JSON.stringify(req)}`);
  assert(/IA · .*gemini/.test(ai.badge), `badge IA avec le modèle : ${ai.badge}`);
  assert(ai.count === '2/2', `historique : préparée + IA (${ai.count})`);
  const tl = await page.$$eval('.transcript .tl-mixed .tl-bubble', (n) => n.map((x) => x.textContent));
  assert(tl.some((t) => t.includes('rejoindre notre entreprise')), `transcription « Voix » : ${tl}`);
  assert(await page.$('.answer .prep-peek') !== null, 'la réponse préparée reste consultable sous la réponse IA');
  // Navigation dans l'historique (←) et raccourci Espace.
  await page.keyboard.press('ArrowLeft');
  assert((await answerState(page)).source === 'prep', 'flèche gauche : réponse précédente');
  await page.keyboard.press('ArrowRight');
  console.log(`      réponse préparée affichée en ${tPrep} ms après la fin de la question`);
});

await test('fenêtre flottante (Document PiP ou repli pop-up)', async () => {
  const before = ctx.pages().length;
  await page.click('.live [data-act="pip"]');
  let kind = null;
  let popup = null;
  for (let i = 0; i < 60 && !kind; i++) {
    await sleep(100);
    if (await page.evaluate(() => !!(window.documentPictureInPicture && documentPictureInPicture.window && documentPictureInPicture.window.document.querySelector('.pip [data-p="text"]')))) kind = 'pip';
    else if (ctx.pages().length > before) { popup = ctx.pages()[ctx.pages().length - 1]; kind = 'popup'; }
  }
  assert(kind, 'ni fenêtre Document PiP ni pop-up ouverte');
  const readPip = () => (kind === 'pip'
    ? page.evaluate(() => documentPictureInPicture.window.document.querySelector('[data-p="text"]').textContent)
    : popup.evaluate(() => (document.querySelector('[data-p="text"]') || {}).textContent || ''));
  if (popup) await popup.waitForSelector('.pip [data-p="text"]', { timeout: 5000 });
  assert((await readPip()).includes(ANSWER_MARK), 'la fenêtre flottante affiche la réponse courante');
  // Synchronisation : une nouvelle question met à jour la fenêtre flottante.
  await page.evaluate(() => window.__sr.say('Quelles sont vos prétentions salariales ?'));
  const t0 = Date.now();
  let txt = '';
  while (Date.now() - t0 < 6000 && !/58 à 62/.test(txt)) { await sleep(100); txt = await readPip(); }
  assert(/58 à 62/.test(txt), `fenêtre flottante synchronisée : ${txt.slice(0, 80)}`);
  const styled = kind === 'pip'
    ? await page.evaluate(() => documentPictureInPicture.window.document.querySelectorAll('style, link[rel=stylesheet]').length)
    : await popup.evaluate(() => document.querySelectorAll('style, link[rel=stylesheet]').length);
  assert(styled >= 2, 'feuilles de style copiées dans la fenêtre flottante');
  await page.click('.live [data-act="pip"]');
  await sleep(300);
  console.log(`      mode : ${kind === 'pip' ? 'Document Picture-in-Picture' : 'pop-up de repli'}`);
});

await test('fin de session → récap IA (mail de remerciement)', async () => {
  mock.reset();
  await page.click('.live [data-act="end"]');
  await page.click('.sheet-confirm .btn-danger');
  const hash = await waitHash(page, /^#\/recap\/[^/]+\/[^/]+$/);
  state.liveSession = decodeURIComponent(hash.split('/')[3]);
  await page.waitForSelector('.rc-sec.rc-mail', { timeout: 15000 });
  const titles = await page.$$eval('.rc-sec .rc-sec-head .h3', (n) => n.map((x) => x.textContent));
  assert(['Synthèse', 'Questions posées', 'Points forts', 'À améliorer', 'À relancer', 'Mail de remerciement'].every((t) => titles.includes(t)), `sections du récap : ${titles}`);
  assert(await page.$('.rc-actions [data-act="copy-mail"]') !== null, 'bouton « Copier le mail de remerciement »');
  assert(mock.count((x) => x.kind === 'recap' && x.stream) === 1, 'un appel IA de récap (streaming)');
  await page.click('.rc-actions [data-act="copy-mail"]');
  await expectToast(page, /copié/i);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert(/^Objet : Merci pour notre échange/.test(clip.trim()), `mail copié : ${clip.slice(0, 60)}`);
  await sleep(300);
  const d = await getDossier(page, state.d1);
  const s = d.sessions.find((x) => x.id === state.liveSession);
  assert(s && s.endedAt && s.recap && s.recap.includes('## Synthèse'), 'session terminée, récap enregistré');
  assert(s.transcript.length >= 2 && s.answers.length >= 3, `transcription et réponses enregistrées (${s.transcript.length} / ${s.answers.length})`);
});

await test('live {them:"mic", themEngine:"cloud"} : VAD + transcription mockée → réponse', async () => {
  mock.reset();
  mock.delays.answer = 300;
  await gotoApp(page, BASE, '#/');
  // Configuration personnalisée (hors préréglages) : l'app la transmet telle quelle à S.audio.start.
  await page.evaluate(() => {
    const P = Souffleur.audio.presets;
    if (!P.some((p) => p.id === 'e2e-them-mic')) Souffleur.audio.presets = P.concat([{ id: 'e2e-them-mic', label: 'Test : recruteur au micro, transcription IA', them: 'mic', themEngine: 'cloud', me: null, needsKey: true }]);
  });
  await page.evaluate((id) => Souffleur.app.go('#/live/' + id), state.d1);
  await page.click('[data-preset="e2e-them-mic"]');
  await page.click('[data-act="start"]');
  await page.waitForSelector('.live [data-src="them"]', { timeout: 8000, state: 'attached' });
  assert(await page.$('.live [data-src="me"]') === null, 'une seule source affichée quand seule la voix du recruteur est captée');
  await page.waitForSelector('.transcript .tl-them:not(.tl-interim)', { timeout: 30000, state: 'attached' });
  const tr = mock.log.filter((x) => x.kind === 'transcribe');
  if (!tr.length) console.log("      journal mock :", JSON.stringify(mock.log.map((x) => [x.provider, x.kind, x.model, x.status])));
  assert(tr.length >= 1 && tr[0].provider === 'gemini' && !tr[0].stream, `transcription Gemini (audio WAV inline) : ${JSON.stringify(tr[0])}`);
  const line = await page.textContent('.transcript .tl-them:not(.tl-interim) .tl-bubble');
  assert(line.includes('rejoindre notre entreprise'), `final « Recruteur » : ${line}`);
  const a = await waitAnswer(page, (x) => x.source === 'ai' && x.text.includes(ANSWER_MARK) && !x.streaming, 'réponse après transcription', 15000);
  assert(a.count.startsWith('2/'), `réponse préparée puis IA (${a.count})`);
  const lvl = await page.evaluate(() => getComputedStyle(document.querySelector('.live [data-src="them"] .meter i')).getPropertyValue('--v'));
  assert(lvl !== '', 'vumètre du recruteur présent');
  await leaveLive(page);
  await page.evaluate(() => Souffleur.store.setSettings({ audioPreset: 'haut-parleur' }));
});

await test('live « visio-casque » : son de l’onglet (getDisplayMedia) + micro Web Speech', async () => {
  mock.reset();
  mock.delays.answer = 300;
  await gotoApp(page, BASE, `#/live/${state.d1}`);
  await page.click('[data-preset="visio-casque"]');
  await page.click('[data-act="start"]');
  await page.waitForSelector('.live [data-src="them"]', { timeout: 8000, state: 'attached' });
  const disp = await page.evaluate(() => window.__display);
  assert(disp.calls === 1 && disp.last && disp.last.audio && disp.last.systemAudio === 'include', `getDisplayMedia appelé avec l’audio système : ${JSON.stringify(disp.last)}`);
  await page.waitForSelector('.transcript .tl-them:not(.tl-interim)', { timeout: 30000, state: 'attached' });
  await page.evaluate(() => window.__sr.say('Je suis contrôleur de gestion depuis huit ans dans l’industrie'));
  await page.waitForSelector('.transcript .tl-me:not(.tl-interim)', { timeout: 8000, state: 'attached' });
  await waitAnswer(page, (x) => x.source === 'ai' && x.text.includes(ANSWER_MARK), 'réponse IA en visio', 15000);
  await leaveLive(page);
});

await test('bascule de modèle sur 429', async () => {
  mock.reset();
  mock.delays.answer = 120;
  mock.fail.push({ provider: 'gemini', kind: 'answer', status: 429, times: 1 });
  await startManualLive(page, BASE, state.d1);
  await ask(page, 'Comment gérez-vous les priorités pendant une période de forte charge ?');
  const a = await waitAnswer(page, (x) => x.source === 'ai' && x.text.includes(ANSWER_MARK) && !x.streaming, 'réponse après bascule', 15000);
  const calls = mock.log.filter((x) => x.kind === 'answer');
  assert(calls.length >= 2 && calls[0].status === 429 && calls[1].status === 200, `429 puis succès : ${JSON.stringify(calls.map((c) => [c.model, c.status]))}`);
  assert(calls[1].model !== calls[0].model, 'le modèle suivant est essayé');
  assert(a.badge.includes(calls[1].model.replace(/-(preview|latest)$/, '')), `badge = modèle de secours (${a.badge})`);
  const st = await page.evaluate(() => Souffleur.ai.state());
  assert(st.breaker.some((b) => b.model === calls[0].model), 'le modèle saturé est écarté (circuit breaker)');
  await leaveLive(page);
});

await test('clé Gemini invalide (401) → message clair, puis secours Claude', async () => {
  mock.reset();
  mock.delays.answer = 100;
  mock.fail.push({ provider: 'gemini', status: 401, times: Infinity });
  await startManualLive(page, BASE, state.d1);
  await ask(page, 'Comment gérez-vous les priorités pendant une période de forte charge ?');
  await expectToast(page, /Clé Gemini refusée/);
  await page.waitForSelector('.live .ai-pill.pill-err', { timeout: 8000 });
  const toasts = await toastText(page);
  assert(toasts.some((t) => /vérifiez-la dans les Réglages/.test(t)), `message actionnable : ${toasts}`);
  await leaveLive(page);
  // Réglages → Tester : échec explicite.
  await gotoApp(page, BASE, '#/settings');
  await page.click('[data-act="test"][data-provider="gemini"]');
  await page.waitForSelector('[data-status="gemini"] .pill-err', { timeout: 10000 });
  const st = await page.textContent('[data-status="gemini"]');
  assert(/clé refusée/i.test(st), `résultat du test : ${st}`);
  // Clé Claude de secours : la réponse arrive quand même.
  await page.fill('[data-key="claudeKey"]', CLAUDE_KEY);
  await page.press('[data-key="claudeKey"]', 'Tab');
  await startManualLive(page, BASE, state.d1);
  await ask(page, 'Comment gérez-vous les priorités pendant une période de forte charge ?');
  const a = await waitAnswer(page, (x) => x.source === 'ai' && x.text.includes(CLAUDE_MARK) && !x.streaming, 'réponse Claude', 15000);
  assert(/claude/.test(a.badge), `badge Claude : ${a.badge}`);
  const c = mock.log.find((x) => x.provider === 'claude' && x.kind === 'answer');
  assert(c && c.stream, 'Claude appelé en streaming');
  await leaveLive(page);
  mock.fail = [];
  await page.evaluate(() => Souffleur.store.setSettings({ claudeKey: '' }));
});

await test('hors-ligne : la réponse préparée s’affiche quand même + message', async () => {
  mock.reset();
  await startManualLive(page, BASE, state.d1);
  await ctx.setOffline(true);
  try {
    // Pendant le live, l'état réseau est porté par la pastille IA (le bandeau global est masqué par le CSS).
    await page.waitForSelector('#netpill:not([hidden])', { state: 'attached', timeout: 5000 });
    await expectToast(page, /Connexion perdue/);
    await ask(page, 'Quelles sont vos prétentions salariales ?');
    const a = await waitAnswer(page, (x) => x.source === 'prep', 'réponse préparée hors ligne', 5000);
    assert(/58 à 62/.test(a.text), `réponse préparée : ${a.text.slice(0, 60)}`);
    await sleep(500);
    const pill = await page.textContent('.live .ai-pill');
    assert(/Hors ligne/.test(pill), `pastille IA : ${pill}`);
    assert(mock.count((x) => x.kind === 'answer') === 0, 'aucun appel IA hors ligne');
    // Question sans réponse préparée : message clair.
    await ask(page, 'Avez-vous déjà travaillé avec un commissaire aux comptes exigeant ?');
    await expectToast(page, /Hors ligne : l’IA est indisponible/);
  } finally {
    await ctx.setOffline(false);
  }
  await page.waitForSelector('#netpill[hidden]', { state: 'attached', timeout: 5000 });
  await leaveLive(page);
});

await test('entraînement : 1 question notée', async () => {
  mock.reset();
  await gotoApp(page, BASE, `#/training/${state.d1}`);
  await page.locator('[data-opt="voice"]').setChecked(false, { force: true });
  await page.click('[data-act="start"]');
  await page.waitForSelector('.tr-question', { timeout: 10000 });
  const q = await page.textContent('.tr-question');
  assert(q.replace(/\s/g, ' ').includes(TRAINING_Q.replace(/\s/g, ' ').slice(0, 30)), `question de l’IA : ${q}`);
  await page.waitForSelector('.tr-status[data-state="listening"]', { timeout: 5000 });
  await page.evaluate(() => window.__sr.say('J’ai ramené la clôture mensuelle de J+12 à J+6 en six mois grâce à un rétroplanning partagé'));
  await page.waitForFunction(() => (document.querySelector('.tr-final') || {}).textContent.includes('rétroplanning'), null, { timeout: 5000 });
  await page.click('[data-act="done"]');
  await page.waitForSelector('.tr-result', { timeout: 10000 });
  const res = await page.textContent('.tr-result');
  assert(/8/.test(res), `note 8/10 affichée : ${res.trim().slice(0, 60)}`);
  assert(await page.$('.tr-better') !== null, 'meilleure réponse affichée');
  await page.click('.sc-actions [data-act="finish"]');
  await page.waitForSelector('.tr-summary', { timeout: 5000 });
  await sleep(400);
  const d = await getDossier(page, state.d1);
  const s = d.sessions.filter((x) => x.kind === 'training').pop();
  assert(s && s.endedAt && s.scores && s.scores.length === 1 && s.scores[0].score === 8, `session d’entraînement enregistrée : ${JSON.stringify(s && s.scores)}`);
  assert(mock.count((x) => x.kind === 'trainingNext') === 1 && mock.count((x) => x.kind === 'trainingFeedback') === 1, 'question et évaluation par l’IA');
});

await test('réglages : clé non mémorisée → sessionStorage uniquement', async () => {
  const KEY2 = 'cle-gemini-session-seulement-0002';
  await gotoApp(page, BASE, '#/settings');
  await page.locator('input[data-set="rememberKeys"]').setChecked(false, { force: true });
  await page.fill('[data-key="geminiKey"]', KEY2);
  await page.press('[data-key="geminiKey"]', 'Tab');
  await sleep(200);
  const st = await page.evaluate(() => ({ ls: Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('\n'), ss: sessionStorage.getItem('souffleur.keys') || '' }));
  assert(!st.ls.includes(KEY2) && !st.ls.includes(GEMINI_KEY), 'aucune clé dans localStorage');
  assert(st.ss.includes(KEY2), 'clé en sessionStorage');
  await page.reload();
  await page.waitForFunction(() => window.Souffleur && Souffleur.store && document.querySelector('#view .route'));
  assert(await page.evaluate(() => Souffleur.store.settings().geminiKey) === KEY2, 'clé conservée au rechargement de l’onglet');
  const other = await ctx.newPage();
  await other.goto(`${BASE}#/settings`);
  await other.waitForFunction(() => window.Souffleur && Souffleur.store && document.querySelector('#view .route'));
  assert(await other.evaluate(() => Souffleur.store.settings().geminiKey) === '', 'clé absente dans un nouvel onglet (PC emprunté)');
  await other.close();
  // Retour à la normale.
  await gotoApp(page, BASE, '#/settings');
  await page.locator('input[data-set="rememberKeys"]').setChecked(true, { force: true });
  await page.fill('[data-key="geminiKey"]', GEMINI_KEY);
  await page.press('[data-key="geminiKey"]', 'Tab');
  await sleep(200);
  assert((await page.evaluate(() => localStorage.getItem('souffleur.keys') || '')).includes(GEMINI_KEY), 'clé de nouveau mémorisée');
  // Thème sombre forcé appliqué immédiatement.
  await page.click('[data-act="seg"][data-set="theme"][data-v="dark"]');
  assert(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'thème sombre forcé');
  await page.click('[data-act="seg"][data-set="theme"][data-v="auto"]');
});

await test('diagnostic : vérifications, micro et clé', async () => {
  mock.reset();
  await gotoApp(page, BASE, '#/diag');
  await page.waitForFunction(() => document.querySelectorAll('.dg-row').length === 11 && !document.querySelector('.dg-row.is-pending'), null, { timeout: 20000 });
  const gem = await page.getAttribute('.dg-row[data-key="gemini"]', 'class');
  assert(/is-ok/.test(gem), `clé Gemini OK : ${gem}`);
  await page.click('[data-act="row"][data-key="mic"]');
  await page.waitForSelector('.dg-row[data-key="mic"].is-ok', { timeout: 12000 });
  const summary = await page.textContent('.dg-summary .h2');
  assert(summary.trim().length > 5, `synthèse : ${summary}`);
});

await test('export .souffleur.json puis import (nouvel identifiant)', async () => {
  await gotoApp(page, BASE, `#/dossier/${state.d1}`);
  await page.click('.topbar [data-act="export"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.sheet [data-x="json"]')]);
  const file = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(file);
  assert(/\.souffleur\.json$/.test(file), `nom de fichier : ${path.basename(file)}`);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert(j.format === 'souffleur' && j.version === 2 && j.dossier && j.dossier.company === 'Hélios Énergie', 'format du fichier exporté');
  assert(!j.keys && !fs.readFileSync(file, 'utf8').includes(GEMINI_KEY), 'aucune clé exportée par défaut');
  const before = (await page.evaluate(() => Souffleur.store.list())).length;
  await gotoApp(page, BASE, '#/');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.home-tools [data-act="import"]')]);
  await fc.setFiles(file);
  const hash = await waitHash(page, /^#\/dossier\/[^/]+$/);
  const id = decodeURIComponent(hash.split('/')[2]);
  assert(id !== state.d1, 'identifiant différent à la réimportation');
  const after = await page.evaluate(() => Souffleur.store.list());
  assert(after.length === before + 1, `un dossier de plus (${before} → ${after.length})`);
  const d = await getDossier(page, id);
  assert(d.prep && d.prep.questions.length === PREP.questions.length && d.docs.length === 4, 'prépa et documents réimportés');
  state.d3 = id;
});

await test('export HTML autonome : s’ouvre en file:// avec le dossier', async () => {
  await gotoApp(page, BASE, `#/dossier/${state.d1}`);
  await page.click('.topbar [data-act="export"]');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('.sheet [data-x="html"]')]);
  const file = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(file);
  const html = fs.readFileSync(file, 'utf8');
  assert(html.includes('id="souffleur-embedded"') && html.includes('souffleur-single'), 'dossier intégré dans un fichier unique');
  assert(!html.includes(GEMINI_KEY), 'aucune clé dans la page exportée');
  assert(!/<script[^>]*\ssrc="js\//.test(html) && !/<link[^>]+href="styles\.css"/.test(html), 'scripts et styles intégrés');
  const c2 = await newContext(browser, mock);
  watchErrors(c2, sinkError);
  const p2 = await c2.newPage();
  activePage = p2;
  try {
    await p2.goto(pathToFileURL(file).href);
    await p2.waitForFunction(() => /^#\/dossier\//.test(location.hash) && document.querySelector('.screen.dossier [data-b="company"]'), null, { timeout: 15000 });
    assert((await p2.textContent('[data-b="company"]')).includes('Hélios Énergie'), 'dossier chargé automatiquement');
    assert(await p2.$$eval('.qa-list details.qa', (n) => n.length) === PREP.questions.length, 'prépa disponible');
    await p2.reload();
    await p2.waitForFunction(() => window.Souffleur && Souffleur.store && document.querySelector('#view .route'));
    assert((await p2.evaluate(() => Souffleur.store.list())).length === 1, 'pas de doublon au rechargement');
  } finally {
    activePage = page;
    await c2.close();
  }
});

await test('glisser-déposer sur l’accueil : dossier importé, documents → nouvel entretien', async () => {
  await gotoApp(page, BASE, '#/');
  const drop = (files) => page.evaluate(async (list) => {
    const dt = new DataTransfer();
    for (const f of list) {
      const bin = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bin], f.name, { type: f.type }));
    }
    const target = document.querySelector('#view .route') || document.body;
    for (const t of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, files);
  const b64 = (f) => fs.readFileSync(f).toString('base64');
  // 1) Un export .souffleur.json déposé sur l'accueil est importé et ouvert.
  const json = fs.readdirSync(OUT).find((f) => f.endsWith('.souffleur.json'));
  assert(json, 'export JSON du test précédent introuvable');
  const before = (await page.evaluate(() => Souffleur.store.list())).length;
  await drop([{ name: json, type: 'application/json', b64: b64(path.join(OUT, json)) }]);
  await waitHash(page, /^#\/dossier\/[^/]+$/);
  await expectToast(page, /importé/);
  assert((await page.evaluate(() => Souffleur.store.list())).length === before + 1, 'dossier importé par glisser-déposer');
  // 2) Des documents déposés sur l'accueil créent un entretien qui les contient.
  await gotoApp(page, BASE, '#/');
  await drop([{ name: 'CV Camille.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', b64: b64(path.join(FIXTURES, 'sample.docx')) },
    { name: 'notes.txt', type: 'text/plain', b64: b64(path.join(FIXTURES, 'sample.txt')) }]);
  const hash = await waitHash(page, /^#\/dossier\/[^/]+$/);
  await page.waitForFunction(() => document.querySelectorAll('.doc-row:not(.pending)').length === 2 && !document.querySelector('.doc-row.pending'), null, { timeout: 20000 });
  await sleep(900);
  const d = await getDossier(page, decodeURIComponent(hash.split('/')[2]));
  assert(d.docs.length === 2, `documents ajoutés au nouvel entretien (${d.docs.length})`);
  await page.evaluate((id) => Souffleur.store.remove(id), d.id);
});

await test('import d’un dossier avec clés : proposition de remplacement', async () => {
  await gotoApp(page, BASE, `#/dossier/${state.d1}`);
  await page.click('.topbar [data-act="export"]');
  await page.locator('.sheet [data-keys]').setChecked(true, { force: true });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.sheet [data-x="json"]')]);
  const file = path.join(OUT, 'avec-cles-' + dl.suggestedFilename());
  await dl.saveAs(file);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert(j.keys && j.keys.geminiKey === GEMINI_KEY, 'clé incluse sur demande');
  const OTHER = 'cle-gemini-autre-0003';
  await page.evaluate((k) => Souffleur.store.setSettings({ geminiKey: k }), OTHER);
  await gotoApp(page, BASE, '#/');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.home-tools [data-act="import"]')]);
  await fc.setFiles(file);
  await page.waitForSelector('.sheet-confirm', { timeout: 5000 });
  assert(/différente/.test(await page.textContent('.sheet-confirm')), 'explication du remplacement');
  await page.click('.sheet-confirm .btn-primary');
  await expectToast(page, /Clé remplacée/);
  assert(await page.evaluate(() => Souffleur.store.settings().geminiKey) === GEMINI_KEY, 'clé du fichier appliquée');
  const id = decodeURIComponent((await waitHash(page, /^#\/dossier\/[^/]+$/)).split('/')[2]);
  await page.evaluate((x) => Souffleur.store.remove(x), id);
  fs.rmSync(file, { force: true });
});

await test('build : fichier unique valide et garde-fou anti-secrets', async () => {
  assert(build.status === 0, `build --strict : ${(build.stderr || build.stdout || '').slice(-400)}`);
  const html = fs.readFileSync(DIST, 'utf8');
  assert(/<meta name="souffleur-single" content="1">/.test(html) && !/<script[^>]*\ssrc="js\//.test(html), 'souffleur.html autonome');
  assert(!/AIza[0-9A-Za-z_-]{30,}/.test(html) && !/sk-ant-/.test(html), 'aucun motif de clé dans le build');
  for (const [label, leak, msg] of [['Google', 'AI' + 'za' + 'Q'.repeat(35), /clé Google/], ['Anthropic', 'sk-' + 'ant-api03-' + 'x'.repeat(20), /Anthropic/]]) {
    const dir = tmpDir('leak');
    fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
    fs.appendFileSync(path.join(dir, 'src', 'js', 'util.js'), `\n// test de fuite : ${leak}\n`);
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build.mjs'), '--src', path.join(dir, 'src'), '--out', path.join(dir, 'out')], { cwd: ROOT, encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    assert(r.status !== 0, `le build doit échouer avec une clé ${label}`);
    assert(msg.test(out), `message explicite (${label}) : ${out.slice(-300)}`);
    assert(!fs.existsSync(path.join(dir, 'out', 'index.html')), 'aucune sortie publiée après échec');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('fichier unique en file:// (dist/site/souffleur.html) : parcours complet', async () => {
  assert(fs.existsSync(DIST), 'dist/site/souffleur.html absent');
  mock.reset();
  mock.delays.answer = 1200;
  const c3 = await newContext(browser, mock);
  watchErrors(c3, sinkError);
  const p3 = await c3.newPage();
  activePage = p3;
  const FILE = pathToFileURL(DIST).href;
  try {
    await p3.goto(FILE);
    await p3.waitForSelector('.ob-sheet [data-ob="key"]', { timeout: 15000 });
    await p3.fill('[data-ob="key"]', GEMINI_KEY);
    await p3.click('.ob-foot [data-act="skip"]');
    await p3.waitForFunction(() => !document.querySelector('.sheet-layer:not(.out)'));
    assert(await p3.evaluate(() => Souffleur.ai.hasKey()), 'clé enregistrée via « Plus tard »');
    assert(await p3.evaluate(() => Souffleur.store.backend) !== 'memory', `stockage persistant en file:// (${await p3.evaluate(() => Souffleur.store.backend)})`);
    await p3.click('[data-act="new"]');
    await p3.fill('#nd-company', 'Hélios Énergie');
    await p3.fill('#nd-role', 'Responsable administratif et financier');
    await p3.click('.sheet-actions .btn-primary');
    const hash = await waitHash(p3, /^#\/dossier\/[^/]+$/);
    const id = decodeURIComponent(hash.split('/')[2]);
    const [fc] = await Promise.all([p3.waitForEvent('filechooser'), p3.click('[data-act="pick"]')]);
    await fc.setFiles([path.join(FIXTURES, 'sample.docx'), path.join(FIXTURES, 'sample.pdf')]);
    await p3.waitForFunction(() => document.querySelectorAll('.doc-row:not(.pending)').length >= 2 && !document.querySelector('.doc-row.pending'), null, { timeout: 40000 });
    await p3.click('[data-act="paste"]');
    await p3.fill('#ps-text', OFFRE_TEXT);
    await p3.click('.sheet-actions .btn-primary');
    await p3.waitForFunction(() => document.querySelectorAll('.doc-row:not(.pending)').length >= 3);
    await p3.click('[data-pact="gen"]');
    await p3.waitForSelector('.qa-list details.qa', { timeout: 30000 });
    await p3.evaluate((x) => Souffleur.app.go('#/live/' + x), id);
    await p3.click('[data-preset="haut-parleur"]');
    await p3.click('[data-act="start"]');
    await p3.waitForSelector('.live [data-src="mixed"][data-state="listening"]', { timeout: 8000, state: 'attached' });
    await p3.evaluate((q) => window.__sr.say(q), QUESTION_FR);
    await waitAnswer(p3, (a) => a.source === 'prep', 'réponse préparée (file://)', 5000);
    await waitAnswer(p3, (a) => a.source === 'ai' && a.text.includes(ANSWER_MARK) && !a.streaming, 'réponse IA (file://)', 15000);
    // Export HTML depuis le fichier unique : la page exportée réutilise le fichier en cours.
    await leaveLive(p3);
    await p3.evaluate((x) => Souffleur.app.go('#/dossier/' + x), id);
    await p3.click('.topbar [data-act="export"]');
    const [dl] = await Promise.all([p3.waitForEvent('download', { timeout: 30000 }), p3.click('.sheet [data-x="html"]')]);
    const out = path.join(OUT, 'depuis-file-' + dl.suggestedFilename());
    await dl.saveAs(out);
    const html = fs.readFileSync(out, 'utf8');
    assert(html.includes('souffleur-embedded') && html.includes('souffleur-version'), 'export autonome depuis file://');
    const p4 = await c3.newPage();
    await p4.goto(pathToFileURL(out).href);
    await p4.waitForFunction(() => window.Souffleur && Souffleur.store && document.querySelector('#view .route'), null, { timeout: 15000 });
    assert((await p4.evaluate(() => Souffleur.store.list())).length === 1, 'même origine file:// : le dossier existe déjà, pas de doublon');
  } finally {
    activePage = page;
    await c3.close();
  }
});

await test('aucune erreur JS non gérée (tous écrans)', async () => {
  // Parcours rapide de tous les écrans restants pour relever d'éventuelles erreurs.
  for (const h of ['#/', `#/dossier/${state.d2}`, `#/live/${state.d2}`, `#/training/${state.d2}`, `#/recap/${state.d1}/${state.liveSession}`, '#/settings', '#/diag', '#/inconnu', '#/dossier/inexistant']) {
    await gotoApp(page, BASE, h);
    await sleep(500);
  }
  const bad = errors.filter((e) => e.test);
  assert(!bad.length, `${bad.length} erreur(s) :\n${bad.map((e) => `[${e.test}] ${e.msg}`).join('\n')}`);
});

/* ------------------------------------------------------------------ bilan */

await browser.close();
srv.server.close();
if (!KEEP) fs.rmSync(OUT, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} réussi(s), ${failed.length} échoué(s) — ${((Date.now() - T_START) / 1000).toFixed(0)} s`);
if (failed.length) console.log('Échecs : ' + failed.map((f) => f.name).join(' ; '));
process.exit(failed.length ? 1 : 0);
