# Souffleur — application Android (TWA)

L'APK ouvre l'app web publique `https://cmssmc-code.github.io/souffleur/` en plein écran dans Chrome
(Trusted Web Activity) : même code, mêmes mises à jour que le site, micro et reconnaissance vocale de Chrome.

## Construire

```powershell
pwsh -NoProfile -File tools\build-apk.ps1            # → dist\Souffleur.apk
pwsh -NoProfile -File tools\build-apk.ps1 -Install   # + adb install -r sur le téléphone connecté
```

Le script trouve le JDK (17+) et le SDK Android (platform 36, build-tools 36.0.0), régénère les icônes
depuis `src/icons/icon.svg` (`android/scripts/gen-icons.mjs`), signe, vérifie l'APK (apksigner, aapt2)
et réécrit `android/assetlinks.json`.

Options : `-AppUrl`, `-VersionName`, `-VersionCode` (par défaut tirés de `package.json` :
2.0.0 → 20000), `-SkipIcons`, `-Clean`.

## Clé de signature

`%USERPROFILE%\.souffleur\release.jks` + `release.properties` (mot de passe aléatoire), créés au premier
build, **jamais dans le dépôt**. Sauvegardez ce dossier : sans cette clé, impossible de mettre à jour
l'app installée, et `assetlinks.json` ne correspondrait plus.

## Publier assetlinks.json (indispensable pour masquer la barre d'adresse)

Android vérifie `https://cmssmc-code.github.io/.well-known/assetlinks.json` (racine du domaine, pas
`/souffleur/`). Donc, dans le dépôt GitHub Pages utilisateur `cmssmc-code/cmssmc-code.github.io` :

- copier `android/assetlinks.json` vers `.well-known/assetlinks.json` ;
- ajouter un fichier `.nojekyll` vide à la racine (sinon Jekyll ignore les dossiers commençant par un point).

Vérification :
`https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://cmssmc-code.github.io&relation=delegate_permission/common.handle_all_urls`

Tant que le fichier n'est pas publié, l'app fonctionne mais affiche une fine barre d'URL en haut.

## Comportement

- **Chrome, Edge, Samsung Internet…** : TWA, splash aux couleurs de l'app, clair/sombre, orientation libre,
  raccourcis « Nouvel entretien » et « Diagnostic » (appui long sur l'icône), liens
  `https://cmssmc-code.github.io/souffleur/…` ouverts dans l'app, une session en cours n'est jamais remplacée
  (`focus-existing`).
- **Aucun navigateur compatible** : `WebFallbackActivity` (WebView) avec micro, import de documents,
  exports (« Enregistrer sous »), écran maintenu allumé, liens externes dans le navigateur, reprise après
  crash du moteur de rendu. Limites propres à la WebView : pas de reconnaissance vocale de Chrome
  (utiliser la transcription IA), pas de fenêtre flottante.
- Pas de sauvegarde Android des données (clés API et dossiers restent sur l'appareil).

## Arborescence

```
android/
  app/build.gradle            URL, version, signature (lit ~/.souffleur/release.properties)
  app/src/main/AndroidManifest.xml
  app/src/main/java/…/LauncherActivity.java, ColdShortcutActivity.java, WebFallbackActivity.java
  app/src/main/res/           icônes adaptatives (+ monochrome Android 13), splash, couleurs, raccourcis
  scripts/gen-icons.mjs       rendu des icônes (playwright-core + Chromium)
  assetlinks.json             à publier (voir plus haut)
```

Versions : Gradle 8.14.4 (wrapper), Android Gradle Plugin 8.13.2, compileSdk/targetSdk 36, minSdk 24,
androidbrowserhelper 2.7.4, androidx.webkit 1.17.1.
