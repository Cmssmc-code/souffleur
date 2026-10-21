// Tests de src/js/store.js hors navigateur (repli localStorage / mémoire) : node tests/unit-store.mjs
// Le chemin IndexedDB est couvert par tests/store-idb.mjs (Chromium).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = ['util.js', 'store.js'].map((f) => [f, readFileSync(join(root, 'src/js', f), 'utf8')]);

class FakeStorage {
  constructor(quota = 5e6) { this.m = new Map(); this.quota = quota; }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) {
    v = String(v);
    let size = 0;
    for (const [kk, vv] of this.m) if (kk !== k) size += kk.length + vv.length;
    if (size + k.length + v.length > this.quota) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
    this.m.set(k, v);
  }
  removeItem(k) { this.m.delete(k); }
}

function boot({ local, session, blockStorage } = {}) {
  const sb = { console, setTimeout, clearTimeout, crypto: globalThis.crypto, Blob, File, URL, addEventListener() {} };
  if (blockStorage) {
    Object.defineProperty(sb, 'localStorage', { get() { throw new Error('SecurityError'); } });
    Object.defineProperty(sb, 'sessionStorage', { get() { throw new Error('SecurityError'); } });
  } else {
    sb.localStorage = local || new FakeStorage();
    sb.sessionStorage = session || new FakeStorage();
  }
  sb.window = sb;
  vm.createContext(sb);
  for (const [f, src] of code) vm.runInContext(src, sb, { filename: f });
  return sb;
}

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, info) {
  if (cond) pass++;
  else { fail++; failures.push(name + (info !== undefined ? '  → ' + info : '')); }
}
async function rejects(promise, code) {
  try { await promise; return false; } catch (e) { return !code || e.code === code; }
}

/* ---------- réglages et clés ---------- */
{
  const local = new FakeStorage(), session = new FakeStorage();
  const sb = boot({ local, session });
  const S = sb.Souffleur;
  await S.store.init();
  check('backend localStorage sans IndexedDB', S.store.backend === 'localstorage', S.store.backend);

  const def = S.store.settings();
  check('réglages par défaut (SPEC)', JSON.stringify(def) === JSON.stringify({
    geminiKey: '', claudeKey: '', rememberKeys: true, provider: 'auto', models: { answer: 'auto', fast: 'auto', prep: 'auto' },
    theme: 'auto', fontScale: 1, lang: 'fr-FR', autoAnswer: true, answerDelayMs: 900, onboarded: false
  }), JSON.stringify(def));
  def.theme = 'dark';
  check('settings() renvoie une copie', S.store.settings().theme === 'auto');

  let evt = null;
  S.bus.on('settings:changed', (s) => { evt = s; });
  S.store.setSettings({ theme: 'dark', models: { answer: 'gemini-3-flash' } });
  check('setSettings fusion profonde', S.store.settings().models.fast === 'auto' && S.store.settings().models.answer === 'gemini-3-flash');
  check('setSettings persisté', JSON.parse(local.getItem('souffleur.settings')).theme === 'dark');
  check('événement settings:changed', evt && evt.theme === 'dark' && evt.changed.includes('theme') && !Object.keys(evt).includes('changed'));

  S.store.setSettings({ geminiKey: '  AIzaFAUSSE-CLE-DE-TEST  ' });
  check('clé rognée', S.store.settings().geminiKey === 'AIzaFAUSSE-CLE-DE-TEST');
  check('clé hors des réglages', !local.getItem('souffleur.settings').includes('AIza'));
  check('clé mémorisée (localStorage)', local.getItem('souffleur.keys').includes('AIzaFAUSSE') && !session.getItem('souffleur.keys'));

  S.store.setSettings({ rememberKeys: false });
  check('rememberKeys=false → sessionStorage', !local.getItem('souffleur.keys') && session.getItem('souffleur.keys').includes('AIzaFAUSSE'));
  check('clé toujours utilisable', S.store.settings().geminiKey === 'AIzaFAUSSE-CLE-DE-TEST');

  // nouvel onglet / nouvelle session de navigateur : sessionStorage vide
  const sb2 = boot({ local, session: new FakeStorage() });
  check('PC emprunté : clé oubliée à la fermeture', sb2.Souffleur.store.settings().geminiKey === '' && sb2.Souffleur.store.settings().theme === 'dark');

  S.store.setSettings({ rememberKeys: true });
  check('rememberKeys=true → retour en localStorage', local.getItem('souffleur.keys').includes('AIzaFAUSSE') && !session.getItem('souffleur.keys'));
  S.store.setKeys({ claudeKey: 'sk-ant-FAUSSE' });
  check('setKeys partiel', S.store.settings().claudeKey === 'sk-ant-FAUSSE' && S.store.settings().geminiKey === 'AIzaFAUSSE-CLE-DE-TEST');
  S.store.setSettings({ answerDelayMs: 'abc', fontScale: 99, provider: 'openai' });
  const s3 = S.store.settings();
  check('réglages assainis', s3.answerDelayMs === 900 && s3.fontScale === 2.5 && s3.provider === 'auto', JSON.stringify(s3));
  S.store.setSettings(JSON.parse('{"__proto__":{"polluted":true}}'));
  check('pas de pollution de prototype (réglages)', ({}).polluted === undefined && vm.runInContext("Object.prototype.polluted", sb) === undefined);
}

/* ---------- dossiers ---------- */
{
  const local = new FakeStorage();
  const sb = boot({ local });
  const S = sb.Souffleur;
  await S.store.init();
  const events = [];
  S.bus.on('store:changed', (e) => events.push(e.action));

  const d = await S.store.create({ company: 'Renault', role: 'Contrôleur de gestion', date: '2026-10-22T11:00' });
  check('create : valeurs par défaut', d.id && d.name === 'Renault — Contrôleur de gestion' && d.mode === 'visio' && Array.isArray(d.docs) &&
    d.prep === null && Array.isArray(d.sessions) && d.interviewer === '' && d.notes === '' && d.createdAt && d.updatedAt && d.date === '2026-10-22T11:00', JSON.stringify(d));
  check('create : persisté', (await S.store.get(d.id)).name === d.name);

  d.docs.push({ kind: 'cv', name: 'CV.pdf', text: 'Expérience…' });
  d.sessions.push({ kind: 'live', startedAt: new Date().toISOString(), transcript: [{ t: 1200, who: 'them', text: 'Présentez-vous' }], answers: [] });
  const transcriptRef = d.sessions[0].transcript;
  const before = d.updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  const ret = await S.store.save(d);
  check('save renvoie le même objet', ret === d && d.sessions[0].transcript === transcriptRef);
  check('save met à jour updatedAt', d.updatedAt > before);
  const got = await S.store.get(d.id);
  check('save : relu normalisé', got.docs[0].id && got.docs[0].kind === 'cv' && got.docs[0].addedAt && got.sessions[0].id &&
    got.sessions[0].scores === null && got.sessions[0].recap === null && got.sessions[0].transcript[0].who === 'them');

  const d2 = await S.store.create({ name: 'Second' });
  const list = await S.store.list();
  check('list triée (updatedAt desc)', list.length === 2 && list[0].id === d2.id, list.map((x) => x.name).join(','));
  await S.store.save(d);
  check('list après save', (await S.store.list())[0].id === d.id);
  check('événements store:changed', events.join(',') === 'create,save,create,save', events.join(','));

  // export / import
  S.store.setKeys({ geminiKey: 'AIzaCLE-A' });
  const blob = await S.store.exportFile(d, { includeKeys: false });
  const json = JSON.parse(await blob.text());
  check('export : format', json.format === 'souffleur' && json.version === 2 && json.exportedAt && json.dossier.id === d.id && !('keys' in json));
  check('export : nom de fichier', blob.name === 'Souffleur - Renault - 2026-10-22.souffleur.json', blob.name);
  const withKeys = JSON.parse(await (await S.store.exportFile(d, { includeKeys: true })).text());
  check('export avec clé', withKeys.keys && withKeys.keys.geminiKey === 'AIzaCLE-A');

  const imp = await S.store.importFile(blob);
  check('import : id existant → nouvel id', imp.id !== d.id && imp.name === d.name && imp.docs.length === 1 && imp.sessions[0].transcript.length === 1);
  check('import : .imported non énumérable', imp.imported.length === 1 && !Object.keys(imp).includes('imported'));
  check('import : 3 dossiers', (await S.store.list()).length === 3);

  // clés dans un import
  let keyEvt = null;
  S.bus.on('store:keys', (e) => { keyEvt = e; });
  const other = JSON.stringify({ format: 'souffleur', version: 2, dossier: { name: 'Avec clés' }, keys: { geminiKey: 'AIzaCLE-B', claudeKey: 'sk-ant-B' } });
  const ik = await S.store.importFile(other);
  check('import clés : vide → appliquée', S.store.settings().claudeKey === 'sk-ant-B' && ik.importedKeys.applied.includes('claudeKey'));
  check('import clés : différente → proposée', S.store.settings().geminiKey === 'AIzaCLE-A' && keyEvt && keyEvt.pending.geminiKey === 'AIzaCLE-B');
  keyEvt.apply();
  check('import clés : proposition acceptée', S.store.settings().geminiKey === 'AIzaCLE-B');

  // ancien format qr.json : { "titre": [{ q, k, a }] }
  const legacy = {
    'Candidatures/235. Chargé de mission gestion budgétaire': [
      { q: 'Présentez-vous', k: ['présentez', 'parcours'], a: '**Je suis…**\n- **Parcours** : …' },
      { q: 'Pourquoi ce poste ?', k: ['pourquoi', 'poste'], a: 'Parce que…' }
    ],
    'Candidatures/260. Responsable administratif et financier': [{ q: 'Vos défauts ?', k: ['défaut'], a: 'Je…' }]
  };
  const lg = await S.store.importFile(new File([JSON.stringify(legacy)], 'qr.json', { type: 'application/json' }));
  check('qr.json : un dossier par titre', lg.imported.length === 2, lg.imported.length);
  check('qr.json : nom nettoyé', lg.name === 'Chargé de mission gestion budgétaire' && lg.imported[1].name === 'Responsable administratif et financier', lg.name);
  check('qr.json : questions + tags', lg.prep.questions.length === 2 && lg.prep.questions[0].tags.join() === 'présentez,parcours' && lg.prep.questions[0].id);
  check('qr.json : pitch déduit', lg.prep.pitch.startsWith('**Je suis'));
  const arrImp = await S.store.importFile(JSON.stringify([{ q: 'Q1', a: 'R1' }, { question: 'Q2', answer: 'R2' }]));
  check('tableau [{q,a}]', arrImp.name === 'Réponses importées' && arrImp.prep.questions.length === 2 && arrImp.prep.questions[1].a === 'R2');
  const backup = JSON.parse(await (await S.store.exportAll()).text());
  check('exportAll', Array.isArray(backup.dossiers) && backup.dossiers.length === (await S.store.list()).length);

  check('import : JSON invalide', await rejects(S.store.importFile('{pas du json'), 'BAD_JSON'));
  check('import : format inconnu', await rejects(S.store.importFile('{"a":1}'), 'UNKNOWN_FORMAT'));
  check('import : vide', await rejects(S.store.importFile('   '), 'EMPTY'));
  await S.store.importFile('{"format":"souffleur","version":2,"dossier":{"name":"x","__proto__":{"evil":1},"constructor":{"prototype":{"evil2":1}}}}');
  check('pas de pollution de prototype (import)', ({}).evil === undefined && vm.runInContext("Object.prototype.evil === undefined && Object.prototype.evil2 === undefined", sb));

  // suppression
  await S.store.remove(d2.id);
  check('remove', (await S.store.get(d2.id)) === null);

  const u = await S.store.usage();
  check('usage', u.dossiers === (await S.store.list()).length && u.bytes > 0 && u.persistent === false && u.backend === 'localstorage', JSON.stringify(u));

  await S.store.clearAll();
  check('clearAll', (await S.store.list()).length === 0 && S.store.settings().geminiKey === '' && S.store.settings().theme === 'auto' &&
    [...local.m.keys()].every((k) => !k.startsWith('souffleur')));
}

/* ---------- quota dépassé ---------- */
{
  const sb = boot({ local: new FakeStorage(60000) });
  const S = sb.Souffleur;
  await S.store.init();
  const d = await S.store.create({ name: 'Gros' });
  d.docs.push({ kind: 'autre', name: 'énorme', text: 'x'.repeat(80000) });
  let e = null;
  try { await S.store.save(d); } catch (x) { e = x; }
  check('quota : erreur claire', e && e.code === 'QUOTA' && /Stockage plein/.test(e.message), e && e.message);
}

/* ---------- stockage bloqué : mode mémoire ---------- */
{
  const sb = boot({ blockStorage: true });
  const S = sb.Souffleur;
  let toast = null;
  S.bus.on('toast', (t) => { toast = t; });
  await S.store.init();
  check('stockage bloqué → mémoire', S.store.backend === 'memory');
  check('stockage bloqué → avertissement', toast && toast.kind === 'warn');
  const d = await S.store.create({ company: 'X' });
  check('mémoire : CRUD', (await S.store.get(d.id)).company === 'X' && (await S.store.list()).length === 1);
  S.store.setSettings({ geminiKey: 'k' });
  check('mémoire : réglages', S.store.settings().geminiKey === 'k');
}

console.log(`store.js : ${pass} réussis, ${fail} échoués`);
if (fail) { for (const f of failures) console.log('  ✗ ' + f); process.exit(1); }
