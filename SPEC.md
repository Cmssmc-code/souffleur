# Souffleur — copilote d'entretien d'embauche (spécification v2)

Successeur de `Copilote DGEC.html` / `Copilote entretien portable.html`
(référence de logique éprouvée : `C:\Users\coren\AppData\Local\Temp\copilote\Copilote DGEC.html`
et `builder3.py` dans le même dossier — à LIRE pour reprendre ce qui marche : choix de modèle,
`thinkingConfig`, streaming SSE Gemini, prompt « souffleur », correspondance des réponses prêtes).

Utilisateur : un candidat en recherche d'emploi (finance / gestion / RAF). Langue de l'UI : **français**.
Usage prioritaire : **entretiens Meet ou Teams sur un PC** (souvent un PC qui n'est pas le sien,
hors de son wifi). Aussi : téléphone en haut-parleur posé à côté du PC, ou app sur Android.

## Objectifs (les 10 pistes)

1. **Accessible partout** : site statique HTTPS public (GitHub Pages, `https://cmssmc-code.github.io/souffleur/`),
   PWA installable (PC Chrome/Edge + Android), fonctionne hors-ligne (service worker) pour tout ce qui ne demande pas l'IA,
   et une version **fichier unique** `souffleur.html` (ouvrable en double-clic, `file://`, clé USB).
   AUCUNE donnée personnelle ni clé dans le code publié.
2. **Capture de l'appel Meet/Teams** : audio de l'onglet (Meet web) ou audio système (Teams appli, via « partager l'écran entier + audio système » de Chrome sous Windows) = voix du **recruteur** ; micro = **ma** voix. Deux voix séparées, pas besoin de haut-parleur.
3. **Transcription robuste multi-moteurs** : recruteur (flux onglet/système) → segmentation VAD locale + transcription Gemini (audio WAV inline) ; moi (micro) → reconnaissance vocale de Chrome (gratuite). Mode « haut-parleur » (1 seul micro, voix mêlées) 100 % gratuit sans clé pour transcrire. Redémarrage auto, files d'attente, aucune perte.
4. **Import de documents par glisser-déposer** : fiche de poste, CV, fiche de préparation, en PDF, DOCX, ODT, TXT, MD, HTML, RTF, images (capture d'annonce) ou texte collé. Détection auto du type.
5. **Préparation automatique par IA** : à partir des documents → pitch 60 s, ~25 questions probables avec réponses prêtes (1re personne, tirées du CV), questions à poser au recruteur, chiffres clés, points de vigilance. Tout est éditable.
6. **Réponses instantanées** : correspondance locale question → réponse préparée (0 latence, marche sans réseau) + réponse IA en streaming juste après, adaptée à la conversation entière.
7. **Fiabilité** : plusieurs fournisseurs (Gemini puis Claude en secours), plusieurs modèles avec bascule automatique (429, 5xx, timeout, réseau), découverte dynamique des modèles, auto-sauvegarde continue, Wake Lock écran, diagnostic pré-entretien (micro, audio onglet, clé, latence, stockage).
8. **Multi-dossiers & portabilité** : un dossier par entretien ; export/import d'un fichier `.souffleur.json` (option : inclure la clé), export d'un **HTML autonome** contenant le dossier ; clé « pour cette session seulement » sur un PC emprunté.
9. **Interface Apple 2026 « Liquid Glass »** : simple, moderne, clair/sombre auto, gros texte de réponse lisible en 3 s, **fenêtre flottante** (Document Picture-in-Picture) toujours au-dessus de Meet/Teams, raccourcis clavier, responsive PC/mobile.
10. **Avant / après** : mode **entraînement** (l'IA pose les questions à voix haute, je réponds au micro, elle note et corrige) et **récap** après l'appel (synthèse, questions posées, points forts / à améliorer, mail de remerciement prêt à copier), historique des sessions.

## Contraintes techniques

- **Zéro dépendance runtime obligatoire, zéro build obligatoire en dev.** Scripts classiques (PAS de `type="module"`, pour marcher en `file://`), un namespace global : `window.Souffleur` (alias local `const S = window.Souffleur`).
- Ordre de chargement : `js/util.js`, `js/store.js`, `js/docs.js`, `js/ai.js`, `js/audio.js`, `js/app.js`. Chaque fichier commence par `(function(S){ 'use strict'; ... })(window.Souffleur = window.Souffleur || {});`.
- Seule dépendance externe tolérée : **pdf.js** chargé à la demande depuis jsDelivr (`pdfjs-dist`, build legacy UMD si possible, sinon module ESM via `import()` dynamique — `import()` d'une URL https marche même en file://) ; si échec → extraction PDF par Gemini (`inline_data application/pdf`). Pas d'autre CDN, pas de framework.
- Chrome/Edge desktop récents = cible n°1 ; Chrome Android = cible n°2 ; Safari/Firefox : dégradation propre (message clair si une fonction manque).
- Stockage : IndexedDB (base `souffleur`, store `dossiers`) avec repli localStorage. Réglages dans `localStorage['souffleur.settings']` ; clés API en `sessionStorage` si « se souvenir » est décoché.
- Jamais de clé ni de données perso dans le dépôt. Les appels réseau ne partent que vers `generativelanguage.googleapis.com`, `api.anthropic.com`, `cdn.jsdelivr.net`.
- Code lisible, commenté avec parcimonie, en anglais pour les identifiants, **français pour tous les textes visibles**.

## Arborescence

```
src/index.html          coquille HTML (écrans, templates), charge styles.css + js/*.js, manifest, sw
src/styles.css          design « Liquid Glass »
src/js/util.js          helpers communs (S.util)
src/js/store.js         S.store
src/js/docs.js          S.docs
src/js/ai.js            S.ai
src/js/audio.js         S.audio
src/js/app.js           S.app (UI, écrans, live, PiP, entraînement, récap, réglages, diagnostic)
src/manifest.webmanifest, src/sw.js, src/icons/ (icon.svg, icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon.png)
tools/build.mjs         node sans dépendance : génère dist/site/ (index.html AVEC css+js inlinés, manifest, sw, icons, souffleur.html = même fichier unique) 
tools/serve.mjs         petit serveur statique de dev (node http) sur un port donné
tools/Souffleur.cmd     lanceur PC : ouvre Chrome (sinon Edge) en mode app sur l'URL publique
tests/                  tests Playwright (node) avec API mockées
android/                projet TWA (Trusted Web Activity) → APK
README.md               présentation + les 10 pistes + mode d'emploi
```

## Contrats des modules (à respecter EXACTEMENT, c'est l'interface entre agents)

### S.util (util.js)
```
S.util.uid() -> string                      // id court unique
S.util.esc(str) -> string                   // échappement HTML
S.util.md(str) -> string                    // mini-markdown sûr → HTML : **gras**, *ital*, listes "- ", "1. ", titres #/##/###, sauts de ligne, `code`, liens http(s) ; échappe tout le reste
S.util.norm(str) -> string                  // minuscules, sans accents, ponctuation → espaces, espaces compactés
S.util.tokens(str) -> string[]              // mots normalisés hors mots-vides français (le, la, de, vous, est, …)
S.util.similarity(a, b) -> number 0..1      // similarité de questions (Jaccard pondéré tokens + bigrammes de caractères)
S.util.isQuestion(text) -> boolean          // heuristique FR : "?", mots interrogatifs (pourquoi, comment, quel(le)(s), qu'est-ce, pouvez-vous, parlez-moi, présentez-vous, racontez, décrivez, expliquez, avez-vous, est-ce que, que pensez…), impératifs d'entretien
S.util.fmtTime(ms) -> "mm:ss"
S.util.debounce(fn, ms), S.util.sleep(ms)
S.util.emitter() -> {on(evt, fn) -> off(), off(evt, fn), emit(evt, data)}
S.util.toast(msg, kind?)                    // kind: 'info'|'ok'|'warn'|'err' ; rendu par app.js via S.util.emitter global S.bus
S.bus = S.util.emitter()                    // bus d'événements global
```

### S.store (store.js)
Modèle `Dossier` :
```
{ id, name, company, role, date /* 'YYYY-MM-DDTHH:mm' ou '' */, mode /* 'visio'|'tel'|'presentiel' */,
  interviewer, notes,
  docs: [{ id, kind /* 'offre'|'cv'|'prepa'|'autre' */, name, text, addedAt }],
  prep: null | { pitch, questions: [{ id, q, a, tags: [] }], askThem: [string], keyFacts: [string], watchouts: [string], generatedAt, model },
  sessions: [{ id, kind /* 'live'|'training' */, startedAt, endedAt,
               transcript: [{ t /* ms depuis début */, who /* 'them'|'me'|'mixed' */, text }],
               answers: [{ t, question, answer, source /* 'prep'|'ai' */, model }],
               scores: null | [{ question, answer, score, feedback }], recap: null | string }],
  createdAt, updatedAt }
```
API (toutes async sauf mention) :
```
S.store.init()                                // ouvre IndexedDB (repli localStorage), migre si besoin
S.store.list() -> Dossier[] (tri updatedAt desc)
S.store.get(id) -> Dossier|null
S.store.create(partial) -> Dossier            // valeurs par défaut complètes
S.store.save(dossier) -> Dossier              // met updatedAt, écrit ; émet S.bus 'store:changed'
S.store.remove(id)
S.store.exportFile(dossier, {includeKeys:boolean}) -> Blob   // JSON {format:'souffleur', version:2, exportedAt, dossier, keys?}
S.store.importFile(fileOrText) -> Dossier     // accepte aussi l'ancien qr.json ({ "titre": [{q,a}] }) et un tableau [{q,a}] ; si l'id existe déjà → nouvel id ; si keys présentes → les propose à S.store.setKeys
S.store.settings() -> Settings (SYNCHRONE)    // {geminiKey, claudeKey, rememberKeys:true, provider:'auto'|'gemini'|'claude', models:{answer:'auto', fast:'auto', prep:'auto'}, theme:'auto'|'light'|'dark', fontScale:1, lang:'fr-FR', autoAnswer:true, answerDelayMs:900, onboarded:false}
S.store.setSettings(patch) (SYNCHRONE)        // fusion, persiste (clés en sessionStorage si rememberKeys=false), émet 'settings:changed'
S.store.usage() -> {dossiers, bytes, persistent:boolean}   // navigator.storage.estimate/persist
```
Sauvegarde live : `app.js` appelle `S.store.save` au plus toutes les 3 s pendant une session (debounce) + à `pagehide`/`visibilitychange`.

### S.docs (docs.js)
```
S.docs.accept -> string                       // valeur pour <input accept>
S.docs.extract(file: File|Blob, name?) -> {text, method /* 'text'|'docx'|'odt'|'pdfjs'|'ai'|'html'|'rtf' */, warning?}
S.docs.fromText(text, name?) -> {text, method:'paste'}
S.docs.guessKind(name, text) -> 'offre'|'cv'|'prepa'|'autre'   // mots-clés : « missions », « profil recherché », « poste » → offre ; « expérience », « formation », « compétences », email/tél → cv ; « question », « réponse », « pitch », « entretien » → prepa
S.docs.clean(text) -> string                  // espaces, lignes vides multiples, césures, max 60 000 caractères (tronque proprement avec mention)
```
DOCX/ODT : lecteur ZIP maison (répertoire central + `DecompressionStream('deflate-raw')`), extraire `word/document.xml` (paragraphes `w:p` → lignes, `w:tab`, `w:br`) / `content.xml`. PDF : pdf.js à la demande (timeout 15 s) → sinon `S.ai.extractFile(blob, mime)` → sinon erreur claire « copie-colle le texte ». Images → `S.ai.extractFile`. Fichier > 20 Mo → refus clair.

### S.ai (ai.js)
Fournisseurs : **Gemini** (clé AI Studio, `https://generativelanguage.googleapis.com/v1beta`, en-tête `x-goog-api-key`) et **Claude** (`https://api.anthropic.com/v1/messages`, en-têtes `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`). Gemini prioritaire si clé présente (sauf réglage `provider`).
```
S.ai.hasKey() -> boolean (sync)
S.ai.discover({force}) -> {gemini: string[], claude: string[]}     // GET models (Gemini: ?pageSize=200, garder ceux avec generateContent ; Claude: GET /v1/models), cache localStorage 12 h
S.ai.pick(purpose) -> [{provider, model}]   (sync, à partir du cache + listes de repli)
     purpose 'answer' : flash le plus récent non-lite (gemini-3.x-flash > gemini-flash-latest > 2.5-flash) puis lite ; Claude : haiku le plus récent puis sonnet
     purpose 'fast'   : (transcription, classification) flash-lite le plus récent puis flash
     purpose 'prep'   : flash le plus récent (ou pro si dispo et rapide) ; Claude : sonnet puis haiku
     Exclure : image, tts, embedding, live, native-audio, aqa, learnlm, gemma, vision-only, "-exp" anciens. Repli si découverte impossible :
     Gemini ["gemini-3.8-flash","gemini-3.6-flash","gemini-3-flash-preview","gemini-flash-latest","gemini-2.5-flash","gemini-flash-lite-latest","gemini-2.5-flash-lite","gemini-2.0-flash"],
     Claude ["claude-haiku-5-5","claude-sonnet-5-5","claude-haiku-4-5","claude-sonnet-4-5"].
S.ai.generate({purpose, system, prompt, parts /* parts Gemini additionnelles (inline_data) */, history /* [{role:'user'|'model', text}] */,
               stream:boolean, onDelta(fullText), signal, json:boolean, maxTokens, temperature, timeoutMs})
     -> {text, provider, model, ms, firstTokenMs}
     Bascule : pour chaque candidat de pick(purpose) : essai ; sur 429/500/502/503/504/réseau/timeout (premier token > 9 s en stream, réponse > 25 s sinon) → candidat suivant (les erreurs 400 dues à thinkingConfig → réessayer sans) ; 401/403 → passer au fournisseur suivant et émettre S.bus 'ai:keyerror' {provider}. Mémoriser les modèles en échec 5 min (circuit breaker). Émettre S.bus 'ai:status' {provider, model, ok, ms, error}.
     thinkingConfig : gemini-3* → {thinkingLevel:'low'} ; *2.5* → {thinkingBudget:0} ; sinon rien. json:true → responseMimeType 'application/json' (Gemini) / consigne JSON stricte + extraction du 1er objet (Claude).
S.ai.transcribe(wavBlob, {prompt hint (noms propres du dossier), signal}) -> {text, model}   // Gemini uniquement (purpose 'fast'), consigne : transcription mot à mot en français, rien d'autre ; renvoyer '' si pas de parole ; filtrer hallucinations connues ("Sous-titres réalisés par…", "Merci d'avoir regardé", "Amara.org", texte répété en boucle, "[musique]")
S.ai.answer({dossier, transcript /* [{who,text}] toute la conversation */, question, previous /* [{question, answer}] */, mode /* 'auto'|'force'|'pitch'|'reformulate'|'shorter'|'example' */, onDelta, signal}) -> {text, provider, model, ms, firstTokenMs}
     Reprendre le prompt RULES de builder3.py (souffleur : 1 phrase clé en gras ≤ 22 mots + 3-4 puces « **mots clés** : fait », STAR pour comportemental, jamais d'invention, « ⚠️ pas dans ton CV », répondre « — » si ce n'est pas une question en mode auto). Contexte système = infos dossier + docs (offre, CV, prépa, tronqués intelligemment ~ 30 000 caractères au total) + réponses préparées (q + 1re ligne de a). Les transcriptions 'them' = recruteur, 'me' = candidat, 'mixed' = voix mêlées.
S.ai.buildPrep(dossier, {onProgress}) -> prep   // JSON strict {pitch, questions:[{q,a,tags}], askThem, keyFacts, watchouts} ; 20-30 questions (classiques + spécifiques poste + pièges + motivation + salaire/dispo + techniques métier) ; réponses au format souffleur ; ids ajoutés
S.ai.recap(dossier, session) -> markdown        // ## Synthèse, ## Questions posées (avec qualité de ma réponse), ## Points forts, ## À améliorer, ## À relancer, ## Mail de remerciement (prêt à copier, vouvoiement, nom du recruteur si connu)
S.ai.trainingNext(dossier, askedSoFar) -> {question}            // question d'entraînement suivante (variée, réaliste)
S.ai.trainingFeedback(dossier, question, myAnswer) -> {score /* 0-10 */, feedback /* markdown court */, better /* réponse améliorée format souffleur */}
S.ai.extractFile(blob, mime) -> text            // Gemini inline_data, "recopie tout le texte, structure conservée"
S.ai.test() -> [{provider, model, ok, ms, error}]  // ping minimal de chaque fournisseur configuré
```

### S.audio (audio.js)
```
S.audio.support() -> {getUserMedia, getDisplayMedia, displayAudio /* heuristique Chrome/Edge desktop */, webSpeech, audioWorklet, wakeLock, docPiP}
S.audio.presets -> [
   {id:'visio-casque', label:'Visio sur ce PC (Meet / Teams)', them:'display', themEngine:'cloud', me:'mic', meEngine:'webspeech', needsKey:true},
   {id:'pc-interne', label:'Appel ou visio sur ce PC (son interne)', them:'pc', themEngine:'local', me:'mic', meEngine:'local', needsKey:false},   // moteur 'local' : tools/son-pc/souffleur_son_pc.py capte le son du PC (boucle WASAPI) et le micro séparément, découpe (Silero) et transcrit (Whisper) sur le PC, puis envoie des phrases attribuées (ws://127.0.0.1:47800/transcription) ; aucune capture ni clé côté page ; programme absent → erreur 'PC_AUDIO_OFF'. Source 'pc' avec un autre moteur : son brut ws://…/son (en-tête JSON {rate} puis PCM s16le mono)
   {id:'haut-parleur', label:'Haut-parleur ou téléphone à côté', them:null, me:'mic', meEngine:'webspeech', mixed:true, needsKey:false},
   {id:'visio-hp', label:'Visio sur ce PC, son sur haut-parleurs (sans clé)', them:null, me:'mic', meEngine:'webspeech', mixed:true, needsKey:false},
   {id:'micro-cloud', label:'Micro seul, transcription IA (bruit, accents)', them:null, me:'mic', meEngine:'cloud', mixed:true, needsKey:true} ]
S.audio.start(presetIdOrConfig, {hint}) -> Promise<void>   // demande les permissions ; pour 'display' : getDisplayMedia({video:true, audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}, systemAudio:'include', selfBrowserSurface:'exclude', preferCurrentTab:false, surfaceSwitching:'include'}) ; si la piste audio est absente → rejet avec erreur code 'NO_DISPLAY_AUDIO' (l'UI explique : cocher « Partager l'audio de l'onglet » / « Partager l'audio du système »)
S.audio.stop()
S.audio.pause() / S.audio.resume()
S.audio.on(evt, fn) -> off   // événements :
   'interim' {who, text}                   // texte provisoire (webspeech) ou '…' pendant que le recruteur parle (cloud)
   'final'   {who, text, t}                // segment final ; t = ms depuis start
   'level'   {who, rms /* 0..1 */}         // ~15 Hz, pour les vumètres
   'speech'  {who, active:boolean}         // VAD : début / fin de parole
   'state'   {who, state /* 'starting'|'listening'|'paused'|'error'|'stopped'|'restarting' */, error?, code?}
   'ended'   {who, reason}                 // ex : l'utilisateur a arrêté le partage d'écran
S.audio.testMic(ms) -> {ok, peak}          // pour le diagnostic
S.audio.who -> 'them'|'me'|'mixed' attribution : moteur de la voix 'me' avec preset mixed:true → who 'mixed'
```
Moteur `cloud` : AudioContext → AudioWorklet (code du worklet en chaîne → Blob URL ; repli ScriptProcessor) → rééchantillonnage 16 kHz mono Int16 → VAD énergie avec plancher de bruit adaptatif (début : 3 trames > seuil ; fin : 750 ms de silence ; segment max 14 s découpé ; min 450 ms de parole ; pré-roll 300 ms) → WAV → `S.ai.transcribe` avec file d'attente (2 en parallèle max, sorties remises dans l'ordre), 2 réessais. Moteur `webspeech` : `webkitSpeechRecognition`, `lang` des réglages, continuous + interimResults, redémarrage automatique sur `onend`/`no-speech`/`network`/`aborted` avec backoff (250 ms → 4 s), arrêt définitif sur `not-allowed`/`service-not-allowed` (émettre 'state' error). Anti-doublon : si une finale 'me' ressemble (similarity > 0.6) à une finale 'them' des 12 dernières secondes → ignorée. Le vumètre micro utilise un getUserMedia séparé (echoCancellation:true) uniquement pour le niveau.

### S.app (app.js) + index.html + styles.css
Écrans (routage par hash : `#/`, `#/dossier/:id`, `#/live/:id`, `#/training/:id`, `#/recap/:id/:sessionId`, `#/settings`, `#/diag`) :
- **Accueil** : grand titre « Souffleur », sous-titre ; cartes des dossiers (nom, entreprise, date relative « demain 11:00 », état de la prépa) ; boutons « Nouvel entretien », « Importer un dossier », « Réglages » ; bandeau si aucune clé ; bouton « Installer l'app » (beforeinstallprompt) ; onboarding 3 étapes au premier lancement (clé Gemini avec lien https://aistudio.google.com/apikey, choisir le mode audio, déposer ses documents).
- **Dossier** : champs (entreprise, poste, recruteur, date/heure, mode) ; grande zone de dépôt « Glissez ici la fiche de poste, votre CV, votre fiche de préparation » (+ clic, + coller du texte, + Ctrl+V) ; liste des documents avec puce de type modifiable, aperçu, suppression ; bouton « Préparer avec l'IA » (progression) ; éditeur de prépa (pitch, questions/réponses éditables + ajout/suppression, questions à poser, chiffres clés, vigilance) ; boutons « Lancer l'entretien », « S'entraîner », « Exporter » (fichier / HTML autonome), « Supprimer ».
- **Live** (cœur) : choix du mode audio (presets, mémorisé) + contrôle pré-vol (vumètres, clé OK) puis « Démarrer ». Disposition PC 2 colonnes : gauche = **carte réponse** très lisible (police ajustable, question détectée au-dessus, source « Préparée » / « IA · modèle · 1,2 s », streaming), barre d'actions (Répondre maintenant, Plus court, Exemple concret, Reformuler, Pitch), historique des réponses (←/→) ; droite = transcription live (couleur par voix : Recruteur / Moi / Voix), saisie manuelle « Tapez une question », puces rapides (pitch, questions à poser, chiffres clés). Haut : chrono, pastilles d'état des sources avec vumètres, état IA, bouton **Fenêtre flottante**, Pause, Terminer. Mobile : empilé, carte réponse en haut.
  Déclenchement auto : finale 'them' (ou 'mixed' avec isQuestion) → attendre `answerDelayMs` sans nouvelle parole du recruteur (VAD 'speech' inactive) → réponse préparée instantanée si similarity ≥ 0.55, puis IA (S.ai.answer, annule la précédente). Si l'IA répond « — » en mode auto, garder l'affichage précédent. Wake Lock pendant le live (re-demandé au retour de visibilité). Sauvegarde continue. `beforeunload` avertit si session active.
- **Fenêtre flottante** : `documentPictureInPicture.requestWindow({width:420,height:560})`, y copier les feuilles de style, y afficher question + réponse (streaming synchronisé) + boutons compacts (Répondre, Plus court, ←/→) + mini-transcription ; repli : `window.open` popup 420×600 ; si rien → message.
- **Entraînement** : l'IA pose une question (affichée + lue par `speechSynthesis` voix fr-FR), je réponds au micro (webspeech, ou texte), bouton « J'ai fini » ou silence 2,5 s → note /10, feedback, meilleure réponse ; 5 à 10 questions ; bilan ; sauvegardé comme session 'training'.
- **Récap** : après « Terminer » → générer S.ai.recap, afficher en markdown, boutons Copier / Télécharger .md / Copier le mail de remerciement ; transcription complète repliable.
- **Réglages** : clés (champ masqué + œil, bouton Tester), « Se souvenir des clés sur cet appareil » (décocher sur un PC emprunté), « Effacer toutes mes données de cet appareil », fournisseur, modèles (auto / liste découverte), thème, taille du texte, réponse auto + délai, langue.
- **Diagnostic** : liste de vérifications avec ✓/⚠/✗ : navigateur compatible, micro (vumètre 3 s), reconnaissance vocale Chrome, capture audio d'onglet (bouton test), clé Gemini (latence), clé Claude, stockage persistant, hors-ligne prêt (service worker), fenêtre flottante dispo, Wake Lock. Conseils de correction en clair.
- **Raccourcis** (hors champs de saisie) : `Espace` répondre maintenant à la dernière question, `R` régénérer, `C` plus court, `E` exemple, `P` pitch, `←/→` historique, `+/-` taille, `F` fenêtre flottante, `M` pause, `?` aide.
- **Toasts** non bloquants (S.bus 'toast'), **jamais** d'`alert()`/`confirm()` natifs (utiliser une feuille modale maison).

### Design « Liquid Glass » (Apple 2026)
- Police : `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI Variable Text", "Segoe UI", Inter, system-ui, sans-serif`. Grands titres 34 px semi-gras, interlettrage négatif.
- Fond : dégradé doux animé lentement (aurora très subtile, désactivée si `prefers-reduced-motion`). Surfaces en verre : `backdrop-filter: blur(24px) saturate(180%)`, fond translucide, bordure 1px lumineuse (dégradé blanc → transparent en haut), reflet spéculaire `inset 0 1px 0 rgba(255,255,255,.5)`, ombre douce multi-couches, rayons 22–28 px (boutons en pilule).
- Couleurs : accent bleu système (#0071e3 / #0a84ff sombre), recruteur = violet/indigo, moi = vert, IA = bleu ; clair/sombre via `prefers-color-scheme` + réglage forcé `data-theme`.
- Contrôles natifs façon iOS : interrupteurs, contrôles segmentés, feuilles modales (bottom sheet sur mobile), barre d'onglets flottante en verre sur mobile.
- Icônes : SVG inline style SF Symbols (trait 1.8, coins arrondis), pas d'emoji dans les contrôles principaux.
- Micro-interactions : ressort `cubic-bezier(.2,.8,.2,1)`, 180–320 ms ; vumètres fluides ; pastille d'état pulsée en écoute.
- Accessibilité : contraste AA, focus visible, `aria-live="polite"` sur la carte réponse, cibles ≥ 44 px.

### PWA / build / distribution
- `manifest.webmanifest` : name « Souffleur — copilote d'entretien », short_name « Souffleur », start_url `./`, scope `./`, display `standalone`, `display_override:["window-controls-overlay","standalone"]`, couleurs, icônes 192/512 + maskable, `launch_handler: {client_mode: "focus-existing"}`, raccourcis (Nouvel entretien, Diagnostic).
- `sw.js` : cache versionné de la coquille (index, souffleur.html, manifest, icônes), stratégie stale-while-revalidate pour la coquille, **jamais** de mise en cache des API (googleapis, anthropic) ni de jsdelivr hors pdf.js ; nettoyage des anciens caches ; message `SKIP_WAITING` ; l'app affiche « Nouvelle version disponible — recharger ».
- Enregistrement du SW uniquement si `location.protocol === 'https:'` ou localhost.
- `tools/build.mjs` : lit `src/`, inline CSS et JS dans `index.html`, écrit `dist/site/index.html`, `dist/site/souffleur.html` (identique, fichier unique hors-ligne), copie manifest, sw (avec version = hash du contenu), icônes, `.nojekyll`, `404.html` → index. Vérifie qu'aucune chaîne `AIza[0-9A-Za-z_-]{30,}` / `sk-ant-` n'est présente (échec du build sinon).
- APK : TWA (`com.google.androidbrowserhelper:androidbrowserhelper`) pointant sur l'URL publique, package `io.github.cmssmc_code.souffleur` ; nom « Souffleur » ; icônes depuis src/icons ; signé avec une clé locale générée hors dépôt (`%USERPROFILE%\.souffleur\release.jks`) ; sortie `dist/Souffleur.apk`.
- Lanceur PC : `tools/Souffleur.cmd` ouvre `chrome.exe --app=URL` (chemins Chrome usuels, sinon `msedge.exe`, sinon navigateur par défaut).
