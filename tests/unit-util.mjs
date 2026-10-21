// Tests unitaires de src/js/util.js (sans navigateur) : node tests/unit-util.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { console, setTimeout, clearTimeout, crypto: globalThis.crypto, Blob, URL };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src/js/util.js'), 'utf8'), sandbox, { filename: 'util.js' });
const S = sandbox.Souffleur;
const U = S.util;

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, info) {
  if (cond) pass++;
  else { fail++; failures.push(name + (info !== undefined ? '  → ' + info : '')); }
}

/* ---------- esc / md (XSS) ---------- */
check('esc', U.esc(`<a href="x" onclick='y'>&</a>`) === '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
check('esc null', U.esc(null) === '' && U.esc(undefined) === '' && U.esc(0) === '0');

const xss = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '[clic](javascript:alert(1))',
  '[clic](https://ok.fr" onmouseover="alert(1))',
  '[<b>x</b>](https://ok.fr/?a=1&b="2")',
  'https://ok.fr/"><script>alert(1)</script>',
  '**<svg onload=alert(1)>**',
  '`<iframe src=javascript:alert(1)>`',
  '# <img src=x onerror=alert(1)>',
  '- <a href="javascript:alert(1)">x</a>',
  '> <style>body{display:none}</style>',
  '```\n<script>alert(1)</script>\n```',
  'texte \u0001' + '0\u0002 injection de marqueur',
  '[x](data:text/html;base64,PHNjcmlwdD4=)',
  '<<script>script>alert(1)<</script>/script>'
];
const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'hr', 'blockquote', 'a']);
const ALLOWED_ATTRS = new Set(['href', 'target', 'rel', 'start', 'class']);
function unsafe(html) {
  for (const tag of html.match(/<[^>]*>/g) || []) {
    const m = /^<\/?([a-z0-9]+)((?:\s+[a-z-]+="[^"<>]*")*)\s*>$/i.exec(tag);
    if (!m) return 'balise malformée ' + tag;
    if (!ALLOWED_TAGS.has(m[1].toLowerCase())) return 'balise interdite ' + m[1];
    for (const [, name, val] of m[2].matchAll(/([a-z-]+)="([^"]*)"/gi)) {
      if (!ALLOWED_ATTRS.has(name.toLowerCase())) return 'attribut interdit ' + name;
      if (name === 'href' && !/^https?:\/\//i.test(val)) return 'href interdit ' + val;
    }
  }
  if (/</.test(html.replace(/<\/?[a-z0-9]+(?:\s+[a-z-]+="[^"<>]*")*\s*>/gi, ''))) return '< brut';
  return '';
}
for (const s of xss) {
  const html = U.md(s);
  const why = unsafe(html);
  check('md XSS : ' + JSON.stringify(s), !why, why + ' | ' + html);
}
check('md lien autorisé', U.md('[Studio](https://aistudio.google.com/apikey)') ===
  '<p><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Studio</a></p>');
check('md URL nue + ponctuation', U.md('Voir https://exemple.fr/a_b.').includes('href="https://exemple.fr/a_b"') && U.md('Voir https://exemple.fr/a_b.').endsWith('</a>.</p>'));
check('md attribut cassé', !/"\s+onmouseover/.test(U.md('[x](https://ok.fr" onmouseover="alert(1))')));

/* ---------- md (rendu) ---------- */
const answer = '**Je pilote la clôture mensuelle en 5 jours.**\n- **Clôture** : J+5 sur 4 filiales\n- **Outils** : SAP, Excel *avancé*\n\n⚠️ pas dans ton CV';
const html = U.md(answer);
check('md gras', html.startsWith('<p><strong>Je pilote la clôture mensuelle en 5 jours.</strong></p>'), html);
check('md liste', html.includes('<ul><li><strong>Clôture</strong> : J+5 sur 4 filiales</li><li><strong>Outils</strong> : SAP, Excel <em>avancé</em></li></ul>'), html);
check('md avertissement', html.includes('<p class="warn">⚠️ pas dans ton CV</p>'), html);
check('md titres', U.md('# A\n## B\n### C') === '<h1>A</h1><h2>B</h2><h3>C</h3>');
check('md liste numérotée', U.md('1. un\n2. deux\n\n3. trois') === '<ol><li>un</li><li>deux</li><li>trois</li></ol>', U.md('1. un\n2. deux\n\n3. trois'));
check('md ol start', U.md('3. trois\n4. quatre').startsWith('<ol start="3">'));
check('md sous-liste', U.md('- a\n  - a1\n- b') === '<ul><li>a<ul><li>a1</li></ul></li><li>b</li></ul>', U.md('- a\n  - a1\n- b'));
check('md sauts de ligne', U.md('ligne 1\nligne 2\n\nligne 3') === '<p>ligne 1<br>ligne 2</p><p>ligne 3</p>');
check('md code', U.md('utiliser `a*b*c`') === '<p>utiliser <code>a*b*c</code></p>');
check('md snake_case intact', U.md('mon_fichier_test et 5 * 3 * 2') === '<p>mon_fichier_test et 5 * 3 * 2</p>', U.md('mon_fichier_test et 5 * 3 * 2'));
check('md vide', U.md('') === '' && U.md(null) === '');
check('md bloc code', U.md('```js\nlet a = "<b>";\n```') === '<pre><code>let a = &quot;&lt;b&gt;&quot;;</code></pre>');

/* ---------- norm / tokens ---------- */
check('norm', U.norm("  Qu'est-ce QUI vous MOTIVE, Hélène ? Œuvre…  ") === 'qu est ce qui vous motive helene oeuvre');
check('tokens', JSON.stringify(U.tokens("Pouvez-vous me parler de votre expérience chez Renault ?")) === '["parler","experience","renault"]', JSON.stringify(U.tokens("Pouvez-vous me parler de votre expérience chez Renault ?")));
check('tokens nombres', U.tokens('dans cinq ans').includes('5'));

/* ---------- isQuestion : questions d'entretien réelles (oral, souvent sans ponctuation) ---------- */
const questions = [
  'Pouvez-vous vous présenter en quelques mots',
  'présentez-vous',
  'parlez-moi de votre parcours',
  'alors euh dites moi pourquoi vous avez quitté votre dernier poste',
  "qu'est-ce qui vous motive dans ce poste",
  'quelles sont vos principales qualités',
  'et vos défauts',
  'comment géreriez-vous un conflit dans votre équipe',
  'quel est votre salaire actuel',
  'vous avez déjà travaillé avec SAP',
  'vous êtes disponible quand',
  'est-ce que vous avez des questions',
  'racontez-moi une situation où vous avez dû gérer une urgence',
  'décrivez une situation difficile que vous avez rencontrée',
  'que savez-vous de notre entreprise',
  'où vous voyez-vous dans cinq ans',
  'pourquoi devrions-nous vous recruter plutôt qu un autre candidat',
  "j'aimerais que vous me parliez de votre expérience chez KPMG",
  'vous seriez prêt à vous déplacer en province',
  'combien de personnes encadriez-vous',
  "à votre avis quelles sont les qualités d'un bon contrôleur de gestion",
  'si vous deviez résumer votre parcours en trois mots',
  'en quoi votre profil correspond à ce poste',
  'vous pouvez me donner un exemple concret',
  'je voudrais savoir quelles sont vos prétentions salariales',
  'comment vous organisez-vous pour clôturer les comptes dans les délais',
  "qu'attendez-vous de votre prochain manager",
  'vous maîtrisez Excel',
  "c'est quoi pour vous un bon manager",
  'imaginons que votre directeur vous demande un reporting pour demain matin',
  'bonjour monsieur merci d être là pour commencer pouvez-vous vous présenter',
  'Quelle est votre plus grande réussite ?',
  'ça vous intéresse de travailler en open space',
  'et vous vous voyez évoluer vers quel type de poste',
  'a-t-il fallu convaincre votre direction',
  'y a-t-il des points que vous souhaitez aborder',
  'vous êtes mobile ou pas',
  'avez-vous déjà managé une équipe',
  'je vais vous demander de vous présenter brièvement',
  "d'accord et sur le plan salarial",
  'comment ça s est passé avec votre ancien manager',
  'est-ce que vous avez quelque chose à ajouter',
  "le poste n'a pas de management cela vous convient-il",
  'que recouvre la notion de fin de gestion',
  'que signifie pour vous la performance',
  'un dernier mot pour conclure',
  'cela vous convient',
  'semble-t-il que vous ayez hésité'
];
for (const q of questions) check('question : ' + q, U.isQuestion(q) === true);

const statements = [
  'je suis contrôleur de gestion depuis cinq ans chez Renault',
  "c'est pourquoi j'ai décidé de quitter mon poste",
  "j'ai appris comment gérer la pression des clôtures",
  'très bien merci',
  "d'accord",
  "je vais vous présenter le poste et l'équipe",
  'le poste est rattaché au directeur administratif et financier',
  'vous seriez rattaché au DAF avec une équipe de trois personnes',
  'je ne sais pas pourquoi ils ont changé de logiciel',
  'quel que soit le contexte je reste calme',
  "j'ai piloté la mise en place de SAP sur quatre filiales",
  'nous sommes une PME de 200 personnes dans l agroalimentaire',
  "c'est ce que je recherche dans ce poste",
  'comme vous le savez le marché est tendu',
  'voilà pourquoi ce poste m intéresse',
  'parfait merci beaucoup pour cet échange',
  "c'est la raison pour laquelle je postule",
  'oui tout à fait',
  "euh alors en fait j'ai surtout travaillé sur le budget",
  'je vous remercie pour votre temps',
  "j'ai géré une équipe de quatre comptables",
  'ensuite on va parler de vos expériences',
  'la rémunération est comprise entre 45 et 50 000 euros',
  "c'est une entreprise dans laquelle je me reconnais",
  'je leur ai montré comment on fait un rapprochement bancaire',
  'si vous voulez bien me suivre',
  "j'ai travaillé chez vous en stage il y a trois ans",
  'quelques semaines plus tard nous avons livré le projet',
  'avant il y avait une équipe de cinq personnes',
  "ce qui compte il me semble c'est la rigueur",
  'en fait il faut surtout fiabiliser les données',
  'que le budget soit tenu c était ma priorité'
];
for (const s of statements) check('affirmation : ' + s, U.isQuestion(s) === false);

/* ---------- similarity ---------- */
const similar = [
  ['Pourquoi avez-vous quitté votre dernier poste ?', 'alors euh dites-moi pourquoi vous avez quitté votre dernier poste'],
  ['Présentez-vous', 'pour commencer pouvez-vous vous présenter'],
  ['Parlez-moi de votre parcours', 'Présentez-vous en quelques mots'],
  ['Quelles sont vos prétentions salariales ?', 'quelle rémunération envisagez-vous'],
  ['Où vous voyez-vous dans 5 ans ?', 'comment vous imaginez-vous dans cinq ans'],
  ['Quelle est votre plus grande réussite professionnelle ?', 'de quoi êtes-vous le plus fier dans votre carrière'],
  ['Que savez-vous de notre entreprise ?', 'que connaissez-vous de notre société'],
  ['Quels sont vos défauts ?', 'quels sont vos points faibles'],
  ['Pourquoi ce poste vous intéresse-t-il ?', "qu'est-ce qui vous attire dans ce poste"],
  ['Quelle est votre disponibilité ?', 'quand pourriez-vous commencer'],
  ['Comment gérez-vous le stress ?', 'comment vous gérez la pression'],
  ['Avez-vous déjà managé une équipe ?', 'vous avez déjà encadré une équipe'],
  ['Parlez-moi de votre expérience chez Renault', 'pouvez-vous nous parler de votre expérience chez Renault'],
  ['Pourquoi devrions-nous vous recruter ?', 'pourquoi est-ce qu on vous embaucherait vous plutôt qu un autre']
];
for (const [a, b] of similar) {
  const v = U.similarity(a, b);
  check('similaires (≥ 0,55) : ' + a + ' ~ ' + b, v >= 0.55, v);
}
const different = [
  ['Pourquoi avez-vous quitté votre dernier poste ?', 'Pourquoi voulez-vous ce poste ?'],
  ['Quelles sont vos qualités ?', 'Quels sont vos défauts ?'],
  ["Parlez-moi d'un échec", "Parlez-moi d'une réussite"],
  ['Comment gérez-vous le stress ?', 'Comment gérez-vous un conflit dans votre équipe ?'],
  ['Que savez-vous de notre entreprise ?', 'Pourquoi voulez-vous rejoindre notre entreprise ?'],
  ['Quel est votre salaire actuel ?', 'Quelle est votre disponibilité ?'],
  ['Avez-vous des questions ?', 'Avez-vous déjà managé une équipe ?'],
  ['Présentez-vous', 'Présentez-nous un projet dont vous êtes fier'],
  ['Quels logiciels comptables maîtrisez-vous ?', 'Comment organisez-vous une clôture mensuelle ?'],
  ['Êtes-vous mobile géographiquement ?', 'Quelles sont vos prétentions salariales ?'],
  ['Comment réagissez-vous face à un client mécontent ?', 'Quelle est votre plus grande réussite ?']
];
for (const [a, b] of different) {
  const v = U.similarity(a, b);
  check('différentes (< 0,45) : ' + a + ' ≠ ' + b, v < 0.45, v);
}
// questions orales -> meilleure réponse préparée
const prepared = ['Présentez-vous', 'Pourquoi ce poste ?', 'Pourquoi avez-vous quitté votre dernier poste ?', 'Quelles sont vos qualités ?',
  'Quels sont vos défauts ?', 'Quelles sont vos prétentions salariales ?', 'Où vous voyez-vous dans 5 ans ?', "Parlez-moi d'un échec",
  'Avez-vous des questions ?', 'Comment gérez-vous le stress ?', 'Que savez-vous de notre entreprise ?', 'Quelle est votre plus grande réussite ?',
  'Pourquoi devrions-nous vous recruter ?', 'Quelle est votre disponibilité ?', 'Comment organisez-vous une clôture mensuelle ?',
  'Quels logiciels maîtrisez-vous ?', 'Avez-vous déjà managé une équipe ?', 'Parlez-moi de votre expérience chez Renault'];
const best = (q) => prepared.map((p) => [U.similarity(q, p), p]).sort((x, y) => y[0] - x[0]);
for (const [spoken, expected] of [
  ['alors pour commencer est-ce que vous pouvez vous présenter rapidement', 'Présentez-vous'],
  ['vos points forts', 'Quelles sont vos qualités ?'],
  ['combien vous voulez gagner', 'Quelles sont vos prétentions salariales ?'],
  ['vous vous projetez comment dans quelques années', 'Où vous voyez-vous dans 5 ans ?'],
  ['vous connaissez un peu notre groupe', 'Que savez-vous de notre entreprise ?'],
  ['comment vous faites la clôture chaque mois', 'Comment organisez-vous une clôture mensuelle ?'],
  ['vous pouvez commencer quand', 'Quelle est votre disponibilité ?'],
  ['avez-vous des questions pour nous', 'Avez-vous des questions ?']
]) {
  const r = best(spoken);
  check('meilleure correspondance : ' + spoken, r[0][1] === expected && r[0][0] >= 0.55 && r[1][0] < 0.55, r.slice(0, 2).map((x) => x[0] + ' ' + x[1]).join(' | '));
}
for (const spoken of ['quel est le dernier livre que vous avez lu', 'vous êtes venu comment ce matin', 'je vais vous présenter le poste']) {
  const r = best(spoken);
  check('aucune réponse préparée : ' + spoken, r[0][0] < 0.55, r[0][0] + ' ' + r[0][1]);
}
check('similarity identique', U.similarity('Présentez-vous', 'présentez vous !') === 1);
check('similarity vide', U.similarity('', 'abc') === 0 && U.similarity(null, undefined) === 0);
check('similarity symétrique', U.similarity('Vos qualités', 'Quelles sont vos principales qualités ?') === U.similarity('Quelles sont vos principales qualités ?', 'Vos qualités'));

/* ---------- divers ---------- */
check('fmtTime', U.fmtTime(0) === '00:00' && U.fmtTime(61500) === '01:01' && U.fmtTime(3725000) === '62:05' && U.fmtTime(-5) === '00:00' && U.fmtTime(NaN) === '00:00');
const ids = new Set(Array.from({ length: 2000 }, () => U.uid()));
check('uid uniques et courts', ids.size === 2000 && [...ids].every((x) => /^[a-z0-9]{8,16}$/.test(x)), [...ids][0]);
check('fmtBytes', U.fmtBytes(512) === '512 octets' && U.fmtBytes(1536) === '1,5 Ko');
check('slug', U.slug('Société Générale / RAF') === 'societe-generale-raf');

const em = U.emitter();
let got = [];
const off = em.on('x', (d) => got.push(d));
em.on('x', () => { throw new Error('écouteur défaillant (attendu)'); });
em.on('x', (d) => got.push('b' + d));
const origErr = console.error; console.error = () => {};
em.emit('x', 1); off(); em.emit('x', 2);
console.error = origErr;
check('emitter', JSON.stringify(got) === '[1,"b1","b2"]', JSON.stringify(got));
check('S.bus', typeof S.bus.on === 'function' && typeof S.bus.emit === 'function');
let toastGot = null;
S.bus.on('toast', (t) => { toastGot = t; });
U.toast('Bonjour', 'ok');
check('toast via bus', toastGot && toastGot.msg === 'Bonjour' && toastGot.kind === 'ok');

let calls = 0;
const deb = U.debounce((v) => { calls += v; }, 30);
deb(1); deb(2); deb(3);
await new Promise((r) => setTimeout(r, 80));
check('debounce', calls === 3, calls);
deb(5); deb.flush();
check('debounce.flush', calls === 8, calls);
const t0 = Date.now(); await U.sleep(40);
check('sleep', Date.now() - t0 >= 35);

console.log(`util.js : ${pass} réussis, ${fail} échoués`);
if (fail) { for (const f of failures) console.log('  ✗ ' + f); process.exit(1); }
