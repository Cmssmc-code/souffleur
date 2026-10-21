/* Souffleur — coffre chiffré des entretiens préparés (S.vault).
 * Le site publie data/dossiers.enc.json : dossiers chiffrés AES-256-GCM, clé dérivée du code d'accès
 * (PBKDF2-SHA256). Rien n'est lisible sans le code ; le code reste sur l'appareil.
 */
(function (S) {
  'use strict';

  const PUBLIC_URL = 'https://cmssmc-code.github.io/souffleur/data/dossiers.enc.json';
  const CODE_KEY = 'souffleur.vaultCode';
  const vault = S.vault = {};
  let cache = null; // { env, dossiers }

  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const esc = (s) => S.util.esc(s);
  const icon = (n) => (S.ui && S.ui.icon ? S.ui.icon(n) : '');
  const toast = (m, k) => (S.ui && S.ui.toast ? S.ui.toast(m, k) : S.util.toast(m, k));

  function remember() { const st = S.store.settings(); return st.rememberKeys !== false; }
  vault.getCode = () => { try { return sessionStorage.getItem(CODE_KEY) || localStorage.getItem(CODE_KEY) || ''; } catch (e) { return ''; } };
  vault.setCode = (code) => {
    try {
      localStorage.removeItem(CODE_KEY); sessionStorage.removeItem(CODE_KEY);
      if (code) (remember() ? localStorage : sessionStorage).setItem(CODE_KEY, code);
    } catch (e) { /* stockage bloqué : le code ne sera pas retenu */ }
  };

  async function fetchEnvelope() {
    const urls = /^https?:$/.test(location.protocol) ? ['data/dossiers.enc.json', PUBLIC_URL] : [PUBLIC_URL];
    for (const u of urls) {
      try {
        const r = await fetch(u + '?t=' + Date.now(), { cache: 'no-store' });
        if (r.ok) { const j = await r.json(); if (j && j.format === 'souffleur-vault') return j; }
      } catch (e) { /* URL suivante */ }
    }
    return null;
  }

  async function decrypt(env, code) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code.trim()), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(env.salt), iterations: env.iter },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(env.iv) }, key, b64(env.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // Copie les dossiers du coffre dans le stockage local, sans écraser les sessions déjà jouées.
  async function sync(dossiers) {
    let changed = 0;
    for (const v of dossiers) {
      const local = await S.store.get(v.id);
      if (local && local.vaultAt === v.vaultAt) continue;
      const d = S.store.normalize(Object.assign({}, v, { sessions: local ? local.sessions : [] }));
      d.vaultAt = v.vaultAt;
      d.source = 'vault';
      await S.store.save(d);
      changed++;
    }
    return changed;
  }

  function upcoming(dossiers) {
    const now = Date.now() - 3 * 3600e3;
    return dossiers.filter((d) => d.date && Date.parse(d.date) >= now).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  }

  function label(d) {
    const when = d.date ? new Date(d.date).toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    return `${when} — ${d.company || d.name}${d.role ? ' · ' + d.role : ''}`;
  }

  async function unlock(env, code) {
    const data = await decrypt(env, code);
    const list = Array.isArray(data.dossiers) ? data.dossiers : [];
    const n = await sync(list);
    cache = { env, dossiers: list };
    return n;
  }

  vault.mount = async function (el) {
    if (!el) return;
    const env = await fetchEnvelope();
    if (!env || !el.isConnected) { el.innerHTML = ''; return; }
    const code = vault.getCode();
    if (code && !(cache && cache.env.ct === env.ct)) {
      try {
        const n = await unlock(env, code);
        if (n && el.isConnected) { S.app.go(location.hash || '#/'); return; } // l'accueil se redessine avec les nouveaux dossiers
      } catch (e) { vault.setCode(''); cache = null; }
    }
    if (!el.isConnected) return;
    if (cache && cache.env.ct === env.ct) renderList(el); else renderLock(el, env);
  };

  function renderLock(el, env) {
    el.innerHTML = `<section class="card card-pad vault-card">
      <div class="row"><span class="tile tile-blue">${icon('shield')}</span><div class="grow"><b>Entretiens préparés pour vous</b><div class="small muted">${env.count ? env.count + ' dossier(s) chiffré(s) · ' : ''}entrez votre code d’accès pour les charger sur cet appareil.</div></div></div>
      <form class="row vault-form">
        <input type="text" class="secret-input input grow" name="sf-vault" autocomplete="off" data-1p-ignore data-lpignore="true" spellcheck="false" placeholder="Code d’accès" aria-label="Code d’accès">
        <button type="submit" class="btn btn-primary">${icon('check')}<span>Déverrouiller</span></button>
      </form>
    </section>`;
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = el.querySelector('input');
      const code = input.value.trim();
      if (!code) return;
      const btn = el.querySelector('button');
      btn.disabled = true;
      try {
        await unlock(env, code);
        vault.setCode(code);
        toast('Entretiens chargés.', 'ok');
        S.app.go('#/');
        if (location.hash === '#/' || !location.hash) vault.mount(el);
      } catch (err) {
        btn.disabled = false;
        input.select();
        toast('Code d’accès incorrect.', 'err');
      }
    });
  }

  function renderList(el) {
    const list = upcoming(cache.dossiers);
    if (!list.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<section class="card card-pad vault-card">
      <div class="row"><span class="tile tile-blue">${icon('calendar')}</span><div class="grow"><b>Prochains entretiens</b><div class="small muted">Préparés et mis à jour automatiquement.</div></div></div>
      <div class="row vault-form">
        <select class="input grow" aria-label="Choisir l’entretien">${list.map((d) => `<option value="${esc(d.id)}">${esc(label(d))}</option>`).join('')}</select>
        <a class="btn" data-v="meet" target="_blank" rel="noopener noreferrer" hidden>${icon('video')}<span>Visio</span></a>
        <button type="button" class="btn" data-v="open">${icon('doc')}<span>Dossier</span></button>
        <button type="button" class="btn btn-primary" data-v="live">${icon('play')}<span>Lancer</span></button>
      </div>
    </section>`;
    const sel = el.querySelector('select');
    const meet = el.querySelector('[data-v="meet"]');
    const syncMeet = () => {
      const d = list.find((x) => x.id === sel.value);
      const url = d && /^https:\/\//.test(d.meetUrl || '') ? d.meetUrl : '';
      meet.hidden = !url;
      if (url) meet.href = url; else meet.removeAttribute('href');
    };
    sel.addEventListener('change', syncMeet);
    syncMeet();
    el.querySelector('[data-v="open"]').addEventListener('click', () => S.app.go('#/dossier/' + sel.value));
    el.querySelector('[data-v="live"]').addEventListener('click', () => S.app.go('#/live/' + sel.value));
  }
})(window.Souffleur = window.Souffleur || {});
