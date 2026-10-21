#!/usr/bin/env node
// Souffleur — captures finales de chaque écran + audit visuel automatique (mise en page, contraste, cibles tactiles…).
//   node tests/final-shots.mjs [filtre]
// Variantes : 1440×900 clair, 1440×900 sombre, 390×844 (mobile, clair). Captures : tests/shots/final-<écran>-<variante>.png
// API IA mockées (aucun appel réseau réel). Code de sortie 1 si l'audit trouve un défaut bloquant.
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../tools/serve.mjs';
import {
  SHOTS, FIXTURES, sleep, createMock, ensureSpeechWav, launchBrowser, newContext, watchErrors,
  GEMINI_KEY, QUESTION_FR, PREP, RECAP_MD, TRAINING_Q
} from './e2e-lib.mjs';

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ');
const VARIANTS = [
  { id: 'desktop-light', viewport: { width: 1440, height: 900 }, dark: false },
  { id: 'desktop-dark', viewport: { width: 1440, height: 900 }, dark: true },
  { id: 'mobile', viewport: { width: 390, height: 844 }, dark: false, mobile: true, dsf: 2 }
];

const tomorrow = (h) => { const d = new Date(Date.now() + 86400e3); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(h)}:00`; };
const DOCS = [
  { kind: 'offre', name: 'Offre RAF — Hélios Énergie.pdf', method: 'pdfjs', text: 'Missions : piloter la clôture mensuelle, la trésorerie et le reporting. Profil recherché : 8 ans d’expérience. '.repeat(30) },
  { kind: 'cv', name: 'CV Camille Martin 2026.docx', method: 'docx', text: 'Expérience professionnelle, formation, compétences. '.repeat(60) },
  { kind: 'prepa', name: 'Fiche de préparation entretien.md', method: 'text', text: 'Questions possibles et réponses. '.repeat(25) }
];

const problems = [];
const notes = [];

/* ------------------------------------------------------------------ audit DOM */

async function audit(page, name, variant) {
  const r = await page.evaluate(({ mobile, dark }) => {
    const out = { bad: [], warn: [] };
    const vw = innerWidth, vh = innerHeight;
    const vis = (el) => {
      if (!el.isConnected) return false;
      // Contenu d'un <details> fermé : non rendu (content-visibility), même si sa boîte existe encore.
      const closed = el.closest('details:not([open])');
      if (closed && !el.closest('summary')) return false;
      if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      for (let p = el; p && p !== document.body; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (ps.display === 'none' || ps.visibility === 'hidden' || Number(ps.opacity) === 0) return false;
        if (p.hidden) return false;
      }
      return true;
    };
    const label = (el) => {
      const t = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}${t ? ` « ${t} »` : ''}`;
    };
    const layer = document.querySelector('.sheet-layer:not(.out)');
    const scope = layer ? layer : document.body;

    // 1. Défilement horizontal de la page
    const sw = document.scrollingElement.scrollWidth;
    if (sw > vw + 1) out.bad.push(`défilement horizontal de la page (${sw}px pour ${vw}px)`);

    // 2. Éléments qui sortent de l'écran à droite (hors conteneurs défilants)
    const scrollParent = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return p; } return null; };
    scope.querySelectorAll('button, a, input, select, textarea, .pill, .chip, h1, h2, h3, p, .card').forEach((el) => {
      if (!vis(el)) return;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 2 && !scrollParent(el)) out.bad.push(`dépasse à droite : ${label(el)} (${Math.round(r.right)}px)`);
    });

    // 3. Texte coupé sans points de suspension
    scope.querySelectorAll('button, .pill, .chip, .btn, label, .list-main b, .list-main small, .dcard-name, .topbar-title, .h1, .h2, .h3, .src-badge, .tl-bubble, .answer-q').forEach((el) => {
      if (!vis(el)) return;
      const s = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 2 && /(hidden|clip)/.test(s.overflowX) && s.textOverflow !== 'ellipsis' && el.clientWidth > 0) out.bad.push(`texte coupé : ${label(el)}`);
    });

    // 4. Chevauchement de contrôles interactifs
    const ctrls = Array.from(scope.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [data-go]')).filter((el) => vis(el) && !el.closest('.switch'));
    const rects = ctrls.map((el) => el.getBoundingClientRect());
    for (let i = 0; i < ctrls.length; i++) {
      for (let j = i + 1; j < ctrls.length; j++) {
        const a = ctrls[i], b = ctrls[j];
        if (a.contains(b) || b.contains(a)) continue;
        const A = rects[i], B = rects[j];
        const w = Math.min(A.right, B.right) - Math.max(A.left, B.left);
        const h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
        if (w > 4 && h > 4 && w * h > 0.25 * Math.min(A.width * A.height, B.width * B.height)) {
          // Contrôles fixes (barre d'onglets, toasts) au-dessus du contenu qui défile : normal.
          const fixed = (el) => { for (let p = el; p; p = p.parentElement) { const ps = getComputedStyle(p).position; if (ps === 'fixed' || ps === 'sticky') return true; } return false; };
          if (fixed(a) !== fixed(b)) continue;
          out.bad.push(`chevauchement : ${label(a)} / ${label(b)}`);
        }
      }
    }

    // 5. Cibles tactiles (mobile)
    if (mobile) {
      ctrls.forEach((el, i) => {
        const r = rects[i];
        if (el.matches('input[type=checkbox], input[type=radio], input[type=range], textarea, input, select')) return;
        if (el.closest('.md, .tl-bubble, .dg-detail, .small')) return;
        if (r.height < 30 || r.width < 30) out.bad.push(`cible tactile trop petite (${Math.round(r.width)}×${Math.round(r.height)}) : ${label(el)}`);
        else if (r.height < 40) out.warn.push(`cible tactile < 40 px (${Math.round(r.height)} px) : ${label(el)}`);
      });
    }

    // 6. Contraste (texte direct des éléments ; fonds translucides composés jusqu'au fond de page)
    const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
    const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const pageBg = dark ? { r: 0, g: 0, b: 0, a: 1 } : { r: 242, g: 242, b: 247, a: 1 };
    const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
    const bgOf = (el) => {
      const stack = [];
      for (let p = el; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.backgroundImage && s.backgroundImage !== 'none' && /gradient/.test(s.backgroundImage) && !/^(HTML|BODY)$/.test(p.tagName)) return null; // dégradé : non évalué
        const c = parse(s.backgroundColor);
        if (c && c.a > 0) stack.push(c);
        if (c && c.a >= 0.98) break;
      }
      let bg = pageBg;
      for (let i = stack.length - 1; i >= 0; i--) bg = over(stack[i], bg);
      return bg;
    };
    const seen = new Set();
    scope.querySelectorAll('body *').forEach((el) => {
      if (!el.childNodes.length || seen.size > 1500) return;
      const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
      if (!own || !vis(el)) return;
      const s = getComputedStyle(el);
      if (el.closest('.kbd, .avatar, .rec, .tile, .drop-hint, .aurora, [aria-hidden="true"], .is-disabled, :disabled, .disabled, .typing, .wave')) return;
      const fg = parse(s.color);
      const bg = bgOf(el);
      if (!fg || !bg) return;
      const f = over(Object.assign({}, fg, { a: fg.a * Number(s.opacity || 1) }), bg);
      const cr = ratio(f, bg);
      const big = parseFloat(s.fontSize) >= 18.5 || (parseFloat(s.fontSize) >= 14 && Number(s.fontWeight) >= 700);
      const key = `${label(el)}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (cr < (big ? 2.6 : 3.4)) out.bad.push(`contraste faible ${cr.toFixed(2)} : ${key}`);
      else if (cr < (big ? 3 : 4.5)) out.warn.push(`contraste ${cr.toFixed(2)} (< AA) : ${key}`);
    });

    // 7. Zones claires oubliées en mode sombre
    if (dark) {
      scope.querySelectorAll('body *').forEach((el) => {
        if (!vis(el) || el.closest('.aurora, .avatar, .tile, svg, img, .meter, .switch, .seg, .btn-primary, .pill, .dg-badge, .kbd')) return;
        const c = parse(getComputedStyle(el).backgroundColor);
        const r = el.getBoundingClientRect();
        if (c && c.a > 0.55 && lum(c) > 0.6 && r.width * r.height > 900) out.bad.push(`zone claire en mode sombre : ${label(el)}`);
      });
    }

    // 8. Icônes vides, images cassées, textes techniques visibles
    scope.querySelectorAll('svg.ico').forEach((s) => { if (vis(s) && !s.children.length) out.bad.push('icône vide'); });
    scope.querySelectorAll('img').forEach((im) => { if (vis(im) && im.complete && !im.naturalWidth) out.bad.push(`image cassée : ${im.src.slice(0, 60)}`); });
    const txt = (layer || document.body).innerText || '';
    const tech = /\b(undefined|NaN|null|\[object Object\])\b/.exec(txt);
    if (tech) out.bad.push(`texte technique visible : « ${tech[0]} »`);

    // 9. Barre d'onglets mobile : le bas de page reste atteignable
    const tab = document.getElementById('tabbar');
    if (mobile && tab && vis(tab) && !layer) {
      const tr = tab.getBoundingClientRect();
      const se = document.scrollingElement;
      const prev = se.scrollTop;
      se.scrollTop = se.scrollHeight;
      const last = Array.from(document.querySelectorAll('#view button, #view a[href], #view input, #view textarea')).filter(vis).pop();
      if (last) { const lr = last.getBoundingClientRect(); if (lr.bottom > tr.top + 2 && lr.top < tr.bottom) out.bad.push(`dernier contrôle masqué par la barre d’onglets : ${label(last)}`); }
      se.scrollTop = prev;
    }
    out.bad = Array.from(new Set(out.bad));
    out.warn = Array.from(new Set(out.warn));
    return out;
  }, { mobile: !!variant.mobile, dark: !!variant.dark });
  r.bad.forEach((m) => problems.push(`${name} [${variant.id}] ${m}`));
  r.warn.forEach((m) => notes.push(`${name} [${variant.id}] ${m}`));
}

/* ------------------------------------------------------------------ scènes */

async function boot(page, base, hash, { onboarded = true, key = true } = {}) {
  await page.goto(`${base}?s=${Date.now()}${hash}`);
  await page.waitForFunction(() => window.Souffleur && Souffleur.store && document.querySelector('#view .route'));
  if (onboarded) await page.evaluate(() => document.querySelectorAll('.sheet-layer').forEach((n) => n.remove()));
  await page.evaluate(({ key, onboarded, k }) => Souffleur.store.setSettings({ onboarded, geminiKey: key ? k : '', rememberKeys: true, audioPreset: 'visio-casque' }), { key, onboarded, k: GEMINI_KEY });
}

async function seed(page) {
  return page.evaluate(async ({ PREP, DOCS, d1, RECAP_MD }) => {
    const S = window.Souffleur;
    for (const d of await S.store.list()) await S.store.remove(d.id);
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    const mk = async (p) => { const d = await S.store.create(p); return d; };
    const live = { id: 'sess-live', kind: 'live', startedAt: iso(now - 26 * 3600e3), endedAt: iso(now - 25.5 * 3600e3),
      transcript: [{ t: 2000, who: 'them', text: 'Bonjour, merci d’être là. Pouvez-vous vous présenter ?' }, { t: 9000, who: 'me', text: 'Bonjour, je suis contrôleur de gestion depuis huit ans.' }, { t: 60000, who: 'them', text: 'Pourquoi voulez-vous rejoindre notre entreprise ?' }],
      answers: [{ t: 3000, question: 'Pouvez-vous vous présenter ?', answer: PREP.questions[0].a, source: 'prep', model: 'prep' }, { t: 61000, question: 'Pourquoi voulez-vous rejoindre notre entreprise ?', answer: PREP.questions[1].a, source: 'ai', model: 'gemini-3.8-flash' }],
      scores: null, recap: RECAP_MD };
    const tr = { id: 'sess-tr', kind: 'training', startedAt: iso(now - 50 * 3600e3), endedAt: iso(now - 49.8 * 3600e3), transcript: [], answers: [],
      scores: [{ question: 'Parlez-moi d’une réussite professionnelle.', answer: 'J’ai réduit la clôture de six jours.', score: 8, feedback: '- ✓ Concret\n- → Lien avec le poste' }, { question: 'Quel est votre principal défaut ?', answer: 'Je délègue peu.', score: 6, feedback: '- → Donnez un exemple' }], recap: null };
    const a = await mk({ company: 'Hélios Énergie', role: 'Responsable administratif et financier', interviewer: 'Claire Martin, DRH', date: d1, mode: 'visio', name: 'Hélios Énergie · RAF',
      docs: DOCS.map((x, i) => Object.assign({ id: 'doc' + i, addedAt: iso(now) }, x)), prep: Object.assign(JSON.parse(JSON.stringify(PREP)), { generatedAt: iso(now - 3 * 3600e3), model: 'gemini-3.8-flash' }), sessions: [live, tr] });
    const b = await mk({ company: 'Banque des Territoires', role: 'Contrôleur de gestion senior', date: '', mode: 'tel', docs: DOCS.slice(0, 1).map((x) => Object.assign({ id: 'dx', addedAt: iso(now) }, x)) });
    const c = await mk({ company: 'Direction générale de l’énergie et du climat', role: 'Chargé de mission budget et performance', date: '', mode: 'presentiel' });
    return { a: a.id, b: b.id, c: c.id };
  }, { PREP, DOCS, d1: tomorrow(11), RECAP_MD });
}

async function settle(page, ms = 650) {
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await sleep(ms);
}

/* ------------------------------------------------------------------ exécution */

const wav = ensureSpeechWav();
const srv = await startServer({ port: 0, dir: 'src', quiet: true });
const BASE = `${srv.url}index.html`;
const browser = await launchBrowser({ wav: wav.file });
const mock = createMock();
const jsErrors = [];
let shots = 0;

for (const v of VARIANTS) {
  const ctx = await newContext(browser, mock, v);
  watchErrors(ctx, (m) => jsErrors.push(`[${v.id}] ${m}`));
  const page = await ctx.newPage();
  const shot = async (name, opts = {}) => {
    if (FILTER && !name.includes(FILTER)) return;
    await settle(page, opts.wait);
    await audit(page, name, v);
    await page.screenshot({ path: path.join(SHOTS, `final-${name}-${v.id}.png`), fullPage: !!opts.full });
    shots++;
  };

  // Prise en main (premier lancement)
  await boot(page, BASE, '#/', { onboarded: false, key: false });
  await page.evaluate(() => { document.querySelectorAll('.sheet-layer').forEach((n) => n.remove()); Souffleur.app.onboarding(); });
  await page.waitForSelector('.ob-sheet');
  await shot('onboarding-1');
  await page.fill('[data-ob="key"]', GEMINI_KEY);
  await page.click('.ob-foot [data-act="next"]');
  await shot('onboarding-2');
  await page.click('.ob-foot [data-act="next"]');
  await shot('onboarding-3');
  await page.evaluate(() => document.querySelectorAll('.sheet-layer').forEach((n) => n.remove()));

  // Accueil vide, sans clé
  await boot(page, BASE, '#/', { key: false });
  await page.evaluate(async () => { for (const d of await Souffleur.store.list()) await Souffleur.store.remove(d.id); });
  await page.evaluate(() => Souffleur.app.refresh());
  await shot('home-empty');

  // Données de démonstration
  await boot(page, BASE, '#/');
  const ids = await seed(page);
  await page.evaluate(() => Souffleur.app.refresh());
  await shot('home', { full: true });
  await page.click('.section-head [data-act="new"]');
  await shot('home-new-sheet');
  await page.evaluate(() => document.querySelectorAll('.sheet-layer').forEach((n) => n.remove()));

  // Dossier
  await page.evaluate((id) => Souffleur.app.go('#/dossier/' + id), ids.a);
  await page.waitForSelector('.qa-list details.qa');
  await shot('dossier', { full: true });
  await page.click('.qa-list details.qa:nth-child(2) summary');
  await shot('dossier-qa-open');
  await page.click('.topbar [data-act="export"]');
  await shot('dossier-export-sheet');
  await page.evaluate(() => document.querySelectorAll('.sheet-layer').forEach((n) => n.remove()));
  await page.evaluate((id) => Souffleur.app.go('#/dossier/' + id), ids.c);
  await page.waitForSelector('.screen.dossier .dz');
  await shot('dossier-empty');
  await page.evaluate((id) => Souffleur.app.go('#/dossier/' + id), ids.b);
  await page.waitForSelector('[data-pact="gen"]');
  mock.delays.prep = 60000;
  await page.click('[data-pact="gen"]');
  await page.waitForSelector('.prep-gen');
  await shot('dossier-generating');
  mock.delays.prep = 250;

  // Live : pré-vol puis en cours
  await boot(page, BASE, `#/live/${ids.a}`);
  await page.waitForSelector('.live-setup');
  await shot('live-setup', { full: true });
  await page.click('[data-preset="haut-parleur"]');
  mock.delays.answer = 300;
  await page.click('[data-act="start"]');
  await page.waitForSelector('.live [data-src="mixed"][data-state="listening"]');
  await shot('live-listening');
  await page.evaluate(() => window.__sr.say('Bonjour et merci d’avoir accepté cet entretien. Je vais vous présenter rapidement le poste.', { stepMs: 10 }));
  await sleep(200);
  await page.evaluate((q) => window.__sr.say(q, { stepMs: 10 }), QUESTION_FR);
  await page.waitForFunction(() => { const b = document.querySelector('.live [data-v="meta"] .src-badge.src-ai'); const t = document.querySelector('.live [data-v="text"]'); return b && t && !t.classList.contains('streaming'); }, null, { timeout: 15000 });
  await page.evaluate(() => window.__sr.say('Je suis contrôleur de gestion depuis huit ans', { stepMs: 10 }));
  await sleep(300);
  await page.evaluate(() => window.__sr.say('Vous parlez de clôture rapide, comment avez-vous', { stepMs: 0 }).then(() => {}));
  await shot('live-answer');
  await page.keyboard.press('?');
  await page.waitForSelector('.sheet');
  await shot('live-shortcuts');
  await page.keyboard.press('Escape');
  await sleep(300);
  // Récap (session réelle juste terminée)
  await page.click('.live [data-act="end"]');
  await page.click('.sheet-confirm .btn-danger');
  await page.waitForSelector('.rc-sec.rc-mail', { timeout: 15000 });
  await shot('recap', { full: true });
  await page.evaluate((id) => Souffleur.app.go('#/recap/' + id + '/sess-tr'), ids.a);
  await page.waitForSelector('.rc-stats');
  await shot('recap-training');

  // Entraînement
  await boot(page, BASE, `#/training/${ids.a}`);
  await page.waitForSelector('[data-act="start"]');
  await shot('training-intro', { full: true });
  await page.locator('[data-opt="voice"]').setChecked(false, { force: true });
  await page.click('[data-act="start"]');
  await page.waitForSelector('.tr-status[data-state="listening"]');
  await page.evaluate(() => window.__sr.say('J’ai ramené la clôture mensuelle de J+12 à J+6 en six mois', { stepMs: 10 }));
  await shot('training-question');
  await page.click('[data-act="done"]');
  await page.waitForSelector('.tr-result');
  await shot('training-feedback', { full: true });
  await page.click('.sc-actions [data-act="finish"]');
  await page.waitForSelector('.tr-summary');
  await shot('training-summary', { full: true });

  // Réglages, diagnostic, page introuvable
  await boot(page, BASE, '#/settings');
  await page.waitForSelector('[data-key="geminiKey"]');
  await shot('settings', { full: true });
  await boot(page, BASE, '#/diag');
  await page.waitForFunction(() => document.querySelectorAll('.dg-row').length === 11 && !document.querySelector('.dg-row.is-pending'), null, { timeout: 20000 });
  await shot('diag', { full: true });
  await boot(page, BASE, '#/nimporte');
  await shot('not-found');

  await ctx.close();
}

await browser.close();
srv.server.close();

console.log(`\n${shots} captures dans tests/shots/final-*.png`);
if (notes.length) console.log(`\nAvertissements (${notes.length}) :\n  ` + Array.from(new Set(notes)).join('\n  '));
if (jsErrors.length) console.log(`\nErreurs JS (${jsErrors.length}) :\n  ` + jsErrors.join('\n  '));
if (problems.length) console.log(`\nDéfauts (${problems.length}) :\n  ` + problems.join('\n  '));
else console.log('\nAudit visuel : aucun défaut bloquant.');
process.exit(problems.length || jsErrors.length ? 1 : 0);
