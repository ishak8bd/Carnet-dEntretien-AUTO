// scripts/show-github-secrets.mjs
// Affiche les variables secrètes à copier-coller dans GitHub Repository Secrets
// pour activer les rappels automatiques 24h/24 dans le Cloud (GitHub Actions)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const emailConfigFile = path.join(__dirname, 'email-config.json');
const serviceAccountFile = path.join(__dirname, '..', 'serviceAccountKey.json');

let emailConfig = {};
try {
  if (fs.existsSync(emailConfigFile)) {
    emailConfig = JSON.parse(fs.readFileSync(emailConfigFile, 'utf-8'));
  }
} catch (e) {}

let serviceAccountStr = '';
try {
  if (fs.existsSync(serviceAccountFile)) {
    serviceAccountStr = fs.readFileSync(serviceAccountFile, 'utf-8').trim();
  }
} catch (e) {}

console.log("======================================================================");
console.log("  SECRETS GITHUB ACTIONS À CONFIGURER SUR GITHUB (POUR LE CLOUD 24/7)");
console.log("======================================================================\n");
console.log("Rendez-vous sur votre dépôt GitHub :");
console.log("👉 https://github.com/ishak8bd/Carnet-dEntretien-AUTO/settings/secrets/actions\n");
console.log("Cliquez sur 'New repository secret' pour ajouter chacune de ces 3 variables :\n");

console.log("----------------------------------------------------------------------");
console.log("1. Nom du secret : GMAIL_USER");
console.log("   Valeur        : " + (emailConfig.gmailUser || 'votre-adresse@gmail.com'));
console.log("----------------------------------------------------------------------\n");

console.log("----------------------------------------------------------------------");
console.log("2. Nom du secret : GMAIL_APP_PASSWORD");
console.log("   Valeur        : " + (emailConfig.gmailAppPassword ? emailConfig.gmailAppPassword.replace(/\s+/g, '') : ''));
console.log("----------------------------------------------------------------------\n");

console.log("----------------------------------------------------------------------");
console.log("3. Nom du secret : FIREBASE_SERVICE_ACCOUNT");
console.log("   Valeur        : Copiez l'intégralité du contenu JSON ci-dessous :");
console.log(serviceAccountStr ? JSON.stringify(JSON.parse(serviceAccountStr)) : "(serviceAccountKey.json non trouvé)");
console.log("----------------------------------------------------------------------\n");

console.log("----------------------------------------------------------------------");
console.log("4. Nom du secret : VAPID_PUBLIC_KEY");
console.log("   Valeur        : " + (emailConfig.vapidPublicKey || 'BBkQiwciU2eY1iWtPhEZhVHffN1p82QiHSF5DLi5nefWrS6sDsAGbw7Zqy83jH-5Qn97YMd6uLHQM1wfHLFv5_0'));
console.log("----------------------------------------------------------------------\n");

console.log("----------------------------------------------------------------------");
console.log("5. Nom du secret : VAPID_PRIVATE_KEY");
console.log("   Valeur        : " + (emailConfig.vapidPrivateKey || ''));
console.log("----------------------------------------------------------------------\n");

console.log("Une fois ces secrets ajoutés, GitHub Actions exécutera automatiquement");
console.log("les vérifications et enverra les e-mails ET notifications Web Push");
console.log("SANS AUCUNE INTERVENTION et même si votre ordinateur est éteint ! 🚀");
