// scripts/send-email-reminders.js
// Pont d'exécution CommonJS vers le module ESM send-email-reminders.mjs

import('./send-email-reminders.mjs').catch(err => {
  console.error("Erreur lancement rappels e-mail:", err);
  process.exit(1);
});
