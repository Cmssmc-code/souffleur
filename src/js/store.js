/* Souffleur — store.js : dossiers d'entretien (IndexedDB, repli localStorage puis mémoire),
   réglages (localStorage), clés API (localStorage ou sessionStorage), import / export. */
(function (S) {
  'use strict';

  const U = S.util;
  const G = typeof globalThis !== 'undefined' ? globalThis : window;
  const store = S.store = S.store || {};

  const DB_NAME = 'souffleur';
  const DB_STORE = 'dossiers';
  const DB_VERSION = 1;
  const LS_SETTINGS = 'souffleur.settings';
  const KEYS_KEY = 'souffleur.keys';             // localStorage si « se souvenir », sinon sessionStorage
  const LS_DOSSIER = 'souffleur.dossier.';       // repli sans IndexedDB (+ secours si une écriture IDB échoue)
  const LS_JOURNAL = 'souffleur.journal';        // copie synchrone du dernier enregistrement (fermeture brutale)
  const JOURNAL_MAX = 1500000;
  const IMPORT_MAX = 10 * 1024 * 1024;

  const KINDS = ['offre', 'cv', 'prepa', 'autre'];
  const MODES = ['visio', 'tel', 'presentiel'];
  const WHO = ['them', 'me', 'mixed'];

  const DEFAULT_SETTINGS = {
    geminiKey: '', claudeKey: '', groqKey: '', rememberKeys: true, provider: 'auto',
    models: { answer: 'auto', fast: 'auto', prep: 'auto' },
    theme: 'auto', fontScale: 1, lang: 'fr-FR', autoAnswer: true, answerDelayMs: 900, onboarded: false
  };

  /* ------------------------------------------------------------------ *
   * Accès sûr à localStorage / sessionStorage (peuvent être bloqués)
   * ------------------------------------------------------------------ */
  function webStorage(type) {
    let st = null;
    try {
      st = G[type];
      st.setItem('__souffleur__', '1');
      st.removeItem('__souffleur__');
    } catch (e) { st = null; }
    const mem = new Map();
    return {
      ok: !!st,
      get(k) {
        try { if (st) return st.getItem(k); } catch (e) { /* bloqué */ }
        return mem.has(k) ? mem.get(k) : null;
      },
      /** écrit ; lève une erreur si le quota est dépassé */
      setStrict(k, v) {
        if (!st) { mem.set(k, String(v)); return; }
        st.setItem(k, v);
      },
      /** écrit sans jamais lever ; renvoie false si non persisté */
      set(k, v) {
        try { this.setStrict(k, v); return true; } catch (e) { mem.set(k, String(v)); return false; }
      },
      remove(k) {
        mem.delete(k);
        try { if (st) st.removeItem(k); } catch (e) { /* ignore */ }
      },
      keys() {
        const out = new Set(mem.keys());
        try { if (st) for (let i = 0; i < st.length; i++) out.add(st.key(i)); } catch (e) { /* ignore */ }
        return Array.from(out).filter((k) => k != null);
      }
    };
  }
  const LS = webStorage('localStorage');
  const SS = webStorage('sessionStorage');

  function readJSON(storage, key) {
    const raw = storage.get(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ *
   * Petits utilitaires
   * ------------------------------------------------------------------ */
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const str = (v) => (v == null ? '' : typeof v === 'string' ? v : String(v));
  const arr = (v) => (Array.isArray(v) ? v : []);
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  // Horloge strictement croissante : deux écritures dans la même milliseconde restent ordonnées.
  let lastStampMs = 0;
  const nowIso = () => { let t = Date.now(); if (t <= lastStampMs) t = lastStampMs + 1; lastStampMs = t; return new Date(t).toISOString(); };
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  function toIso(v, fallback) {
    if (v instanceof Date && !isNaN(v)) return v.toISOString();
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return new Date(v).toISOString();
    if (typeof v === 'string' && v && !isNaN(Date.parse(v))) return v;
    return fallback === undefined ? nowIso() : fallback;
  }
  function toMs(v) {
    if (typeof v === 'number') return v;
    const t = Date.parse(v);
    return isNaN(t) ? 0 : t;
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  /** date d'entretien : 'YYYY-MM-DDTHH:mm' (heure locale) ou '' */
  function normDate(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'string') {
      const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(v.trim());
      if (m && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(v.trim())) return m[1] + 'T' + (m[2] || '09:00');
    }
    const d = v instanceof Date ? v : new Date(typeof v === 'number' ? v : Date.parse(v));
    if (isNaN(d)) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function strList(v) {
    if (typeof v === 'string') v = v.split(/\n+/);
    return arr(v)
      .map((x) => (typeof x === 'string' ? x : isObj(x) ? str(x.text || x.q || x.label || x.value) : str(x)))
      .map((s) => s.replace(/^\s*(?:[-•*]|\d{1,2}[.)])\s+/, '').trim())
      .filter(Boolean);
  }
  function deepMerge(target, src) {
    if (!isObj(src)) return target;
    for (const k of Object.keys(src)) {
      if (UNSAFE_KEYS.has(k) || src[k] === undefined) continue;
      if (isObj(src[k]) && isObj(target[k])) deepMerge(target[k], src[k]);
      else target[k] = isObj(src[k]) ? deepMerge({}, src[k]) : src[k];
    }
    return target;
  }
  function err(message, code, cause) {
    const e = new Error(message);
    e.code = code;
    if (cause) e.cause = cause;
    return e;
  }
  function hidden(obj, key, value) {
    Object.defineProperty(obj, key, { value, enumerable: false, configurable: true, writable: true });
    return obj;
  }

  /* ------------------------------------------------------------------ *
   * Modèle Dossier : valeurs par défaut + nettoyage (tolérant)
   * ------------------------------------------------------------------ */
  function defaultName(d) {
    const parts = [d.company, d.role].map((x) => str(x).trim()).filter(Boolean);
    return parts.join(' — ') || 'Nouvel entretien';
  }

  // Identifiants sûrs (utilisés dans des sélecteurs CSS) et uniques dans une liste.
  const SAFE_ID = /^[\w-]{1,40}$/;
  function safeId(v) { const id = str(v); return SAFE_ID.test(id) ? id : U.uid(); }
  function uniqIds(list) {
    const seen = new Set();
    list.forEach((x) => { if (!SAFE_ID.test(x.id) || seen.has(x.id)) x.id = U.uid(); seen.add(x.id); });
    return list;
  }
  const DOC_MAX = 60000;
  let truncated = 0;
  function capText(t) {
    if (t.length <= DOC_MAX) return t;
    truncated++;
    try { if (S.docs && typeof S.docs.clean === 'function') { const c = S.docs.clean(t); if (c.length <= DOC_MAX + 200) return c; } } catch (e) { /* repli */ }
    return t.slice(0, DOC_MAX) + '\n\n[…] (document tronqué : trop long)';
  }

  function normQA(x) {
    if (typeof x === 'string') return x.trim() ? { id: U.uid(), q: x.trim(), a: '', tags: [] } : null;
    if (!isObj(x)) return null;
    const q = str(x.q != null ? x.q : x.question != null ? x.question : x.title).trim();
    const a = str(x.a != null ? x.a : x.answer != null ? x.answer : x.reponse != null ? x.reponse : x['réponse']);
    if (!q && !a.trim()) return null;
    return { id: safeId(x.id), q, a, tags: strList(x.tags || x.k || x.keywords), variants: strList(x.variants || x.v) };
  }

  function normPrep(p) {
    if (!isObj(p)) return null;
    return Object.assign({}, p, {
      pitch: str(p.pitch),
      questions: uniqIds(arr(p.questions).map(normQA).filter(Boolean)),
      askThem: strList(p.askThem),
      keyFacts: strList(p.keyFacts),
      watchouts: strList(p.watchouts),
      generatedAt: p.generatedAt ? toIso(p.generatedAt, '') : '',
      model: str(p.model)
    });
  }

  function normDoc(x) {
    return Object.assign({}, x, {
      id: safeId(x.id),
      kind: KINDS.includes(x.kind) ? x.kind : 'autre',
      name: str(x.name).trim() || 'Document',
      text: capText(str(x.text)),
      addedAt: toIso(x.addedAt),
      // Fichier d'origine (PDF mis en forme) à consulter tel quel : {name, mime, data base64}.
      file: isObj(x.file) && typeof x.file.data === 'string' && x.file.data
        ? { name: str(x.file.name) || 'document.pdf', mime: str(x.file.mime) || 'application/pdf', data: x.file.data } : null
    });
  }

  function normSession(s) {
    return Object.assign({}, s, {
      id: safeId(s.id),
      kind: s.kind === 'training' ? 'training' : 'live',
      startedAt: toIso(s.startedAt),
      endedAt: s.endedAt ? toIso(s.endedAt, null) : null,
      transcript: arr(s.transcript).filter(isObj).map((x) => Object.assign({}, x, {
        t: num(x.t), who: WHO.includes(x.who) ? x.who : 'mixed', text: str(x.text)
      })),
      answers: arr(s.answers).filter(isObj).map((x) => Object.assign({}, x, {
        t: num(x.t), question: str(x.question), answer: str(x.answer), source: x.source === 'prep' ? 'prep' : 'ai', model: str(x.model)
      })),
      scores: Array.isArray(s.scores) ? s.scores.filter(isObj).map((x) => Object.assign({}, x, {
        question: str(x.question), answer: str(x.answer), score: num(x.score), feedback: str(x.feedback)
      })) : null,
      recap: s.recap == null ? null : str(s.recap)
    });
  }

  function normDossier(input) {
    const d = isObj(input) ? input : {};
    const out = {};
    for (const k of Object.keys(d)) if (!UNSAFE_KEYS.has(k)) out[k] = d[k];
    out.id = safeId(d.id);
    out.company = str(d.company).trim();
    out.role = str(d.role).trim();
    out.name = str(d.name).trim() || defaultName(out);
    out.date = normDate(d.date);
    out.mode = MODES.includes(d.mode) ? d.mode : 'visio';
    out.interviewer = str(d.interviewer);
    out.notes = str(d.notes);
    // Lien de visio (Meet, Teams, Zoom…) : https uniquement.
    out.meetUrl = /^https:\/\/[^\s"'<>]+$/.test(str(d.meetUrl).trim()) ? str(d.meetUrl).trim() : '';
    out.docs = uniqIds(arr(d.docs).filter(isObj).map(normDoc));
    out.prep = normPrep(d.prep);
    out.sessions = uniqIds(arr(d.sessions).filter(isObj).map(normSession));
    out.createdAt = toIso(d.createdAt);
    out.updatedAt = toIso(d.updatedAt, out.createdAt);
    return out;
  }
  store.normalize = (d) => normDossier(clone(d));

  /* ------------------------------------------------------------------ *
   * Backends : IndexedDB > localStorage > mémoire
   * ------------------------------------------------------------------ */
  let backend = 'memory';
  let db = null;
  let initPromise = null;
  let initDone = false;
  let channel = null;
  let idbWarned = false;
  let journalStamp = '';
  const mem = new Map();

  function idbOpen(timeoutMs) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) { done = true; reject(err('IndexedDB ne répond pas.', 'IDB_TIMEOUT')); }
      }, timeoutMs);
      let req;
      try { req = G.indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { done = true; clearTimeout(timer); reject(e); return; }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(DB_STORE)) d.createObjectStore(DB_STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const d = req.result;
        if (done) { try { d.close(); } catch (e) { /* ignore */ } return; }
        done = true; clearTimeout(timer);
        d.onversionchange = () => { try { d.close(); } catch (e) { /* ignore */ } if (db === d) db = null; };
        d.onclose = () => { if (db === d) db = null; };
        resolve(d);
      };
      req.onerror = () => {
        if (done) return;
        done = true; clearTimeout(timer);
        reject(req.error || err('IndexedDB indisponible.', 'IDB_ERROR'));
      };
    });
  }

  async function getDb() {
    if (!db) db = await idbOpen(8000);
    return db;
  }

  /** exécute une requête dans une transaction ; rouvre la base une fois si la connexion a été fermée */
  async function idbRun(mode, fn) {
    for (let attempt = 0; ; attempt++) {
      const d = await getDb();
      try {
        return await new Promise((resolve, reject) => {
          const tx = mode === 'readwrite' ? d.transaction(DB_STORE, mode, { durability: 'strict' }) : d.transaction(DB_STORE, mode);
          const req = fn(tx.objectStore(DB_STORE));
          let result;
          if (req) req.onsuccess = () => { result = req.result; };
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => reject(tx.error || (req && req.error) || err('Erreur IndexedDB.', 'IDB_ERROR'));
          tx.onabort = () => reject(tx.error || err('Écriture interrompue.', 'IDB_ABORT'));
        });
      } catch (e) {
        if (attempt === 0 && e && (e.name === 'InvalidStateError' || e.name === 'TransactionInactiveError')) { db = null; continue; }
        throw e;
      }
    }
  }

  function lsRecords() {
    const out = [];
    for (const k of LS.keys()) {
      if (!k.startsWith(LS_DOSSIER)) continue;
      const r = readJSON(LS, k);
      if (isObj(r) && r.id) out.push(r);
    }
    return out;
  }

  function isQuota(e) {
    return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
  }
  function quotaError(cause) {
    return err('Stockage plein : exportez puis supprimez d\'anciens dossiers pour libérer de la place.', 'QUOTA', cause);
  }

  async function readAll() {
    let recs = [];
    if (backend === 'indexeddb') {
      recs = (await idbRun('readonly', (os) => os.getAll())) || [];
      // écritures de secours (IndexedDB en échec) : la plus récente gagne
      const extra = lsRecords();
      if (extra.length) {
        const byId = new Map(recs.map((r) => [r.id, r]));
        for (const r of extra) { const cur = byId.get(r.id); if (!cur || toMs(r.updatedAt) > toMs(cur.updatedAt)) byId.set(r.id, r); }
        recs = Array.from(byId.values());
      }
    } else if (backend === 'localstorage') {
      recs = lsRecords();
    } else {
      for (const json of mem.values()) { try { recs.push(JSON.parse(json)); } catch (e) { /* ignore */ } }
    }
    return recs.filter((r) => isObj(r) && r.id);
  }

  async function readOne(id) {
    if (!id) return null;
    id = String(id);
    let rec = null;
    if (backend === 'indexeddb') {
      rec = (await idbRun('readonly', (os) => os.get(id))) || null;
      const extra = readJSON(LS, LS_DOSSIER + id);
      if (isObj(extra) && (!rec || toMs(extra.updatedAt) > toMs(rec.updatedAt))) rec = extra;
    } else if (backend === 'localstorage') {
      rec = readJSON(LS, LS_DOSSIER + id);
    } else if (mem.has(id)) {
      try { rec = JSON.parse(mem.get(id)); } catch (e) { rec = null; }
    }
    return isObj(rec) ? rec : null;
  }

  function writeJournal(rec, json) {
    if (backend !== 'indexeddb' && initDone) return '';
    if (json.length > JOURNAL_MAX) { LS.remove(LS_JOURNAL); return ''; }
    const stamp = rec.id + '|' + rec.updatedAt + '|' + Math.random();
    if (LS.set(LS_JOURNAL, JSON.stringify({ stamp, dossier: rec }))) journalStamp = stamp;
    return stamp;
  }
  function clearJournal(stamp) {
    if (stamp && stamp === journalStamp) { LS.remove(LS_JOURNAL); journalStamp = ''; }
  }

  async function writeRecord(rec, json, stamp) {
    if (backend === 'indexeddb') {
      try {
        await idbRun('readwrite', (os) => os.put(rec));
        clearJournal(stamp);
        if (LS.get(LS_DOSSIER + rec.id) != null) LS.remove(LS_DOSSIER + rec.id);
        return;
      } catch (e) {
        if (isQuota(e)) throw quotaError(e);
        // IndexedDB en panne : secours localStorage pour ne rien perdre (réintégré au prochain démarrage)
        try { LS.setStrict(LS_DOSSIER + rec.id, json); } catch (e2) { throw isQuota(e2) ? quotaError(e2) : e; }
        clearJournal(stamp);
        if (!idbWarned) { idbWarned = true; U.toast('Base locale indisponible : sauvegarde de secours utilisée.', 'warn'); }
        return;
      }
    }
    if (backend === 'localstorage') {
      try { LS.setStrict(LS_DOSSIER + rec.id, json); } catch (e) { throw isQuota(e) ? quotaError(e) : e; }
      return;
    }
    mem.set(rec.id, json);
  }

  async function deleteRecord(id) {
    if (backend === 'indexeddb') await idbRun('readwrite', (os) => os.delete(id));
    LS.remove(LS_DOSSIER + id);
    mem.delete(id);
    const j = readJSON(LS, LS_JOURNAL);
    if (j && j.dossier && j.dossier.id === id) { LS.remove(LS_JOURNAL); journalStamp = ''; }
  }

  /** IndexedDB disponible : réintègre les copies localStorage (repli antérieur, secours, journal). */
  async function migrate() {
    const j = readJSON(LS, LS_JOURNAL);
    if (backend !== 'indexeddb') {
      // journal écrit avant la fin du démarrage : le rejouer s'il est plus récent
      if (j && isObj(j.dossier) && j.dossier.id && backend === 'localstorage') {
        const cur = readJSON(LS, LS_DOSSIER + j.dossier.id);
        if (!cur || toMs(j.dossier.updatedAt) > toMs(cur.updatedAt)) LS.set(LS_DOSSIER + j.dossier.id, JSON.stringify(normDossier(j.dossier)));
      }
      if (j && backend === 'localstorage') LS.remove(LS_JOURNAL);
      return;
    }
    const candidates = lsRecords();
    if (j && isObj(j.dossier) && j.dossier.id) candidates.push(j.dossier);
    for (const r of candidates) {
      try {
        const cur = await idbRun('readonly', (os) => os.get(String(r.id)));
        if (!cur || toMs(r.updatedAt) > toMs(cur.updatedAt)) await idbRun('readwrite', (os) => os.put(normDossier(r)));
        LS.remove(LS_DOSSIER + r.id);
      } catch (e) { /* on retentera au prochain démarrage */ }
    }
    if (j) LS.remove(LS_JOURNAL);
  }

  function setupSync() {
    try {
      channel = new BroadcastChannel('souffleur.store');
      channel.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === 'changed') S.bus.emit('store:changed', { id: m.id || null, action: m.action || 'save', dossier: null, remote: true });
      };
    } catch (e) { channel = null; }
    try {
      G.addEventListener('storage', (e) => {
        if (e.key === LS_SETTINGS || e.key === KEYS_KEY || e.key === null) {
          settingsCache = null;
          emitSettings(['*'], true);
        } else if (backend === 'localstorage' && e.key && e.key.startsWith(LS_DOSSIER)) {
          S.bus.emit('store:changed', { id: e.key.slice(LS_DOSSIER.length), action: 'save', dossier: null, remote: true });
        }
      });
    } catch (e) { /* pas de window */ }
  }

  function emitChanged(id, action, dossier, extra) {
    S.bus.emit('store:changed', Object.assign({ id: id || null, action, dossier: dossier || null }, extra || {}));
    try { if (channel) channel.postMessage({ type: 'changed', id, action }); } catch (e) { /* ignore */ }
  }

  function isChromium() {
    const nav = G.navigator || {};
    return !!nav.userAgentData || /Chrome|Chromium|Edg\//.test(nav.userAgent || '');
  }
  /** stockage persistant : silencieux sous Chrome/Edge ; ailleurs seulement à la demande (Firefox affiche une invite) */
  async function requestPersist(force) {
    try {
      const st = G.navigator && G.navigator.storage;
      if (!st || typeof st.persisted !== 'function') return false;
      if (await st.persisted()) return true;
      if (typeof st.persist !== 'function' || (!force && !isChromium())) return false;
      return !!(await st.persist());
    } catch (e) { return false; }
  }

  async function doInit() {
    settingsCache = null;
    store.settings();
    if (G.indexedDB) {
      try { db = await idbOpen(8000); backend = 'indexeddb'; } catch (e) {
        try { console.warn('[Souffleur] IndexedDB indisponible, repli localStorage :', e); } catch (_) { /* ignore */ }
      }
    }
    if (backend !== 'indexeddb') {
      backend = LS.ok ? 'localstorage' : 'memory';
      if (backend === 'memory') U.toast('Stockage bloqué par le navigateur : vos dossiers ne seront pas conservés après fermeture. Pensez à exporter.', 'warn');
    }
    await migrate();
    initDone = true;
    setupSync();
    requestPersist(false);
  }

  store.init = function () {
    if (!initPromise) {
      initPromise = doInit().catch((e) => {
        try { console.error('[Souffleur] store.init :', e); } catch (_) { /* ignore */ }
        if (backend === 'indexeddb' && !db) backend = LS.ok ? 'localstorage' : 'memory';
        initDone = true;
      });
    }
    return initPromise;
  };
  const ready = () => initPromise || store.init();

  Object.defineProperty(store, 'backend', { get: () => backend, enumerable: true, configurable: true });

  /* ------------------------------------------------------------------ *
   * API dossiers
   * ------------------------------------------------------------------ */
  store.list = async function () {
    await ready();
    const recs = await readAll();
    return recs.map(normDossier).sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt));
  };

  store.get = async function (id) {
    await ready();
    const rec = await readOne(id);
    return rec ? normDossier(rec) : null;
  };

  async function exists(id) {
    return !!(id && (await readOne(id)));
  }

  store.create = async function (partial) {
    await ready();
    const p = isObj(partial) ? clone(partial) : {};
    if (!p.id || (await exists(p.id))) p.id = U.uid();
    const now = nowIso();
    p.createdAt = now;
    p.updatedAt = now;
    const rec = normDossier(p);
    await writeRecord(rec, JSON.stringify(rec), '');
    emitChanged(rec.id, 'create', rec);
    return rec;
  };

  /** Enregistre le dossier (l'objet passé est conservé tel quel, seul updatedAt est mis à jour).
      Une copie est écrite de façon synchrone dans un journal localStorage avant l'écriture IndexedDB,
      pour survivre à une fermeture brutale pendant un entretien. */
  store.save = function (dossier) {
    if (!isObj(dossier)) return Promise.reject(err('Dossier invalide.', 'INVALID'));
    if (!dossier.id) dossier.id = U.uid();
    if (!dossier.createdAt) dossier.createdAt = nowIso();
    let ts = nowIso();
    if (dossier.updatedAt && ts <= dossier.updatedAt && toMs(dossier.updatedAt) - Date.now() < 5000) ts = new Date(toMs(dossier.updatedAt) + 1).toISOString();
    dossier.updatedAt = ts;
    let rec, json;
    try {
      rec = normDossier(JSON.parse(JSON.stringify(dossier)));
      json = JSON.stringify(rec);
    } catch (e) {
      return Promise.reject(err('Dossier impossible à enregistrer (données non sérialisables).', 'INVALID', e));
    }
    const stamp = writeJournal(rec, json);
    return ready().then(() => writeRecord(rec, json, stamp)).then(() => {
      emitChanged(rec.id, 'save', dossier);
      return dossier;
    });
  };

  store.remove = async function (id) {
    await ready();
    if (!id) return;
    await deleteRecord(String(id));
    emitChanged(String(id), 'remove', null);
  };

  /** Efface toutes les données Souffleur de cet appareil (dossiers, réglages, clés, caches). */
  store.clearAll = async function () {
    await ready();
    if (backend === 'indexeddb') { try { await idbRun('readwrite', (os) => os.clear()); } catch (e) { /* ignore */ } }
    mem.clear();
    for (const k of LS.keys()) if (k.startsWith('souffleur')) LS.remove(k);
    for (const k of SS.keys()) if (k.startsWith('souffleur')) SS.remove(k);
    journalStamp = '';
    settingsCache = null;
    emitChanged(null, 'clear', null);
    emitSettings(['*'], false);
  };

  /* ------------------------------------------------------------------ *
   * Réglages et clés
   * ------------------------------------------------------------------ */
  let settingsCache = null;

  const KEY_NAMES = ['geminiKey', 'claudeKey', 'groqKey'];
  function readKeys(remember) {
    const sess = readJSON(SS, KEYS_KEY) || {};
    const loc = remember ? readJSON(LS, KEYS_KEY) || {} : {};
    const out = {};
    KEY_NAMES.forEach((k) => { out[k] = str(loc[k] || sess[k]).trim(); });
    return out;
  }
  function writeKeys(keys, remember) {
    const empty = KEY_NAMES.every((k) => !keys[k]);
    const obj = {};
    KEY_NAMES.forEach((k) => { obj[k] = keys[k] || ''; });
    const json = JSON.stringify(obj);
    const [keep, drop] = remember ? [LS, SS] : [SS, LS];
    if (empty) keep.remove(KEYS_KEY); else keep.set(KEYS_KEY, json);
    drop.remove(KEYS_KEY);
  }

  function loadSettings() {
    const stored = readJSON(LS, LS_SETTINGS);
    const s = deepMerge(clone(DEFAULT_SETTINGS), isObj(stored) ? stored : {});
    s.rememberKeys = s.rememberKeys !== false;
    const keys = readKeys(s.rememberKeys);
    // ancienne version : clés éventuellement stockées dans les réglages
    s.geminiKey = keys.geminiKey || str(isObj(stored) && s.rememberKeys ? stored.geminiKey : '').trim();
    s.claudeKey = keys.claudeKey || str(isObj(stored) && s.rememberKeys ? stored.claudeKey : '').trim();
    s.groqKey = keys.groqKey || '';
    return s;
  }

  function sanitizeSettings(s) {
    s.geminiKey = str(s.geminiKey).trim();
    s.claudeKey = str(s.claudeKey).trim();
    s.groqKey = str(s.groqKey).trim();
    s.rememberKeys = s.rememberKeys !== false;
    if (!['auto', 'gemini', 'claude', 'groq'].includes(s.provider)) s.provider = 'auto';
    if (!['auto', 'light', 'dark'].includes(s.theme)) s.theme = 'auto';
    if (!isObj(s.models)) s.models = clone(DEFAULT_SETTINGS.models);
    for (const k of ['answer', 'fast', 'prep']) if (!s.models[k]) s.models[k] = 'auto';
    s.fontScale = U.clamp(Number(s.fontScale) || 1, 0.6, 2.5);
    s.answerDelayMs = U.clamp(Math.round(Number(s.answerDelayMs)), 0, 10000);
    if (!Number.isFinite(s.answerDelayMs)) s.answerDelayMs = DEFAULT_SETTINGS.answerDelayMs;
    s.autoAnswer = s.autoAnswer !== false;
    s.onboarded = !!s.onboarded;
    s.lang = str(s.lang) || 'fr-FR';
    return s;
  }

  function emitSettings(changed, remote) {
    const s = store.settings();
    hidden(s, 'changed', changed);
    hidden(s, 'remote', !!remote);
    S.bus.emit('settings:changed', s);
  }

  /** Réglages courants (copie, SYNCHRONE). */
  store.settings = function () {
    if (!settingsCache) settingsCache = sanitizeSettings(loadSettings());
    return clone(settingsCache);
  };

  /** Fusionne et persiste (SYNCHRONE). Les clés vont en sessionStorage si rememberKeys=false. */
  store.setSettings = function (patch) {
    const cur = settingsCache ? clone(settingsCache) : sanitizeSettings(loadSettings());
    const next = sanitizeSettings(deepMerge(clone(cur), isObj(patch) ? clone(patch) : {}));
    const persisted = clone(next);
    delete persisted.geminiKey;
    delete persisted.claudeKey;
    delete persisted.groqKey;
    if (!LS.set(LS_SETTINGS, JSON.stringify(persisted))) U.toast('Réglages non enregistrés durablement (stockage plein ou bloqué).', 'warn');
    writeKeys(next, next.rememberKeys);
    settingsCache = next;
    const changed = Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(cur[k]));
    if (changed.length) emitSettings(changed, false);
    return clone(next);
  };

  /** Enregistre les clés API fournies ({geminiKey?, claudeKey?}) selon le réglage « se souvenir ». (SYNCHRONE) */
  store.setKeys = function (keys) {
    const k = extractKeys(keys, true) || {};
    const patch = {};
    if ('geminiKey' in k) patch.geminiKey = k.geminiKey;
    if ('claudeKey' in k) patch.claudeKey = k.claudeKey;
    if ('groqKey' in k) patch.groqKey = k.groqKey;
    return store.setSettings(patch);
  };

  function extractKeys(k, allowEmpty) {
    if (!isObj(k)) return null;
    const out = {};
    const g = k.geminiKey != null ? k.geminiKey : k.gemini != null ? k.gemini : k.googleKey;
    const c = k.claudeKey != null ? k.claudeKey : k.claude != null ? k.claude : k.anthropicKey;
    if (typeof g === 'string' && (allowEmpty || g.trim())) out.geminiKey = g.trim();
    if (typeof c === 'string' && (allowEmpty || c.trim())) out.claudeKey = c.trim();
    const q = k.groqKey != null ? k.groqKey : k.groq;
    if (typeof q === 'string' && (allowEmpty || q.trim())) out.groqKey = q.trim();
    return Object.keys(out).length ? out : null;
  }

  /* ------------------------------------------------------------------ *
   * Export / import
   * ------------------------------------------------------------------ */
  function safeFilePart(s) {
    return str(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60);
  }
  /** Nom de fichier suggéré : « Souffleur - Entreprise - 2026-10-22.souffleur.json » */
  store.exportName = function (dossier, ext) {
    const d = isObj(dossier) ? dossier : {};
    const label = safeFilePart(d.company || d.name || 'dossier') || 'dossier';
    const day = (normDate(d.date) || nowIso()).slice(0, 10);
    return 'Souffleur - ' + label + ' - ' + day + (ext || '.souffleur.json');
  };

  function makeFile(json, name) {
    try { return new File([json], name, { type: 'application/json' }); } catch (e) {
      return new Blob([json], { type: 'application/json' });
    }
  }
  function currentKeys() {
    const s = store.settings();
    const keys = {};
    if (s.geminiKey) keys.geminiKey = s.geminiKey;
    if (s.claudeKey) keys.claudeKey = s.claudeKey;
    if (s.groqKey) keys.groqKey = s.groqKey;
    return Object.keys(keys).length ? keys : null;
  }

  /** -> Blob (File nommé quand c'est possible) : {format:'souffleur', version:2, exportedAt, dossier, keys?} */
  store.exportFile = async function (dossier, opts) {
    if (!isObj(dossier)) throw err('Aucun dossier à exporter.', 'INVALID');
    const payload = { format: 'souffleur', version: 2, exportedAt: nowIso(), dossier: normDossier(clone(dossier)) };
    if (opts && opts.includeKeys) { const k = currentKeys(); if (k) payload.keys = k; }
    return makeFile(JSON.stringify(payload, null, 1), store.exportName(dossier));
  };

  /** Sauvegarde complète : {format:'souffleur', version:2, exportedAt, dossiers:[…], keys?} */
  store.exportAll = async function (opts) {
    const dossiers = await store.list();
    const payload = { format: 'souffleur', version: 2, exportedAt: nowIso(), dossiers };
    if (opts && opts.includeKeys) { const k = currentKeys(); if (k) payload.keys = k; }
    return makeFile(JSON.stringify(payload, null, 1), 'Souffleur - sauvegarde - ' + nowIso().slice(0, 10) + '.souffleur.json');
  };

  async function readBlobText(blob) {
    if (typeof blob.text === 'function') return blob.text();
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(fr.error || err('Lecture du fichier impossible.', 'READ'));
      fr.readAsText(blob);
    });
  }

  function isQA(x) {
    if (!isObj(x)) return false;
    const q = x.q != null ? x.q : x.question;
    return typeof q === 'string' && !!q.trim();
  }
  function isDossierLike(x) {
    return isObj(x) && (Array.isArray(x.docs) || isObj(x.prep) || Array.isArray(x.sessions));
  }
  /** « Candidatures/235. Chargé de mission » -> « Chargé de mission » */
  function cleanTitle(t) {
    let s = str(t).split(/[\\/]/).pop() || '';
    s = s.replace(/\.(?:json|md|txt|docx?|pdf)$/i, '').replace(/^\s*\d{1,5}\s*[.)\-–—_]\s*/, '').replace(/[_]+/g, ' ').trim();
    return s;
  }
  function fromQA(title, list) {
    const questions = list.map(normQA).filter(Boolean);
    const pitchQ = questions.find((x) => /pr[ée]sente[zr]?[- ]vous|parlez[- ]moi de vous|pitch/i.test(x.q));
    const name = title || 'Réponses importées';
    return {
      name,
      role: title || '',
      prep: { pitch: pitchQ ? pitchQ.a : '', questions, askThem: [], keyFacts: [], watchouts: [], generatedAt: nowIso(), model: 'import' }
    };
  }

  function parseImport(data, fileName) {
    const base = cleanTitle(str(fileName).replace(/\.souffleur\.json$/i, ''));
    if (Array.isArray(data)) {
      const qa = data.filter(isQA);
      if (qa.length && qa.length >= data.length / 2 && !data.some(isDossierLike)) return { dossiers: [fromQA(base, qa)], keys: null };
      const ds = data.filter(isDossierLike);
      if (ds.length) return { dossiers: ds, keys: null };
      throw err('Ce fichier ne contient ni dossier ni questions/réponses reconnaissables.', 'UNKNOWN_FORMAT');
    }
    if (!isObj(data)) throw err('Format non reconnu.', 'UNKNOWN_FORMAT');
    const keys = extractKeys(data.keys, false);
    if (data.format === 'souffleur' || data.format === 'souffleur-backup' || isObj(data.dossier) || Array.isArray(data.dossiers)) {
      if (isObj(data.dossier)) return { dossiers: [data.dossier], keys };
      if (Array.isArray(data.dossiers)) return { dossiers: data.dossiers.filter(isObj), keys };
      throw err('Cet export Souffleur ne contient aucun dossier.', 'EMPTY');
    }
    if (isDossierLike(data)) return { dossiers: [data], keys };
    // ancien format qr.json : { "titre": [{ q, k, a }] }
    const groups = Object.keys(data)
      .filter((k) => !UNSAFE_KEYS.has(k) && Array.isArray(data[k]) && data[k].some(isQA))
      .map((k) => fromQA(cleanTitle(k) || base, data[k].filter(isQA)));
    if (groups.length) return { dossiers: groups, keys: null };
    throw err('Format non reconnu : attendu un export Souffleur (.souffleur.json) ou une liste de questions/réponses.', 'UNKNOWN_FORMAT');
  }

  /** Clés trouvées dans un import : appliquées si aucune clé n'est déjà configurée, sinon proposées (événement 'store:keys'). */
  function offerKeys(keys) {
    const cur = store.settings();
    const apply = {}, pending = {};
    for (const k of KEY_NAMES) {
      if (!keys[k] || keys[k] === cur[k]) continue;
      if (!cur[k]) apply[k] = keys[k]; else pending[k] = keys[k];
    }
    // Appareil sans aucune clé (PC emprunté, export ouvert ailleurs) : clés gardées pour cette session
    // seulement (sessionStorage). L'utilisateur peut ensuite choisir de s'en souvenir.
    const sessionOnly = KEY_NAMES.every((k) => !cur[k]) && Object.keys(apply).length > 0;
    if (Object.keys(apply).length) {
      if (sessionOnly) store.setSettings(Object.assign({ rememberKeys: false }, apply));
      else store.setKeys(apply);
    }
    const info = { applied: Object.keys(apply), pending, sessionOnly,
      remember: () => store.setSettings({ rememberKeys: true }) };
    if (info.applied.length || Object.keys(pending).length) {
      S.bus.emit('store:keys', Object.assign({ apply: () => store.setKeys(pending) }, info));
    }
    return info;
  }

  /** Importe un .souffleur.json (un dossier ou une sauvegarde), l'ancien qr.json ou un tableau [{q,a}].
      Renvoie le premier dossier importé ; propriétés non énumérables : .imported (tous), .importedKeys. */
  store.importFile = async function (input, opts) {
    opts = isObj(opts) ? opts : {};
    await ready();
    let data, text = null, fileName = '';
    if (input && typeof input === 'object' && typeof input.size === 'number' && (typeof input.text === 'function' || typeof input.slice === 'function')) {
      if (input.size > IMPORT_MAX) throw err('Fichier trop volumineux (plus de 10 Mo).', 'TOO_BIG');
      fileName = str(input.name);
      text = await readBlobText(input);
    } else if (typeof input === 'string') {
      text = input;
    } else if (isObj(input) || Array.isArray(input)) {
      data = clone(input);
    } else {
      throw err('Rien à importer.', 'EMPTY');
    }
    if (text !== null) {
      text = text.replace(/^﻿/, '').trim();
      if (!text) throw err('Le fichier est vide.', 'EMPTY');
      try { data = JSON.parse(text); } catch (e) {
        throw err('Fichier illisible : ce n\'est pas un export Souffleur (JSON invalide).', 'BAD_JSON', e);
      }
    }
    const parsed = parseImport(data, fileName);
    if (!parsed.dossiers.length) throw err('Aucun dossier à importer.', 'EMPTY');

    const saved = [];
    truncated = 0;
    for (const d of parsed.dossiers) {
      const rec = normDossier(d);
      // Identifiant libre : conservé (réimport d'un dossier supprimé). replace : met à jour le dossier
      // existant (export plus récent) ; sinon un identifiant déjà pris donne un nouveau dossier.
      if (!opts.replace && await exists(rec.id)) rec.id = U.uid();
      rec.updatedAt = opts.keepUpdatedAt && d.updatedAt ? toIso(d.updatedAt) : nowIso();
      await writeRecord(rec, JSON.stringify(rec), '');
      saved.push(rec);
    }
    if (truncated) U.toast(truncated > 1 ? `${truncated} documents trop longs ont été tronqués (60 000 caractères maximum).` : 'Un document trop long a été tronqué (60 000 caractères maximum).', 'warn');
    const first = saved[0];
    hidden(first, 'imported', saved);
    if (parsed.keys) hidden(first, 'importedKeys', offerKeys(parsed.keys));
    emitChanged(first.id, 'import', first, { count: saved.length });
    return first;
  };

  /** Occupation : {dossiers, bytes, persistent, quota, backend} (demande le stockage persistant). */
  store.usage = async function () {
    await ready();
    let recs = [];
    try { recs = await readAll(); } catch (e) { /* ignore */ }
    let bytes = 0, quota = 0;
    try {
      const st = G.navigator && G.navigator.storage;
      if (st && typeof st.estimate === 'function') { const e = await st.estimate(); bytes = e.usage || 0; quota = e.quota || 0; }
    } catch (e) { /* ignore */ }
    if (!bytes) bytes = recs.reduce((n, r) => n + JSON.stringify(r).length, 0) * (backend === 'localstorage' ? 2 : 1);
    const persistent = await requestPersist(true);
    return { dossiers: recs.length, bytes, persistent, quota, backend };
  };
})(window.Souffleur = window.Souffleur || {});
