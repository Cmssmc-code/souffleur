# Souffleur — copilote d'entretien d'embauche

Souffleur écoute votre entretien Meet ou Teams, reconnaît les questions du recruteur et affiche
en moins d'une seconde la réponse que vous avez préparée, puis une réponse affinée par l'IA,
en gros caractères, dans une fenêtre flottante posée à côté de la visio.

**Ouvrir l'app : <https://cmssmc-code.github.io/souffleur/>**

Rien à installer pour commencer : ça marche dans Chrome ou Edge, sur n'importe quel PC
(le vôtre, celui d'un proche, un PC de bureau hors de votre wifi) et sur Android.

---

## Les 10 atouts

1. **Disponible partout, même hors de chez vous.** Une simple adresse web, installable comme une vraie
   application sur PC et sur Android, qui s'ouvre même sans connexion. Ou bien un fichier unique
   `souffleur.html` à garder sur une clé USB ou dans vos mails.
2. **Entend vraiment l'appel.** Souffleur capte directement le son de l'onglet Meet, ou le son du PC pour
   l'application Teams : la voix du recruteur arrive proprement, votre micro capte la vôtre. Les deux voix
   sont séparées et vous gardez votre casque.
3. **Transcription solide.** La voix du recruteur est transcrite par Gemini, la vôtre par la reconnaissance
   vocale de Chrome (gratuite). Un mode « haut-parleur » fonctionne sans aucune clé. En cas de coupure,
   l'écoute reprend toute seule et aucune phrase n'est perdue.
4. **Vos documents en un geste.** Glissez la fiche de poste, votre CV et votre fiche de préparation (PDF, Word,
   ODT, texte, page web, RTF, capture d'écran d'une annonce) ou collez simplement le texte avec Ctrl+V.
   Souffleur reconnaît tout seul de quel document il s'agit.
5. **Préparation faite pour vous.** À partir de vos documents : pitch de 60 secondes, environ 25 questions
   probables avec vos réponses prêtes (à la première personne, tirées de votre CV), questions à poser au
   recruteur, chiffres clés et points de vigilance. Tout se relit et se modifie.
6. **Réponse instantanée.** Dès qu'une question est reconnue, la réponse préparée s'affiche aussitôt, même
   sans réseau. L'IA prend le relais une seconde plus tard avec une réponse adaptée à toute la conversation.
7. **Ne vous lâche pas en plein appel.** Gemini, puis Claude en secours, plusieurs modèles avec bascule
   automatique en cas de saturation ou de coupure, sauvegarde continue, écran maintenu allumé, et un
   diagnostic complet (micro, son de l'onglet, clé, latence, mode hors-ligne) à faire avant l'entretien.
8. **Un dossier par entretien, transportable.** Exportez un dossier en fichier `.souffleur.json` (clé incluse
   si vous le souhaitez) ou en page HTML autonome, réimportez-le sur un autre appareil. Sur un PC emprunté,
   la clé peut n'être gardée que le temps de la session.
9. **Beau et lisible en 3 secondes.** Design « Liquid Glass » clair ou sombre, très gros texte de réponse,
   fenêtre flottante toujours au-dessus de Meet ou Teams, raccourcis clavier, affichage adapté au téléphone.
10. **Avant et après l'appel.** Mode entraînement : l'IA vous pose les questions à voix haute, vous répondez
    au micro, elle note sur 10 et propose une meilleure réponse. Après l'appel : récap avec les questions
    posées, vos points forts et à améliorer, et un mail de remerciement prêt à copier.

---

## Installation

### Sur PC (Chrome ou Edge) — recommandé

**Option 1 — installer l'application web (30 secondes)**

1. Ouvrez <https://cmssmc-code.github.io/souffleur/> dans Chrome ou Edge.
2. Cliquez sur l'icône **Installer** à droite de la barre d'adresse (ou sur le bouton **Installer l'app** de
   l'accueil Souffleur).
3. Souffleur s'ouvre dans sa propre fenêtre, avec une icône dans le menu Démarrer. Il démarre ensuite même
   sans Internet (l'IA, elle, a besoin du réseau).

**Option 2 — raccourcis Bureau et menu Démarrer**

1. Téléchargez `Installer-Souffleur.ps1` et `Souffleur.cmd` depuis
   <https://cmssmc-code.github.io/souffleur/pc/Installer-Souffleur.ps1> et
   <https://cmssmc-code.github.io/souffleur/pc/Souffleur.cmd> (ou prenez-les dans le dossier `tools/`).
2. Clic droit sur `Installer-Souffleur.ps1` → **Exécuter avec PowerShell**.
   Aucun droit administrateur n'est nécessaire. Pour tout retirer : `Souffleur.cmd /uninstall`.
3. `Souffleur.cmd` seul ouvre l'app dans une fenêtre dédiée (Chrome, sinon Edge, sinon le navigateur par
   défaut). `Souffleur.cmd http://localhost:8080/` ouvre une autre adresse.

**Option 3 — PC emprunté, sans rien installer**

1. Ouvrez l'adresse dans Chrome, importez votre dossier (`.souffleur.json`) ou déposez vos documents.
2. Dans **Réglages**, décochez **Se souvenir des clés sur cet appareil** : la clé disparaît à la fermeture.
3. Après l'entretien : **Réglages → Effacer toutes mes données de cet appareil**.

### Sur Android

- **Depuis Chrome** : ouvrez l'adresse, menu **⋮ → Installer l'application** (ou « Ajouter à l'écran
  d'accueil »).
- **APK** : installez `Souffleur.apk` (autorisez « Installer des applications inconnues » pour votre
  navigateur ou votre gestionnaire de fichiers). L'APK ouvre la version en ligne en plein écran.

Sur téléphone, le mode conseillé est **Haut-parleur ou téléphone à côté** : posez le téléphone près du PC
ou mettez l'appel en haut-parleur.

### Fichier unique (clé USB, pièce jointe)

1. Téléchargez <https://cmssmc-code.github.io/souffleur/souffleur.html> (clic droit → Enregistrer sous),
   ou prenez `dist/site/souffleur.html` après un build.
2. Double-cliquez dessus : il s'ouvre dans votre navigateur, sans installation, même sans Internet.
3. Toute l'interface, vos dossiers et les réponses préparées fonctionnent hors-ligne. La transcription et
   les réponses IA ont besoin d'Internet. Si le micro est refusé en mode fichier, utilisez la version en ligne.

---

## Mode d'emploi : entretien Meet ou Teams pas à pas

### La veille

1. **Nouvel entretien** : entreprise, poste, nom du recruteur, date et heure.
2. Glissez dans la grande zone : **fiche de poste**, **CV**, **fiche de préparation** (ou collez le texte).
3. **Préparer avec l'IA**, puis relisez le pitch et les réponses : corrigez ce qui ne vous ressemble pas.
4. **S'entraîner** 10 minutes à voix haute.
5. Ouvrez **Diagnostic** : micro, reconnaissance vocale, son de l'onglet, clé Gemini, mode hors-ligne
   doivent être au vert. Une clé Gemini gratuite se crée sur <https://aistudio.google.com/apikey>.

### Le jour J avec Google Meet (dans Chrome ou Edge)

1. Ouvrez Meet dans un onglet et rejoignez l'appel. Un casque ou des écouteurs sont conseillés.
2. Dans Souffleur, ouvrez le dossier → **Lancer l'entretien** → mode **Visio sur ce PC (Meet / Teams)** →
   **Démarrer**.
3. Le navigateur demande quoi partager : choisissez l'onglet **Onglet Chrome** (ou « Onglet » dans Edge),
   sélectionnez l'onglet **Meet**, cochez **« Partager aussi l'audio de l'onglet »**, puis **Partager**.
4. Autorisez le micro si le navigateur le demande.
5. Cliquez sur **Fenêtre flottante** (touche `F`) et placez-la à côté de la vidéo.

Ce partage reste sur votre PC : il sert uniquement à Souffleur pour entendre l'onglet. Le recruteur ne voit
rien et votre écran n'est pas partagé dans Meet. Vous pouvez cliquer sur « Masquer » dans le bandeau
« Partage de cet onglet ».

### Le jour J avec l'application Teams (Windows)

1. Rejoignez la réunion dans l'application Teams.
2. Dans Souffleur : **Lancer l'entretien** → **Visio sur ce PC (Meet / Teams)** → **Démarrer**.
3. Dans la fenêtre de partage, choisissez l'onglet **Écran entier**, sélectionnez votre écran, activez
   **« Partager aussi l'audio du système »**, puis **Partager**.
4. Ouvrez la **Fenêtre flottante** et placez-la à côté de Teams.
5. Conseil : activez « Ne pas déranger » dans Windows, sinon les sons de notification sont aussi transcrits.

Teams dans le navigateur (teams.microsoft.com) : suivez la procédure Meet (onglet + audio de l'onglet).
Sur Mac, le son système n'est pas capturable : utilisez Meet ou Teams dans Chrome, ou le mode haut-parleur.

### Appel décroché sur le PC (Lien avec Windows) ou partage audio muet : « Son du PC »

Quand l'appel du téléphone est décroché sur le PC (Lien avec Windows / Phone Link), pour Teams ou Meet, ou
quand le partage « audio du système » de Chrome reste muet, utilisez le mode **Appel ou visio sur ce PC
(son interne)**. Tout le travail audio est fait hors de Chrome par un programme local, **Son du PC** :

- il écoute **séparément** le son joué par Windows (boucle WASAPI = le correspondant) et le micro (vous) :
  chaque phrase est attribuée à coup sûr, sans haut-parleur ni fenêtre de partage ;
- il découpe les phrases (Silero) et les transcrit : **Groq Whisper turbo** (~0,3 s) si une clé Groq est
  saisie dans les Réglages, sinon **Whisper sur le PC** (faster-whisper, ~0,5-2 s, sans Internet ni clé) ;
  repli automatique sur le PC si Groq échoue ou tarde plus de 3 s ;
- il envoie le texte en direct de la phrase du correspondant (questions préparées reconnues avant la fin) ;
- sans casque, une phrase du micro prononcée pendant que le son du PC parle (écho) est ignorée ;
- il suit seul les changements de périphérique (casque, Bluetooth) et ignore les périphériques « mains
  libres » créés par Lien avec Windows pendant un appel (sinon les voix seraient inversées).

1. Une fois pour toutes : clic droit sur `tools/son-pc/Installer-Son-du-PC.ps1` → *Exécuter avec PowerShell*
   (modules Python `pyaudiowpatch numpy websockets faster-whisper`, modèle Whisper « base », lancement à
   chaque ouverture de session ; `-Uninstall` pour le retirer).
2. Dans Souffleur : **Lancer l'entretien** → **Appel ou visio sur ce PC (son interne)** : la ligne
   « Son du PC (interne) » doit être verte → **Démarrer**.
3. Décrochez l'appel **sur le PC** (dans Lien avec Windows, cliquez sur le PC, ou « Transférer vers
   l'ordinateur » si l'appel a été pris sur le téléphone). Casque conseillé ; « Ne pas déranger » activé :
   tout le son du PC est écouté.

Le programme n'accepte que le site Souffleur et `localhost` (aucune autre page ne peut écouter le PC ni lire
les transcriptions) et écrit son journal dans `%LOCALAPPDATA%\Souffleur\son-pc.log`. Réglages :
`SOUFFLEUR_MODELE` = `auto` (base, puis small sur secteur si assez rapide) | `base` | `small`.

### Sans clé ou sans casque

Choisissez **Haut-parleur ou téléphone à côté** ou **Visio sur ce PC, son sur haut-parleurs (sans clé)** :
un seul micro entend les deux voix, la transcription est gratuite, les réponses préparées s'affichent
toujours instantanément.

### Pendant l'appel

Souffleur détecte la question, attend que le recruteur ait fini de parler, affiche la réponse préparée
puis la réponse IA. Si rien ne se déclenche, tapez la question dans « Tapez une question ».

| Touche | Action | Touche | Action |
|---|---|---|---|
| `Espace` | Répondre maintenant | `P` | Pitch |
| `R` | Régénérer | `←` `→` | Réponses précédentes / suivantes |
| `C` | Plus court | `+` `-` | Taille du texte |
| `E` | Exemple concret | `F` | Fenêtre flottante |
| `M` | Pause | `?` | Aide |

### Après l'appel

**Terminer** ouvre le récap : synthèse, questions posées avec la qualité de vos réponses, points forts,
points à améliorer, sujets à relancer et **mail de remerciement** prêt à copier.

### En cas de souci

- **« Aucun son de l'onglet »** : relancez **Démarrer** et cochez bien la case d'audio dans la fenêtre de partage.
- **Micro refusé** : cliquez sur le cadenas à gauche de l'adresse → Micro → Autoriser, puis rechargez.
- **IA lente ou quota atteint** : Souffleur bascule tout seul sur un autre modèle ou sur Claude. Vérifiez la
  clé dans **Réglages → Tester**.
- **Nouvelle version disponible** : cliquez sur « Recharger » dans le message, entre deux entretiens.

---

## Confidentialité

- **Pas de serveur Souffleur.** L'app est un site statique : vos dossiers, documents, transcriptions et
  réglages restent dans le navigateur de l'appareil (IndexedDB).
- **Seuls échanges réseau** : Google Gemini (`generativelanguage.googleapis.com`) et Anthropic Claude
  (`api.anthropic.com`) avec **votre** clé, et la bibliothèque de lecture PDF (`cdn.jsdelivr.net`).
  Ces requêtes ne sont jamais mises en cache.
- **Audio** : en mode Visio avec clé, la voix du recruteur est envoyée par petits segments à Gemini pour
  être transcrite. Votre voix est transcrite par la reconnaissance vocale de Chrome (service Google).
  En mode haut-parleur, seule la reconnaissance vocale de Chrome est utilisée.
- **Clé gratuite AI Studio** : Google peut utiliser les contenus envoyés pour améliorer ses services.
  Activez la facturation sur votre projet Google si vous voulez l'éviter.
- **Clés API** : enregistrées sur l'appareil, ou seulement pour la session si vous décochez
  « Se souvenir des clés ». Un export `.souffleur.json` ne contient la clé que si vous le demandez :
  ne le partagez pas dans ce cas.
- **Tout effacer** : Réglages → Effacer toutes mes données de cet appareil.
- Le code publié ne contient aucune clé ni donnée personnelle : le build échoue s'il en détecte.

---

## Pour les développeurs

Aucune dépendance à l'exécution, aucun build obligatoire : `src/` s'ouvre tel quel.

```bash
npm install            # playwright-core (outils de test et d'icônes uniquement)
npm run serve          # http://127.0.0.1:8080/  (src/ sans build, service worker en mode « réseau d'abord »)
npm run build          # dist/site/ : index.html et souffleur.html autonomes, sw.js versionné, 404.html, .nojekyll
npm run serve:dist     # http://127.0.0.1:8081/  (version construite)
npm run check:pwa      # vérifie le service worker : installation, cache, hors-ligne, mise à jour
npm run icons          # régénère les PNG et souffleur.ico depuis src/icons/icon.svg
npm test               # tests unitaires (util, store, ai, audio) + tests de bout en bout
npm run test:e2e       # bout en bout dans Chromium : API IA mockées, faux micro, file:// et build
npm run test:browser   # IndexedDB réel + lecture des documents (DOCX, ODT, PDF…) dans Chromium
npm run test:pwa       # build --strict + vérification du service worker
npm run test:all       # tout ce qui précède
npm run shots          # captures de chaque écran (clair, sombre, mobile) + audit visuel automatique
```

Les tests de bout en bout (`tests/e2e.mjs`) n'appellent jamais les vraies API : Gemini et Claude sont
simulés (liste des modèles, `generateContent`, `streamGenerateContent` en SSE, `messages`), la reconnaissance
vocale est remplacée par un double pilotable, et le micro de Chromium lit un WAV de parole française généré par
la synthèse vocale de Windows (`tests/.cache/`). Scénarios couverts : prise en main, création et import de
dossiers, lecture DOCX/TXT/PDF, préparation par l'IA, live « haut-parleur », live transcription IA (VAD),
partage d'onglet, bascule de modèle sur 429, clé refusée (401) puis secours Claude, hors-ligne, fenêtre
flottante, récap, entraînement, réglages (clé de session), diagnostic, export/import, page HTML autonome,
glisser-déposer, fichier unique en `file://` et garde-fou anti-secrets du build.

- `node tools/serve.mjs <port> <dossier> [--host 0.0.0.0]` : serveur statique (port 0 = port libre).
- `node tools/build.mjs --strict` : les avertissements (fichier manquant, ordre des scripts…) deviennent bloquants.
- Garde anti-secrets : le build échoue sur toute clé Google ou Anthropic, et sur chaque ligne du fichier
  facultatif `%USERPROFILE%\.souffleur\denylist.txt` (nom, téléphone, e-mail… à ne jamais publier).
- Publication : le contenu de `dist/site/` est servi tel quel par GitHub Pages
  (`https://cmssmc-code.github.io/souffleur/`).
- Structure et contrats des modules : voir [SPEC.md](SPEC.md).
