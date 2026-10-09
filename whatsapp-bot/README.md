# 🤖 Bot WhatsApp de Rappels - Carnet d'Entretien (Baileys)

Ce module autonome permet d'envoyer des notifications WhatsApp automatiques pour votre application **Carnet d'Entretien Automobile** via la bibliothèque [Baileys](https://github.com/WhiskeySockets/Baileys).

---

## 🚀 Fonctionnalités incluses

1. **Rappel Relevé Kilométrique (tous les 15 jours)** :
   * Détecte si le dernier relevé de compteur date d'au moins 15 jours.
   * Envoie une alerte WhatsApp amicale incitant à mettre à jour le kilométrage.

2. **Rappels d'Entretiens Proches avec Escalade Progressive** :
   * Calcule les échéances réelles (par date et par kilométrage).
   * **Niveau 1 (J-15 à J-8)** : rappel envoyé tous les 4 jours.
   * **Niveau 2 (J-7 à J-3)** : rappel envoyé tous les 2 jours.
   * **Niveau 3 (J-2, jour J ou retard)** : rappel **QUOTIDIEN (chaque jour)**.
   * **Persistance du rappel** : Le rappel continue d'être envoyé chaque jour tant que vous n'avez pas cliqué sur **« Fait »** dans l'application pour valider l'opération.

3. **Commandes Interactives** :
   * Envoyez `!statut` sur WhatsApp pour recevoir l'état actuel de votre véhicule.
   * Envoyez `!verif` pour déclencher une vérification manuelle immédiate.
   * Envoyez `!aide` pour afficher la liste des commandes.

---

## 🛠️ Installation & Lancement rapide

### Étape 1 : Installer les dépendances
Ouvrez un terminal dans le dossier `whatsapp-bot` :
```bash
cd "whatsapp-bot"
npm install
```

### Étape 2 : Configurer le fichier `.env`
Créez ou modifiez le fichier `.env` (en copiant `.env.example`) :
```env
# Votre numéro WhatsApp au format international sans le signe + (ex: 213555123456 ou 33612345678)
TARGET_WHATSAPP_PHONE=213555123456

# Identifiant de votre salle partagée dans Firestore (copiez l'ID affiché dans l'URL de partage ou dans la console Firestore)
FIREBASE_ROOM_ID=VOTRE_ROOM_ID_ICI

# ID du projet Firebase
FIREBASE_PROJECT_ID=entretien-auto-tracker
FIREBASE_API_KEY=AIzaSyA7qjZi_aWunCo15Y96BbvsZfX7n7O8LO8

# Fréquence de vérification automatique en heures (défaut : 12 heures)
CHECK_INTERVAL_HOURS=12
```

### Étape 3 : Démarrer le Bot
```bash
npm start
```
1. Un **QR Code** s'affichera directement dans votre terminal.
2. Ouvrez **WhatsApp** sur votre téléphone > **Paramètres** (ou trois points verticaux) > **Appareils connectés** > **Connecter un appareil**.
3. Scannez le code QR.
4. Une fois connecté, la session est enregistrée dans le dossier `auth_info_baileys` : vous n'aurez plus besoin de scanner à nouveau !

---

## ☁️ Hébergement en continu (Optionnel)
Pour que le bot tourne 24h/24 en arrière-plan sans garder votre PC ouvert :
* Utilisez un VPS, un Raspberry Pi ou un service cloud avec **PM2** :
```bash
npm install -g pm2
pm2 start bot.js --name "carnet-whatsapp-bot"
pm2 save
pm2 startup
```
