// bot.js - Bot WhatsApp Baileys pour Carnet d'Entretien Automobile
//
// Fonctionnalités :
// 1. Rappel de relevé kilométrique tous les 15 jours (si aucun relevé récent).
// 2. Rappel d'entretiens proches avec cadence d'envoi progressive (escalade) :
//    - J-15 à J-8 : rappel tous les 4 jours.
//    - J-7 à J-3  : rappel tous les 2 jours.
//    - J-2 à retard : rappel QUOTIDIEN (chaque jour), répété jusqu'à validation "Fait".
// 3. Commandes interactives WhatsApp (!statut, !aide, !verif, !room <id>, !tel <numero>).
// 4. Double mode de connexion Firestore :
//    - Admin SDK (si serviceAccountKey.json présent)
//    - OU Firebase Auth REST (avec demande d'approbation automatique 'Bot WhatsApp')

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

const CONFIG_FILE = path.join(__dirname, 'config.json');
const HISTORY_FILE = path.join(__dirname, 'notification_history.json');
const SERVICE_ACCOUNT_FILE = path.join(__dirname, 'serviceAccountKey.json');
const BOT_AUTH_CACHE_FILE = path.join(__dirname, 'bot_firebase_auth.json');

// Configuration dynamique
function loadConfig() {
  let cfg = {
    targetPhone: process.env.TARGET_WHATSAPP_PHONE || '',
    roomId: process.env.FIREBASE_ROOM_ID || '',
    projectId: process.env.FIREBASE_PROJECT_ID || 'entretien-auto-tracker',
    apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyA7qjZi_aWunCo15Y96BbvsZfX7n7O8LO8',
    checkHours: parseInt(process.env.CHECK_INTERVAL_HOURS || '12', 10)
  };
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      cfg = { ...cfg, ...saved };
    }
  } catch (e) {
    console.warn("Échec lecture config.json:", e.message);
  }
  return cfg;
}

function saveConfig(updated) {
  try {
    const cur = loadConfig();
    const merged = { ...cur, ...updated };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
    return merged;
  } catch (e) {
    console.warn("Échec écriture config.json:", e.message);
  }
}

function loadNotificationHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    }
  } catch (e) {}
  return { mileage: {}, items: {} };
}

function saveNotificationHistory(hist) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(hist, null, 2), 'utf-8');
  } catch (e) {}
}

let sock = null;
let adminDb = null;

// Initialiser Firebase Admin si la clé de compte de service est présente
async function initFirebaseAdminIfAvailable() {
  if (fs.existsSync(SERVICE_ACCOUNT_FILE)) {
    try {
      const { initializeApp, cert } = await import('firebase-admin/app');
      const { getFirestore } = await import('firebase-admin/firestore');
      const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, 'utf-8'));
      const app = initializeApp({
        credential: cert(serviceAccount)
      });
      adminDb = getFirestore(app);
      console.log("🔑 [Firebase] Mode Administrateur activé via serviceAccountKey.json");
    } catch (err) {
      console.warn("Échec init Firebase Admin:", err.message);
    }
  }
}

// Authentification REST Firebase pour le Bot (si pas de service account)
async function getBotFirebaseAuth() {
  const cfg = loadConfig();
  try {
    if (fs.existsSync(BOT_AUTH_CACHE_FILE)) {
      const cached = JSON.parse(fs.readFileSync(BOT_AUTH_CACHE_FILE, 'utf-8'));
      if (cached.expiresAt && Date.now() < cached.expiresAt) {
        return cached;
      }
    }
  } catch (e) {}

  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${cfg.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true })
  });

  if (!res.ok) {
    throw new Error(`Échec Auth Firebase (${res.status})`);
  }

  const authData = await res.json();
  const tokenObj = {
    idToken: authData.idToken,
    localId: authData.localId,
    refreshToken: authData.refreshToken,
    expiresAt: Date.now() + (parseInt(authData.expiresIn || '3600', 10) - 300) * 1000
  };

  try {
    fs.writeFileSync(BOT_AUTH_CACHE_FILE, JSON.stringify(tokenObj, null, 2), 'utf-8');
  } catch (e) {}

  return tokenObj;
}

// ============================================================================
// 1. RÉCUPÉRATION DES DONNÉES FIRESTORE
// ============================================================================

async function fetchFirestoreCollection(subcollection) {
  const cfg = loadConfig();
  if (!cfg.roomId) {
    console.warn("⚠️ FIREBASE_ROOM_ID non configuré. Tapez !room <id> sur WhatsApp.");
    return [];
  }

  // 1. Si Firebase Admin est connecté, lire directement sans restriction
  if (adminDb) {
    try {
      const snap = await adminDb.collection('rooms').doc(cfg.roomId).collection(subcollection).get();
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
      console.error(`Erreur Firebase Admin sur ${subcollection}:`, e.message);
    }
  }

  // 2. Sinon, utiliser l'API REST avec jeton d'authentification du bot
  try {
    const auth = await getBotFirebaseAuth();
    const url = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/rooms/${cfg.roomId}/${subcollection}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${auth.idToken}` }
    });

    if (res.status === 403) {
      console.warn(`[Firestore] Permission refusée pour le Bot sur ${subcollection}.`);
      // Vérifier si le membre est en attente ou s'il faut créer une demande d'accès
      await ensureBotMemberRequest(cfg.roomId, auth);
      return { status: 403, error: 'permission_denied' };
    }

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

// Crée une demande d'accès "Bot WhatsApp" dans la salle pour que le propriétaire puisse l'approuver
async function ensureBotMemberRequest(roomId, auth) {
  const cfg = loadConfig();
  const docUrl = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/rooms/${roomId}/members/${auth.localId}`;

  // Vérifier si la demande existe déjà
  const getRes = await fetch(docUrl, {
    headers: { 'Authorization': `Bearer ${auth.idToken}` }
  });

  if (getRes.status === 404) {
    console.log(`[Firestore] Création de la demande d'accès pour le Bot dans la salle ${roomId}...`);
    await fetch(docUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${auth.idToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          name: { stringValue: 'Bot WhatsApp (Baileys)' },
          role: { stringValue: 'member' },
          status: { stringValue: 'pending' },
          joinedAt: { timestampValue: new Date().toISOString() },
          lastSeenAt: { timestampValue: new Date().toISOString() }
        }
      })
    });
    console.log(`[Firestore] Demande d'accès envoyée. Le propriétaire doit l'approuver dans l'app Web.`);
  }
}

async function getTrackerData() {
  const vehicles = await fetchFirestoreCollection('vehicles');
  if (vehicles && vehicles.status === 403) {
    return { error: 'permission_denied' };
  }
  const items = await fetchFirestoreCollection('items');
  const kmLogs = await fetchFirestoreCollection('kmLogs');

  return { vehicles: Array.isArray(vehicles) ? vehicles : [], items: Array.isArray(items) ? items : [], kmLogs: Array.isArray(kmLogs) ? kmLogs : [] };
}

// ============================================================================
// 2. GESTION DES IDENTIFIANTS WHATSAPP
// ============================================================================

function formatPhoneJid(phone) {
  let cleaned = phone.replace(/[^0-9]/g, '');
  if (!cleaned.endsWith('@s.whatsapp.net')) {
    cleaned = `${cleaned}@s.whatsapp.net`;
  }
  return cleaned;
}

function getTargetJid() {
  const cfg = loadConfig();
  if (cfg.targetPhone) {
    return formatPhoneJid(cfg.targetPhone);
  }
  if (sock && sock.user && sock.user.id) {
    const selfNumber = sock.user.id.split(':')[0].replace(/[^0-9]/g, '');
    return `${selfNumber}@s.whatsapp.net`;
  }
  return null;
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

// ============================================================================
// 3. LOGIQUE MÉTIER & VÉRIFICATION DES ÉCHÉANCES
// ============================================================================

async function runReminderChecks() {
  console.log(`\n🔍 [${new Date().toLocaleString('fr-FR')}] Vérification des rappels...`);
  const jid = getTargetJid();
  if (!jid) {
    console.warn("⚠️ Numéro de destination introuvable.");
    return;
  }

  const cfg = loadConfig();
  if (!cfg.roomId) {
    console.warn("⚠️ Salle Firestore non définie. Tapez !room <votre_room_id> pour démarrer.");
    return;
  }

  const data = await getTrackerData();
  if (data.error === 'permission_denied') {
    const msg = `🔔 *Demande d'accès envoyée pour votre Bot WhatsApp !*\n\n` +
      `Le bot a demandé l'accès à la salle *${cfg.roomId}*.\n\n` +
      `👉 *Action requise :* Ouvrez votre carnet d'entretien Web. Une bannière orange en haut de l'écran indique :\n` +
      `*« 🔔 1 en attente : Bot WhatsApp (Baileys) »*\n` +
      `Cliquez sur *"Accepter"*, puis renvoyez *!verif* sur WhatsApp !`;
    await sendWhatsAppMessage(jid, msg);
    return;
  }

  const history = loadNotificationHistory();
  const now = Date.now();

  if (!data.vehicles || data.vehicles.length === 0) {
    console.log("ℹ️ Aucun véhicule trouvé pour la salle configurée.");
    return;
  }

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

      if (daysElapsed >= 15) {
        const lastSent = history.mileage[vehId] || 0;
        const hoursSinceLastNotification = (now - lastSent) / (1000 * 60 * 60);

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
        delete history.mileage[vehId];
        saveNotificationHistory(history);
      }
    }

    let dailyRate = 35;
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
      if (item.lastDate === null && item.lastKm === null) continue;

      let remainingKm = null;
      let remainingDaysByKm = null;
      let remainingDaysByDate = null;

      if (item.intervalKm && item.lastKm !== null) {
        const dueKm = item.lastKm + item.intervalKm;
        remainingKm = dueKm - currentKm;
        remainingDaysByKm = Math.round(remainingKm / dailyRate);
      }

      if (item.intervalMonths && item.lastDate) {
        const lastD = new Date(item.lastDate);
        const targetDate = new Date(lastD);
        targetDate.setMonth(targetDate.getMonth() + item.intervalMonths);
        remainingDaysByDate = Math.round((targetDate.getTime() - now) / (1000 * 60 * 60 * 24));
      }

      let effectiveRemainingDays = 999;
      if (remainingDaysByKm !== null && remainingDaysByDate !== null) {
        effectiveRemainingDays = Math.min(remainingDaysByKm, remainingDaysByDate);
      } else if (remainingDaysByKm !== null) {
        effectiveRemainingDays = remainingDaysByKm;
      } else if (remainingDaysByDate !== null) {
        effectiveRemainingDays = remainingDaysByDate;
      }

      if (effectiveRemainingDays > 15 && (remainingKm === null || remainingKm > 500)) {
        if (history.items[itemId]) {
          delete history.items[itemId];
          saveNotificationHistory(history);
        }
        continue;
      }

      let level = 1;
      let cooldownHours = 96;

      if (effectiveRemainingDays <= 2 || (remainingKm !== null && remainingKm <= 100)) {
        level = 3;
        cooldownHours = 24; // Quotidien
      } else if (effectiveRemainingDays <= 7 || (remainingKm !== null && remainingKm <= 250)) {
        level = 2;
        cooldownHours = 48; // Tous les 2 jours
      } else {
        level = 1;
        cooldownHours = 96; // Tous les 4 jours
      }

      const itemHist = history.items[itemId] || { lastSent: 0, level: 0 };
      const hoursSinceLast = (now - itemHist.lastSent) / (1000 * 60 * 60);
      const urgencyIncreased = level > itemHist.level;

      if (hoursSinceLast >= cooldownHours || urgencyIncreased) {
        let msg = '';
        const kmInfo = remainingKm !== null
          ? (remainingKm <= 0 ? `⚠️ Dépassé de ${Math.abs(remainingKm)} km` : `reste ${remainingKm.toLocaleString('fr-FR')} km`)
          : '';

        if (level === 3) {
          const isOverdue = effectiveRemainingDays <= 0 || (remainingKm !== null && remainingKm <= 0);
          msg = `🚨 *ALERTE ENTRETIEN URGENT - Carnet d'Entretien*\n\n` +
            `Véhicule : *${veh.name || 'Votre véhicule'}*\n` +
            `Intervention : 🔧 *${item.name}*\n` +
            `Statut : *${isOverdue ? '⚠️ ÉCHÉANCE DÉPASSÉE' : `DANS ${effectiveRemainingDays} JOUR(S) SEULEMENT`}* ${kmInfo ? `(${kmInfo})` : ''}\n\n` +
            `🔔 _Ce rappel restera actif et envoyé chaque jour jusqu'à ce que l'intervention soit réalisée._\n\n` +
            `➡️ Une fois l'opération effectuée, rendez-vous dans l'application et cliquez sur *"Fait"* pour clore ce rappel.`;
        } else if (level === 2) {
          msg = `⚠️ *ENTRETIEN IMMINENT - Carnet d'Entretien*\n\n` +
            `Véhicule : *${veh.name || 'Votre véhicule'}*\n` +
            `Intervention : 🔧 *${item.name}*\n` +
            `Échéance prévue : dans environ *${effectiveRemainingDays} jours* ${kmInfo ? `(${kmInfo})` : ''}.\n\n` +
            `Pensez à planifier votre intervention ou votre rendez-vous garage.`;
        } else {
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
// 4. GESTION DES COMMANDES WHATSAPP ENTRANTES
// ============================================================================

async function handleIncomingMessage(msg) {
  if (!msg.message) return;

  const rawText = (
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    ''
  ).trim();

  if (!rawText) return;

  const sender = msg.key.remoteJid;
  console.log(`[WhatsApp] Message reçu de ${sender} (fromMe: ${msg.key.fromMe}): "${rawText}"`);

  const parts = rawText.split(' ');
  const cmd = parts[0].toLowerCase();

  // Détection souple : soit !room <id>, soit room_xxxx, soit chaîne longue sans espace
  let candidateRoom = null;
  if (cmd === '!room' && parts[1]) {
    candidateRoom = parts[1].trim();
  } else if (rawText.startsWith('room_') || (rawText.includes('_') && rawText.length >= 10 && !rawText.includes(' '))) {
    candidateRoom = rawText.trim();
  }

  if (candidateRoom) {
    saveConfig({ roomId: candidateRoom });
    await sendWhatsAppMessage(sender, `✅ Salle enregistrée : *${candidateRoom}*\n🔍 Recherche des véhicules en cours...`);
    await runReminderChecks();
    return;
  }

  if (cmd === '!aide' || cmd === '!help') {
    const help = `🤖 *Commandes du Bot Carnet d'Entretien* :\n\n` +
      `• *!statut* : Affiche vos véhicules et l'état de synchronisation.\n` +
      `• *!room <id>* : Définit la salle à surveiller.\n` +
      `• *!tel <numero>* : Définit le numéro qui reçoit les alertes.\n` +
      `• *!verif* : Déclenche immédiatement une vérification des rappels.\n` +
      `• *!aide* : Affiche ce menu d'aide.`;
    await sendWhatsAppMessage(sender, help);
    return;
  }

  if (cmd === '!tel') {
    const newPhone = parts[1]?.trim();
    if (!newPhone) {
      await sendWhatsAppMessage(sender, "⚠️ Format incorrect. Tapez : *!tel <votre_numero>* (ex: 213555123456)");
      return;
    }
    saveConfig({ targetPhone: newPhone });
    await sendWhatsAppMessage(sender, `✅ Numéro de destination configuré : *+${newPhone}*`);
    return;
  }

  if (cmd === '!verif') {
    await sendWhatsAppMessage(sender, "⏳ Vérification manuelle des échéances en cours...");
    await runReminderChecks();
    await sendWhatsAppMessage(sender, "✅ Vérification effectuée.");
    return;
  }

  if (cmd === '!statut') {
    const cfg = loadConfig();
    if (!cfg.roomId) {
      await sendWhatsAppMessage(sender, `⚠️ Aucune salle configurée.\nEnvoyez *!room <id_salle>* pour synchroniser vos véhicules.`);
      return;
    }

    const data = await getTrackerData();
    if (data.error === 'permission_denied') {
      await sendWhatsAppMessage(sender, `⏳ Demande d'accès en attente d'approbation sur l'application Web pour la salle *${cfg.roomId}*.`);
      return;
    }

    if (!data.vehicles || data.vehicles.length === 0) {
      await sendWhatsAppMessage(sender, `ℹ️ Connecté à la salle *${cfg.roomId}*, mais aucun véhicule n'a été trouvé.`);
      return;
    }

    let report = `📋 *État de votre Carnet d'Entretien* :\n\n`;
    for (const v of data.vehicles) {
      report += `🚗 *${v.name || v.brand + ' ' + v.model}* (${v.currentKm?.toLocaleString('fr-FR')} km)\n`;
      const vItems = data.items.filter(i => i.vehicleId === v.id && !i.deleted);
      if (vItems.length > 0) {
        report += `• Entretiens surveillés : ${vItems.length}\n`;
      }
    }
    report += `\nPour marquer un entretien comme "Fait", ouvrez votre carnet d'entretien Web !`;
    await sendWhatsAppMessage(sender, report);
    return;
  }

  // Réponse automatique amicale si commande inconnue
  if (rawText.startsWith('!')) {
    await sendWhatsAppMessage(sender, `🤖 Commande inconnue. Tapez *!aide* pour voir les commandes disponibles.`);
  }
}

// ============================================================================
// 5. CONNEXION BAILEYS WHATSAPP MULTI-DEVICE
// ============================================================================

async function startWhatsAppBot() {
  await initFirebaseAdminIfAvailable();

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

      const cfg = loadConfig();
      const targetJid = getTargetJid();
      if (targetJid) {
        console.log(`[WhatsApp] Destinataire des alertes configuré : ${targetJid}`);
      }

      // Première vérification après 3 secondes si une salle est déjà configurée
      if (cfg.roomId) {
        setTimeout(() => {
          runReminderChecks();
        }, 3000);
      }

      // Programmer la vérification récurrente (toutes les X heures)
      const cronExpr = `0 */${cfg.checkHours} * * *`;
      console.log(`⏰ Planification des vérifications automatiques (toutes les ${cfg.checkHours} heures)`);
      cron.schedule(cronExpr, () => {
        runReminderChecks();
      });
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Écoute de tous les messages entrants (y compris messages à soi-même)
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) {
      await handleIncomingMessage(m);
    }
  });
}

startWhatsAppBot().catch(err => {
  console.error("Erreur critique au lancement du bot:", err);
});
