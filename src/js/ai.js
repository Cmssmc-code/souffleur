(function (S) {
  'use strict';
  /* Souffleur — S.ai : fournisseurs IA (Gemini puis Claude), bascule multi-modèles,
     circuit breaker, streaming SSE, prompts (souffleur, prépa, récap, entraînement, transcription). */

  const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
  const CLAUDE_API = 'https://api.anthropic.com/v1';
  const GROQ_API = 'https://api.groq.com/openai/v1';
  const CLAUDE_VERSION = '2023-06-01';
  const CACHE_KEY = 'souffleur.models';
  const PROVIDERS = ['gemini', 'claude', 'groq'];
  const LABEL = { gemini: 'Gemini', claude: 'Claude', groq: 'Groq' };

  const FALLBACK = {
    gemini: ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-flash-latest',
      'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
    claude: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'claude-sonnet-4-5'],
    // Groq : uniquement de gros modèles (assez intelligents pour un entretien), jamais les « instant » / 8B.
    groq: ['moonshotai/kimi-k2-instruct-0905', 'moonshotai/kimi-k2-instruct', 'llama-3.3-70b-versatile', 'openai/gpt-oss-120b']
  };
  const WHISPER = ['whisper-large-v3-turbo', 'whisper-large-v3'];

  // Réglages internes (modifiables pour les tests ou le diagnostic).
  const config = {
    firstTokenMs: 9000,          // stream : délai max avant le 1er token visible
    totalMs: 25000,              // non-stream : délai max de la réponse complète
    idleMs: 20000,               // stream : silence max entre deux paquets après le 1er token
    budgetMs: 75000,             // durée max d'une cascade de bascules
    breakerMs: 5 * 60 * 1000,    // modèle en échec (429, 5xx, timeout) écarté 5 min
    notFoundMs: 6 * 3600 * 1000, // modèle inexistant (404) écarté 6 h
    discoverTtlMs: 12 * 3600 * 1000,
    discoverTimeoutMs: 8000,
    autoDiscover: true,
    contextChars: 30000
  };

  const breaker = new Map();     // "provider:model" -> {until, code}
  const noThinking = new Set();  // modèles qui refusent thinkingConfig
  const deadKeys = {};           // provider -> empreinte de la clé refusée (401/403)
  const lastDiscoverTry = { gemini: 0, claude: 0, groq: 0 };
  let lastOk = null;
  let discovering = null;

  /* ------------------------------------------------------------------ helpers */

  const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  function emit(evt, data) {
    try { if (S.bus && typeof S.bus.emit === 'function') S.bus.emit(evt, data); } catch (e) { /* bus optionnel */ }
  }

  function settings() {
    try { return (S.store && typeof S.store.settings === 'function' && S.store.settings()) || {}; } catch (e) { return {}; }
  }

  function keyOf(p) {
    const s = settings();
    const k = p === 'gemini' ? s.geminiKey : p === 'claude' ? s.claudeKey : p === 'groq' ? s.groqKey : '';
    return typeof k === 'string' ? k.trim() : '';
  }

  function fingerprint(k) {
    if (!k) return '';
    let h = 5381;
    for (let i = 0; i < k.length; i++) h = (((h << 5) + h) + k.charCodeAt(i)) >>> 0;
    return h.toString(36) + '.' + k.length;
  }

  function uid() {
    try { if (S.util && typeof S.util.uid === 'function') return S.util.uid(); } catch (e) { /* repli */ }
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function fmtTime(ms) {
    try { if (S.util && typeof S.util.fmtTime === 'function') return S.util.fmtTime(ms); } catch (e) { /* repli */ }
    const s = Math.max(0, Math.floor((ms || 0) / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function norm(s) {
    try { if (S.util && typeof S.util.norm === 'function') return S.util.norm(s); } catch (e) { /* repli */ }
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function similarity(a, b) {
    try { if (S.util && typeof S.util.similarity === 'function') return S.util.similarity(a, b); } catch (e) { /* repli */ }
    const A = new Set(norm(a).split(' ').filter(w => w.length > 2));
    const B = new Set(norm(b).split(' ').filter(w => w.length > 2));
    if (!A.size || !B.size) return 0;
    let inter = 0;
    A.forEach(w => { if (B.has(w)) inter++; });
    return inter / (A.size + B.size - inter);
  }

  function lsGet(k) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* quota ou mode privé */ }
  }

  function clip(s, max) {
    s = String(s == null ? '' : s);
    return s.length > max ? s.slice(0, Math.max(0, max - 1)).trimEnd() + '…' : s;
  }

  function stripMd(s) {
    return String(s || '').replace(/\*\*/g, '').replace(/^\s*[-•*]\s+/, '').trim();
  }

  function firstLine(s) {
    const l = String(s || '').split('\n').map(x => x.trim()).filter(Boolean)[0] || '';
    return stripMd(l);
  }

  /* ------------------------------------------------------------------ erreurs */

  function aiError(code, message, extra) {
    const e = new Error(message);
    e.name = 'AIError';
    e.code = code;
    if (extra) Object.keys(extra).forEach(k => { e[k] = extra[k]; });
    return e;
  }

  function abortError() {
    const e = new Error('Requête annulée.');
    e.name = 'AbortError';
    e.code = 'ABORTED';
    return e;
  }

  function isAbort(e) {
    return !!e && (e.name === 'AbortError' || e.code === 'ABORTED');
  }

  function frMessage(code, provider, status, detail) {
    const L = LABEL[provider] || 'IA';
    switch (code) {
      case 'KEY': return 'Clé ' + L + ' refusée' + (status ? ' (' + status + ')' : '') + ' — vérifiez-la dans les réglages.';
      case 'QUOTA': return 'Quota ' + L + ' atteint (429).';
      case 'NOT_FOUND': return 'Modèle ' + L + ' indisponible (404).';
      case 'SERVER': return 'Service ' + L + ' surchargé ou en panne' + (status ? ' (' + status + ')' : '') + '.';
      case 'BAD_REQUEST': return 'Requête refusée par ' + L + (status ? ' (' + status + ')' : '') + (detail ? ' : ' + clip(detail, 140) : '') + '.';
      case 'TIMEOUT': return L + ' ne répond pas assez vite.';
      case 'NETWORK': return 'Connexion à ' + L + ' impossible (réseau).';
      case 'BLOCKED': return 'Réponse bloquée par le filtre de sécurité ' + L + '.';
      case 'EMPTY': return 'Réponse vide de ' + L + '.';
      default: return 'Erreur ' + L + (status ? ' (' + status + ')' : '') + (detail ? ' : ' + clip(detail, 140) : '') + '.';
    }
  }

  // Délai conseillé par le service avant de réessayer (Gemini RetryInfo.retryDelay « 37s » ou en-tête Retry-After).
  function parseRetryAfter(j, header) {
    let ms = 0;
    try {
      const det = (j && j.error && Array.isArray(j.error.details)) ? j.error.details : [];
      det.forEach(d => {
        const v = d && (d.retryDelay || d.retry_delay);
        const m = v && String(v).match(/^(\d+(?:\.\d+)?)s$/);
        if (m) ms = Math.max(ms, Math.round(parseFloat(m[1]) * 1000));
      });
    } catch (e) { /* rien */ }
    if (!ms && header) {
      const h = String(header).trim();
      if (/^\d+(?:\.\d+)?$/.test(h)) ms = Math.round(parseFloat(h) * 1000);
      else { const t = Date.parse(h); if (!isNaN(t)) ms = Math.max(0, t - Date.now()); }
    }
    return ms > 0 ? Math.min(ms, 120000) : 0;
  }

  function httpError(provider, model, status, body, retryHeader) {
    const raw = String(body || '');
    let detail = '';
    let parsed = null;
    try {
      const j = JSON.parse(raw);
      parsed = j;
      detail = (j.error && (j.error.message || j.error.type || j.error.status)) || j.message || '';
    } catch (e) { detail = raw.slice(0, 300); }
    const keySignal = /API_KEY_INVALID|API key not valid|API key expired|api[_ -]?key|x-api-key|leaked|has not been used|SERVICE_DISABLED|CONSUMER_INVALID|authentication_error|billing/i.test(raw);
    const keyBad = status === 401 || status === 403 || (status === 400 && keySignal);
    let code;
    if (keyBad) code = 'KEY';
    else if (status === 429) code = 'QUOTA';
    else if (status === 404) code = 'NOT_FOUND';
    else if (status === 408 || status >= 500) code = 'SERVER';
    else if (status === 400 || status === 413 || status === 422) code = 'BAD_REQUEST';
    else code = 'HTTP';
    // keyStrong = la clé elle-même est en cause (sinon un 403 peut ne viser qu'un modèle).
    const extra = { status, provider, model, keyStrong: status === 401 || keySignal, detail: String(detail || raw).slice(0, 500) };
    if (code === 'QUOTA') extra.retryAfterMs = parseRetryAfter(parsed, retryHeader);
    return aiError(code, frMessage(code, provider, status, detail), extra);
  }

  function claudeErrStatus(type) {
    switch (type) {
      case 'overloaded_error': return 529;
      case 'rate_limit_error': return 429;
      case 'authentication_error': return 401;
      case 'permission_error': return 403;
      case 'not_found_error': return 404;
      case 'invalid_request_error': return 400;
      case 'request_too_large': return 413;
      default: return 500;
    }
  }

  /* ------------------------------------------------- tentative (abort, timers) */

  function makeAttempt(outer, provider, model, streaming) {
    const ctrl = new AbortController();
    let timer = null;
    let firstPending = false;
    const att = { provider, model, signal: ctrl.signal, reason: null, idleMs: config.idleMs, partial: '', first: 0, streaming: !!streaming };
    const abort = (why) => { if (!att.reason) att.reason = why; try { ctrl.abort(); } catch (e) { /* déjà annulé */ } };
    const onOuter = () => abort('user');
    if (outer) { if (outer.aborted) abort('user'); else outer.addEventListener('abort', onOuter); }
    const set = (ms) => { clearTimeout(timer); timer = setTimeout(() => abort('timeout'), ms); };
    att.arm = (ms, waitFirst) => { firstPending = !!waitFirst; set(ms); };
    att.alive = () => { if (att.streaming && !firstPending && att.first) set(att.idleMs); };
    att.gotFirst = () => { if (firstPending) { firstPending = false; set(att.idleMs); } };
    att.abortErr = () => att.reason === 'timeout'
      ? aiError('TIMEOUT', frMessage('TIMEOUT', provider), { provider, model })
      : abortError();
    att.done = () => { clearTimeout(timer); if (outer) outer.removeEventListener('abort', onOuter); };
    return att;
  }

  // Course entre une promesse et l'annulation de la tentative (au cas où le flux ignore le signal).
  function guard(p, att) {
    return new Promise((resolve, reject) => {
      if (att.signal.aborted) { p.then(() => {}, () => {}); reject(att.abortErr()); return; }
      const onAbort = () => reject(att.abortErr());
      att.signal.addEventListener('abort', onAbort);
      p.then(v => { att.signal.removeEventListener('abort', onAbort); resolve(v); },
        e => { att.signal.removeEventListener('abort', onAbort); reject(e); });
    });
  }

  async function doFetch(url, init, att) {
    let res;
    try {
      res = await guard(fetch(url, Object.assign({}, init, { signal: att.signal })), att);
    } catch (e) {
      if (att.reason) throw att.abortErr();
      throw aiError('NETWORK', frMessage('NETWORK', att.provider), { provider: att.provider, model: att.model, detail: String((e && e.message) || e) });
    }
    if (!res.ok) {
      let txt = '';
      try { txt = await guard(res.text(), att); } catch (e) { if (att.reason) throw att.abortErr(); }
      let ra = '';
      try { ra = (res.headers && res.headers.get && res.headers.get('retry-after')) || ''; } catch (e) { /* rien */ }
      throw httpError(att.provider, att.model, res.status, txt, ra);
    }
    return res;
  }

  async function readText(res, att) {
    try { return await guard(res.text(), att); } catch (e) {
      if (att.reason) throw att.abortErr();
      throw aiError('NETWORK', frMessage('NETWORK', att.provider), { provider: att.provider, model: att.model });
    }
  }

  async function readJSON(res, att) {
    const txt = await readText(res, att);
    try { return JSON.parse(txt); } catch (e) {
      throw aiError('SERVER', frMessage('SERVER', att.provider, 0, 'réponse illisible'), { provider: att.provider, model: att.model });
    }
  }

  // Lecteur SSE générique : appelle onData(chaîne data) à chaque événement complet.
  async function readSSE(res, att, onData) {
    const body = res.body;
    let data = [];
    const dispatch = () => { if (!data.length) return; const d = data.join('\n'); data = []; onData(d); };
    const line = (ln) => {
      if (ln.endsWith('\r')) ln = ln.slice(0, -1);
      if (ln === '') { dispatch(); return; }
      if (ln.charAt(0) === ':') return;
      if (ln.startsWith('data:')) data.push(ln.charAt(5) === ' ' ? ln.slice(6) : ln.slice(5));
    };
    if (!body || typeof body.getReader !== 'function') {
      (await readText(res, att)).split('\n').forEach(line);
      dispatch();
      return;
    }
    const reader = body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        let r;
        try { r = await guard(reader.read(), att); } catch (e) {
          if (att.reason) throw att.abortErr();
          throw aiError('NETWORK', frMessage('NETWORK', att.provider), { provider: att.provider, model: att.model, detail: String((e && e.message) || e) });
        }
        if (r.done) break;
        att.alive();
        buf += dec.decode(r.value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { const ln = buf.slice(0, i); buf = buf.slice(i + 1); line(ln); }
      }
      buf += dec.decode();
      if (buf) buf.split('\n').forEach(line);
      dispatch();
    } catch (e) {
      try { const p = reader.cancel(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* rien */ }
      throw e;
    }
  }

  /* ------------------------------------------------------------- choix modèles */

  function readCache() {
    const c = lsGet(CACHE_KEY);
    return (c && typeof c === 'object') ? c : {};
  }

  const EXCLUDE_GEMINI = /image|tts|embed|live|audio|aqa|learnlm|gemma|vision|robotics|computer-use|veo|imagen|lyria|banana|nano|thinking|research|-exp|exp-|customtools|search|translate/i;

  function geminiInfo(id) {
    id = String(id || '').replace(/^models\//, '');
    if (!/^gemini-/.test(id) || EXCLUDE_GEMINI.test(id)) return null;
    let ver, rest;
    const m = id.match(/^gemini-(\d+(?:\.\d+)?)-(.+)$/);
    if (m) { ver = parseFloat(m[1]); rest = m[2]; } else if (/^gemini-(flash|flash-lite|pro)-latest$/.test(id)) { ver = 2.9; rest = id.slice(7); } else return null;
    if (ver < 2) return null;
    const tier = /lite/.test(rest) ? 'lite' : /flash/.test(rest) ? 'flash' : /pro/.test(rest) ? 'pro' : null;
    if (!tier) return null;
    const preview = /preview/.test(rest);
    const dated = /\d{2}-\d{2,4}|-\d{3}$/.test(rest);
    return { id, ver, tier, score: ver * 100 - (preview ? 2 : 0) - (dated ? 1 : 0) };
  }

  function claudeInfo(id) {
    id = String(id || '');
    let m = id.match(/^claude-(haiku|sonnet|opus)-(\d+)(?:-(\d))?(?:-(\d{8}))?$/);
    if (m) return { id, family: m[1], ver: +m[2] + (m[3] ? +m[3] / 10 : 0), dated: !!m[4] };
    m = id.match(/^claude-(\d)(?:-(\d))?-(haiku|sonnet|opus)(?:-(\d{8}|latest))?$/);
    if (m) return { id, family: m[3], ver: +m[1] + (m[2] ? +m[2] / 10 : 0), dated: !!m[4] && m[4] !== 'latest' };
    return null;
  }

  // Groq : on ne garde que les gros modèles généralistes, classés par qualité de réponse.
  const EXCLUDE_GROQ = /whisper|guard|tts|playai|orpheus|compound|distil|instant|safeguard|allam|-8b|-1b|-3b|mini|scout|20b/i;
  function groqInfo(id) {
    id = String(id || '');
    if (!id || EXCLUDE_GROQ.test(id)) return null;
    const score = /kimi-k2/.test(id) ? 90 : /gpt-oss-120b/.test(id) ? 84 : /llama-3\.3-70b/.test(id) ? 80 : /llama-4-maverick/.test(id) ? 78 : /qwen3-32b/.test(id) ? 70 : 0;
    return score ? { id, score: score + (/\d{4}$/.test(id) ? 1 : 0) } : null;
  }
  function rankGroq(ids) {
    return (ids || []).map(groqInfo).filter(Boolean).sort((a, b) => b.score - a.score).map(i => i.id).slice(0, 3);
  }

  function bestPerVersion(infos, scoreFn) {
    const by = {};
    infos.forEach(i => {
      const k = (i.tier || i.family) + '@' + i.ver;
      if (!by[k] || scoreFn(i) > scoreFn(by[k])) by[k] = i;
    });
    return Object.keys(by).map(k => by[k]).sort((a, b) => scoreFn(b) - scoreFn(a));
  }

  function rankGemini(ids, purpose) {
    const infos = (ids || []).map(geminiInfo).filter(Boolean);
    const tier = t => bestPerVersion(infos.filter(i => i.tier === t), i => i.score).map(i => i.id);
    const flash = tier('flash');
    const lite = tier('lite');
    const pro = bestPerVersion(infos.filter(i => i.tier === 'pro' && i.ver >= 2.5), i => i.score).map(i => i.id);
    if (purpose === 'fast') return lite.slice(0, 3).concat(flash.slice(0, 3));
    if (purpose === 'prep') return flash.slice(0, 4).concat(pro.slice(0, 1), lite.slice(0, 1));
    return flash.slice(0, 5).concat(lite.slice(0, 2));
  }

  function rankClaude(ids, purpose) {
    const infos = (ids || []).map(claudeInfo).filter(i => i && i.ver >= 3.5 && i.family !== 'opus');
    const fam = f => bestPerVersion(infos.filter(i => i.family === f), i => i.ver * 10 - (i.dated ? 0.5 : 0)).map(i => i.id);
    const haiku = fam('haiku');
    const sonnet = fam('sonnet');
    if (purpose === 'prep') return sonnet.slice(0, 2).concat(haiku.slice(0, 1));
    return haiku.slice(0, 2).concat(sonnet.slice(0, 1));
  }

  function usable(p, ids) {
    if (p === 'groq') return rankGroq(ids);
    if (p === 'gemini') {
      return (ids || []).map(geminiInfo).filter(Boolean)
        .sort((a, b) => (a.tier === b.tier ? b.score - a.score : ['flash', 'lite', 'pro'].indexOf(a.tier) - ['flash', 'lite', 'pro'].indexOf(b.tier)))
        .map(i => i.id);
    }
    return (ids || []).map(claudeInfo).filter(i => i && i.ver >= 3.5)
      .sort((a, b) => (a.family === b.family ? b.ver - a.ver : ['haiku', 'sonnet', 'opus'].indexOf(a.family) - ['haiku', 'sonnet', 'opus'].indexOf(b.family)))
      .map(i => i.id);
  }

  function modelsFor(p) {
    const c = readCache()[p];
    const k = keyOf(p);
    if (c && Array.isArray(c.ids) && c.ids.length && (!k || c.fp === fingerprint(k))) return c.ids;
    return FALLBACK[p];
  }

  function providerOrder(s) {
    const pref = (s || settings()).provider;
    if (pref === 'claude') return ['claude', 'gemini', 'groq'];
    if (pref === 'groq') return ['groq', 'gemini', 'claude'];
    return ['gemini', 'claude', 'groq'];
  }

  function settingPurpose(purpose) {
    return purpose === 'fast' ? 'fast' : purpose === 'prep' ? 'prep' : 'answer';
  }

  function parseModelRef(ref) {
    if (!ref) return null;
    const provOf = (m) => /^claude/.test(m) ? 'claude' : /^gemini|^models\//.test(m) ? 'gemini' : 'groq';
    if (typeof ref === 'object' && ref.model) return { provider: ref.provider || provOf(ref.model), model: ref.model };
    const s = String(ref).trim();
    if (!s || s === 'auto') return null;
    const m = s.match(/^(gemini|claude|groq):(.+)$/);
    if (m) return { provider: m[1], model: m[2] };
    return { provider: provOf(s), model: s.replace(/^models\//, '') };
  }

  function rankAll(purpose, keysOnly) {
    const s = settings();
    const provs = providerOrder(s).filter(p => !keysOnly || keyOf(p));
    let list = [];
    provs.forEach(p => {
      const ids = modelsFor(p);
      (p === 'gemini' ? rankGemini(ids, purpose) : p === 'claude' ? rankClaude(ids, purpose) : rankGroq(ids)).forEach(m => list.push({ provider: p, model: m }));
    });
    const pref = parseModelRef(s.models && s.models[settingPurpose(purpose)]);
    if (pref && (!keysOnly || keyOf(pref.provider))) {
      list = [pref].concat(list.filter(c => !(c.provider === pref.provider && c.model === pref.model)));
    }
    return list;
  }

  const bk = c => c.provider + ':' + c.model;

  function order(list) {
    const t = Date.now();
    return list.map((c, i) => {
      let pen = 0;
      const b = breaker.get(bk(c));
      if (b) { if (b.until > t) pen += 1000; else breaker.delete(bk(c)); }
      const dk = deadKeys[c.provider];
      if (dk && dk === fingerprint(keyOf(c.provider))) pen += 2000;
      return { c, s: i + pen };
    }).sort((a, b) => a.s - b.s).map(x => x.c);
  }

  function trip(c, ms, code) {
    breaker.set(bk(c), { until: Date.now() + ms, code });
  }

  function partMime(p) {
    const d = p && (p.inline_data || p.inlineData);
    return d ? String(d.mime_type || d.mimeType || '') : '';
  }

  function claudeMediaOk(mime) {
    return mime === 'application/pdf' || /^image\/(png|jpeg|gif|webp)$/.test(mime);
  }

  function supportsParts(provider, parts) {
    if (provider === 'gemini') return true;
    if (provider === 'groq') return (parts || []).every(p => p && typeof p.text === 'string');
    return (parts || []).every(p => p && (typeof p.text === 'string' || claudeMediaOk(partMime(p))));
  }

  function pick(purpose) {
    const anyKey = PROVIDERS.some(p => keyOf(p));
    return order(rankAll(purpose || 'answer', anyKey));
  }

  function candidates(o) {
    let list = rankAll(o.purpose || 'answer', true);
    if (o.providers) list = list.filter(c => o.providers.indexOf(c.provider) >= 0);
    if (o.parts && o.parts.length) list = list.filter(c => supportsParts(c.provider, o.parts));
    if (o.liteOnly) {
      // Transcription : uniquement les modèles « lite » (quota distinct), sauf choix explicite dans les réglages,
      // pour ne jamais épuiser le quota des modèles qui servent aux réponses.
      const pref = parseModelRef(settings().models && settings().models[settingPurpose(o.purpose)]);
      const keep = list.filter(c => /lite/i.test(c.model) || (pref && c.provider === pref.provider && c.model === pref.model));
      // Les autres modèles restent en dernier recours (quota des « lite » épuisé) : mieux vaut entamer le quota
      // des réponses que perdre la voix du recruteur en plein entretien.
      list = keep.length ? keep.concat(list.filter(c => keep.indexOf(c) < 0)) : list;
    }
    const forced = parseModelRef(o.model);
    if (forced && keyOf(forced.provider) && (!o.providers || o.providers.indexOf(forced.provider) >= 0)) {
      list = [forced].concat(list.filter(c => !(c.provider === forced.provider && c.model === forced.model)));
    }
    return o.ignoreBreaker ? list : order(list);
  }

  function thinkingFor(model) {
    const m = String(model || '');
    if (/^gemini-([3-9]|\d{2,})/.test(m)) return { thinkingLevel: 'low' };
    if (/2\.5/.test(m)) return /pro/.test(m) ? { thinkingBudget: 128 } : { thinkingBudget: 0 };
    return null;
  }

  /* -------------------------------------------------------------- découverte */

  async function listGemini(key) {
    const ids = [];
    let token = '';
    for (let page = 0; page < 4; page++) {
      const att = makeAttempt(null, 'gemini', 'models', false);
      att.arm(config.discoverTimeoutMs, false);
      try {
        const res = await doFetch(GEMINI_API + '/models?pageSize=200' + (token ? '&pageToken=' + encodeURIComponent(token) : ''),
          { method: 'GET', headers: { 'x-goog-api-key': key } }, att);
        const j = await readJSON(res, att);
        (j.models || []).forEach(m => {
          const methods = m.supportedGenerationMethods;
          if (!methods || methods.indexOf('generateContent') >= 0) ids.push(String(m.name || '').replace(/^models\//, ''));
        });
        token = j.nextPageToken || '';
      } finally { att.done(); }
      if (!token) break;
    }
    return ids;
  }

  async function listGroq(key) {
    const att = makeAttempt(null, 'groq', 'models', false);
    att.arm(config.discoverTimeoutMs, false);
    try {
      const res = await doFetch(GROQ_API + '/models', { method: 'GET', headers: { Authorization: 'Bearer ' + key } }, att);
      const j = await readJSON(res, att);
      return (j.data || []).filter(m => m && m.id && m.active !== false).map(m => String(m.id));
    } finally { att.done(); }
  }

  async function listClaude(key) {
    const ids = [];
    let after = '';
    for (let page = 0; page < 4; page++) {
      const att = makeAttempt(null, 'claude', 'models', false);
      att.arm(config.discoverTimeoutMs, false);
      try {
        const res = await doFetch(CLAUDE_API + '/models?limit=100' + (after ? '&after_id=' + encodeURIComponent(after) : ''),
          { method: 'GET', headers: claudeHeaders(key, false) }, att);
        const j = await readJSON(res, att);
        (j.data || []).forEach(m => { if (m && m.id) ids.push(String(m.id)); });
        after = j.has_more ? (j.last_id || '') : '';
      } finally { att.done(); }
      if (!after) break;
    }
    return ids;
  }

  function discover(opts) {
    opts = opts || {};
    if (discovering && !opts.force) return discovering;
    const run = (async () => {
      const cache = readCache();
      const out = { gemini: [], claude: [], groq: [] };
      for (const p of PROVIDERS) {
        const k = keyOf(p);
        if (!k) continue;
        const fp = fingerprint(k);
        const c = cache[p];
        const fresh = c && c.fp === fp && Array.isArray(c.ids) && c.ids.length && (Date.now() - (c.at || 0) < config.discoverTtlMs);
        if (fresh && !opts.force) { out[p] = c.ids; continue; }
        lastDiscoverTry[p] = Date.now();
        try {
          const ids = usable(p, p === 'gemini' ? await listGemini(k) : p === 'claude' ? await listClaude(k) : await listGroq(k));
          if (ids.length) cache[p] = { at: Date.now(), fp, ids };
          out[p] = ids.length ? ids : (c && c.fp === fp && c.ids) || [];
        } catch (e) {
          if (e && e.code === 'KEY') {
            deadKeys[p] = fp;
            emit('ai:keyerror', { provider: p, status: e.status, message: e.message });
          }
          out[p] = (c && c.fp === fp && c.ids) || [];
        }
      }
      lsSet(CACHE_KEY, cache);
      return out;
    })();
    discovering = run;
    run.then(() => { if (discovering === run) discovering = null; }, () => { if (discovering === run) discovering = null; });
    return run;
  }

  function maybeAutoDiscover() {
    if (!config.autoDiscover || discovering) return;
    const cache = readCache();
    const t = Date.now();
    const stale = PROVIDERS.some(p => {
      const k = keyOf(p);
      if (!k) return false;
      const c = cache[p];
      const ok = c && c.fp === fingerprint(k) && (t - (c.at || 0) < config.discoverTtlMs);
      return !ok && t - lastDiscoverTry[p] > 10 * 60 * 1000;
    });
    if (stale) discover().catch(() => {});
  }

  /* ---------------------------------------------------------------- Gemini */

  function geminiBody(model, o, v) {
    const gc = {};
    if (typeof o.temperature === 'number') gc.temperature = o.temperature;
    let max = v.maxTokens || o.maxTokens || 1024;
    const th = v.thinking ? thinkingFor(model) : null;
    if (th) {
      gc.thinkingConfig = th;
      // La réflexion consomme le même budget que la réponse : marge large (on ne paie que ce qui est utilisé).
      if (th.thinkingLevel) max += 8192; else if (th.thinkingBudget) max += th.thinkingBudget * 2;
    }
    gc.maxOutputTokens = max;
    if (o.json) gc.responseMimeType = 'application/json';
    const contents = [];
    const add = (role, parts) => {
      const last = contents[contents.length - 1];
      if (last && last.role === role) last.parts = last.parts.concat(parts); else contents.push({ role, parts });
    };
    (o.history || []).forEach(h => {
      if (h && h.text) add(h.role === 'model' || h.role === 'assistant' ? 'model' : 'user', [{ text: String(h.text) }]);
    });
    const parts = (o.parts || []).slice();
    if (o.prompt) parts.push({ text: String(o.prompt) });
    if (!parts.length) parts.push({ text: '…' });
    add('user', parts);
    if (contents[0].role !== 'user') contents.unshift({ role: 'user', parts: [{ text: '(Début de la conversation.)' }] });
    const body = { contents, generationConfig: gc };
    if (o.system) body.systemInstruction = { parts: [{ text: String(o.system) }] };
    return body;
  }

  async function geminiRequest(model, o, v, att) {
    const body = geminiBody(model, o, v);
    const url = GEMINI_API + '/models/' + encodeURIComponent(model) + (o.stream ? ':streamGenerateContent?alt=sse' : ':generateContent');
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keyOf('gemini') },
      body: JSON.stringify(body)
    }, att);
    let full = '';
    let finish = null;
    const take = (j) => {
      if (j.error) throw httpError('gemini', model, Number(j.error.code) || 500, JSON.stringify(j));
      if (j.promptFeedback && j.promptFeedback.blockReason) throw aiError('BLOCKED', frMessage('BLOCKED', 'gemini'), { provider: 'gemini', model });
      const c = j.candidates && j.candidates[0];
      if (!c) return '';
      if (c.finishReason) finish = c.finishReason;
      let t = '';
      ((c.content && c.content.parts) || []).forEach(p => { if (p && typeof p.text === 'string' && !p.thought) t += p.text; });
      return t;
    };
    if (o.stream) {
      await readSSE(res, att, (d) => {
        if (!d || d === '[DONE]') return;
        let j;
        try { j = JSON.parse(d); } catch (e) { return; }
        const t = take(j);
        if (t) { full += t; att.onText(full); }
      });
    } else {
      full = take(await readJSON(res, att));
    }
    if (!full.trim()) {
      if (finish && /SAFETY|BLOCK|PROHIBITED|RECITATION|SPII/.test(finish)) throw aiError('BLOCKED', frMessage('BLOCKED', 'gemini'), { provider: 'gemini', model });
      if (!o.allowEmpty) throw aiError('EMPTY', frMessage('EMPTY', 'gemini'), { provider: 'gemini', model, finish });
    }
    return { text: full, finish };
  }

  /* ---------------------------------------------------------------- Claude */

  function claudeHeaders(key, json) {
    const h = {
      'x-api-key': key,
      'anthropic-version': CLAUDE_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    if (json) h['content-type'] = 'application/json';
    return h;
  }

  function claudeBlock(p) {
    if (!p) return null;
    if (typeof p.text === 'string') return { type: 'text', text: p.text };
    const d = p.inline_data || p.inlineData;
    if (!d) return null;
    const mime = partMime(p);
    const source = { type: 'base64', media_type: mime, data: d.data };
    if (mime === 'application/pdf') return { type: 'document', source };
    if (/^image\//.test(mime)) return { type: 'image', source };
    return null;
  }

  const JSON_ONLY = 'IMPORTANT : réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ou après et sans balises de code.';

  function claudeBody(model, o, v) {
    let system = o.system ? String(o.system) : '';
    if (o.json) system += (system ? '\n\n' : '') + JSON_ONLY;
    const messages = [];
    const add = (role, blocks) => {
      const last = messages[messages.length - 1];
      if (last && last.role === role) last.content = last.content.concat(blocks); else messages.push({ role, content: blocks });
    };
    (o.history || []).forEach(h => {
      if (h && h.text) add(h.role === 'model' || h.role === 'assistant' ? 'assistant' : 'user', [{ type: 'text', text: String(h.text) }]);
    });
    const blocks = [];
    (o.parts || []).forEach(p => { const b = claudeBlock(p); if (b) blocks.push(b); });
    if (o.prompt) blocks.push({ type: 'text', text: String(o.prompt) });
    if (!blocks.length) blocks.push({ type: 'text', text: '…' });
    add('user', blocks);
    if (messages[0].role !== 'user') messages.unshift({ role: 'user', content: [{ type: 'text', text: '(Début de la conversation.)' }] });
    const body = { model, max_tokens: v.maxTokens || o.maxTokens || 1024, messages };
    if (system) body.system = system;
    if (typeof o.temperature === 'number' && !v.noTemperature) body.temperature = Math.max(0, Math.min(1, o.temperature));
    if (o.stream) body.stream = true;
    return body;
  }

  async function claudeRequest(model, o, v, att) {
    const body = claudeBody(model, o, v);
    const res = await doFetch(CLAUDE_API + '/messages', {
      method: 'POST', headers: claudeHeaders(keyOf('claude'), true), body: JSON.stringify(body)
    }, att);
    let full = '';
    let stop = null;
    if (o.stream) {
      await readSSE(res, att, (d) => {
        let j;
        try { j = JSON.parse(d); } catch (e) { return; }
        if (j.type === 'content_block_delta') {
          if (j.delta && j.delta.type === 'text_delta' && j.delta.text) { full += j.delta.text; att.onText(full); }
        } else if (j.type === 'message_delta') {
          if (j.delta && j.delta.stop_reason) stop = j.delta.stop_reason;
        } else if (j.type === 'error') {
          throw httpError('claude', model, claudeErrStatus(j.error && j.error.type), JSON.stringify(j));
        }
      });
    } else {
      const j = await readJSON(res, att);
      if (j.type === 'error') throw httpError('claude', model, claudeErrStatus(j.error && j.error.type), JSON.stringify(j));
      full = (j.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('');
      stop = j.stop_reason || null;
    }
    if (!full.trim()) {
      if (stop === 'refusal') throw aiError('BLOCKED', frMessage('BLOCKED', 'claude'), { provider: 'claude', model });
      if (!o.allowEmpty) throw aiError('EMPTY', frMessage('EMPTY', 'claude'), { provider: 'claude', model, finish: stop });
    }
    return { text: full, finish: stop };
  }

  /* ---------------------------------------------------------------- Groq */

  function groqBody(model, o, v) {
    let system = o.system ? String(o.system) : '';
    if (o.json) system += (system ? '\n\n' : '') + JSON_ONLY;
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    (o.history || []).forEach(h => {
      if (h && h.text) messages.push({ role: h.role === 'model' || h.role === 'assistant' ? 'assistant' : 'user', content: String(h.text) });
    });
    const text = (o.parts || []).filter(p => p && typeof p.text === 'string').map(p => p.text).concat(o.prompt ? [String(o.prompt)] : []).join('\n\n');
    messages.push({ role: 'user', content: text || '…' });
    const body = { model, messages, max_tokens: v.maxTokens || o.maxTokens || 1024 };
    if (typeof o.temperature === 'number' && !v.noTemperature) body.temperature = Math.max(0, Math.min(1, o.temperature));
    if (o.json && !v.noJsonMode) body.response_format = { type: 'json_object' };
    // GPT-OSS raisonne avant d'écrire : raisonnement court et caché pour garder la vitesse.
    if (/gpt-oss/.test(model) && !v.noReasoning) { body.reasoning_effort = 'low'; body.include_reasoning = false; }
    if (o.stream) body.stream = true;
    return body;
  }

  async function groqRequest(model, o, v, att) {
    const res = await doFetch(GROQ_API + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + keyOf('groq') },
      body: JSON.stringify(groqBody(model, o, v))
    }, att);
    let full = '';
    let finish = null;
    if (o.stream) {
      await readSSE(res, att, (d) => {
        if (!d || d === '[DONE]') return;
        let j;
        try { j = JSON.parse(d); } catch (e) { return; }
        if (j.error) throw httpError('groq', model, Number(j.error.code) || 500, JSON.stringify(j));
        const c = j.choices && j.choices[0];
        if (!c) return;
        if (c.finish_reason) finish = c.finish_reason;
        const t = c.delta && typeof c.delta.content === 'string' ? c.delta.content : '';
        if (t) { full += t; att.onText(full); }
      });
    } else {
      const j = await readJSON(res, att);
      const c = j.choices && j.choices[0];
      full = (c && c.message && c.message.content) || '';
      finish = (c && c.finish_reason) || null;
    }
    if (!full.trim() && !o.allowEmpty) throw aiError('EMPTY', frMessage('EMPTY', 'groq'), { provider: 'groq', model, finish });
    return { text: full, finish };
  }

  // Whisper (Groq) : transcription très rapide d'un segment WAV.
  // Quota gratuit Groq (Whisper) : environ 20 requêtes par minute et un plafond de secondes d'audio par heure.
  // On compte les appels pour réserver la marge aux transcriptions finales (l'anticipation passe après).
  const whisperCalls = [];
  function whisperRecent(ms) { const cut = Date.now() - ms; while (whisperCalls.length && whisperCalls[0] < cut) whisperCalls.shift(); return whisperCalls.length; }
  async function groqWhisper(wavBlob, hint, signal, timeoutMs) {
    let lastErr = null;
    whisperCalls.push(Date.now());
    for (const model of WHISPER) {
      const b = breaker.get('groq:' + model);
      if (b && b.until > Date.now()) continue;
      const att = makeAttempt(signal, 'groq', model, false);
      att.arm(timeoutMs || 12000, false);
      try {
        const fd = new FormData();
        fd.append('file', wavBlob, 'segment.wav');
        fd.append('model', model);
        fd.append('language', 'fr');
        fd.append('response_format', 'json');
        fd.append('temperature', '0');
        if (hint) fd.append('prompt', hint.slice(0, 600));
        const t0 = now();
        const res = await doFetch(GROQ_API + '/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + keyOf('groq') }, body: fd }, att);
        const j = await readJSON(res, att);
        emit('ai:status', { provider: 'groq', model, ok: true, ms: Math.round(now() - t0), purpose: 'fast', error: null });
        return { text: String(j.text || ''), model, provider: 'groq', ms: Math.round(now() - t0) };
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        lastErr = e;
        emit('ai:status', { provider: 'groq', model, ok: false, purpose: 'fast', error: e && e.message, code: e && e.code });
        if (e && e.code === 'KEY') break;
        if (e && (e.code === 'QUOTA' || e.code === 'SERVER' || e.code === 'TIMEOUT')) trip({ provider: 'groq', model }, config.breakerMs, e.code);
      } finally { att.done(); }
    }
    throw lastErr || aiError('ALL_FAILED', 'Whisper indisponible.');
  }

  /* ------------------------------------------------------- génération + bascule */

  async function callOnce(c, o, v) {
    const stream = !!o.stream;
    const att = makeAttempt(o.signal, c.provider, c.model, stream);
    att.idleMs = o.idleMs || config.idleMs;
    att.onText = (full) => {
      if (!att.first) { att.first = now(); att.gotFirst(); }
      att.partial = full;
      if (o.onDelta) { try { o.onDelta(full); } catch (e) { /* une erreur d'affichage ne coupe pas le flux */ } }
    };
    if (stream) att.arm(o.firstTokenMs || o.timeoutMs || config.firstTokenMs, true);
    else att.arm(o.timeoutMs || config.totalMs, false);
    try {
      const r = c.provider === 'gemini' ? await geminiRequest(c.model, o, v, att)
        : c.provider === 'groq' ? await groqRequest(c.model, o, v, att) : await claudeRequest(c.model, o, v, att);
      r.firstAt = att.first || now();
      return r;
    } catch (e) {
      if (att.partial && e && typeof e === 'object') e.partialText = att.partial;
      throw e;
    } finally {
      att.done();
    }
  }

  // Une candidate, avec réessais « paramètres » sur 400 (thinkingConfig, temperature, max_tokens).
  const TRUNCATED = /^(MAX_TOKENS|max_tokens|length)$/;

  async function tryCandidate(c, o) {
    const v = { thinking: c.provider === 'gemini' && !noThinking.has(c.model), noTemperature: false, maxTokens: 0 };
    for (let i = 0; i < 4; i++) {
      try {
        const r = await callOnce(c, o, v);
        if (c.provider === 'gemini' && !v.thinking && thinkingFor(c.model)) noThinking.add(c.model);
        // Réponse coupée par la limite de longueur : on relance une fois avec un budget bien plus grand.
        if (TRUNCATED.test(String(r.finish || '')) && !v.bigTokens) {
          v.bigTokens = true;
          v.maxTokens = Math.max(8192, (o.maxTokens || 1024) * 4);
          emit('ai:status', { provider: c.provider, model: c.model, ok: false, purpose: o.purpose, error: 'réponse tronquée, relance', code: 'TRUNCATED' });
          continue;
        }
        if (TRUNCATED.test(String(r.finish || ''))) r.truncated = true;
        return r;
      } catch (e) {
        if (!e || e.code !== 'BAD_REQUEST' || e.partialText) throw e;
        const d = String(e.detail || '');
        if (!v.maxTokens && /max_?(?:output_?)?tokens|maxOutputTokens/i.test(d) && (o.maxTokens || 0) > 8192) { v.maxTokens = 8192; continue; }
        if (c.provider === 'gemini' && v.thinking && thinkingFor(c.model)) { v.thinking = false; continue; }
        if (c.provider === 'claude' && !v.noTemperature && /temperature/i.test(d)) { v.noTemperature = true; continue; }
        if (c.provider === 'groq' && !v.noReasoning && /gpt-oss/.test(c.model) && /reasoning/i.test(d)) { v.noReasoning = true; continue; }
        if (c.provider === 'groq' && o.json && !v.noJsonMode && /response_format|json/i.test(d)) { v.noJsonMode = true; continue; }
        throw e;
      }
    }
    throw aiError('BAD_REQUEST', frMessage('BAD_REQUEST', c.provider), { provider: c.provider, model: c.model });
  }

  function noKeyError(o) {
    if (o.providers && o.providers.length === 1 && o.providers[0] === 'gemini') {
      return aiError('NO_KEY', 'Cette fonction demande une clé Gemini (gratuite sur aistudio.google.com/apikey) — ajoutez-la dans les réglages.');
    }
    if (o.parts && o.parts.length && PROVIDERS.some(p => keyOf(p))) {
      return aiError('NO_KEY', 'Ce type de fichier demande une clé Gemini — ajoutez-la dans les réglages.');
    }
    return aiError('NO_KEY', 'Aucune clé IA configurée — ajoutez une clé Gemini (gratuite) ou Claude dans les réglages.');
  }

  function allFailed(errors) {
    if (!errors.length) return aiError('ALL_FAILED', 'Aucun modèle IA disponible.');
    const last = errors[errors.length - 1];
    if (errors.every(e => e.code === 'KEY')) {
      return aiError('KEY', errors[0].message, { errors, provider: errors[0].provider, model: errors[0].model, status: errors[0].status });
    }
    if (errors.every(e => e.code === 'QUOTA')) {
      const ra = errors.reduce((m, e) => Math.max(m, e.retryAfterMs || 0), 0);
      return aiError('QUOTA', errors[0].message, { errors, provider: last.provider, model: last.model, status: 429, retryAfterMs: ra, reason: 'QUOTA' });
    }
    const uniq = [];
    errors.forEach(e => { if (uniq.indexOf(e.message) < 0) uniq.push(e.message); });
    return aiError('ALL_FAILED', 'Aucun modèle IA n\'a répondu. ' + uniq.slice(0, 3).join(' · '),
      { errors, provider: last.provider, model: last.model, reason: last.code });
  }

  async function generate(opts) {
    const o = Object.assign({ purpose: 'answer', stream: false, temperature: 0.4, maxTokens: 1024 }, opts || {});
    if (o.signal && o.signal.aborted) throw abortError();
    const list = candidates(o);
    if (!list.length) throw noKeyError(o);
    maybeAutoDiscover();
    const run = { start: now() };
    const errors = [];
    const dead = new Set();
    const netFails = {};
    const forbidden = {};
    const budget = o.budgetMs || config.budgetMs;
    const maxTries = o.maxCandidates || 12;
    let partial = null;
    let tried = 0;
    for (const c of list) {
      if (dead.has(c.provider)) continue;
      if (tried >= maxTries) break;
      if (tried > 0 && now() - run.start > budget) break;
      if (o.signal && o.signal.aborted) throw abortError();
      tried++;
      const a0 = now();
      try {
        const r = await tryCandidate(c, o);
        const ms = Math.round(now() - run.start);
        breaker.delete(bk(c));
        if (deadKeys[c.provider]) delete deadKeys[c.provider];
        lastOk = { provider: c.provider, model: c.model, at: Date.now(), ms };
        emit('ai:status', { provider: c.provider, model: c.model, ok: true, ms: Math.round(now() - a0), purpose: o.purpose, error: null });
        const out = {
          text: r.text, provider: c.provider, model: c.model, ms,
          firstTokenMs: Math.round((o.stream ? r.firstAt : now()) - run.start),
          finish: r.finish || null, truncated: !!r.truncated
        };
        if (o.json) {
          const parsed = parseJsonLoose(r.text);
          out.data = parsed ? parsed.data : null;
          out.repaired = parsed ? parsed.repaired : false;
        }
        return out;
      } catch (e) {
        if (isAbort(e) || (o.signal && o.signal.aborted)) throw abortError();
        const err = (e && e.code) ? e : aiError('HTTP', frMessage('HTTP', c.provider, 0, String((e && e.message) || e)), { provider: c.provider, model: c.model });
        errors.push(err);
        emit('ai:status', { provider: c.provider, model: c.model, ok: false, ms: Math.round(now() - a0), purpose: o.purpose, error: err.message, code: err.code });
        if (err.partialText && (!partial || err.partialText.length > partial.text.length)) {
          partial = { text: err.partialText, provider: c.provider, model: c.model };
        }
        // 403 sans indice « clé » : d'abord traité comme un refus propre au modèle ; au 2e, la clé est en cause.
        if (err.code === 'KEY' && !err.keyStrong && !forbidden[c.provider]) {
          forbidden[c.provider] = 1;
          trip(c, config.notFoundMs, 'FORBIDDEN');
          continue;
        }
        switch (err.code) {
          case 'KEY':
            dead.add(c.provider);
            deadKeys[c.provider] = fingerprint(keyOf(c.provider));
            emit('ai:keyerror', { provider: c.provider, status: err.status, message: err.message });
            break;
          case 'NETWORK':
            if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
              throw aiError('OFFLINE', 'Pas de connexion Internet : l\'IA est indisponible (les réponses préparées restent utilisables).', { errors });
            }
            netFails[c.provider] = (netFails[c.provider] || 0) + 1;
            if (netFails[c.provider] >= 2) dead.add(c.provider);
            break;
          case 'QUOTA': case 'SERVER': case 'TIMEOUT':
            trip(c, config.breakerMs, err.code);
            break;
          case 'NOT_FOUND':
            trip(c, config.notFoundMs, err.code);
            break;
          default:
            break; // BAD_REQUEST, BLOCKED, EMPTY : candidat suivant, sans pénalité
        }
      }
    }
    if (partial && partial.text.trim().length >= 40) {
      return {
        text: partial.text, provider: partial.provider, model: partial.model,
        ms: Math.round(now() - run.start), firstTokenMs: null, partial: true, finish: 'PARTIAL'
      };
    }
    throw allFailed(errors);
  }

  /* -------------------------------------------------------------------- JSON */

  // Parcourt un JSON en le nettoyant (sauts de ligne bruts, virgules finales, guillemets non échappés)
  // et note les points de coupe sûrs pour réparer un JSON tronqué.
  function scanJson(src, start) {
    let out = '';
    const stack = [];
    const cuts = [];
    let inStr = false;
    let esc = false;
    const dropTrailingComma = () => {
      let k = out.length - 1;
      while (k >= 0 && /\s/.test(out[k])) k--;
      if (k >= 0 && out[k] === ',') out = out.slice(0, k) + out.slice(k + 1);
    };
    for (let i = start; i < src.length; i++) {
      const ch = src[i];
      if (inStr) {
        if (esc) { esc = false; out += ch; continue; }
        if (ch === '\\') { esc = true; out += ch; continue; }
        if (ch === '"') {
          let j = i + 1;
          while (j < src.length && /\s/.test(src[j])) j++;
          const nx = src[j];
          if (j >= src.length || nx === ',' || nx === '}' || nx === ']' || nx === ':') { inStr = false; out += ch; } else out += '\\"';
          continue;
        }
        if (ch === '\n') { out += '\\n'; continue; }
        if (ch === '\t') { out += '\\t'; continue; }
        if (ch < ' ') continue;
        out += ch;
        continue;
      }
      if (ch === '"') { inStr = true; out += ch; continue; }
      if (ch === '{' || ch === '[') { stack.push(ch); out += ch; continue; }
      if (ch === '}' || ch === ']') {
        dropTrailingComma();
        stack.pop();
        out += ch;
        if (!stack.length) return { text: out, complete: true, cuts };
        cuts.push({ pos: out.length, stack: stack.slice() });
        continue;
      }
      if (ch === ',') { cuts.push({ pos: out.length, stack: stack.slice() }); out += ch; continue; }
      out += ch;
    }
    return { text: out, complete: false, cuts };
  }

  function parseJsonLoose(text) {
    const src = String(text == null ? '' : text);
    let body = src;
    const fence = src.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
    if (fence && /[{[]/.test(fence[1])) body = fence[1];
    const start = body.search(/[{[]/);
    if (start < 0) return null;
    const sc = scanJson(body, start);
    if (sc.complete) {
      try { return { data: JSON.parse(sc.text), repaired: false }; } catch (e) { /* réparation ci-dessous */ }
    }
    for (let k = sc.cuts.length - 1, n = 0; k >= 0 && n < 80; k--, n++) {
      const c = sc.cuts[k];
      let s = sc.text.slice(0, c.pos);
      for (let j = c.stack.length - 1; j >= 0; j--) s += c.stack[j] === '{' ? '}' : ']';
      try { return { data: JSON.parse(s), repaired: true }; } catch (e) { /* coupe précédente */ }
    }
    return null;
  }

  /* --------------------------------------------------------------- contexte */

  const KIND_ORDER = { prepa: 0, offre: 1, cv: 2, autre: 3 };
  const KIND_WEIGHT = { prepa: 1.3, offre: 1.15, cv: 1.15, autre: 0.6 };
  const KIND_TITLE = {
    prepa: 'FICHE DE PRÉPARATION DU CANDIDAT',
    offre: 'OFFRE / FICHE DE POSTE',
    cv: 'CV DU CANDIDAT',
    autre: 'AUTRE DOCUMENT'
  };
  const MODE_LABEL = { visio: 'visioconférence (Meet / Teams)', tel: 'téléphone', presentiel: 'présentiel' };

  // Nettoyage : espaces, lignes vides multiples.
  function compact(text) {
    return String(text || '').replace(/\r\n?/g, '\n').replace(/[ \t\u00a0]+/g, ' ').split('\n').map(l => l.trim())
      .join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Lignes répétées ≥ 3 fois (en-têtes / pieds de page PDF) : on ne garde que la 1re occurrence.
  function dedupeLines(t) {
    const lines = t.split('\n');
    const count = {};
    lines.forEach(l => { if (l.length >= 8 && l.length <= 120) count[l] = (count[l] || 0) + 1; });
    const seen = {};
    return lines.filter(l => {
      if (count[l] >= 3) { if (seen[l]) return false; seen[l] = true; }
      return true;
    }).join('\n').replace(/\n{3,}/g, '\n\n');
  }

  function smartTruncate(text, max) {
    let t = compact(text);
    if (t.length <= max) return t;
    t = dedupeLines(t);
    if (t.length <= max) return t;
    if (max < 600) return t.slice(0, Math.max(0, max - 4)).trimEnd() + ' […]';
    const marker = '\n[… passage coupé …]\n';
    const headLen = Math.floor((max - marker.length) * 0.78);
    const tailLen = max - marker.length - headLen;
    let head = t.slice(0, headLen);
    const cut = Math.max(head.lastIndexOf('\n'), head.lastIndexOf('. '));
    if (cut > headLen * 0.7) head = head.slice(0, cut + 1);
    let tail = t.slice(t.length - tailLen);
    const nl = tail.indexOf('\n');
    if (nl >= 0 && nl < tailLen * 0.3) tail = tail.slice(nl + 1);
    return head.trimEnd() + marker + tail.trimStart();
  }

  // Répartition « water-filling » pondérée du budget entre documents.
  function allocate(lens, weights, budget) {
    const lim = lens.map(() => 0);
    let open = lens.map((_, i) => i);
    let R = budget;
    while (open.length) {
      const W = open.reduce((s, i) => s + weights[i], 0);
      const sat = open.filter(i => lens[i] <= R * weights[i] / W);
      if (!sat.length) { open.forEach(i => { lim[i] = Math.floor(R * weights[i] / W); }); break; }
      sat.forEach(i => { lim[i] = lens[i]; R -= lens[i]; });
      open = open.filter(i => sat.indexOf(i) < 0);
    }
    return lim;
  }

  function fmtDate(d) {
    if (!d) return '';
    try {
      const x = new Date(d);
      if (isNaN(x.getTime())) return String(d);
      return x.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return String(d); }
  }

  function dossierHeader(d) {
    const L = [];
    if (d.company) L.push('Entreprise / structure : ' + d.company);
    if (d.role) L.push('Poste visé : ' + d.role);
    if (d.interviewer) L.push('Recruteur : ' + d.interviewer);
    if (d.date) L.push('Date : ' + fmtDate(d.date));
    if (d.mode) L.push('Format : ' + (MODE_LABEL[d.mode] || d.mode));
    if (d.notes && String(d.notes).trim()) L.push('Notes du candidat :\n' + clip(compact(d.notes), 2500));
    return L.length ? '=== ENTRETIEN ===\n' + L.join('\n') : '';
  }

  function prepText(prep, max) {
    if (!prep) return '';
    const out = [];
    if (prep.pitch) out.push('PITCH PRÉPARÉ :\n' + clip(prep.pitch, 1500));
    const qs = Array.isArray(prep.questions) ? prep.questions.filter(q => q && q.q) : [];
    if (qs.length) out.push('RÉPONSES PRÉPARÉES (question → idée clé ; inspire-t\'en, 1re personne) :\n' + qs.map(q => '- ' + String(q.q).trim() + ' → ' + firstLine(q.a)).join('\n'));
    if (Array.isArray(prep.keyFacts) && prep.keyFacts.length) out.push('CHIFFRES CLÉS : ' + prep.keyFacts.join(' ; '));
    if (Array.isArray(prep.watchouts) && prep.watchouts.length) out.push('POINTS DE VIGILANCE : ' + prep.watchouts.join(' ; '));
    if (!out.length) return '';
    return clip('=== PRÉPARATION ===\n' + out.join('\n\n'), max);
  }

  const ctxCache = new Map();

  function contextFor(dossier, opts) {
    opts = opts || {};
    const d = dossier || {};
    const budget = opts.budget || config.contextChars;
    const docs = (Array.isArray(d.docs) ? d.docs : []).filter(x => x && x.text && String(x.text).trim());
    const sig = [d.id, d.updatedAt, budget, opts.prep === false ? 0 : 1, docs.map(x => x.id + ':' + x.kind + ':' + String(x.text).length).join(','),
      d.prep ? (d.prep.questions || []).length + ':' + String(d.prep.pitch || '').length : '-', String(d.notes || '').length,
      d.company, d.role, d.interviewer, d.date, d.mode].join('|');
    if (ctxCache.has(sig)) return ctxCache.get(sig);
    const head = dossierHeader(d);
    const prep = opts.prep === false ? '' : prepText(d.prep, Math.min(8000, Math.floor(budget * 0.25)));
    const docBudget = Math.max(4000, budget - prep.length - head.length);
    const sorted = docs.map((x, i) => ({ x, i })).sort((a, b) =>
      ((KIND_ORDER[a.x.kind] != null ? KIND_ORDER[a.x.kind] : 3) - (KIND_ORDER[b.x.kind] != null ? KIND_ORDER[b.x.kind] : 3)) || (a.i - b.i)).map(o => o.x);
    const texts = sorted.map(x => compact(x.text));
    const overhead = sorted.length * 80;
    const lim = allocate(texts.map(t => t.length), sorted.map(x => KIND_WEIGHT[x.kind] || 0.6), Math.max(1000, docBudget - overhead));
    const blocks = sorted.map((x, i) => {
      if (lim[i] < Math.min(200, texts[i].length)) return '';
      const title = (KIND_TITLE[x.kind] || KIND_TITLE.autre) + (x.name ? ' (' + clip(x.name, 60) + ')' : '');
      return '=== ' + title + ' ===\n' + smartTruncate(texts[i], lim[i]);
    }).filter(Boolean);
    const out = [head].concat(blocks, [prep]).filter(Boolean).join('\n\n');
    if (ctxCache.size > 8) ctxCache.delete(ctxCache.keys().next().value);
    ctxCache.set(sig, out);
    return out;
  }

  const WHO = { them: 'Recruteur', me: 'Moi', mixed: 'Voix' };

  function formatTranscript(tr, max) {
    if (!Array.isArray(tr) || !tr.length) return '';
    const lines = tr.filter(x => x && x.text && String(x.text).trim()).map(x =>
      (typeof x.t === 'number' ? '[' + fmtTime(x.t) + '] ' : '') + (WHO[x.who] || 'Voix') + ' : ' + String(x.text).trim());
    let s = lines.join('\n');
    if (s.length > max) {
      const marker = '\n[… milieu de l\'entretien coupé …]\n';
      let head = s.slice(0, Math.floor(max * 0.12));
      const hc = head.lastIndexOf('\n');
      if (hc > 0) head = head.slice(0, hc);
      let tail = s.slice(s.length - (max - head.length - marker.length));
      const tc = tail.indexOf('\n');
      if (tc >= 0 && tc < 400) tail = tail.slice(tc + 1);
      s = head + marker + tail;
    }
    return s;
  }

  function formatPrevious(prev) {
    if (!Array.isArray(prev) || !prev.length) return '';
    return prev.filter(p => p && (p.question || p.answer)).slice(-15).map(p =>
      '- Q : ' + clip(String(p.question || '').trim(), 300) + '\n  Suggéré : ' +
      String(p.answer || '').split('\n').map(l => stripMd(l)).filter(Boolean).slice(0, 2).join(' / ')).join('\n');
  }

  /* ---------------------------------------------------------------- answer */

  function answerRules(mixed, auto) {
    return [
      'Tu es le souffleur discret d\'un candidat, EN DIRECT pendant son entretien d\'embauche. Il lit ta réponse à l\'écran pendant que le recruteur parle : elle doit se lire en 3 secondes et se dire à l\'oral, à la 1re personne.',
      'FORMAT STRICT :',
      '- Ligne 1 : la réponse clé en UNE phrase orale percutante (22 mots maximum), en **gras**, à la 1re personne.',
      '- Puis 3 à 4 puces commençant par « - », scannables : chacune ouvre par 2 à 4 mots clés en **gras** suivis de « : », puis un fait ou un chiffre concret TIRÉ DU CV, de la fiche de préparation ou de l\'offre. Une idée par puce, 16 mots maximum.',
      '- Question comportementale (un échec, un conflit, « une fois où… », « un exemple de… ») : 4 puces **Situation :** / **Tâche :** / **Action :** / **Résultat :**.',
      '- Pas de préambule, pas de titre, pas de conclusion. Français uniquement.',
      'RÈGLES :',
      '- N\'invente jamais une expérience, un chiffre, un diplôme, un employeur ou un outil absent du contexte. Si le CV ne couvre pas le sujet, propose une réponse honnête (compétence transférable, envie d\'apprendre, démarche concrète) et termine par une ligne « ⚠️ pas dans ton CV ».',
      '- Salaire : ne donne jamais de chiffre absent du contexte ; propose une formulation et une fourchette à compléter [XX k€].',
      '- Quand une réponse préparée ou la fiche de préparation correspond, appuie-toi dessus en l\'adaptant à la formulation exacte du recruteur.',
      '- Tu reçois TOUTE la conversation depuis le début et les réponses déjà suggérées : sers-t\'en. Si le recruteur relance ou fait référence à ce qui a été dit (« vous parliez de… », « pouvez-vous préciser ? », « et concrètement ? »), appuie-toi sur l\'échange précédent et complète sans te répéter. Reste cohérent avec ce que le candidat a déjà dit (chiffres, exemples).',
      '- Mémoire de l\'entretien : quand plusieurs expériences du CV conviennent aussi bien, préfère un exemple pas encore utilisé dans cette conversation pour varier. Mais si un exemple déjà cité reste clairement le plus pertinent pour cette question, reprends-le sans hésiter (sous un autre angle) : ne force jamais un exemple moins adapté juste pour varier. Ne signale jamais ce choix.',
      mixed
        ? '- La transcription vient d\'un seul micro (« Voix » = recruteur et candidat mêlés, avec des erreurs de reconnaissance) : repère et traite la DERNIÈRE question posée par le recruteur.'
        : '- Transcription en deux voix : « Recruteur » = le recruteur, « Moi » = ce que le candidat a déjà dit. La reconnaissance vocale fait des erreurs : devine le sens.',
      auto
        ? '- Si la dernière intervention n\'est pas une question ou une demande adressée au candidat (simple remarque, présentation de l\'entreprise, propos du candidat lui-même, bruit), réponds uniquement par « — ».'
        : '- Réponds toujours, même si la demande n\'est pas formulée comme une question.'
    ].join('\n');
  }

  const ANSWER_MODES = ['auto', 'force', 'pitch', 'reformulate', 'shorter', 'example'];

  function lastQuestionFrom(transcript) {
    const tr = Array.isArray(transcript) ? transcript : [];
    for (let i = tr.length - 1; i >= 0; i--) {
      const x = tr[i];
      if (x && x.text && x.who !== 'me') return String(x.text).trim();
    }
    return '';
  }

  function answerPrompt(o, mode, q, base, dossier) {
    const blocks = [];
    const conv = formatTranscript(o.transcript, 16000);
    if (conv) blocks.push('=== CONVERSATION DEPUIS LE DÉBUT DE L\'ENTRETIEN (horodatée) ===\n' + conv);
    const prev = formatPrevious(o.previous);
    if (prev) blocks.push('=== RÉPONSES DÉJÀ SUGGÉRÉES AU CANDIDAT (reste cohérent avec elles ; ne te répète pas, complète si on le relance) ===\n' + prev);
    const cur = base ? 'Question : « ' + base.question + ' »\nRéponse actuelle :\n' + base.answer + '\n\n' : '';
    switch (mode) {
      case 'force':
        blocks.push('Le candidat demande de l\'aide sur : « ' + q + ' »\nRéponds même si ce n\'est pas formulé comme une question.');
        break;
      case 'pitch': {
        const pitch = dossier && dossier.prep && dossier.prep.pitch;
        blocks.push('Le recruteur demande au candidat de se présenter' + (q ? ' (« ' + q + ' »)' : '') + '. Donne son pitch oral d\'environ 60 secondes, adapté au poste et à ce qui a déjà été dit : ligne 1 = accroche en **gras** ; puis 4 puces « **mots clés** : … » (qui je suis, parcours et réussite chiffrée, compétences clés pour ce poste, pourquoi ce poste et cette structure).' +
          (pitch ? '\n\nPitch préparé à adapter :\n' + pitch : ''));
        break;
      }
      case 'reformulate':
        blocks.push(base
          ? cur + 'Reformule cette réponse autrement : autre angle, mots plus simples et plus naturels à l\'oral, même format (phrase clé en **gras** + 3 à 4 puces). Ne reprends pas les mêmes phrases.'
          : 'Le candidat veut une autre formulation pour répondre à : « ' + q + ' ». Propose un angle différent, naturel à l\'oral.');
        break;
      case 'shorter':
        blocks.push(base
          ? cur + 'Réécris cette réponse BEAUCOUP plus court : une phrase clé en **gras** (15 mots maximum) + 2 puces de 8 mots maximum.'
          : 'Réponds TRÈS court à : « ' + q + ' » — une phrase clé en **gras** (15 mots maximum) + 2 puces de 8 mots maximum.');
        break;
      case 'example':
        blocks.push((base ? cur + 'Développe cette réponse avec' : 'Pour répondre à « ' + q + ' », donne') +
          ' UN exemple concret tiré du CV (méthode STAR si pertinent : **Situation :** / **Tâche :** / **Action :** / **Résultat :** chiffré), puis une dernière puce qui relie l\'exemple au poste visé. Garde le format.');
        break;
      default:
        blocks.push('Dernière intervention, à traiter : « ' + q + ' »');
    }
    return blocks.join('\n\n');
  }

  const isDash = t => /^[—–-]?$/.test(t);
  // « — » éventuellement suivi d'un court commentaire sans gras (« — (simple remarque) ») = pas une question.
  const isSkip = t => isDash(t) || (/^[—–-]/.test(t) && !/\*\*/.test(t) && t.length < 120);

  // Course entre fournisseurs : la question part sur Gemini ET Claude en même temps ; le premier qui
  // écrit un vrai début de réponse gagne et l'autre est annulé. Repli sur generate() classique avec une
  // seule clé, sans streaming, ou si la course est désactivée (settings.race === false).
  function raceGenerate(base, onDelta, signal) {
    const provs = PROVIDERS.filter(p => keyOf(p));
    if (provs.length < 2 || !base.stream || base.noRace || settings().race === false) return generate(Object.assign({}, base, { onDelta, signal }));
    if (signal && signal.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      let winner = null, done = false, left = provs.length;
      const errs = [];
      const ctrls = {};
      const abortOthers = (p) => provs.forEach(x => { if (x !== p) ctrls[x].abort(); });
      const finish = (fn, v) => { if (!done) { done = true; fn(v); } };
      if (signal) signal.addEventListener('abort', () => { provs.forEach(x => ctrls[x] && ctrls[x].abort()); finish(reject, abortError()); }, { once: true });
      provs.forEach(p => {
        const c = ctrls[p] = new AbortController();
        generate(Object.assign({}, base, {
          providers: [p], signal: c.signal,
          onDelta: (full) => {
            if (winner && winner !== p) return;
            if (!winner) {
              const t = String(full || '').trim();
              if (!t || isSkip(t)) return;
              winner = p;
              abortOthers(p);
            }
            if (onDelta) onDelta(full);
          }
        })).then((r) => {
          left--;
          if (!winner || winner === p) { winner = p; abortOthers(p); finish(resolve, Object.assign(r, { race: true })); }
          else if (!left) finish(reject, errs[0] || abortError());
        }, (e) => {
          left--;
          if (winner === p) { finish(reject, e); return; }
          if (!e || e.name !== 'AbortError') errs.push(e);
          if (!left) finish(reject, errs[0] || e || abortError());
        });
      });
    });
  }

  async function answer(opts) {
    const o = opts || {};
    const mode = ANSWER_MODES.indexOf(o.mode) >= 0 ? o.mode : 'auto';
    let q = String(o.question || '').trim();
    const prev = Array.isArray(o.previous) ? o.previous.filter(Boolean) : [];
    let base = null;
    if (mode === 'reformulate' || mode === 'shorter' || mode === 'example') {
      base = prev.slice().reverse().find(p => p.question && q && norm(p.question) === norm(q) && p.answer) ||
        (prev.length && prev[prev.length - 1].answer ? prev[prev.length - 1] : null);
      if (base && !q) q = String(base.question || '').trim();
    }
    if (!q && mode !== 'pitch') q = lastQuestionFrom(o.transcript);
    if (!q && !base && mode !== 'pitch') throw aiError('NO_QUESTION', 'Aucune question à traiter pour l\'instant.');
    const mixed = Array.isArray(o.transcript) && o.transcript.some(x => x && x.who === 'mixed');
    const system = answerRules(mixed, mode === 'auto') + '\n\n' + contextFor(o.dossier);
    const prompt = answerPrompt(o, mode, q, base, o.dossier);
    const onDelta = o.onDelta ? (full) => {
      const t = full.trim();
      if (mode === 'auto' && isSkip(t)) return;
      o.onDelta(full.replace(/^\s*[—–]\s*/, ''));
    } : null;
    const r = await raceGenerate({
      purpose: 'answer', system, prompt, stream: o.stream !== false,
      maxTokens: mode === 'shorter' ? 400 : mode === 'example' || mode === 'pitch' ? 1100 : 900,
      temperature: mode === 'reformulate' ? 0.7 : 0.4,
      timeoutMs: o.timeoutMs, budgetMs: o.budgetMs || 45000, noRace: !!o.noRace
    }, onDelta, o.signal);
    let text = String(r.text || '').trim();
    const skipped = mode === 'auto' && isSkip(text);
    if (skipped) text = '—';
    else text = text.replace(/^[—–]\s+/, '');
    return Object.assign({}, r, { text, skipped, mode, question: q || (base && base.question) || '' });
  }

  /* --------------------------------------------------------------- buildPrep */

  const PREP_SYSTEM = 'Tu es un coach d\'entretien d\'embauche expert (recrutement en finance, gestion, administration, fonctions support) et tu prépares un candidat à un entretien précis. Tu écris en français impeccable. Tu t\'appuies UNIQUEMENT sur les documents fournis : n\'invente jamais une expérience, un diplôme, un chiffre, un outil ou un employeur absent du CV ou des notes du candidat.';

  function prepPrompt(n, short) {
    return [
      'À partir des documents ci-dessus, prépare cet entretien. Réponds UNIQUEMENT par un objet JSON valide, sans texte autour, de la forme :',
      '{"pitch": "…", "questions": [{"q": "…", "variants": ["…"], "a": "…", "tags": ["…"]}], "askThem": ["…"], "keyFacts": ["…"], "watchouts": ["…"]}',
      '',
      'Consignes :',
      '- pitch : présentation orale de 60 secondes (130 à 160 mots), à la 1re personne, naturelle à dire : qui je suis → parcours clé avec 1 ou 2 réussites chiffrées → pourquoi ce poste et cette structure.',
      '- questions : exactement ' + n + ' questions probables, formulées comme le recruteur les poserait (vouvoiement), sans doublon, couvrant : classiques (présentation, parcours, motivations, pourquoi nous, qualités et défauts), missions précises de l\'offre, techniques métier, mises en situation, questions pièges (départs, périodes creuses, échecs, écarts entre le profil et l\'offre), comportementales, salaire et disponibilité, fin d\'entretien.',
      '- a : réponse prête au format souffleur. Ligne 1 = UNE phrase clé orale en **gras** (22 mots maximum, 1re personne). Puis ' + (short ? '2 à 3' : '3 à 4') + ' lignes commençant par « - » : « **2 à 4 mots clés** : fait concret tiré du CV » (16 mots maximum). Comportementale → puces **Situation :** / **Tâche :** / **Action :** / **Résultat :**. Si le CV ne couvre pas le sujet : réponse honnête (compétence transférable, envie d\'apprendre) puis une dernière ligne « ⚠️ pas dans ton CV ». Salaire : formulation + fourchette à compléter [XX k€] si aucun chiffre n\'est donné dans les notes. Sépare les lignes par \\n.',
      '- variants : 3 à 5 autres façons, orales et variées, dont le recruteur pourrait poser la même question (sert à la reconnaître instantanément pendant l\'appel).',
      '- tags : d\'abord 1 catégorie parmi classique, poste, technique, situation, piège, comportementale, motivation, salaire, fin ; puis 2 à 4 mots ou expressions que le recruteur pourrait employer pour poser cette question.',
      '- askThem : 6 à 8 questions pertinentes à poser au recruteur, propres à ce poste et à cette structure.',
      '- keyFacts : 6 à 10 chiffres et faits clés à avoir en tête (résultats chiffrés du candidat ; données du poste et de la structure tirées de l\'offre), une ligne courte chacun.',
      '- watchouts : 4 à 6 points de vigilance (écarts entre le profil et l\'offre, sujets délicats), chacun avec la parade en quelques mots.',
      '- Pas de markdown en dehors des champs « a » (le gras y est autorisé).' + (short ? ' Sois concis : réponses courtes.' : '')
    ].join('\n');
  }

  function fixAnswerFormat(a) {
    let s = String(a || '').replace(/\\n/g, '\n').replace(/\r/g, '').trim();
    if (s.indexOf('\n') < 0) s = s.replace(/\s+(-\s+\*\*)/g, '\n$1').replace(/\s+(⚠️)/g, '\n$1');
    return s.split('\n').map(l => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function asText(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'object') {
      const t = v.text || v.q || v.question || v.fait || v.fact || v.point;
      if (typeof t === 'string') {
        const extra = v.parade || v.answer || v.detail || v.value;
        return (t + (typeof extra === 'string' && extra && extra !== t ? ' — ' + extra : '')).trim();
      }
      return Object.keys(v).map(k => v[k]).filter(x => typeof x === 'string').join(' — ').trim();
    }
    return String(v);
  }

  function asList(v) {
    if (Array.isArray(v)) return v.map(asText).filter(Boolean);
    if (typeof v === 'string') return v.split(/\n+/).map(s => s.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim()).filter(Boolean);
    return [];
  }

  function normalizePrep(d) {
    if (!d || typeof d !== 'object') return null;
    if (Array.isArray(d)) d = { questions: d };
    const seen = new Set();
    const questions = [];
    (Array.isArray(d.questions) ? d.questions : []).forEach(it => {
      if (!it || typeof it !== 'object') return;
      const q = asText(it.q || it.question || it.Q);
      let a = it.a != null ? it.a : (it.answer != null ? it.answer : (it.reponse != null ? it.reponse : it['réponse']));
      if (Array.isArray(a)) a = a.join('\n');
      a = fixAnswerFormat(asText(a));
      if (!q || !a) return;
      const k = norm(q);
      if (seen.has(k)) return;
      seen.add(k);
      let tags = it.tags;
      tags = Array.isArray(tags) ? tags.map(asText).filter(Boolean).slice(0, 6)
        : typeof tags === 'string' ? tags.split(/[,;]/).map(s => s.trim()).filter(Boolean).slice(0, 6) : [];
      const variants = Array.isArray(it.variants) ? it.variants.map(asText).filter(Boolean).slice(0, 6) : [];
      questions.push({ id: uid(), q, a, tags, variants });
    });
    return {
      pitch: asText(d.pitch),
      questions,
      askThem: asList(d.askThem || d.ask_them || d.questionsToAsk || d.questions_a_poser),
      keyFacts: asList(d.keyFacts || d.key_facts || d.chiffres),
      watchouts: asList(d.watchouts || d.watch_outs || d.vigilance)
    };
  }

  function hasMaterial(d) {
    return !!d && ((Array.isArray(d.docs) && d.docs.some(x => x && x.text && String(x.text).trim().length > 40)) ||
      (d.notes && String(d.notes).trim().length > 40));
  }

  async function buildPrep(dossier, opts) {
    opts = opts || {};
    const progress = (step, pct, message) => {
      try { if (typeof opts.onProgress === 'function') opts.onProgress({ step, pct: Math.max(0, Math.min(1, pct)), message }); } catch (e) { /* UI */ }
    };
    if (!PROVIDERS.some(p => keyOf(p))) throw noKeyError({});
    if (!hasMaterial(dossier)) throw aiError('NO_DOCS', 'Ajoutez d\'abord la fiche de poste et votre CV (fichier ou texte collé).');
    progress('context', 0.03, 'Lecture des documents…');
    const system = PREP_SYSTEM + '\n\n' + contextFor(dossier, { budget: 40000, prep: false });
    const plans = [{ n: 25, short: false, from: 0.05, to: 0.9 }, { n: 15, short: true, from: 0.5, to: 0.95 }];
    let best = null;
    let lastErr = null;
    for (let k = 0; k < plans.length; k++) {
      const p = plans[k];
      progress(k ? 'retry' : 'generating', p.from, k ? 'Préparation incomplète, nouvel essai plus compact…' : 'Rédaction des questions et des réponses…');
      const expected = p.n * (p.short ? 330 : 450) + 2500;
      let r;
      try {
        r = await generate({
          purpose: 'prep', system, prompt: prepPrompt(p.n, p.short), json: true, stream: true,
          maxTokens: p.short ? 8000 : 12000, temperature: 0.5, signal: opts.signal,
          firstTokenMs: opts.firstTokenMs || 30000, idleMs: 30000, budgetMs: 240000,
          onDelta: (full) => {
            const n = (full.match(/"q"\s*:/g) || []).length;
            progress('generating', p.from + (p.to - p.from) * Math.min(0.97, full.length / expected),
              'Rédaction… ' + n + ' question' + (n > 1 ? 's' : '') + ' sur ' + p.n);
          }
        });
      } catch (e) {
        if (isAbort(e)) throw e;
        lastErr = e;
        if (e.code === 'KEY' || e.code === 'NO_KEY' || e.code === 'OFFLINE') throw e;
        continue;
      }
      progress('parsing', p.to, 'Vérification…');
      const parsed = parseJsonLoose(r.text);
      const prep = parsed && normalizePrep(parsed.data);
      const repaired = !!parsed && (parsed.repaired || !!r.partial);
      if (prep && (!best || prep.questions.length > best.prep.questions.length)) best = { prep, r, repaired };
      const enough = prep && (prep.questions.length >= (repaired ? 15 : 10)) && (prep.pitch || prep.questions.length >= 15);
      if (enough) break;
      lastErr = aiError('PARSE', 'L\'IA a renvoyé une préparation incomplète.');
    }
    if (!best || best.prep.questions.length < 3) {
      throw lastErr && lastErr.code !== 'PARSE' ? lastErr : aiError('PARSE', 'L\'IA n\'a pas renvoyé une préparation lisible — réessayez dans un instant.');
    }
    const out = Object.assign(best.prep, { generatedAt: new Date().toISOString(), model: best.r.model });
    progress('done', 1, out.questions.length + ' questions prêtes.');
    return out;
  }

  /* ------------------------------------------------------------------- recap */

  function section(md, title) {
    const lines = String(md || '').split('\n');
    const want = norm(title);
    let on = false;
    const out = [];
    for (const l of lines) {
      const h = l.match(/^#{1,3}\s+(.*)$/);
      if (h) { if (on) break; on = norm(h[1]).indexOf(want) === 0; continue; }
      if (on) out.push(l);
    }
    return out.join('\n').trim();
  }

  function thanksMail(d) {
    d = d || {};
    const who = d.interviewer ? String(d.interviewer).trim() : '';
    const role = d.role ? String(d.role).trim() : '';
    const company = d.company ? String(d.company).trim() : '';
    return [
      'Objet : Merci pour notre échange' + (role ? ' — ' + role : ''),
      '',
      (who ? 'Bonjour ' + who + ',' : 'Bonjour,'),
      '',
      'Je vous remercie pour le temps que vous m\'avez accordé lors de notre entretien' + (role ? ' pour le poste de ' + role : '') + (company ? ' au sein de ' + company : '') + '. Notre échange m\'a permis de mieux comprendre les enjeux du poste et a renforcé mon envie de rejoindre votre équipe.',
      '',
      'Je reste à votre disposition pour tout complément d\'information et pour la suite du processus.',
      '',
      'Bien cordialement,',
      '[Prénom Nom]'
    ].join('\n');
  }

  function localRecap(d, s, reason) {
    const tr = Array.isArray(s.transcript) ? s.transcript : [];
    const answers = Array.isArray(s.answers) ? s.answers : [];
    const dur = s.startedAt && s.endedAt ? Math.max(0, new Date(s.endedAt) - new Date(s.startedAt)) : 0;
    const qs = answers.map(a => a && a.question).filter(Boolean);
    const isQ = (t) => { try { return S.util && S.util.isQuestion ? S.util.isQuestion(t) : /\?/.test(t); } catch (e) { return /\?/.test(t); } };
    if (!qs.length) tr.forEach(x => { if (x && x.who !== 'me' && x.text && isQ(x.text)) qs.push(String(x.text).trim()); });
    const uniq = [];
    qs.forEach(q => { if (!uniq.some(u => similarity(u, q) > 0.8)) uniq.push(q); });
    return [
      '*Récap généré sans IA' + (reason ? ' (' + reason + ')' : '') + ' : complétez-le à la main.*',
      '',
      '## Synthèse',
      'Entretien' + (d && d.company ? ' avec ' + d.company : '') + (d && d.role ? ' pour le poste de ' + d.role : '') +
        (dur ? ', durée ' + fmtTime(dur) : '') + '. ' + tr.length + ' phrase' + (tr.length > 1 ? 's' : '') + ' transcrite' + (tr.length > 1 ? 's' : '') +
        ', ' + answers.length + ' réponse' + (answers.length > 1 ? 's' : '') + ' suggérée' + (answers.length > 1 ? 's' : '') + '.',
      '',
      '## Questions posées',
      uniq.length ? uniq.map((q, i) => (i + 1) + '. ' + q).join('\n') : '- Aucune question détectée.',
      '',
      '## Points forts',
      '- À compléter.',
      '',
      '## À améliorer',
      '- À compléter.',
      '',
      '## À relancer',
      '- Prochaines étapes annoncées, documents à envoyer.',
      '',
      '## Mail de remerciement',
      thanksMail(d)
    ].join('\n');
  }

  const RECAP_SYSTEM = 'Tu es un coach d\'entretien d\'embauche bienveillant mais lucide. Tu rédiges le récapitulatif d\'un entretien qui vient de se terminer, en français impeccable, en t\'adressant au candidat (vouvoiement). Tu ne t\'appuies que sur la transcription et le contexte fournis : n\'invente rien.';

  async function recap(dossier, session, opts) {
    opts = opts || {};
    const d = dossier || {};
    const s = session || {};
    if (!PROVIDERS.some(p => keyOf(p))) return localRecap(d, s, 'aucune clé IA');
    const answers = (Array.isArray(s.answers) ? s.answers : []).filter(a => a && a.question);
    const scores = (Array.isArray(s.scores) ? s.scores : []).filter(Boolean);
    const dur = s.startedAt && s.endedAt ? fmtTime(Math.max(0, new Date(s.endedAt) - new Date(s.startedAt))) : '';
    const blocks = [];
    blocks.push('Type de session : ' + (s.kind === 'training' ? 'entraînement' : 'entretien réel') + (dur ? ' — durée ' + dur : ''));
    const tr = formatTranscript(s.transcript, 40000);
    blocks.push('=== TRANSCRIPTION (Recruteur = recruteur, Moi = candidat, Voix = voix mêlées ; erreurs de reconnaissance possibles) ===\n' + (tr || '(transcription vide)'));
    if (answers.length) blocks.push('=== RÉPONSES SOUFFLÉES PENDANT L\'ENTRETIEN ===\n' + answers.slice(-40).map(a => '- ' + clip(a.question, 300) + ' → ' + firstLine(a.answer)).join('\n'));
    if (scores.length) blocks.push('=== NOTES D\'ENTRAÎNEMENT ===\n' + scores.map(x => '- ' + clip(x.question, 200) + ' : ' + x.score + '/10').join('\n'));
    blocks.push([
      'Rédige le récapitulatif en markdown avec EXACTEMENT ces sections, dans cet ordre :',
      '## Synthèse — 3 à 5 phrases : déroulé, ton de l\'échange, impression générale, signaux d\'intérêt du recruteur.',
      '## Questions posées — liste numérotée des questions réellement posées par le recruteur (reformulées clairement), chacune suivie de « — ✅ solide », « — ➖ correcte » ou « — ⚠️ à retravailler » et d\'une courte justification sur la réponse du candidat.',
      '## Points forts — 3 à 5 puces concrètes.',
      '## À améliorer — 3 à 5 puces concrètes et actionnables.',
      '## À relancer — puces : informations à envoyer, points à préciser, prochaines étapes annoncées.',
      '## Mail de remerciement — une ligne « Objet : … », puis le mail prêt à copier (vouvoiement, ' + (d.interviewer ? 'adressé à ' + d.interviewer : 'formule d\'appel neutre') + ', 120 à 170 mots, rappelle un point précis de l\'échange, redit la motivation), signé du prénom et du nom du candidat tels qu\'ils figurent dans le CV (sinon [Prénom Nom]). Pas de markdown dans le mail.',
      'N\'ajoute aucune autre section ni de titre principal.'
    ].join('\n'));
    try {
      const r = await generate({
        purpose: 'prep', system: RECAP_SYSTEM + '\n\n' + contextFor(d, { budget: 14000 }), prompt: blocks.join('\n\n'),
        stream: true, onDelta: opts.onDelta, signal: opts.signal, maxTokens: 4000, temperature: 0.4,
        firstTokenMs: 25000, idleMs: 30000, budgetMs: 150000
      });
      let text = String(r.text || '').trim().replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
      if (!/##\s*Mail de remerciement/i.test(text)) text += '\n\n## Mail de remerciement\n' + thanksMail(d);
      return text;
    } catch (e) {
      if (isAbort(e)) throw e;
      return localRecap(d, s, e.message);
    }
  }

  /* -------------------------------------------------------------- entraînement */

  const BANK = [
    'Pouvez-vous vous présenter en quelques minutes ?',
    'Qu\'est-ce qui vous attire dans ce poste ?',
    'Pourquoi souhaitez-vous rejoindre notre structure ?',
    'Quelles sont vos principales qualités pour ce poste ?',
    'Quel est votre principal axe d\'amélioration ?',
    'Racontez-moi une situation difficile que vous avez gérée et comment vous l\'avez résolue.',
    'Parlez-moi d\'une réussite professionnelle marquante.',
    'Comment organisez-vous votre travail quand plusieurs échéances se chevauchent ?',
    'Comment gérez-vous un désaccord avec un collègue ou un responsable ?',
    'Pourquoi êtes-vous à l\'écoute du marché aujourd\'hui ?',
    'Où vous voyez-vous dans trois à cinq ans ?',
    'Comment expliqueriez-vous un indicateur financier complexe à un interlocuteur non spécialiste ?',
    'Quelles sont vos prétentions salariales ?',
    'Quelle est votre disponibilité ?',
    'Avez-vous des questions à nous poser ?'
  ];

  function wasAsked(q, asked) {
    return asked.some(a => norm(a) === norm(q) || similarity(a, q) > 0.6);
  }

  function fallbackQuestion(d, asked) {
    const prepQs = (d && d.prep && Array.isArray(d.prep.questions) ? d.prep.questions : []).map(x => x && x.q).filter(Boolean);
    if (!asked.length) {
      const intro = prepQs.find(q => /présent|parcours|parlez-moi de vous/i.test(q));
      return { question: intro || BANK[0], source: intro ? 'prep' : 'bank' };
    }
    const fresh = prepQs.filter(q => !wasAsked(q, asked));
    if (fresh.length) return { question: fresh[Math.floor(Math.random() * fresh.length)], source: 'prep' };
    const bank = BANK.filter(q => !wasAsked(q, asked));
    return { question: bank.length ? bank[0] : BANK[Math.floor(Math.random() * BANK.length)], source: 'bank' };
  }

  function cleanQuestion(t) {
    let s = String(t || '').trim().split('\n').map(x => x.trim()).filter(Boolean)[0] || '';
    s = s.replace(/^\s*(?:\*\*)?(?:question(?: suivante)?|recruteur)\s*(?:\*\*)?\s*:\s*/i, '').replace(/\*\*/g, '');
    s = s.replace(/^["«“\s]+|["»”\s]+$/g, '').trim();
    return s.length >= 8 ? s : '';
  }

  async function trainingNext(dossier, askedSoFar, opts) {
    opts = opts || {};
    const asked = (Array.isArray(askedSoFar) ? askedSoFar : []).map(x => typeof x === 'string' ? x : (x && (x.question || x.q)) || '').filter(Boolean);
    if (!PROVIDERS.some(p => keyOf(p))) return fallbackQuestion(dossier, asked);
    const d = dossier || {};
    const system = 'Tu joues le recruteur de cet entretien' + (d.role ? ' pour le poste de ' + d.role : '') + (d.company ? ' chez ' + d.company : '') +
      '. Tu mènes un entretien réaliste, exigeant et bienveillant, en français, en vouvoyant le candidat.\n\n' + contextFor(d, { budget: 15000 });
    const prompt = (asked.length
      ? 'Questions déjà posées :\n' + asked.map(q => '- ' + q).join('\n') + '\n\n'
      : 'Aucune question posée pour l\'instant : commence par inviter le candidat à se présenter.\n\n') +
      'Pose la question suivante. Varie les thèmes (parcours, motivation, missions précises de l\'offre, technique métier, mise en situation, comportementale, question piège) et ne répète aucune question déjà posée. Une seule question, orale, 30 mots maximum, sans préambule ni guillemets.';
    try {
      const r = await generate({ purpose: 'answer', system, prompt, maxTokens: 200, temperature: 0.9, stream: false, timeoutMs: 20000, signal: opts.signal, budgetMs: 40000 });
      const q = cleanQuestion(r.text);
      if (q && !wasAsked(q, asked)) return { question: q, source: 'ai', provider: r.provider, model: r.model };
    } catch (e) {
      if (isAbort(e)) throw e;
    }
    return fallbackQuestion(dossier, asked);
  }

  async function trainingFeedback(dossier, question, myAnswer, opts) {
    opts = opts || {};
    const d = dossier || {};
    const system = 'Tu es à la fois le recruteur de cet entretien' + (d.role ? ' (poste : ' + d.role + ')' : '') +
      ' et un coach d\'entretien exigeant mais bienveillant. Tu évalues la réponse orale d\'un candidat qui s\'entraîne. Français impeccable, vouvoiement. N\'invente rien qui ne soit dans le CV ou les notes.\n\n' +
      contextFor(d, { budget: 15000 });
    const ans = String(myAnswer || '').trim();
    const prompt = [
      'Question posée : « ' + String(question || '').trim() + ' »',
      'Réponse orale du candidat (transcription automatique, peut contenir des erreurs de reconnaissance) : « ' + (ans || '(aucune réponse)') + ' »',
      '',
      'Évalue selon : pertinence, structure (STAR pour les questions comportementales), exemples concrets et chiffrés, lien avec le poste, concision, aisance.',
      'Réponds UNIQUEMENT par un objet JSON :',
      '{"score": entier de 0 à 10, "feedback": "markdown court : 2 à 4 puces « - », d\'abord ce qui est réussi (✓), puis ce qu\'il faut améliorer (→)", "better": "réponse améliorée au format souffleur : une phrase clé en **gras** (22 mots maximum, 1re personne) puis 3 à 4 puces « - **mots clés** : fait tiré du CV », lignes séparées par \\n"}'
    ].join('\n');
    const r = await generate({ purpose: 'answer', system, prompt, json: true, stream: false, maxTokens: 1400, temperature: 0.3, timeoutMs: 30000, signal: opts.signal, budgetMs: 60000 });
    const p = parseJsonLoose(r.text);
    const data = p && p.data && typeof p.data === 'object' ? p.data : null;
    if (!data) throw aiError('PARSE', 'Évaluation illisible — réessayez.');
    let score = Math.round(Number(String(data.score != null ? data.score : data.note).toString().replace(',', '.').replace(/\/.*$/, '')));
    if (!isFinite(score)) score = 0;
    score = Math.max(0, Math.min(10, score));
    const feedback = fixAnswerFormat(asText(data.feedback || data.commentaire));
    const better = fixAnswerFormat(asText(data.better || data.meilleure || data.amelioree));
    if (!feedback && !better) throw aiError('PARSE', 'Évaluation illisible — réessayez.');
    return { score, feedback, better, provider: r.provider, model: r.model };
  }

  /* ----------------------------------------------------------- transcription */

  const HALLUCINATIONS = [
    /(?:sous-?titr[^.\n]*?)?(?:la communauté d')?amara\.org\b[^.\n]*\.?/gi,
    /sous-?titr(?:es|age)\s+(?:réalisés?\s+)?(?:par|de)\b[^.\n]*\.?/gi,
    /sous-?titrage\s+(?:st'?\s*\d+|société radio-canada|fr\b)[^.\n]*\.?/gi,
    /merci d'avoir regardé(?: cette vidéo)?\s*[.!]?/gi,
    /n'oubliez pas de (?:vous abonner|liker|mettre un like)[^.!\n]*[.!]?/gi,
    /abonnez-vous(?: à la chaîne)?\s*[.!]?/gi,
    /transcription (?:réalisée|faite) par[^.\n]*\.?/gi,
    /\[(?:musique|music|silence|vide|inaudible|bruits?[^\]]*|rires?|applaudissements|toux|soupirs?|pas de parole|aucune parole)\]/gi,
    /\((?:musique|music|silence|inaudible|bruits?[^)]*|rires?|applaudissements|toux|soupirs?)\)/gi,
    /[♪♫]+/g
  ];
  const NO_SPEECH = /^(?:\[?vide\]?|\.+|…+|-+|—|silence\.?|aucune parole.*|pas de parole.*|il n'y a (?:pas de|aucune) parole.*|\(?(?:aucun|pas de) (?:son|audio|discours).*|no speech.*|\[?inaudible\]?\.?)$/i;

  function collapseRepeats(t) {
    let s = t;
    s = s.replace(/(?<![\p{L}\p{N}])([\p{L}\p{N}'’]+)(?:[\s,]+\1){3,}(?![\p{L}\p{N}])/giu, '$1');
    s = s.replace(/(.{6,80}?)(?:[\s,.;!?…]+\1){2,}/gi, '$1');
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length >= 15) {
      const uniq = new Set(words.map(w => w.toLowerCase())).size;
      if (uniq / words.length < 0.25) return '';
    }
    return s;
  }

  function cleanTranscript(text) {
    let s = String(text || '').replace(/\r/g, '').trim();
    if (!s) return '';
    s = s.replace(/^```[a-z]*\s*|```$/gi, '').trim();
    s = s.replace(/^(?:transcription|texte)\s*:\s*/i, '');
    HALLUCINATIONS.forEach(re => { s = s.replace(re, ' '); });
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/^["«“]\s*|\s*["»”]$/g, '').trim();
    if (!s || NO_SPEECH.test(s)) return '';
    s = collapseRepeats(s).replace(/\s+/g, ' ').trim();
    if (!/[\p{L}\p{N}]/u.test(s)) return '';
    return s;
  }

  async function blobToBase64(blob) {
    if (typeof blob === 'string') return blob.replace(/^data:[^,]*,/, '');
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
    return btoa(s);
  }

  async function transcribe(wavBlob, opts) {
    opts = opts || {};
    const hint = String(opts.hint || opts.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    // Whisper sur Groq d'abord (bien plus rapide), Gemini en secours.
    if (keyOf('groq')) {
      try {
        const w = await groqWhisper(wavBlob, hint, opts.signal, opts.timeoutMs);
        return { text: cleanTranscript(w.text), model: w.model, provider: 'groq', ms: w.ms };
      } catch (e) {
        if ((e && e.name === 'AbortError') || !keyOf('gemini')) throw e;
      }
    }
    if (!keyOf('gemini')) throw noKeyError({ providers: ['gemini'] });
    const data = await blobToBase64(wavBlob);
    const mime = (wavBlob && wavBlob.type) || 'audio/wav';
    const prompt = [
      'Transcris mot à mot, en français, ce qui est dit dans cet extrait audio (entretien d\'embauche).',
      '- Écris uniquement les paroles prononcées : pas de commentaire, pas d\'horodatage, pas de nom de locuteur, pas de description de sons.',
      '- Ne traduis pas, ne résume pas, ne complète pas les phrases coupées.',
      '- S\'il n\'y a aucune parole intelligible (silence, musique, bruit), réponds exactement : [vide]'
    ].join('\n') + (hint ? '\nNoms propres et termes possibles : ' + hint : '');
    const r = await generate({
      purpose: 'fast', providers: ['gemini'], parts: [{ inline_data: { mime_type: mime, data } }], prompt,
      temperature: 0, maxTokens: 800, stream: false, timeoutMs: opts.timeoutMs || 15000, allowEmpty: true,
      signal: opts.signal, budgetMs: opts.budgetMs || 30000, maxCandidates: 3, liteOnly: true
    });
    return { text: cleanTranscript(r.text), model: r.model, provider: r.provider, ms: r.ms };
  }

  /* ------------------------------------------------------------- extractFile */

  // Transcription anticipée possible seulement avec Whisper (Groq) : rapide et sans entamer le quota Gemini.
  function canPeek() {
    if (!keyOf('groq')) return false;
    if (whisperRecent(60000) >= 12) return false;                    // garder la marge pour les finales
    return WHISPER.some(m => { const b = breaker.get('groq:' + m); return !(b && b.until > Date.now()); });
  }

  async function extractFile(blob, mime, opts) {
    opts = opts || {};
    const type = String(mime || (blob && blob.type) || 'application/octet-stream').toLowerCase();
    if (blob && blob.size > 14.5 * 1024 * 1024) {
      throw aiError('TOO_BIG', 'Fichier trop lourd pour la lecture par l\'IA (14 Mo maximum) — copiez-collez plutôt son texte.');
    }
    const data = await blobToBase64(blob);
    const prompt = 'Recopie intégralement tout le texte de ce document, dans l\'ordre, en conservant la structure (titres, listes, paragraphes ; tableaux ligne par ligne avec « | »). N\'ajoute aucun commentaire ni introduction, ne résume pas, ne traduis pas. Si le document ne contient aucun texte lisible, réponds exactement : [vide]';
    const r = await generate({
      purpose: 'answer', parts: [{ inline_data: { mime_type: type, data } }], prompt, temperature: 0,
      maxTokens: 16000, stream: true, firstTokenMs: 45000, idleMs: 30000, budgetMs: 180000, signal: opts.signal, onDelta: opts.onDelta
    });
    let t = String(r.text || '').trim().replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
    if (/^\[?vide\]?\.?$/i.test(t)) t = '';
    return t;
  }

  /* -------------------------------------------------------------------- test */

  async function test() {
    const out = [];
    for (const p of providerOrder()) {
      if (!keyOf(p)) continue;
      const t0 = now();
      try {
        const r = await generate({
          purpose: 'answer', providers: [p], prompt: 'Réponds uniquement : OK', maxTokens: 24, temperature: 0,
          stream: false, timeoutMs: 15000, ignoreBreaker: true, allowEmpty: true, budgetMs: 40000, maxCandidates: 3
        });
        out.push({ provider: p, model: r.model, ok: true, ms: r.ms, error: null });
      } catch (e) {
        out.push({ provider: p, model: (e && e.model) || (pick('answer').find(c => c.provider === p) || {}).model || '', ok: false, ms: Math.round(now() - t0), error: (e && e.message) || String(e) });
      }
    }
    return out;
  }

  function hasKey(provider) {
    if (provider) return !!keyOf(provider);
    return PROVIDERS.some(p => keyOf(p));
  }

  function state() {
    const t = Date.now();
    const list = [];
    breaker.forEach((v, k) => { if (v.until > t) { const i = k.indexOf(':'); list.push({ provider: k.slice(0, i), model: k.slice(i + 1), until: v.until, code: v.code }); } });
    return { lastOk, breaker: list, noThinking: Array.from(noThinking), keyErrors: Object.keys(deadKeys) };
  }

  function reset() {
    breaker.clear();
    noThinking.clear();
    Object.keys(deadKeys).forEach(k => { delete deadKeys[k]; });
    ctxCache.clear();
    lastOk = null;
  }

  S.ai = {
    hasKey, canPeek, discover, pick, generate, transcribe, answer, buildPrep, recap,
    trainingNext, trainingFeedback, extractFile, test,
    // extensions (hors contrat minimal, utiles à l'UI et aux tests)
    config, state, reset, context: contextFor, parseJson: parseJsonLoose, cleanTranscript,
    section, thanksMail, thinkingFor, FALLBACK
  };
})(window.Souffleur = window.Souffleur || {});
