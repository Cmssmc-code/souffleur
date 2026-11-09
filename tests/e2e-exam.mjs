#!/usr/bin/env node
// Souffleur — parcours de bout en bout de l'oral blanc UE 218 (Chromium, playwright-core).
//   node tests/e2e-exam.mjs [filtre] [--headed]
// S.examAI et S.audio sont remplacés par des faux AVANT le chargement des scripts (piège sur window.Souffleur),
// la synthèse et la reconnaissance vocales par ceux d'e2e-lib (pageFakes). Aucune requête réseau sortante.
// Captures 1440x900 et 390x844 dans tests/shots-exam/.
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../tools/serve.mjs';
import { ROOT, sleep, launchBrowser, newContext, watchErrors } from './e2e-lib.mjs';

const argv = process.argv.slice(2);
const HEADED = argv.includes('--headed');
const FILTER = argv.filter((a) => !a.startsWith('--')).join(' ').toLowerCase();
const SHOTS = path.join(ROOT, 'tests', 'shots-exam');
fs.mkdirSync(SHOTS, { recursive: true });
const T0 = Date.now();

const DESK = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

/* ------------------------------------------------------------------ mini-runner */
const results = [];
const errors = [];
let current = '(démarrage)';
let activePage = null;
class Fail extends Error {}
const assert = (c, m) => { if (!c) throw new Fail(m); };
async function test(name, fn) {
  if (FILTER && !name.toLowerCase().includes(FILTER)) return;
  current = name;
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}  (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  } catch (e) {
    results.push({ name, ok: false, e });
    console.log(`  ✗ ${name}\n      ${String(e && e.message || e).split('\n').slice(0, 6).join('\n      ')}`);
    if (!(e instanceof Fail) && e && e.stack) console.log('      ' + e.stack.split('\n').slice(1, 3).join('\n      '));
    if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(SHOTS, `fail-${name.replace(/[^\w]+/g, '-').slice(0, 50)}.png`) }).catch(() => {});
  }
  current = '(entre deux tests)';
}
const sink = (msg) => errors.push({ test: current, msg });

/* ------------------------------------------------------------------ faux S.examAI / S.audio (injectés avant les scripts) */
function examFakes() {
  if (window.__examFakes) return;
  const M = window.__examFakes = { calls: [], audio: { started: 0, stopped: 0, handlers: {} }, delay: 120, aiReady: true };
  const wait = (ms, signal) => new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('Annulé'); e.name = 'AbortError'; rej(e); }, { once: true });
  });
  const log = (fn, a) => { M.calls.push({ fn, kind: a && a.kind, at: Date.now() }); };
  const examAI = {
    ready: () => M.aiReady,
    async liveNotes(a) {
      log('liveNotes', a); await wait(M.delay, a.signal);
      return {
        covered: { intro: true, source: true, tone: true, summary: true, transition: false, problematic: false, plan: false, news: false, conclusion: false },
        errors: [{ said: 'the author explain', better: 'the author explains', rule: '-s à la 3e personne' }, { said: 'since two years', better: 'for two years', rule: 'for + durée' }],
        tips: ['Demandez-lui la date de l’article.', 'Elle n’a pas encore annoncé son plan.'], source: 'ai'
      };
    },
    async juryQuestion(a) {
      log('juryQuestion', a); await wait(M.delay, a.signal);
      const n = M.calls.filter((c) => c.fn === 'juryQuestion').length;
      return { en: `AI question ${n}: could you develop the idea of ${a.kind}?`, fr: `Question IA ${n} : développer (${a.kind}).`, why: 'Vérifier qu’elle sait approfondir.', expect: 'Un exemple concret et une nuance.', source: 'ai' };
    },
    async answerFeedback(a) {
      log('answerFeedback', a); await wait(M.delay, a.signal);
      return { score: 7, good: ['Réponse claire et structurée.'], fixes: [{ said: 'I am agree', better: 'I agree', rule: 'agree est un verbe' }], better: 'I agree with the author to some extent. Banks have a strong advantage: trust. However, stablecoins are cheaper and faster.' };
    },
    async evaluate(a) {
      log('evaluate', a); M.lastEvaluate = { interviewOnly: !!a.interviewOnly, kind: a.kind }; await wait(M.delay * 2, a.signal);
      return {
        total: 13.5,
        criteria: [
          { id: 'synthesis', label: 'Synthèse', score: 3, max: 4, comment: 'Idées principales présentes, logique de l’auteur à mieux faire ressortir.' },
          { id: 'structure', label: 'Problématique & structure', score: 2.5, max: 4, comment: 'Plan annoncé mais problématique trop proche de la question.' },
          { id: 'commentary', label: 'Commentaire argumenté & actualité', score: 2.5, max: 4, comment: 'Un exemple d’actualité, à étoffer.' },
          { id: 'interaction', label: 'Entretien & interaction', score: 2, max: 3, comment: 'Réponses pertinentes.' },
          { id: 'language', label: 'Langue (grammaire, vocabulaire)', score: 2, max: 3, comment: 'Quelques -s oubliés.' },
          { id: 'fluency', label: 'Aisance & durée', score: 1.5, max: 2, comment: 'Bon débit.' }
        ],
        strengths: ['Introduction complète (source, date, ton).', 'Bonne interaction avec le jury.'],
        priorities: ['Reformuler la question en vraie problématique.', 'Ajouter un fait d’actualité par axe.', 'Soigner les -s de la 3e personne.'],
        errors: [{ said: 'the author explain', better: 'the author explains', rule: '-s à la 3e personne' }],
        pronunciation: ['written — le w est muet', 'policy — accent sur la 1re syllabe'],
        modelPlan: '## Introduction\nThis article was published in…\n\n## I. Banks still have an edge\n- trust\n- regulation',
        message: 'Bravo Audrey, très bon oral blanc : 13,5/20. Continue !'
      };
    },
    async translate(t) { return 'FR: ' + t; },
    async generateSubject() { throw new Error('non utilisé'); },
    async subjectFromText() { throw new Error('non utilisé'); }
  };
  const handlers = M.audio.handlers;
  const audio = {
    get running() { return M.audio.started > M.audio.stopped; },
    on(ev, fn) { (handlers[ev] = handlers[ev] || new Set()).add(fn); return () => handlers[ev].delete(fn); },
    async start(preset, opts) { M.audio.started++; M.audio.preset = preset; M.audio.opts = opts; setTimeout(() => M.emit('state', { state: 'listening' }), 30); return {}; },
    async stop() { M.audio.stopped = M.audio.started; },
    message: () => '',
    status: () => ({ running: audio.running, channels: [] })
  };
  // Programme « Son du PC » (WebSocket local) : absent pendant les tests, quel que soit le poste.
  const RealWS = window.WebSocket;
  window.WebSocket = function (url, p) {
    if (/127\.0\.0\.1:47800/.test(String(url))) throw new Error('Son du PC absent (test)');
    return new RealWS(url, p);
  };
  window.WebSocket.prototype = RealWS.prototype;
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  M.emit = (ev, payload) => { (handlers[ev] || new Set()).forEach((f) => f(payload)); };
  // Piège : les modules qui font S.examAI = … / S.audio = … gardent nos faux.
  const S = window.Souffleur = window.Souffleur || {};
  Object.defineProperty(S, 'examAI', { configurable: true, enumerable: true, get: () => examAI, set: (v) => { M.realExamAI = v; } });
  Object.defineProperty(S, 'audio', { configurable: true, enumerable: true, get: () => audio, set: (v) => { M.realAudio = v; } });
}

/* ------------------------------------------------------------------ helpers */
let nav = 0;
async function open(page, hash) {
  await page.goto(`${BASE}?n=${++nav}${hash || '#/'}`);
  await page.waitForFunction(() => window.Souffleur && Souffleur.examStore && document.querySelector('#view .route'), null, { timeout: 15000 });
  await settle(page);
}
async function settle(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}
async function shot(page, name, { both = true, full = false } = {}) {
  const vp = page.viewportSize();
  const sizes = both ? [DESK, MOBILE] : [vp];
  for (const s of sizes) {
    if (s.width !== page.viewportSize().width) { await page.setViewportSize(s); await sleep(250); }
    await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove())).catch(() => {});
    await sleep(450); // fin des animations d'entrée (écran, feuille)
    await page.screenshot({ path: path.join(SHOTS, `${name}-${s.width}.png`), fullPage: full });
  }
  if (page.viewportSize().width !== vp.width) { await page.setViewportSize(vp); await sleep(150); }
}
async function clickSheetAction(page, label) {
  const b = page.locator('.sheet-layer:not(.out) .sheet-actions button', { hasText: label }).last();
  await b.waitFor({ timeout: 5000 });
  await b.click();
  await page.waitForFunction(() => !document.querySelector('.sheet-layer:not(.out)'), null, { timeout: 5000 }).catch(() => {});
}
const session = (page) => page.evaluate(() => {
  const id = location.hash.split('/')[2];
  return JSON.parse(JSON.stringify(Souffleur.examStore.get(id)));
});
const horizontalOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/* ------------------------------------------------------------------ démarrage */
const srv = await startServer({ port: 0, dir: 'src', quiet: true });
const BASE = `${srv.url}index.html`;
const browser = await launchBrowser({ headed: HEADED });

async function makePage(viewport) {
  const ctx = await newContext(browser, null, { viewport, interviews: false, mobile: viewport.width < 600 });
  await ctx.addInitScript(examFakes);
  // Bloque tout accès réseau externe (sécurité : aucun appel IA réel).
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  watchErrors(ctx, sink);
  const page = await ctx.newPage();
  activePage = page;
  return { ctx, page };
}

console.log('Souffleur — oral blanc (e2e)\n');
const { ctx, page } = await makePage(DESK);
let juryId = '';
let subjectId = '';

await test('accueil oral : onglets, compte à rebours, pas d’entretiens', async () => {
  await open(page, '#/');
  await page.waitForSelector('.ex-home');
  const tabs = await page.$$eval('#tabbar [data-tab]', (as) => as.filter((a) => !a.hidden && getComputedStyle(a).display !== 'none').map((a) => a.dataset.tab));
  assert(JSON.stringify(tabs) === '["home","fiches","settings"]', 'onglets visibles : ' + tabs);
  assert(await page.$eval('#tabbar [data-tab="home"]', (a) => a.classList.contains('on')), 'onglet Oral actif');
  const cd = await page.textContent('[data-b="cd-big"]');
  assert(cd && cd.trim().length, 'compte à rebours affiché');
  assert(!(await page.$('.sheet-layer')), 'pas de prise en main entretiens');
  await shot(page, '01-accueil', { full: true });
  assert((await horizontalOverflow(page)) <= 0, 'pas de défilement horizontal');
});

await test('choix du sujet (jury) : filtre thème, aperçu, lancement', async () => {
  await page.click('[data-go="#/oral/new"]');
  await page.waitForSelector('.ex-chooser [data-subject]');
  const n = await page.locator('[data-subject]').count();
  assert(n >= 12, `12 sujets au moins (${n})`);
  await page.click('[data-theme="1"]');
  const n1 = await page.locator('[data-subject]').count();
  assert(n1 >= 1 && n1 < n, 'filtre thème 1');
  await page.click('[data-theme="0"]');
  await shot(page, '02-choix-sujet', { full: true });
  subjectId = await page.getAttribute('[data-subject="stablecoins-genius-act"]', 'data-subject') || await page.getAttribute('[data-subject]', 'data-subject');
  await page.click(`[data-subject="${subjectId}"]`);
  await page.waitForSelector('.sheet-layer .ex-paper');
  await shot(page, '03-apercu-sujet');
  await clickSheetAction(page, 'Faire passer ce sujet');
  await page.waitForFunction(() => /^#\/oral\/ex-/.test(location.hash));
  juryId = await page.evaluate(() => location.hash.split('/')[2]);
  await page.waitForSelector('.ex-console[data-phase="prep"]');
});

await test('console jury · préparation (chrono raccourci, partage du sujet)', async () => {
  await page.click('[data-dur="10"]');
  let s = await session(page);
  assert(s.prep.durMin === 10, 'durée 10 min');
  await page.click('[data-act="prep-start"]');
  await settle(page);
  // Chrono raccourci : on recule le départ de 9 min 58 s dans la séance enregistrée.
  await page.evaluate(() => { const id = location.hash.split('/')[2]; const s = Souffleur.examStore.get(id); s.prep.startedAt = Date.now() - (9 * 60 + 58) * 1000; Souffleur.examStore.save(s); });
  await page.evaluate(() => Souffleur.app.refresh());
  await page.waitForFunction(() => /00:0[0-2]|-?0:0/.test(document.querySelector('[data-b="clock"]').textContent), null, { timeout: 5000 });
  await page.waitForFunction(() => { const s = Souffleur.examStore.get(location.hash.split('/')[2]); return s && s.alarms && Object.keys(s.alarms).some((k) => /^p0/.test(k)); }, null, { timeout: 8000 });
  const st = await page.getAttribute('.ex-clock', 'data-state');
  assert(st === 'over', 'chrono en dépassement : ' + st);
  // Partager le sujet : fenêtre propre sans corrigé.
  const [pop] = await Promise.all([ctx.waitForEvent('page'), page.click('[data-act="share"]')]);
  await pop.waitForSelector('.ex-read .ex-paper', { timeout: 10000 });
  assert(!(await pop.$('.ex-corrige')), 'pas de corrigé dans la fenêtre partagée');
  assert((await pop.$$('.ex-par')).length >= 5, 'paragraphes du sujet');
  await pop.setViewportSize({ width: 980, height: 900 });
  await pop.screenshot({ path: path.join(SHOTS, '05-sujet-partage-980.png') });
  await pop.close();
  // Lien Teams : validation légère, mémorisé dans la séance et comme dernier lien, Rejoindre + Copier pour Audrey.
  await page.evaluate(() => {
    window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; };
    Souffleur.ui.copy = async (t) => { window.__copied = t; return true; };
  });
  assert(await page.isVisible('[data-b="teams-bar"] [data-act="teams-edit"]'), 'rappel « Pas de lien Teams » en haut');
  await page.fill('[data-f="teams"]', 'https://zoom.us/j/123');
  await page.locator('[data-f="teams"]').blur();
  await page.waitForFunction(() => document.querySelector('[data-b="teams"]').classList.contains('is-bad'));
  const TEAMS = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_TEST%40thread.v2/0?context=%7b%7d';
  await page.fill('[data-f="teams"]', 'Rejoindre la réunion : ' + TEAMS);
  await page.locator('[data-f="teams"]').blur();
  await page.waitForFunction(() => document.querySelector('[data-b="teams-bar"] [data-act="teams-join"]'));
  s = await session(page);
  assert(s.teamsLink === TEAMS, 'lien enregistré dans la séance : ' + s.teamsLink);
  assert(await page.evaluate(() => localStorage.getItem('souffleur.exam.teams')) === TEAMS, 'dernier lien mémorisé');
  await page.click('[data-b="teams"] [data-act="teams-join"]');
  assert((await page.evaluate(() => window.__opened)).includes(TEAMS), 'Rejoindre ouvre le lien');
  await page.click('[data-b="teams-bar"] [data-act="teams-copy"]');
  const copied = await page.evaluate(() => window.__copied || '');
  assert(copied.includes(TEAMS) && /caméra/i.test(copied) && /feuilles blanches/.test(copied) && /partage le sujet/.test(copied), 'message pour Audrey : ' + copied.slice(0, 120));
  await shot(page, '04-jury-preparation', { full: true });
});

await test('console jury · exposé (écoute, transcription, notes IA, fautes)', async () => {
  await page.click('[data-act="to-expose"]');
  await page.waitForSelector('.ex-console[data-phase="expose"]');
  await page.click('[data-act="expose-start"]');
  await page.waitForFunction(() => window.__examFakes.audio.started === 1, null, { timeout: 5000 });
  const preset = await page.evaluate(() => window.__examFakes.audio.preset);
  assert(preset === 'haut-parleur', 'source par défaut micro/haut-parleur (sans programme Son du PC) : ' + preset);
  const lines = [
    'This article was published in the Financial Times in March 2026 and it deals with stablecoins.',
    'The tone of the author is rather critical and slightly worried about the banking sector.',
    'First the author explain that the GENIUS Act gives a legal framework to stablecoins since two years.',
    'Then he shows that banks could lose deposits if customers move their money to digital dollars.'
  ];
  for (const t of lines) {
    await page.evaluate((t) => window.__examFakes.emit('interim', { who: 'them', text: t.slice(0, 20) }), t);
    await page.evaluate((t) => window.__examFakes.emit('final', { who: 'them', text: t }), t);
  }
  await page.waitForFunction((n) => document.querySelectorAll('[data-b="tx"] p:not(.ex-interim)').length >= n, lines.length);
  // Phrase ajoutée à la main.
  await page.fill('[data-b="add"] input', 'To what extent should banks fear stablecoins?');
  await page.press('[data-b="add"] input', 'Enter');
  await page.waitForFunction((n) => document.querySelectorAll('[data-b="tx"] p:not(.ex-interim)').length >= n, lines.length + 1);
  await page.click('[data-act="analyze"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-b="errors"] li').length === 2, null, { timeout: 5000 });
  const on = await page.$$eval('[data-check].on', (b) => b.map((x) => x.dataset.check));
  assert(['intro', 'source', 'tone', 'summary'].every((k) => on.includes(k)), 'grille cochée par l’IA : ' + on);
  // Case cochée à la main.
  await page.click('[data-check="plan"]');
  assert(await page.$eval('[data-check="plan"]', (b) => b.classList.contains('on')), 'cochage manuel');
  // Notes du jury.
  await page.fill('[data-f="jury-notes"]', 'Bonne intro. Pense à « since » → « for ».');
  // Aucune suggestion de réponse pour l'élève : les conseils sont pour le jury.
  const tips = await page.textContent('[data-b="tips"]');
  assert(/date/.test(tips), 'conseils jury affichés');
  await shot(page, '06-jury-expose', { full: true });
});

await test('rechargement en pleine séance : reprise de l’exposé', async () => {
  await sleep(150); // pas d’attente de l’enregistrement différé : pagehide doit tout enregistrer
  await page.reload();
  await page.waitForSelector('.ex-console[data-phase="expose"]', { timeout: 15000 });
  const n = await page.locator('[data-b="tx"] p:not(.ex-interim)').count();
  assert(n >= 5, 'transcription reprise : ' + n);
  const notes = await page.inputValue('[data-f="jury-notes"]');
  assert(/since/.test(notes), 'notes du jury reprises');
  const errs = await page.locator('[data-b="errors"] li').count();
  assert(errs === 2, 'fautes reprises : ' + errs);
  // Accueil : carte « Séance en cours ».
  await page.click('.ex-cbar [data-go="#/"]');
  await page.waitForSelector('.ex-resume');
  await shot(page, '07-accueil-reprise');
  await page.click('.ex-resume [data-go]');
  await page.waitForSelector('.ex-console[data-phase="expose"]');
});

await test('console jury · entretien (questions corrigé + IA, lecture, échanges)', async () => {
  await page.click('[data-act="to-interview"]');
  // Exposé de quelques secondes : confirmation (minimum 10 minutes).
  await page.waitForSelector('.sheet-layer:not(.out)');
  assert(/10 minutes/.test(await page.textContent('.sheet-layer:not(.out)')), 'alerte exposé trop court');
  await clickSheetAction(page, 'Passer à l’entretien');
  await page.waitForSelector('.ex-console[data-phase="interview"]');
  await page.waitForSelector('[data-b="q"] .ex-q-en');
  const q1 = await page.textContent('[data-b="q"] .ex-q-en');
  assert(q1.length > 10, 'première question (corrigé)');
  await page.click('[data-act="mark-asked"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-b="asked"] li:not(.muted)').length === 1);
  // La question posée reste affichée (pas d'avance automatique) pendant que l'élève répond.
  await sleep(1700);
  assert((await page.textContent('[data-b="q"] .ex-q-en')) === q1, 'question posée toujours affichée');
  assert(await page.$('[data-b="q"] [data-act="q-next"]'), 'bouton « Question suivante »');
  // Après le rechargement, l'écoute est arrêtée : on la relance.
  await page.click('[data-act="listen-start"]');
  await page.waitForFunction(() => window.__examFakes.audio.started >= 1 && document.querySelector('[data-act="listen-stop"]'));
  await page.evaluate(() => window.__examFakes.emit('final', { who: 'them', text: 'I think banks will adapt because they have the trust of customers.' }));
  await page.waitForFunction(() => document.querySelectorAll('[data-b="turns"] .ex-turn-student').length >= 1);
  await page.click('[data-kind="deeper"]');
  await page.waitForFunction(() => /AI question/.test(document.querySelector('[data-b="q"] .ex-q-en') ? document.querySelector('[data-b="q"] .ex-q-en').textContent : ''), null, { timeout: 5000 });
  assert(await page.$('[data-b="q"] .ex-q-more'), 'pourquoi / attendu pour le jury');
  await page.click('[data-act="read-q"]');
  await page.waitForFunction(() => (window.__spoken || []).some((t) => /AI question/.test(t)), null, { timeout: 5000 });
  // Raccourci clavier Espace : marque la question comme posée, puis passe à la suivante.
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelectorAll('[data-b="asked"] li:not(.muted)').length === 2);
  const asked2 = await page.evaluate(() => Souffleur.examStore.get(location.hash.split('/')[2]).interview.asked[1]);
  assert(asked2.why && asked2.expect, 'pourquoi / attendu gardés dans les questions posées');
  const cur = await page.textContent('[data-b="q"] .ex-q-en');
  await page.keyboard.press('Space');
  await page.waitForFunction((c) => { const e = document.querySelector('[data-b="q"] .ex-q-en'); return e && e.textContent !== c; }, cur, { timeout: 5000 });
  // « Autre question » sur une question non posée : passée, avec un message.
  await page.click('[data-kind="opinion"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /non posée/.test(t.textContent)), null, { timeout: 5000 });
  await shot(page, '08-jury-entretien', { full: true });
});

await test('console jury · bilan (évaluation IA, ajustement, terminer)', async () => {
  await page.click('[data-act="to-review"]');
  // Entretien de quelques secondes : confirmation.
  await clickSheetAction(page, 'Terminer');
  await page.waitForSelector('[data-act="evaluate"]');
  await page.waitForFunction(() => window.__examFakes.audio.stopped >= 1);
  await shot(page, '09-jury-bilan-avant');
  await page.click('.ex-review-pre [data-act="evaluate"]');
  await page.waitForSelector('.ex-score .ex-ring');
  const call = await page.evaluate(() => window.__examFakes.calls.filter((c) => c.fn === 'evaluate').length);
  assert(call === 1, 'evaluate appelé une fois');
  let total = await page.textContent('.ex-score .ex-ring b');
  assert(total.trim() === '13,5', 'note 13,5 : ' + total);
  await shot(page, '10-jury-bilan', { full: true });
  assert((await page.textContent('[data-b="verdict"]')).trim() === 'Assez bien', 'mention française pour 13,5');
  // Réévaluer : confirmation avant d'écraser la note.
  await page.click('.ex-actions-row [data-act="evaluate"]');
  await page.waitForSelector('.sheet-layer:not(.out)');
  await clickSheetAction(page, 'Annuler');
  assert((await page.evaluate(() => window.__examFakes.calls.filter((c) => c.fn === 'evaluate').length)) === 1, 'pas de réévaluation sans confirmation');
  const inp = page.locator('[data-crit="language"] input');
  await inp.fill('3');
  await page.waitForFunction(() => document.querySelector('.ex-score .ex-ring b').textContent.trim() === '14,5');
  await inp.fill('9');
  await page.waitForFunction(() => document.querySelector('.ex-score .ex-ring b').textContent.trim() === '14,5');
  await page.click('[data-act="finish"]');
  await page.waitForFunction(() => location.hash === '#/historique');
  const s = await page.evaluate((id) => Souffleur.examStore.get(id), juryId);
  assert(s.phase === 'done' && Math.abs(s.evaluation.total - 14.5) < 0.01, 'séance terminée et note ajustée enregistrée : ' + (s.evaluation && s.evaluation.total));
});

await test('historique', async () => {
  await page.waitForSelector('.ex-history .ex-hrow');
  const note = await page.textContent('.ex-hrow .ex-hnote');
  assert(/14,5/.test(note), 'note dans l’historique : ' + note);
  await shot(page, '11-historique');
  await page.click(`[data-open="${juryId}"]`);
  await page.waitForSelector('.ex-console .ex-score');
  await page.goBack();
});

await test('vue #/sujet plein écran', async () => {
  await open(page, `#/sujet/${subjectId}`);
  await page.waitForSelector('.ex-read .ex-paper');
  await page.click('[data-z="1"]');
  await shot(page, '12-sujet');
  await open(page, '#/sujet/inexistant');
  await page.waitForSelector('.empty');
});

await test('fiches : chaque onglet, recherche, lecture audio', async () => {
  for (const tab of ['methode', 'phrases', 'themes', 'actu', 'erreurs', 'prononciation', 'jourj']) {
    await open(page, `#/fiches/${tab}`);
    await page.waitForSelector('.ex-fiches .ex-fbody > *');
    assert(await page.$eval('#tabbar [data-tab="fiches"]', (a) => a.classList.contains('on')), 'onglet Fiches actif');
    const empty = await page.$('.ex-fbody .empty');
    assert(!empty, `onglet ${tab} non vide`);
    if (tab === 'themes') await page.click('.ex-theme-card summary');
    const say = page.locator('.ex-fbody [data-say]:visible').first();
    if (await say.count()) {
      const before = await page.evaluate(() => (window.__spoken || []).length);
      await say.click();
      await page.waitForFunction((b) => (window.__spoken || []).length > b, before, { timeout: 5000 });
    }
    if (tab === 'jourj') {
      await page.locator('[data-day]').first().check({ force: true });
      const saved = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('souffleur.exam.daycheck.v1') || '{}')).length);
      assert(saved === 1, 'case du jour J mémorisée');
    }
    await shot(page, `13-fiches-${tab}`);
  }
  await open(page, '#/fiches/erreurs');
  await page.fill('[data-f="q"]', 'zzzzqqq');
  assert(await page.isVisible('[data-b="nores"]'), 'message aucun résultat');
  // Recherche : renvoi vers les autres onglets.
  await page.fill('[data-f="q"]', 'journalist');
  await page.waitForSelector('[data-b="elsewhere"]:not([hidden])');
  assert(/Prononciation/.test(await page.textContent('[data-b="elsewhere"]')), 'résultat signalé dans l’onglet Prononciation');
  await page.fill('[data-f="q"]', '');
  // Lecture lente.
  await page.click('[data-rate="0.8"]');
  const rate = await page.evaluate(() => JSON.parse(localStorage.getItem('souffleur.exam.prefs')).rate);
  assert(rate === 0.8, 'débit lent mémorisé');
  await page.click('[data-rate="1"]');
});

await test('réglages : interrupteur entretiens → onglet et accueil entretiens', async () => {
  await open(page, '#/settings');
  await page.waitForSelector('[data-set="showInterviews"]', { state: 'attached' });
  assert(await page.$eval('#tabbar [data-tab="entretiens"]', (a) => a.hidden), 'onglet Entretiens caché au départ');
  await shot(page, '14-reglages');
  await page.locator('[data-set="showInterviews"]').check({ force: true });
  await page.waitForFunction(() => !document.querySelector('#tabbar [data-tab="entretiens"]').hidden, null, { timeout: 5000 });
  await page.click('[data-act="interviews"]');
  await page.waitForFunction(() => location.hash === '#/entretiens');
  await page.waitForSelector('#view .route[data-route="entretiens"] .screen', { timeout: 10000 });
  await page.evaluate(() => document.querySelectorAll('.sheet-layer').forEach((n) => n.remove()));
  assert(await page.$eval('#tabbar [data-tab="entretiens"]', (a) => a.classList.contains('on')), 'onglet Entretiens actif');
  await shot(page, '15-entretiens');
  // L'accueil '#/' reste l'oral.
  await open(page, '#/');
  await page.waitForSelector('.ex-home');
  assert(await page.$('.ex-home [data-go="#/entretiens"]'), 'raccourci entretiens sur l’accueil (bureau)');
  await open(page, '#/settings');
  await page.locator('[data-set="showInterviews"]').uncheck({ force: true });
  await page.waitForFunction(() => document.querySelector('#tabbar [data-tab="entretiens"]').hidden);
});

await ctx.close();

/* ------------------------------------------------------------------ élève (mobile) */
const M = await makePage(MOBILE);
const mp = M.page;

await test('élève · tirage au sort et préparation (brouillon, mode strict)', async () => {
  await open(mp, '#/');
  await mp.waitForSelector('.ex-home');
  await shot(mp, '20-mobile-accueil', { both: false, full: true });
  assert((await horizontalOverflow(mp)) <= 0, 'pas de défilement horizontal (mobile)');
  await mp.click('[data-go="#/eleve"]');
  await mp.waitForSelector('.ex-chooser [data-act="draw"]');
  await shot(mp, '21-mobile-eleve-choix', { both: false, full: true });
  await mp.click('[data-act="draw"]');
  await mp.waitForSelector('.sheet-layer .ex-draw-card');
  await shot(mp, '22-mobile-tirage', { both: false });
  await clickSheetAction(mp, 'C’est parti');
  await mp.waitForFunction(() => /^#\/eleve\/ex-/.test(location.hash));
  await mp.waitForSelector('.ex-solo [data-act="prep-start"]');
  assert(!(await mp.$('.ex-solo .ex-paper')), 'texte caché avant le chrono');
  await mp.click('[data-dur="10"]');
  await mp.click('[data-act="prep-start"]');
  await mp.waitForSelector('.ex-solo .ex-paper');
  await mp.fill('[data-note="intro"]', 'This article, published in March 2026, deals with stablecoins.');
  await mp.fill('[data-note="summary"]', 'The author explains that banks are worried because customers could move their deposits to stablecoins very quickly');
  await mp.waitForSelector('[data-nf="summary"].is-long');
  await mp.fill('[data-note="summary"]', 'banks worried • deposits → stablecoins • GENIUS Act');
  await mp.waitForSelector('[data-nf="summary"]:not(.is-long)');
  assert(!(await mp.$('.ex-help')), 'mode strict : pas d’aide-mémoire');
  await mp.locator('[data-f="strict"]').uncheck({ force: true });
  await mp.waitForSelector('.ex-help');
  await sleep(1400);
  const s = await session(mp);
  assert(/stablecoins/.test(s.prep.notes.intro) && s.prep.strict === false, 'brouillon enregistré');
  await shot(mp, '23-mobile-preparation', { both: false, full: true });
  await mp.setViewportSize(DESK); await sleep(250);
  await mp.screenshot({ path: path.join(SHOTS, '23-solo-preparation-1440.png'), fullPage: true });
  await mp.setViewportSize(MOBILE); await sleep(250);
});

await test('élève · exposé au micro (reconnaissance simulée)', async () => {
  await mp.click('[data-act="to-expose"]');
  await mp.waitForSelector('[data-act="expose-start"]');
  await mp.click('[data-act="expose-start"]');
  await mp.waitForFunction(() => window.__sr.active.size > 0, null, { timeout: 5000 });
  await mp.evaluate(() => window.__sr.say('This article was published in March 2026 and it deals with the rise of stablecoins in the United States', { stepMs: 5 }));
  await mp.evaluate(() => window.__sr.say('The author explain that banks could lose deposits', { stepMs: 5 }));
  assert(!(await mp.$('.ex-tx-edit')), 'transcription non montrée pendant l’exposé');
  await shot(mp, '24-mobile-expose', { both: false });
  await mp.click('[data-act="expose-end"]');
  await mp.waitForSelector('.ex-tx-edit');
  const tx = await mp.inputValue('.ex-tx-edit');
  assert(/stablecoins/.test(tx) && /lose deposits/.test(tx), 'transcription complète : ' + tx);
  await shot(mp, '25-mobile-expose-fin', { both: false, full: true });
});

await test('élève · jury IA (question lue, réponse au micro, correction)', async () => {
  await mp.click('[data-act="to-jury"]');
  await mp.waitForSelector('[data-act="qa-next"]');
  await mp.click('[data-act="qa-next"]');
  await mp.waitForSelector('[data-act="qa-done"]');
  await mp.waitForFunction(() => (window.__spoken || []).length > 0);
  await mp.waitForFunction(() => window.__sr.active.size > 0, null, { timeout: 5000 });
  await mp.evaluate(() => window.__sr.say('I am agree with the author because banks have the trust of customers', { stepMs: 5 }));
  await mp.click('[data-act="qa-done"]');
  await mp.waitForSelector('.ex-fb .ex-ring');
  const ans = await mp.textContent('.ex-answer p');
  assert(/agree/.test(ans), 'réponse captée : ' + ans);
  await shot(mp, '26-mobile-jury-ia', { both: false, full: true });
  // Réponse écrite.
  await mp.click('[data-act="qa-next"]');
  await mp.waitForSelector('[data-act="qa-done"]');
  await mp.waitForSelector('[data-act="qa-type"]');
  await mp.click('[data-act="qa-type"]');
  await mp.fill('[data-f="answer"]', 'Yes, because regulation makes them safer.');
  await mp.click('[data-act="qa-done"]');
  await mp.waitForSelector('.ex-fb');
  const s = await session(mp);
  assert(s.interview.asked.length === 2 && s.interview.asked.every((a) => a.score === 7), 'réponses notées');
  const fbCalls = await mp.evaluate(() => window.__examFakes.calls.filter((c) => c.fn === 'answerFeedback').length);
  assert(fbCalls === 2, 'feedback après chaque réponse');
});

await test('élève · rechargement en plein jury IA puis bilan', async () => {
  await mp.reload();
  await mp.waitForSelector('.ex-solo[data-phase="interview"]');
  assert((await mp.locator('.ex-asked li').count()) === 2, 'questions précédentes reprises');
  await mp.click('[data-step="review"]');
  await clickSheetAction(mp, 'Passer');
  await mp.waitForSelector('[data-act="evaluate"]');
  await mp.click('.ex-review-pre [data-act="evaluate"]');
  await mp.waitForSelector('.ex-score .ex-ring');
  assert(!(await mp.$('[data-act="copy-msg"]')) && /Mot du correcteur/.test(await mp.textContent('.ex-msg')), 'solo : « Mot du correcteur », sans « Copier »');
  await shot(mp, '27-mobile-bilan', { both: false, full: true });
  await mp.click('[data-act="finish"]');
  await mp.waitForFunction(() => location.hash === '#/historique');
  await mp.waitForSelector('.ex-hrow');
  await shot(mp, '28-mobile-historique', { both: false });
});

await test('élève · jury IA direct (sans préparation) et lien Teams', async () => {
  await open(mp, '#/eleve');
  await mp.waitForSelector('.ex-jury-ai [data-act="quick-jury"]');
  // Sujets cachés par défaut en solo (surprise du tirage) ; badge « Fait le » pour le sujet déjà traité.
  assert(await mp.$('.ex-scard.is-hidden-q'), 'titres et questions cachés');
  assert(await mp.$('.ex-scard .pill-ok'), 'badge « Fait le JJ/MM »');
  // Rejoindre l'oral blanc Teams.
  await mp.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
  const L = 'https://teams.live.com/meet/9876543210';
  await mp.fill('.ex-teams-join [data-f="teams"]', L);
  await mp.click('.ex-teams-join [data-act="teams-join"]');
  assert((await mp.evaluate(() => window.__opened)).includes(L), 'lien Teams ouvert côté élève');
  await shot(mp, '32-mobile-eleve-accueil', { both: false, full: true });
  // Jury IA direct.
  await mp.click('[data-act="quick-jury"]');
  await mp.waitForSelector('.sheet-layer .ex-draw-card');
  await clickSheetAction(mp, 'Questions du jury');
  await mp.waitForSelector('.ex-solo[data-phase="interview"] [data-act="qa-next"]');
  assert(await mp.$('.ex-solo-subj[open] .ex-paper'), 'sujet affiché pendant le jury IA');
  const spoken0 = await mp.evaluate(() => (window.__spoken || []).length);
  await mp.click('[data-act="qa-next"]');
  await mp.waitForSelector('[data-act="qa-done"]');
  await mp.waitForFunction((n) => (window.__spoken || []).length > n, spoken0);
  assert(!(await mp.$('[data-target]')), 'nombre de questions figé après la 1re question');
  // Le test précédent a choisi « Répondre par écrit » (préférence mémorisée) : on repasse au micro.
  const mic = await mp.$('[data-act="qa-mic"]');
  if (mic) await mic.click();
  await mp.waitForFunction(() => window.__sr.active.size > 0, null, { timeout: 5000 });
  // « Répéter la question » : micro coupé pendant la lecture, puis rouvert.
  await mp.click('[data-act="qa-repeat"]');
  await mp.waitForFunction(() => window.__sr.active.size > 0, null, { timeout: 5000 });
  await mp.evaluate(() => window.__sr.say('In my opinion the article shows that banks must adapt quickly', { stepMs: 5 }));
  await mp.click('[data-act="qa-done"]');
  await mp.waitForSelector('.ex-fb .ex-ring');
  assert(/banks must adapt/.test(await mp.textContent('.ex-answer p')), 'réponse captée');
  await shot(mp, '33-mobile-jury-ia-direct', { both: false, full: true });
  await mp.click('[data-act="to-review"]').catch(() => {});
  if (!(await mp.$('[data-act="evaluate"]'))) { await mp.click('[data-step="review"]'); await clickSheetAction(mp, 'Passer'); }
  await mp.waitForSelector('.ex-review-pre [data-act="evaluate"]');
  await mp.click('.ex-review-pre [data-act="evaluate"]');
  await mp.waitForSelector('.ex-score .ex-ring');
  const ev = await mp.evaluate(() => window.__examFakes.lastEvaluate);
  assert(ev && ev.interviewOnly === true, 'évaluation « entretien seul »');
});

await test('mobile : console jury et fiches sans débordement', async () => {
  const LAST = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_LAST%40thread.v2/0';
  await mp.evaluate((l) => localStorage.setItem('souffleur.exam.teams', l), LAST);
  await open(mp, `#/oral/${'new'}`);
  await mp.waitForSelector('[data-subject]');
  await mp.click('[data-subject]');
  await clickSheetAction(mp, 'Faire passer ce sujet');
  await mp.waitForSelector('.ex-console[data-phase="prep"]');
  assert((await mp.inputValue('[data-f="teams"]')) === LAST, 'séance suivante pré-remplie avec le dernier lien Teams');
  assert((await horizontalOverflow(mp)) <= 0, 'console prep sans débordement');
  await shot(mp, '29-mobile-jury-prep', { both: false, full: true });
  await mp.click('[data-act="to-expose"]');
  await mp.waitForSelector('[data-act="expose-start"]');
  assert(!(await mp.$('[data-src="pc-interne"]:visible')), 'pas de source « Son du PC » sur téléphone');
  assert((await horizontalOverflow(mp)) <= 0, 'console exposé sans débordement');
  await shot(mp, '30-mobile-jury-expose', { both: false, full: true });
  // Bouton flottant « Notes » sur petit écran.
  await mp.click('.ex-notes-fab');
  await mp.fill('.sheet-layer [data-f="sheet-notes"]', 'Note prise sur téléphone');
  await clickSheetAction(mp, 'Fermer');
  assert(/téléphone/.test((await session(mp)).expose.juryNotes), 'notes du jury depuis la feuille');
  await mp.click('[data-act="to-interview"]');
  await mp.waitForSelector('[data-b="q"] .ex-q-en');
  assert((await horizontalOverflow(mp)) <= 0, 'console entretien sans débordement');
  await shot(mp, '31-mobile-jury-entretien', { both: false, full: true });
  await open(mp, '#/fiches/phrases');
  await mp.waitForSelector('.ex-fbody > *');
  assert((await horizontalOverflow(mp)) <= 0, 'fiches sans débordement');
  // Suppression de la séance en cours depuis l'historique (deux fois de suite : pas de double feuille).
  await open(mp, '#/historique');
  const before = await mp.locator('[data-del]').count();
  for (let i = 0; i < 2; i++) {
    await mp.locator('[data-del]').first().click();
    await mp.waitForSelector('.sheet-layer:not(.out)');
    const sheets = await mp.locator('.sheet-layer:not(.out)').count();
    assert(sheets === 1, 'une seule confirmation : ' + sheets);
    await clickSheetAction(mp, 'Supprimer');
    await mp.waitForFunction((n) => document.querySelectorAll('[data-del]').length === n, before - i - 1);
  }
});

await M.ctx.close();
await browser.close();
srv.server.close();

/* ------------------------------------------------------------------ bilan */
const failed = results.filter((r) => !r.ok);
const errs = errors.filter((e) => !/Failed to load resource|net::ERR/.test(e.msg));
if (errs.length) {
  console.log(`\n  Erreurs JavaScript (${errs.length}) :`);
  errs.slice(0, 15).forEach((e) => console.log(`    [${e.test}] ${e.msg.slice(0, 300)}`));
}
console.log(`\n${results.length - failed.length} réussi(s), ${failed.length} échec(s), ${errs.length} erreur(s) JS — ${((Date.now() - T0) / 1000).toFixed(0)} s. Captures : tests/shots-exam/`);
process.exit(failed.length || errs.length ? 1 : 0);
