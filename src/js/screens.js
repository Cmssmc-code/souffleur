/* Souffleur — écrans secondaires : entraînement, récap, réglages, diagnostic, prise en main.
   Chargé APRÈS app.js. N'utilise que les API publiques S.ui, S.app, S.store, S.ai, S.audio, S.util. */
(function (S) {
  'use strict';

  const U = S.util;

  /* ================================================================ helpers */

  const icon = (n) => (S.ui && S.ui.icon ? S.ui.icon(n) : '');
  const esc = (s) => U.esc(s == null ? '' : String(s));
  const md = (s) => U.md(s == null ? '' : String(s));
  const h = (html) => S.ui.h(String(html).trim());
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const nbsp = (s) => String(s == null ? '' : s).replace(/ ([?!:;»])/g, ' $1').replace(/« /g, '« ');
  // Niveau brut (RMS ou crête 0..1) → échelle visuelle en dB : -60 dBFS = 0, 0 dBFS = 1.
  const levelUnit = (x) => { x = Number(x) || 0; return x > 0 ? clamp((20 * Math.log10(x) + 60) / 60, 0, 1) : 0; };
  const toMs = (x) => (typeof x === 'number' ? x : Date.parse(x || '') || 0);
  const joinText = (a, b) => [a, b].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const hasTTS = () => !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
  const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;

  function toast(msg, kind) {
    if (S.ui && S.ui.toast) S.ui.toast(msg, kind || 'info');
    else if (U.toast) U.toast(msg, kind || 'info');
  }

  function settings() {
    try { return S.store.settings() || {}; } catch (e) { return {}; }
  }

  function setSettings(patch) {
    try { S.store.setSettings(patch); } catch (e) { toast(`Réglage non enregistré : ${errText(e)}`, 'err'); }
  }

  function hasKey() {
    try { return !!(S.ai && S.ai.hasKey && S.ai.hasKey()); } catch (e) { return false; }
  }

  function go(hash) {
    if (S.app && S.app.go) S.app.go(hash);
    else location.hash = hash;
  }

  const dossierHash = (id) => (id ? `#/dossier/${encodeURIComponent(id)}` : '#/');

  function routeParams(params) {
    if (Array.isArray(params)) return { id: params[0] || '', sessionId: params[1] || '' };
    if (params && typeof params === 'object' && (params.id || params.sessionId)) return params;
    const parts = String(location.hash || '').replace(/^#\/?/, '').split('/').map((p) => {
      try { return decodeURIComponent(p); } catch (e) { return p; }
    });
    return { id: parts[1] || '', sessionId: parts[2] || '' };
  }

  // Cycle de vie d'un écran : tout ce qui est ajouté via add() est nettoyé à la sortie.
  function lifecycle() {
    const fns = [];
    return {
      alive: true,
      add(fn) { if (typeof fn === 'function') fns.push(fn); return fn; },
      end() {
        this.alive = false;
        fns.splice(0).reverse().forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
      }
    };
  }

  function mount(root, cls, html) {
    const el = h(`<section class="screen sc ${cls}">${html}</section>`);
    root.innerHTML = '';
    root.appendChild(el);
    try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
    return el;
  }

  function topbar(o) {
    return `<header class="topbar glass sc-topbar">
      <button type="button" class="icon-btn" data-act="back" aria-label="Retour" title="Retour">${icon('chevron-left')}</button>
      <div class="topbar-title sc-title"><span class="sc-title-main">${esc(o.title)}</span><span class="small muted sc-sub">${esc(o.sub || '')}</span></div>
      <div class="topbar-actions sc-actions">${o.actions || ''}</div>
    </header>`;
  }

  // Section façon Réglages : carte + titre + liste groupée (classes partagées du cœur).
  function section(title, rows, cls) {
    return `<section class="card card-pad sc-section${cls ? ` ${cls}` : ''}">
      ${title ? `<div class="card-head"><h2 class="h3">${esc(title)}</h2></div>` : ''}
      <div class="list">${rows}</div></section>`;
  }
  const tile = (name, color) => `<span class="tile tile-${color}">${icon(name)}</span>`;
  const chev = () => (S.ui && S.ui.icon ? S.ui.icon('chevron-right', 'chev') : '');
  // title et sub sont du HTML déjà échappé par l'appelant.
  const main = (title, sub, attrs) => `<span class="list-main"><b>${title}</b>${sub != null ? `<small${attrs ? ` ${attrs}` : ''}>${sub}</small>` : ''}</span>`;

  // Délégation des clics [data-act] ; 'home' est toujours géré.
  function onAct(el, handlers) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || !el.contains(b) || b.disabled) return;
      const fn = handlers[b.dataset.act] || (b.dataset.act === 'home' ? () => go('#/') : null);
      if (!fn) return;
      e.preventDefault();
      fn(b, e);
    });
  }

  function notFound(el, text) {
    const body = el.querySelector('.sc-body');
    body.innerHTML = `<div class="empty sc-empty">${icon('warning')}<div class="h3">${esc(text)}</div>
      <button type="button" class="btn btn-primary" data-act="home">${icon('home')} Retour à l'accueil</button></div>`;
  }

  function errText(e) {
    if (!e) return 'erreur inconnue';
    const obj = typeof e === 'object';
    const code = obj ? String(e.code || '') : '';
    const status = obj ? Number(e.status) || 0 : 0;
    const name = obj ? String(e.name || '') : '';
    const msg = String((obj ? (e.message || e.error) : e) || '');
    if (code === 'KEY' || status === 401 || status === 403 || /refusée|\b40[13]\b|api.?key|invalid.*key|unauthori/i.test(msg)) return 'clé refusée';
    if (code === 'QUOTA' || status === 429 || /quota|\b429\b|rate.?limit|resource.?exhausted/i.test(msg)) return 'quota atteint, réessayez dans un instant';
    if (code === 'OFFLINE' || code === 'NETWORK' || /failed to fetch|networkerror|network error|réseau|connexion internet/i.test(msg)) return 'réseau indisponible';
    if (code === 'TIMEOUT' || name === 'AbortError' || name === 'TimeoutError' || /timeout|timed out|assez vite|délai/i.test(msg)) return 'délai dépassé';
    if (code === 'NO_KEY' || /aucune clé/i.test(msg)) return 'aucune clé IA';
    return (msg.replace(/[.\s]+$/, '') || 'erreur inconnue').slice(0, 180);
  }

  function fmtNum(n, dec) {
    return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: dec == null ? 1 : dec, minimumFractionDigits: 0 });
  }
  function fmtMs(ms) {
    ms = Math.round(Number(ms) || 0);
    return ms < 1000 ? `${ms} ms` : `${fmtNum(ms / 1000, 1)} s`;
  }
  function fmtBytes(b) {
    b = Number(b) || 0;
    if (b < 1024) return `${b} o`;
    if (b < 1048576) return `${fmtNum(b / 1024, 0)} Ko`;
    return `${fmtNum(b / 1048576, 1)} Mo`;
  }
  function fmtDuration(ms) {
    const m = Math.round((Number(ms) || 0) / 60000);
    if (m < 1) return 'moins d’une minute';
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
  }
  function fmtDate(x) {
    const d = new Date(typeof x === 'number' ? x : x || '');
    if (isNaN(d)) return '';
    return d.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function fmtT(ms) {
    return U.fmtTime ? U.fmtTime(Math.max(0, Number(ms) || 0)) : '';
  }

  function dossierTitle(d) {
    if (!d) return '';
    return d.name || [d.role, d.company].filter(Boolean).join(' · ') || 'Entretien';
  }

  const WHO = { them: 'Recruteur', me: 'Moi', mixed: 'Voix' };

  function scoreKind(s) { return s >= 7 ? 'ok' : s >= 5 ? 'warn' : 'err'; }
  function clampScore(v) {
    const n = Number(String(v == null ? '' : v).replace(',', '.'));
    return isFinite(n) ? Math.round(clamp(n, 0, 10) * 10) / 10 : null;
  }
  function scoreRing(s, big) {
    return `<div class="sc-ring is-${scoreKind(s)}${big ? ' is-big' : ''}" style="--sc-p:${clamp(s / 10, 0, 1).toFixed(3)}" role="img" aria-label="Note ${fmtNum(s)} sur 10">
      <b>${fmtNum(s)}</b><span>/10</span></div>`;
  }

  async function copyText(text) {
    text = String(text || '');
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch (e) { /* repli ci-dessous */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  async function copyWithToast(text, label) {
    if (!String(text || '').trim()) { toast('Rien à copier.', 'warn'); return; }
    const ok = await copyText(text);
    toast(ok ? `${label} copié dans le presse-papiers.` : 'Copie impossible : sélectionnez le texte et faites Ctrl+C.', ok ? 'ok' : 'err');
  }

  function downloadText(text, filename, mime) {
    const blob = new Blob([text], { type: mime || 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'souffleur';

  // Écrit/fusionne une session dans le dossier frais (évite d'écraser les modifs faites ailleurs).
  async function upsertSession(dossierId, patch) {
    const d = await S.store.get(dossierId);
    if (!d) throw new Error('Dossier introuvable');
    d.sessions = Array.isArray(d.sessions) ? d.sessions : [];
    const i = d.sessions.findIndex((x) => x && x.id === patch.id);
    if (i >= 0) d.sessions[i] = Object.assign({}, d.sessions[i], patch);
    else d.sessions.push(Object.assign({ kind: 'live', transcript: [], answers: [], scores: null, recap: null }, patch));
    return S.store.save(d);
  }

  function support() {
    let sup = null;
    try { sup = S.audio && S.audio.support ? S.audio.support() : null; } catch (e) { sup = null; }
    const md2 = navigator.mediaDevices || {};
    return Object.assign({
      getUserMedia: !!md2.getUserMedia,
      getDisplayMedia: !!md2.getDisplayMedia,
      displayAudio: !!md2.getDisplayMedia && /Chrome|Edg\//.test(navigator.userAgent) && !/Android|Mobile/i.test(navigator.userAgent),
      webSpeech: !!SR(),
      audioWorklet: !!(window.AudioWorkletNode),
      wakeLock: 'wakeLock' in navigator,
      docPiP: 'documentPictureInPicture' in window
    }, sup || {});
  }

  function browserInfo() {
    const ua = navigator.userAgent || '';
    const uad = navigator.userAgentData;
    let m; let name = 'Navigateur'; let ver = 0;
    if ((m = ua.match(/Edg(?:A|iOS)?\/(\d+)/))) { name = 'Edge'; ver = +m[1]; }
    else if ((m = ua.match(/(?:OPR|Opera)\/(\d+)/))) { name = 'Opera'; ver = +m[1]; }
    else if ((m = ua.match(/(?:Firefox|FxiOS)\/(\d+)/))) { name = 'Firefox'; ver = +m[1]; }
    else if ((m = ua.match(/(?:Chrome|CriOS)\/(\d+)/))) { name = 'Chrome'; ver = +m[1]; }
    else if ((m = ua.match(/Version\/(\d+).*Safari/))) { name = 'Safari'; ver = +m[1]; }
    const android = /Android/i.test(ua);
    const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const mobile = uad && typeof uad.mobile === 'boolean' ? uad.mobile : (android || ios || /Mobile/i.test(ua));
    const chromium = /Chrome\/|Edg\//.test(ua) && !ios && !/Firefox/.test(ua);
    return { name, ver, android, ios, mobile, chromium };
  }

  const PRESET_FALLBACK = [
    { id: 'visio-casque', label: 'Visio sur ce PC (Meet / Teams)', needsKey: true },
    { id: 'haut-parleur', label: 'Haut-parleur ou téléphone à côté', needsKey: false },
    { id: 'visio-hp', label: 'Visio sur ce PC, son sur haut-parleurs', needsKey: false },
    { id: 'micro-cloud', label: 'Micro seul, transcription IA (bruit, accents)', needsKey: true }
  ];
  const PRESET_INFO = {
    'visio-casque': { icon: 'video', desc: 'Le son de Meet ou Teams est capté directement : le recruteur et vous êtes séparés. Idéal avec un casque.' },
    'haut-parleur': { icon: 'phone', desc: 'Un seul micro entend tout le monde (téléphone en haut-parleur posé à côté). 100 % gratuit.' },
    'visio-hp': { icon: 'speaker', desc: 'Visio sur ce PC avec le son sur les haut-parleurs : transcription gratuite par Chrome.' },
    'micro-cloud': { icon: 'waveform', desc: 'Transcription par l’IA, plus robuste au bruit et aux accents.' }
  };
  function presets() {
    const p = S.audio && Array.isArray(S.audio.presets) && S.audio.presets.length ? S.audio.presets : PRESET_FALLBACK;
    return p;
  }

  /* ================================================================ ENTRAÎNEMENT */

  const SILENCE_MS = 2500;
  const CLASSIC_QUESTIONS = [
    'Présentez-vous en quelques minutes.',
    'Pourquoi ce poste vous intéresse-t-il ?',
    'Pourquoi souhaitez-vous rejoindre notre organisation ?',
    'Quelles sont vos principales qualités pour ce poste ?',
    'Quel est votre principal axe d’amélioration ?',
    'Racontez-moi une situation difficile que vous avez gérée et comment vous l’avez résolue.',
    'Parlez-moi d’une réussite dont vous êtes particulièrement fier.',
    'Comment gérez-vous les priorités quand les délais sont serrés ?',
    'Comment réagissez-vous face à un désaccord avec votre responsable ?',
    'Où vous voyez-vous dans cinq ans ?',
    'Pourquoi devrions-nous retenir votre candidature plutôt qu’une autre ?',
    'Quelles sont vos prétentions salariales ?',
    'Quelle est votre disponibilité ?',
    'Avez-vous des questions à nous poser ?'
  ];

  let voicesPromise = null;
  function loadVoices() {
    if (voicesPromise) return voicesPromise;
    voicesPromise = new Promise((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth) { resolve([]); return; }
      const now = synth.getVoices();
      if (now && now.length) { resolve(now); return; }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try { synth.removeEventListener('voiceschanged', finish); } catch (e) { /* ignore */ }
        resolve(synth.getVoices() || []);
      };
      try { synth.addEventListener('voiceschanged', finish); } catch (e) { synth.onvoiceschanged = finish; }
      setTimeout(finish, 1500);
    }).then((v) => { if (!v.length) voicesPromise = null; return v; });
    return voicesPromise;
  }

  async function pickVoice(lang) {
    const voices = await loadVoices();
    const fr = voices.filter((v) => /^fr/i.test(v.lang || ''));
    const want = String(lang || 'fr-FR').toLowerCase();
    const exact = fr.filter((v) => String(v.lang).replace('_', '-').toLowerCase() === want);
    const pool = exact.length ? exact : fr.filter((v) => /fr[-_]FR/i.test(v.lang)).length ? fr.filter((v) => /fr[-_]FR/i.test(v.lang)) : fr;
    const rank = (v) => (/natural|neural|online/i.test(v.name) ? 0 : /google/i.test(v.name) ? 1 : v.localService ? 3 : 2);
    return pool.slice().sort((a, b) => rank(a) - rank(b))[0] || null;
  }

  function trainingLang() {
    const l = settings().lang || 'fr-FR';
    return /^fr/i.test(l) ? l : 'fr-FR';
  }

  async function speak(text, ctx) {
    if (!hasTTS() || !text) return false;
    const lang = trainingLang();
    const voice = await pickVoice(lang);
    if (ctx && !ctx.alive) return false;
    const synth = window.speechSynthesis;
    try { synth.cancel(); } catch (e) { /* ignore */ }
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = voice ? voice.lang : lang;
      if (voice) u.voice = voice;
      u.rate = 1.02;
      u.pitch = 1;
      let done = false;
      // Garde-fou : Chrome oublie parfois d'émettre onend.
      const guard = setTimeout(() => finish(true), 4000 + text.length * 90);
      function finish(ok) { if (done) return; done = true; clearTimeout(guard); resolve(ok); }
      u.onend = () => finish(true);
      u.onerror = () => finish(false);
      try { synth.speak(u); } catch (e) { finish(false); }
    });
  }

  function stopSpeech() {
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  }

  // Reconnaissance vocale continue avec redémarrage automatique (Chrome coupe après un silence).
  function createListener(opts) {
    const Ctor = SR();
    if (!Ctor) return null;
    let rec = null; let active = false; let timer = 0; let backoff = 250; let finals = '';
    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(spawn, backoff);
      backoff = Math.min(backoff * 2, 4000);
    }
    function spawn() {
      if (!active) return;
      const r = new Ctor();
      const t0 = Date.now();
      rec = r;
      r.lang = opts.lang || 'fr-FR';
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      r.onstart = () => { if (rec === r && opts.onStart) opts.onStart(); };
      r.onresult = (e) => {
        if (rec !== r) return;
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          const tx = res && res[0] ? res[0].transcript : '';
          if (res.isFinal) finals = joinText(finals, tx);
          else interim += tx;
        }
        backoff = 250;
        opts.onText(finals, interim.trim());
      };
      r.onerror = (e) => {
        if (rec !== r) return;
        const code = e && e.error;
        if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture' || code === 'language-not-supported') {
          active = false;
          clearTimeout(timer);
          if (opts.onFatal) opts.onFatal(code);
        }
      };
      r.onend = () => {
        if (rec !== r || !active) return;
        if (Date.now() - t0 > 3000) backoff = 250;
        schedule();
      };
      try { r.start(); } catch (err) { if (active) schedule(); }
    }
    return {
      start(initial) { active = true; finals = String(initial || '').trim(); backoff = 250; spawn(); },
      stop() {
        active = false;
        clearTimeout(timer);
        const r = rec;
        rec = null;
        if (r) { try { r.abort(); } catch (e) { /* ignore */ } }
      }
    };
  }

  function verdict(s) {
    if (s >= 8.5) return 'Excellent';
    if (s >= 7) return 'Très bien';
    if (s >= 5) return 'Correct, à affiner';
    return 'À retravailler';
  }

  function encouragement(avg) {
    if (avg == null) return 'Ajoutez une clé IA dans les réglages pour obtenir une note et un retour détaillé à chaque réponse.';
    if (avg >= 7) return 'Vous êtes prêt : gardez ce niveau de précision et de concision le jour J.';
    if (avg >= 5) return 'Bonne base. Relisez les meilleures réponses puis recommencez les questions les plus faibles.';
    return 'Continuez à vous entraîner : appuyez-vous sur votre pitch et sur des exemples chiffrés (méthode STAR).';
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function runTraining(el, dossier, c) {
    const body = el.querySelector('.sc-body');
    const actions = el.querySelector('.sc-actions');
    el.querySelector('.sc-sub').textContent = dossierTitle(dossier);

    const st = {
      total: 7,
      voice: hasTTS(),
      input: SR() ? 'mic' : 'text',
      phase: 'intro',
      gen: 0,
      sayId: 0,
      items: [],
      asked: [],
      transcript: [],
      current: null,
      retry: false,
      finals: '',
      interim: '',
      listener: null,
      speaking: false,
      sessionId: null,
      startedAt: null,
      t0: 0,
      ended: false,
      saving: Promise.resolve(),
      warnedNext: false,
      prepPool: []
    };

    c.add(() => {
      stopListening();
      stopSpeech();
      clearTimeout(st.silenceT);
      clearTimeout(st.hearT);
      if (st.items.length && !st.ended) persist(true);
    });

    /* ---------- persistance ---------- */
    function sessionObj(ended) {
      return {
        id: st.sessionId,
        kind: 'training',
        startedAt: st.startedAt,
        endedAt: ended ? new Date().toISOString() : null,
        transcript: st.transcript.slice(),
        answers: st.items.filter((i) => i.better).map((i) => ({ t: i.t, question: i.question, answer: i.better, source: 'ai', model: i.model || '' })),
        scores: st.items.map((i) => ({ question: i.question, answer: i.answer, score: i.score, feedback: i.feedback }))
      };
    }
    function persist(ended) {
      if (!st.sessionId || !st.items.length) return st.saving;
      if (ended) st.ended = true;
      const snap = sessionObj(ended);
      st.saving = st.saving
        .then(() => upsertSession(dossier.id, snap))
        .then((d) => { if (d) dossier = d; })
        .catch((e) => toast(`Sauvegarde de l’entraînement impossible : ${errText(e)}`, 'err'));
      return st.saving;
    }

    /* ---------- intro ---------- */
    function drawIntro() {
      st.phase = 'intro';
      actions.innerHTML = '';
      const key = hasKey();
      const nPrep = ((dossier.prep && dossier.prep.questions) || []).length;
      const past = (dossier.sessions || []).filter((s) => s && s.kind === 'training').slice(-3).reverse();
      const seg = (k, opts) => opts.map(([v, label, dis]) =>
        `<button type="button" data-act="seg" data-k="${k}" data-v="${v}" class="${String(st[k]) === String(v) ? 'on' : ''}"${dis ? ' disabled' : ''}>${label}</button>`).join('');
      body.innerHTML = `
        <div class="card glass card-pad sc-hero">
          <div class="sc-hero-ic">${icon('graduation')}</div>
          <div class="h1">Entraînement</div>
          <p class="muted">Un recruteur virtuel vous pose des questions à voix haute. Répondez comme en vrai : vous recevez une note sur 10, un retour précis et une meilleure réponse.</p>
        </div>
        ${key ? '' : `<div class="card card-pad sc-note is-warn">${icon('warning')}<div class="sc-grow"><b>Mode sans IA.</b> Les questions viennent de votre préparation${nPrep ? ` (${plural(nPrep, 'question', 'questions')})` : ' et d’une liste classique'}, sans note automatique.</div>
          <button type="button" class="btn btn-sm btn-ghost" data-act="settings">Ajouter une clé</button></div>`}
        ${section('Options', `
          <div class="list-row">${tile('list', 'blue')}${main('Nombre de questions', 'Entre 5 et 10, comme un vrai entretien.')}
            <div class="seg" role="group" aria-label="Nombre de questions">${seg('total', [[5, '5'], [7, '7'], [10, '10']])}</div></div>
          <div class="list-row">${tile('mic', 'green')}${main('Je réponds', SR() ? 'Fin automatique après 2,5 s de silence.' : 'Reconnaissance vocale indisponible dans ce navigateur.')}
            <div class="seg" role="group" aria-label="Mode de réponse">${seg('input', [['mic', 'Au micro', !SR()], ['text', 'Par écrit']])}</div></div>
          <div class="list-row">${tile('speaker', 'violet')}${main('Lire les questions à voix haute', hasTTS() ? 'Voix française du navigateur.' : 'Synthèse vocale indisponible dans ce navigateur.')}
            <label class="switch"><input type="checkbox" data-opt="voice" ${st.voice ? 'checked' : ''} ${hasTTS() ? '' : 'disabled'} aria-label="Lire les questions à voix haute"><span></span></label></div>`)}
        ${past.length ? section('Derniers entraînements', past.map((s) => {
          const sc = (s.scores || []).map((x) => clampScore(x.score)).filter((x) => x != null);
          const avg = sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : null;
          return `<button type="button" class="list-row" data-act="open-recap" data-id="${esc(s.id)}">
            ${tile('graduation', 'violet')}${main(esc(fmtDate(s.startedAt) || 'Entraînement'), plural((s.scores || []).length, 'question', 'questions'))}
            ${avg != null ? `<span class="pill pill-${scoreKind(avg)}">${fmtNum(avg)}/10</span>` : ''}${chev()}</button>`;
        }).join('')) : ''}
        <div class="sc-cta"><button type="button" class="btn btn-primary sc-big" data-act="start">${icon('play')} Commencer l’entraînement</button></div>`;
    }

    /* ---------- boucle de questions ---------- */
    function start() {
      st.sessionId = U.uid();
      st.startedAt = new Date().toISOString();
      st.t0 = Date.now();
      st.items = [];
      st.asked = [];
      st.transcript = [];
      st.ended = false;
      st.prepPool = shuffle(((dossier.prep && dossier.prep.questions) || []).map((x) => x && x.q).filter(Boolean));
      actions.innerHTML = `<button type="button" class="btn btn-sm btn-ghost" data-act="finish">${icon('stop')} Terminer</button>`;
      loadVoices();
      nextQuestion();
    }

    function progressHtml() {
      const done = st.items.length;
      return `<div class="tr-progress"><div class="meter"><i style="--v:${clamp(done / st.total, 0, 1).toFixed(3)}"></i></div>
        <span class="small muted">${done} / ${st.total}</span></div>`;
    }

    function drawLoading(text) {
      body.innerHTML = `${progressHtml()}<div class="card glass card-pad sc-loading"><div class="spinner"></div><div class="muted">${esc(text)}</div></div>`;
    }

    function fallbackQuestion() {
      const asked = new Set(st.asked.map((q) => U.norm(q)));
      const pool = st.prepPool.concat(CLASSIC_QUESTIONS);
      return pool.find((q) => !asked.has(U.norm(q))) || CLASSIC_QUESTIONS[st.asked.length % CLASSIC_QUESTIONS.length];
    }

    async function nextQuestion() {
      const g = ++st.gen;
      stopListening();
      stopSpeech();
      st.retry = false;
      st.phase = 'loading';
      drawLoading('Le recruteur prépare sa question…');
      let q = '';
      if (hasKey()) {
        try {
          const r = await S.ai.trainingNext(dossier, st.asked.slice());
          q = String((r && (r.question || r.text)) || '').trim();
        } catch (e) {
          if (!st.warnedNext) { toast(`Question IA indisponible (${errText(e)}) : question de secours.`, 'warn'); st.warnedNext = true; }
        }
      }
      if (g !== st.gen || !c.alive) return;
      if (!q) q = fallbackQuestion();
      st.asked.push(q);
      st.current = { question: q, answer: '', t: Date.now() - st.t0 };
      st.transcript.push({ t: st.current.t, who: 'them', text: q });
      askCurrent();
    }

    function askCurrent() {
      st.gen++;
      st.phase = 'question';
      st.finals = '';
      st.interim = '';
      st.speaking = false;
      drawQuestion();
      sayThenListen();
    }

    async function sayThenListen() {
      const my = ++st.sayId;
      const g = st.gen;
      stopListening();
      clearTimeout(st.silenceT);
      hideSilence();
      if (st.voice && hasTTS()) {
        st.speaking = true;
        setStatus('speaking');
        await speak(st.current.question, c);
        if (my !== st.sayId) return;
        st.speaking = false;
      }
      if (g !== st.gen || !c.alive || st.phase !== 'question') return;
      if (st.input === 'mic') startListening();
      else setStatus('text');
    }

    function drawQuestion() {
      const n = st.retry ? st.items.length : st.items.length + 1;
      const mic = st.input === 'mic';
      body.innerHTML = `
        ${progressHtml()}
        <div class="card glass card-pad tr-qcard">
          <div class="tr-qmeta"><span class="badge">Question ${n} sur ${st.total}</span>
            ${hasTTS() ? `<button type="button" class="icon-btn" data-act="replay" aria-label="Réécouter la question" title="Réécouter la question">${icon('speaker')}</button>` : ''}</div>
          <div class="tr-question" aria-live="polite">${esc(nbsp(st.current.question))}</div>
        </div>
        <div class="card glass card-pad tr-acard">
          <div class="tr-status" data-state="off"><div class="tr-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><span class="tr-status-text"></span></div>
          <div class="tr-live" ${mic ? '' : 'hidden'} aria-live="polite"><span class="tr-final"></span><span class="tr-interim"></span><span class="tr-placeholder muted">Votre réponse s’affichera ici pendant que vous parlez.</span></div>
          <textarea class="tr-text" rows="6" ${mic ? 'hidden' : ''} placeholder="Tapez votre réponse…" aria-label="Votre réponse"></textarea>
          <div class="tr-silence" hidden><i></i></div>
          <div class="row tr-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-act="skip">Passer</button>
            <button type="button" class="btn btn-ghost btn-sm" data-act="toggle-input">${mic ? `${icon('keyboard')} Écrire` : `${icon('mic')} Parler`}</button>
            <span class="sc-grow"></span>
            <button type="button" class="btn btn-primary" data-act="done">${icon('check')} J’ai fini</button>
          </div>
          <div class="small muted tr-hint">${mic ? 'Validation automatique après 2,5 s de silence.' : 'Ctrl + Entrée pour valider.'}</div>
        </div>`;
      const ta = body.querySelector('.tr-text');
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finishAnswer(false); }
      });
    }

    function setStatus(kind) {
      const box = body.querySelector('.tr-status');
      if (!box) return;
      box.dataset.state = kind;
      const txt = {
        speaking: 'Le recruteur pose la question…',
        listening: 'À vous : je vous écoute.',
        hearing: 'À vous : je vous écoute.',
        text: 'Réponse écrite',
        off: ''
      }[kind] || '';
      box.querySelector('.tr-status-text').textContent = txt;
      clearTimeout(st.hearT);
      if (kind === 'hearing') st.hearT = setTimeout(() => { if (box.dataset.state === 'hearing') setStatus('listening'); }, 900);
    }

    function renderLive() {
      const f = body.querySelector('.tr-final');
      if (!f) return;
      f.textContent = st.finals;
      body.querySelector('.tr-interim').textContent = st.interim ? (st.finals ? ' ' : '') + st.interim : '';
      body.querySelector('.tr-placeholder').hidden = !!(st.finals || st.interim);
      const live = body.querySelector('.tr-live');
      live.scrollTop = live.scrollHeight;
    }

    function hideSilence() {
      const bar = body.querySelector('.tr-silence');
      if (bar) { bar.hidden = true; bar.classList.remove('run'); }
    }

    function armSilence() {
      clearTimeout(st.silenceT);
      const words = joinText(st.finals, st.interim).split(/\s+/).filter(Boolean).length;
      const bar = body.querySelector('.tr-silence');
      if (words < 2) { hideSilence(); return; }
      if (bar) {
        bar.hidden = false;
        bar.classList.remove('run');
        void bar.offsetWidth; // relance l'animation
        bar.classList.add('run');
      }
      st.silenceT = setTimeout(() => {
        if (st.phase === 'question' && st.input === 'mic' && !st.speaking) finishAnswer(true);
      }, SILENCE_MS);
    }

    function stopListening() {
      if (st.listener) { st.listener.stop(); st.listener = null; }
    }

    function startListening() {
      stopListening();
      const lis = createListener({
        lang: settings().lang || 'fr-FR',
        onText(finals, interim) {
          if (st.phase !== 'question') return;
          st.finals = finals;
          st.interim = interim;
          renderLive();
          setStatus('hearing');
          armSilence();
        },
        onStart() {
          const box = body.querySelector('.tr-status');
          if (box && box.dataset.state !== 'hearing') setStatus('listening');
        },
        onFatal(code) {
          st.listener = null;
          const msg = code === 'not-allowed' || code === 'service-not-allowed'
            ? 'Micro refusé : autorisez-le via l’icône de la barre d’adresse. Passage en réponse écrite.'
            : code === 'audio-capture' ? 'Aucun micro détecté. Passage en réponse écrite.'
              : 'Reconnaissance vocale indisponible. Passage en réponse écrite.';
          toast(msg, 'warn');
          switchInput('text');
        }
      });
      if (!lis) { switchInput('text'); return; }
      st.listener = lis;
      lis.start(st.finals);
      setStatus('listening');
    }

    function switchInput(mode) {
      if (mode === 'mic' && !SR()) { toast('Reconnaissance vocale indisponible dans ce navigateur.', 'warn'); mode = 'text'; }
      const prev = st.input;
      st.input = mode;
      if (st.phase !== 'question') return;
      stopListening();
      clearTimeout(st.silenceT);
      hideSilence();
      const live = body.querySelector('.tr-live');
      const ta = body.querySelector('.tr-text');
      const btn = body.querySelector('[data-act="toggle-input"]');
      const hint = body.querySelector('.tr-hint');
      if (mode === 'text') {
        if (prev === 'mic') ta.value = joinText(ta.value, joinText(st.finals, st.interim));
        live.hidden = true;
        ta.hidden = false;
        btn.innerHTML = `${icon('mic')} Parler`;
        hint.textContent = 'Ctrl + Entrée pour valider.';
        setStatus(st.speaking ? 'speaking' : 'text');
        ta.focus();
        try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) { /* ignore */ }
      } else {
        if (prev === 'text') { st.finals = ta.value.trim(); st.interim = ''; }
        ta.hidden = true;
        live.hidden = false;
        btn.innerHTML = `${icon('keyboard')} Écrire`;
        hint.textContent = 'Validation automatique après 2,5 s de silence.';
        renderLive();
        if (!st.speaking) startListening();
      }
    }

    function finishAnswer(auto) {
      if (st.phase !== 'question') return;
      let text = '';
      if (st.input === 'mic') text = joinText(st.finals, st.interim);
      else { const ta = body.querySelector('.tr-text'); text = ta ? ta.value : ''; }
      text = String(text || '').trim();
      if (!text) {
        if (!auto) toast('Réponse vide : parlez ou écrivez avant de valider.', 'warn');
        return;
      }
      stopListening();
      stopSpeech();
      clearTimeout(st.silenceT);
      st.current.answer = text;
      st.transcript.push({ t: Date.now() - st.t0, who: 'me', text });
      scoreCurrent();
    }

    function prepMatch(q) {
      let best = null; let bs = 0;
      ((dossier.prep && dossier.prep.questions) || []).forEach((x) => {
        if (!x || !x.q) return;
        const s = U.similarity(q, x.q);
        if (s > bs) { bs = s; best = x; }
      });
      return bs >= 0.45 ? best : null;
    }

    async function scoreCurrent() {
      const g = ++st.gen;
      st.phase = 'scoring';
      drawLoading('Analyse de votre réponse…');
      const cur = st.current;
      let res = null; let err = null;
      if (hasKey()) {
        try { res = await S.ai.trainingFeedback(dossier, cur.question, cur.answer); } catch (e) { err = e; }
      }
      if (g !== st.gen || !c.alive) return;
      const item = Object.assign({}, cur);
      if (res && (res.feedback || res.better || res.score != null)) {
        item.score = clampScore(res.score);
        item.feedback = String(res.feedback || '');
        item.better = String(res.better || '');
        item.model = res.model || '';
      } else {
        const pr = prepMatch(cur.question);
        item.score = null;
        item.offline = true;
        item.feedback = (err ? `L’analyse IA n’a pas abouti (${errText(err)}).` : 'Pas de clé IA : pas de note automatique.')
          + (pr ? ' Comparez avec votre réponse préparée ci-dessous.' : '');
        item.better = pr ? String(pr.a || '') : '';
      }
      if (st.retry && st.items.length) st.items[st.items.length - 1] = item;
      else st.items.push(item);
      st.retry = false;
      persist(false);
      drawFeedback(item);
    }

    function drawFeedback(item) {
      st.phase = 'feedback';
      const has = item.score != null;
      const last = st.items.length >= st.total;
      body.innerHTML = `
        ${progressHtml()}
        <div class="card glass card-pad tr-result">
          ${has ? scoreRing(item.score) : `<div class="sc-ring is-na">${icon('info')}</div>`}
          <div class="sc-grow"><div class="h2">${has ? verdict(item.score) : 'Sans note'}</div>
            <div class="small muted">${esc(nbsp(item.question))}</div></div>
        </div>
        ${item.feedback ? `<div class="card glass card-pad"><div class="h3 sc-h">${icon('sparkles')} Retour</div><div class="md">${md(item.feedback)}</div></div>` : ''}
        ${item.better ? `<div class="card glass card-pad tr-better"><div class="h3 sc-h">${icon('bolt')} ${item.offline ? 'Votre réponse préparée' : 'Meilleure réponse'}</div><div class="md">${md(item.better)}</div></div>` : ''}
        <details class="card glass card-pad sc-details"><summary>${icon('person')} Votre réponse ${icon('chevron-down')}</summary><p class="tr-mine">${esc(item.answer)}</p></details>
        <div class="row sc-footer">
          <button type="button" class="btn btn-ghost" data-act="retry">${icon('refresh')} Réessayer</button>
          <span class="sc-grow"></span>
          <button type="button" class="btn btn-primary" data-act="next">${last ? 'Voir le bilan' : 'Question suivante'} ${icon('chevron-right')}</button>
        </div>`;
      const nb = body.querySelector('[data-act="next"]');
      if (nb) nb.focus({ preventScroll: true });
    }

    function drawSummary() {
      stopListening();
      stopSpeech();
      st.gen++;
      st.phase = 'summary';
      actions.innerHTML = '';
      if (st.items.length) persist(true);
      const scored = st.items.filter((i) => i.score != null);
      const avg = scored.length ? scored.reduce((a, i) => a + i.score, 0) / scored.length : null;
      const dur = Date.now() - st.t0;
      body.innerHTML = `
        <div class="card glass card-pad sc-hero tr-summary">
          ${avg != null ? scoreRing(avg, true) : `<div class="sc-hero-ic">${icon('graduation')}</div>`}
          <div class="h1">Bilan</div>
          <div class="muted">${plural(st.items.length, 'réponse', 'réponses')} · ${fmtDuration(dur)}${avg != null ? ` · moyenne ${fmtNum(avg)}/10` : ''}</div>
          <p>${st.items.length ? esc(encouragement(avg)) : 'Aucune réponse enregistrée cette fois-ci.'}</p>
        </div>
        ${st.items.length ? section('Détail des réponses', st.items.map((it) => `
          <div class="list-row"><details class="tr-sum-item">
            <summary>${it.score != null ? `<span class="pill pill-${scoreKind(it.score)}">${fmtNum(it.score)}/10</span>` : '<span class="pill">—</span>'}
              <span class="tr-sum-q">${esc(nbsp(it.question))}</span>${icon('chevron-down')}</summary>
            <div class="tr-sum-detail">
              <div class="small muted">Votre réponse</div><p class="tr-mine">${esc(it.answer)}</p>
              ${it.feedback ? `<div class="small muted">Retour</div><div class="md">${md(it.feedback)}</div>` : ''}
              ${it.better ? `<div class="small muted">${it.offline ? 'Réponse préparée' : 'Meilleure réponse'}</div><div class="md">${md(it.better)}</div>` : ''}
            </div></details></div>`).join(''), 'tr-sum') : ''}
        <div class="row sc-footer">
          <button type="button" class="btn btn-ghost" data-act="again">${icon('refresh')} Recommencer</button>
          ${st.items.length ? `<button type="button" class="btn btn-ghost" data-act="recap">${icon('doc')} Récap détaillé</button>` : ''}
          <span class="sc-grow"></span>
          <button type="button" class="btn btn-primary" data-act="back">Retour au dossier</button>
        </div>`;
    }

    async function finish() {
      if (st.phase === 'summary') return;
      if (!st.items.length) {
        const ok = await S.ui.confirm({ title: 'Arrêter l’entraînement ?', text: 'Aucune réponse n’a encore été notée : rien ne sera enregistré.', okLabel: 'Arrêter' });
        if (!ok || !c.alive) return;
        stopListening();
        stopSpeech();
        st.gen++;
        drawIntro();
        return;
      }
      drawSummary();
    }

    /* ---------- événements ---------- */
    onAct(el, {
      back: () => go(dossierHash(dossier.id)),
      settings: () => go('#/settings'),
      seg: (b) => {
        const k = b.dataset.k;
        st[k] = k === 'total' ? Number(b.dataset.v) : b.dataset.v;
        b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      },
      start: () => start(),
      'open-recap': (b) => go(`#/recap/${encodeURIComponent(dossier.id)}/${encodeURIComponent(b.dataset.id)}`),
      replay: () => { if (st.phase === 'question') sayThenListen(); },
      skip: () => { if (st.phase === 'question') { st.transcript.push({ t: Date.now() - st.t0, who: 'me', text: '(question passée)' }); nextQuestion(); } },
      'toggle-input': () => switchInput(st.input === 'mic' ? 'text' : 'mic'),
      done: () => finishAnswer(false),
      retry: () => { st.retry = true; st.current = { question: st.current.question, answer: '', t: Date.now() - st.t0 }; st.transcript.push({ t: st.current.t, who: 'them', text: st.current.question }); askCurrent(); },
      next: () => { if (st.items.length >= st.total) drawSummary(); else nextQuestion(); },
      finish: () => finish(),
      again: () => { st.gen++; drawIntro(); },
      recap: () => go(`#/recap/${encodeURIComponent(dossier.id)}/${encodeURIComponent(st.sessionId)}`)
    });
    el.addEventListener('change', (e) => {
      if (e.target.matches('[data-opt="voice"]')) st.voice = e.target.checked;
    });

    drawIntro();
  }

  const trainingScreen = (() => {
    let ctx = null;
    return {
      leave() { if (ctx) ctx.end(); ctx = null; stopSpeech(); },
      async render(root, params) {
        if (ctx) ctx.end();
        const c = ctx = lifecycle();
        const { id } = routeParams(params);
        const el = mount(root, 'tr', `${topbar({ title: 'Entraînement' })}<div class="sc-body"><div class="sc-loading"><div class="spinner"></div></div></div>`);
        onAct(el, { back: () => go(dossierHash(id)) });
        let d = null;
        try { d = id ? await S.store.get(id) : null; } catch (e) { d = null; }
        if (!c.alive) return;
        if (!d) { notFound(el, 'Dossier introuvable'); return; }
        const fresh = mount(root, 'tr', `${topbar({ title: 'Entraînement' })}<div class="sc-body"></div>`);
        runTraining(fresh, d, c);
      }
    };
  })();

  /* ================================================================ RÉCAP */

  function splitSections(text) {
    const out = [];
    let cur = { title: '', lines: [] };
    String(text || '').split(/\r?\n/).forEach((line) => {
      const m = line.match(/^##\s+(.+?)\s*#*\s*$/);
      if (m) { out.push(cur); cur = { title: m[1].replace(/\*\*/g, '').trim(), lines: [] }; }
      else cur.lines.push(line);
    });
    out.push(cur);
    return out
      .map((s) => ({ title: s.title, body: s.lines.join('\n').trim() }))
      .filter((s) => s.title || s.body.replace(/^#\s+.*$/gm, '').trim());
  }

  function extractMail(text) {
    const sec = splitSections(text).find((s) => /remerciement|mail/i.test(s.title));
    if (!sec) return '';
    return sec.body
      .replace(/^```[a-z]*\s*$/gim, '')
      .replace(/^>\s?/gm, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1$2')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function sectionIcon(title) {
    const t = U.norm(title);
    if (/synthese|resume/.test(t)) return 'sparkles';
    if (/question/.test(t)) return 'list';
    if (/fort/.test(t)) return 'check';
    if (/ameliorer|faible/.test(t)) return 'bolt';
    if (/relancer|suite|prochaine/.test(t)) return 'clock';
    if (/mail|remerciement/.test(t)) return 'export';
    return 'doc';
  }

  function sessionDuration(s) {
    const a = toMs(s.startedAt); const b = toMs(s.endedAt);
    if (a && b && b > a) return b - a;
    const tx = s.transcript || [];
    return tx.length ? Number(tx[tx.length - 1].t) || 0 : 0;
  }

  function sessionQuestions(s) {
    const seen = new Set();
    const qs = (s.answers || []).map((a) => a && a.question).filter(Boolean);
    const src = qs.length ? qs : (s.transcript || []).filter((x) => x && x.who !== 'me' && U.isQuestion(x.text)).map((x) => x.text);
    return src.filter((q) => { const k = U.norm(q); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  }

  // Récap minimal sans IA (pas de clé, hors ligne ou erreur) : jamais d'écran vide.
  function localRecap(d, s) {
    const qs = sessionQuestions(s);
    const sc = (s.scores || []).map((x) => clampScore(x && x.score)).filter((x) => x != null);
    const role = d.role || 'le poste';
    const company = d.company || 'votre organisation';
    const kind = s.kind === 'training' ? 'Entraînement' : 'Entretien';
    return [
      '## Synthèse',
      `${kind} du ${fmtDate(s.startedAt) || 'jour'} — durée ${fmtDuration(sessionDuration(s))} — ${plural((s.transcript || []).length, 'intervention transcrite', 'interventions transcrites')}.`,
      sc.length ? `Moyenne de l’entraînement : **${fmtNum(sc.reduce((a, b) => a + b, 0) / sc.length)}/10**.` : '',
      '',
      '## Questions posées',
      ...(qs.length ? qs.map((q) => `- ${q}`) : ['- Aucune question détectée.']),
      '',
      '## Mail de remerciement',
      `Objet : Merci pour notre échange — ${role}`,
      '',
      d.interviewer ? `Bonjour ${d.interviewer},` : 'Bonjour,',
      '',
      `Je vous remercie pour le temps que vous m’avez consacré lors de notre entretien pour le poste de ${role} au sein de ${company}. Notre échange a renforcé mon intérêt pour ce poste et pour les missions que vous m’avez présentées.`,
      '',
      'Je reste à votre disposition pour tout complément d’information et serais heureux de poursuivre le processus de recrutement.',
      '',
      'Bien cordialement,'
    ].join('\n').replace(/\n{3,}/g, '\n\n');
  }

  function transcriptText(s) {
    return (s.transcript || []).map((x) => `[${fmtT(x.t)}] ${WHO[x.who] || 'Voix'} : ${x.text}`).join('\n');
  }

  const LOADING_STEPS = ['Lecture de la transcription…', 'Repérage des questions posées…', 'Analyse de vos réponses…', 'Rédaction du mail de remerciement…'];

  function runRecap(el, d, s, c) {
    const body = el.querySelector('.sc-body');
    const actions = el.querySelector('.sc-actions');
    el.querySelector('.sc-sub').textContent = `${dossierTitle(d)} · ${fmtDate(s.startedAt)}`;
    const state = { text: String(s.recap || '').trim(), local: false, loading: false, error: null, gen: 0 };
    let stepTimer = 0;
    c.add(() => clearInterval(stepTimer));

    const scores = (s.scores || []).filter(Boolean);
    const sc = scores.map((x) => clampScore(x.score)).filter((x) => x != null);
    const avg = sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : null;
    const answers = (s.answers || []).filter(Boolean);
    const tx = (s.transcript || []).filter(Boolean);

    const stat = (v, label) => `<div class="card glass rc-stat"><div class="rc-stat-v">${v}</div><div class="small muted">${label}</div></div>`;
    body.innerHTML = `
      <div class="rc-stats">
        ${stat(esc(fmtDuration(sessionDuration(s))), 'Durée')}
        ${stat(String(sessionQuestions(s).length), 'Questions')}
        ${stat(String(tx.length), 'Interventions')}
        ${avg != null ? stat(`${fmtNum(avg)}<small>/10</small>`, 'Moyenne') : stat(String(answers.length), 'Réponses soufflées')}
      </div>
      ${settings().rememberKeys === false && S.app && S.app.cleanupSheet ? `<div class="card glass card-pad rc-guest">
        <span class="rc-guest-ic">${icon('shield')}</span>
        <div class="sc-grow"><b>Vous êtes sur un PC emprunté</b><div class="small muted">Avant de partir, exportez votre dossier puis effacez vos documents, transcriptions et clés de ce navigateur.</div></div>
        <button type="button" class="btn btn-primary btn-sm" data-act="guest-wipe">${icon('trash')}<span>Exporter puis tout effacer</span></button>
      </div>` : ''}
      <div class="rc-main"></div>
      <div class="rc-extra"></div>`;
    const gw = body.querySelector('[data-act="guest-wipe"]');
    if (gw) gw.addEventListener('click', () => S.app.cleanupSheet());
    const main = body.querySelector('.rc-main');

    function drawMain() {
      clearInterval(stepTimer);
      actions.innerHTML = state.text && !state.local && !state.loading
        ? `<button type="button" class="icon-btn" data-act="regen" aria-label="Régénérer le récap" title="Régénérer le récap">${icon('refresh')}</button>` : '';
      if (state.loading) {
        main.innerHTML = `<div class="card glass card-pad rc-loading">
          <div class="row"><div class="spinner"></div><div class="h3 rc-step">${LOADING_STEPS[0]}</div></div>
          <div class="sc-skel"><i></i><i></i><i></i><i style="width:60%"></i></div></div>`;
        let i = 0;
        stepTimer = setInterval(() => {
          i = (i + 1) % LOADING_STEPS.length;
          const n = main.querySelector('.rc-step');
          if (n) n.textContent = LOADING_STEPS[i];
        }, 2600);
        return;
      }
      const text = state.text || localRecap(d, s);
      const local = !state.text || state.local;
      let note = '';
      if (state.error) {
        note = `<div class="card card-pad sc-note is-err">${icon('warning')}<div class="sc-grow"><b>Le récap IA n’a pas pu être généré</b> (${esc(errText(state.error))}). Voici un récap simplifié.</div>
          <button type="button" class="btn btn-sm btn-ghost" data-act="regen">${icon('refresh')} Réessayer</button></div>`;
      } else if (local) {
        note = hasKey()
          ? `<div class="card card-pad sc-note">${icon('info')}<div class="sc-grow">Récap simplifié, sans IA.</div><button type="button" class="btn btn-sm btn-primary" data-act="regen">${icon('sparkles')} Générer avec l’IA</button></div>`
          : `<div class="card card-pad sc-note is-warn">${icon('info')}<div class="sc-grow">Récap simplifié : ajoutez une clé IA pour une analyse complète de vos réponses.</div><button type="button" class="btn btn-sm btn-ghost" data-act="settings">Ajouter une clé</button></div>`;
      }
      const hasMail = !!extractMail(text);
      main.innerHTML = `${note}
        <div class="row rc-actions">
          <button type="button" class="btn btn-primary btn-sm" data-act="copy">${icon('copy')} Copier</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="download">${icon('download')} Télécharger .md</button>
          ${hasMail ? `<button type="button" class="btn btn-ghost btn-sm" data-act="copy-mail">${icon('export')} Copier le mail de remerciement</button>` : ''}
        </div>
        ${splitSections(text).map((sec) => {
          const mail = /remerciement|mail/i.test(sec.title);
          return `<article class="card glass card-pad rc-sec${mail ? ' rc-mail' : ''}">
            ${sec.title ? `<div class="rc-sec-head"><span class="rc-sec-ic">${icon(sectionIcon(sec.title))}</span><div class="h3 sc-grow">${esc(sec.title)}</div>
              ${mail ? `<button type="button" class="btn btn-sm btn-ghost" data-act="copy-mail">${icon('copy')} Copier</button>` : ''}</div>` : ''}
            <div class="md">${md(sec.body)}</div></article>`;
        }).join('')}`;
    }

    function drawExtra() {
      const extra = body.querySelector('.rc-extra');
      extra.innerHTML = `
        ${scores.length ? section('Notes de l’entraînement', scores.map((x) => {
          const v = clampScore(x.score);
          return `<div class="list-row"><details class="tr-sum-item"><summary>${v != null ? `<span class="pill pill-${scoreKind(v)}">${fmtNum(v)}/10</span>` : '<span class="pill">—</span>'}
            <span class="tr-sum-q">${esc(nbsp(x.question))}</span>${icon('chevron-down')}</summary>
            <div class="tr-sum-detail"><div class="small muted">Votre réponse</div><p class="tr-mine">${esc(x.answer)}</p>
            ${x.feedback ? `<div class="md">${md(x.feedback)}</div>` : ''}</div></details></div>`;
        }).join(''), 'tr-sum') : ''}
        ${answers.length ? `<details class="card glass card-pad sc-details rc-answers">
          <summary>${icon('bolt')} ${s.kind === 'training' ? 'Meilleures réponses' : 'Réponses soufflées'} (${answers.length}) ${icon('chevron-down')}</summary>
          <div class="rc-answer-list">${answers.map((a) => `<div class="rc-answer">
            <div class="rc-answer-q"><span class="small muted">${esc(fmtT(a.t))}</span> <b>${esc(nbsp(a.question || 'Réponse'))}</b>
              <span class="pill ${a.source === 'prep' ? 'pill-ok' : ''}">${a.source === 'prep' ? 'Préparée' : `IA${a.model ? ` · ${esc(a.model)}` : ''}`}</span></div>
            <div class="md">${md(a.answer)}</div></div>`).join('')}</div></details>` : ''}
        <details class="card glass card-pad sc-details rc-transcript">
          <summary>${icon('list')} Transcription complète (${plural(tx.length, 'intervention', 'interventions')}) ${icon('chevron-down')}</summary>
          ${tx.length ? `<div class="rc-tx">${tx.map((x) => `<div class="rc-tx-row who-${esc(x.who || 'mixed')}">
              <span class="rc-tx-t">${esc(fmtT(x.t))}</span><span class="rc-tx-who">${WHO[x.who] || 'Voix'}</span><span class="rc-tx-text">${esc(x.text)}</span></div>`).join('')}</div>
            <div class="row"><button type="button" class="btn btn-sm btn-ghost" data-act="copy-tx">${icon('copy')} Copier la transcription</button></div>`
            : '<p class="muted">Aucune transcription enregistrée.</p>'}
        </details>`;
    }

    async function generate() {
      if (state.loading) return;
      if (!hasKey()) { toast('Ajoutez une clé IA dans les réglages pour générer le récap.', 'warn'); return; }
      const g = ++state.gen;
      state.loading = true;
      state.error = null;
      drawMain();
      try {
        const fresh = (await S.store.get(d.id)) || d;
        const sess = (fresh.sessions || []).find((x) => x && x.id === s.id) || s;
        const out = await S.ai.recap(fresh, sess);
        const text = String(typeof out === 'string' ? out : (out && out.text) || '').trim();
        if (!text) throw new Error('récap vide');
        s.recap = text;
        // Sauvegarde même si l'utilisateur a quitté l'écran : le récap a coûté un appel IA.
        await upsertSession(d.id, { id: s.id, recap: text }).catch((e) => toast(`Récap non sauvegardé : ${errText(e)}`, 'err'));
        if (g !== state.gen || !c.alive) return;
        state.text = text;
        state.local = false;
      } catch (e) {
        if (g !== state.gen || !c.alive) return;
        state.error = e;
      }
      state.loading = false;
      drawMain();
    }

    function currentText() { return state.text || localRecap(d, s); }

    onAct(el, {
      back: () => go(dossierHash(d.id)),
      settings: () => go('#/settings'),
      regen: async () => {
        if (state.text && !state.local && !state.error) {
          const ok = await S.ui.confirm({ title: 'Régénérer le récap ?', text: 'Le récap actuel sera remplacé par une nouvelle version.', okLabel: 'Régénérer' });
          if (!ok) return;
        }
        generate();
      },
      copy: () => copyWithToast(currentText(), 'Récap'),
      'copy-mail': () => copyWithToast(extractMail(currentText()), 'Mail'),
      'copy-tx': () => copyWithToast(transcriptText(s), 'Transcription'),
      download: () => {
        const head = `# Récap — ${dossierTitle(d)}\n\n_${s.kind === 'training' ? 'Entraînement' : 'Entretien'} du ${fmtDate(s.startedAt)} · ${fmtDuration(sessionDuration(s))}_\n\n`;
        const txt = tx.length ? `\n\n## Transcription\n\n${tx.map((x) => `- **${fmtT(x.t)} · ${WHO[x.who] || 'Voix'}** : ${x.text}`).join('\n')}\n` : '\n';
        const day = new Date(toMs(s.startedAt) || Date.now()).toISOString().slice(0, 10);
        downloadText(head + currentText() + txt, `Recap ${safeName(d.company || d.name || 'entretien')} ${day}.md`);
        toast('Récap téléchargé.', 'ok');
      }
    });

    drawExtra();
    if (!state.text && hasKey() && navigator.onLine !== false) generate();
    else drawMain();
  }

  const recapScreen = (() => {
    let ctx = null;
    return {
      leave() { if (ctx) ctx.end(); ctx = null; },
      async render(root, params) {
        if (ctx) ctx.end();
        const c = ctx = lifecycle();
        const p = routeParams(params);
        const el = mount(root, 'rc', `${topbar({ title: 'Récap' })}<div class="sc-body"><div class="sc-loading"><div class="spinner"></div></div></div>`);
        onAct(el, { back: () => go(dossierHash(p.id)) });
        let d = null;
        try { d = p.id ? await S.store.get(p.id) : null; } catch (e) { d = null; }
        if (!c.alive) return;
        const sessions = d && Array.isArray(d.sessions) ? d.sessions.filter(Boolean) : [];
        const s = p.sessionId ? sessions.find((x) => x.id === p.sessionId) : sessions[sessions.length - 1];
        if (!d) { notFound(el, 'Dossier introuvable'); return; }
        if (!s) { notFound(el, 'Session introuvable'); return; }
        const fresh = mount(root, 'rc', `${topbar({ title: s.kind === 'training' ? 'Récap d’entraînement' : 'Récap de l’entretien' })}<div class="sc-body"></div>`);
        runRecap(fresh, d, s, c);
      }
    };
  })();

  /* ================================================================ RÉGLAGES */

  const LANGS = [
    ['fr-FR', 'Français (France)'], ['fr-BE', 'Français (Belgique)'], ['fr-CH', 'Français (Suisse)'], ['fr-CA', 'Français (Canada)'],
    ['en-GB', 'Anglais (Royaume-Uni)'], ['en-US', 'Anglais (États-Unis)'], ['es-ES', 'Espagnol'], ['de-DE', 'Allemand'], ['it-IT', 'Italien']
  ];
  const PURPOSES = [
    ['answer', 'Réponses en direct', 'Rapide et précis pendant l’appel'],
    ['fast', 'Transcription', 'Voix du recruteur, tri des questions'],
    ['prep', 'Préparation et récap', 'Qualité avant vitesse']
  ];

  function keyRow(p) {
    const k = p.id === 'gemini' ? 'geminiKey' : 'claudeKey';
    const v = settings()[k] || '';
    return `<div class="list-row st-key">
      <div class="st-key-head"><div class="st-key-name">${tile(p.icon, p.color)}<b>${p.name}</b>${p.badge}</div>
        <a class="small st-link" href="${p.url}" target="_blank" rel="noopener noreferrer">${p.linkLabel}</a></div>
      <div class="st-key-field">
        <input type="password" data-key="${k}" value="${esc(v)}" placeholder="${p.placeholder}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Clé ${p.name}">
        <button type="button" class="icon-btn" data-act="eye" aria-label="Afficher la clé" title="Afficher la clé">${icon('eye')}</button>
        <button type="button" class="btn btn-sm btn-ghost" data-act="test" data-provider="${p.id}">Tester</button>
      </div>
      <div class="small muted st-key-status" data-status="${p.id}" aria-live="polite">${esc(p.hint)}</div>
    </div>`;
  }

  function cleanKey(v) {
    return String(v || '').replace(/\s+/g, '').replace(/^["'`]+|["'`]+$/g, '');
  }

  function runSettings(el, c) {
    const body = el.querySelector('.sc-body');
    const s = settings();
    const models = Object.assign({ answer: 'auto', fast: 'auto', prep: 'auto' }, s.models || {});
    const seg = (key, value, opts) => `<div class="seg" role="group">${opts.map(([v, l]) =>
      `<button type="button" data-act="seg" data-set="${key}" data-v="${v}" class="${String(value) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const sw = (key, checked, label) => `<label class="switch"><input type="checkbox" data-set="${key}" ${checked ? 'checked' : ''} aria-label="${esc(label)}"><span></span></label>`;
    const scale = Number(s.fontScale) || 1;
    const delay = Number(s.answerDelayMs) || 900;

    body.innerHTML = `
      ${section('Clés d’intelligence artificielle', `
        ${keyRow({ id: 'gemini', name: 'Google Gemini', icon: 'sparkles', color: 'blue', badge: '<span class="pill pill-ok">Gratuite · recommandée</span>', url: 'https://aistudio.google.com/apikey', linkLabel: 'Obtenir une clé gratuite', placeholder: 'AIza…', hint: 'Transcription du recruteur, réponses et préparation.' })}
        ${keyRow({ id: 'claude', name: 'Anthropic Claude', icon: 'shield', color: 'orange', badge: '<span class="pill">Secours · payante</span>', url: 'https://console.anthropic.com/settings/keys', linkLabel: 'Obtenir une clé', placeholder: 'sk-' + 'ant-…', hint: 'Facultative : prend le relais si Gemini est saturé.' })}
        <div class="list-row">${tile('person', 'gray')}${main('Se souvenir des clés sur cet appareil', 'Décochez sur un PC emprunté : les clés seront oubliées à la fermeture de l’onglet.')}
          ${sw('rememberKeys', s.rememberKeys !== false, 'Se souvenir des clés sur cet appareil')}</div>`)}

      ${section('Intelligence artificielle', `
        <div class="list-row st-wrap">${tile('bolt', 'violet')}${main('Fournisseur', 'Automatique : Gemini d’abord, Claude en secours.')}
          ${seg('provider', s.provider || 'auto', [['auto', 'Auto'], ['gemini', 'Gemini'], ['claude', 'Claude']])}</div>
        ${PURPOSES.map(([p, label, sub]) => `<div class="list-row st-model st-wrap">${tile(p === 'answer' ? 'sparkles' : p === 'fast' ? 'waveform' : 'doc', p === 'answer' ? 'blue' : p === 'fast' ? 'teal' : 'green')}${main(label, sub, `data-auto="${p}"`)}
          <select data-model="${p}" aria-label="Modèle : ${esc(label)}"><option value="auto">Automatique</option>${models[p] && models[p] !== 'auto' ? `<option value="${esc(models[p])}" selected>${esc(models[p])}</option>` : ''}</select></div>`).join('')}
        <div class="list-row">${tile('refresh', 'gray')}<span class="list-main"><small data-models-status>Liste des modèles : automatique.</small></span>
          <button type="button" class="btn btn-sm btn-ghost" data-act="discover">${icon('refresh')} Actualiser</button></div>`)}

      ${section('Pendant l’entretien', `
        <div class="list-row">${tile('bolt', 'orange')}${main('Réponse automatique', 'Souffler dès que le recruteur a fini sa question.')}
          ${sw('autoAnswer', s.autoAnswer !== false, 'Réponse automatique')}</div>
        <div class="list-row st-range st-wrap" data-dep="autoAnswer">${tile('clock', 'orange')}${main('Délai avant de répondre', 'Silence attendu après la question.')}
          <span class="st-range-ctl"><input type="range" min="300" max="3000" step="100" value="${delay}" data-set="answerDelayMs" aria-label="Délai avant de répondre"><output data-out="answerDelayMs">${fmtNum(delay / 1000)} s</output></span></div>
        <div class="list-row st-wrap">${tile('mic', 'green')}${main('Langue de l’entretien', 'Reconnaissance vocale et voix de l’entraînement.')}
          <select data-set="lang" aria-label="Langue de l’entretien">${LANGS.map(([v, l]) => `<option value="${v}" ${v === (s.lang || 'fr-FR') ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`)}

      ${section('Affichage', `
        <div class="list-row st-wrap">${tile('eye', 'blue')}${main('Thème', 'Automatique : suit le réglage de l’appareil.')}${seg('theme', s.theme || 'auto', [['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']])}</div>
        <div class="list-row st-range st-wrap">${tile('edit', 'blue')}${main('Taille du texte des réponses', 'Raccourcis pendant l’entretien : touches + et −.')}
          <span class="st-range-ctl"><input type="range" min="0.8" max="1.6" step="0.05" value="${scale}" data-set="fontScale" aria-label="Taille du texte"><output data-out="fontScale">${Math.round(scale * 100)} %</output></span></div>
        <div class="list-row"><div class="st-preview" style="--st-scale:${scale}"><b>Mon expérience de RAF m’a appris à fiabiliser la clôture mensuelle.</b> <span class="muted">— aperçu de la carte réponse</span></div></div>`)}

      ${section('Données et appareil', `
        <div class="list-row">${tile('doc', 'gray')}${main('Stockage local', 'Calcul…', 'data-usage')}
          <button type="button" class="btn btn-sm btn-ghost" data-act="persist" hidden>${icon('shield')} Protéger</button></div>
        ${typeof S.store.exportAll === 'function' ? `<button type="button" class="list-row" data-act="backup">${tile('download', 'blue')}${main('Sauvegarder tous mes dossiers', 'Fichier .souffleur.json à garder sur une clé USB ou dans vos mails (sans les clés).')}${chev()}</button>` : ''}
        <button type="button" class="list-row" data-act="diag">${tile('shield', 'green')}${main('Diagnostic avant entretien', 'Micro, son de l’appel, clé, connexion.')}${chev()}</button>
        <button type="button" class="list-row" data-act="onboarding">${tile('info', 'violet')}${main('Revoir la prise en main', null)}${chev()}</button>
        <button type="button" class="list-row st-danger" data-act="wipe">${tile('trash', 'red')}${main('Effacer toutes mes données de cet appareil', 'Dossiers, sessions, réglages et clés.')}</button>`)}

      <p class="small muted st-about">${icon('shield')} Souffleur fonctionne entièrement dans votre navigateur. Vos documents et vos clés restent sur cet appareil ; l’IA est appelée directement chez Google ou Anthropic, sans serveur intermédiaire.</p>`;

    let discovered = { gemini: [], claude: [] };

    function syncDeps() {
      const on = settings().autoAnswer !== false;
      body.querySelectorAll('[data-dep="autoAnswer"]').forEach((row) => {
        row.classList.toggle('is-disabled', !on);
        row.querySelectorAll('input').forEach((i) => { i.disabled = !on; });
      });
    }

    function fillModels() {
      const cur = Object.assign({ answer: 'auto', fast: 'auto', prep: 'auto' }, settings().models || {});
      PURPOSES.forEach(([p]) => {
        const sel = body.querySelector(`select[data-model="${p}"]`);
        let autoName = '';
        try { const c0 = S.ai.pick(p)[0]; autoName = c0 ? c0.model : ''; } catch (e) { autoName = ''; }
        const group = (label, list) => (list && list.length ? `<optgroup label="${label}">${list.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}</optgroup>` : '');
        const all = (discovered.gemini || []).concat(discovered.claude || []);
        const extra = cur[p] && cur[p] !== 'auto' && all.indexOf(cur[p]) < 0 ? `<option value="${esc(cur[p])}">${esc(cur[p])}</option>` : '';
        sel.innerHTML = `<option value="auto">Automatique${autoName ? ` (${esc(autoName)})` : ''}</option>${extra}${group('Gemini', discovered.gemini)}${group('Claude', discovered.claude)}`;
        sel.value = cur[p] || 'auto';
      });
    }

    async function discover(force) {
      const out = body.querySelector('[data-models-status]');
      if (!hasKey()) { out.textContent = 'Ajoutez une clé pour lister les modèles disponibles.'; fillModels(); return; }
      out.innerHTML = '<span class="spinner"></span> Recherche des modèles…';
      try {
        const r = await S.ai.discover({ force: !!force });
        if (!c.alive) return;
        discovered = { gemini: (r && r.gemini) || [], claude: (r && r.claude) || [] };
        fillModels();
        out.textContent = `${plural(discovered.gemini.length, 'modèle Gemini', 'modèles Gemini')} · ${plural(discovered.claude.length, 'modèle Claude', 'modèles Claude')} disponibles.`;
        if (force) toast('Liste des modèles actualisée.', 'ok');
      } catch (e) {
        if (!c.alive) return;
        fillModels();
        out.textContent = `Liste indisponible (${errText(e)}) : modèles par défaut utilisés.`;
      }
    }

    async function loadUsage() {
      const out = body.querySelector('[data-usage]');
      const btn = body.querySelector('[data-act="persist"]');
      try {
        const u = await S.store.usage();
        if (!c.alive) return;
        out.innerHTML = `${plural(Number(u.dossiers) || 0, 'dossier', 'dossiers')} · ${fmtBytes(u.bytes)} · ${u.persistent
          ? '<span class="pill pill-ok">Protégé</span>' : '<span class="pill pill-warn">Non protégé</span>'}`;
        btn.hidden = !!u.persistent || !(navigator.storage && navigator.storage.persist);
      } catch (e) {
        out.textContent = 'Informations de stockage indisponibles.';
      }
    }

    const saveKeyLater = U.debounce((k, v) => saveKey(k, v), 500);
    function saveKey(k, v) {
      const clean = cleanKey(v);
      if ((settings()[k] || '') === clean) return;
      setSettings({ [k]: clean });
      fillModels();
    }

    async function testKey(provider, btn) {
      const input = body.querySelector(`[data-key="${provider}Key"]`);
      const out = body.querySelector(`[data-status="${provider}"]`);
      saveKey(input.dataset.key, input.value);
      if (!cleanKey(input.value)) { out.innerHTML = `<span class="pill pill-warn">${icon('warning')} Aucune clé saisie</span>`; return; }
      btn.disabled = true;
      out.innerHTML = '<span class="spinner"></span> Test en cours…';
      try {
        const res = (await S.ai.test()) || [];
        if (!c.alive) return;
        const mine = res.filter((r) => r && r.provider === provider);
        const ok = mine.find((r) => r.ok);
        if (ok) {
          out.innerHTML = `<span class="pill pill-ok">${icon('check')} Clé valide</span> ${esc(ok.model || '')} · ${fmtMs(ok.ms)}`;
          discover(true);
        } else if (mine.length) {
          out.innerHTML = `<span class="pill pill-err">${icon('xmark')} Échec</span> ${esc(errText(mine[0].error))}`;
        } else {
          out.innerHTML = `<span class="pill pill-warn">${icon('info')} Non testée</span> Vérifiez le réglage « Fournisseur ».`;
        }
      } catch (e) {
        out.innerHTML = `<span class="pill pill-err">${icon('xmark')} Échec</span> ${esc(errText(e))}`;
      }
      btn.disabled = false;
    }

    async function wipe() {
      const ok = await S.ui.confirm({
        title: 'Effacer toutes vos données ?',
        text: 'Dossiers, documents, préparations, sessions, réglages et clés enregistrés sur cet appareil seront supprimés définitivement. Exportez d’abord les dossiers à conserver.',
        okLabel: 'Tout effacer',
        danger: true
      });
      if (!ok) return;
      try {
        if (typeof S.store.clearAll === 'function') await S.store.clearAll();
        const all = await S.store.list();
        for (const d of all || []) await S.store.remove(d.id);
        setSettings({ geminiKey: '', claudeKey: '', onboarded: false });
        [window.localStorage, window.sessionStorage].forEach((stg) => {
          try { Object.keys(stg).filter((k) => /^souffleur/i.test(k)).forEach((k) => stg.removeItem(k)); } catch (e) { /* ignore */ }
        });
        toast('Toutes vos données ont été effacées de cet appareil.', 'ok');
        setTimeout(() => { location.hash = '#/'; location.reload(); }, 700);
      } catch (e) {
        toast(`Effacement incomplet : ${errText(e)}`, 'err');
      }
    }

    function rangeLabel(input) {
      const k = input.dataset.set;
      const out = body.querySelector(`[data-out="${k}"]`);
      const v = Number(input.value);
      if (k === 'answerDelayMs') out.textContent = `${fmtNum(v / 1000)} s`;
      if (k === 'fontScale') {
        out.textContent = `${Math.round(v * 100)} %`;
        const pv = body.querySelector('.st-preview');
        if (pv) pv.style.setProperty('--st-scale', v);
      }
    }
    const saveRange = U.debounce((k, v) => setSettings({ [k]: v }), 150);

    onAct(el, {
      back: () => go('#/'),
      seg: (b) => {
        setSettings({ [b.dataset.set]: b.dataset.v });
        b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        if (b.dataset.set === 'provider') fillModels();
      },
      eye: (b) => {
        const input = b.parentElement.querySelector('input');
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        b.innerHTML = icon(show ? 'eye-slash' : 'eye');
        b.setAttribute('aria-label', show ? 'Masquer la clé' : 'Afficher la clé');
        b.title = b.getAttribute('aria-label');
      },
      test: (b) => testKey(b.dataset.provider, b),
      discover: () => discover(true),
      persist: async () => {
        try {
          const ok = await navigator.storage.persist();
          toast(ok ? 'Stockage protégé.' : 'Le navigateur a refusé : installez l’app pour protéger vos données.', ok ? 'ok' : 'warn');
        } catch (e) { toast('Protection du stockage indisponible.', 'warn'); }
        loadUsage();
      },
      diag: () => go('#/diag'),
      backup: async () => {
        try {
          const blob = await S.store.exportAll({ includeKeys: false });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = blob.name || `Souffleur - sauvegarde - ${new Date().toISOString().slice(0, 10)}.souffleur.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
          toast('Sauvegarde téléchargée.', 'ok');
        } catch (e) { toast(`Sauvegarde impossible : ${errText(e)}`, 'err'); }
      },
      onboarding: () => { if (S.app.onboarding) S.app.onboarding(); },
      wipe: () => wipe()
    });

    el.addEventListener('input', (e) => {
      const t = e.target;
      if (t.matches('[data-key]')) saveKeyLater(t.dataset.key, t.value);
      else if (t.matches('input[type="range"][data-set]')) { rangeLabel(t); saveRange(t.dataset.set, Number(t.value)); }
    });
    el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('[data-key]')) { saveKey(t.dataset.key, t.value); t.value = cleanKey(t.value); }
      else if (t.matches('input[type="checkbox"][data-set]')) { setSettings({ [t.dataset.set]: t.checked }); syncDeps(); }
      else if (t.matches('select[data-set]')) setSettings({ [t.dataset.set]: t.value });
      else if (t.matches('select[data-model]')) {
        const m = Object.assign({ answer: 'auto', fast: 'auto', prep: 'auto' }, settings().models || {});
        m[t.dataset.model] = t.value;
        setSettings({ models: m });
      }
    });

    // Reflète les changements faits ailleurs (ex. clé saisie dans la prise en main).
    if (S.bus && S.bus.on) {
      c.add(S.bus.on('settings:changed', () => {
        const cur = settings();
        body.querySelectorAll('[data-key]').forEach((i) => {
          if (document.activeElement !== i && cleanKey(i.value) !== (cur[i.dataset.key] || '')) i.value = cur[i.dataset.key] || '';
        });
      }));
    }

    syncDeps();
    fillModels();
    loadUsage();
    discover(false);
  }

  const settingsScreen = (() => {
    let ctx = null;
    return {
      leave() { if (ctx) ctx.end(); ctx = null; },
      render(root) {
        if (ctx) ctx.end();
        const c = ctx = lifecycle();
        const el = mount(root, 'st', `${topbar({ title: 'Réglages' })}<div class="sc-body"></div>`);
        runSettings(el, c);
      }
    };
  })();

  /* ================================================================ DIAGNOSTIC */

  const STATUS_ICON = { ok: 'check', warn: 'warning', err: 'xmark', info: 'info' };

  function runDiag(el, c) {
    const body = el.querySelector('.sc-body');
    const sup = support();
    const b = browserInfo();
    const rows = [
      { key: 'browser', icon: 'shield', title: 'Navigateur' },
      { key: 'online', icon: 'wifi-off', title: 'Connexion internet' },
      { key: 'mic', icon: 'mic', title: 'Micro' },
      { key: 'speech', icon: 'waveform', title: 'Reconnaissance vocale' },
      { key: 'display', icon: 'video', title: 'Son de l’appel (onglet ou système)' },
      { key: 'gemini', icon: 'sparkles', title: 'Clé Gemini' },
      { key: 'claude', icon: 'shield', title: 'Clé Claude (secours)' },
      { key: 'storage', icon: 'doc', title: 'Stockage persistant' },
      { key: 'sw', icon: 'download', title: 'Fonctionnement hors-ligne' },
      { key: 'pip', icon: 'pip', title: 'Fenêtre flottante' },
      { key: 'wake', icon: 'eye', title: 'Écran toujours allumé' }
    ].map((r) => Object.assign({ status: 'pending', detail: '', advice: '', action: null, meter: null, indet: false }, r));
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    const busy = { mic: false, display: false, keys: false };

    body.innerHTML = `
      <div class="card glass card-pad dg-summary"></div>
      ${section('Vérifications', rows.map((r) => `<div class="list-row dg-row" data-key="${r.key}"></div>`).join(''), 'dg-list')}
      <p class="small muted dg-foot">${icon('info')} Faites ce diagnostic sur le PC de l’entretien, 10 minutes avant l’appel, avec Meet ou Teams ouvert.</p>`;

    function statusBadge(s) {
      if (s === 'pending') return '<span class="spinner"></span>';
      if (s === 'idle') return '<span class="dg-badge is-idle"></span>';
      return `<span class="dg-badge is-${s}">${icon(STATUS_ICON[s] || 'info')}</span>`;
    }

    function drawRow(r) {
      const node = body.querySelector(`.dg-row[data-key="${r.key}"]`);
      if (!node) return;
      node.className = `list-row dg-row is-${r.status}`;
      node.innerHTML = `
        <div class="dg-ic">${statusBadge(r.status)}</div>
        <div class="dg-main sc-grow">
          <div class="dg-title">${esc(r.title)}</div>
          ${r.detail ? `<div class="dg-detail small">${esc(r.detail)}</div>` : ''}
          ${r.meter != null ? `<div class="meter dg-meter${r.indet ? ' is-indet' : ''}"><i style="--v:${clamp(r.meter, 0, 1).toFixed(3)}"></i></div>` : ''}
          ${r.advice ? `<div class="dg-advice small">${esc(r.advice)}</div>` : ''}
        </div>
        ${r.action ? `<button type="button" class="btn btn-sm ${r.primary ? 'btn-primary' : 'btn-ghost'}" data-act="row" data-key="${r.key}" ${r.status === 'pending' ? 'disabled' : ''}>${esc(r.action)}</button>` : ''}`;
    }

    function set(key, patch) {
      const r = byKey[key];
      Object.assign(r, { detail: '', advice: '', action: null, meter: null, indet: false, primary: false }, patch);
      drawRow(r);
      drawSummary();
    }

    function setMeter(key, v, indet) {
      const r = byKey[key];
      r.meter = v;
      r.indet = !!indet;
      const i = body.querySelector(`.dg-row[data-key="${key}"] .dg-meter`);
      if (i) {
        i.classList.toggle('is-indet', !!indet);
        i.firstElementChild.style.setProperty('--v', clamp(v, 0, 1).toFixed(3));
      }
    }

    function drawSummary() {
      const n = { ok: 0, warn: 0, err: 0, idle: 0, pending: 0, info: 0 };
      rows.forEach((r) => { n[r.status] = (n[r.status] || 0) + 1; });
      let cls = 'is-ok'; let title = 'Tout est prêt pour l’entretien'; let ic = 'check';
      if (n.pending) { cls = 'is-pending'; title = 'Vérifications en cours…'; ic = 'clock'; }
      else if (n.err) { cls = 'is-err'; title = `${plural(n.err, 'problème à corriger', 'problèmes à corriger')}`; ic = 'xmark'; }
      else if (n.idle) { cls = 'is-info'; title = 'Testez le micro et le son de l’appel'; ic = 'mic'; }
      else if (n.warn) { cls = 'is-warn'; title = `Prêt, avec ${plural(n.warn, 'point d’attention', 'points d’attention')}`; ic = 'warning'; }
      const box = body.querySelector('.dg-summary');
      box.className = `card glass card-pad dg-summary ${cls}`;
      box.innerHTML = `<div class="dg-sum-ic">${icon(ic)}</div>
        <div class="sc-grow"><div class="h2">${esc(title)}</div>
          <div class="small muted">${plural(n.ok, 'vérification réussie', 'vérifications réussies')}${n.warn ? ` · ${plural(n.warn, 'avertissement', 'avertissements')}` : ''}${n.err ? ` · ${plural(n.err, 'erreur', 'erreurs')}` : ''}</div></div>
        <button type="button" class="btn btn-sm btn-ghost" data-act="rerun">${icon('refresh')} Relancer</button>`;
    }

    /* ---------- vérifications automatiques ---------- */
    function checkBrowser() {
      const label = `${b.name}${b.ver ? ` ${b.ver}` : ''}`;
      if (!window.isSecureContext) {
        return set('browser', { status: 'err', detail: `${label} — page non sécurisée`, advice: 'Ouvrez Souffleur via son adresse https:// ou en fichier local : sinon le micro est bloqué par le navigateur.' });
      }
      if (b.chromium && !b.mobile) {
        if (b.ver && b.ver < 116) return set('browser', { status: 'warn', detail: `${label} — version ancienne`, advice: 'Mettez à jour le navigateur (Aide → À propos) pour la fenêtre flottante et la capture audio.' });
        return set('browser', { status: 'ok', detail: `${label} sur ordinateur : toutes les fonctions sont disponibles.` });
      }
      if (b.chromium && b.android) {
        return set('browser', { status: 'warn', detail: `${label} sur Android`, advice: 'Sur téléphone, le son de l’appel ne peut pas être capté : choisissez le mode « Haut-parleur ou téléphone à côté ».' });
      }
      return set('browser', { status: 'warn', detail: `${label} : fonctions limitées`, advice: 'Reconnaissance vocale et capture du son de l’appel indisponibles ici. Pour un entretien, ouvrez Souffleur dans Chrome ou Edge sur ordinateur.' });
    }

    function checkOnline() {
      if (navigator.onLine === false) {
        set('online', { status: 'err', detail: 'Hors ligne', advice: 'L’IA et la reconnaissance vocale de Chrome ont besoin d’internet. Les réponses préparées restent consultables.' });
      } else {
        set('online', { status: 'ok', detail: 'Connecté à internet.' });
      }
    }

    function checkSpeech() {
      if (!sup.webSpeech) {
        return set('speech', { status: 'warn', detail: 'Non disponible dans ce navigateur.', advice: 'Utilisez Chrome ou Edge, ou le mode « Micro seul, transcription IA » (clé Gemini).' });
      }
      set('speech', {
        status: navigator.onLine === false ? 'warn' : 'ok',
        detail: `Reconnaissance vocale ${b.name === 'Edge' ? 'd’Edge' : 'de Chrome'} disponible (gratuite).`,
        advice: navigator.onLine === false ? 'Elle a besoin d’internet pour fonctionner.' : ''
      });
    }

    function idleMic() {
      if (!sup.getUserMedia) return set('mic', { status: 'err', detail: 'Accès au micro impossible dans ce navigateur.', advice: 'Utilisez Chrome ou Edge à jour.' });
      set('mic', { status: 'idle', detail: 'Parlez pendant 3 secondes pour vérifier le niveau.', action: 'Tester (3 s)', primary: true });
    }

    function idleDisplay() {
      if (!sup.getDisplayMedia) {
        return set('display', { status: 'warn', detail: 'Capture d’écran indisponible sur cet appareil.', advice: 'Choisissez le mode « Haut-parleur ou téléphone à côté » : un seul micro entend les deux voix.' });
      }
      if (!sup.displayAudio) {
        return set('display', { status: 'warn', detail: 'Ce navigateur ne capte pas le son d’un onglet.', advice: 'Utilisez Chrome ou Edge sur ordinateur, ou le mode « Haut-parleur ».', action: 'Essayer quand même' });
      }
      set('display', {
        status: 'idle',
        detail: 'Meet : choisissez l’onglet et cochez « Partager l’audio de l’onglet ». Teams (appli) : écran entier + « Partager l’audio du système ».',
        action: 'Tester (5 s)',
        primary: true
      });
    }

    async function checkKeys() {
      if (busy.keys) return;
      const s = settings();
      const g = !!cleanKey(s.geminiKey); const cl = !!cleanKey(s.claudeKey);
      if (!g) set('gemini', { status: 'warn', detail: 'Aucune clé Gemini.', advice: 'Sans clé : mode haut-parleur et réponses préparées uniquement. La clé est gratuite (aistudio.google.com/apikey).', action: 'Ajouter une clé' });
      if (!cl) set('claude', { status: 'info', detail: 'Facultative.', advice: 'Une clé Claude prend le relais si Gemini est saturé ou indisponible.', action: 'Ajouter' });
      if (!g && !cl) return;
      if (navigator.onLine === false) {
        if (g) set('gemini', { status: 'warn', detail: 'Clé présente, test impossible hors ligne.' });
        if (cl) set('claude', { status: 'warn', detail: 'Clé présente, test impossible hors ligne.' });
        return;
      }
      busy.keys = true;
      if (g) set('gemini', { status: 'pending', detail: 'Test de la clé et de la latence…' });
      if (cl) set('claude', { status: 'pending', detail: 'Test de la clé et de la latence…' });
      let res = [];
      let err = null;
      try { res = (await S.ai.test()) || []; } catch (e) { err = e; }
      busy.keys = false;
      if (!c.alive) return;
      [['gemini', g], ['claude', cl]].forEach(([p, present]) => {
        if (!present) return;
        const mine = res.filter((r) => r && r.provider === p);
        const ok = mine.find((r) => r.ok);
        if (ok) {
          const slow = Number(ok.ms) > 4000;
          set(p, {
            status: slow ? 'warn' : 'ok',
            detail: `${ok.model || p} · ${fmtMs(ok.ms)}`,
            advice: slow ? 'Réponse lente : vérifiez la connexion (partage de connexion du téléphone si le wifi est faible).' : '',
            action: 'Retester'
          });
        } else {
          const e = err || (mine[0] && mine[0].error);
          const t = mine.length || err ? errText(e) : 'non testée (réglage « Fournisseur »)';
          let advice = 'Réessayez dans un instant.';
          if (/clé refusée/.test(t)) advice = 'Clé refusée : recopiez-la depuis la page de la clé, sans espace, puis enregistrez.';
          else if (/quota/.test(t)) advice = p === 'gemini' ? 'Quota gratuit atteint : patientez une minute ou ajoutez une clé Claude de secours.' : 'Crédit ou quota insuffisant sur le compte Anthropic.';
          else if (/réseau/.test(t)) advice = 'Pas de réponse du serveur : vérifiez internet ou un pare-feu d’entreprise (essayez le partage de connexion du téléphone).';
          set(p, { status: mine.length || err ? 'err' : 'warn', detail: t.charAt(0).toUpperCase() + t.slice(1), advice, action: 'Retester' });
        }
      });
    }

    async function checkStorage() {
      try {
        const u = await S.store.usage();
        if (!c.alive) return;
        const info = `${plural(Number(u.dossiers) || 0, 'dossier', 'dossiers')} · ${fmtBytes(u.bytes)}`;
        if (u.backend === 'memory') set('storage', { status: 'err', detail: 'Stockage bloqué : rien ne sera conservé après fermeture.', advice: 'Quittez la navigation privée ou exportez vos dossiers avant de fermer l’onglet.' });
        else if (u.persistent) set('storage', { status: 'ok', detail: `Données protégées (${info}).` });
        else {
          set('storage', {
            status: 'warn',
            detail: `Non protégé (${info}).`,
            advice: 'Le navigateur peut effacer les données s’il manque de place. Installez l’app ou exportez vos dossiers.',
            action: navigator.storage && navigator.storage.persist ? 'Protéger' : null
          });
        }
      } catch (e) {
        set('storage', { status: 'warn', detail: 'État du stockage inconnu.', advice: 'Exportez vos dossiers importants par sécurité.' });
      }
    }

    async function checkSW() {
      if (location.protocol === 'file:') return set('sw', { status: 'ok', detail: 'Fichier local : il s’ouvre sans internet tel quel.' });
      if (!('serviceWorker' in navigator)) return set('sw', { status: 'warn', detail: 'Mode hors-ligne indisponible dans ce navigateur.', advice: 'Gardez une copie du fichier souffleur.html sur une clé USB.' });
      try {
        const reg = await Promise.race([navigator.serviceWorker.getRegistration(), U.sleep(3000).then(() => null)]);
        if (!c.alive) return;
        if (reg && (reg.active || reg.waiting)) set('sw', { status: 'ok', detail: 'Prêt : l’app s’ouvre même sans internet.' });
        else set('sw', { status: 'warn', detail: 'Pas encore prêt.', advice: 'Rechargez la page une fois connecté pour activer le mode hors-ligne.' });
      } catch (e) {
        set('sw', { status: 'warn', detail: 'État du mode hors-ligne inconnu.' });
      }
    }

    function checkPip() {
      if (sup.docPiP) set('pip', { status: 'ok', detail: 'Fenêtre toujours au-dessus de Meet ou Teams disponible.' });
      else set('pip', { status: 'warn', detail: 'Indisponible ici : une fenêtre popup sera utilisée.', advice: 'Disponible dans Chrome ou Edge récents sur ordinateur.' });
    }

    function checkWake() {
      if (sup.wakeLock) set('wake', { status: 'ok', detail: 'L’écran restera allumé pendant l’entretien.' });
      else set('wake', { status: 'warn', detail: 'Indisponible.', advice: 'Désactivez la mise en veille de l’écran avant l’entretien.' });
    }

    function runAuto() {
      checkBrowser();
      checkOnline();
      checkSpeech();
      if (!busy.mic) idleMic();
      if (!busy.display) idleDisplay();
      checkPip();
      checkWake();
      checkStorage();
      checkSW();
      checkKeys();
    }

    /* ---------- tests manuels ---------- */
    async function testMic() {
      if (busy.mic) return;
      busy.mic = true;
      set('mic', { status: 'pending', detail: 'Parlez normalement pendant 3 secondes…', meter: 0.35, indet: true });
      let off = null;
      try {
        if (S.audio && S.audio.on) {
          off = S.audio.on('level', (e) => {
            if (!e || e.who === 'them') return;
            setMeter('mic', clamp(Number(e.rms) || 0, 0, 1), false);
          });
        }
      } catch (e) { off = null; }
      try {
        const r = (await S.audio.testMic(3000)) || {};
        if (!c.alive) return;
        const peak = levelUnit(r.peak);
        if (r.ok) {
          set('mic', { status: 'ok', detail: `Micro fonctionnel${r.label ? ` (${r.label})` : ''} · niveau maximal ${Math.round(peak * 100)} %.`, meter: peak, action: 'Retester' });
        } else if (!r.code || r.code === 'MIC_SILENT') {
          set('mic', {
            status: 'warn',
            detail: 'Le micro répond, mais aucun son n’a été entendu.',
            advice: 'Parlez pendant le test. Vérifiez le micro choisi (icône dans la barre d’adresse) et dans Windows : Paramètres → Son → Entrée.',
            meter: peak,
            action: 'Retester',
            primary: true
          });
        } else {
          set('mic', Object.assign({ action: 'Retester', primary: true }, micFailure(r.code, r.error)));
        }
      } catch (e) {
        if (!c.alive) return;
        set('mic', Object.assign({ action: 'Retester', primary: true }, micFailure((e && (e.code || e.name)) || '', (e && e.message) || '')));
      } finally {
        if (off) { try { off(); } catch (e) { /* ignore */ } }
        busy.mic = false;
      }
    }

    function micFailure(code, message) {
      if (code === 'MIC_DENIED' || code === 'NotAllowedError' || code === 'SecurityError') {
        return { status: 'err', detail: 'Accès au micro refusé.', advice: 'Cliquez sur l’icône à gauche de l’adresse → Micro → Autoriser, puis relancez le test.' };
      }
      if (code === 'MIC_NOT_FOUND' || code === 'NotFoundError' || code === 'OverconstrainedError') {
        return { status: 'err', detail: 'Aucun micro détecté.', advice: 'Branchez un micro ou un casque, puis relancez le test.' };
      }
      if (code === 'MIC_BUSY' || code === 'NotReadableError' || code === 'AbortError') {
        return { status: 'err', detail: 'Micro occupé ou bloqué.', advice: 'Fermez les applications qui l’utilisent (Teams, Zoom…) ou choisissez un autre micro, puis relancez.' };
      }
      if (code === 'AUDIO_SUSPENDED') {
        return { status: 'warn', detail: 'Son en veille.', advice: message || 'Cliquez dans la page puis relancez le test.' };
      }
      return { status: 'err', detail: 'Le test du micro a échoué.', advice: message || 'Rechargez la page puis relancez le test.' };
    }

    let displayCleanup = null;
    c.add(() => { if (displayCleanup) displayCleanup(); });

    async function testDisplay() {
      if (busy.display) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return idleDisplay();
      busy.display = true;
      set('display', { status: 'pending', detail: 'Choisissez l’onglet de la réunion (ou l’écran entier) et cochez le partage audio…' });
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          systemAudio: 'include',
          selfBrowserSurface: 'exclude',
          preferCurrentTab: false,
          surfaceSwitching: 'include'
        });
      } catch (e) {
        busy.display = false;
        if (!c.alive) return;
        const denied = e && (e.name === 'NotAllowedError' || e.name === 'AbortError');
        set('display', {
          status: 'warn',
          detail: denied ? 'Partage annulé.' : `Capture impossible (${errText(e)}).`,
          advice: denied ? 'Relancez le test et validez la fenêtre de partage.' : 'Utilisez Chrome ou Edge à jour sur ordinateur.',
          action: 'Tester (5 s)',
          primary: true
        });
        return;
      }
      const stopAll = () => { try { stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* ignore */ } };
      if (!c.alive) { stopAll(); busy.display = false; return; }
      const vt = stream.getVideoTracks()[0];
      const surface = vt && vt.getSettings ? vt.getSettings().displaySurface : '';
      const at = stream.getAudioTracks()[0];
      if (!at) {
        stopAll();
        busy.display = false;
        set('display', {
          status: 'warn',
          detail: 'Aucun son partagé.',
          advice: surface === 'window'
            ? 'Une fenêtre seule ne partage pas le son : choisissez l’onglet Meet (« Partager l’audio de l’onglet ») ou l’écran entier pour Teams (« Partager l’audio du système »).'
            : 'Cochez « Partager l’audio de l’onglet » (Meet dans Chrome) ou « Partager l’audio du système » (écran entier, Teams appli).',
          action: 'Tester (5 s)',
          primary: true
        });
        return;
      }
      let ac = null; let timer = 0;
      let peak = 0;
      const DURATION = 5000;
      const t0 = Date.now();
      const finish = (interrupted) => {
        clearInterval(timer);
        stopAll();
        try { if (ac) ac.close(); } catch (e) { /* ignore */ }
        displayCleanup = null;
        busy.display = false;
        if (!c.alive) return;
        const where = surface === 'monitor' ? 'du système' : 'de l’onglet';
        if (peak > 0.25) {
          set('display', { status: 'ok', detail: `Son ${where} bien capté · niveau maximal ${Math.round(peak * 100)} %.`, meter: peak, action: 'Retester' });
        } else {
          set('display', {
            status: 'warn',
            detail: interrupted ? 'Partage arrêté avant la fin du test.' : 'Partage audio actif, mais aucun son pendant le test.',
            advice: 'Pendant le test, faites jouer du son dans l’onglet partagé (vidéo, test haut-parleur de Meet/Teams).',
            meter: peak,
            action: 'Retester',
            primary: true
          });
        }
      };
      displayCleanup = () => finish(true);
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        ac = new Ctx();
        if (ac.state === 'suspended') { try { await ac.resume(); } catch (e) { /* ignore */ } }
        const src = ac.createMediaStreamSource(new MediaStream([at]));
        const an = ac.createAnalyser();
        an.fftSize = 1024;
        src.connect(an);
        const buf = new Float32Array(an.fftSize);
        set('display', { status: 'pending', detail: 'Mesure du son… 5 s', meter: 0 });
        at.addEventListener('ended', () => { if (busy.display) finish(true); });
        timer = setInterval(() => {
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const v = levelUnit(Math.sqrt(sum / buf.length));
          peak = Math.max(peak, v);
          setMeter('display', v, false);
          const left = Math.max(0, Math.ceil((DURATION - (Date.now() - t0)) / 1000));
          const det = body.querySelector('.dg-row[data-key="display"] .dg-detail');
          if (det) det.textContent = `Mesure du son… ${left} s`;
          if (Date.now() - t0 >= DURATION) finish(false);
        }, 66);
      } catch (e) {
        clearInterval(timer);
        stopAll();
        displayCleanup = null;
        busy.display = false;
        // La piste audio existe : on ne peut juste pas mesurer le niveau ici.
        set('display', { status: 'ok', detail: 'Piste audio partagée détectée (niveau non mesurable ici).', action: 'Retester' });
      }
    }

    onAct(el, {
      back: () => go('#/'),
      rerun: () => runAuto(),
      row: (btn) => {
        const k = btn.dataset.key;
        if (k === 'mic') testMic();
        else if (k === 'display') testDisplay();
        else if (k === 'gemini' || k === 'claude') {
          if (!cleanKey(settings()[`${k}Key`])) go('#/settings');
          else checkKeys();
        } else if (k === 'storage') {
          (navigator.storage && navigator.storage.persist ? navigator.storage.persist() : Promise.resolve(false))
            .then((ok) => { toast(ok ? 'Stockage protégé.' : 'Le navigateur a refusé : installez l’app pour protéger vos données.', ok ? 'ok' : 'warn'); checkStorage(); })
            .catch(() => checkStorage());
        }
      }
    });

    const onNet = () => { checkOnline(); checkSpeech(); };
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);
    c.add(() => { window.removeEventListener('online', onNet); window.removeEventListener('offline', onNet); });

    rows.forEach(drawRow);
    runAuto();
  }

  const diagScreen = (() => {
    let ctx = null;
    return {
      leave() { if (ctx) ctx.end(); ctx = null; },
      render(root) {
        if (ctx) ctx.end();
        const c = ctx = lifecycle();
        const el = mount(root, 'dg', `${topbar({ title: 'Diagnostic', sub: 'Avant l’entretien' })}<div class="sc-body"></div>`);
        runDiag(el, c);
      }
    };
  })();

  /* ================================================================ PRISE EN MAIN */

  function onboarding() {
    setSettings({ onboarded: true });
    const s0 = settings();
    // PC emprunté par défaut dans un simple onglet (app non installée) et sans clé déjà mémorisée.
    let installed = false;
    try { installed = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches; } catch (e) { /* ignore */ }
    const mine = installed || (!!s0.geminiKey && s0.rememberKeys !== false);
    setSettings({ rememberKeys: mine });
    const data = {
      step: 0,
      key: s0.geminiKey || '',
      remember: mine,
      preset: s0.audioPreset || (s0.geminiKey ? 'visio-casque' : 'haut-parleur'),
      company: '', role: '', date: '', mode: 'visio'
    };
    const box = h('<div class="ob"></div>');
    const sheet = S.ui.sheet({ title: 'Bienvenue dans Souffleur', body: box, actions: [], className: 'ob-sheet' });
    const STEPS = 3;

    function dots() {
      return `<div class="ob-dots" aria-label="Étape ${data.step + 1} sur ${STEPS}">${Array.from({ length: STEPS }, (_, i) =>
        `<i class="${i === data.step ? 'on' : i < data.step ? 'done' : ''}"></i>`).join('')}</div>`;
    }

    function stepKey() {
      return `
        <div class="ob-hero"><div class="ob-app-ic">${icon('sparkles')}</div>
          <div class="h2">Votre souffleur d’entretien</div>
          <p class="muted">Il écoute le recruteur et vous souffle la bonne réponse, en direct, à partir de votre CV et de la fiche de poste.</p></div>
        <div class="ob-card">
          <div class="h3">1. Une clé Gemini, gratuite</div>
          <p class="small muted">Google offre un accès gratuit à son IA : il suffit d’un compte Google, sans carte bancaire. La clé reste sur cet appareil.</p>
          <ol class="ob-steps small">
            <li>Ouvrez <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com/apikey</a></li>
            <li>Cliquez sur « Create API key », puis copiez la clé.</li>
            <li>Collez-la ci-dessous.</li>
          </ol>
          <div class="st-key-field">
            <input type="password" data-ob="key" value="${esc(data.key)}" placeholder="AIza…" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Clé Gemini">
            <button type="button" class="icon-btn" data-act="paste" aria-label="Coller" title="Coller">${icon('copy')}</button>
            <button type="button" class="btn btn-sm btn-ghost" data-act="verify">Vérifier</button>
          </div>
          <div class="small ob-status" aria-live="polite"></div>
          <div class="ob-device">
            <div class="small"><b>Sur quel ordinateur êtes-vous ?</b></div>
            <div class="seg" role="radiogroup" aria-label="Ordinateur">
              <button type="button" role="radio" data-act="device" data-v="mine" class="${data.remember ? 'on' : ''}" aria-checked="${data.remember}">${icon('home')} Mon PC</button>
              <button type="button" role="radio" data-act="device" data-v="borrowed" class="${data.remember ? '' : 'on'}" aria-checked="${!data.remember}">${icon('shield')} PC emprunté</button>
            </div>
            <div class="small muted ob-device-note">${data.remember ? 'La clé est mémorisée sur cet appareil.' : 'Mode invité : la clé est oubliée à la fermeture de l’onglet. Vous pourrez tout effacer après l’entretien.'}</div>
          </div>
        </div>
        <p class="small muted">Sans clé, Souffleur marche quand même : mode haut-parleur et réponses préparées.</p>`;
    }

    function stepAudio() {
      const key = !!cleanKey(data.key);
      return `
        <div class="ob-hero"><div class="ob-app-ic">${icon('waveform')}</div>
          <div class="h2">2. Comment se passe l’appel ?</div>
          <p class="muted">Modifiable à tout moment avant de démarrer.</p></div>
        <div class="ob-presets" role="radiogroup" aria-label="Mode audio">
          ${(() => {
            // 'visio-hp' fait la même chose que 'haut-parleur' : on ne le propose pas ici.
            const list = presets().filter((p) => p.id !== 'visio-hp');
            const main = list.filter((p) => p.id !== 'micro-cloud');
            const more = list.filter((p) => p.id === 'micro-cloud');
            const btn = (p) => {
            const info = PRESET_INFO[p.id] || { icon: 'mic', desc: '' };
            const on = data.preset === p.id;
            return `<button type="button" class="ob-preset${on ? ' on' : ''}" role="radio" aria-checked="${on}" data-act="preset" data-v="${esc(p.id)}">
              <span class="ob-preset-ic">${icon(info.icon)}</span>
              <span class="ob-preset-txt"><b>${esc(p.label)}</b><span class="small muted">${esc(info.desc)}</span></span>
              ${p.id === 'visio-casque' ? `<span class="pill ${key ? 'pill-accent' : 'pill-warn'}">${key ? 'Recommandé' : 'Clé requise'}</span>` : p.needsKey ? `<span class="pill ${key ? '' : 'pill-warn'}">Clé requise</span>` : '<span class="pill pill-ok">Gratuit</span>'}
            </button>`;
            };
            const moreOpen = more.some((p) => p.id === data.preset);
            return main.map(btn).join('') + (more.length ? `<details class="ob-more"${moreOpen ? ' open' : ''}><summary class="small">Plus d’options ${icon('chevron-down')}</summary>${more.map(btn).join('')}</details>` : '');
          })()}
        </div>`;
    }

    function stepDossier() {
      return `
        <div class="ob-hero"><div class="ob-app-ic">${icon('doc')}</div>
          <div class="h2">3. Votre premier entretien</div>
          <p class="muted">Ensuite, glissez la fiche de poste, votre CV et votre fiche de préparation : l’IA prépare pitch et réponses.</p></div>
        <div class="ob-card ob-form">
          <label class="field"><span>Entreprise</span><input data-ob="company" value="${esc(data.company)}" placeholder="Ex. : Groupe Exemple" autocomplete="organization"></label>
          <label class="field"><span>Poste</span><input data-ob="role" value="${esc(data.role)}" placeholder="Ex. : Responsable administratif et financier"></label>
          <div class="grid2">
            <label class="field"><span>Date et heure</span><input type="datetime-local" data-ob="date" value="${esc(data.date)}"></label>
            <label class="field"><span>Format</span><select data-ob="mode">
              ${[['visio', 'Visio (Meet, Teams)'], ['tel', 'Téléphone'], ['presentiel', 'Présentiel']].map(([v, l]) => `<option value="${v}" ${data.mode === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select></label>
          </div>
        </div>`;
    }

    function footer() {
      const back = data.step > 0 ? `<button type="button" class="btn btn-ghost" data-act="prev">${icon('chevron-left')} Retour</button>` : `<button type="button" class="btn btn-ghost" data-act="skip">Plus tard</button>`;
      const next = data.step < STEPS - 1
        ? `<button type="button" class="btn btn-primary" data-act="next">Continuer ${icon('chevron-right')}</button>`
        : `<button type="button" class="btn btn-primary" data-act="create">${icon('plus')} Créer le dossier</button>`;
      const skip = data.step === STEPS - 1 ? '<button type="button" class="btn btn-ghost btn-sm ob-later" data-act="skip">Passer</button>' : '';
      return `<div class="ob-foot">${back}<span class="sc-grow"></span>${skip}${next}</div>`;
    }

    function draw() {
      box.innerHTML = `${dots()}<div class="ob-step">${[stepKey, stepAudio, stepDossier][data.step]()}</div>${footer()}`;
      const first = box.querySelector('.ob-step input:not([type="checkbox"])');
      if (first && data.step !== 1) setTimeout(() => { try { first.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 60);
    }

    function commitKey() {
      const k = cleanKey(data.key);
      setSettings({ rememberKeys: !!data.remember, geminiKey: k });
    }

    async function verify(btn) {
      commitKey();
      const out = box.querySelector('.ob-status');
      if (!cleanKey(data.key)) { out.innerHTML = `<span class="pill pill-warn">${icon('warning')} Collez d’abord votre clé</span>`; return; }
      btn.disabled = true;
      out.innerHTML = '<span class="spinner"></span> Vérification…';
      try {
        const res = (await S.ai.test()) || [];
        const ok = res.find((r) => r && r.provider === 'gemini' && r.ok);
        const bad = res.find((r) => r && r.provider === 'gemini' && !r.ok);
        out.innerHTML = ok
          ? `<span class="pill pill-ok">${icon('check')} Clé valide</span> <span class="muted">${esc(ok.model || '')} · ${fmtMs(ok.ms)}</span>`
          : `<span class="pill pill-err">${icon('xmark')} ${esc(bad ? errText(bad.error) : 'Échec du test')}</span>`;
      } catch (e) {
        out.innerHTML = `<span class="pill pill-err">${icon('xmark')} ${esc(errText(e))}</span>`;
      }
      btn.disabled = false;
    }

    async function create(btn) {
      const company = data.company.trim(); const role = data.role.trim();
      if (!company && !role) { toast('Indiquez au moins l’entreprise ou le poste.', 'warn'); return; }
      btn.disabled = true;
      try {
        let d = await S.store.create({
          name: role && company ? `${role} · ${company}` : company || role,
          company, role, date: data.date || '', mode: data.mode || 'visio'
        });
        d = (await S.store.save(d)) || d;
        sheet.close();
        toast('Dossier créé : ajoutez vos documents.', 'ok');
        go(dossierHash(d.id));
      } catch (e) {
        btn.disabled = false;
        toast(`Création impossible : ${errText(e)}`, 'err');
      }
    }

    box.addEventListener('input', (e) => {
      const k = e.target.dataset.ob;
      if (k && k !== 'remember') data[k] = e.target.value;
    });
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || !e.target.matches('input:not([type="checkbox"])')) return;
      e.preventDefault();
      e.stopPropagation();
      e.target.dispatchEvent(new Event('change', { bubbles: true }));
      const primary = box.querySelector('.ob-foot .btn-primary');
      if (primary && !primary.disabled) primary.click();
    });
    box.addEventListener('change', (e) => {
      const k = e.target.dataset.ob;
      if (k === 'remember') { data.remember = e.target.checked; setSettings({ rememberKeys: data.remember }); }
      else if (k === 'key') { data.key = cleanKey(e.target.value); e.target.value = data.key; commitKey(); }
      else if (k) data[k] = e.target.value;
    });
    onAct(box, {
      device: (b) => {
        data.remember = b.dataset.v === 'mine';
        setSettings({ rememberKeys: data.remember });
        box.querySelectorAll('[data-act="device"]').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
        const n = box.querySelector('.ob-device-note');
        if (n) n.textContent = data.remember ? 'La clé est mémorisée sur cet appareil.' : 'Mode invité : la clé est oubliée à la fermeture de l’onglet. Vous pourrez tout effacer après l’entretien.';
      },
      next: () => {
        if (data.step === 0) {
          commitKey();
          // Une clé vient d'être saisie : le cas prioritaire (Meet / Teams sur ce PC) devient le choix par défaut.
          if (cleanKey(data.key) && !settings().audioPreset) data.preset = 'visio-casque';
        }
        if (data.step === 1) setSettings({ audioPreset: data.preset }); data.step = Math.min(STEPS - 1, data.step + 1); draw(); },
      prev: () => { data.step = Math.max(0, data.step - 1); draw(); },
      skip: () => { if (data.step === 0) commitKey(); sheet.close(); },
      paste: async () => {
        try {
          const t = await navigator.clipboard.readText();
          const input = box.querySelector('[data-ob="key"]');
          data.key = cleanKey(t);
          input.value = data.key;
          commitKey();
        } catch (e) { toast('Collage automatique refusé : faites Ctrl+V dans le champ.', 'warn'); }
      },
      verify: (b) => verify(b),
      preset: (b) => {
        data.preset = b.dataset.v;
        box.querySelectorAll('.ob-preset').forEach((x) => {
          const on = x === b;
          x.classList.toggle('on', on);
          x.setAttribute('aria-checked', String(on));
        });
        setSettings({ audioPreset: data.preset });
      },
      create: (b) => create(b)
    });

    draw();
    return sheet;
  }

  /* ================================================================ enregistrement */

  function register(name, def) {
    if (S.app && typeof S.app.register === 'function') S.app.register(name, def);
    else document.addEventListener('DOMContentLoaded', () => { if (S.app && S.app.register) S.app.register(name, def); }, { once: true });
  }

  S.app = S.app || {};
  S.app.onboarding = onboarding;
  register('training', trainingScreen);
  register('recap', recapScreen);
  register('settings', settingsScreen);
  register('diag', diagScreen);
})(window.Souffleur = window.Souffleur || {});
