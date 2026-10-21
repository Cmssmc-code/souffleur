/* Souffleur — app.js : cœur de l'interface.
 * S.ui (icônes, feuilles modales, toasts…), S.app (routeur hash) et les écrans Accueil, Dossier et Live.
 * Les écrans Entraînement, Récap, Réglages et Diagnostic sont enregistrés par screens.js. */
(function (S) {
  'use strict';

  const NB = '\u202f'; // espace fine insécable (avant ? ! : ;)

  /* ====================================================================== *
   *  Petits utilitaires (délèguent à S.util, avec repli minimal)
   * ====================================================================== */
  const U = () => S.util || {};
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => (U().esc ? U().esc(String(s == null ? '' : s))
    : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const md = (s) => (U().md ? U().md(String(s == null ? '' : s))
    : esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>'));
  const uid = () => (U().uid ? U().uid() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const fmtTime = (ms) => {
    if (U().fmtTime) return U().fmtTime(ms);
    const s = Math.max(0, Math.floor((ms || 0) / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };
  const normTxt = (s) => (U().norm ? U().norm(s)
    : String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim());
  const similarity = (a, b) => {
    if (U().similarity) { try { return U().similarity(a, b) || 0; } catch (e) { /* repli */ } }
    const A = new Set(normTxt(a).split(' ').filter((w) => w.length > 2));
    const B = new Set(normTxt(b).split(' ').filter((w) => w.length > 2));
    if (!A.size || !B.size) return 0;
    let n = 0; A.forEach((w) => { if (B.has(w)) n++; });
    return n / (A.size + B.size - n);
  };
  const isQuestion = (t) => (U().isQuestion ? U().isQuestion(t)
    : /\?|^(pourquoi|comment|quel|quelle|quels|quelles|qu.est|pouvez|parlez|presentez|racontez|decrivez|expliquez|avez-vous|est-ce)/.test(normTxt(t)));
  const settings = () => { try { return (S.store && S.store.settings && S.store.settings()) || {}; } catch (e) { return {}; } };
  const setSettings = (patch) => { try { if (S.store && S.store.setSettings) S.store.setSettings(patch); } catch (e) { console.warn('[souffleur] settings', e); } };
  const hasKey = () => { try { return !!(S.ai && S.ai.hasKey && S.ai.hasKey()); } catch (e) { return false; } };
  const nowIso = () => new Date().toISOString();
  const errMsg = (e) => (e && (e.userMessage || e.message)) || String(e || 'Erreur inconnue');
  const isAbort = (e) => !!e && (e.name === 'AbortError' || e.code === 20 || /abort/i.test(e.message || ''));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const secs = (ms) => (Math.max(0, ms || 0) / 1000).toFixed(1).replace('.', ',') + ' s';
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const isTyping = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  /* ====================================================================== *
   *  S.ui — icônes style SF Symbols
   * ====================================================================== */
  const F = 'fill="currentColor" stroke="none"';
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    mic: '<rect x="9" y="2.75" width="6" height="11.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.75 21h6.5"/>',
    'mic-slash': '<path d="M15 9.5V5.75a3 3 0 0 0-5.6-1.5M9 9v2.25a3 3 0 0 0 5 2.2M5.5 11a6.5 6.5 0 0 0 10.9 4.8M18.5 11c0 .8-.15 1.6-.4 2.3M12 17.5V21M8.75 21h6.5M3.5 3.5l17 17"/>',
    waveform: '<path d="M4 10v4M8 7v10M12 3.5v17M16 6.5v11M20 9.5v5"/>',
    sparkles: '<path d="M10 3.5l1.6 4.9 4.9 1.6-4.9 1.6L10 16.5l-1.6-4.9L3.5 10l4.9-1.6z"/><path d="M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/><path d="M18.5 3v3M17 4.5h3"/>',
    doc: '<path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3v3.5A1.5 1.5 0 0 0 15.5 8H19M9 13h6M9 16.5h4"/>',
    upload: '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M4.5 14.5v3A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5v-3"/>',
    play: `<path ${F} d="M7 4.9v14.2c0 .9 1 1.5 1.8 1l11.7-7.1c.8-.5.8-1.6 0-2.1L8.8 3.9C8 3.4 7 4 7 4.9z"/>`,
    pause: `<rect ${F} x="6" y="4.5" width="4.2" height="15" rx="1.3"/><rect ${F} x="13.8" y="4.5" width="4.2" height="15" rx="1.3"/>`,
    stop: `<rect ${F} x="5.5" y="5.5" width="13" height="13" rx="3"/>`,
    gear: '<path d="M12.22 2.75h-.44a1.9 1.9 0 0 0-1.9 1.9v.17a1.9 1.9 0 0 1-.95 1.64l-.41.24a1.9 1.9 0 0 1-1.9 0l-.14-.08a1.9 1.9 0 0 0-2.6.7l-.22.37a1.9 1.9 0 0 0 .7 2.6l.14.09a1.9 1.9 0 0 1 .95 1.63v.48a1.9 1.9 0 0 1-.95 1.65l-.14.08a1.9 1.9 0 0 0-.7 2.6l.22.37a1.9 1.9 0 0 0 2.6.7l.14-.08a1.9 1.9 0 0 1 1.9 0l.41.24a1.9 1.9 0 0 1 .95 1.64v.17a1.9 1.9 0 0 0 1.9 1.9h.44a1.9 1.9 0 0 0 1.9-1.9v-.17a1.9 1.9 0 0 1 .95-1.64l.41-.24a1.9 1.9 0 0 1 1.9 0l.14.08a1.9 1.9 0 0 0 2.6-.7l.22-.37a1.9 1.9 0 0 0-.7-2.6l-.14-.08a1.9 1.9 0 0 1-.95-1.65v-.48a1.9 1.9 0 0 1 .95-1.63l.14-.09a1.9 1.9 0 0 0 .7-2.6l-.22-.37a1.9 1.9 0 0 0-2.6-.7l-.14.08a1.9 1.9 0 0 1-1.9 0l-.41-.24a1.9 1.9 0 0 1-.95-1.64v-.17a1.9 1.9 0 0 0-1.9-1.9z"/><circle cx="12" cy="12" r="3"/>',
    'chevron-left': '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    'chevron-right': '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
    'chevron-down': '<path d="M5.5 9.5 12 16l6.5-6.5"/>',
    trash: '<path d="M4 6.5h16M9.5 6.5V4.75c0-.7.55-1.25 1.25-1.25h2.5c.7 0 1.25.55 1.25 1.25V6.5M6 6.5l.9 12.1A2.5 2.5 0 0 0 9.4 21h5.2a2.5 2.5 0 0 0 2.5-2.4L18 6.5M10 10.5v6M14 10.5v6"/>',
    export: '<path d="M12 14.5V3.5M8 7.5l4-4 4 4"/><path d="M8.5 10.5H7A2.5 2.5 0 0 0 4.5 13v5.5A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5V13a2.5 2.5 0 0 0-2.5-2.5h-1.5"/>',
    import: '<path d="M12 3.5v11M8 10.5l4 4 4-4"/><path d="M8.5 7.5H7A2.5 2.5 0 0 0 4.5 10v8.5A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5V10A2.5 2.5 0 0 0 17 7.5h-1.5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    warning: '<path d="M10.3 4.2 2.6 17.6a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
    xmark: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    pip: `<rect x="2.5" y="4.5" width="19" height="15" rx="3"/><rect ${F} x="11.5" y="10.5" width="7" height="6" rx="1.5"/>`,
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8"/>',
    clock: '<circle cx="12" cy="12" r="8.75"/><path d="M12 7.5V12l3 2"/>',
    person: '<circle cx="12" cy="8" r="3.75"/><path d="M4.75 20a7.25 7.25 0 0 1 14.5 0"/>',
    person2: '<circle cx="9" cy="8.25" r="3.25"/><path d="M3 19.5a6 6 0 0 1 12 0M15.5 5.2a3.25 3.25 0 0 1 0 6.1M17.5 13.9a6 6 0 0 1 3.5 5.6"/>',
    bolt: '<path d="M13 2.75 4.75 13.5H11l-1 7.75 8.25-10.75H12z"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4v4.5H15"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
    download: '<path d="M12 3.5v12M7.5 11 12 15.5 16.5 11M5 20.5h14"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    'eye-slash': '<path d="M9.9 5.75A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.6 6.9C4 8.6 2.5 12 2.5 12S6 18.5 12 18.5c1.9 0 3.5-.6 4.9-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2M3.5 3.5l17 17"/>',
    info: '<circle cx="12" cy="12" r="8.75"/><path d="M12 11v5.5M12 7.75h.01"/>',
    graduation: '<path d="M2.5 9 12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11v4.75c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3V11M21.5 9v5"/>',
    list: '<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
    phone: '<path d="M5.2 3.5h2.7c.5 0 .9.3 1 .8l.9 3.6c.1.4 0 .8-.3 1.1L7.8 10.7a12.5 12.5 0 0 0 5.5 5.5l1.7-1.7c.3-.3.7-.4 1.1-.3l3.6.9c.5.1.8.5.8 1v2.7c0 .9-.7 1.7-1.7 1.7C10.3 20.5 3.5 13.7 3.5 5.2c0-1 .8-1.7 1.7-1.7z"/>',
    video: '<rect x="2.5" y="6" width="13" height="12" rx="3"/><path d="M15.5 10.5 21.5 7v10l-6-3.5"/>',
    speaker: '<path d="M3.5 9.75v4.5c0 .55.45 1 1 1H7.5l4.5 4V4.75l-4.5 4H4.5c-.55 0-1 .45-1 1z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
    shield: '<path d="M12 3 19.5 6v5.5c0 4.6-3.2 8.4-7.5 9.5-4.3-1.1-7.5-4.9-7.5-9.5V6z"/><path d="M8.75 12.25l2.25 2.25 4.25-4.5"/>',
    'wifi-off': '<path d="M3.5 3.5l17 17M8.6 16.1a4.8 4.8 0 0 1 6.8 0M5.2 12.6a9.6 9.6 0 0 1 4.4-2.4M2.3 9.1A14.4 14.4 0 0 1 6.5 6.6M10.9 5.3c3.9-.3 7.8 1 10.8 3.8M16.6 10.8c.8.5 1.6 1.1 2.2 1.8M12 19.75h.01"/>',
    home: '<path d="M3.5 10.5 12 3.75l8.5 6.75"/><path d="M5.5 9v9.5A1.5 1.5 0 0 0 7 20h3.25v-5.5h3.5V20H17a1.5 1.5 0 0 0 1.5-1.5V9"/>',
    edit: '<path d="M4 20h4.2L19.1 9.1a2.6 2.6 0 0 0-3.7-3.7L4.5 16.3 4 20z"/><path d="M13.75 7.25l3 3"/>',
    // Supplémentaires
    search: '<circle cx="10.75" cy="10.75" r="6.75"/><path d="m20 20-4.5-4.5"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    building: '<path d="M4.5 21V5.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2V21M15.5 9.5H18a2 2 0 0 1 2 2V21M3 21h18M8.5 7.5h3M8.5 11h3M8.5 14.5h3"/>',
    send: '<path d="M12 19V5.5M6.5 11 12 5.5 17.5 11"/>',
    ellipsis: '<path d="M6 12h.01M12 12h.01M18 12h.01" stroke-width="2.6"/>',
    key: '<circle cx="8" cy="15" r="4.5"/><path d="M11.2 11.8 20 3M17 6l2.5 2.5M14.5 8.5l2 2"/>',
    chat: '<path d="M20.5 11.5c0 4.1-3.8 7.5-8.5 7.5-1.2 0-2.3-.2-3.3-.6L3.5 20l1.4-3.9c-.9-1.3-1.4-2.9-1.4-4.6C3.5 7.4 7.3 4 12 4s8.5 3.4 8.5 7.5z"/>',
    lightbulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"/>',
    clipboard: '<rect x="5" y="4.5" width="14" height="16.5" rx="2.5"/><path d="M9 4.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v.5a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1zM9 11h6M9 14.5h6M9 18h3.5"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    globe: '<circle cx="12" cy="12" r="8.75"/><path d="M3.25 12h17.5M12 3.25c2.3 2.4 3.5 5.3 3.5 8.75s-1.2 6.35-3.5 8.75c-2.3-2.4-3.5-5.3-3.5-8.75S9.7 5.65 12 3.25z"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
    'text-size': '<path d="M3 18 8 6l5 12M4.6 14h6.8M14.5 18l3.25-8L21 18M15.5 15.5h4.5"/>',
    'arrow-down': '<path d="M12 4.5v15M6 13.5l6 6 6-6"/>',
    quote: '<path d="M9.5 7H6.5a2 2 0 0 0-2 2v2.5a2 2 0 0 0 2 2h3V15a3 3 0 0 1-3 3M19.5 7h-3a2 2 0 0 0-2 2v2.5a2 2 0 0 0 2 2h3V15a3 3 0 0 1-3 3"/>',
    target: '<circle cx="12" cy="12" r="8.75"/><circle cx="12" cy="12" r="4.75"/><circle cx="12" cy="12" r=".9" fill="currentColor"/>'
  };
  function icon(name, cls) {
    const body = ICONS[name] || ICONS.info;
    return `<svg class="ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
  }

  /* ====================================================================== *
   *  S.ui — DOM, feuilles modales, confirmations, toasts, dates
   * ====================================================================== */
  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html == null ? '' : html).trim();
    if (t.content.childNodes.length === 1 && t.content.firstElementChild) return t.content.firstElementChild;
    const wrap = document.createElement('div');
    wrap.appendChild(t.content);
    return wrap;
  }

  function topSheetLayer() {
    const layers = $$('.sheet-layer:not(.out)');
    return layers[layers.length - 1] || null;
  }

  function sheet(opts) {
    const o = opts || {};
    const actions = o.actions || [];
    const dismissible = o.dismissible !== false;
    const prevFocus = document.activeElement;
    const layer = h(`<div class="sheet-layer">
      <div class="sheet-backdrop"></div>
      <section class="sheet ${o.wide ? 'sheet-wide' : ''} ${esc(o.className || '')}" role="dialog" aria-modal="true"${o.title ? ` aria-label="${esc(o.title)}"` : ''}>
        <div class="sheet-grabber" aria-hidden="true"></div>
        ${o.title ? `<header class="sheet-head"><h2 class="sheet-title">${esc(o.title)}</h2>${dismissible ? `<button type="button" class="icon-btn sheet-x" aria-label="Fermer">${icon('xmark')}</button>` : ''}</header>` : ''}
        <div class="sheet-body"></div>
        ${actions.length ? '<footer class="sheet-actions"></footer>' : ''}
      </section>
    </div>`);
    const el = $('.sheet', layer);
    const bodyEl = $('.sheet-body', el);
    if (o.body instanceof Node) bodyEl.appendChild(o.body);
    else bodyEl.innerHTML = o.body || '';
    let closed = false;
    function close(reason) {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      layer.classList.add('out');
      layer.classList.remove('in');
      setTimeout(() => layer.remove(), 260);
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) { try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* rien */ } }
      if (o.onClose) { try { o.onClose(reason); } catch (e) { console.warn(e); } }
    }
    const foot = $('.sheet-actions', el);
    actions.forEach((a) => {
      const b = h(`<button type="button" class="btn btn-${esc(a.kind || 'ghost')}">${a.icon ? icon(a.icon) : ''}<span>${esc(a.label)}</span></button>`);
      b.addEventListener('click', async () => {
        let r;
        if (a.onClick) {
          b.disabled = true;
          try { r = await a.onClick({ el, close, button: b }); } catch (e) { toast(errMsg(e), 'err'); r = false; } finally { b.disabled = false; }
        }
        if (a.close !== false && r !== false) close('action');
      });
      foot.appendChild(b);
    });
    $('.sheet-backdrop', layer).addEventListener('click', () => { if (dismissible) close('backdrop'); });
    const x = $('.sheet-x', el);
    if (x) x.addEventListener('click', () => close('x'));
    function onKey(e) {
      if (topSheetLayer() !== layer) return;
      if (e.key === 'Escape' && dismissible) { e.preventDefault(); e.stopPropagation(); close('esc'); return; }
      if (e.key === 'Enter' && !e.shiftKey && e.target && e.target.matches && e.target.matches('.sheet input:not([type=checkbox]):not([type=radio]):not([type=file])')) {
        const p = foot && $('.btn-primary, .btn-danger', foot);
        if (p) { e.preventDefault(); p.click(); }
        return;
      }
      if (e.key === 'Tab') {
        const f = $$('button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])', el).filter((n) => n.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(layer);
    requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('in')));
    setTimeout(() => {
      if (closed) return;
      const f = $('[autofocus]', el) || $('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea', el) || (foot && $('.btn-primary', foot)) || x;
      if (f) { try { f.focus({ preventScroll: true }); } catch (e) { /* rien */ } }
    }, 80);
    return { el, close };
  }

  function confirmSheet(o) {
    o = o || {};
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      sheet({
        title: o.title || 'Confirmer',
        body: o.text ? `<p class="sheet-text">${esc(o.text)}</p>` : '',
        className: 'sheet-confirm',
        actions: [
          { label: o.cancelLabel || 'Annuler', kind: 'ghost', onClick: () => finish(false) },
          { label: o.okLabel || 'Confirmer', kind: o.danger ? 'danger' : 'primary', onClick: () => finish(true) }
        ],
        onClose: () => finish(false)
      });
    });
  }

  const TOAST_ICON = { ok: 'check', warn: 'warning', err: 'warning', info: 'info' };
  function toast(msg, kind, opts) {
    if (msg && typeof msg === 'object') { opts = msg; kind = msg.kind || kind; msg = msg.msg || msg.message || msg.text || ''; }
    msg = String(msg == null ? '' : msg);
    if (!msg) return;
    kind = TOAST_ICON[kind] ? kind : 'info';
    opts = opts || {};
    const host = document.getElementById('toasts');
    if (!host) { console.log('[toast]', kind, msg); return; }
    const same = $$('.toast:not(.out)', host).find((n) => n.dataset.msg === msg);
    if (same) { same.classList.remove('bump'); void same.offsetWidth; same.classList.add('bump'); return; }
    const el = h(`<div class="toast toast-${kind}" role="${kind === 'err' ? 'alert' : 'status'}"><span class="toast-ic">${icon(TOAST_ICON[kind])}</span><span class="toast-msg">${esc(msg)}</span></div>`);
    el.dataset.msg = msg;
    let timer;
    const close = () => { clearTimeout(timer); el.classList.add('out'); setTimeout(() => el.remove(), 260); };
    if (opts.action && opts.action.label) {
      const b = h(`<button type="button" class="toast-act">${esc(opts.action.label)}</button>`);
      b.addEventListener('click', (e) => { e.stopPropagation(); close(); try { opts.action.onClick && opts.action.onClick(); } catch (er) { console.warn(er); } });
      el.appendChild(b);
    }
    el.addEventListener('click', close);
    host.appendChild(el);
    const visible = $$('.toast:not(.out)', host);
    if (visible.length > 3) visible.slice(0, visible.length - 3).forEach((n) => n.remove());
    timer = setTimeout(close, opts.duration || (kind === 'err' ? 7000 : kind === 'warn' ? 5200 : 3400));
    return { close };
  }

  function parseDate(str) {
    if (!str) return null;
    if (str instanceof Date) return isNaN(str) ? null : str;
    const s = String(str);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
    return isNaN(d) ? null : d;
  }
  function relTime(str) {
    const d = parseDate(str);
    if (!d) return '';
    const hasTime = !(typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str));
    const now = new Date();
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(d) - day(now)) / 86400000);
    const time = hasTime ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
    let label;
    if (diff === 0) label = 'aujourd’hui';
    else if (diff === 1) label = 'demain';
    else if (diff === -1) label = 'hier';
    else if (diff === 2) label = 'après-demain';
    else if (diff > 2 && diff < 7) label = d.toLocaleDateString('fr-FR', { weekday: 'long' });
    else {
      const o = { weekday: 'short', day: 'numeric', month: 'short' };
      if (d.getFullYear() !== now.getFullYear()) o.year = 'numeric';
      label = d.toLocaleDateString('fr-FR', o);
    }
    return time ? `${label} ${time}` : label;
  }
  function ago(str) {
    const d = parseDate(str);
    if (!d) return '';
    const s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 45) return 'à l’instant';
    if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
    if (s < 7 * 86400) return `il y a ${plural(Math.round(s / 86400), 'jour', 'jours')}`;
    return 'le ' + d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }
  /* ---------- PC emprunté : mode invité et effacement ---------- */
  const isGuest = () => settings().rememberKeys === false;
  async function wipeDevice(opts) {
    opts = opts || {};
    if (opts.exportFirst) {
      const list = await S.store.list();
      if (list.length) {
        const payload = { format: 'souffleur-backup', version: 2, exportedAt: nowIso(), dossiers: list };
        download(new Blob([JSON.stringify(payload)], { type: 'application/json' }), `souffleur-sauvegarde-${new Date().toISOString().slice(0, 10)}.souffleur.json`);
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    if (typeof S.store.clearAll === 'function') await S.store.clearAll();
    for (const d of (await S.store.list()) || []) await S.store.remove(d.id);
    [window.localStorage, window.sessionStorage].forEach((stg) => {
      try { Object.keys(stg).filter((k) => /^souffleur/i.test(k)).forEach((k) => stg.removeItem(k)); } catch (e) { /* rien */ }
    });
    try { sessionStorage.clear(); } catch (e) { /* rien */ }
    toast('Vos données ont été effacées de ce PC.', 'ok');
    setTimeout(() => { location.hash = '#/'; location.reload(); }, 900);
  }
  function cleanupSheet() {
    return sheet({
      title: 'Effacer vos données de ce PC',
      body: `<p>Supprime de ce navigateur vos dossiers (CV, fiche de poste, préparation), les transcriptions, les récaps, les réglages et vos clés IA.</p>
        <p class="small muted">« Exporter puis tout effacer » télécharge d’abord une sauvegarde <b>.souffleur.json</b> : envoyez-la-vous ou copiez-la sur une clé USB, puis supprimez-la du dossier Téléchargements.</p>`,
      actions: [
        { label: 'Tout effacer', kind: 'danger', onClick: () => wipeDevice({}) },
        { label: 'Exporter puis tout effacer', kind: 'primary', onClick: () => wipeDevice({ exportFirst: true }) }
      ]
    });
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (er) { ok = false; }
      ta.remove();
      return ok;
    }
  }
  function pickFiles(o) {
    o = o || {};
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (o.accept) input.accept = o.accept;
      input.multiple = !!o.multiple;
      input.style.display = 'none';
      input.addEventListener('change', () => { resolve(Array.from(input.files || [])); input.remove(); });
      input.addEventListener('cancel', () => { resolve([]); input.remove(); });
      document.body.appendChild(input);
      input.click();
    });
  }
  function autosize(ta) {
    if (!ta || !ta.isConnected) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight + 2, 900) + 'px';
  }
  function hydrateIcons(root) { $$('[data-icon]', root).forEach((n) => { if (!n.firstChild) n.innerHTML = icon(n.dataset.icon); }); }

  function initials(name) {
    const w = String(name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    return ((w[0] || '?')[0] + (w[1] ? w[1][0] : (w[0] || '').slice(1, 2))).toUpperCase();
  }
  function hue(str) {
    let x = 0;
    for (const c of String(str || '')) x = (x * 31 + c.charCodeAt(0)) >>> 0;
    return [212, 228, 248, 266, 284, 196, 170, 330][x % 8];
  }
  const avatar = (name, cls) => `<span class="avatar ${cls || ''}" style="--hue:${hue(name)}" aria-hidden="true">${esc(initials(name))}</span>`;

  S.ui = Object.assign(S.ui || {}, {
    icon, h, sheet, confirm: confirmSheet, toast, relTime, ago, download, copy, pickFiles, autosize, esc, md, avatar, hydrateIcons
  });

  /* ====================================================================== *
   *  Thème, taille du texte, réseau
   * ====================================================================== */
  const darkMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function resolvedTheme() {
    const t = settings().theme;
    if (t === 'light' || t === 'dark') return t;
    return darkMQ && darkMQ.matches ? 'dark' : 'light';
  }
  function applyTheme() {
    const t = resolvedTheme();
    const docs = [document];
    if (L && L.pip && L.pip.win && !L.pip.win.closed) docs.push(L.pip.win.document);
    const scale = clamp(Number(settings().fontScale) || 1, 0.7, 2);
    docs.forEach((doc) => {
      doc.documentElement.dataset.theme = t;
      doc.documentElement.style.setProperty('--font-scale', String(scale));
    });
    $$('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', t === 'dark' ? '#000000' : '#f2f2f7'));
  }
  if (darkMQ && darkMQ.addEventListener) darkMQ.addEventListener('change', applyTheme);

  function updateNet() {
    const off = navigator.onLine === false;
    document.body.classList.toggle('is-offline', off);
    const p = document.getElementById('netpill');
    if (p) p.hidden = !off;
  }

  /* ====================================================================== *
   *  Installation PWA, service worker
   * ====================================================================== */
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvt = e;
    $$('.install-btn').forEach((b) => { b.hidden = false; });
  });
  window.addEventListener('appinstalled', () => {
    installEvt = null;
    $$('.install-btn').forEach((b) => { b.hidden = true; });
    toast('Souffleur est installé sur cet appareil.', 'ok');
  });
  async function installApp() {
    if (!installEvt) {
      sheet({
        title: 'Installer Souffleur',
        body: `<div class="stack"><p class="sheet-text">Dans Chrome ou Edge sur PC : menu ${icon('ellipsis', 'ico-inline')} puis <b>Installer Souffleur</b> (ou l’icône d’installation dans la barre d’adresse).</p><p class="sheet-text">Sur Android : menu ⋮ puis <b>Ajouter à l’écran d’accueil</b>.</p><p class="sheet-text muted">Sans installation, Souffleur fonctionne aussi dans un simple onglet, ou en fichier unique <b>souffleur.html</b>.</p></div>`,
        actions: [{ label: 'OK', kind: 'primary' }]
      });
      return;
    }
    installEvt.prompt();
    try { await installEvt.userChoice; } catch (e) { /* rien */ }
    installEvt = null;
    $$('.install-btn').forEach((b) => { b.hidden = true; });
  }

  let swReloadAsked = false;
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    if (location.protocol !== 'https:' && !local) return;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      const offer = (w) => { if (w && navigator.serviceWorker.controller) showUpdateBanner(w); };
      if (reg.waiting) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
      });
      setInterval(() => { reg.update().catch(() => {}); }, 30 * 60 * 1000);
    }).catch((e) => console.warn('[souffleur] service worker', e));
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!swReloadAsked) return;
      swReloadAsked = false;
      location.reload();
    });
  }
  function showUpdateBanner(worker) {
    const b = document.getElementById('update-banner');
    if (!b) return;
    b.innerHTML = `<span class="update-ic">${icon('sparkles')}</span><span class="update-text"><b>Nouvelle version disponible</b><span class="small muted">${L && L.running ? 'Rechargez après l’entretien.' : 'Recharger pour en profiter.'}</span></span><button type="button" class="btn btn-primary btn-sm">Recharger</button><button type="button" class="icon-btn icon-btn-sm" aria-label="Plus tard">${icon('xmark')}</button>`;
    b.hidden = false;
    requestAnimationFrame(() => b.classList.add('in'));
    $('.btn-primary', b).addEventListener('click', async () => {
      if (L && L.running && !(await confirmSheet({ title: 'Recharger maintenant ?', text: 'Un entretien est en cours : la session sera terminée et enregistrée.', okLabel: 'Recharger', danger: true }))) return;
      if (L && L.running) await finishLive();
      swReloadAsked = true;
      try { worker.postMessage({ type: 'SKIP_WAITING' }); worker.postMessage('SKIP_WAITING'); } catch (e) { /* rien */ }
      setTimeout(() => { if (swReloadAsked) location.reload(); }, 2500);
    });
    $('.icon-btn', b).addEventListener('click', () => { b.classList.remove('in'); setTimeout(() => { b.hidden = true; }, 250); });
  }

  /* ====================================================================== *
   *  Routeur
   * ====================================================================== */
  const routes = {};
  let current = null; // {name, params, def, hash}
  let routeSeq = 0;
  let booted = false;
  let bootHTML = '';

  function normHash(hash) {
    let x = String(hash == null ? '' : hash).trim();
    x = x.replace(/^#/, '').replace(/^\/+/, '');
    return '#/' + x;
  }
  function parseHash(hash) {
    const raw = String(hash == null ? location.hash : hash).replace(/^#\/?/, '');
    const qi = raw.indexOf('?');
    const path = qi >= 0 ? raw.slice(0, qi) : raw;
    const query = qi >= 0 ? raw.slice(qi + 1) : '';
    const parts = path.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch (e) { return p; } });
    const name = parts.shift() || '';
    const params = parts.slice();
    params.id = parts[0];
    params.sessionId = parts[1];
    params.query = {};
    try { new URLSearchParams(query).forEach((v, k) => { params.query[k] = v; }); } catch (e) { /* rien */ }
    return { name, params };
  }

  S.app = Object.assign(S.app || {}, {
    version: '2.0',
    register(name, def) {
      routes[String(name || '').replace(/^#?\/?/, '')] = def;
      if (booted && current && current.name === name) route(true);
    },
    go(hash) {
      const target = normHash(hash);
      if (location.hash === target || (target === '#/' && (location.hash === '' || location.hash === '#'))) route(true);
      else location.hash = target;
    },
    params() { return current ? current.params : parseHash().params; },
    current() { return current ? { name: current.name, params: current.params } : parseHash(); },
    refresh() { return route(true); },
    liveActive() { return !!(L && L.running); },
    isGuest,
    wipeDevice,
    cleanupSheet,
    install: installApp,
    canInstall() { return !!installEvt; },
    showUpdate(worker) { showUpdateBanner(worker || { postMessage() {} }); }
  });

  async function route(force) {
    const target = parseHash();
    const hash = location.hash || '#/';
    const seq = ++routeSeq;
    if (current && !force && current.hash === hash) return;
    if (current && current.def && current.def.canLeave && current.hash !== hash) {
      let ok = true;
      try { ok = await current.def.canLeave(target); } catch (e) { ok = true; }
      if (!ok) { history.replaceState(null, '', current.hash); return; }
      if (seq !== routeSeq) return;
    }
    // On attend la fin de l'enregistrement de l'écran quitté avant de relire les données.
    if (current && current.def && current.def.leave) { try { await current.def.leave(); } catch (e) { console.warn(e); } }
    if (seq !== routeSeq) return;
    const view = document.getElementById('view');
    if (!view) return;
    const def = routes[target.name];
    current = { name: target.name, params: target.params, def, hash };
    document.body.dataset.route = target.name || 'home';
    updateTabbar(target.name);
    const root = document.createElement('div');
    root.className = 'route';
    root.dataset.route = target.name || 'home';
    view.replaceChildren(root);
    window.scrollTo(0, 0);
    if (!def) {
      root.innerHTML = emptyScreen(['training', 'recap', 'settings', 'diag'].includes(target.name)
        ? { title: 'Écran indisponible', text: 'Cet écran n’a pas pu être chargé. Rechargez la page ; si le problème persiste, réinstallez Souffleur.', icon: 'warning' }
        : { title: 'Page introuvable', text: 'Ce lien ne correspond à aucun écran de Souffleur.', icon: 'info' });
      return;
    }
    try {
      await def.render(root, target.params);
    } catch (e) {
      console.error('[souffleur] écran', target.name, e);
      if (seq === routeSeq) root.innerHTML = emptyScreen({ title: 'Oups, cet écran a rencontré un problème', text: errMsg(e), icon: 'warning' });
    }
    if (seq === routeSeq) hydrateIcons(root);
  }

  function emptyScreen(o) {
    return `<div class="screen"><div class="empty empty-page card">
      <div class="empty-ic">${icon(o.icon || 'info')}</div>
      <h1 class="h2">${esc(o.title)}</h1>
      <p class="muted">${esc(o.text || '')}</p>
      <div class="row center"><button type="button" class="btn btn-primary" data-go="#/">${icon('home')}<span>Accueil</span></button></div>
    </div></div>`;
  }

  function updateTabbar(name) {
    const tab = name === '' ? 'home' : name;
    $$('#tabbar [data-tab]').forEach((a) => {
      const on = a.dataset.tab === tab || (a.dataset.tab === 'home' && (name === 'dossier' || name === 'recap'));
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  /* ====================================================================== *
   *  Données : dossiers
   * ====================================================================== */
  const KINDS = [
    { id: 'offre', label: 'Fiche de poste', short: 'Offre', icon: 'building', tone: 'blue' },
    { id: 'cv', label: 'CV', short: 'CV', icon: 'person', tone: 'green' },
    { id: 'prepa', label: 'Préparation', short: 'Prépa', icon: 'list', tone: 'orange' },
    { id: 'autre', label: 'Autre', short: 'Autre', icon: 'doc', tone: 'gray' }
  ];
  const kindOf = (id) => KINDS.find((k) => k.id === id) || KINDS[3];
  const MODES = [
    { id: 'visio', label: 'Visio', icon: 'video' },
    { id: 'tel', label: 'Téléphone', icon: 'phone' },
    { id: 'presentiel', label: 'Présentiel', icon: 'person2' }
  ];
  const modeOf = (id) => MODES.find((m) => m.id === id) || MODES[0];

  function normalizeDossier(d) {
    if (!d) return d;
    d.docs = Array.isArray(d.docs) ? d.docs : [];
    d.sessions = Array.isArray(d.sessions) ? d.sessions : [];
    if (d.prep) {
      const p = d.prep;
      p.questions = Array.isArray(p.questions) ? p.questions : [];
      ['askThem', 'keyFacts', 'watchouts'].forEach((k) => { if (!Array.isArray(p[k])) p[k] = p[k] ? [String(p[k])] : []; });
      p.questions.forEach((q) => { if (!q.id) q.id = uid(); if (!Array.isArray(q.tags)) q.tags = q.tags ? String(q.tags).split(',').map((t) => t.trim()).filter(Boolean) : []; });
      if (typeof p.pitch !== 'string') p.pitch = p.pitch ? String(p.pitch) : '';
    }
    return d;
  }
  const dTitle = (d) => (d && (d.company || d.name)) || 'Nouvel entretien';
  const autoName = (d) => [d.company, d.role].filter(Boolean).join(' · ') || d.name || 'Nouvel entretien';
  const prepCount = (d) => (d && d.prep && Array.isArray(d.prep.questions) ? d.prep.questions.length : 0);

  function prepPill(d) {
    const n = prepCount(d);
    if (n) return `<span class="pill pill-ok">${icon('check')}Prépa prête · ${n}</span>`;
    if (d.docs && d.docs.length) return `<span class="pill pill-warn">${icon('sparkles')}À préparer</span>`;
    return `<span class="pill">${icon('doc')}Documents à ajouter</span>`;
  }

  function makeSaver(d, delay) {
    let t = null;
    let pending = false;
    const flush = async () => {
      clearTimeout(t); t = null;
      if (!pending) return;
      pending = false;
      try { await S.store.save(d); } catch (e) { console.error(e); toast('Enregistrement impossible : ' + errMsg(e), 'err'); }
    };
    const fn = () => { pending = true; clearTimeout(t); t = setTimeout(flush, delay || 600); };
    fn.flush = flush;
    fn.cancel = () => { clearTimeout(t); t = null; pending = false; };
    return fn;
  }

  async function createDossier(partial) {
    let d = await S.store.create(Object.assign({ mode: 'visio' }, partial || {}));
    d.name = autoName(d);
    d = (await S.store.save(d)) || d;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* rien */ }
    return d;
  }

  function newDossierSheet() {
    const body = h(`<div class="stack">
      <div class="field"><label for="nd-company">Entreprise</label><input id="nd-company" type="text" autocomplete="off" placeholder="Ex. Ministère de la Transition écologique" autofocus></div>
      <div class="field"><label for="nd-role">Poste</label><input id="nd-role" type="text" autocomplete="off" placeholder="Ex. Responsable administratif et financier"></div>
      <div class="grid2">
        <div class="field"><label for="nd-date">Date et heure</label><input id="nd-date" type="datetime-local"></div>
        <div class="field"><label>Format</label><div class="seg seg-fill" data-mode>${MODES.map((m, i) => `<button type="button" data-v="${m.id}" class="${i === 0 ? 'on' : ''}">${esc(m.label)}</button>`).join('')}</div></div>
      </div>
    </div>`);
    let mode = 'visio';
    $$('[data-mode] button', body).forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.v;
      $$('[data-mode] button', body).forEach((x) => x.classList.toggle('on', x === b));
    }));
    sheet({
      title: 'Nouvel entretien',
      body,
      actions: [
        { label: 'Annuler', kind: 'ghost' },
        {
          label: 'Créer', kind: 'primary', onClick: async () => {
            const d = await createDossier({
              company: $('#nd-company', body).value.trim(),
              role: $('#nd-role', body).value.trim(),
              date: $('#nd-date', body).value || '',
              mode
            });
            S.app.go('#/dossier/' + d.id);
          }
        }
      ]
    });
  }

  async function importDossiers() {
    const files = await pickFiles({ accept: '.json,.souffleur,.souffleur.json,application/json', multiple: true });
    const last = await importDossierFiles(files);
    if (last) S.app.go('#/dossier/' + last.id);
  }

  /* ====================================================================== *
   *  Écran Accueil
   * ====================================================================== */
  function pickUpcoming(list) {
    const now = Date.now();
    const soon = list.map((d) => ({ d, t: parseDate(d.date) })).filter((x) => x.t && x.t.getTime() > now - 2 * 3600e3)
      .sort((a, b) => a.t - b.t);
    return soon.length ? soon[0].d : null;
  }

  function dossierCard(d) {
    const m = modeOf(d.mode);
    const when = relTime(d.date);
    return `<button type="button" class="dcard card" data-go="#/dossier/${esc(d.id)}">
      <div class="dcard-top">${avatar(d.company || d.name)}${prepPill(d)}</div>
      <div class="dcard-name">${esc(dTitle(d))}</div>
      <div class="dcard-role">${esc(d.role || 'Poste à préciser')}</div>
      <div class="dcard-meta">
        <span class="${when ? 'when' : 'when-none'}">${icon('calendar')}${esc(when || 'Date à fixer')}</span>
        <span>${icon(m.icon)}${esc(m.label)}</span>
        ${d.docs.length ? `<span>${icon('doc')}${d.docs.length}</span>` : ''}
      </div>
    </button>`;
  }

  async function renderHome(root) {
    const list = (await S.store.list()).map(normalizeDossier);
    const key = hasKey();
    const next = pickUpcoming(list);
    const version = ($('meta[name="souffleur-version"]') || {}).content;
    root.innerHTML = `<div class="screen home">
      <header class="home-head">
        <div class="brand">
          <div class="app-icon" aria-hidden="true">${icon('waveform')}</div>
          <div class="brand-text">
            <h1 class="h1">Souffleur</h1>
            <p class="home-sub">Votre copilote d’entretien, discret et instantané.</p>
          </div>
        </div>
        <div class="home-tools">
          ${isGuest() ? `<span class="pill pill-warn" title="Clés gardées jusqu’à la fermeture de l’onglet">${icon('shield')}Mode invité</span>` : ''}
          <button type="button" class="btn btn-sm install-btn" data-act="install"${installEvt ? '' : ' hidden'}>${icon('download')}<span>Installer l’app</span></button>
          <button type="button" class="icon-btn" data-act="import" title="Importer un dossier" aria-label="Importer un dossier">${icon('import')}</button>
          <button type="button" class="icon-btn hide-mobile" data-go="#/diag" title="Diagnostic" aria-label="Diagnostic">${icon('shield')}</button>
          <button type="button" class="icon-btn hide-mobile" data-go="#/settings" title="Réglages" aria-label="Réglages">${icon('gear')}</button>
        </div>
      </header>

      ${key ? '' : `<section class="banner card">
        <span class="banner-ic">${icon('sparkles')}</span>
        <div class="banner-text"><b>Activez l’IA en une minute</b><span>Une clé Gemini gratuite suffit pour préparer vos réponses et vous souffler en direct. Sans clé, vos réponses préparées et la transcription restent disponibles.</span></div>
        <button type="button" class="btn btn-primary btn-sm" data-go="#/settings">${icon('key')}<span>Ajouter une clé</span></button>
      </section>`}

      <div data-b="vault"></div>

      ${next ? `<section class="hero card">
        <div class="hero-glow" aria-hidden="true"></div>
        <div class="hero-main">
          <div class="eyebrow">${icon('calendar')}Prochain entretien · ${esc(relTime(next.date))}</div>
          <h2 class="hero-title">${esc(dTitle(next))}</h2>
          <p class="hero-role">${esc(next.role || 'Poste à préciser')}</p>
          <div class="row hero-pills">${prepPill(next)}<span class="pill">${icon(modeOf(next.mode).icon)}${esc(modeOf(next.mode).label)}</span>${next.interviewer ? `<span class="pill">${icon('person')}${esc(next.interviewer)}</span>` : ''}</div>
        </div>
        <div class="hero-cta">
          <button type="button" class="btn btn-primary btn-lg" data-go="#/live/${esc(next.id)}">${icon('play')}<span>Lancer l’entretien</span></button>
          <button type="button" class="btn btn-lg btn-glass" data-go="#/dossier/${esc(next.id)}">${icon('doc')}<span>Ouvrir le dossier</span></button>
        </div>
      </section>` : ''}

      <div class="section-head">
        <h2 class="h2">Entretiens${list.length ? ` <span class="count">${list.length}</span>` : ''}</h2>
        ${list.length ? `<button type="button" class="btn btn-primary" data-act="new">${icon('plus')}<span>Nouvel entretien</span></button>` : ''}
      </div>

      ${list.length ? `<div class="dgrid">${list.map(dossierCard).join('')}</div>` : `<section class="empty empty-home card">
        <div class="empty-art" aria-hidden="true">${icon('waveform')}</div>
        <h3 class="h2">Préparez votre premier entretien</h3>
        <p class="muted">Trois étapes, et Souffleur vous accompagne pendant l’appel.</p>
        <ol class="steps">
          <li><span class="step-n">1</span><span><b>Déposez vos documents</b><small>Fiche de poste, CV, fiche de préparation</small></span></li>
          <li><span class="step-n">2</span><span><b>L’IA prépare vos réponses</b><small>Pitch, questions probables, questions à poser</small></span></li>
          <li><span class="step-n">3</span><span><b>Lancez l’entretien</b><small>Réponses instantanées pendant Meet ou Teams</small></span></li>
        </ol>
        <div class="row center">
          <button type="button" class="btn btn-primary btn-lg" data-act="new">${icon('plus')}<span>Nouvel entretien</span></button>
          <button type="button" class="btn btn-lg" data-act="import">${icon('import')}<span>Importer un dossier</span></button>
        </div>
      </section>`}

      <footer class="home-foot">
        <span>${icon('lock')}Vos documents et vos clés restent sur cet appareil.</span>
        <button type="button" class="linklike" data-act="wipe">${icon('trash')}Effacer de ce PC</button>
        ${version ? `<span>Version ${esc(version)}</span>` : ''}
      </footer>
    </div>`;
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'new') newDossierSheet();
      else if (act === 'import') importDossiers();
      else if (act === 'install') installApp();
      else if (act === 'wipe') cleanupSheet();
    });
    bindHomeDrop(root);
    if (S.vault) S.vault.mount(root.querySelector('[data-b="vault"]'));
  }

  // Accueil : déposer un .souffleur.json l'importe ; déposer des documents crée un entretien avec ces documents.
  let homeOffs = [];
  let pendingDrop = null;
  function bindHomeDrop(root) {
    leaveHome();
    const hint = h(`<div class="drop-hint" aria-hidden="true"><div class="drop-hint-card glass">${icon('upload')}<b>Déposez vos fichiers</b><span>Documents : un nouvel entretien est créé · .souffleur.json : le dossier est importé</span></div></div>`);
    root.appendChild(hint);
    let depth = 0;
    const show = (on) => root.classList.toggle('dropping', on);
    const onEnter = (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; show(true); };
    const onOver = (e) => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
    const onLeave = () => { depth = Math.max(0, depth - 1); if (!depth) show(false); };
    const onDrop = async (e) => {
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      depth = 0; show(false);
      if (!files.length) return;
      e.preventDefault();
      const dossiers = files.filter(isDossierFile);
      const docs = files.filter((f) => !isDossierFile(f));
      if (dossiers.length) {
        const last = await importDossierFiles(dossiers);
        if (last && !docs.length) { S.app.go('#/dossier/' + last.id); return; }
      }
      if (!docs.length) return;
      const d = await createDossier({});
      pendingDrop = { id: d.id, files: docs };
      S.app.go('#/dossier/' + d.id);
    };
    [['dragenter', onEnter], ['dragover', onOver], ['dragleave', onLeave], ['drop', onDrop]].forEach(([t, fn]) => {
      document.addEventListener(t, fn);
      homeOffs.push(() => document.removeEventListener(t, fn));
    });
  }
  function leaveHome() {
    homeOffs.forEach((f) => { try { f(); } catch (e) { /* rien */ } });
    homeOffs = [];
  }
  const hasFiles = (e) => !!(e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files'));

  /* ====================================================================== *
   *  Écran Dossier
   * ====================================================================== */
  let DX = null; // contexte de l'écran dossier courant

  async function renderDossier(root, params) {
    if (params.id === 'new') {
      const d = await createDossier({});
      history.replaceState(null, '', '#/dossier/' + d.id);
      current.hash = location.hash;
      params.id = d.id;
      params[0] = d.id;
    }
    const d = normalizeDossier(params.id ? await S.store.get(params.id) : null);
    if (!d) { root.innerHTML = emptyScreen({ title: 'Dossier introuvable', text: 'Il a peut-être été supprimé de cet appareil.', icon: 'doc' }); return; }
    const save = makeSaver(d, 650);
    const ctx = DX = { d, root, save, pending: [], offs: [], generating: false, filter: '' };

    root.innerHTML = `<div class="screen dossier">
      <header class="topbar glass">
        <button type="button" class="icon-btn" data-go="#/" aria-label="Retour aux entretiens" title="Entretiens">${icon('chevron-left')}</button>
        <div class="topbar-title" data-b="title">${esc(dTitle(d))}</div>
        <div class="topbar-actions">
          <button type="button" class="icon-btn" data-act="export" title="Exporter" aria-label="Exporter">${icon('export')}</button>
          <button type="button" class="icon-btn" data-act="delete" title="Supprimer" aria-label="Supprimer le dossier">${icon('trash')}</button>
        </div>
      </header>

      <section class="dhero card">
        <div class="dhero-main">
          <span data-b="avatar">${avatar(d.company || d.name, 'avatar-lg')}</span>
          <div class="dhero-text">
            <h1 class="h1" data-b="company">${esc(dTitle(d))}</h1>
            <p class="dhero-role" data-b="role">${esc(d.role || 'Poste à préciser')}</p>
            <div class="row dhero-meta" data-b="meta"></div>
          </div>
        </div>
        <div class="dhero-side">
          <div class="dhero-cta" data-b="cta"></div>
          <div class="readiness" data-b="ready"></div>
        </div>
      </section>

      <div class="dlayout">
        <div class="dcol">
          <section class="card card-pad">
            <div class="card-head"><h2 class="h3">Documents</h2><span class="badge" data-b="doccount"></span></div>
            <div class="dz" tabindex="0" role="button" aria-label="Ajouter des documents">
              <div class="dz-ic">${icon('upload')}</div>
              <div class="dz-title">Glissez ici la fiche de poste, votre CV, votre fiche de préparation</div>
              <div class="dz-sub">PDF, Word, ODT, texte, image · ou cliquez · <span class="kbd">Ctrl</span>${NB}+${NB}<span class="kbd">V</span> pour coller</div>
            </div>
            <div class="row dz-tools">
              <button type="button" class="btn btn-sm" data-act="pick">${icon('upload')}<span>Choisir des fichiers</span></button>
              <button type="button" class="btn btn-sm" data-act="paste">${icon('clipboard')}<span>Coller du texte</span></button>
            </div>
            <div class="docs" data-b="docs"></div>
          </section>

          <section class="card card-pad">
            <div class="card-head"><h2 class="h3">Informations</h2></div>
            <div class="stack">
              <div class="field"><label for="f-company">Entreprise</label><input id="f-company" data-f="company" type="text" autocomplete="off" placeholder="Nom de l’entreprise" value="${esc(d.company || '')}"></div>
              <div class="field"><label for="f-role">Poste</label><input id="f-role" data-f="role" type="text" autocomplete="off" placeholder="Intitulé du poste" value="${esc(d.role || '')}"></div>
              <div class="grid2">
                <div class="field"><label for="f-interviewer">Recruteur</label><input id="f-interviewer" data-f="interviewer" type="text" autocomplete="off" placeholder="Nom, fonction" value="${esc(d.interviewer || '')}"></div>
                <div class="field"><label for="f-date">Date et heure</label><input id="f-date" data-f="date" type="datetime-local" value="${esc(d.date || '')}"></div>
              </div>
              <div class="field"><label>Format</label>
                <div class="seg seg-fill" data-b="mode">${MODES.map((m) => `<button type="button" data-v="${m.id}" class="${(d.mode || 'visio') === m.id ? 'on' : ''}">${icon(m.icon)}<span>${esc(m.label)}</span></button>`).join('')}</div>
              </div>
              <div class="field"><label for="f-notes">Notes</label><textarea id="f-notes" data-f="notes" class="autosize" rows="2" placeholder="Lien de la visio, contexte, points à ne pas oublier…">${esc(d.notes || '')}</textarea></div>
            </div>
          </section>

          <section class="card card-pad" data-b="sessions" hidden></section>
        </div>

        <section class="card card-pad prep-card" data-b="prep"></section>
      </div>
    </div>`;

    const B = (k) => $(`[data-b="${k}"]`, root);
    ctx.B = B;
    paintDossierHead(ctx);
    paintDocs(ctx);
    paintPrep(ctx);
    paintSessions(ctx);
    $$('textarea.autosize', root).forEach(autosize);
    if (pendingDrop && pendingDrop.id === d.id) { const files = pendingDrop.files; pendingDrop = null; addFiles(ctx, files); }

    // Champs d'informations
    root.addEventListener('input', (e) => {
      const t = e.target;
      if (t.matches('textarea.autosize')) autosize(t);
      const f = t.dataset.f;
      if (!f || !['company', 'role', 'interviewer', 'date', 'notes'].includes(f)) return;
      d[f] = f === 'notes' ? t.value : t.value.trim();
      d.name = autoName(d);
      if (['company', 'role', 'date', 'interviewer'].includes(f)) paintDossierHead(ctx);
      save();
    });
    $$('[data-b="mode"] button', root).forEach((b) => b.addEventListener('click', () => {
      d.mode = b.dataset.v;
      $$('[data-b="mode"] button', root).forEach((x) => x.classList.toggle('on', x === b));
      paintDossierHead(ctx);
      save();
    }));

    // Actions
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || !root.contains(b)) return;
      const act = b.dataset.act;
      if (act === 'export') exportSheet(d);
      else if (act === 'delete') {
        if (await confirmSheet({ title: 'Supprimer ce dossier ?', text: `« ${dTitle(d)} », ses documents, sa préparation et ses sessions seront effacés de cet appareil.`, okLabel: 'Supprimer', danger: true })) {
          save.cancel();
          await S.store.remove(d.id);
          toast('Dossier supprimé.', 'ok');
          S.app.go('#/');
        }
      } else if (act === 'pick') {
        const files = await pickFiles({ accept: (S.docs && S.docs.accept) || '', multiple: true });
        addFiles(ctx, files);
      } else if (act === 'paste') pasteSheet(ctx);
    });

    // Zone de dépôt
    const dz = $('.dz', root);
    dz.addEventListener('click', async () => addFiles(ctx, await pickFiles({ accept: (S.docs && S.docs.accept) || '', multiple: true })));
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dz.click(); } });
    let depth = 0;
    const onDragEnter = (e) => { if (!hasFilesOrText(e)) return; e.preventDefault(); depth++; root.classList.add('dragging'); };
    const onDragOver = (e) => { if (!hasFilesOrText(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; dz.classList.toggle('over', dz.contains(e.target)); };
    const onDragLeave = () => { depth = Math.max(0, depth - 1); if (!depth) { root.classList.remove('dragging'); dz.classList.remove('over'); } };
    const onDrop = (e) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      depth = 0; root.classList.remove('dragging'); dz.classList.remove('over');
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length) addFiles(ctx, files);
      else {
        const text = e.dataTransfer.getData('text/plain');
        if (text && text.trim()) addText(ctx, text, 'Texte déposé');
      }
    };
    const onPaste = (e) => {
      if (isTyping(e.target) || topSheetLayer()) return;
      const cd = e.clipboardData;
      if (!cd) return;
      const files = Array.from(cd.files || []);
      if (files.length) { e.preventDefault(); addFiles(ctx, files.map((f, i) => (f.name && f.name !== 'image.png') ? f : renameFile(f, `Capture collée ${i + 1}.png`))); return; }
      const text = cd.getData('text/plain');
      if (text && text.trim().length > 3) { e.preventDefault(); addText(ctx, text, 'Texte collé'); }
    };
    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    document.addEventListener('paste', onPaste);
    ctx.offs.push(() => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
      document.removeEventListener('paste', onPaste);
    });
  }

  function leaveDossier() {
    if (!DX) return null;
    const ctx = DX;
    DX = null;
    ctx.offs.forEach((f) => { try { f(); } catch (e) { /* rien */ } });
    return ctx.save.flush();
  }

  const hasFilesOrText = (e) => {
    const types = e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types) : [];
    return types.includes('Files') || types.includes('text/plain');
  };
  function renameFile(f, name) { try { return new File([f], name, { type: f.type }); } catch (e) { return f; } }

  function paintDossierHead(ctx) {
    const { d, B } = ctx;
    B('title').textContent = dTitle(d);
    B('company').textContent = dTitle(d);
    B('role').textContent = d.role || 'Poste à préciser';
    B('avatar').innerHTML = avatar(d.company || d.name, 'avatar-lg');
    const m = modeOf(d.mode);
    const when = relTime(d.date);
    B('meta').innerHTML = `${when ? `<span class="pill pill-accent">${icon('calendar')}${esc(when)}</span>` : `<span class="pill">${icon('calendar')}Date à fixer</span>`}
      <span class="pill">${icon(m.icon)}${esc(m.label)}</span>
      ${d.interviewer ? `<span class="pill">${icon('person')}${esc(d.interviewer)}</span>` : ''}`;
    paintReadiness(ctx);
  }

  function paintReadiness(ctx) {
    const { d, B } = ctx;
    const n = prepCount(d);
    const key = hasKey();
    const item = (ok, warn, ic, label) => `<span class="ready-item ${ok ? 'ok' : warn ? 'warn' : ''}"><span class="ready-dot">${icon(ok ? 'check' : warn ? 'warning' : ic)}</span>${label}</span>`;
    B('ready').innerHTML = item(d.docs.length > 0, false, 'doc', d.docs.length ? plural(d.docs.length, 'document', 'documents') : 'Aucun document')
      + item(n > 0, false, 'sparkles', n ? `${n} réponses prêtes` : 'Prépa à faire')
      + item(key, !key, 'key', key ? 'IA prête' : 'Sans clé IA');
    // Prochaine étape logique en bouton principal : préparer tant qu'il n'y a pas de prépa, sinon lancer.
    const cta = B('cta');
    if (cta) {
      const live = `<button type="button" class="btn ${n ? 'btn-primary ' : ''}btn-lg" data-go="#/live/${esc(d.id)}">${icon('play')}<span>Lancer l’entretien</span></button>`;
      const train = `<button type="button" class="btn btn-lg" data-go="#/training/${esc(d.id)}">${icon('graduation')}<span>S’entraîner</span></button>`;
      const prep = `<button type="button" class="btn btn-primary btn-lg" data-cta="prep"${d.docs.length ? '' : ' disabled title="Ajoutez d’abord vos documents"'}>${icon('sparkles')}<span>Préparer avec l’IA</span></button>`;
      const meet = d.meetUrl ? `<a class="btn btn-lg" href="${esc(d.meetUrl)}" target="_blank" rel="noopener noreferrer">${icon('video')}<span>Visio</span></a>` : '';
      cta.innerHTML = (n ? live + train : (key ? prep : '') + live) + meet;
      const pb = cta.querySelector('[data-cta="prep"]');
      if (pb) pb.addEventListener('click', () => { const g = ctx.B('prep') && ctx.B('prep').querySelector('[data-pact="gen"]'); if (g) { g.scrollIntoView({ behavior: 'smooth', block: 'center' }); g.click(); } });
    }
    B('doccount').textContent = d.docs.length ? String(d.docs.length) : '';
    B('doccount').hidden = !d.docs.length;
  }

  // Ouvre le fichier d'origine (PDF mis en forme) dans un nouvel onglet.
  function openDocFile(doc) {
    try {
      const bin = atob(doc.file.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: doc.file.mime || 'application/pdf' }));
      const w = window.open(url, '_blank');
      if (w) w.opener = null;
      if (!w) S.util.download(new Blob([bytes], { type: doc.file.mime }), doc.file.name);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { toast('Impossible d’ouvrir ce fichier : ' + errMsg(e), 'err'); }
  }

  function paintDocs(ctx) {
    const { d, B } = ctx;
    const el = B('docs');
    const rows = d.docs.map((doc) => {
      const k = kindOf(doc.kind);
      const len = (doc.text || '').length;
      return `<div class="doc-row" data-id="${esc(doc.id)}">
        <span class="tile tile-${k.tone}">${icon(k.icon)}</span>
        <div class="doc-main">
          <div class="doc-name" title="${esc(doc.name)}">${esc(doc.name || 'Document')}</div>
          <div class="doc-meta">${len.toLocaleString('fr-FR')} caractères${doc.method ? ' · ' + esc(methodLabel(doc.method)) : ''}</div>
        </div>
        <label class="kind-select tone-${k.tone}" title="Type de document">
          <select data-doc-kind aria-label="Type de document">${KINDS.map((x) => `<option value="${x.id}"${x.id === k.id ? ' selected' : ''}>${esc(x.short)}</option>`).join('')}</select>${icon('chevron-down')}
        </label>
        ${doc.file ? `<button type="button" class="btn btn-sm doc-pdf" data-doc="pdf" title="Ouvrir le document d’origine, mis en forme">${icon('doc')}<span>PDF</span></button>` : ''}
        <button type="button" class="icon-btn icon-btn-sm" data-doc="view" title="Aperçu et correction" aria-label="Aperçu">${icon('eye')}</button>
        <button type="button" class="icon-btn icon-btn-sm" data-doc="del" title="Retirer" aria-label="Retirer le document">${icon('trash')}</button>
      </div>`;
    });
    const pend = ctx.pending.map((p) => `<div class="doc-row pending"><span class="tile tile-gray"><span class="spinner"></span></span><div class="doc-main"><div class="doc-name">${esc(p.name)}</div><div class="doc-meta">Lecture en cours…</div></div></div>`);
    el.innerHTML = rows.concat(pend).join('') || '';
    el.hidden = !rows.length && !pend.length;
    $$('[data-doc-kind]', el).forEach((s) => s.addEventListener('change', () => {
      const doc = d.docs.find((x) => x.id === s.closest('.doc-row').dataset.id);
      if (!doc) return;
      doc.kind = s.value;
      ctx.save();
      paintDocs(ctx);
    }));
    $$('[data-doc]', el).forEach((b) => b.addEventListener('click', async () => {
      const doc = d.docs.find((x) => x.id === b.closest('.doc-row').dataset.id);
      if (!doc) return;
      if (b.dataset.doc === 'del') {
        if (!(await confirmSheet({ title: 'Retirer ce document ?', text: `« ${doc.name} » sera retiré du dossier.`, okLabel: 'Retirer', danger: true }))) return;
        d.docs = d.docs.filter((x) => x !== doc);
        ctx.save(); paintDocs(ctx); paintReadiness(ctx); refreshPrepState(ctx);
      } else if (b.dataset.doc === 'pdf') openDocFile(doc);
      else docSheet(ctx, doc);
    }));
    paintReadiness(ctx);
  }

  function methodLabel(m) {
    return ({ text: 'texte', docx: 'Word', odt: 'ODT', pdfjs: 'PDF', ai: 'lu par l’IA', html: 'HTML', rtf: 'RTF', paste: 'collé' })[m] || m;
  }

  const isDossierFile = (f) => /\.souffleur(\.json)?$/i.test((f && f.name) || '');
  async function importDossierFiles(files) {
    let last = null;
    for (const f of files) {
      try {
        last = await S.store.importFile(f);
        toast(`Dossier « ${dTitle(last)} » importé.`, 'ok');
      } catch (e) { toast(`${f.name}${NB}: ${errMsg(e)}`, 'err'); }
    }
    return last;
  }

  async function addFiles(ctx, files) {
    files = (files || []).filter(Boolean);
    // Un export .souffleur.json n'est pas un document : on l'importe comme dossier.
    const dossierFiles = files.filter(isDossierFile);
    if (dossierFiles.length) {
      files = files.filter((f) => !isDossierFile(f));
      const last = await importDossierFiles(dossierFiles);
      if (last && !files.length) { S.app.go('#/dossier/' + last.id); return; }
    }
    if (!files.length) return;
    if (!S.docs || !S.docs.extract) { toast('Module de lecture des documents indisponible.', 'err'); return; }
    await Promise.all(files.map(async (f) => {
      const p = { id: uid(), name: f.name || 'Document' };
      ctx.pending.push(p); paintDocs(ctx);
      try {
        const r = await S.docs.extract(f, f.name);
        const text = (r && r.text) || '';
        if (!text.trim()) throw new Error('aucun texte trouvé dans ce fichier.');
        const kind = S.docs.guessKind ? S.docs.guessKind(f.name || '', text) : 'autre';
        const doc = { id: uid(), kind, name: f.name || 'Document', text, method: r.method, addedAt: nowIso() };
        // PDF : on garde aussi l'original mis en forme pour le consulter tel quel.
        if (/pdf$/i.test(f.type || '') || /\.pdf$/i.test(f.name || '')) {
          if (f.size <= 8 * 1024 * 1024) {
            const buf = new Uint8Array(await f.arrayBuffer());
            let bin = '';
            for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
            doc.file = { name: f.name, mime: 'application/pdf', data: btoa(bin) };
          }
        }
        ctx.d.docs.push(doc);
        if (r.warning) toast(`${f.name}${NB}: ${r.warning}`, 'warn');
        else toast(`« ${f.name} » ajouté · ${kindOf(kind).label}`, 'ok');
      } catch (e) {
        toast(`${f.name || 'Fichier'}${NB}: ${errMsg(e)}`, 'err', { duration: 9000 });
      } finally {
        ctx.pending = ctx.pending.filter((x) => x !== p);
        if (DX === ctx) { paintDocs(ctx); refreshPrepState(ctx); }
        ctx.save();
      }
    }));
  }

  function addText(ctx, text, name, kind) {
    const r = S.docs && S.docs.fromText ? S.docs.fromText(text, name) : { text: String(text), method: 'paste' };
    const clean = (r && r.text) || '';
    if (!clean.trim()) { toast('Le texte est vide.', 'warn'); return; }
    const k = kind || (S.docs && S.docs.guessKind ? S.docs.guessKind(name || '', clean) : 'autre');
    ctx.d.docs.push({ id: uid(), kind: k, name: name || 'Texte collé', text: clean, method: 'paste', addedAt: nowIso() });
    ctx.save();
    paintDocs(ctx); refreshPrepState(ctx);
    toast(`Texte ajouté · ${kindOf(k).label}`, 'ok');
  }

  function kindSeg(selected) {
    return `<div class="seg seg-fill" data-kind>${KINDS.map((k) => `<button type="button" data-v="${k.id}" class="${k.id === selected ? 'on' : ''}">${esc(k.short)}</button>`).join('')}</div>`;
  }
  function bindSeg(root, sel, cb) {
    $$(`${sel} button`, root).forEach((b) => b.addEventListener('click', () => {
      $$(`${sel} button`, root).forEach((x) => x.classList.toggle('on', x === b));
      cb(b.dataset.v);
    }));
  }

  function pasteSheet(ctx) {
    let kind = '';
    const body = h(`<div class="stack">
      <div class="field"><label for="ps-text">Texte</label><textarea id="ps-text" rows="10" placeholder="Collez ici l’annonce, votre CV ou vos notes de préparation…" autofocus></textarea></div>
      <div class="grid2">
        <div class="field"><label for="ps-name">Nom</label><input id="ps-name" type="text" placeholder="Texte collé"></div>
        <div class="field"><label>Type</label>${kindSeg('')}</div>
      </div>
      <p class="small muted">Le type est détecté automatiquement si vous ne le choisissez pas.</p>
    </div>`);
    bindSeg(body, '[data-kind]', (v) => { kind = v; });
    sheet({
      title: 'Coller du texte', body, wide: true,
      actions: [
        { label: 'Annuler', kind: 'ghost' },
        {
          label: 'Ajouter', kind: 'primary', onClick: () => {
            const text = $('#ps-text', body).value;
            if (!text.trim()) { toast('Collez d’abord un texte.', 'warn'); return false; }
            addText(ctx, text, $('#ps-name', body).value.trim() || 'Texte collé', kind || undefined);
          }
        }
      ]
    });
  }

  function docSheet(ctx, doc) {
    let kind = doc.kind;
    const body = h(`<div class="stack">
      <div class="grid2">
        <div class="field"><label for="dv-name">Nom</label><input id="dv-name" type="text" value="${esc(doc.name || '')}"></div>
        <div class="field"><label>Type</label>${kindSeg(doc.kind)}</div>
      </div>
      <div class="field"><label for="dv-text">Texte extrait <span class="muted">(corrigez-le si besoin)</span></label><textarea id="dv-text" class="doc-text" rows="16">${esc(doc.text || '')}</textarea></div>
    </div>`);
    bindSeg(body, '[data-kind]', (v) => { kind = v; });
    sheet({
      title: 'Document', body, wide: true,
      actions: [
        { label: 'Fermer', kind: 'ghost' },
        {
          label: 'Enregistrer', kind: 'primary', onClick: () => {
            doc.name = $('#dv-name', body).value.trim() || doc.name;
            doc.text = $('#dv-text', body).value;
            doc.kind = kind;
            ctx.save(); paintDocs(ctx);
            toast('Document mis à jour.', 'ok');
          }
        }
      ]
    });
  }

  function paintSessions(ctx) {
    const { d, B } = ctx;
    const el = B('sessions');
    const list = d.sessions.slice().sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    el.hidden = !list.length;
    if (!list.length) return;
    el.innerHTML = `<div class="card-head"><h2 class="h3">Historique</h2><span class="badge">${list.length}</span></div>
      <div class="list">${list.map((s) => {
        const dur = s.endedAt && s.startedAt ? (parseDate(s.endedAt) - parseDate(s.startedAt)) : 0;
        const training = s.kind === 'training';
        return `<button type="button" class="list-row" data-go="#/recap/${esc(d.id)}/${esc(s.id)}">
          <span class="tile tile-${training ? 'violet' : 'blue'}">${icon(training ? 'graduation' : 'waveform')}</span>
          <span class="list-main"><b>${training ? 'Entraînement' : 'Entretien'} · ${esc(relTime(s.startedAt))}</b>
          <small>${dur > 0 ? Math.max(1, Math.round(dur / 60000)) + ' min · ' : (s.endedAt ? '' : 'interrompu · ')}${plural((s.answers || []).length, 'réponse', 'réponses')}${s.recap ? ' · récap prêt' : ''}</small></span>
          ${icon('chevron-right', 'chev')}
        </button>`;
      }).join('')}</div>`;
  }

  /* ---------- Préparation ---------- */
  const PREP_STEP = { context: 'Lecture des documents…', generating: 'Rédaction des questions et des réponses…', parsing: 'Vérification…', retry: 'Nouvel essai…', done: 'Terminé' };
  function progressInfo(x) {
    if (x == null) return {};
    if (typeof x === 'number') return { pct: x > 1 ? x / 100 : x };
    if (typeof x === 'string') return { label: x };
    const pct = x.pct != null ? x.pct : x.progress != null ? x.progress : x.percent != null ? x.percent : null;
    return {
      pct: pct == null ? null : (pct > 1 ? pct / 100 : pct),
      label: x.label || x.message || PREP_STEP[x.step] || PREP_STEP[x.status] || '',
      chars: x.text ? x.text.length : (x.chars || null)
    };
  }

  function paintPrep(ctx) {
    const { d, B } = ctx;
    const el = B('prep');
    if (!el) return;
    if (ctx.generating) {
      el.innerHTML = `<div class="prep-gen">
        <div class="prep-gen-art" aria-hidden="true">${icon('sparkles')}</div>
        <h2 class="h3">Préparation en cours…</h2>
        <p class="muted" data-b="gen-label">L’IA lit vos documents et rédige vos réponses. Comptez 20 à 60 secondes.</p>
        <div class="meter meter-lg" data-b="gen-meter"><i style="--v:.04"></i></div>
        <p class="small muted" data-b="gen-chars"></p>
      </div>`;
      return;
    }
    if (!d.prep) {
      const noDocs = !d.docs.length;
      el.innerHTML = `<div class="prep-empty">
        <div class="prep-art" aria-hidden="true">${icon('sparkles')}</div>
        <h2 class="h2">Préparation par l’IA</h2>
        <p class="muted">À partir de vos documents, Souffleur rédige votre pitch de 60 secondes, une vingtaine de questions probables avec des réponses tirées de votre CV, les questions à poser au recruteur et les points de vigilance. Tout reste modifiable.</p>
        <div class="row center">
          <button type="button" class="btn btn-primary btn-lg" data-pact="gen"${noDocs ? ' disabled' : ''}>${icon('sparkles')}<span>Préparer avec l’IA</span></button>
          <button type="button" class="btn btn-lg" data-pact="manual">${icon('edit')}<span>Rédiger moi-même</span></button>
        </div>
        ${noDocs ? '<p class="small muted">Ajoutez d’abord au moins la fiche de poste ou votre CV.</p>' : hasKey() ? '' : '<p class="small muted">Une clé IA est nécessaire : ajoutez-la dans les Réglages.</p>'}
      </div>`;
      bindPrepActions(ctx, el);
      return;
    }
    const p = d.prep;
    el.innerHTML = `<div class="card-head">
        <h2 class="h3">Préparation</h2>
        <span class="small muted">${p.generatedAt ? esc(ago(p.generatedAt)) : ''}${p.model && p.model !== 'manuel' ? ' · ' + esc(shortModel(p.model)) : ''}</span>
        <span class="spacer"></span>
        <button type="button" class="btn btn-sm" data-pact="gen"${d.docs.length ? '' : ' disabled'}>${icon('refresh')}<span>Régénérer</span></button>
      </div>
      <div class="prep-block">
        <div class="prep-label">${icon('quote')}Pitch · 60 secondes</div>
        ${mdEdit(p.pitch, 'data-p="pitch"', 'Votre présentation en une minute…', 4, 'prep-pitch')}
      </div>
      <div class="prep-block">
        <div class="prep-label-row">
          <div class="prep-label">${icon('chat')}Questions probables <span class="badge" data-b="qcount">${p.questions.length}</span></div>
          <label class="search"><span>${icon('search')}</span><input type="search" data-b="qfilter" placeholder="Filtrer" value="${esc(ctx.filter)}" aria-label="Filtrer les questions"></label>
          <button type="button" class="btn btn-sm" data-pact="addq">${icon('plus')}<span>Ajouter</span></button>
        </div>
        <div class="qa-list" data-b="qa"></div>
      </div>
      <div class="prep-lists">
        ${listEditor('askThem', 'Questions à poser', 'person2', p.askThem, 'Une question par ligne')}
        ${listEditor('keyFacts', 'Chiffres clés', 'bolt', p.keyFacts, 'Un chiffre ou fait par ligne')}
        ${listEditor('watchouts', 'Points de vigilance', 'warning', p.watchouts, 'Un point par ligne')}
      </div>`;
    paintQA(ctx);
    bindMdEdit(el);
    $$('textarea.autosize', el).forEach(autosize);
    bindPrepActions(ctx, el);
    $('[data-p="pitch"]', el).addEventListener('input', (e) => { p.pitch = e.target.value; ctx.save(); });
    $$('[data-list]', el).forEach((ta) => ta.addEventListener('input', () => {
      p[ta.dataset.list] = ta.value.split('\n').map((s) => s.replace(/^\s*[-•·]\s*/, '').trim()).filter(Boolean);
      ctx.save();
    }));
    $('[data-b="qfilter"]', el).addEventListener('input', (e) => { ctx.filter = e.target.value; paintQA(ctx); });
  }

  // Met à jour l'état des boutons de préparation sans redessiner l'éditeur (évite de perdre le focus).
  function refreshPrepState(ctx) {
    if (!ctx.d.prep && !ctx.generating) { paintPrep(ctx); return; }
    $$('[data-pact="gen"]', ctx.B('prep')).forEach((b) => { b.disabled = !ctx.d.docs.length; });
  }

  // Texte markdown affiché mis en forme ; un clic le rend modifiable (retour à l'aperçu en quittant le champ).
  function mdEdit(value, attrs, ph, rows, cls) {
    const v = String(value || '');
    return `<div class="mdedit${v.trim() ? '' : ' editing'}">
      <div class="mdedit-view md sf" tabindex="0" role="button" title="Cliquer pour modifier">${v.trim() ? md(v) : ''}</div>
      <textarea class="input autosize mdedit-input ${cls || ''}" ${attrs} rows="${rows || 4}" placeholder="${esc(ph || '')}">${esc(v)}</textarea>
    </div>`;
  }
  function bindMdEdit(root) {
    $$('.mdedit', root).forEach((box) => {
      if (box.dataset.bound) return;
      box.dataset.bound = '1';
      const view = $('.mdedit-view', box), ta = $('.mdedit-input', box);
      const edit = () => { box.classList.add('editing'); autosize(ta); ta.focus(); };
      view.addEventListener('click', (e) => { if (!e.target.closest('a')) edit(); });
      view.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit(); } });
      ta.addEventListener('blur', () => {
        if (!ta.value.trim()) return;
        view.innerHTML = md(ta.value);
        box.classList.remove('editing');
      });
    });
  }

  function listEditor(key, label, ic, arr, ph) {
    return `<div class="prep-block"><div class="prep-label">${icon(ic)}${esc(label)}</div>
      <textarea class="input autosize" data-list="${key}" rows="3" placeholder="${esc(ph)}">${esc((arr || []).join('\n'))}</textarea></div>`;
  }

  function paintQA(ctx) {
    const { d, B } = ctx;
    const el = B('qa');
    if (!el || !d.prep) return;
    const f = normTxt(ctx.filter || '');
    const qs = d.prep.questions;
    const visible = qs.filter((q) => !f || normTxt(q.q + ' ' + q.a + ' ' + (q.tags || []).join(' ')).includes(f));
    const cnt = B('qcount');
    if (cnt) cnt.textContent = String(qs.length);
    if (!visible.length) {
      el.innerHTML = `<div class="empty empty-sm"><p class="muted">${qs.length ? 'Aucune question ne correspond au filtre.' : 'Aucune question pour l’instant. Ajoutez-en une ou lancez la préparation par l’IA.'}</p></div>`;
      return;
    }
    el.innerHTML = visible.map((q) => {
      const i = qs.indexOf(q);
      return `<details class="qa" data-qid="${esc(q.id)}"${q._open ? ' open' : ''}>
        <summary>
          <span class="qa-n">${i + 1}</span>
          <span class="qa-sum"><span class="qa-q">${esc(q.q || 'Nouvelle question')}</span><span class="qa-a">${esc(firstLine(q.a))}</span></span>
          ${(q.tags || []).slice(0, 2).map((t) => `<span class="pill pill-xs">${esc(t)}</span>`).join('')}
          ${icon('chevron-down', 'chev')}
        </summary>
        <div class="qa-body">
          <div class="field"><label>Question</label><input type="text" data-k="q" value="${esc(q.q || '')}" placeholder="Question du recruteur"></div>
          <div class="field"><label>Réponse <span class="muted">· cliquez pour modifier (phrase clé en **gras**, puis puces « - »)</span></label>${mdEdit(q.a, 'data-k="a"', 'Réponse que vous voulez voir s’afficher', 4, '')}</div>
          <div class="row qa-foot">
            <div class="field grow"><label>Mots-clés</label><input type="text" data-k="tags" value="${esc((q.tags || []).join(', '))}" placeholder="motivation, technique…"></div>
            <button type="button" class="btn btn-sm btn-danger" data-qdel>${icon('trash')}<span>Supprimer</span></button>
          </div>
        </div>
      </details>`;
    }).join('');
    bindMdEdit(el);
    $$('details.qa', el).forEach((det) => {
      const q = qs.find((x) => x.id === det.dataset.qid);
      det.addEventListener('toggle', () => {
        Object.defineProperty(q, '_open', { value: det.open, enumerable: false, writable: true, configurable: true });
        if (det.open) $$('textarea.autosize', det).forEach(autosize);
      });
      $$('[data-k]', det).forEach((inp) => inp.addEventListener('input', () => {
        const k = inp.dataset.k;
        if (k === 'tags') q.tags = inp.value.split(',').map((t) => t.trim()).filter(Boolean);
        else q[k] = inp.value;
        if (k === 'q') $('.qa-q', det).textContent = q.q || 'Nouvelle question';
        if (k === 'a') $('.qa-a', det).textContent = firstLine(q.a);
        ctx.save();
      }));
      $('[data-qdel]', det).addEventListener('click', async () => {
        if (!(await confirmSheet({ title: 'Supprimer cette question ?', text: q.q || '', okLabel: 'Supprimer', danger: true }))) return;
        d.prep.questions = qs.filter((x) => x !== q);
        ctx.save(); paintQA(ctx); paintReadiness(ctx);
      });
    });
  }
  const firstLine = (s) => String(s || '').split('\n').map((x) => x.replace(/[*_#`>-]/g, '').trim()).find(Boolean) || '';

  function bindPrepActions(ctx, el) {
    $$('[data-pact]', el).forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.pact;
      if (a === 'gen') generatePrep(ctx);
      else if (a === 'manual') {
        ctx.d.prep = { pitch: '', questions: [], askThem: [], keyFacts: [], watchouts: [], generatedAt: nowIso(), model: 'manuel' };
        ctx.save(); paintPrep(ctx); paintReadiness(ctx);
      } else if (a === 'addq') {
        const q = { id: uid(), q: '', a: '', tags: [] };
        Object.defineProperty(q, '_open', { value: true, enumerable: false, writable: true, configurable: true });
        ctx.d.prep.questions.unshift(q);
        ctx.filter = '';
        const fi = ctx.B('qfilter'); if (fi) fi.value = '';
        ctx.save(); paintQA(ctx); paintReadiness(ctx);
        const inp = $(`details[data-qid="${q.id}"] input[data-k="q"]`, ctx.root);
        if (inp) inp.focus();
      }
    }));
  }

  async function generatePrep(ctx) {
    const d = ctx.d;
    if (!d.docs.length) { toast('Ajoutez d’abord la fiche de poste ou votre CV.', 'warn'); return; }
    if (!hasKey() || !S.ai || !S.ai.buildPrep) {
      sheet({
        title: 'Clé IA nécessaire',
        body: `<p class="sheet-text">La préparation automatique utilise Gemini (gratuit avec une clé Google AI Studio) ou Claude. Ajoutez une clé dans les Réglages : cela prend une minute.</p>`,
        actions: [{ label: 'Plus tard', kind: 'ghost' }, { label: 'Ouvrir les Réglages', kind: 'primary', onClick: () => S.app.go('#/settings') }]
      });
      return;
    }
    if (navigator.onLine === false) { toast('Pas de connexion internet : la préparation par l’IA est impossible pour l’instant.', 'warn'); return; }
    if (d.prep && (d.prep.questions.length || d.prep.pitch) && !(await confirmSheet({ title: 'Régénérer la préparation ?', text: 'La préparation actuelle et vos modifications seront remplacées.', okLabel: 'Régénérer', danger: true }))) return;
    ctx.generating = true;
    paintPrep(ctx);
    const t0 = Date.now();
    let fake = 0.04;
    const tick = setInterval(() => {
      fake = Math.min(0.9, fake + (0.92 - fake) * 0.035);
      const m = ctx.B('gen-meter');
      if (m && !m.dataset.real) m.firstElementChild.style.setProperty('--v', fake.toFixed(3));
    }, 400);
    try {
      ctx.save.flush();
      const prep = await S.ai.buildPrep(d, {
        onProgress: (x) => {
          const pi = progressInfo(x);
          if (DX !== ctx) return;
          const m = ctx.B('gen-meter'), lab = ctx.B('gen-label'), ch = ctx.B('gen-chars');
          if (m && pi.pct != null) { m.dataset.real = '1'; m.firstElementChild.style.setProperty('--v', clamp(pi.pct, 0.03, 1).toFixed(3)); }
          if (lab && pi.label) lab.textContent = pi.label;
          if (ch && pi.chars) ch.textContent = `${pi.chars.toLocaleString('fr-FR')} caractères rédigés`;
        }
      });
      if (!prep) throw new Error('réponse vide de l’IA.');
      d.prep = prep;
      if (!d.prep.generatedAt) d.prep.generatedAt = nowIso();
      normalizeDossier(d);
      await S.store.save(d);
      toast(`Préparation prête · ${d.prep.questions.length} questions en ${Math.round((Date.now() - t0) / 1000)} s`, 'ok');
    } catch (e) {
      if (!isAbort(e)) toast('La préparation a échoué : ' + errMsg(e), 'err', { duration: 9000 });
    } finally {
      clearInterval(tick);
      ctx.generating = false;
      if (DX === ctx) { paintPrep(ctx); paintReadiness(ctx); }
    }
  }

  function shortModel(m) {
    return String(m || '').replace(/^models\//, '').replace(/-(preview|latest)(-\d{2}-\d{4})?$/, '').replace(/-\d{8}$/, '').replace(/-\d{2}-\d{4}$/, '');
  }

  /* ---------- Export ---------- */
  function slug(s) {
    return String(s || 'dossier').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'dossier';
  }

  function exportSheet(d) {
    const body = h(`<div class="stack">
      <div class="list">
        <button type="button" class="list-row" data-x="json">
          <span class="tile tile-blue">${icon('doc')}</span>
          <span class="list-main"><b>Fichier de sauvegarde</b><small>.souffleur.json · à réimporter dans Souffleur sur un autre appareil</small></span>
          ${icon('download', 'chev')}
        </button>
        <button type="button" class="list-row" data-x="html">
          <span class="tile tile-violet">${icon('globe')}</span>
          <span class="list-main"><b>Page autonome (.html)</b><small>L’app complète et ce dossier dans un seul fichier : double-clic sur n’importe quel PC, même sans installation.</small></span>
          ${icon('download', 'chev')}
        </button>
      </div>
      <div class="list">
        <div class="list-row">
          <span class="tile tile-orange">${icon('key')}</span>
          <span class="list-main"><b>Inclure mes clés API</b><small>Pratique sur un PC emprunté. Ne partagez jamais ce fichier.</small></span>
          <label class="switch"><input type="checkbox" data-keys><span></span></label>
        </div>
      </div>
    </div>`);
    const s = sheet({ title: 'Exporter le dossier', body, actions: [{ label: 'Fermer', kind: 'ghost' }] });
    $$('[data-x]', body).forEach((b) => b.addEventListener('click', async () => {
      const includeKeys = $('[data-keys]', body).checked;
      b.classList.add('busy');
      try {
        if (DX && DX.d === d) await DX.save.flush();
        if (b.dataset.x === 'json') {
          const blob = await S.store.exportFile(d, { includeKeys });
          download(blob, `${slug(dTitle(d))}.souffleur.json`);
        } else {
          const html = await buildStandalone(d, includeKeys);
          download(new Blob([html], { type: 'text/html;charset=utf-8' }), `Souffleur - ${slug(dTitle(d))}.html`);
        }
        toast('Export prêt : regardez vos téléchargements.', 'ok');
        s.close();
      } catch (e) {
        toast('Export impossible : ' + errMsg(e), 'err', { duration: 9000 });
      } finally { b.classList.remove('busy'); }
    }));
  }

  async function appSource() {
    if ($('meta[name="souffleur-single"][content="1"]') && bootHTML) return bootHTML;
    try {
      const r = await fetch('souffleur.html', { cache: 'no-cache' });
      if (r.ok) { const t = await r.text(); if (/souffleur-single/.test(t)) return t; }
    } catch (e) { /* repli ci-dessous */ }
    return assembleSingleFile();
  }

  // Repli (développement) : reconstitue un fichier unique à partir des ressources de la page.
  async function assembleSingleFile() {
    const doc = new DOMParser().parseFromString(bootHTML || ('<!doctype html>' + document.documentElement.outerHTML), 'text/html');
    const get = async (url) => { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${url} (${r.status})`); return r.text(); };
    for (const link of $$('link[rel="stylesheet"][href]', doc)) {
      const style = doc.createElement('style');
      style.textContent = await get(new URL(link.getAttribute('href'), location.href).href);
      link.replaceWith(style);
    }
    for (const sc of $$('script[src]', doc)) {
      const src = sc.getAttribute('src');
      if (/^https?:/i.test(src) && !src.startsWith(location.origin)) continue;
      const inline = doc.createElement('script');
      inline.setAttribute('data-src', src);
      inline.textContent = (await get(new URL(src, location.href).href)).replace(/<\/script/gi, '<\\/script');
      sc.replaceWith(inline);
    }
    $$('link[rel="manifest"]', doc).forEach((n) => n.remove());
    const meta = doc.createElement('meta');
    meta.name = 'souffleur-single'; meta.content = '1';
    doc.head.prepend(meta);
    return '<!doctype html>\n' + doc.documentElement.outerHTML;
  }

  async function buildStandalone(d, includeKeys) {
    const src = await appSource();
    const blob = await S.store.exportFile(d, { includeKeys: !!includeKeys });
    const payload = typeof blob === 'string' ? blob : await blob.text();
    const doc = new DOMParser().parseFromString(src, 'text/html');
    $$('#souffleur-embedded', doc).forEach((n) => n.remove());
    const app = doc.getElementById('view'); if (app) app.innerHTML = '';
    $$('.sheet-layer, .toast', doc).forEach((n) => n.remove());
    // Retire ce que des extensions du navigateur auraient injecté dans la page.
    const keep = new Set(['view', 'tabbar', 'netpill', 'update-banner', 'toasts']);
    Array.from(doc.body.children).forEach((n) => {
      if (/^(SCRIPT|NOSCRIPT|STYLE|TEMPLATE)$/.test(n.tagName) || keep.has(n.id) || n.classList.contains('aurora') || n.classList.contains('titlebar')) return;
      n.remove();
    });
    const ub = doc.getElementById('update-banner'); if (ub) { ub.innerHTML = ''; ub.hidden = true; ub.className = 'update-banner'; }
    const ts = doc.getElementById('toasts'); if (ts) ts.innerHTML = '';
    const sc = doc.createElement('script');
    sc.id = 'souffleur-embedded';
    sc.type = 'application/json';
    sc.textContent = payload.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    doc.head.appendChild(sc);
    return '<!doctype html>\n' + doc.documentElement.outerHTML;
  }

  // Dossier intégré dans un HTML autonome. Absent ici (ou supprimé) → importé sous le même identifiant ;
  // version du fichier plus récente que la copie locale → proposer la mise à jour ; sinon ouvrir la copie locale.
  async function importEmbedded() {
    const el = document.getElementById('souffleur-embedded');
    if (!el || !el.textContent.trim() || !S.store || !S.store.importFile) return null;
    const txt = el.textContent.trim();
    let data;
    try { data = JSON.parse(txt); } catch (e) { console.warn('[souffleur] dossier intégré illisible', e); return null; }
    const dz = (data && data.dossier) || data || {};
    try {
      const existing = dz.id ? await S.store.get(dz.id) : null;
      if (!existing) {
        const d = await S.store.importFile(txt, { keepUpdatedAt: true });
        toast(`Dossier « ${dTitle(d)} » chargé depuis ce fichier.`, 'ok');
        return d && d.id;
      }
      const embT = Date.parse(dz.updatedAt || data.exportedAt || '') || 0;
      const locT = Date.parse(existing.updatedAt || '') || 0;
      if (embT > locT + 1000) {
        const sig = `${dz.id}|${embT}`;
        let asked = [];
        try { asked = JSON.parse(localStorage.getItem('souffleur.embeddedAsked') || '[]'); } catch (e) { asked = []; }
        if (!asked.includes(sig)) {
          const ok = await confirmSheet({
            title: 'Version plus récente dans ce fichier',
            text: `Ce fichier contient une version de « ${dTitle(existing)} » plus récente que celle enregistrée sur cet appareil. Mettre à jour la copie locale ?`,
            okLabel: 'Mettre à jour', cancelLabel: 'Garder la mienne'
          });
          try { localStorage.setItem('souffleur.embeddedAsked', JSON.stringify(asked.concat(sig).slice(-30))); } catch (e) { /* rien */ }
          if (ok) {
            await S.store.importFile(txt, { replace: true, keepUpdatedAt: true });
            toast('Dossier mis à jour depuis ce fichier.', 'ok');
          }
        }
      }
      return existing.id;
    } catch (e) {
      toast('Le dossier intégré n’a pas pu être chargé : ' + errMsg(e), 'err');
      return null;
    }
  }

  /* ====================================================================== *
   *  Écran LIVE
   * ====================================================================== */
  let L = null;

  const FALLBACK_PRESETS = [
    { id: 'visio-casque', label: 'Visio sur ce PC (Meet / Teams)', them: 'display', themEngine: 'cloud', me: 'mic', meEngine: 'webspeech', needsKey: true },
    { id: 'haut-parleur', label: 'Haut-parleur ou téléphone à côté', them: null, me: 'mic', meEngine: 'webspeech', mixed: true, needsKey: false },
    { id: 'visio-hp', label: 'Visio sur ce PC, son sur haut-parleurs', them: null, me: 'mic', meEngine: 'webspeech', mixed: true, needsKey: false },
    { id: 'micro-cloud', label: 'Micro seul, transcription IA (bruit, accents)', them: null, me: 'mic', meEngine: 'cloud', mixed: true, needsKey: true }
  ];
  const PRESET_UI = {
    'visio-casque': { icon: 'video', tag: 'Recommandé', desc: 'Capte le son de l’onglet Meet ou de l’écran Teams, et votre micro à part. Deux voix bien séparées, même au casque.' },
    'haut-parleur': { icon: 'phone', desc: 'Un seul micro entend tout le monde. Gratuit et sans clé : idéal avec un téléphone posé à côté.' },
    'visio-hp': { icon: 'speaker', desc: 'Meet ou Teams sur ce PC, le son sort des haut-parleurs. Gratuit et sans clé.' },
    'micro-cloud': { icon: 'sparkles', desc: 'Transcription par l’IA, plus robuste au bruit et aux accents.' }
  };
  const WHO = {
    them: { label: 'Recruteur', cls: 'who-them', icon: 'person2' },
    me: { label: 'Moi', cls: 'who-me', icon: 'mic' },
    mixed: { label: 'Voix', cls: 'who-mixed', icon: 'waveform' }
  };
  const MODE_LABEL = { shorter: 'Plus court', example: 'Exemple concret', reformulate: 'Reformulée', pitch: 'Pitch', force: '', auto: '' };

  const presets = () => { try { const p = S.audio && S.audio.presets; return Array.isArray(p) && p.length ? p : FALLBACK_PRESETS; } catch (e) { return FALLBACK_PRESETS; } };
  const support = () => { try { return (S.audio && S.audio.support && S.audio.support()) || {}; } catch (e) { return {}; } };
  function savedPresetId() {
    const st = settings();
    let id = st.audioPreset || st.preset;
    if (!id) { try { id = localStorage.getItem('souffleur.preset'); } catch (e) { /* rien */ } }
    const list = presets();
    if (list.some((p) => p.id === id)) return id;
    return (hasKey() ? list[0] : (list.find((p) => !p.needsKey) || list[0])).id;
  }
  function rememberPreset(id) {
    setSettings({ audioPreset: id });
    try { localStorage.setItem('souffleur.preset', id); } catch (e) { /* rien */ }
  }
  const presetById = (id) => presets().find((p) => p.id === id) || presets()[0];
  // Préréglage connu d'audio.js → son identifiant ; configuration personnalisée → l'objet lui-même.
  const startArg = (p) => (FALLBACK_PRESETS.some((x) => x.id === p.id) ? p.id : p);
  const hintFor = (d) => [d.company, d.role, d.interviewer].filter(Boolean).join(', ');

  async function renderLive(root, params) {
    const d = normalizeDossier(params.id ? await S.store.get(params.id) : null);
    if (!d) { root.innerHTML = emptyScreen({ title: 'Dossier introuvable', text: 'Impossible de lancer l’entretien : ce dossier n’existe plus sur cet appareil.', icon: 'doc' }); return; }
    if (L) teardownLive();
    L = {
      d, root, presetId: savedPresetId(), running: false, paused: false, session: null, startMs: 0,
      entries: [], cur: -1, inflight: [], lastAutoAt: 0, starting: false, draining: false, audioStopped: false, views: [], interim: {}, pendingThem: [], firstPendingAt: 0,
      lastThemActivity: 0, themSpeaking: false, autoTimer: null, saveTimer: null, clock: null,
      wake: null, pip: null, offs: [], listeners: [], meter: null, srcState: {}, levels: {}, aiState: { kind: 'idle' },
      audio: false, followTranscript: true, levelRaf: 0
    };
    renderSetup();
  }

  /* ---------- Pré-vol ---------- */
  function orphanSession(d) {
    const s = d.sessions.filter((x) => x.kind === 'live' && !x.endedAt).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
    if (!s) return null;
    const started = parseDate(s.startedAt);
    if (!started || Date.now() - started.getTime() > 8 * 3600e3) return null;
    return s;
  }

  function renderSetup() {
    const { d, root } = L;
    const list = presets();
    const orphan = orphanSession(d);
    const st = settings();
    const delay = Number(st.answerDelayMs) || 900;
    root.innerHTML = `<div class="screen live-setup">
      <header class="topbar glass">
        <button type="button" class="icon-btn" data-go="#/dossier/${esc(d.id)}" aria-label="Retour au dossier" title="Dossier">${icon('chevron-left')}</button>
        <div class="topbar-title">Entretien · ${esc(dTitle(d))}</div>
        <div class="topbar-actions"><button type="button" class="icon-btn" data-go="#/diag" title="Diagnostic complet" aria-label="Diagnostic">${icon('shield')}</button></div>
      </header>
      <div class="setup-grid">
        <section class="card card-pad setup-main">
          <h1 class="h2">Comment entendez-vous le recruteur${NB}?</h1>
          <p class="muted setup-lead">Choisissez votre configuration. Souffleur s’en souviendra.</p>
          <div class="presets" role="radiogroup" aria-label="Configuration audio">
            ${list.map((p) => {
              const ui = PRESET_UI[p.id] || { icon: 'mic', desc: '' };
              const locked = p.needsKey && !hasKey();
              return `<button type="button" class="preset${p.id === L.presetId ? ' on' : ''}" role="radio" aria-checked="${p.id === L.presetId}" data-preset="${esc(p.id)}">
                <span class="preset-ic">${icon(ui.icon)}</span>
                <span class="preset-text"><b>${esc(p.label)}</b><small>${esc(ui.desc)}</small>
                  <span class="preset-tags">${ui.tag ? `<span class="pill pill-accent pill-xs">${esc(ui.tag)}</span>` : ''}${p.needsKey ? `<span class="pill pill-xs ${locked ? 'pill-warn' : ''}">${icon('key')}${locked ? 'Clé IA requise' : 'Utilise l’IA'}</span>` : '<span class="pill pill-ok pill-xs">Sans clé</span>'}</span>
                </span>
                <span class="preset-check">${icon('check')}</span>
              </button>`;
            }).join('')}
          </div>
          <div class="setup-hint" data-b="hint"></div>
        </section>

        <aside class="setup-side">
          ${orphan ? `<section class="card card-pad resume-card">
            <div class="row"><span class="tile tile-orange">${icon('refresh')}</span><div class="grow"><b>Session interrompue</b><div class="small muted">${esc(relTime(orphan.startedAt))} · ${plural((orphan.transcript || []).length, 'réplique', 'répliques')}, ${plural((orphan.answers || []).length, 'réponse', 'réponses')}</div></div></div>
            <div class="row"><button type="button" class="btn btn-sm btn-primary" data-act="resume">${icon('play')}<span>Reprendre</span></button><button type="button" class="btn btn-sm" data-go="#/recap/${esc(d.id)}/${esc(orphan.id)}">Voir le récap</button></div>
          </section>` : ''}
          <div class="start-zone">
            ${d.meetUrl ? `<a class="btn btn-lg btn-glass meet-btn" href="${esc(d.meetUrl)}" target="_blank" rel="noopener noreferrer">${icon('video')}<span>1. Rejoindre la visio</span></a>
            <div class="small muted meet-hint">Puis « Démarrer l’écoute » et choisissez l’onglet de la visio, avec « Partager aussi l’audio de l’onglet ».</div>` : ''}
            <button type="button" class="btn btn-primary btn-xl start-btn" data-act="start">${icon('waveform')}<span>Démarrer l’écoute</span></button>
            <button type="button" class="btn btn-quiet" data-act="manual">${icon('keyboard')}<span>Continuer sans audio (saisie manuelle)</span></button>
            <button type="button" class="btn btn-quiet" data-act="sim">${icon('graduation')}<span>Simulation : l’IA joue le recruteur</span></button>
            <div class="start-error" data-b="err" hidden></div>
          </div>
          <section class="card card-pad">
            <div class="card-head"><h2 class="h3">Vérifications</h2></div>
            <div class="checks" data-b="checks"></div>
          </section>
          <section class="card card-pad">
            <div class="set-row">
              <div class="grow"><b>Réponse automatique</b><small>Dès que le recruteur a fini sa question</small></div>
              <label class="switch"><input type="checkbox" data-b="auto"${st.autoAnswer === false ? '' : ' checked'}><span></span></label>
            </div>
            <div class="set-row">
              <div class="grow"><b>Délai de silence</b><small>Avant de considérer la question terminée</small></div>
              <div class="seg" data-b="delay">${[[600, 'Court'], [900, 'Normal'], [1500, 'Long']].map(([v, l]) => `<button type="button" data-v="${v}" class="${Math.abs(delay - v) < 150 ? 'on' : ''}">${l}</button>`).join('')}</div>
            </div>
          </section>
        </aside>
      </div>
    </div>`;
    hydrateIcons(root);
    paintSetupDynamic();
    $$('[data-preset]', root).forEach((b) => b.addEventListener('click', () => {
      L.presetId = b.dataset.preset;
      rememberPreset(L.presetId);
      $$('[data-preset]', root).forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
      paintSetupDynamic();
    }));
    $('[data-b="auto"]', root).addEventListener('change', (e) => setSettings({ autoAnswer: e.target.checked }));
    bindSeg(root, '[data-b="delay"]', (v) => setSettings({ answerDelayMs: Number(v) }));
    $('[data-act="start"]', root).addEventListener('click', () => onStartClick(null));
    $('[data-act="manual"]', root).addEventListener('click', () => beginSession(null, { manual: true }));
    $('[data-act="sim"]', root).addEventListener('click', onSimClick);
    const rs = $('[data-act="resume"]', root);
    if (rs) rs.addEventListener('click', () => onStartClick(orphan));
    // Vumètre automatique si le micro est déjà autorisé (aucune invite).
    try {
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'microphone' }).then((r) => { if (r.state === 'granted' && L && !L.running && !L.meter) startMeter(); }).catch(() => {});
      }
    } catch (e) { /* rien */ }
  }

  function paintSetupDynamic() {
    if (!L || L.running) return;
    const root = L.root;
    const p = presetById(L.presetId);
    const sup = support();
    const hint = $('[data-b="hint"]', root);
    if (hint) {
      hint.innerHTML = p.them === 'display' ? `<div class="hint-card">
          <div class="hint-title">${icon('info')}Au démarrage, Chrome vous demande quoi partager</div>
          <ol class="hint-steps">
            <li><b>Meet</b> dans Chrome : onglet <b>Onglet Chrome</b>, choisissez l’onglet de la réunion.</li>
            <li><b>Teams</b> (application) : onglet <b>Écran entier</b>.</li>
            <li>Cochez <b>Partager l’audio de l’onglet</b> (ou <b>du système</b>), puis <b>Partager</b>.</li>
          </ol>
          <p class="small muted">Souffleur n’enregistre pas la vidéo : seul le son du recruteur est transcrit.</p>
        </div>` : `<div class="hint-card">
          <div class="hint-title">${icon('info')}Conseil</div>
          <p class="small">Placez le micro à portée des deux voix. Souffleur distingue les questions grâce à leur formulation ; vous pouvez toujours appuyer sur <span class="kbd">Espace</span> pour forcer une réponse.</p>
        </div>`;
    }
    const checks = $('[data-b="checks"]', root);
    if (!checks) return;
    const key = hasKey();
    const n = prepCount(L.d);
    const row = (state, ic, title, detail, extra) => `<div class="check ${state}"><span class="check-ic">${icon(state === 'ok' ? 'check' : state === 'err' ? 'xmark' : state === 'warn' ? 'warning' : ic)}</span><div class="check-main"><b>${title}</b><small>${detail}</small></div>${extra || ''}</div>`;
    const needDisplay = p.them === 'display';
    const needSpeech = p.meEngine === 'webspeech';
    let html = row(L.meter ? 'ok' : 'mic-row', 'mic', 'Micro', L.meter ? esc(L.meter.label || 'Micro actif') : 'Testez-le avant de commencer',
      `<div class="meter meter-sm" data-b="mic-meter"><i style="--v:0"></i></div><button type="button" class="btn btn-sm" data-act="mictest">${L.meter ? 'Arrêter' : 'Tester'}</button>`);
    if (needDisplay) html += row(sup.getDisplayMedia === false ? 'err' : sup.displayAudio === false ? 'warn' : 'ok', 'video', 'Son de l’onglet ou du système',
      sup.getDisplayMedia === false ? 'Indisponible sur ce navigateur : utilisez Chrome ou Edge sur PC, ou le mode haut-parleur.' : sup.displayAudio === false ? 'Le partage audio risque de ne pas marcher ici (Chrome ou Edge sur PC conseillés).' : 'Partage de l’audio pris en charge');
    if (needSpeech) html += row(sup.webSpeech === false ? 'warn' : 'ok', 'waveform', 'Reconnaissance vocale',
      sup.webSpeech === false ? 'Indisponible ici : utilisez Chrome, ou le mode « transcription IA ».' : 'Reconnaissance vocale de Chrome');
    html += row(key ? 'ok' : p.needsKey ? 'err' : 'warn', 'key', 'Clé IA', key ? 'Réponses IA en direct activées' : p.needsKey ? 'Ce mode nécessite une clé : ajoutez-la dans les Réglages.' : 'Sans clé : seules vos réponses préparées s’afficheront.');
    html += row(n ? 'ok' : 'warn', 'sparkles', 'Préparation', n ? `${n} réponses prêtes, affichées instantanément` : 'Aucune réponse préparée pour ce dossier');
    html += row(navigator.onLine === false ? 'warn' : 'ok', 'globe', 'Connexion', navigator.onLine === false ? 'Hors ligne : IA indisponible, réponses préparées disponibles.' : 'En ligne');
    checks.innerHTML = html;
    const mt = $('[data-act="mictest"]', checks);
    if (mt) mt.addEventListener('click', () => { if (L.meter) { stopMeter(); paintSetupDynamic(); } else startMeter(); });
    const sb = $('[data-act="start"]', root);
    if (sb) sb.disabled = !!(p.needsKey && !key);
  }

  async function startMeter() {
    if (!L || L.running) return;
    stopMeter();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !AC) { toast('Micro inaccessible sur ce navigateur.', 'err'); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      toast(micError(e), 'err', { duration: 9000 });
      return;
    }
    if (!L || L.running) { stream.getTracks().forEach((t) => t.stop()); return; }
    const ac = new AC();
    const src = ac.createMediaStreamSource(stream);
    const an = ac.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    const tr = stream.getAudioTracks()[0];
    L.meter = { stream, ac, raf: 0, peak: 0, label: tr && tr.label ? tr.label : 'Micro actif' };
    paintSetupDynamic();
    const loop = () => {
      if (!L || !L.meter) return;
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      const v = Math.min(1, Math.sqrt(s / buf.length) * 6);
      L.meter.peak = Math.max(L.meter.peak, v);
      const m = $('[data-b="mic-meter"] i', L.root);
      if (m) m.style.setProperty('--v', v.toFixed(3));
      L.meter.raf = requestAnimationFrame(loop);
    };
    L.meter.raf = requestAnimationFrame(loop);
  }
  function stopMeter() {
    if (!L || !L.meter) return;
    cancelAnimationFrame(L.meter.raf);
    try { L.meter.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* rien */ }
    try { L.meter.ac.close(); } catch (e) { /* rien */ }
    L.meter = null;
  }

  function micError(e) {
    const n = e && (e.name || e.code);
    if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return 'Accès au micro refusé. Cliquez sur l’icône à gauche de l’adresse du site et autorisez le micro.';
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'Aucun micro détecté. Branchez un micro ou un casque.';
    if (n === 'NotReadableError') return 'Le micro est utilisé par une autre application. Fermez-la ou choisissez un autre micro.';
    return 'Micro indisponible : ' + errMsg(e);
  }
  function startErrorText(e) {
    const code = e && (e.code || e.name);
    const TITLES = {
      NO_DISPLAY_AUDIO: 'Le son n’a pas été partagé', DISPLAY_CANCELLED: 'Partage annulé', DISPLAY_UNSUPPORTED: 'Capture d’onglet non prise en charge',
      DISPLAY_NEEDS_GESTURE: 'Cliquez de nouveau sur Démarrer', MIC_DENIED: 'Accès au micro refusé', MIC_NOT_FOUND: 'Aucun micro détecté',
      MIC_BUSY: 'Micro occupé', NO_MEDIA: 'Micro inaccessible', INSECURE: 'Connexion non sécurisée', NO_WEBSPEECH: 'Reconnaissance vocale indisponible',
      NO_KEY: 'Clé IA requise', KEY_ERROR: 'Clé IA refusée', NOT_ALLOWED: 'Reconnaissance vocale refusée', SERVICE_NOT_ALLOWED: 'Reconnaissance vocale bloquée',
      AUDIO_ENGINE: 'Moteur audio indisponible'
    };
    if (TITLES[code] && e.message && e.message !== code) return { title: TITLES[code], text: e.message };
    if (code === 'NO_DISPLAY_AUDIO') return { title: 'Le son n’a pas été partagé', text: 'Dans la fenêtre de partage, cochez « Partager l’audio de l’onglet » (Meet) ou « Partager l’audio du système » (Teams, écran entier), puis recommencez.' };
    if (code === 'NotAllowedError' || code === 'PermissionDeniedError') return { title: 'Autorisation refusée', text: 'Vous avez annulé le partage ou refusé le micro. Recommencez et acceptez la demande du navigateur.' };
    if (code === 'NotFoundError') return { title: 'Aucun micro détecté', text: 'Branchez un micro ou un casque, puis recommencez.' };
    if (code === 'NotSupportedError' || code === 'UNSUPPORTED') return { title: 'Non pris en charge', text: 'Ce navigateur ne permet pas ce mode audio. Utilisez Chrome ou Edge sur PC, ou choisissez le mode haut-parleur.' };
    if (code === 'NO_KEY') return { title: 'Clé IA requise', text: 'Ce mode transcrit avec l’IA : ajoutez une clé dans les Réglages ou choisissez un mode sans clé.' };
    return { title: 'Démarrage impossible', text: errMsg(e) };
  }

  // IMPORTANT : S.audio.start est appelé immédiatement, dans le geste de clic, avant tout await.
  function onStartClick(resumeSession) {
    if (!L || L.running || L.starting) return;
    const p = presetById(L.presetId);
    let started;
    L.starting = true;
    const others = $$('[data-act="manual"],[data-act="resume"]', L.root);
    others.forEach((b) => { b.disabled = true; });
    subscribeAudio(); // synchrone : aucun await avant l'appel à start()
    try {
      if (!S.audio || !S.audio.start) throw Object.assign(new Error('Module audio indisponible.'), { code: 'UNSUPPORTED' });
      started = Promise.resolve(S.audio.start(startArg(p), { hint: hintFor(L.d) }));
    } catch (e) { started = Promise.reject(e); }
    stopMeter();
    const btn = $('[data-act="start"]', L.root);
    const err = $('[data-b="err"]', L.root);
    if (err) err.hidden = true;
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner"></span><span>${p.them === 'display' ? 'Choisissez l’onglet à partager…' : 'Autorisation du micro…'}</span>`; }
    const myL = L;
    started.then(() => {
      // L'utilisateur a quitté l'écran (ou démarré autrement) pendant le choix de l'onglet :
      // on ne laisse jamais une capture tourner en arrière-plan.
      if (!L || L !== myL || L.running || L.manual) { try { S.audio.stop({ drainMs: 0 }); } catch (e) { /* rien */ } if (L === myL) { L.starting = false; others.forEach((b) => { b.disabled = false; }); } return; }
      L.starting = false;
      L.audio = true;
      beginSession(resumeSession, { preset: p });
    }, (e) => {
      console.warn('[souffleur] audio', e);
      if (L === myL) L.starting = false;
      others.forEach((b) => { b.disabled = false; });
      if (L !== myL) return;
      unsubscribeAudio();
      if (!L) return;
      if (btn) { btn.disabled = false; btn.innerHTML = `${icon('waveform')}<span>Démarrer l’écoute</span>`; }
      const t = startErrorText(e);
      if (err) {
        err.hidden = false;
        err.innerHTML = `<div class="err-title">${icon('warning')}${esc(t.title)}</div><p>${esc(t.text)}</p>`;
      }
      toast(t.title, 'err');
    });
  }

  // Simulation : l'IA joue le recruteur (voix de synthèse), votre micro est écouté comme pendant un vrai entretien.
  const SIM_PRESET = { id: 'simulation', label: 'Simulation', them: null, me: 'mic', meEngine: 'webspeech', mixed: false };
  function onSimClick() {
    if (!L || L.running || L.starting) return;
    L.starting = true;
    subscribeAudio(); // synchrone : aucun await avant start()
    let started;
    try { started = Promise.resolve(S.audio.start(SIM_PRESET, { hint: hintFor(L.d) })); } catch (e) { started = Promise.reject(e); }
    stopMeter();
    const myL = L;
    started.then(() => {
      if (!L || L !== myL || L.running) { try { S.audio.stop({ drainMs: 0 }); } catch (e) { /* rien */ } return; }
      L.starting = false;
      L.audio = true;
      beginSession(null, { preset: SIM_PRESET, sim: true });
    }, (e) => {
      if (L !== myL) return;
      L.starting = false;
      unsubscribeAudio();
      toast(`${startErrorText(e).title} : simulation sans transcription de votre voix.`, 'warn', { duration: 7000 });
      beginSession(null, { manual: true, sim: true });
    });
  }
  // Pendant que la voix de synthèse parle (et juste après), le micro l'entend : ce n'est pas vous.
  function simEcho(who, text) {
    if (!L || !L.sim || who === 'them') return false;
    const speaking = 'speechSynthesis' in window && speechSynthesis.speaking;
    if (speaking || Date.now() - (L.ttsEndAt || 0) < 700) return true;
    return !!(L.simLastQ && text && similarity(text, L.simLastQ) > 0.6);
  }

  function subscribeAudio() {
    unsubscribeAudio();
    if (!S.audio || !S.audio.on) return;
    const on = (evt, fn) => { try { const off = S.audio.on(evt, fn); if (typeof off === 'function') L.offs.push(off); else L.offs.push(() => { try { S.audio.off && S.audio.off(evt, fn); } catch (e) { /* rien */ } }); } catch (e) { console.warn(e); } };
    on('interim', onInterim);
    on('final', onFinal);
    on('level', onLevel);
    on('speech', onSpeech);
    on('state', onAudioState);
    on('ended', onAudioEnded);
    on('info', onAudioInfo);
  }
  function onAudioInfo(ev) {
    if (!L || !L.running || !ev || !ev.message) return;
    const kind = ev.kind === 'error' ? 'err' : ev.kind === 'warning' ? 'warn' : ev.kind;
    toast(ev.message, kind, { duration: kind === 'err' ? 9000 : undefined });
  }
  function unsubscribeAudio() {
    if (!L) return;
    L.offs.forEach((f) => { try { f(); } catch (e) { /* rien */ } });
    L.offs = [];
  }

  function beginSession(resumeSession, opts) {
    if (!L || L.running) return;
    opts = opts || {};
    if (opts.manual && L.starting) return; // capture en cours de démarrage : pas de double mode
    stopMeter();
    const d = L.d;
    L.preset = opts.preset || presetById(L.presetId);
    L.manual = !!opts.manual;
    L.sim = !!opts.sim;
    if (resumeSession) {
      L.session = resumeSession;
      const last = (resumeSession.transcript || []).reduce((m, x) => Math.max(m, x.t || 0), 0);
      const lastA = (resumeSession.answers || []).reduce((m, x) => Math.max(m, x.t || 0), 0);
      L.startMs = Date.now() - Math.max(last, lastA) - 2000;
      resumeSession.transcript = resumeSession.transcript || [];
      resumeSession.answers = resumeSession.answers || [];
      L.entries = resumeSession.answers.map((a) => ({ id: uid(), question: a.question, text: a.answer, source: a.source, model: a.model, t: a.t }));
      L.cur = L.entries.length - 1;
    } else {
      d.sessions.forEach((s) => {
        if (s.kind === 'live' && !s.endedAt) {
          const lt = (s.transcript || []).reduce((m, x) => Math.max(m, x.t || 0), 0);
          const st = parseDate(s.startedAt);
          s.endedAt = st ? new Date(st.getTime() + lt + 1000).toISOString() : nowIso();
        }
      });
      L.session = { id: uid(), kind: 'live', sim: L.sim, startedAt: nowIso(), endedAt: null, transcript: [], answers: [], scores: null, recap: null };
      d.sessions.push(L.session);
      L.startMs = Date.now();
    }
    if (L.manual) unsubscribeAudio();
    L.running = true;
    L.paused = false;
    document.body.classList.add('is-live');
    renderRunning();
    addLiveListeners();
    requestWake();
    L.clock = setInterval(tickClock, 1000);
    tickClock();
    flushSave();
    if (L.manual) toast('Mode saisie manuelle : tapez les questions en bas à droite.', 'info');
  }

  /* ---------- Vue en cours ---------- */
  function sourcesFor(p) {
    if (!p || L.manual) return [];
    if (p.mixed === false && !p.them) return ['me'];
    if (p.them) return p.me === null ? ['them'] : ['them', 'me'];
    return ['mixed'];
  }

  function renderRunning() {
    const { d, root } = L;
    const srcs = sourcesFor(L.preset);
    window.scrollTo(0, 0);
    const st = settings();
    root.innerHTML = `<div class="live">
      <header class="live-bar glass">
        <div class="live-left">
          <span class="rec" data-b="rec"><span class="rec-dot"></span><span class="live-clock" data-b="clock">00:00</span></span>
          <div class="srcs">${srcs.map((w) => `<span class="src ${WHO[w].cls}" data-src="${w}" title="${WHO[w].label}">
              <span class="src-ic">${icon(WHO[w].icon)}</span><span class="src-label">${WHO[w].label}</span>
              <span class="meter meter-xs"><i style="--v:0"></i></span><span class="src-state" data-b="state-${w}">démarrage…</span></span>`).join('')}
            ${L.manual ? `<span class="src"><span class="src-ic">${icon('keyboard')}</span><span class="src-label">Saisie manuelle</span></span>` : ''}
          </div>
        </div>
        <div class="live-right">
          <span class="ai-pill pill" data-b="ai"></span>
          <button type="button" class="icon-btn" data-act="pip" title="Fenêtre flottante (F)" aria-label="Fenêtre flottante">${icon('pip')}</button>
          ${L.manual ? '' : `<button type="button" class="icon-btn" data-act="pause" title="Pause (M)" aria-label="Pause">${icon('pause')}</button>`}
          <button type="button" class="icon-btn hide-mobile" data-act="help" title="Raccourcis (?)" aria-label="Raccourcis clavier">${icon('keyboard')}</button>
          <button type="button" class="btn btn-danger btn-sm" data-act="end" aria-label="Terminer l’entretien" title="Terminer l’entretien">${icon('stop')}<span>Terminer</span></button>
        </div>
      </header>
      <div class="live-banner" data-b="banner" hidden></div>
      <div class="live-grid live-stage-grid">
        <div class="live-center">
          <div class="stage" data-b="stage" hidden title="Cliquer pour zoomer sur le visage">
            <video data-b="video" autoplay muted playsinline></video>
            <span class="stage-label">${icon('person')}Recruteur</span>
          </div>
          ${lanesHTML(L.sim ? ['them', 'me'] : srcs)}
          <section class="live-answer">
            <article class="answer card" aria-live="polite" aria-atomic="false">
              <div class="answer-top">
                <div class="answer-q" data-v="q"></div>
                <div class="answer-nav">
                  <button type="button" class="icon-btn icon-btn-sm" data-act="prev" title="Réponse précédente (←)" aria-label="Réponse précédente">${icon('chevron-left')}</button>
                  <span class="answer-count" data-v="count"></span>
                  <button type="button" class="icon-btn icon-btn-sm" data-act="next" title="Réponse suivante (→)" aria-label="Réponse suivante">${icon('chevron-right')}</button>
                </div>
              </div>
              <div class="answer-meta" data-v="meta"></div>
              <div class="answer-text md sf" data-v="text"></div>
              <div class="answer-extra" data-v="extra"></div>
            </article>
            <div class="actions-bar" role="toolbar" aria-label="Actions sur la réponse">
              <button type="button" class="btn btn-primary" data-act="now">${icon('bolt')}<span>Répondre maintenant</span><span class="kbd">Espace</span></button>
              <button type="button" class="btn" data-act="shorter">${icon('text-size')}<span>Plus court</span><span class="kbd">C</span></button>
              <button type="button" class="btn" data-act="example">${icon('lightbulb')}<span>Exemple concret</span><span class="kbd">E</span></button>
              <button type="button" class="btn" data-act="reformulate">${icon('refresh')}<span>Reformuler</span><span class="kbd">R</span></button>
              <button type="button" class="btn" data-act="pitch">${icon('quote')}<span>Pitch</span><span class="kbd">P</span></button>
              <span class="spacer"></span>
              <div class="font-ctl" role="group" aria-label="Taille du texte">
                <button type="button" class="icon-btn icon-btn-sm" data-act="smaller" title="Texte plus petit (−)" aria-label="Texte plus petit"><span class="aa-sm">A</span></button>
                <button type="button" class="icon-btn icon-btn-sm" data-act="bigger" title="Texte plus grand (+)" aria-label="Texte plus grand"><span class="aa-lg">A</span></button>
              </div>
            </div>
          </section>
        <section class="live-side live-chat card">
          <header class="side-head">
            <h2 class="h3">Conversation</h2>
            <span class="spacer"></span>
            <label class="mini-switch" title="Réponse automatique"><span>Auto</span><span class="switch switch-sm"><input type="checkbox" data-b="auto"${st.autoAnswer === false ? '' : ' checked'}><span></span></span></label>
          </header>
          <div class="transcript" data-b="transcript" role="log" aria-label="Transcription de l’appel"></div>
          <button type="button" class="jump" data-b="jump" hidden>${icon('arrow-down')}<span>Dernières répliques</span></button>
        </section>
        </div>
        <aside class="live-faq card">
          <header class="side-head"><h2 class="h3">Questions fréquentes</h2><span class="spacer"></span><span class="badge" data-b="faqn"></span></header>
          <label class="search"><span>${icon('search')}</span><input type="search" data-b="faqq" placeholder="Filtrer les questions…" aria-label="Filtrer les questions"></label>
          <div class="faq-list" data-b="faq" role="list"></div>
          <div class="quick">
            <button type="button" class="chip" data-quick="pitch">${icon('quote')}Pitch</button>
            <button type="button" class="chip" data-quick="askThem">${icon('person2')}Questions à poser</button>
            <button type="button" class="chip" data-quick="keyFacts">${icon('bolt')}Chiffres clés</button>
            <button type="button" class="chip" data-quick="watchouts">${icon('warning')}Vigilance</button>
            <button type="button" class="chip" data-quick="all">${icon('list')}Toutes les réponses</button>
          </div>
          <form class="ask" data-b="ask" autocomplete="off">
            <input type="text" data-b="askin" placeholder="Tapez une question…" aria-label="Tapez une question du recruteur" enterkeyhint="send">
            <button type="submit" class="icon-btn icon-btn-accent" aria-label="Obtenir une réponse">${icon('send')}</button>
          </form>
        </aside>
      </div>
    </div>`;
    const v = {
      doc: document, root,
      q: $('[data-v="q"]', root), meta: $('[data-v="meta"]', root), text: $('[data-v="text"]', root),
      extra: $('[data-v="extra"]', root), count: $('[data-v="count"]', root),
      prev: $('[data-act="prev"]', root), next: $('[data-act="next"]', root),
      ai: $('[data-b="ai"]', root), clock: $('[data-b="clock"]', root), rec: $('[data-b="rec"]', root), main: true
    };
    L.views = [v];
    L.transcriptEl = $('[data-b="transcript"]', root);
    L.jumpEl = $('[data-b="jump"]', root);
    paintTranscriptFull();
    paintAnswers();
    paintAI();
    paintSources();

    root.addEventListener('click', onLiveClick);
    $('[data-b="ask"]', root).addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = $('[data-b="askin"]', root);
      const q = inp.value.trim();
      if (!q) return;
      inp.value = '';
      addTranscript('them', q, { typed: true });
      answerQuestion(q, 'force');
    });
    $('[data-b="auto"]', root).addEventListener('change', (e) => {
      setSettings({ autoAnswer: e.target.checked });
      toast(e.target.checked ? 'Réponse automatique activée.' : 'Réponse automatique désactivée : appuyez sur Espace pour répondre.', 'info');
    });
    L.transcriptEl.addEventListener('scroll', () => {
      const el = L.transcriptEl;
      L.followTranscript = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      if (L.followTranscript) L.jumpEl.hidden = true;
    }, { passive: true });
    L.jumpEl.addEventListener('click', () => { L.followTranscript = true; scrollTranscript(true); L.jumpEl.hidden = true; });
    paintFaq();
    $('[data-b="faqq"]', root).addEventListener('input', (e) => paintFaq(e.target.value));
    if (L.sim) mountSim(root);
    const stage = $('[data-b="stage"]', root);
    stage.addEventListener('click', () => stage.classList.toggle('zoom'));
    attachStage();
  }

  /* ---------- Couloirs de parole : qui parle, et ce qui est en train d'être dit ---------- */
  function lanesHTML(list) {
    if (!list || !list.length) return '';
    return `<div class="lanes lanes-${list.length}" data-b="lanes">${list.map((w) => {
      const x = WHO[w] || WHO.them;
      const name = w === 'me' ? 'Vous' : w === 'mixed' ? 'Voix (micro)' : 'Recruteur';
      return `<div class="lane ${x.cls}" data-lane="${w}">
        <span class="lane-av">${icon(x.icon)}</span>
        <div class="lane-body"><div class="lane-top"><b>${name}</b><span class="lane-state" data-ls>${w === 'me' ? 'en attente de votre voix' : 'silencieux'}</span></div>
        <div class="lane-text" data-lt></div></div>
        <span class="lane-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
      </div>`;
    }).join('')}</div>`;
  }
  function laneSet(who, o) {
    const el = L && L.root && $(`[data-lane="${who}"]`, L.root);
    if (!el) return;
    if ('active' in o) {
      el.classList.toggle('active', !!o.active);
      $('[data-ls]', el).textContent = o.active ? (who === 'me' ? 'on vous entend…' : 'parle…') : (who === 'me' ? 'à l’écoute' : 'silencieux');
    }
    if (o.text != null) {
      const t = $('[data-lt]', el);
      t.textContent = o.text;
      t.classList.toggle('interim', !!o.interim);
      t.scrollLeft = t.scrollWidth;
    }
  }
  function lanePulse(who, ms) {
    if (!L) return;
    laneSet(who, { active: true });
    L.laneT = L.laneT || {};
    clearTimeout(L.laneT[who]);
    L.laneT[who] = setTimeout(() => laneSet(who, { active: false }), ms || 700);
  }

  /* ---------- Simulation : l'IA joue le recruteur, l'écran est celui du vrai entretien ---------- */
  function mountSim(root) {
    L.simAsked = L.simAsked || [];
    L.simVoice = L.simVoice !== false && 'speechSynthesis' in window;
    const bar = h(`<div class="sim-bar card">
      <span class="tile tile-violet">${icon('graduation')}</span>
      <div class="grow"><b>Simulation d’entretien</b><div class="small muted" data-s="info">L’IA joue le recruteur. Répondez à voix haute en lisant le souffleur, puis passez à la suite.</div></div>
      <label class="mini-switch" title="Lire les questions à voix haute"><span>Voix</span><span class="switch switch-sm"><input type="checkbox" data-s="voice"${L.simVoice ? ' checked' : ''}><span></span></span></label>
      <button type="button" class="btn btn-primary" data-s="next">${icon('play')}<span>Question suivante</span><span class="kbd">N</span></button>
    </div>`);
    const center = $('.live-center', root);
    center.insertBefore(bar, center.firstChild);
    $('[data-s="next"]', bar).addEventListener('click', simNext);
    $('[data-s="voice"]', bar).addEventListener('change', (e) => { L.simVoice = e.target.checked; if (!L.simVoice) speechSynthesis.cancel(); });
    if (!L.simAsked.length) setTimeout(simNext, 600);
  }

  // Incontournables d'abord, puis les autres questions préparées dans un ordre varié ; l'IA invente au-delà.
  async function simNext() {
    if (!L || !L.running || !L.sim || L.simBusy) return;
    L.simBusy = true;
    const btn = L.root && $('[data-s="next"]', L.root);
    if (btn) btn.disabled = true;
    try {
      const asked = L.simAsked;
      const qs = ((L.d.prep && L.d.prep.questions) || []).filter((q) => asked.indexOf(q.q) < 0);
      const first = qs.find((q) => /presentez|parlez.moi de vous|votre parcours/.test(S.util.norm(q.q)));
      let q = asked.length === 0 && first ? first.q : '';
      if (!q && qs.length) q = qs[(asked.length * 7 + 3) % qs.length].q;
      if (!q && S.ai && S.ai.hasKey()) { const r = await S.ai.trainingNext(L.d, asked); q = r && r.question; }
      if (!q) { toast('Plus de questions : terminez la simulation pour voir le récap.', 'info'); return; }
      asked.push(q);
      const info = L.root && $('[data-s="info"]', L.root);
      if (info) info.textContent = `Question ${asked.length} · répondez à voix haute, puis « Question suivante » (N).`;
      L.simLastQ = q;
      laneSet('them', { text: q, interim: false });
      if (L.simVoice) {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(q);
        u.onstart = () => laneSet('them', { active: true });
        u.onend = u.onerror = () => { L.ttsEndAt = Date.now(); laneSet('them', { active: false }); };
        u.lang = 'fr-FR';
        const v = speechSynthesis.getVoices().find((x) => /^fr/i.test(x.lang));
        if (v) u.voice = v;
        u.rate = 1.02;
        speechSynthesis.speak(u);
      } else lanePulse('them', 1500);
      addTranscript('them', q, { typed: true });
      answerQuestion(q, 'force');
    } catch (e) {
      toast('Simulation : ' + errMsg(e), 'err');
    } finally {
      L.simBusy = false;
      if (btn) btn.disabled = false;
    }
  }

  // Questions préparées, les plus courantes d'abord (catégorie = 1er tag), filtrables.
  const FAQ_ORDER = ['classique', 'motivation', 'poste', 'comportementale', 'technique', 'situation', 'piege', 'salaire', 'fin'];
  function paintFaq(filter) {
    const el = L && L.root && $('[data-b="faq"]', L.root);
    if (!el) return;
    const qs = ((L.d.prep && L.d.prep.questions) || []).map((q, i) => {
      const k = FAQ_ORDER.indexOf(S.util.norm((q.tags || [])[0] || ''));
      // Les incontournables en tête, quelle que soit leur catégorie.
      const top = /presentez|parlez.moi de vous|votre parcours|pourquoi (ce poste|nous|le |la |l )|pourquoi (vous|avoir postule)/.test(S.util.norm(q.q));
      return { q, i, k: top ? -1 : k < 0 ? FAQ_ORDER.length : k };
    }).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.q);
    const f = S.util.norm(filter || '');
    const list = f ? qs.filter((q) => S.util.norm([q.q].concat(q.variants || [], q.tags || []).join(' ')).includes(f)) : qs;
    $('[data-b="faqn"]', L.root).textContent = qs.length ? String(qs.length) : '';
    el.innerHTML = list.length ? list.map((q) => `<button type="button" class="faq-item" data-alt="${esc(q.id)}" role="listitem">${esc(q.q)}</button>`).join('')
      : `<div class="empty small muted">${qs.length ? 'Aucune question ne correspond.' : 'Pas encore de réponses préparées pour ce dossier.'}</div>`;
  }

  // Vidéo du recruteur (partage Meet / Teams) au-dessus de la réponse ; se rebranche après une relance de capture.
  function attachStage() {
    if (!L || !L.running || !L.root) return;
    const stage = $('[data-b="stage"]', L.root);
    const video = stage && $('video', stage);
    if (!video) return;
    const cur = video.srcObject && video.srcObject.getVideoTracks()[0];
    if (!cur || cur.readyState === 'ended') {
      const ms = S.audio && S.audio.videoStream ? S.audio.videoStream(24) : null;
      video.srcObject = ms;
      stage.hidden = !ms;
      if (ms) { const p = video.play(); if (p && p.catch) p.catch(() => {}); }
    }
    clearTimeout(L.stageTimer);
    L.stageTimer = setTimeout(attachStage, 2000);
  }

  function onLiveClick(e) {
    const q = e.target.closest('[data-quick]');
    if (q) { quick(q.dataset.quick); return; }
    const line = e.target.closest('.tl-ask');
    if (line) {
      const i = Number(line.dataset.i);
      const t = L.session.transcript[i];
      if (t) answerQuestion(t.text, 'force');
      return;
    }
    const alt = e.target.closest('[data-alt]');
    if (alt) { showPrepById(alt.dataset.alt); return; }
    const b = e.target.closest('[data-act]');
    if (b) liveAction(b.dataset.act);
  }

  function liveAction(act) {
    if (!L || !L.running) return;
    switch (act) {
      case 'now': answerNow(); break;
      case 'shorter': case 'example': case 'reformulate': refine(act); break;
      case 'pitch': quick('pitch'); break;
      case 'prev': navAnswer(-1); break;
      case 'next': navAnswer(1); break;
      case 'bigger': bumpFont(0.1); break;
      case 'smaller': bumpFont(-0.1); break;
      case 'pip': togglePip(); break;
      case 'pause': togglePause(); break;
      case 'help': shortcutsSheet(); break;
      case 'end': endLive(); break;
      case 'recapture': recapture(); break;
      default: break;
    }
  }

  /* ---------- Transcription ---------- */
  function addTranscript(who, text, extra) {
    const line = Object.assign({ t: Date.now() - L.startMs, who, text }, extra || {});
    L.session.transcript.push(line);
    appendLine(line, L.session.transcript.length - 1);
    paintMiniTranscripts();
    scheduleSave();
    return line;
  }

  function lineHTML(line, i, prev) {
    const w = WHO[line.who] || WHO.them;
    const ask = line.who !== 'me';
    const grouped = prev && prev.who === line.who && (line.t - prev.t) < 45000;
    return `<div class="tl tl-${esc(line.who)}${ask ? ' tl-ask' : ''}${grouped ? ' tl-grouped' : ''}" data-i="${i}"${ask ? ' title="Cliquer pour obtenir une réponse à cette réplique"' : ''}>
      ${grouped ? '' : `<div class="tl-head"><span class="tl-who ${w.cls}">${w.label}</span><span class="tl-time">${fmtTime(line.t)}</span></div>`}
      <div class="tl-bubble">${esc(line.text)}${ask ? `<span class="tl-hint">${icon('bolt')}</span>` : ''}</div>
    </div>`;
  }

  function paintTranscriptFull() {
    const el = L.transcriptEl;
    if (!el) return;
    const tr = L.session.transcript;
    if (!tr.length) {
      el.innerHTML = `<div class="tr-empty">${icon('waveform')}<p>${L.manual ? 'Tapez les questions du recruteur ci-dessous : Souffleur vous propose une réponse.' : 'La conversation s’affichera ici.'}</p></div>`;
    } else {
      el.innerHTML = tr.map((l, i) => lineHTML(l, i, tr[i - 1])).join('');
    }
    paintInterims();
    scrollTranscript(true);
  }

  function appendLine(line, i) {
    const el = L.transcriptEl;
    if (!el) return;
    const empty = $('.tr-empty', el);
    if (empty) empty.remove();
    const node = h(lineHTML(line, i, L.session.transcript[i - 1]));
    const firstInterim = $('.tl-interim', el);
    el.insertBefore(node, firstInterim);
    if (L.interim[line.who] !== undefined) { delete L.interim[line.who]; paintInterims(); }
    scrollTranscript();
  }

  // Textes provisoires : un nœud par voix, mis à jour sur place (pas de clignotement).
  function paintInterims() {
    const el = L.transcriptEl;
    if (!el) return;
    const want = Object.keys(L.interim).filter((w) => L.interim[w] != null);
    $$('.tl-interim', el).forEach((n) => { if (!want.includes(n.dataset.who)) n.remove(); });
    want.forEach((who) => {
      const text = L.interim[who];
      const w = WHO[who] || WHO.them;
      const dots = !text || /^[.…\s]*$/.test(text);
      let node = $(`.tl-interim[data-who="${who}"]`, el);
      if (!node) {
        node = h(`<div class="tl tl-${esc(who)} tl-interim" data-who="${esc(who)}"><div class="tl-head"><span class="tl-who ${w.cls}">${w.label}</span></div><div class="tl-bubble"></div></div>`);
        el.appendChild(node);
      }
      const bubble = $('.tl-bubble', node);
      if (dots) { if (!$('.typing', bubble)) bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>'; }
      else bubble.textContent = text;
    });
    scrollTranscript();
  }

  function scrollTranscript(force) {
    const el = L && L.transcriptEl;
    if (!el) return;
    if (force || L.followTranscript) { el.scrollTop = el.scrollHeight; if (L.jumpEl) L.jumpEl.hidden = true; }
    else if (L.jumpEl) L.jumpEl.hidden = false;
  }

  function paintMiniTranscripts() {
    L.views.forEach((v) => {
      if (!v.mini) return;
      const tr = L.session.transcript.slice(-3);
      const inter = Object.keys(L.interim).filter((w) => L.interim[w] != null).map((w) => ({ who: w, text: L.interim[w] || '…', interim: true }));
      v.mini.innerHTML = tr.concat(inter).slice(-3).map((l) => {
        const w = WHO[l.who] || WHO.them;
        return `<div class="mini-line${l.interim ? ' interim' : ''}"><b class="${w.cls}">${w.label}</b> ${esc(l.text)}</div>`;
      }).join('') || '<div class="mini-line muted">En écoute…</div>';
    });
  }

  /* ---------- Événements audio ---------- */
  function onInterim(ev) {
    if (!L || !L.running || !ev) return;
    const who = ev.who || 'them';
    if (ev.text && simEcho(who, ev.text)) return;
    if (ev.text && !/^[.…\s]*$/.test(ev.text)) { laneSet(who, { text: String(ev.text), interim: true }); lanePulse(who, 900); }
    if (!ev.text) delete L.interim[who];
    else L.interim[who] = String(ev.text);
    if (who !== 'me' && ev.text) { L.lastThemActivity = Date.now(); speculate(String(ev.text)); }
    paintInterims();
    paintMiniTranscripts();
  }

  function onFinal(ev) {
    if (!L || !(L.running || L.draining) || !L.session || !ev) return;
    const text = String(ev.text || '').trim();
    const who = ev.who || 'them';
    if (!text) { delete L.interim[who]; paintInterims(); return; }
    if (simEcho(who, text)) { delete L.interim[who]; paintInterims(); return; }
    delete L.interim[who];
    laneSet(who, { text, interim: false });
    addTranscript(who, text);
    // Fin d'entretien : on garde les derniers passages (transcription, récap) sans lancer de réponse.
    if (L.paused || L.draining) return;
    // Le candidat a répondu : on ne garde en attente que les vraies questions du recruteur.
    if (who === 'me' && L.pendingThem.length) {
      L.pendingThem = L.pendingThem.filter((x) => isQuestion(x.text));
      if (!L.pendingThem.length) { L.firstPendingAt = 0; clearTimeout(L.autoTimer); }
    }
    if (who === 'them' || (who === 'mixed' && isQuestion(text))) {
      L.pendingThem.push({ at: Date.now(), text });
      if (!L.firstPendingAt) L.firstPendingAt = Date.now();
      L.lastThemActivity = Date.now();
      if (settings().autoAnswer !== false) armAuto();
    }
  }

  function onSpeech(ev) {
    if (!L || !ev) return;
    const who = ev.who || 'them';
    liveDocs().forEach((dc) => $$(`[data-src="${who}"]`, dc).forEach((n) => n.classList.toggle('speaking', !!ev.active)));
    laneSet(who, { active: !!ev.active });
    if (who === 'them') {
      L.themSpeaking = !!ev.active;
      L.lastThemActivity = Date.now();
      if (!ev.active && L.pendingThem.length && settings().autoAnswer !== false) armAuto();
    }
  }

  const liveDocs = () => (L.pip && L.pip.win && !L.pip.win.closed ? [L.root, L.pip.win.document] : [L.root]);
  function onLevel(ev) {
    if (!L || !ev) return;
    L.levels[ev.who || 'me'] = Number(ev.rms) || 0;
    if (L.levels[ev.who || 'me'] > 0.3) lanePulse(ev.who || 'me', 450);
    if (!L.levelRaf) L.levelRaf = requestAnimationFrame(paintLevels);
  }
  function paintLevels() {
    if (!L) return;
    L.levelRaf = 0;
    const docs = liveDocs();
    Object.keys(L.levels).forEach((who) => {
      // rms est déjà ramené sur 0..1 (échelle dBFS) par audio.js : on retire juste le bruit de fond.
      const v = clamp((L.levels[who] - 0.12) / 0.72, 0, 1).toFixed(3);
      docs.forEach((dc) => {
        let el = $(`[data-src="${who}"] .meter i`, dc);
        if (!el && who === 'me') el = $('[data-src="mixed"] .meter i', dc);
        if (!el && who === 'mixed') el = $('[data-src="me"] .meter i', dc);
        if (el) el.style.setProperty('--v', v);
      });
    });
  }

  const STATE_LABEL = { starting: 'démarrage…', listening: 'écoute', paused: 'pause', error: 'erreur', stopped: 'arrêté', restarting: 'relance…' };
  function onAudioState(ev) {
    if (!L || !ev) return;
    const who = ev.who || 'me';
    L.srcState[who] = ev;
    paintSources();
    paintAlert();
    if (ev.state === 'error' && L.running) {
      // Même texte que l'événement 'info' d'audio.js : le toast est dédoublonné.
      toast(ev.error || `${(WHO[who] || WHO.me).label} : erreur audio`, 'err', { duration: 9000 });
    }
  }
  function paintSources() {
    if (!L || !L.root) return;
    Object.keys(L.srcState).forEach((who) => {
      const ev = L.srcState[who];
      let el = $(`[data-src="${who}"]`, L.root);
      if (!el && who === 'me') el = $('[data-src="mixed"]', L.root);
      if (!el) return;
      el.dataset.state = ev.state;
      const lab = $('.src-state', el);
      if (lab) lab.textContent = ev.code === 'QUOTA_WAIT' ? 'quota, en attente' : (STATE_LABEL[ev.state] || ev.state || '');
    });
  }
  function onAudioEnded(ev) {
    if (!L || !L.running) return;
    const who = (ev && ev.who) || 'them';
    L.srcState[who] = { who, state: 'stopped' };
    paintSources();
    paintAlert();
    const b = $('[data-b="banner"]', L.root);
    if (b) {
      b.hidden = false;
      b.innerHTML = `<span class="tile tile-orange">${icon('warning')}</span><div class="grow"><b>${who === 'them' ? 'Le partage du son de l’appel s’est arrêté' : 'Le micro s’est arrêté'}</b><small>La transcription de cette voix est interrompue. Votre session continue.</small></div><button type="button" class="btn btn-sm btn-primary" data-act="recapture">${icon('refresh')}<span>Relancer la capture</span></button>`;
    }
    toast(who === 'them' ? 'Partage du son arrêté. Cliquez sur « Relancer la capture ».' : 'Le micro s’est arrêté.', 'warn', { duration: 8000 });
  }
  function recapture() {
    if (!L || !L.running || !S.audio) return;
    const p = L.preset;
    try { S.audio.stop(); } catch (e) { /* rien */ }
    let pr;
    try { pr = Promise.resolve(S.audio.start(startArg(p), { hint: hintFor(L.d) })); } catch (e) { pr = Promise.reject(e); }
    pr.then(() => {
      const b = $('[data-b="banner"]', L.root);
      if (b) b.hidden = true;
      L.paused = false;
      L.srcState = {};
      paintAlert();
      toast('Capture relancée.', 'ok');
    }, (e) => { const t = startErrorText(e); toast(`${t.title}. ${t.text}`, 'err', { duration: 9000 }); });
  }

  /* ---------- Déclenchement automatique ---------- */
  const answerDelay = () => clamp(Number(settings().answerDelayMs) || 900, 200, 5000);
  function armAuto() {
    clearTimeout(L.autoTimer);
    L.autoTimer = setTimeout(checkAuto, answerDelay());
  }
  function checkAuto() {
    if (!L || !L.running || L.paused || !L.pendingThem.length) return;
    if (settings().autoAnswer === false) return;
    const delay = answerDelay();
    const quiet = Date.now() - L.lastThemActivity;
    const waited = Date.now() - (L.firstPendingAt || Date.now());
    // Le recruteur parle encore, ou un passage est en cours de transcription : on attend
    // (au plus 7 s après la première phrase, pour ne jamais rester bloqué).
    const inFlight = L.interim.them != null && L.interim.them !== '';
    if ((L.themSpeaking || inFlight || quiet < delay) && waited < 7000) {
      L.autoTimer = setTimeout(checkAuto, Math.max(150, delay - quiet));
      return;
    }
    // Au plus un appel IA automatique toutes les 4 s (Espace force toujours une réponse).
    const since = Date.now() - (L.lastAutoAt || 0);
    if (since < AUTO_MIN_GAP) { L.autoTimer = setTimeout(checkAuto, AUTO_MIN_GAP - since + 20); return; }
    const q = takePending();
    if (!q) return;
    // Une phrase sans question (présentation de l'entreprise, « Prenez votre temps ») reste un simple
    // contexte : la transcription complète est de toute façon envoyée avec la prochaine question.
    if (!worthAnswering(q)) return;
    L.lastAutoAt = Date.now();
    answerQuestion(q, 'auto');
  }
  const AUTO_MIN_GAP = 4000;
  function worthAnswering(q) {
    if (isQuestion(q)) return true;
    const m = bestMatches(q, 1);
    return !!(m[0] && m[0].score >= 0.35);
  }
  function takePending() {
    const now = Date.now();
    const parts = L.pendingThem.filter((x) => now - x.at < 30000).slice(-4).map((x) => x.text);
    L.pendingThem = [];
    L.firstPendingAt = 0;
    return parts.join(' ').trim();
  }
  function lastAskable() {
    const tr = L.session.transcript;
    const out = [];
    for (let i = tr.length - 1; i >= 0 && out.length < 3; i--) {
      if (tr[i].who === 'me') { if (out.length) break; continue; }
      out.unshift(tr[i].text);
    }
    return out.join(' ').trim();
  }

  /* ---------- Réponses ---------- */
  function bestMatches(question, n) {
    const qs = (L.d.prep && L.d.prep.questions) || [];
    if (!question || !qs.length) return [];
    // Chaque question préparée peut porter des reformulations (q.variants) : on garde le meilleur score.
    const score = (q) => [q.q || ''].concat(Array.isArray(q.variants) ? q.variants : [])
      .reduce((m, t) => Math.max(m, similarity(question, t)), 0);
    return qs.map((q) => ({ q, score: score(q) })).filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score).slice(0, n || 3);
  }

  function pushEntry(entry, select) {
    entry.id = entry.id || uid();
    entry.t = entry.t != null ? entry.t : Date.now() - L.startMs;
    L.entries.push(entry);
    if (select !== false) L.cur = L.entries.length - 1;
    paintAnswers();
    return entry;
  }
  function recordAnswer(e) {
    if (!e || !e.text || e.info) return;
    L.session.answers.push({ t: e.t, question: e.question || '', answer: e.text, source: e.source, model: e.model || (e.source === 'prep' ? 'prep' : '') });
    scheduleSave();
  }
  const isDash = (s) => /^\s*[—–-]?\s*$/.test(String(s || ''));

  /* ---------- Réponse anticipée ----------
   * Pendant que le recruteur parle encore, dès que le texte provisoire ressemble à une question, l'IA
   * commence à répondre en coulisse. À la fin de la question, si elle est la même, on reprend ce flux
   * déjà lancé au lieu d'en démarrer un nouveau : la réponse apparaît presque aussitôt. */
  function speculate(text) {
    if (!L || !L.running || L.paused || !hasKey() || !S.ai || !S.ai.answer || settings().speculate === false) return;
    const q = String(text || '').trim();
    const words = q.split(/\s+/).length;
    if (words < 6) return;
    const t = Date.now();
    if (L.spec && (t - L.spec.at < 900 || words - L.spec.words < 3)) return;
    const m = bestMatches(q, 1)[0];
    if (!isQuestion(q) && !(m && m.score >= 0.45)) return;
    if (L.spec && similarity(L.spec.q, q) >= 0.9) return;
    if (L.spec && !L.spec.adopted) { try { L.spec.ctrl.abort(); } catch (e) { /* rien */ } }
    const ctrl = new AbortController();
    const spec = L.spec = { q, words, at: t, ctrl, text: '', listeners: [], adopted: false };
    const previous = L.entries.filter((x) => x.text && !x.info && !x.streaming).slice(-6).map((x) => ({ question: x.question, answer: x.text }));
    spec.promise = S.ai.answer({
      dossier: L.d,
      transcript: L.session.transcript.map((x) => ({ who: x.who, text: x.text })).concat([{ who: 'them', text: q }]),
      question: q, previous, mode: 'force', signal: ctrl.signal,
      onDelta: (full) => { spec.text = String(full || ''); spec.listeners.forEach((f) => f(spec.text)); }
    });
    spec.promise.catch(() => {});
  }
  // Reprend la réponse anticipée si la question finale est la même (sinon l'abandonne).
  function takeSpec(question) {
    const sp = L && L.spec;
    if (!sp) return null;
    L.spec = null;
    if (Date.now() - sp.at < 30000 && similarity(sp.q, question) >= 0.7) { sp.adopted = true; return sp; }
    try { sp.ctrl.abort(); } catch (e) { /* rien */ }
    return null;
  }
  function adoptSpec(sp, req) {
    req.signal.addEventListener('abort', () => { try { sp.ctrl.abort(); } catch (e) { /* rien */ } }, { once: true });
    if (sp.text) req.onDelta(sp.text);
    sp.listeners.push(req.onDelta);
    return sp.promise;
  }

  // Dès qu'une réponse est prête, on prépare en coulisse ses variantes : le clic les affiche aussitôt.
  const PRE_MODES = ['shorter', 'example', 'reformulate'];
  function prefetchVariants(e) {
    if (!L || !L.running || !hasKey() || !S.ai || settings().prefetch === false || e.pre || !e.question) return;
    // Une seule réponse à la fois : on abandonne les variantes encore en cours des réponses précédentes.
    L.entries.forEach((x) => { if (x !== e && x.pre) PRE_MODES.forEach((m) => { const pf = x.pre[m]; if (pf && !pf.done) { try { pf.ctrl.abort(); } catch (er) { /* rien */ } } }); });
    e.pre = {};
    const previous = L.entries.filter((x) => x.text && !x.info && !x.streaming).slice(-6).map((x) => ({ question: x.question, answer: x.text }));
    PRE_MODES.forEach((mode) => {
      const ctrl = new AbortController();
      const pf = e.pre[mode] = { ctrl, text: '', listeners: [], at: Date.now(), q: e.question };
      pf.promise = S.ai.answer({
        dossier: L.d, transcript: L.session.transcript.map((x) => ({ who: x.who, text: x.text })),
        question: e.question, previous, mode, signal: ctrl.signal, noRace: true,
        onDelta: (full) => { pf.text = String(full || ''); pf.listeners.forEach((f) => f(pf.text)); }
      });
      pf.promise.then((r) => { pf.done = true; pf.res = r; if (L && L.entries[L.cur] === e) paintNav(); }, () => { pf.failed = true; });
    });
  }

  async function answerQuestion(question, mode, base, pre) {
    if (!L || !L.running) return;
    question = String(question || '').trim();
    mode = mode || 'force';
    let prepEntry = null;
    if ((mode === 'auto' || mode === 'force') && question) {
      const m = bestMatches(question, 4);
      if (m[0] && m[0].score >= 0.55) {
        prepEntry = pushEntry({ question, text: m[0].q.a || '', source: 'prep', match: m[0].q.q, score: m[0].score, qid: m[0].q.id, alts: m.slice(1).filter((x) => x.score >= 0.3) });
        recordAnswer(prepEntry);
      }
    }
    if (!S.ai || !S.ai.answer || !hasKey()) {
      if (!prepEntry && mode !== 'auto') {
        const m = bestMatches(question, 3);
        if (m.length && m[0].score >= 0.25) {
          pushEntry({ question, text: m[0].q.a || '', source: 'prep', match: m[0].q.q, score: m[0].score, qid: m[0].q.id, alts: m.slice(1) });
        } else toast('Sans clé IA, seules les réponses préparées sont disponibles. Ajoutez une clé dans les Réglages.', 'warn');
      }
      return;
    }
    if (navigator.onLine === false) {
      setAI({ kind: 'offline' });
      if (!prepEntry && mode !== 'auto') toast('Hors ligne : l’IA est indisponible. Vos réponses préparées restent accessibles.', 'warn');
      return;
    }
    // Annulation paresseuse : les requêtes en cours ne sont annulées qu'au premier texte utile de la
    // nouvelle (si elle répond « — », la précédente va au bout). Une réponse automatique n'annule
    // jamais une demande de l'utilisateur (Répondre maintenant, Plus court, Exemple, Reformuler, Pitch).
    const ctrl = new AbortController();
    ctrl.mode = mode;
    const rivals = L.inflight.slice();
    L.inflight.push(ctrl);
    let superseded = false;
    const supersede = () => {
      if (superseded) return;
      superseded = true;
      rivals.forEach((r) => { if (!r.signal.aborted && !(mode === 'auto' && r.mode !== 'auto')) { try { r.abort(); } catch (e) { /* rien */ } } });
    };
    const entry = { id: uid(), question, text: '', source: 'ai', mode, streaming: true, t: Date.now() - L.startMs, prepText: prepEntry ? prepEntry.text : '', prepQ: prepEntry ? prepEntry.match : '', alts: prepEntry ? prepEntry.alts : [] };
    if (base && base.prepText) { entry.prepText = base.prepText; entry.prepQ = base.prepQ; }
    let shown = false;
    let raf = 0;
    const reveal = () => {
      raf = 0;
      if (ctrl.signal.aborted || !L) return;
      if (!shown) {
        if (mode === 'auto' && isDash(entry.text)) return;
        if (entry.text.trim().length < 2) return;
        shown = true;
        L.entries.push(entry);
        L.cur = L.entries.length - 1;
      }
      if (entry.text.trim().length >= 2 && !isDash(entry.text)) supersede();
      if (L.entries[L.cur] === entry) paintAnswers(); else paintNav();
    };
    if (mode !== 'auto' && !prepEntry) { shown = true; L.entries.push(entry); L.cur = L.entries.length - 1; paintAnswers(); }
    setAI({ kind: 'busy' });
    const previous = L.entries.filter((x) => x !== entry && x.text && !x.info && !x.streaming).slice(-6).map((x) => ({ question: x.question, answer: x.text }));
    try {
      const req = {
        dossier: L.d,
        transcript: L.session.transcript.map((x) => ({ who: x.who, text: x.text })),
        question,
        previous,
        mode,
        signal: ctrl.signal,
        onDelta: (full) => {
          if (ctrl.signal.aborted || !L) return;
          entry.text = String(full || '');
          if (!entry.firstAt) entry.firstAt = Date.now();
          if (!raf) raf = requestAnimationFrame(reveal);
        }
      };
      const sp = pre || ((mode === 'auto' || mode === 'force') ? takeSpec(question) : null);
      if (sp) entry.anticipated = true;
      const res = sp ? await adoptSpec(sp, req) : await S.ai.answer(req);
      if (ctrl.signal.aborted || !L) return;
      entry.text = String((res && res.text) || entry.text || '');
      entry.streaming = false;
      entry.model = res && res.model; entry.provider = res && res.provider; entry.ms = res && res.ms; entry.firstTokenMs = res && res.firstTokenMs;
      if (mode === 'auto' && isDash(entry.text)) {
        if (shown) removeEntry(entry);
        setAI({ kind: 'ok', model: entry.model, ms: entry.firstTokenMs || entry.ms, note: 'pas une question' });
        return;
      }
      if (!entry.text.trim()) { if (shown) removeEntry(entry); throw new Error('réponse vide'); }
      supersede();
      if (!shown) { shown = true; L.entries.push(entry); L.cur = L.entries.length - 1; }
      paintAnswers();
      recordAnswer(entry);
      setAI({ kind: 'ok', model: entry.model, ms: entry.firstTokenMs || entry.ms });
      if (mode === 'auto' || mode === 'force') prefetchVariants(entry);
    } catch (e) {
      if (!L) return;
      entry.streaming = false;
      if (ctrl.signal.aborted || isAbort(e)) {
        if (shown && !entry.text.trim()) removeEntry(entry);
        else if (shown) { entry.interrupted = true; paintAnswers(); }
        return;
      }
      if (shown && !entry.text.trim()) removeEntry(entry); else paintAnswers();
      setAI({ kind: 'err', error: errMsg(e) });
      if (!prepEntry) toast('L’IA n’a pas pu répondre : ' + errMsg(e), 'err');
    } finally {
      if (L) L.inflight = L.inflight.filter((c) => c !== ctrl);
      if (L && !L.inflight.length && L.aiState && L.aiState.kind === 'busy') setAI({ kind: 'idle' });
    }
  }

  function removeEntry(e) {
    const i = L.entries.indexOf(e);
    if (i < 0) return;
    L.entries.splice(i, 1);
    if (L.cur >= L.entries.length) L.cur = L.entries.length - 1;
    else if (L.cur > i) L.cur--;
    paintAnswers();
  }

  function answerNow() {
    let q = L.pendingThem.length ? takePending() : '';
    if (!q) q = lastAskable();
    if (!q) {
      const e = L.entries[L.cur];
      if (e && e.question) q = e.question;
    }
    if (!q) {
      toast('Aucune question détectée pour l’instant : tapez-la dans le champ en bas à droite.', 'info');
      const inp = $('[data-b="askin"]', L.root);
      if (inp) inp.focus();
      return;
    }
    clearTimeout(L.autoTimer);
    answerQuestion(q, 'force');
  }

  function refine(mode) {
    const e = L.entries[L.cur];
    if (!e || (!e.question && !e.text)) { toast('Aucune réponse à retravailler pour l’instant.', 'info'); return; }
    if (!hasKey()) { toast('Cette action nécessite une clé IA (Réglages).', 'warn'); return; }
    // Variante déjà préparée en coulisse : affichage immédiat (ou reprise du flux en cours).
    const pf = e.pre && e.pre[mode];
    if (pf && !pf.failed && !pf.ctrl.signal.aborted) { e.pre[mode] = null; answerQuestion(e.question, mode, e, pf); return; }
    answerQuestion(e.question || firstLine(e.text), mode, e);
  }

  function quick(kind) {
    const p = L.d.prep;
    if (kind === 'all') { allAnswersSheet(); return; }
    if (kind === 'pitch') {
      if (p && p.pitch && p.pitch.trim()) pushEntry({ question: 'Présentez-vous', text: p.pitch, source: 'prep', info: false, label: 'Pitch' });
      else if (hasKey()) answerQuestion('Présentez-vous en une minute.', 'pitch');
      else toast('Aucun pitch préparé pour ce dossier.', 'info');
      return;
    }
    const labels = { askThem: 'Questions à poser au recruteur', keyFacts: 'Chiffres clés', watchouts: 'Points de vigilance' };
    const arr = (p && p[kind]) || [];
    if (!arr.length) { toast(`Rien de préparé pour « ${labels[kind]} ».`, 'info'); return; }
    pushEntry({ question: labels[kind], text: arr.map((x) => '- ' + x).join('\n'), source: 'prep', info: true, label: 'Dossier' });
  }

  function showPrepById(qid) {
    const q = ((L.d.prep && L.d.prep.questions) || []).find((x) => x.id === qid);
    if (q) pushEntry({ question: q.q, text: q.a || '', source: 'prep', match: q.q, score: 1, qid: q.id });
  }

  function allAnswersSheet() {
    const qs = (L.d.prep && L.d.prep.questions) || [];
    if (!qs.length) { toast('Aucune réponse préparée pour ce dossier.', 'info'); return; }
    const body = h(`<div class="stack">
      <label class="search search-lg"><span>${icon('search')}</span><input type="search" placeholder="Rechercher une question…" autofocus aria-label="Rechercher"></label>
      <div class="list all-answers"></div>
    </div>`);
    const listEl = $('.all-answers', body);
    const paint = (f) => {
      const nf = normTxt(f || '');
      const items = nf ? qs.map((q) => ({ q, s: similarity(f, q.q) + (normTxt(q.q + ' ' + q.a).includes(nf) ? 0.5 : 0) })).filter((x) => x.s > 0.05).sort((a, b) => b.s - a.s).map((x) => x.q) : qs;
      listEl.innerHTML = items.map((q) => `<button type="button" class="list-row" data-qid="${esc(q.id)}"><span class="list-main"><b>${esc(q.q)}</b><small>${esc(firstLine(q.a))}</small></span>${icon('chevron-right', 'chev')}</button>`).join('') || '<div class="empty empty-sm"><p class="muted">Aucun résultat.</p></div>';
    };
    paint('');
    const s = sheet({ title: 'Réponses préparées', body, wide: true });
    $('input', body).addEventListener('input', (e) => paint(e.target.value));
    listEl.addEventListener('click', (e) => {
      const r = e.target.closest('[data-qid]');
      if (!r) return;
      showPrepById(r.dataset.qid);
      s.close();
    });
  }

  function navAnswer(delta) {
    if (!L.entries.length) return;
    L.cur = clamp(L.cur + delta, 0, L.entries.length - 1);
    paintAnswers();
  }

  function bumpFont(delta) {
    const v = Math.round(clamp((Number(settings().fontScale) || 1) + delta, 0.7, 2) * 100) / 100;
    setSettings({ fontScale: v });
    applyTheme();
    toast(`Taille du texte : ${Math.round(v * 100)} %`, 'info', { duration: 1200 });
  }

  /* ---------- Rendu de la carte réponse (fenêtre principale + flottante) ---------- */
  function answerBadge(e) {
    if (e.streaming && !e.text) return `<span class="src-badge src-ai"><span class="spinner spinner-xs"></span>L’IA rédige…</span>`;
    if (e.source === 'prep') {
      if (e.info) return `<span class="src-badge src-info">${icon('list')}${esc(e.label || 'Dossier')}</span>`;
      return `<span class="src-badge src-prep">${icon('check')}Préparée${e.score && e.score < 1 ? ` · ${Math.round(e.score * 100)}${NB}%` : ''}</span>`;
    }
    const bits = ['IA'];
    if (e.streaming) bits.push('rédaction…');
    else if (e.firstTokenMs || e.ms) bits.push(secs(e.firstTokenMs || e.ms));
    return `<span class="src-badge src-ai"${e.model ? ` title="${esc(shortModel(e.model))}"` : ''}>${e.streaming ? '<span class="spinner spinner-xs"></span>' : icon('sparkles')}${esc(bits.join(' · '))}</span>`;
  }

  function paintAnswers() {
    if (!L) return;
    L.views.forEach(paintAnswerView);
    paintNav();
  }
  function paintNav() {
    L.views.forEach((v) => {
      const n = L.entries.length;
      if (v.count) v.count.textContent = n ? `${L.cur + 1}/${n}` : '';
      if (v.prev) v.prev.disabled = L.cur <= 0;
      if (v.next) v.next.disabled = L.cur >= n - 1;
      const nav = v.prev && v.prev.parentElement;
      if (nav) nav.style.visibility = n ? '' : 'hidden';
      const e = L.entries[L.cur];
      $$('[data-act="shorter"],[data-act="example"],[data-act="reformulate"]', v.main ? L.root : v.doc).forEach((b) => {
        b.disabled = !n;
        // Pastille « prête » : la variante est déjà chargée, le clic l'affiche instantanément.
        const pf = e && e.pre && e.pre[b.dataset.act];
        b.classList.toggle('ready', !!(pf && pf.done));
      });
      // Question préparée correspondante surlignée dans la liste de droite.
      if (v.main) $$('.faq-item', L.root).forEach((b) => b.classList.toggle('on', !!(e && (b.dataset.alt === e.qid || (e.prepQ && b.textContent === e.prepQ)))));
    });
  }
  function paintAnswerView(v) {
    const e = L.entries[L.cur];
    if (!e) {
      v.q.textContent = '';
      v.q.hidden = true;
      if (v.meta) v.meta.innerHTML = '';
      v.text.classList.remove('streaming');
      v.text.innerHTML = `<div class="answer-empty">
        <div class="wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
        <p class="answer-empty-title">${L.manual ? 'Prêt' : 'À l’écoute'}</p>
        <p class="answer-empty-text">${L.manual ? 'Tapez une question pour obtenir une réponse.' : 'La réponse apparaît ici dès que le recruteur pose une question.'}${v.main ? ` <span class="nowrap"><span class="kbd">Espace</span> pour répondre tout de suite.</span>` : ''}</p>
      </div>`;
      if (v.extra) v.extra.innerHTML = '';
      return;
    }
    v.q.hidden = !e.question;
    v.q.innerHTML = e.question ? `<span class="q-label">${e.info ? icon('list') : icon('person2')}</span><span class="q-text">${esc(e.question)}</span>` : '';
    const ml = MODE_LABEL[e.mode];
    if (v.meta) v.meta.innerHTML = answerBadge(e) + (ml ? `<span class="pill pill-xs">${esc(ml)}</span>` : '') + (e.interrupted ? '<span class="pill pill-xs pill-warn">interrompue</span>' : '');
    v.text.classList.toggle('streaming', !!e.streaming);
    v.text.setAttribute('aria-busy', e.streaming ? 'true' : 'false');
    v.text.innerHTML = e.text ? md(e.text) : '<p class="muted">…</p>';
    if (v.extra) {
      let x = '';
      if (e.source === 'prep' && e.match && e.score < 0.995 && normTxt(e.match) !== normTxt(e.question)) {
        x += `<div class="match-note">${icon('check')}Réponse préparée pour : « ${esc(e.match)} »</div>`;
      }
      if (e.source === 'ai' && e.prepText) {
        x += `<details class="prep-peek"><summary>${icon('check')}Voir la réponse préparée${e.prepQ ? ` · « ${esc(e.prepQ)} »` : ''}</summary><div class="md sf">${md(e.prepText)}</div></details>`;
      }
      if (e.alts && e.alts.length && v.main) {
        x += `<div class="alts"><span class="alts-label">Aussi préparé${NB}:</span>${e.alts.slice(0, 3).map((a) => `<button type="button" class="chip chip-sm" data-alt="${esc(a.q.id)}">${esc(a.q.q)}</button>`).join('')}</div>`;
      }
      v.extra.innerHTML = x;
    }
  }

  function setAI(state) {
    if (!L) return;
    L.aiState = state || { kind: 'idle' };
    paintAI();
  }
  function paintAI() {
    if (!L) return;
    const s = L.aiState;
    let cls = 'pill', html;
    if (!hasKey()) { cls += ' pill-warn'; html = `${icon('key')}Sans IA`; }
    else if (navigator.onLine === false || s.kind === 'offline') { cls += ' pill-warn'; html = `${icon('wifi-off')}Hors ligne`; }
    else if (s.kind === 'busy') { cls += ' pill-accent'; html = '<span class="spinner spinner-xs"></span>IA en cours'; }
    else if (s.kind === 'switch') { cls += ' pill-warn'; html = '<span class="spinner spinner-xs"></span>Bascule de modèle'; }
    else if (s.kind === 'err') { cls += ' pill-err'; html = `${icon('warning')}IA en erreur`; }
    else if (s.kind === 'ok') { cls += ' pill-ok'; html = `${icon('sparkles')}<span class="ai-txt">IA prête</span>`; }
    else { cls += ' pill-ok'; html = `${icon('sparkles')}<span class="ai-txt">IA prête</span>`; }
    const quiet = hasKey() && navigator.onLine !== false && (s.kind === 'ok' || s.kind === 'idle');
    L.views.forEach((v) => { if (v.ai) { v.ai.className = 'ai-pill ' + cls + (quiet ? ' ai-quiet' : ''); v.ai.innerHTML = html; v.ai.title = s.kind === 'err' ? (s.error || '') : s.kind === 'ok' && s.model ? `${shortModel(s.model)}${s.ms ? ' · ' + secs(s.ms) : ''}${s.note ? ' · ' + s.note : ''}` : ''; } });
  }

  function tickClock() {
    if (!L || !L.running) return;
    const t = fmtTime(Date.now() - L.startMs);
    L.views.forEach((v) => { if (v.clock) v.clock.textContent = t; if (v.rec) v.rec.classList.toggle('paused', L.paused); });
  }

  /* ---------- Pause, fin, sauvegarde ---------- */
  function togglePause() {
    if (!L || !L.running || L.manual) return;
    L.paused = !L.paused;
    try { if (L.paused) S.audio.pause(); else S.audio.resume(); } catch (e) { console.warn(e); }
    clearTimeout(L.autoTimer);
    L.pendingThem = []; L.firstPendingAt = 0;
    $$('[data-act="pause"]', L.root).concat(L.pip ? $$('[data-act="pause"]', L.pip.win.document) : []).forEach((b) => {
      b.innerHTML = icon(L.paused ? 'play' : 'pause');
      b.title = L.paused ? 'Reprendre (M)' : 'Pause (M)';
      b.setAttribute('aria-label', L.paused ? 'Reprendre' : 'Pause');
      b.classList.toggle('on', L.paused);
    });
    document.body.classList.toggle('is-paused', L.paused);
    tickClock();
    toast(L.paused ? 'Écoute en pause.' : 'Écoute reprise.', 'info', { duration: 1600 });
  }

  function scheduleSave() {
    if (!L || L.saveTimer) return;
    L.saveTimer = setTimeout(flushSave, 3000);
  }
  async function flushSave() {
    if (!L) return;
    clearTimeout(L.saveTimer);
    L.saveTimer = null;
    try { await S.store.save(L.d); } catch (e) {
      console.error('[souffleur] sauvegarde', e);
      if (!L.saveWarned) { L.saveWarned = true; toast('Sauvegarde impossible : ' + errMsg(e), 'err'); }
    }
  }

  async function endLive() {
    if (!L || !L.running) return;
    const ok = await confirmSheet({ title: 'Terminer l’entretien ?', text: 'La transcription et les réponses sont enregistrées. Souffleur prépare ensuite votre récapitulatif.' + (isGuest() ? ' PC emprunté : vous pourrez tout effacer depuis le récap.' : ''), okLabel: 'Terminer', danger: true });
    if (!ok || !L || !L.running) return;
    const d = L.d, s = L.session;
    await finishLive();
    S.app.go(`#/recap/${d.id}/${s.id}`);
  }
  async function finishLive() {
    if (!L) return;
    const s = L.session;
    await drainAudio();
    if (!L) return;
    if (s && !s.endedAt) s.endedAt = nowIso();
    const d = L.d;
    teardownLive(true);
    await flushSaveFor(d);
  }
  // Arrête la capture en laissant la transcription des derniers passages se terminer : leurs finales
  // sont encore enregistrées dans la session (et donc dans le récap), sans déclencher de réponse.
  async function drainAudio() {
    if (!L || L.draining || L.audioStopped) return;
    if (!L.audio || !S.audio || !S.audio.stop) return;
    L.draining = true;
    clearTimeout(L.autoTimer);
    L.pendingThem = []; L.firstPendingAt = 0;
    const btns = $$('[data-act="end"]', L.root);
    btns.forEach((b) => { b.disabled = true; });
    let busy = false;
    try {
      const st = S.audio.status && S.audio.status();
      busy = !!(st && st.channels && st.channels.some((c) => c.pending > 0));
    } catch (e) { /* rien */ }
    if (busy) toast('Finalisation de la transcription…', 'info', { duration: 4000 });
    try { await S.audio.stop({ drainMs: 8000 }); } catch (e) { console.warn(e); }
    if (!L) return;
    L.audioStopped = true;
    L.audio = false;
    L.draining = false;
    btns.forEach((b) => { b.disabled = false; });
  }
  async function flushSaveFor(d) { try { await S.store.save(d); } catch (e) { toast('Sauvegarde impossible : ' + errMsg(e), 'err'); } }

  function teardownLive(keepState) {
    if (!L) return;
    const wasRunning = L.running;
    L.running = false;
    clearTimeout(L.autoTimer);
    clearTimeout(L.stageTimer);
    if (L.spec) { try { L.spec.ctrl.abort(); } catch (e) { /* rien */ } L.spec = null; }
    (L.entries || []).forEach((x) => { if (x.pre) PRE_MODES.forEach((m) => { const pf = x.pre[m]; if (pf && !pf.done) { try { pf.ctrl.abort(); } catch (er) { /* rien */ } } }); });
    Object.values(L.laneT || {}).forEach(clearTimeout);
    if (L.sim && 'speechSynthesis' in window) speechSynthesis.cancel();
    clearTimeout(L.saveTimer); L.saveTimer = null;
    clearInterval(L.clock);
    if (L.levelRaf) cancelAnimationFrame(L.levelRaf);
    L.inflight.forEach((c) => { try { c.abort(); } catch (e) { /* rien */ } });
    L.inflight = [];
    stopMeter();
    unsubscribeAudio();
    if ((wasRunning || L.audio) && !L.audioStopped && S.audio && S.audio.stop) { try { S.audio.stop(); } catch (e) { /* rien */ } }
    L.audio = false;
    L.draining = false;
    removeLiveListeners();
    releaseWake();
    closePip();
    document.body.classList.remove('is-live', 'is-paused');
    if (!keepState) L = null;
  }

  async function canLeaveLive() {
    if (!L || !L.running) return true;
    const ok = await confirmSheet({ title: 'Quitter l’entretien en cours ?', text: 'L’écoute va s’arrêter. La transcription et les réponses sont enregistrées.', okLabel: 'Quitter', danger: true });
    if (ok && L && L.running) await finishLive();
    return ok;
  }
  async function leaveLive() {
    if (!L) return null;
    if (L.running) await finishLive();
    if (L) teardownLive(false);
    return null;
  }

  /* ---------- Écouteurs globaux du live ---------- */
  function addLiveListeners() {
    const add = (target, evt, fn, opt) => { target.addEventListener(evt, fn, opt); L.listeners.push(() => target.removeEventListener(evt, fn, opt)); };
    add(document, 'keydown', onLiveKey);
    add(window, 'beforeunload', (e) => { if (L && L.running) { flushSave(); e.preventDefault(); e.returnValue = ''; return ''; } });
    add(window, 'pagehide', () => { if (L) flushSave(); });
    add(document, 'visibilitychange', () => {
      if (!L) return;
      if (document.visibilityState === 'hidden') flushSave();
      else if (L.running && (!L.wake || L.wake.released)) requestWake();
    });
    add(window, 'online', () => { paintAI(); });
    add(window, 'offline', () => { paintAI(); toast('Connexion perdue : l’IA est en pause, vos réponses préparées restent disponibles.', 'warn'); });
  }
  function removeLiveListeners() {
    if (!L) return;
    L.listeners.forEach((f) => { try { f(); } catch (e) { /* rien */ } });
    L.listeners = [];
  }

  function onLiveKey(e) {
    if (!L || !L.running) return;
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target) || topSheetLayer()) return;
    const k = e.key;
    const map = {
      ' ': 'now', Spacebar: 'now', r: 'reformulate', R: 'reformulate', c: 'shorter', C: 'shorter', e: 'example', E: 'example',
      p: 'pitch', P: 'pitch', ArrowLeft: 'prev', ArrowRight: 'next', '+': 'bigger', '=': 'bigger', '-': 'smaller', '_': 'smaller',
      f: 'pip', F: 'pip', m: 'pause', M: 'pause', '?': 'help'
    };
    if (L.sim && (k === 'n' || k === 'N')) { e.preventDefault(); simNext(); return; }
    const act = map[k];
    if (!act) return;
    e.preventDefault();
    liveAction(act);
  }

  function shortcutsSheet() {
    const rows = [['Espace', 'Répondre maintenant à la dernière question'], ['R', 'Reformuler (régénérer)'], ['C', 'Plus court'], ['E', 'Exemple concret'], ['P', 'Pitch'],
      ['← →', 'Réponse précédente / suivante'], ['+ −', 'Taille du texte'], ['F', 'Fenêtre flottante'], ['M', 'Pause / reprise'], ['?', 'Cette aide']];
    sheet({
      title: 'Raccourcis clavier',
      body: `<div class="list">${rows.map(([k, l]) => `<div class="list-row"><span class="list-main">${esc(l)}</span><span class="kbd">${esc(k)}</span></div>`).join('')}</div>`,
      actions: [{ label: 'OK', kind: 'primary' }]
    });
  }

  /* ---------- Wake Lock ---------- */
  async function requestWake() {
    if (!L || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      L.wake = await navigator.wakeLock.request('screen');
      if (!L || !L.running) { releaseWake(); }
    } catch (e) { /* écran de veille non bloquable : sans gravité */ }
  }
  function releaseWake() {
    if (!L || !L.wake) return;
    try { L.wake.release(); } catch (e) { /* rien */ }
    L.wake = null;
  }

  /* ---------- Fenêtre flottante (Document Picture-in-Picture, repli popup) ---------- */
  function togglePip() {
    if (!L || !L.running) return;
    if (L.pip) { closePip(); return; }
    // Aucun await avant requestWindow : l'appel doit rester dans le geste utilisateur.
    if ('documentPictureInPicture' in window) {
      window.documentPictureInPicture.requestWindow({ width: 420, height: 560 })
        .then((win) => setupPip(win, 'pip'))
        .catch((e) => { console.warn('[souffleur] PiP', e); openPopupFallback(); });
    } else openPopupFallback();
  }
  function openPopupFallback() {
    if (!L || !L.running) return;
    let win = null;
    try { win = window.open('', 'souffleur-flottant', 'popup=yes,width=420,height=600'); } catch (e) { win = null; }
    if (!win) { toast('Fenêtre flottante bloquée : autorisez les fenêtres pop-up pour ce site, ou utilisez Chrome ou Edge.', 'warn', { duration: 9000 }); return; }
    try {
      win.document.open();
      win.document.write('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Souffleur</title></head><body></body></html>');
      win.document.close();
    } catch (e) { /* rien */ }
    setupPip(win, 'popup');
    toast('Fenêtre séparée ouverte. Pour qu’elle reste au premier plan, utilisez Chrome ou Edge récent.', 'info');
  }
  function copyStyles(doc) {
    $$('style, link[rel="stylesheet"]').forEach((n) => {
      if (n.tagName === 'LINK') {
        let css = '';
        try { css = Array.from(n.sheet.cssRules).map((r) => r.cssText).join('\n'); } catch (e) { css = ''; }
        if (css) { const s = doc.createElement('style'); s.textContent = css; doc.head.appendChild(s); }
        else { const l = doc.createElement('link'); l.rel = 'stylesheet'; l.href = n.href; doc.head.appendChild(l); }
      } else {
        const s = doc.createElement('style'); s.textContent = n.textContent; doc.head.appendChild(s);
      }
    });
  }
  function setupPip(win, kind) {
    if (!L || !L.running) { try { win.close(); } catch (e) { /* rien */ } return; }
    const doc = win.document;
    try { doc.title = 'Souffleur'; } catch (e) { /* rien */ }
    copyStyles(doc);
    doc.documentElement.lang = 'fr';
    doc.body.className = 'pip-body';
    doc.body.innerHTML = `<div class="pip">
      <div class="pip-head">
        <span class="rec" data-p="rec"><span class="rec-dot"></span><span class="live-clock" data-p="clock">00:00</span></span>
        <span class="pip-srcs">${sourcesFor(L.preset).map((w) => `<span class="pip-src ${WHO[w].cls}" data-src="${w}" title="${WHO[w].label}"><span class="meter meter-xs"><i style="--v:0"></i></span></span>`).join('')}</span>
        <span class="ai-pill pill" data-p="ai"></span>
        <span class="spacer"></span>
        <button type="button" class="icon-btn icon-btn-sm" data-act="pause" title="Pause (M)" aria-label="Pause"${L.manual ? ' hidden' : ''}>${icon(L.paused ? 'play' : 'pause')}</button>
      </div>
      <div class="pip-alert" data-p="alert" role="alert" hidden></div>
      <div class="pip-q answer-q" data-p="q"></div>
      <div class="pip-meta answer-meta" data-p="meta"></div>
      <div class="pip-answer answer-text md sf" data-p="text" aria-live="polite"></div>
      <div class="pip-actions">
        <button type="button" class="icon-btn icon-btn-sm" data-act="prev" aria-label="Réponse précédente">${icon('chevron-left')}</button>
        <span class="answer-count" data-p="count"></span>
        <button type="button" class="icon-btn icon-btn-sm" data-act="next" aria-label="Réponse suivante">${icon('chevron-right')}</button>
        <span class="spacer"></span>
        <button type="button" class="btn btn-sm" data-act="shorter">Plus court</button>
        <button type="button" class="btn btn-sm btn-primary" data-act="now">${icon('bolt')}<span>Répondre</span></button>
      </div>
      <div class="pip-mini" data-p="mini"></div>
    </div>`;
    const P = (k) => doc.querySelector(`[data-p="${k}"]`);
    const view = { doc, q: P('q'), meta: P('meta'), text: P('text'), count: P('count'), prev: doc.querySelector('[data-act="prev"]'), next: doc.querySelector('[data-act="next"]'), ai: P('ai'), clock: P('clock'), rec: P('rec'), mini: P('mini'), alert: P('alert'), main: false };
    L.pip = { win, kind, view };
    L.views.push(view);
    applyTheme();
    doc.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) liveAction(b.dataset.act); });
    doc.addEventListener('keydown', onLiveKey);
    const onGone = () => {
      if (!L || !L.pip || L.pip.win !== win) return;
      L.views = L.views.filter((x) => x !== view);
      L.pip = null;
      $$('[data-act="pip"]', L.root).forEach((b) => b.classList.remove('on'));
    };
    win.addEventListener('pagehide', onGone);
    win.addEventListener('unload', onGone);
    $$('[data-act="pip"]', L.root).forEach((b) => b.classList.add('on'));
    paintAnswers(); paintAI(); paintMiniTranscripts(); tickClock(); paintAlert();
  }
  // Alerte visible aussi dans la fenêtre flottante (c'est elle que l'on regarde pendant Meet / Teams).
  function paintAlert() {
    if (!L) return;
    let msg = '', canRelaunch = false;
    Object.keys(L.srcState).forEach((who) => {
      const ev = L.srcState[who];
      if (!ev || msg) return;
      if (ev.state === 'stopped' && L.running && !L.draining) { msg = who === 'them' ? 'Le son de l’appel n’est plus capté.' : 'Le micro s’est arrêté.'; canRelaunch = true; }
      else if (ev.state === 'error') { msg = ev.error || 'Erreur audio.'; canRelaunch = true; }
      else if (ev.code === 'QUOTA_WAIT') msg = 'Quota IA atteint : transcription en attente.';
    });
    L.views.forEach((v) => {
      if (v.rec) v.rec.classList.toggle('stopped', !!canRelaunch);
      if (!v.alert) return;
      v.alert.hidden = !msg;
      v.alert.innerHTML = msg ? `${icon('warning')}<span class="grow">${esc(msg)}</span>${canRelaunch ? '<button type="button" class="btn btn-sm" data-act="recapture">Relancer</button>' : ''}` : '';
    });
  }
  function closePip() {
    if (!L || !L.pip) return;
    const w = L.pip.win;
    L.views = L.views.filter((x) => x !== L.pip.view);
    L.pip = null;
    try { w.close(); } catch (e) { /* rien */ }
    if (L.root) $$('[data-act="pip"]', L.root).forEach((b) => b.classList.remove('on'));
  }

  /* ====================================================================== *
   *  Enregistrement des écrans du cœur
   * ====================================================================== */
  routes[''] = { render: renderHome, leave: leaveHome };
  routes.dossier = { render: renderDossier, leave: leaveDossier };
  routes.live = { render: renderLive, leave: leaveLive, canLeave: canLeaveLive };

  /* ====================================================================== *
   *  Démarrage
   * ====================================================================== */
  let lastErrToast = 0;
  function reportError(msg) {
    const now = Date.now();
    if (now - lastErrToast < 6000) return;
    lastErrToast = now;
    toast('Erreur inattendue : ' + msg, 'err');
  }
  window.addEventListener('error', (e) => {
    if (!e || !e.message || /ResizeObserver/.test(e.message)) return;
    if (e.filename && !/\/js\/|souffleur|index\.html|\/$/i.test(e.filename) && e.filename !== location.href) return;
    console.error('[souffleur]', e.error || e.message);
    reportError(e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    if (isAbort(r)) return;
    console.error('[souffleur] promesse rejetée', r);
    reportError(errMsg(r));
  });

  // Clés API présentes dans un fichier importé : appliquées d'office si aucune clé n'existait, sinon proposées.
  // Stockage bloqué (navigation privée, PC verrouillé) : rien ne survivra à la fermeture de l'onglet.
  function showStorageWarning() {
    const b = document.createElement('div');
    b.className = 'banner storage-banner card';
    b.setAttribute('role', 'alert');
    b.innerHTML = `<span class="tile tile-orange">${icon('warning')}</span><div class="grow"><b>Stockage bloqué sur ce navigateur</b><small>Vos dossiers ne seront pas conservés après fermeture. Exportez-les avant de partir.</small></div><button type="button" class="btn btn-sm btn-primary">${icon('export')}<span>Tout exporter</span></button>`;
    b.querySelector('button').addEventListener('click', async () => {
      try { const f = await S.store.exportAll(); S.util.download(f, f.name || 'souffleur-sauvegarde.json'); } catch (e) { toast('Export impossible : ' + errMsg(e), 'err'); }
    });
    const view = document.getElementById('view');
    if (view && view.parentNode) view.parentNode.insertBefore(b, view);
    window.addEventListener('beforeunload', (e) => { if (L && L.running) return; e.preventDefault(); e.returnValue = ''; });
  }

  function onImportedKeys(x) {
    if (!x) return;
    const names = (ks) => ks.map((k) => (k === 'claudeKey' ? 'Claude' : k === 'groqKey' ? 'Groq' : 'Gemini')).join(' et ');
    if (x.applied && x.applied.length && x.sessionOnly) {
      // PC emprunté probable : la clé du fichier n'est gardée que pour cette session (onglet).
      sheet({
        title: 'Clé chargée pour cette session',
        body: `<p>La clé ${names(x.applied)} contenue dans ce fichier est utilisée <b>jusqu’à la fermeture de l’onglet</b>, sans être enregistrée sur cet appareil.</p><p class="small muted">Sur un PC qui n’est pas le vôtre, gardez ce choix. Après l’entretien, « Effacer de ce PC » (accueil) supprime aussi vos dossiers.</p>`,
        actions: [
          { label: 'Se souvenir sur cet appareil', kind: 'ghost', onClick: () => { try { x.remember(); toast('Clé enregistrée sur cet appareil.', 'ok'); } catch (e) { /* rien */ } } },
          { label: 'Session seulement', kind: 'primary' }
        ]
      });
    } else if (x.applied && x.applied.length) toast(`Clé ${names(x.applied)} importée avec le dossier.`, 'ok');
    const pend = Object.keys(x.pending || {});
    if (!pend.length || typeof x.apply !== 'function') return;
    confirmSheet({
      title: 'Utiliser les clés du fichier ?',
      text: `Ce fichier contient une clé ${names(pend)} différente de celle enregistrée sur cet appareil. Voulez-vous la remplacer ?`,
      okLabel: 'Remplacer', cancelLabel: 'Garder la mienne'
    }).then((ok) => {
      if (!ok) return;
      try { x.apply(); toast('Clé remplacée.', 'ok'); } catch (e) { toast('Clé non enregistrée : ' + errMsg(e), 'err'); }
    });
  }

  async function boot() {
    bootHTML = '<!doctype html>\n' + document.documentElement.outerHTML;
    applyTheme();
    hydrateIcons(document);
    updateNet();
    window.addEventListener('online', updateNet);
    window.addEventListener('offline', updateNet);
    if (S.bus && S.bus.on) {
      S.bus.on('toast', (dta) => {
        if (typeof dta === 'string') toast(dta, 'info');
        else if (dta) toast(dta.msg || dta.message || dta.text || '', dta.kind || 'info', dta);
      });
      S.bus.on('settings:changed', () => { applyTheme(); if (L && L.running) paintAI(); });
      S.bus.on('store:keys', onImportedKeys);
      // Modifications faites dans un autre onglet (BroadcastChannel / événement storage).
      S.bus.on('store:changed', (x) => {
        if (!x || !x.remote || !current || (L && L.running)) return;
        if (current.name === '') { route(true); return; }
        if (current.name === 'dossier' && DX && (x.id === DX.d.id || x.action === 'clear')) {
          toast('Ce dossier a été modifié dans un autre onglet.', 'info', { duration: 8000, action: { label: 'Recharger', onClick: () => route(true) } });
        }
      });
      S.bus.on('ai:keyerror', (x) => {
        const name = x && x.provider === 'claude' ? 'Claude' : 'Gemini';
        toast(`Clé ${name} refusée : vérifiez-la dans les Réglages.`, 'err', { action: { label: 'Réglages', onClick: () => S.app.go('#/settings') }, duration: 9000 });
      });
      S.bus.on('ai:status', (x) => {
        if (!L || !L.running || !x) return;
        if (x.ok === false && L.aiState.kind === 'busy') setAI({ kind: 'switch', model: x.model, error: x.error });
        else if (x.ok && L.aiState.kind === 'switch') setAI({ kind: 'busy' });
      });
    }
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('[data-go]');
      if (!a || e.defaultPrevented || e.button > 0 || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      S.app.go(a.dataset.go);
    });
    try {
      if (!S.store || !S.store.init) throw new Error('module de stockage absent');
      await S.store.init();
    } catch (e) {
      console.error('[souffleur] stockage', e);
      const view = document.getElementById('view');
      if (view) view.innerHTML = `<div class="screen"><div class="empty empty-page card"><div class="empty-ic">${icon('warning')}</div><h1 class="h2">Démarrage impossible</h1><p class="muted">Le stockage local est inaccessible (${esc(errMsg(e))}). Fermez la navigation privée ou autorisez le stockage pour ce site, puis rechargez.</p><div class="row center"><button type="button" class="btn btn-primary" onclick="location.reload()">Recharger</button></div></div></div>`;
      return;
    }
    applyTheme();
    if (S.store.backend === 'memory') showStorageWarning();
    const embeddedId = await importEmbedded();
    if (embeddedId && (!location.hash || location.hash === '#' || location.hash === '#/')) history.replaceState(null, '', '#/dossier/' + embeddedId);
    // Fichier autonome ouvert sur un autre PC avec les clés incluses : pas besoin de la prise en main.
    if (embeddedId && !settings().onboarded && hasKey()) setSettings({ onboarded: true });
    booted = true;
    window.addEventListener('hashchange', () => route(false));
    await route(true);
    registerSW();
    // App installée (launch_handler « focus-existing ») : un raccourci du manifeste réutilise la fenêtre ouverte.
    try {
      if (window.launchQueue && typeof window.launchQueue.setConsumer === 'function') {
        window.launchQueue.setConsumer((p) => {
          let u = null;
          try { u = p && p.targetURL ? new URL(p.targetURL) : null; } catch (e) { u = null; }
          if (u && u.hash && u.hash !== location.hash && !(L && L.running)) S.app.go(u.hash);
        });
      }
    } catch (e) { /* rien */ }
    try { if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then((p) => { if (!p && navigator.storage.persist) navigator.storage.persist().catch(() => {}); }).catch(() => {}); } catch (e) { /* rien */ }
    if (!settings().onboarded && typeof S.app.onboarding === 'function') {
      try { await S.app.onboarding(); } catch (e) { console.warn('[souffleur] onboarding', e); }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 0);
})(window.Souffleur = window.Souffleur || {});
