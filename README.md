# Carnet d'entretien

Application web sans serveur pour suivre l'entretien d'une voiture : échéances, rendez-vous, factures et budget.

Ce dépôt ne contient que le code. Les données restent dans le Dropbox de l'utilisateur, ou dans le navigateur en mode local.

## Configurer Dropbox

1. Sur https://www.dropbox.com/developers/apps, créer une application « Scoped access » avec l'accès « Full Dropbox ».
2. Dans l'onglet Permissions, cocher `files.metadata.read`, `files.content.read` et `files.content.write`, puis enregistrer.
3. Dans l'onglet Settings, ajouter l'adresse de la page aux « Redirect URIs ».
4. Copier la clé « App key » dans `DROPBOX_APP_KEY`, dans `js/config.js`.

## Tester

```bash
node --test test/
```

```bash
python3 -m http.server 4173
```

## Police

L'interface est composée en Apfel Grotezk (Collletttivo). Déposer `ApfelGrotezk-Regular.woff2` et `ApfelGrotezk-Mittel.woff2` dans `fonts/`. Sans ces fichiers, la police installée sur l'appareil est utilisée si elle existe, sinon la police système.
