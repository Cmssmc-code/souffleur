// Souffleur — outillage commun des tests de bout en bout (e2e.mjs, final-shots.mjs).
// API IA mockées (Gemini + Claude, JSON et SSE), pdf.js servi depuis un cache local, faux périphériques
// (reconnaissance vocale contrôlable, synthèse vocale, partage d'onglet), WAV de parole française pour le faux micro.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { findChrome } from '../tools/chrome-path.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE = path.join(ROOT, 'tests', '.cache');
export const SHOTS = path.join(ROOT, 'tests', 'shots');
export const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ données de test */

// Clés factices : jamais au format d'une vraie clé (le build refuse AIza… / sk-ant-…).
export const GEMINI_KEY = 'cle-gemini-factice-e2e-0001';
export const CLAUDE_KEY = 'cle-claude-factice-e2e-0001';

export const QUESTION_FR = 'Pourquoi voulez-vous rejoindre notre entreprise ?';
export const ANSWER_MARK = 'structurer une finance en forte croissance';
export const ANSWER_TEXT = '**Je veux structurer une finance en forte croissance, au plus près des opérationnels.**\n'
  + '- **Clôture** : passée de J+12 à J+6 dans mon poste actuel\n'
  + '- **Pilotage** : tableaux de bord mensuels pour 14 sites\n'
  + '- **Projet** : accompagner vos deux acquisitions récentes';
export const CLAUDE_MARK = 'secours Claude';
export const CLAUDE_TEXT = '**Réponse de secours Claude : votre croissance externe demande une finance solide.**\n'
  + '- **Expérience** : 8 ans de contrôle de gestion\n- **Méthode** : clôture fiabilisée et rapide';

export const PREP = {
  pitch: 'Contrôleur de gestion depuis huit ans, je pilote la performance financière de structures de 200 à 1 500 personnes. Après trois ans d’audit, j’ai rejoint l’industrie où j’ai ramené la clôture mensuelle de J+12 à J+6. Je veux aujourd’hui un rôle de RAF plus transverse, au service d’un projet de croissance comme le vôtre.',
  questions: [
    { q: 'Pouvez-vous vous présenter ?', a: '**Contrôleur de gestion depuis 8 ans, j’allie rigueur comptable et sens du pilotage.**\n- **Parcours** : 3 ans d’audit, puis 5 ans en industrie\n- **Résultat** : clôture de J+12 à J+6\n- **Projet** : un rôle de RAF transverse', tags: ['classique', 'présentation'] },
    { q: 'Pourquoi souhaitez-vous rejoindre notre entreprise ?', a: '**Votre croissance demande une fonction finance structurée : c’est exactement ce que je sais faire.**\n- **Croissance** : deux acquisitions à intégrer\n- **Apport** : clôture rapide et fiable\n- **Envie** : piloter de bout en bout', tags: ['motivation'] },
    { q: 'Quelles sont vos prétentions salariales ?', a: '**Je vise 58 à 62 k€ bruts annuels, selon le package.**\n- **Repère** : rémunération actuelle et marché\n- **Ouverture** : flexible sur le télétravail', tags: ['salaire'] },
    { q: 'Quel est votre principal défaut ?', a: '**J’ai longtemps eu du mal à déléguer les contrôles.**\n- **Correction** : check-lists partagées\n- **Effet** : équipe plus autonome', tags: ['piège'] },
    { q: 'Parlez-moi d’une situation de conflit que vous avez gérée.', a: '**J’ai désamorcé un désaccord budgétaire entre production et achats.**\n- **Situation** : écart de 400 k€\n- **Action** : atelier commun\n- **Résultat** : budget validé en 2 semaines', tags: ['comportementale'] },
    { q: 'Comment organisez-vous une clôture mensuelle ?', a: '**Avec un rétroplanning partagé et des contrôles automatisés.**\n- **Planning** : J-5 à J+6\n- **Outils** : rapprochements automatiques', tags: ['technique'] },
    { q: 'Quelle est votre disponibilité ?', a: '**Je suis disponible sous trois mois, négociables.**\n- **Préavis** : trois mois\n- **Souplesse** : passation organisée', tags: ['salaire'] },
    { q: 'Que savez-vous de notre groupe ?', a: '**Un acteur régional des énergies renouvelables en forte croissance.**\n- **Chiffres** : 320 M€ de CA\n- **Enjeu** : intégrer deux acquisitions', tags: ['poste'] },
    { q: 'Pourquoi quittez-vous votre poste actuel ?', a: '**Je cherche un périmètre plus large, avec la trésorerie et les RH.**\n- **Constat** : poste centré sur le reporting\n- **Envie** : piloter de bout en bout', tags: ['piège'] },
    { q: 'Comment expliquez-vous un écart budgétaire à un opérationnel ?', a: '**Je pars de son indicateur à lui, puis je remonte à l’impact financier.**\n- **Langage** : volumes et délais\n- **Support** : un graphique, pas un tableau', tags: ['situation'] },
    { q: 'Où vous voyez-vous dans cinq ans ?', a: '**À la tête d’une direction financière d’ETI.**\n- **Étape** : RAF avec équipe\n- **Moyen** : formation continue', tags: ['motivation'] },
    { q: 'Avez-vous des questions à nous poser ?', a: '**Oui : quels sont les chantiers prioritaires des six premiers mois ?**\n- **Équipe** : organisation actuelle\n- **Outils** : ERP et reporting', tags: ['fin'] }
  ],
  askThem: ['Quels sont les chantiers prioritaires des six premiers mois ?', 'Comment est organisée l’équipe finance ?', 'Quels outils de reporting utilisez-vous ?'],
  keyFacts: ['CA 2025 : 320 M€ (+18 %)', '1 100 salariés, 14 sites', 'Clôture ramenée de J+12 à J+6'],
  watchouts: ['Ne pas dénigrer l’employeur actuel', 'Préparer un exemple chiffré sur la trésorerie']
};

export const RECAP_MD = [
  '## Synthèse', 'Échange cordial de 25 minutes, centré sur la clôture et l’intégration des acquisitions. Le recruteur a montré de l’intérêt pour la méthode de clôture rapide.',
  '## Questions posées', '1. Pourquoi voulez-vous rejoindre notre entreprise ? — ✅ solide : réponse claire et chiffrée.',
  '## Points forts', '- Exemples chiffrés\n- Discours structuré',
  '## À améliorer', '- Conclure chaque réponse par le lien avec le poste',
  '## À relancer', '- Envoyer l’exemple de tableau de bord',
  '## Mail de remerciement', 'Objet : Merci pour notre échange\n\nMadame,\n\nJe vous remercie pour notre échange d’aujourd’hui sur le poste de responsable administratif et financier. Votre projet d’intégration des deux acquisitions m’a particulièrement motivé.\n\nBien cordialement,\nCamille'
].join('\n\n');

export const TRAINING_Q = 'Parlez-moi d’une réussite professionnelle dont vous êtes fier.';
export const TRAINING_FEEDBACK = {
  score: 8,
  feedback: '- ✓ Exemple concret et chiffré\n- → Concluez par le lien avec le poste visé',
  better: '**J’ai ramené la clôture mensuelle de J+12 à J+6 en six mois.**\n- **Méthode** : rétroplanning partagé\n- **Résultat** : décisions plus rapides pour la direction'
};
export const EXTRACT_TEXT = 'Offre d’emploi — Responsable administratif et financier\nMissions : piloter la clôture mensuelle, la trésorerie et le reporting.\nProfil recherché : 8 ans d’expérience en contrôle de gestion.';

const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-flash-latest', 'gemini-2.5-flash',
  'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash-image', 'text-embedding-004'];
const CLAUDE_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'];

/* ------------------------------------------------------------------ mock réseau */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-expose-headers': '*'
};

function chunks(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [''];
}

function textOfGemini(body) {
  const parts = [];
  (body.contents || []).forEach((c) => (c.parts || []).forEach((p) => parts.push(p)));
  const sys = ((body.systemInstruction && body.systemInstruction.parts) || []).map((p) => p.text || '').join('\n');
  const inline = parts.find((p) => p.inline_data || p.inlineData);
  const mime = inline ? (inline.inline_data || inline.inlineData).mime_type || (inline.inline_data || inline.inlineData).mimeType : '';
  return { sys, text: parts.map((p) => p.text || '').join('\n'), mime };
}

function textOfClaude(body) {
  const blocks = [];
  (body.messages || []).forEach((m) => (Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content) }]).forEach((b) => blocks.push(b)));
  const media = blocks.find((b) => b.type === 'image' || b.type === 'document');
  return { sys: String(body.system || ''), text: blocks.map((b) => b.text || '').join('\n'), mime: media ? media.source.media_type : '' };
}

export function classify({ sys, text, mime }) {
  if (mime && /^audio\//.test(mime)) return 'transcribe';
  if (mime) return 'extract';
  if (/Réponds uniquement : OK/.test(text)) return 'ping';
  if (/"askThem"/.test(text)) return 'prep';
  if (/Rédige le récapitulatif/.test(text)) return 'recap';
  if (/Évalue selon/.test(text)) return 'trainingFeedback';
  if (/Tu joues le recruteur/.test(sys)) return 'trainingNext';
  return 'answer';
}

function responseText(m, kind, provider) {
  switch (kind) {
    case 'transcribe': return m.transcript;
    case 'extract': return EXTRACT_TEXT;
    case 'ping': return 'OK';
    case 'prep': return JSON.stringify(PREP);
    case 'recap': return RECAP_MD;
    case 'trainingNext': return TRAINING_Q;
    case 'trainingFeedback': return JSON.stringify(TRAINING_FEEDBACK);
    default: return provider === 'claude' ? CLAUDE_TEXT : m.answerText;
  }
}

function errorBody(provider, status) {
  if (provider === 'claude') {
    const type = status === 401 ? 'authentication_error' : status === 429 ? 'rate_limit_error' : status === 529 ? 'overloaded_error' : 'api_error';
    return JSON.stringify({ type: 'error', error: { type, message: `mock ${status}` } });
  }
  const st = status === 401 ? 'UNAUTHENTICATED' : status === 429 ? 'RESOURCE_EXHAUSTED' : status === 403 ? 'PERMISSION_DENIED' : 'UNAVAILABLE';
  const message = status === 401 ? 'API key not valid. Please pass a valid API key.' : status === 429 ? 'Resource has been exhausted (e.g. check quota).' : 'The model is overloaded.';
  const details = status === 401 ? [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }] : [];
  return JSON.stringify({ error: { code: status, message, status: st, details } });
}

/**
 * Mock des API IA : un objet d'état modifiable par les tests.
 *   mock.log            [{provider, kind, model, stream, status}]
 *   mock.fail           [{provider, kind?, model?, status, times}]  erreurs injectées (times = nombre d'occurrences, Infinity = toujours)
 *   mock.delays         délais par type de requête (ms) avant la réponse
 *   mock.transcript     texte renvoyé par la transcription
 */
export function createMock() {
  const m = {};
  m.reset = () => {
    m.log = [];
    m.fail = [];
    m.delays = { answer: 900, transcribe: 120, prep: 250, recap: 250, extract: 150, ping: 60, trainingNext: 80, trainingFeedback: 120, list: 40 };
    m.transcript = QUESTION_FR;
    m.answerText = ANSWER_TEXT;
    m.cdn = 0;
  };
  m.reset();
  m.count = (pred) => m.log.filter(pred).length;

  const takeFail = (provider, kind, model) => {
    const f = m.fail.find((x) => x.provider === provider && (!x.kind || x.kind === kind) && (!x.model || x.model === model) && x.times > 0);
    if (!f) return 0;
    f.times--;
    return f.status;
  };

  async function gemini(route) {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    if (/\/models$/.test(url.pathname)) {
      const status = takeFail('gemini', 'list', '');
      m.log.push({ provider: 'gemini', kind: 'list', model: '', status: status || 200 });
      await sleep(m.delays.list);
      if (status) return route.fulfill({ status, headers: Object.assign({ 'content-type': 'application/json' }, CORS), body: errorBody('gemini', status) });
      return route.fulfill({
        status: 200, headers: Object.assign({ 'content-type': 'application/json' }, CORS),
        body: JSON.stringify({ models: GEMINI_MODELS.map((n) => ({ name: 'models/' + n, supportedGenerationMethods: /embedding/.test(n) ? ['embedContent'] : ['generateContent', 'countTokens'] })) })
      });
    }
    const mm = /\/models\/([^/:]+):(streamGenerateContent|generateContent)$/.exec(url.pathname);
    if (!mm) return route.fulfill({ status: 404, headers: CORS, body: '{}' });
    const model = decodeURIComponent(mm[1]);
    const stream = mm[2] === 'streamGenerateContent';
    let body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch (e) { body = {}; }
    const kind = classify(textOfGemini(body));
    const status = takeFail('gemini', kind, model);
    const entry = { provider: 'gemini', kind, model, stream, status: status || 200, at: Date.now(), json: !!(body.generationConfig && body.generationConfig.responseMimeType) };
    m.log.push(entry);
    await sleep(m.delays[kind] || 50);
    if (status) return route.fulfill({ status, headers: Object.assign({ 'content-type': 'application/json' }, CORS), body: errorBody('gemini', status) });
    const text = responseText(m, kind, 'gemini');
    if (!stream) {
      return route.fulfill({
        status: 200, headers: Object.assign({ 'content-type': 'application/json' }, CORS),
        body: JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }], modelVersion: model })
      });
    }
    const parts = chunks(text, kind === 'prep' ? 400 : 14);
    const sse = parts.map((t, i) => 'data: ' + JSON.stringify({
      candidates: [Object.assign({ content: { role: 'model', parts: [{ text: t }] }, index: 0 }, i === parts.length - 1 ? { finishReason: 'STOP' } : {})],
      modelVersion: model
    }) + '\r\n\r\n').join('');
    return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'text/event-stream; charset=utf-8' }, CORS), body: sse });
  }

  async function claude(route) {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    if (/\/v1\/models$/.test(url.pathname)) {
      const status = takeFail('claude', 'list', '');
      m.log.push({ provider: 'claude', kind: 'list', model: '', status: status || 200 });
      if (status) return route.fulfill({ status, headers: Object.assign({ 'content-type': 'application/json' }, CORS), body: errorBody('claude', status) });
      return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/json' }, CORS), body: JSON.stringify({ data: CLAUDE_MODELS.map((id) => ({ id, type: 'model' })), has_more: false }) });
    }
    if (!/\/v1\/messages$/.test(url.pathname)) return route.fulfill({ status: 404, headers: CORS, body: '{}' });
    let body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch (e) { body = {}; }
    const kind = classify(textOfClaude(body));
    const model = body.model || '';
    const status = takeFail('claude', kind, model);
    m.log.push({ provider: 'claude', kind, model, stream: !!body.stream, status: status || 200, at: Date.now() });
    await sleep(m.delays[kind] || 50);
    if (status) return route.fulfill({ status, headers: Object.assign({ 'content-type': 'application/json' }, CORS), body: errorBody('claude', status) });
    const text = responseText(m, kind, 'claude');
    if (!body.stream) {
      return route.fulfill({
        status: 200, headers: Object.assign({ 'content-type': 'application/json' }, CORS),
        body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model, content: [{ type: 'text', text }], stop_reason: 'end_turn' })
      });
    }
    const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify(Object.assign({ type }, data))}\n\n`;
    const sse = ev('message_start', { message: { id: 'msg_e2e', model, role: 'assistant', content: [] } })
      + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      + chunks(text, 16).map((t) => ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: t } })).join('')
      + ev('content_block_stop', { index: 0 })
      + ev('message_delta', { delta: { stop_reason: 'end_turn' } })
      + ev('message_stop', {});
    return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'text/event-stream; charset=utf-8' }, CORS), body: sse });
  }

  async function cdn(route) {
    const url = new URL(route.request().url());
    const mm = /\/npm\/pdfjs-dist@([^/]+)\/legacy\/build\/([\w.-]+)$/.exec(url.pathname);
    const file = mm ? path.join(CACHE, 'pdfjs', mm[2]) : '';
    if (mm && mm[1] === '6.4.299' && fs.existsSync(file)) {
      m.cdn++;
      return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'text/javascript; charset=utf-8' }, CORS), body: fs.readFileSync(file) });
    }
    return route.abort('failed');
  }

  m.attach = async (context) => {
    await context.route(/^https:\/\/generativelanguage\.googleapis\.com\//, gemini);
    await context.route(/^https:\/\/api\.anthropic\.com\//, claude);
    await context.route(/^https:\/\/cdn\.jsdelivr\.net\//, cdn);
    // Toute autre requête externe est coupée : les tests ne sortent jamais de la machine.
    await context.route((u) => /^https?:/.test(u.href) && !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u.href)
      && !/googleapis\.com|anthropic\.com|jsdelivr\.net/.test(u.hostname), (r) => r.abort('blockedbyclient'));
  };
  return m;
}

/** Télécharge (une fois) pdf.js 6.4.299 dans tests/.cache/pdfjs ; sans réseau, le test PDF passe par l'extraction IA mockée. */
export async function ensurePdfJs() {
  const dir = path.join(CACHE, 'pdfjs');
  fs.mkdirSync(dir, { recursive: true });
  const files = ['pdf.min.mjs', 'pdf.worker.min.mjs'];
  for (const f of files) {
    const p = path.join(dir, f);
    if (fs.existsSync(p) && fs.statSync(p).size > 10000) continue;
    try {
      const r = await fetch(`https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/${f}`, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(String(r.status));
      fs.writeFileSync(p, Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ WAV de parole */

/** WAV 48 kHz mono 16 bits : 1,5 s de silence, la question dite par une voix française Windows, 3 s de silence.
    Sans voix française (ou hors Windows) : signal synthétique « parole » (harmoniques + enveloppe syllabique). */
export function ensureSpeechWav() {
  const out = path.join(CACHE, 'question-fr.wav');
  if (fs.existsSync(out) && fs.statSync(out).size > 20000) return { file: out, kind: fs.existsSync(out + '.tts') ? 'tts' : 'synth' };
  if (process.platform === 'win32') {
    const ps = [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      '$v = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like "fr*" } | Select-Object -First 1',
      'if (-not $v) { exit 3 }',
      '$s.SelectVoice($v.VoiceInfo.Name)',
      '$s.Rate = 0',
      '$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
      `$s.SetOutputToWaveFile('${out.replace(/'/g, "''")}', $fmt)`,
      '$pb = New-Object System.Speech.Synthesis.PromptBuilder',
      '$pb.AppendBreak([TimeSpan]::FromMilliseconds(1500))',
      `$pb.AppendText('${QUESTION_FR.replace(/'/g, "''")}')`,
      '$pb.AppendBreak([TimeSpan]::FromMilliseconds(3000))',
      '$s.Speak($pb)',
      '$s.Dispose()'
    ].join('; ');
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { encoding: 'utf8', timeout: 60000 });
    if (r.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 20000) {
      fs.writeFileSync(out + '.tts', 'voix Windows française');
      return { file: out, kind: 'tts' };
    }
  }
  writeSynthWav(out);
  return { file: out, kind: 'synth' };
}

function writeSynthWav(file) {
  const sr = 48000;
  const total = Math.round(sr * 7);
  const pcm = new Int16Array(total);
  const start = sr * 1.5, len = sr * 2.5;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = Math.max(0, Math.sin(Math.PI * 4 * t)) ** 0.6 * Math.min(1, t * 8, (2.5 - t) * 8);
    const f0 = 120 + 25 * Math.sin(2 * Math.PI * 0.7 * t);
    let v = 0;
    for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * f0 * h * t) / h;
    v = v * 0.35 + rnd() * 0.08;
    pcm[start + i] = Math.max(-32767, Math.min(32767, Math.round(v * env * 14000)));
  }
  const data = Buffer.from(pcm.buffer);
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12);
  hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(sr, 24);
  hdr.writeUInt32LE(sr * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([hdr, data]));
}

/* ------------------------------------------------------------------ faux périphériques (dans la page) */

// Injecté avant tout script de la page (addInitScript) : synthèse vocale instantanée, reconnaissance vocale
// pilotable via window.__sr.say(texte), partage d'onglet = canvas + son du faux micro.
export function pageFakes() {
  if (window.__fakes) return;
  window.__fakes = true;
  // Synthèse vocale : se termine tout de suite (pas de son en headless).
  class FakeUtterance { constructor(t) { this.text = t; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; this.onend = null; this.onerror = null; } }
  let speaking = null;
  const synth = {
    speaking: false, pending: false, paused: false,
    getVoices: () => [{ name: 'Voix française de test', lang: 'fr-FR', localService: true, default: true, voiceURI: 'fr-test' }],
    addEventListener() {}, removeEventListener() {}, onvoiceschanged: null,
    speak(u) { speaking = u; (window.__spoken = window.__spoken || []).push(u.text); setTimeout(() => { if (speaking === u) { speaking = null; if (u.onend) u.onend({}); } }, 60); },
    cancel() { const u = speaking; speaking = null; if (u && u.onerror) u.onerror({ error: 'interrupted' }); },
    pause() {}, resume() {}
  };
  try { Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true }); } catch (e) { /* ignore */ }
  window.SpeechSynthesisUtterance = FakeUtterance;

  // Reconnaissance vocale contrôlable.
  const ctl = window.__sr = { active: new Set(), starts: 0, lastLang: '', said: [] };
  class FakeRecognition {
    constructor() { this.lang = ''; this.continuous = false; this.interimResults = false; this.maxAlternatives = 1; this._on = false; this._results = []; }
    start() {
      if (this._on) { const e = new Error('already started'); e.name = 'InvalidStateError'; throw e; }
      this._on = true; ctl.starts++; ctl.lastLang = this.lang; ctl.active.add(this);
      setTimeout(() => { if (!this._on) return; if (this.onstart) this.onstart({}); if (this.onaudiostart) this.onaudiostart({}); }, 15);
    }
    stop() { this._end(); }
    abort() { this._end(); }
    _end() {
      if (!this._on) return;
      this._on = false; ctl.active.delete(this);
      setTimeout(() => { if (this.onend) this.onend({}); }, 10);
    }
    _emit(text, final) {
      const r = [{ transcript: text, confidence: 0.9 }];
      r.isFinal = !!final;
      const idx = this._results.length;
      const list = this._results.slice();
      list[idx] = r;
      if (final) this._results.push(r);
      if (this.onresult) this.onresult({ resultIndex: idx, results: list });
    }
  }
  ctl.say = async (text, opts) => {
    opts = opts || {};
    ctl.said.push(text);
    const words = String(text).split(' ');
    const step = opts.stepMs == null ? 60 : opts.stepMs;
    for (let i = 1; i < words.length; i++) {
      ctl.active.forEach((r) => r._emit(words.slice(0, i).join(' '), false));
      await new Promise((res) => setTimeout(res, step));
    }
    ctl.active.forEach((r) => r._emit(text, true));
    return ctl.active.size;
  };
  ctl.error = (code) => ctl.active.forEach((r) => { if (r.onerror) r.onerror({ error: code }); r._end(); });
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;

  // Partage d'onglet / d'écran : vidéo d'un canvas + son du faux micro (fichier WAV de Chromium).
  window.__display = { calls: 0, noAudio: false };
  if (navigator.mediaDevices) {
    navigator.mediaDevices.getDisplayMedia = async function (constraints) {
      window.__display.calls++;
      window.__display.last = constraints;
      const cv = document.createElement('canvas');
      cv.width = 64; cv.height = 36;
      const v = cv.captureStream(5).getVideoTracks();
      if (window.__display.noAudio) return new MediaStream(v);
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      return new MediaStream([...v, ...mic.getAudioTracks()]);
    };
  }
}

/* ------------------------------------------------------------------ navigateur */

export async function launchBrowser({ wav, headed } = {}) {
  const args = [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-features=Translate,MediaRouter',
    '--lang=fr-FR'
  ];
  if (wav) args.push(`--use-file-for-fake-audio-capture=${wav}`);
  return chromium.launch({ executablePath: findChrome(), headless: !headed, args });
}

/** Contexte isolé : API mockées, faux périphériques, service worker bloqué (testé par tools/check-pwa.mjs). */
export async function newContext(browser, mock, o = {}) {
  const context = await browser.newContext({
    viewport: o.viewport || { width: 1440, height: 900 },
    deviceScaleFactor: o.dsf || 1,
    colorScheme: o.dark ? 'dark' : 'light',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    acceptDownloads: true,
    serviceWorkers: 'block',
    permissions: ['microphone', 'clipboard-read', 'clipboard-write'],
    isMobile: !!o.mobile,
    hasTouch: !!o.mobile
  });
  if (mock) await mock.attach(context);
  await context.addInitScript(pageFakes);
  if (o.seed) await context.addInitScript(o.seed.fn, o.seed.arg);
  return context;
}

/** Collecte les erreurs JS non gérées de toutes les pages d'un contexte (y compris pop-ups). */
export function watchErrors(context, sink) {
  const attach = (page) => {
    page.on('pageerror', (e) => sink(`[pageerror] ${e.message}`, page));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const t = msg.text();
      // Les erreurs HTTP simulées (401, 429…) et les requêtes coupées volontairement sont journalisées par Chromium.
      if (/Failed to load resource|net::ERR_|favicon/i.test(t)) return;
      sink(`[console] ${t}`, page);
    });
  };
  context.pages().forEach(attach);
  context.on('page', attach);
}

export function tmpDir(name) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `souffleur-${name}-`));
  return d;
}
