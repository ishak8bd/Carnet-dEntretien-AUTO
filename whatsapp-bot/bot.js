// bot.js - Bot WhatsApp Baileys pour Carnet d'Entretien Automobile
//
// Fonctionnalités :
// 1. Rappel de relevé kilométrique tous les 15 jours (si aucun relevé récent).
// 2. Rappel d'entretiens proches avec cadence d'envoi progressive (escalade) :
//    - J-15 à J-8 : rappel tous les 4 jours.
//    - J-7 à J-3  : rappel tous les 2 jours.
//    - J-2 à retard : rappel QUOTIDIEN (chaque jour), répété jusqu'à ce que l'utilisateur clique sur "Fait" dans l'application.
// 3. Commandes interactives WhatsApp (!statut, !aide, !km <valeur>).

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const TARGET_PHONE = process.env.TARGET_WHATSAPP_PHONE || '';
const ROOM_ID = process.env.FIREBASE_ROOM_ID || '';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'entretien-auto-tracker';
const API_KEY = process.env.FIREBASE_API_KEY || '';
const CHECK_HOURS = parseInt(process.env.CHECK_INTERVAL_HOURS || '12', 10);

const HISTORY_FILE = path.join(__dirname, 'notification_history.json');

// Gestionnaire d'historique des notifications pour éviter le spam et gérer l'escalade
function loadNotificationHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    }
  } catch (e) {
    console.warn("Échec lecture historique notifications:", e.message);
  }
  return { mileage: {}, items: {} };
}

function saveNotificationHistory(hist) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(hist, null, 2), 'utf-8');
  } catch (e) {
    console.warn("Échec sauvegarde historique notifications:", e.message);
  }
}

let sock = null;

// ============================================================================
// 1. RÉCUPÉRATION DES DONNÉES FIRESTORE
// ============================================================================

async function fetchFirestoreCollection(subcollection) {
  if (!ROOM_ID) {
    console.warn("⚠️ FIREBASE_ROOM_ID non renseigné dans le fichier .env");
    return [];
  }

  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/rooms/${ROOM_ID}/${subcollection}?key=${API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`Erreur HTTP Firestore (${res.status}) sur ${subcollection}`);
      return [];
    }
    const data = await res.json();
    if (!data.documents) return [];

    return data.documents.map(doc => {
      const fields = doc.fields || {};
      const out = { id: doc.name.split('/').pop() };
      for (const [k, v] of Object.entries(fields)) {
        if ('stringValue' in v) out[k] = v.stringValue;
        else if ('integerValue' in v) out[k] = parseInt(v.integerValue, 10);
        else if ('doubleValue' in v) out[k] = parseFloat(v.doubleValue);
        else if ('booleanValue' in v) out[k] = v.booleanValue;
        else if ('timestampValue' in v) out[k] = v.timestampValue;
        else if ('nullValue' in v) out[k] = null;
      }
      return out;
    });
  } catch (err) {
    console.error(`Erreur réseau Firestore pour ${subcollection}:`, err.message);
    return [];
  }
}

async function getTrackerData() {
  const vehicles = await fetchFirestoreCollection('vehicles');
  const items = await fetchFirestoreCollection('items');
  const kmLogs = await fetchFirestoreCollection('kmLogs');

  return { vehicles, items, kmLogs };
}

// ============================================================================
// 2. LOGIQUE MÉTIER & VÉRIFICATION DES ÉCHÉANCES
// ============================================================================

function formatPhoneJid(phone) {
  let cleaned = phone.replace(/[^0-9]/g, '');
  if (!cleaned.endsWith('@s.whatsapp.net')) {
    cleaned = `${cleaned}@s.whatsapp.net`;
  }
  return cleaned;
}

async function sendWhatsAppMessage(jid, text) {
  if (!sock) {
    console.warn("Bot non connecté, impossible d'envoyer le message.");
    return false;
  }
  try {
    await sock.sendMessage(jid, { text });
    console.log(`[WhatsApp] Message envoyé avec succès à ${jid}`);
    return true;
  } catch (err) {
    console.error(`[WhatsApp] Échec d'envoi du message:`, err.message);
    return false;
  }
}

/**
 * Vérifie le kilométrage (tous les 15 jours) et les entretiens (escalade progressive)
 */
async function runReminderChecks() {
  console.log(`\n🔍 [${new Date().toLocaleString('fr-FR')}] Vérification des rappels...`);
  if (!TARGET_PHONE) {
    console.warn("⚠️ TARGET_WHATSAPP_PHONE manquant dans .env. Vérification ignorée.");
    return;
  }

  const jid = formatPhoneJid(TARGET_PHONE);
  const data = await getTrackerData();
  const history = loadNotificationHistory();
  const now = Date.now();

  for (const veh of data.vehicles) {
    const vehId = veh.id;
    const vehLogs = data.kmLogs
      .filter(l => l.vehicleId === vehId)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const lastLog = vehLogs.length > 0 ? vehLogs[vehLogs.length - 1] : null;
    const currentKm = veh.currentKm || (lastLog ? lastLog.km : 0);

    // ------------------------------------------------------------------------
    // RAPPEL 1 : RELEVÉ KILOMÉTRIQUE TOUS LES 15 JOURS
    // ------------------------------------------------------------------------
    if (lastLog && lastLog.date) {
      const lastLogDate = new Date(lastLog.date).getTime();
      const daysElapsed = Math.floor((now - lastLogDate) / (1000 * 60 * 60 * 24));

      // Rappel déclenché dès 15 jours sans relevé
      if (daysElapsed >= 15) {
        const lastSent = history.mileage[vehId] || 0;
        const hoursSinceLastNotification = (now - lastSent) / (1000 * 60 * 60);

        // Envoyer au maximum 1 fois tous les 2 jours pour ne pas surcharger
        if (hoursSinceLastNotification >= 48) {
          const msg = `🚗 *RAPPEL KILOMÉTRAGE - Carnet d'Entretien*\n\n` +
            `Bonjour ! Votre dernier relevé de compteur pour *${veh.name || 'votre véhicule'}* (${veh.brand} ${veh.model}) date d'il y a *${daysElapsed} jours* (le ${lastLog.date}).\n\n` +
            `📊 Dernier kilométrage enregistré : *${currentKm.toLocaleString('fr-FR')} km*\n\n` +
            `➡️ Pensez à relever votre compteur et à l'actualiser dans l'application pour maintenir la fiabilité de vos échéances d'entretien !`;

          const sent = await sendWhatsAppMessage(jid, msg);
          if (sent) {
            history.mileage[vehId] = now;
            saveNotificationHistory(history);
          }
        }
      } else {
        // Si le kilométrage a été mis à jour récemment, réinitialiser la date d'envoi
        delete history.mileage[vehId];
        saveNotificationHistory(history);
      }
    }

    // Calcul du rythme journalier estimé pour les calculs d'entretien
    let dailyRate = 35; // Rythme moyen par défaut (~13 000 km/an)
    if (vehLogs.length >= 2) {
      const first = vehLogs[0];
      const last = vehLogs[vehLogs.length - 1];
      const diffKm = last.km - first.km;
      const diffDays = Math.max(1, Math.round((new Date(last.date) - new Date(first.date)) / (1000 * 60 * 60 * 24)));
      if (diffKm > 0 && diffDays > 0) {
        dailyRate = Math.max(5, diffKm / diffDays);
      }
    }

    // ------------------------------------------------------------------------
    // RAPPEL 2 : ENTRETIENS PROCHES AVEC ESCALADE PROGRESSIVE
    // ------------------------------------------------------------------------
    const vehItems = data.items.filter(i => i.vehicleId === vehId && !i.deleted);

    for (const item of vehItems) {
      const itemId = item.id;
      // Si non renseigné, ignorer les calculs d'échéance
      if (item.lastDate === null && item.lastKm === null) continue;

      let remainingKm = null;
      let remainingDaysByKm = null;
      let remainingDaysByDate = null;

      // Calcul restant par kilométrage
      if (item.intervalKm && item.lastKm !== null) {
        const dueKm = item.lastKm + item.intervalKm;
        remainingKm = dueKm - currentKm;
        remainingDaysByKm = Math.round(remainingKm / dailyRate);
      }

      // Calcul restant par date calendaire
      if (item.intervalMonths && item.lastDate) {
        const lastD = new Date(item.lastDate);
        const targetDate = new Date(lastD);
        targetDate.setMonth(targetDate.getMonth() + item.intervalMonths);
        remainingDaysByDate = Math.round((targetDate.getTime() - now) / (1000 * 60 * 60 * 24));
      }

      // Prendre le premier des deux critères qui arrive à échéance
      let effectiveRemainingDays = 999;
      if (remainingDaysByKm !== null && remainingDaysByDate !== null) {
        effectiveRemainingDays = Math.min(remainingDaysByKm, remainingDaysByDate);
      } else if (remainingDaysByKm !== null) {
        effectiveRemainingDays = remainingDaysByKm;
      } else if (remainingDaysByDate !== null) {
        effectiveRemainingDays = remainingDaysByDate;
      }

      // Si l'entretien est fait récemment et loin de l'échéance, nettoyer l'historique
      if (effectiveRemainingDays > 15 && (remainingKm === null || remainingKm > 500)) {
        if (history.items[itemId]) {
          delete history.items[itemId];
          saveNotificationHistory(history);
        }
        continue;
      }

      // DÉTERMINATION DU NIVEAU D'ESCALADE :
      // - Niveau 1 (Approche : J-15 à J-8 ou reste 250-500 km) -> rappel tous les 4 jours (96h)
      // - Niveau 2 (Très proche : J-7 à J-3 ou reste 100-250 km) -> rappel tous les 2 jours (48h)
      // - Niveau 3 (Imminent / Retard : J-2 à retard ou reste < 100 km) -> rappel QUOTIDIEN (24h)
      let level = 1;
      let cooldownHours = 96;

      if (effectiveRemainingDays <= 2 || (remainingKm !== null && remainingKm <= 100)) {
        level = 3;
        cooldownHours = 24; // Tous les jours jusqu'à validation "Fait" !
      } else if (effectiveRemainingDays <= 7 || (remainingKm !== null && remainingKm <= 250)) {
        level = 2;
        cooldownHours = 48; // Tous les 2 jours
      } else {
        level = 1;
        cooldownHours = 96; // Tous les 4 jours
      }

      const itemHist = history.items[itemId] || { lastSent: 0, level: 0 };
      const hoursSinceLast = (now - itemHist.lastSent) / (1000 * 60 * 60);

      // Si le niveau d'urgence a augmenté (ex: passage à niveau 3), on alerte sans attendre
      const urgencyIncreased = level > itemHist.level;

      if (hoursSinceLast >= cooldownHours || urgencyIncreased) {
        let msg = '';
        const kmInfo = remainingKm !== null
          ? (remainingKm <= 0 ? `⚠️ Dépassé de ${Math.abs(remainingKm)} km` : `reste ${remainingKm.toLocaleString('fr-FR')} km`)
          : '';

        if (level === 3) {
          // Niveau 3 : Urgent / Quotidien
          const isOverdue = effectiveRemainingDays <= 0 || (remainingKm !== null && remainingKm <= 0);
          msg = `🚨 *ALERTE ENTRETIEN URGENT - Carnet d'Entretien*\n\n` +
            `Véhicule : *${veh.name || 'Votre véhicule'}*\n` +
            `Intervention : 🔧 *${item.name}*\n` +
            `Statut : *${isOverdue ? '⚠️ ÉCHÉANCE DÉPASSÉE' : `DANS ${effectiveRemainingDays} JOUR(S) SEULEMENT`}* ${kmInfo ? `(${kmInfo})` : ''}\n\n` +
            `🔔 _Ce rappel restera actif et envoyé chaque jour jusqu'à ce que l'intervention soit réalisée._\n\n` +
            `➡️ Une fois l'opération effectuée, rendez-vous dans l'application et cliquez sur *"Fait"* pour clore ce rappel.`;
        } else if (level === 2) {
          // Niveau 2 : Très proche (tous les 2 jours)
          msg = `⚠️ *ENTRETIEN IMMINENT - Carnet d'Entretien*\n\n` +
            `Véhicule : *${veh.name || 'Votre véhicule'}*\n` +
            `Intervention : 🔧 *${item.name}*\n` +
            `Échéance prévue : dans environ *${effectiveRemainingDays} jours* ${kmInfo ? `(${kmInfo})` : ''}.\n\n` +
            `Pensez à planifier votre intervention ou votre rendez-vous garage.`;
        } else {
          // Niveau 1 : Approche (tous les 4 jours)
          msg = `ℹ️ *ENTRETIEN À PRÉVOIR - Carnet d'Entretien*\n\n` +
            `Véhicule : *${veh.name || 'Votre véhicule'}*\n` +
            `Intervention : 🔧 *${item.name}*\n` +
            `Échéance estimée : dans *${effectiveRemainingDays} jours* ${kmInfo ? `(${kmInfo})` : ''}.\n\n` +
            `Rappel automatique programmé.`;
        }

        const sent = await sendWhatsAppMessage(jid, msg);
        if (sent) {
          history.items[itemId] = { lastSent: now, level };
          saveNotificationHistory(history);
        }
      }
    }
  }

  console.log(`✅ [${new Date().toLocaleString('fr-FR')}] Vérification terminée avec succès.\n`);
}

// ============================================================================
// 3. GESTION DES COMMANDES WHATSAPP ENTRANTES
// ============================================================================

async function handleIncomingMessage(msg) {
  if (!msg.message || msg.key.fromMe) return;

  const sender = msg.key.remoteJid;
  const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();

  if (!text.startsWith('!')) return;

  console.log(`[WhatsApp] Commande reçue de ${sender}: "${text}"`);
  const parts = text.split(' ');
  const cmd = parts[0].toLowerCase();

  if (cmd === '!aide' || cmd === '!help') {
    const help = `🤖 *Commandes du Bot Carnet d'Entretien* :\n\n` +
      `• *!statut* : Affiche le kilométrage et les prochains entretiens.\n` +
      `• *!verif* : Force une vérification immédiate des alertes.\n` +
      `• *!aide* : Affiche ce menu d'aide.`;
    await sendWhatsAppMessage(sender, help);
    return;
  }

  if (cmd === '!verif') {
    await sendWhatsAppMessage(sender, "⏳ Vérification des échéances en cours...");
    await runReminderChecks();
    await sendWhatsAppMessage(sender, "✅ Vérification effectuée.");
    return;
  }

  if (cmd === '!statut') {
    const data = await getTrackerData();
    if (!data.vehicles || data.vehicles.length === 0) {
      await sendWhatsAppMessage(sender, "Aucun véhicule trouvé sur le carnet d'entretien.");
      return;
    }

    let report = `📋 *État de votre Carnet d'Entretien* :\n\n`;
    for (const v of data.vehicles) {
      report += `🚗 *${v.name || v.brand + ' ' + v.model}* (${v.currentKm?.toLocaleString('fr-FR')} km)\n`;
      const vItems = data.items.filter(i => i.vehicleId === v.id && !i.deleted);
      if (vItems.length > 0) {
        report += `Entretiens enregistrés : ${vItems.length}\n`;
      }
    }
    report += `\nPour voir le détail ou valider un entretien fait, ouvrez votre application Web !`;
    await sendWhatsAppMessage(sender, report);
    return;
  }
}

// ============================================================================
// 4. CONNEXION BAILEYS WHATSAPP MULTI-DEVICE
// ============================================================================

async function startWhatsAppBot() {
  const authPath = path.join(__dirname, 'auth_info_baileys');
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`-----------------------------------------------------`);
  console.log(`  Démarrage du Bot WhatsApp Carnet d'Entretien v1.0   `);
  console.log(`  Version Baileys : ${version.join('.')}             `);
  console.log(`-----------------------------------------------------`);

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: ['Carnet Entretien Auto', 'Desktop', '1.0.0']
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📲 Scannez le QR Code ci-dessous avec WhatsApp sur votre téléphone :');
      console.log('(WhatsApp > Paramètres > Appareils connectés > Connecter un appareil)\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(`Connexion fermée. Reconnexion : ${shouldReconnect}`);
      if (shouldReconnect) {
        startWhatsAppBot();
      } else {
        console.log('Session fermée (déconnexion définitive). Supprimez le dossier auth_info_baileys pour re-scanner.');
      }
    } else if (connection === 'open') {
      console.log('\n✅ Connecté avec succès à WhatsApp ! Le bot est opérationnel.');

      // Exécuter une première vérification après 5 secondes
      setTimeout(() => {
        runReminderChecks();
      }, 5000);

      // Programmer la vérification récurrente (ex: toutes les 12 heures)
      const cronExpr = `0 */${CHECK_HOURS} * * *`;
      console.log(`⏰ Planification des vérifications automatiques (toutes les ${CHECK_HOURS} heures)`);
      cron.schedule(cronExpr, () => {
        runReminderChecks();
      });
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type === 'notify') {
      for (const m of messages) {
        await handleIncomingMessage(m);
      }
    }
  });
}

startWhatsAppBot().catch(err => {
  console.error("Erreur critique au lancement du bot:", err);
});
