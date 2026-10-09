# 🤖 Bot WhatsApp de Rappels - Carnet d'Entretien (Baileys)

Ce module autonome permet d'envoyer des notifications WhatsApp automatiques pour votre application **Carnet d'Entretien Automobile** via la bibliothèque [Baileys](https://github.com/WhiskeySockets/Baileys).

---

## 🚀 Fonctionnalités incluses

1. **Diffusion Multi-utilisateurs (Tous les Membres)** :
   * Envoie les alertes à tous les utilisateurs enregistrés (conducteurs, famille).
   * Commande `!test` pour tester l'envoi simultané à tous les destinataires.
   * Commande `!ajouter <numéro>` pour ajouter un proche à la liste d'alerte.
   * Commande `!rejoindre` pour qu'un membre s'abonne directement depuis son propre WhatsApp.

2. **Rappel Relevé Kilométrique (tous les 15 jours)** :
   * Détecte si le dernier relevé de compteur date d'au moins 15 jours.
   * Envoie une alerte WhatsApp amicale incitant à mettre à jour le kilométrage.

3. **Rappels d'Entretiens Proches avec Escalade Progressive** :
   * Calcule les échéances réelles (par date et par kilométrage).
   * **Niveau 1 (J-15 à J-8)** : rappel envoyé tous les 4 jours.
   * **Niveau 2 (J-7 à J-3)** : rappel envoyé tous les 2 jours.
   * **Niveau 3 (J-2, jour J ou retard)** : rappel **QUOTIDIEN (chaque jour)**.
   * **Persistance du rappel** : Le rappel continue d'être envoyé chaque jour tant que vous n'avez pas cliqué sur **« Fait »** dans l'application pour valider l'opération.

4. **Commandes Interactives WhatsApp** :
   * `!test` : Déclenche un test de diffusion immédiat envoyé à **tous les membres**.
   * `!destinataires` : Affiche la liste des numéros qui reçoivent les alertes.
   * `!ajouter <numéro>` : Ajoute un nouveau proche aux alertes (ex: `!ajouter 213555123456`).
   * `!retirer <numéro>` : Retire un numéro de la liste de diffusion.
   * `!statut` : Affiche l'état des véhicules et la synchronisation.
   * `!verif` : Déclenche immédiatement une vérification des entretiens et diffuse les alertes si nécessaire.
   * `!broadcast <message>` : Envoie un message personnalisé à tous les membres.
   * `!rejoindre` : Permet à un proche de s'abonner en écrivant au bot.
   * `!aide` : Affiche le menu des commandes.

---

## 🛠️ Installation & Lancement rapide

### Étape 1 : Installer les dépendances
```bash
cd "whatsapp-bot"
npm install
```

### Étape 2 : Démarrer le Bot
```bash
npm start
```
1. Un **QR Code** s'affichera dans le terminal si première connexion.
2. Ouvrez **WhatsApp** > **Appareils connectés** > **Connecter un appareil** > Scannez le QR.
3. Une fois connecté, la session est sauvegardée dans le dossier `auth_info_baileys`.

### Étape 3 : Tester l'envoi à tous les utilisateurs
Deux méthodes simples :
1. **Depuis WhatsApp** : Envoyez simplement `!test` dans votre chat WhatsApp (ou discussion avec vous-même). Le bot répondra et diffusera le message de test à tous les utilisateurs configurés !
2. **Depuis le terminal** : Vous pouvez exécuter `npm run test:broadcast`.

---

## 👥 Ajouter d'autres utilisateurs

* **Option A (par commande WhatsApp)** :
  Tapez `!ajouter 213555123456` (avec l'indicatif pays, sans espace ni `+`). Le bot lui enverra automatiquement un message de bienvenue.
* **Option B (par message direct)** :
  Le proche envoie simplement `!rejoindre` au bot WhatsApp.
* **Option C (dans config.json ou .env)** :
  Ajoutez les numéros dans le tableau `"targetPhones": ["213555123456", "213770123456"]` de `config.json`.
