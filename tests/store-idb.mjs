// Tests de src/js/store.js dans Chromium (IndexedDB réel, rechargements, journal de secours) :
//   node tests/store-idb.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright-core';
import { findChrome } from '../tools/chrome-path.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const js = ['util.js', 'store.js'].map((f) => readFileSync(join(root, 'src/js', f), 'utf8'));
const html = '<!doctype html><meta charset="utf-8"><title>store</title>' + js.map((c) => '<script>' + c + '</script>').join('');
const ORIGIN = 'https://souffleur.test/';

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, info) {
  if (cond) pass++;
  else { fail++; failures.push(name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
try {
  const ctx = await browser.newContext();
  await ctx.route(ORIGIN + '**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(ORIGIN);

  const r1 = await page.evaluate(async () => {
    const S = window.Souffleur;
    await S.store.init();
    const out = { backend: S.store.backend };
    const d = await S.store.create({ company: 'Airbus', role: 'RAF', date: '2026-10-23T14:00' });
    d.sessions.push({ kind: 'live', startedAt: new Date().toISOString(), transcript: [], answers: [] });
    for (let i = 0; i < 50; i++) d.sessions[0].transcript.push({ t: i * 1000, who: i % 2 ? 'me' : 'them', text: 'segment ' + i });
    await S.store.save(d);
    out.id = d.id;
    out.journalAfterSave = localStorage.getItem('souffleur.journal');
    out.got = (await S.store.get(d.id)).sessions[0].transcript.length;
    const d2 = await S.store.create({ name: 'À supprimer' });
    await S.store.remove(d2.id);
    out.afterRemove = await S.store.get(d2.id);
    out.count = (await S.store.list()).length;
    S.store.setSettings({ geminiKey: 'AIzaTEST', rememberKeys: false });
    out.keyInSession = !!sessionStorage.getItem('souffleur.keys') && !localStorage.getItem('souffleur.keys');
    return out;
  });
  check('IndexedDB utilisé', r1.backend === 'indexeddb', r1.backend);
  check('IDB : save + get', r1.got === 50, r1.got);
  check('IDB : journal effacé après écriture réussie', r1.journalAfterSave === null, r1.journalAfterSave && r1.journalAfterSave.slice(0, 80));
  check('IDB : remove', r1.afterRemove === null && r1.count === 1, r1);
  check('clé en sessionStorage', r1.keyInSession);

  // rechargement : données conservées ; puis simulation d'une fermeture brutale (journal plus récent que la base)
  await page.reload();
  const r2 = await page.evaluate(async (id) => {
    const S = window.Souffleur;
    await S.store.init();
    const d = await S.store.get(id);
    const out = { persisted: !!d && d.company === 'Airbus', key: S.store.settings().geminiKey };
    const newer = JSON.parse(JSON.stringify(d));
    newer.notes = 'écrit juste avant la fermeture';
    newer.updatedAt = new Date(Date.now() + 1000).toISOString();
    localStorage.setItem('souffleur.journal', JSON.stringify({ stamp: 'x', dossier: newer }));
    // ancien repli localStorage à réintégrer
    localStorage.setItem('souffleur.dossier.legacy1', JSON.stringify({ id: 'legacy1', name: 'Ancien repli', updatedAt: new Date().toISOString() }));
    return out;
  }, r1.id);
  check('rechargement : dossier conservé', r2.persisted);
  check('rechargement : clé de session conservée (même onglet)', r2.key === 'AIzaTEST', r2.key);

  await page.reload();
  const r3 = await page.evaluate(async (id) => {
    const S = window.Souffleur;
    await S.store.init();
    const d = await S.store.get(id);
    const list = await S.store.list();
    const u = await S.store.usage();
    return {
      notes: d.notes,
      journal: localStorage.getItem('souffleur.journal'),
      legacy: list.some((x) => x.id === 'legacy1'),
      legacyLs: localStorage.getItem('souffleur.dossier.legacy1'),
      usage: u
    };
  }, r1.id);
  check('journal rejoué au démarrage', r3.notes === 'écrit juste avant la fermeture', r3.notes);
  check('journal supprimé après reprise', r3.journal === null);
  check('repli localStorage réintégré dans IndexedDB', r3.legacy && r3.legacyLs === null, r3);
  check('usage()', r3.usage.dossiers === 2 && r3.usage.bytes > 0 && typeof r3.usage.persistent === 'boolean' && r3.usage.backend === 'indexeddb', r3.usage);

  // sauvegarde pendant pagehide : le journal synchrone garantit la reprise
  const r4 = await page.evaluate(async (id) => {
    const S = window.Souffleur;
    const d = await S.store.get(id);
    d.notes = 'pagehide';
    S.store.save(d); // non attendu, comme dans un gestionnaire pagehide
    return localStorage.getItem('souffleur.journal') !== null;
  }, r1.id);
  check('journal écrit de façon synchrone', r4);
  await page.reload();
  const r5 = await page.evaluate(async (id) => { await window.Souffleur.store.init(); return (await window.Souffleur.store.get(id)).notes; }, r1.id);
  check('sauvegarde de pagehide retrouvée', r5 === 'pagehide', r5);

  // gros dossier : rapide, pas de journal au-delà de 1,5 Mo
  const r6 = await page.evaluate(async (id) => {
    const S = window.Souffleur;
    const d = await S.store.get(id);
    const s = { kind: 'live', startedAt: new Date().toISOString(), transcript: [], answers: [] };
    for (let i = 0; i < 12000; i++) s.transcript.push({ t: i * 900, who: 'them', text: 'Une phrase de transcription assez longue pour remplir le dossier ' + i });
    d.sessions.push(s);
    const t0 = performance.now();
    await S.store.save(d);
    const ms = performance.now() - t0;
    const back = await S.store.get(id);
    return { ms, n: back.sessions[1].transcript.length, journal: localStorage.getItem('souffleur.journal') };
  }, r1.id);
  check('gros dossier (12 000 segments) enregistré', r6.n === 12000, r6.n);
  check('gros dossier : enregistrement < 1,5 s', r6.ms < 1500, Math.round(r6.ms));
  check('gros dossier : pas de journal', r6.journal === null);

  // deux onglets : notification croisée
  const page2 = await ctx.newPage();
  await page2.goto(ORIGIN);
  await page2.evaluate(() => {
    window.__changes = [];
    window.Souffleur.bus.on('store:changed', (e) => window.__changes.push(e));
    return window.Souffleur.store.init();
  });
  await page.evaluate(() => window.Souffleur.store.create({ name: 'Depuis l’onglet 1' }));
  await page2.waitForFunction(() => window.__changes.length > 0, null, { timeout: 3000 }).catch(() => {});
  const remote = await page2.evaluate(() => window.__changes[0] || null);
  check('autre onglet notifié', remote && remote.remote === true && remote.action === 'create', remote);

  const r7 = await page.evaluate(async () => {
    const S = window.Souffleur;
    await S.store.clearAll();
    return { n: (await S.store.list()).length, ls: Object.keys(localStorage).filter((k) => k.startsWith('souffleur')).length, ss: Object.keys(sessionStorage).filter((k) => k.startsWith('souffleur')).length };
  });
  check('clearAll', r7.n === 0 && r7.ls === 0 && r7.ss === 0, r7);
  check('aucune erreur de page', errors.length === 0, errors);
} finally {
  await browser.close();
}

console.log(`store.js (Chromium/IndexedDB) : ${pass} réussis, ${fail} échoués`);
if (fail) { for (const f of failures) console.log('  ✗ ' + f); process.exit(1); }
