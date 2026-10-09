// bot.js - Bot WhatsApp Baileys pour Carnet d'Entretien Automobile
//
// Fonctionnalités :
// 1. Rappel de relevé kilométrique tous les 15 jours (si aucun relevé récent).
// 2. Rappel d'entretiens proches avec cadence d'envoi progressive (escalade) :
//    - J-15 à J-8 : rappel tous les 4 jours.
//    - J-7 à J-3  : rappel tous les 2 jours.
//    - J-2 à retard : rappel QUOTIDIEN (chaque jour), répété jusqu'à validation "Fait".
// 3. Diffusion multi-utilisateurs à TOUS les membres / destinataires enregistrés.
// 4. Commandes interactives WhatsApp (!test, !ajouter, !destinataires, !retirer, !rejoindre, !broadcast, !statut, !aide, !verif, !room <id>).
// 5. Double mode de connexion Firestore :
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
const BOT_LOG_FILE = path.join(__dirname, 'bot.log');

// Module optionnel d'alertes par e-mail et calcul prédictif intelligent
let runEmailReminders = null;
let calculateIntelligentDailyRate = null;
try {
  const mailMod = await import('../scripts/send-email-reminders.mjs');
  runEmailReminders = mailMod.runEmailReminders;
  calculateIntelligentDailyRate = mailMod.calculateIntelligentDailyRate;
} catch (e) {}

// ============================================================================
// CONFIGURATION DYNAMIQUE
// ============================================================================

function loadConfig() {
  let cfg = {
    targetPhone: process.env.TARGET_WHATSAPP_PHONE || '',
    targetPhones: [],
    subscribers: [],
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

  // Si des numéros multiples sont spécifiés dans .env sous TARGET_WHATSAPP_PHONES
  if (process.env.TARGET_WHATSAPP_PHONES) {
    const fromEnv = process.env.TARGET_WHATSAPP_PHONES.split(',').map(s => s.trim()).filter(Boolean);
    cfg.targetPhones = Array.from(new Set([...(cfg.targetPhones || []), ...fromEnv]));
  }

  if (!Array.isArray(cfg.targetPhones)) cfg.targetPhones = [];
  if (!Array.isArray(cfg.subscribers)) cfg.subscribers = [];
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
const sentMessageIds = new Set();

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
  let cached = null;
  try {
    if (fs.existsSync(BOT_AUTH_CACHE_FILE)) {
      cached = JSON.parse(fs.readFileSync(BOT_AUTH_CACHE_FILE, 'utf-8'));
      if (cached.expiresAt && Date.now() < cached.expiresAt && cached.idToken) {
        return cached;
      }
    }
  } catch (e) {}

  // Si un refreshToken est présent, renouveler la session de la même identité UID
  if (cached && cached.refreshToken) {
    try {
      const refreshUrl = `https://securetoken.googleapis.com/v1/token?key=${cfg.apiKey}`;
      const refreshRes = await fetch(refreshUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${cached.refreshToken}`
      });
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        const updated = {
          idToken: refreshData.id_token,
          localId: refreshData.user_id || cached.localId,
          refreshToken: refreshData.refresh_token || cached.refreshToken,
          expiresAt: Date.now() + (parseInt(refreshData.expires_in || '3600', 10) - 300) * 1000
        };
        try {
          fs.writeFileSync(BOT_AUTH_CACHE_FILE, JSON.stringify(updated, null, 2), 'utf-8');
        } catch (e) {}
        return updated;
      }
    } catch (err) {
      console.warn("Échec rafraîchissement jeton bot:", err.message);
    }
  }

  // Sinon, générer un nouvel utilisateur anonyme
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
  const members = await fetchFirestoreCollection('members');

  return {
    vehicles: Array.isArray(vehicles) ? vehicles : [],
    items: Array.isArray(items) ? items : [],
    kmLogs: Array.isArray(kmLogs) ? kmLogs : [],
    members: Array.isArray(members) ? members : []
  };
}

// ============================================================================
// 2. GESTION DES DESTINATAIRES & DIFFUSION MULTI-UTILISATEURS
// ============================================================================

function formatPhoneJid(phone) {
  if (!phone) return null;
  let cleaned = String(phone).replace(/[^0-9]/g, '');
  if (!cleaned) return null;
  if (!cleaned.endsWith('@s.whatsapp.net')) {
    cleaned = `${cleaned}@s.whatsapp.net`;
  }
  return cleaned;
}

function getSelfJid() {
  if (sock && sock.user && sock.user.id) {
    const selfNumber = sock.user.id.split(':')[0].replace(/[^0-9]/g, '');
    if (selfNumber) return `${selfNumber}@s.whatsapp.net`;
  }
  return null;
}

/**
 * Retourne la liste unique de TOUS les destinataires (hôte WhatsApp, membres Firestore avec numéro, numéros configurés, abonnés)
 */
function getAllTargetJids(firestoreMembers = []) {
  const cfg = loadConfig();
  const jids = new Set();

  // 1. Le téléphone hôte qui fait tourner le bot
  const self = getSelfJid();
  if (self) jids.add(self);

  // 2. Membres enregistrés dans Firestore ayant renseigné leur numéro WhatsApp dans l'app
  if (Array.isArray(firestoreMembers)) {
    for (const m of firestoreMembers) {
      if (m.phone && (m.status === 'approved' || m.role === 'owner')) {
        const j = formatPhoneJid(m.phone);
        if (j) jids.add(j);
      }
    }
  }

  // 3. Numéro unique configuré (s'il y en a un)
  if (cfg.targetPhone) {
    const j = formatPhoneJid(cfg.targetPhone);
    if (j) jids.add(j);
  }

  // 4. Liste de tous les numéros supplémentaires (famille, conducteurs)
  if (Array.isArray(cfg.targetPhones)) {
    for (const p of cfg.targetPhones) {
      const j = formatPhoneJid(p);
      if (j) jids.add(j);
    }
  }

  // 5. Liste des utilisateurs abonnés (!rejoindre)
  if (Array.isArray(cfg.subscribers)) {
    for (const s of cfg.subscribers) {
      const j = formatPhoneJid(s);
      if (j) jids.add(j);
    }
  }

  return Array.from(jids);
}

async function sendWhatsAppMessage(jid, text) {
  if (!sock) {
    console.warn("Bot non connecté, impossible d'envoyer le message.");
    return false;
  }
  try {
    const res = await sock.sendMessage(jid, { text });
    if (res && res.key && res.key.id) {
      sentMessageIds.add(res.key.id);
      if (sentMessageIds.size > 500) {
        const first = sentMessageIds.values().next().value;
        sentMessageIds.delete(first);
      }
    }
    console.log(`[WhatsApp] Message envoyé avec succès à ${jid}`);
    return true;
  } catch (err) {
    console.error(`[WhatsApp] Échec d'envoi à ${jid}:`, err.message);
    return false;
  }
}

/**
 * Diffuse un message à TOUS les utilisateurs enregistrés avec temporisation anti-spam
 */
async function broadcastMessage(text, excludeJid = null, firestoreMembers = []) {
  const targets = getAllTargetJids(firestoreMembers).filter(j => j !== excludeJid);
  if (targets.length === 0) {
    console.warn("⚠️ Aucun destinataire disponible pour la diffusion.");
    return { total: 0, sent: 0, failed: 0, recipients: [] };
  }

  console.log(`📢 [Diffusion] Envoi à ${targets.length} destinataire(s)...`);
  let sentCount = 0;
  let failedCount = 0;
  const sentRecipients = [];

  for (const jid of targets) {
    const ok = await sendWhatsAppMessage(jid, text);
    if (ok) {
      sentCount++;
      sentRecipients.push(jid.replace('@s.whatsapp.net', ''));
    } else {
      failedCount++;
    }
    // Petit délai de 350ms pour respecter les limites WhatsApp
    await new Promise(r => setTimeout(r, 350));
  }

  return {
    total: targets.length,
    sent: sentCount,
    failed: failedCount,
    recipients: sentRecipients
  };
}

// ============================================================================
// 3. LOGIQUE MÉTIER & VÉRIFICATION DES ÉCHÉANCES (DIFFUSION MULTI-UTILISATEURS)
// ============================================================================

async function runReminderChecks() {
  console.log(`\n🔍 [${new Date().toLocaleString('fr-FR')}] Vérification des rappels...`);
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
    await broadcastMessage(msg);
    return;
  }

  const allTargets = getAllTargetJids(data.members || []);
  if (allTargets.length === 0) {
    console.warn("⚠️ Aucun numéro de destination configuré (ni dans le bot, ni dans les membres de la salle).");
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

          const res = await broadcastMessage(msg, null, data.members || []);
          if (res.sent > 0) {
            history.mileage[vehId] = now;
            saveNotificationHistory(history);
          }
        }
      } else {
        delete history.mileage[vehId];
        saveNotificationHistory(history);
      }
    }

    const vehItems = data.items.filter(i => i.vehicleId === vehId && !i.deleted);
    let dailyRate = 49.3; // Baseline prior ~1 500 km/mois
    if (typeof calculateIntelligentDailyRate === 'function') {
      const rateInfo = calculateIntelligentDailyRate(veh, vehLogs, vehItems, data.history || []);
      dailyRate = rateInfo.dailyRate;
    } else if (vehLogs.length >= 2) {
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

        const res = await broadcastMessage(msg, null, data.members || []);
        if (res.sent > 0) {
          history.items[itemId] = { lastSent: now, level };
          saveNotificationHistory(history);
        }
      }
    }
  }

  // Déclencher également la vérification et l'envoi des alertes par e-mail
  if (runEmailReminders) {
    try {
      await runEmailReminders();
    } catch (e) {}
  }

  console.log(`✅ [${new Date().toLocaleString('fr-FR')}] Vérification terminée avec succès.\n`);
}

// ============================================================================
// 4. PARSER DE ROOM ID
// ============================================================================

function extractRoomId(text) {
  if (!text) return null;
  const clean = text.trim();

  // 1. URL d'invitation complète (ex: https://...#join=room_123456_token ou #join=...)
  const urlMatch = clean.match(/#join=([a-zA-Z0-9_-]+)/i);
  if (urlMatch) {
    const raw = urlMatch[1];
    const parts = raw.split('_');
    if (parts.length >= 3 && parts[0] === 'room') return `${parts[0]}_${parts[1]}`;
    return parts[0];
  }

  // 2. Commande !room ou !salle ou !id (ex: !room room_123 ou !room: room_123)
  const cmdMatch = clean.match(/^!(?:room|salle|id)\s*[:=]?\s*(\S+)/i);
  if (cmdMatch) {
    let raw = cmdMatch[1].trim();
    if (raw.includes('#join=')) return extractRoomId(raw);
    const parts = raw.split('_');
    if (parts.length >= 3 && parts[0] === 'room') return `${parts[0]}_${parts[1]}`;
    return raw;
  }

  // 3. ID direct commençant par room_ (ex: room_1728481234)
  const directMatch = clean.match(/\b(room_[a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)?)\b/i);
  if (directMatch) {
    const raw = directMatch[1];
    const parts = raw.split('_');
    if (parts.length >= 3 && parts[0] === 'room') return `${parts[0]}_${parts[1]}`;
    return raw;
  }

  return null;
}

// ============================================================================
// 5. GESTION DES COMMANDES WHATSAPP ENTRANTES
// ============================================================================

async function handleIncomingMessage(msg) {
  if (!msg.message) return;
  if (msg.key && sentMessageIds.has(msg.key.id)) return;

  const rawText = (
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    ''
  ).trim();

  if (!rawText) return;

  const sender = msg.key.remoteJid;
  console.log(`[WhatsApp] Message reçu de ${sender} (fromMe: ${msg.key.fromMe}): "${rawText}"`);

  // Enregistrer dans le journal bot.log
  try {
    fs.appendFileSync(BOT_LOG_FILE, `[${new Date().toISOString()}] from: ${sender} (fromMe: ${msg.key.fromMe}) text: "${rawText}"\n`);
  } catch (e) {}

  // 1. Vérification si le message contient ou définit un ID de salle
  const candidateRoom = extractRoomId(rawText);
  if (candidateRoom) {
    saveConfig({ roomId: candidateRoom });
    await sendWhatsAppMessage(sender, `✅ Salle enregistrée : *${candidateRoom}*\n🔍 Recherche des véhicules et entretiens en cours...`);
    await runReminderChecks();
    return;
  }

  // Si l'utilisateur tape !room tout seul sans argument
  if (/^!(?:room|salle|id)\b/i.test(rawText)) {
    await sendWhatsAppMessage(sender, `⚠️ Vous n'avez pas spécifié l'ID de votre salle.\n\n👉 *Exemples d'utilisation :*\n• *!room room_1728481234*\n• Ou collez directement votre lien d'invitation complet ici !`);
    return;
  }

  // Les commandes doivent commencer par '!'
  if (!rawText.startsWith('!')) return;

  const parts = rawText.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  // --------------------------------------------------------------------------
  // COMMANDE 1 : !aide / !help
  // --------------------------------------------------------------------------
  if (cmd === '!aide' || cmd === '!help') {
    const help =
      `🤖 *Commandes du Bot Carnet d'Entretien* :\n\n` +
      `• *!test* : Teste l'envoi d'une alerte WhatsApp à TOUS les utilisateurs.\n` +
      `• *!email* : Teste l'envoi d'un e-mail d'alerte Gmail à tous les membres.\n` +
      `• *!destinataires* : Affiche tous les numéros et e-mails enregistrés.\n` +
      `• *!ajouter <tel>* : Ajoute un proche aux alertes (ex: !ajouter 213555123456).\n` +
      `• *!retirer <tel>* : Supprime un numéro de la liste.\n` +
      `• *!statut* : Affiche vos véhicules et l'état de synchronisation.\n` +
      `• *!verif* : Vérifie immédiatement les entretiens et lance les alertes.\n` +
      `• *!broadcast <texte>* : Envoie un message personnalisé à tous les membres.\n` +
      `• *!rejoindre* : S'inscrire soi-même aux alertes depuis son WhatsApp.\n` +
      `• *!room <id>* : Associe une nouvelle salle Firestore.\n` +
      `• *!aide* : Affiche ce menu d'aide.`;
    await sendWhatsAppMessage(sender, help);
    return;
  }

  // --------------------------------------------------------------------------
  // COMMANDE : !email / !testemail (TEST ENVOI GMAIL)
  // --------------------------------------------------------------------------
  if (cmd === '!email' || cmd === '!testemail') {
    if (!runEmailReminders) {
      await sendWhatsAppMessage(sender, "⚠️ Le module d'envoi d'e-mails n'est pas chargé sur le bot.");
      return;
    }
    await sendWhatsAppMessage(sender, "⏳ Envoi d'un e-mail de test via Gmail à tous les membres...");
    try {
      const res = await runEmailReminders({ isTest: true });
      if (res.success) {
        await sendWhatsAppMessage(sender, `✅ *E-mail de test envoyé avec succès !*\n\n📬 Destinataire(s) notifié(s) :\n${res.recipients.map(e => `• ${e}`).join('\n')}`);
      } else {
        await sendWhatsAppMessage(sender, `⚠️ Impossible d'envoyer l'e-mail : ${res.error || 'Erreur inconnue'}.\n\n👉 Vérifiez que GMAIL_USER et GMAIL_APP_PASSWORD sont renseignés dans scripts/email-config.json.`);
      }
    } catch (err) {
      await sendWhatsAppMessage(sender, `❌ Erreur lors de l'envoi de l'e-mail : ${err.message}`);
    }
    return;
  }

  // --------------------------------------------------------------------------
  // COMMANDE 2 : !test / !testall (TEST MULTI-UTILISATEURS)
  // --------------------------------------------------------------------------
  if (cmd === '!test' || cmd === '!testall' || cmd === '!tester' || cmd === '!testnotif') {
    const cfg = loadConfig();
    const data = await getTrackerData();
    const members = (data && Array.isArray(data.members)) ? data.members : [];
    const allTargets = getAllTargetJids(members);

    const senderJid = formatPhoneJid(sender);
    if (senderJid && !allTargets.includes(senderJid)) {
      allTargets.push(senderJid);
    }

    const veh = (data.vehicles && data.vehicles.length > 0) ? data.vehicles[0] : null;
    const currentKm = veh ? (veh.currentKm || 0) : 250000;
    const vehName = veh ? (veh.name || `${veh.brand || ''} ${veh.model || ''}`.trim()) : "Renault Symbol";

    const items = data.items || [];
    const vidange = items.find(i => i.name && i.name.toLowerCase().includes('vidange')) || items[0];
    const itemName = vidange ? vidange.name : "Vidange (moteur)";
    const itemDueKm = (vidange && vidange.intervalKm && vidange.lastKm)
      ? (vidange.lastKm + vidange.intervalKm)
      : (currentKm + 1000);
    const remainingKm = Math.max(0, itemDueKm - currentKm);

    const testBroadcastMsg =
      `🚗 *TEST DU BOT WHATSAPP - Carnet d'Entretien Automobile*\n\n` +
      `✅ *Le système d'alerte fonctionne parfaitement !*\n\n` +
      `📊 *Données synchronisées en direct :*\n` +
      `• Salle : *${cfg.roomId || 'roommv13dgxrc6c448ac3b69'}*\n` +
      `• Véhicule : *${vehName}*\n` +
      `• Kilométrage actuel : *${currentKm.toLocaleString('fr-FR')} km*\n` +
      `• Entretien suivi : 🔧 *${itemName}* (échéance : ${itemDueKm.toLocaleString('fr-FR')} km, reste *${remainingKm.toLocaleString('fr-FR')} km*)\n` +
      `• Statut du bot : 🟢 Membre approuvé & actif\n\n` +
      `👥 *Diffusion multi-utilisateurs :*\n` +
      `Ce message de test est envoyé simultanément à l'ensemble des ${allTargets.length} destinataire(s) enregistré(s).\n\n` +
      `🔔 *Rappels automatiques programmés :*\n` +
      `1️⃣ Relevé kilométrique : tous les 15 jours.\n` +
      `2️⃣ Échéance proche : relance progressive (tous les 4 jours, 2 jours, puis quotidienne jusqu'à validation "Fait" dans l'application) !\n\n` +
      `_Envoyé le ${new Date().toLocaleString('fr-FR')}_`;

    await sendWhatsAppMessage(sender, `⏳ Envoi du test de diffusion à *${allTargets.length}* destinataire(s)...`);
    const res = await broadcastMessage(testBroadcastMsg, null, members);

    const recipientListStr = allTargets.map(j => {
      const cleanNum = j.replace('@s.whatsapp.net', '');
      const appMember = members.find(m => formatPhoneJid(m.phone) === j);
      const label = appMember ? ` (${appMember.name})` : '';
      return `• +${cleanNum}${label}`;
    }).join('\n');

    await sendWhatsAppMessage(sender,
      `✅ *Test terminé !*\n\n` +
      `📊 *Résultat :* ${res.sent}/${res.total} message(s) délivré(s) avec succès.\n\n` +
      `📱 *Destinataires notifiés :*\n${recipientListStr}\n\n` +
      `💡 Les numéros sont modifiables directement dans l'application Web (Paramètres > Partage).\n` +
      `💡 Pour ajouter un numéro via WhatsApp : *!ajouter <numéro>*\n` +
      `💡 Pour voir la liste complète : *!destinataires*`
    );
    return;
  }

  // --------------------------------------------------------------------------
  // COMMANDE 3 : !ajouter <tel> / !add <tel>
  // --------------------------------------------------------------------------
  if (cmd === '!ajouter' || cmd === '!add') {
    const rawNumber = parts.slice(1).join('').replace(/[^0-9]/g, '');
    if (!rawNumber || rawNumber.length < 8) {
      await sendWhatsAppMessage(sender, "⚠️ Format incorrect. Tapez : *!ajouter <numéro_avec_indicatif>*\n\n👉 Exemple : *!ajouter 213555123456*");
      return;
    }
    const cfg = loadConfig();
    const existing = new Set(cfg.targetPhones || []);
    existing.add(rawNumber);
    cfg.targetPhones = Array.from(existing);
    saveConfig(cfg);

    const newJid = formatPhoneJid(rawNumber);
    await sendWhatsAppMessage(newJid,
      `👋 *Bonjour !*\n\n` +
      `Votre numéro a été ajouté aux alertes WhatsApp du *Carnet d'Entretien Automobile* 🚗.\n\n` +
      `Vous recevrez désormais :\n` +
      `• 📅 Le rappel de mise à jour du compteur tous les 15 jours\n` +
      `• 🔧 Les alertes lorsqu'un entretien approche\n\n` +
      `Tapez *!aide* pour découvrir les commandes disponibles.`
    );

    const total = getAllTargetJids().length;
    await sendWhatsAppMessage(sender, `✅ Numéro *+${rawNumber}* ajouté avec succès aux alertes !\n👥 Total destinataires actifs : *${total}*.\nUn message de bienvenue lui a été envoyé.`);
    return;
  }

  // --------------------------------------------------------------------------
  // COMMANDE 4 : !retirer <tel> / !supprimer <tel> / !del <tel>
  // --------------------------------------------------------------------------
  if (cmd === '!retirer' || cmd === '!supprimer' || cmd === '!del') {
    const rawNumber = parts.slice(1).join('').replace(/[^0-9]/g, '');
    if (!rawNumber) {
      await sendWhatsAppMessage(sender, "⚠️ Précisez le numéro à retirer. Exemple : *!retirer 213555123456*");
      return;
    }
    const cfg = loadConfig();
    cfg.targetPhones = (cfg.targetPhones || []).filter(p => p.replace(/[^0-9]/g, '') !== rawNumber);
    cfg.subscribers = (cfg.subscribers || []).filter(s => s.replace(/[^0-9]/g, '') !== rawNumber);
    if (cfg.targetPhone && cfg.targetPhone.replace(/[^0-9]/g, '') === rawNumber) {
      cfg.targetPhone = '';
    }
    saveConfig(cfg);
    await sendWhatsAppMessage(sender, `✅ Numéro *+${rawNumber}* retiré des alertes.`);
    return;
  }

  // --------------------------------------------------------------------------
  // COMMANDE 5 : !destinataires / !users / !membres / !liste
  // --------------------------------------------------------------------------
  if (cmd === '!destinataires' || cmd === '!users' || cmd === '!membres' || cmd === '!liste') {
    const data = await getTrackerData();
    const members = (data && Array.isArray(data.members)) ? data.members : [];
    const targets = getAllTargetJids(members);
    const self = getSelfJid();

    let text = `👥 *Destinataires des alertes WhatsApp* (${targets.length}) :\n\n`;
    targets.forEach((j, idx) => {
      const num = j.replace('@s.whatsapp.net', '');
      const isSelf = j === self ? ' 🤖 (Bot WhatsApp)' : '';
      const appMember = members.find(m => formatPhoneJid(m.phone) === j);
      let memberLabel = '';
      if (appMember) {
        const emailTag = appMember.email ? ` | 📧 ${appMember.email}` : '';
        memberLabel = ` 👤 (${appMember.name}${appMember.role === 'owner' ? ' - Gestionnaire' : ''}${emailTag})`;
      }
      text += `${idx + 1}. *+${num}*${isSelf || memberLabel}\n`;
    });

    const emailMembers = members.filter(m => m.email && (m.status === 'approved' || m.role === 'owner'));
    if (emailMembers.length > 0) {
      text += `\n📧 *Destinataires des alertes par E-mail* (${emailMembers.length}) :\n`;
      emailMembers.forEach((m, idx) => {
        text += `• ${m.email} (${m.name})\n`;
      });
    }

    text += `\n👉 *Depuis l'application Web* : chaque membre peut modifier son nom, numéro WhatsApp et e-mail dans les Paramètres.\n` +
            `👉 L'administrateur peut modifier le profil de tous les membres directement depuis l'application Web.\n` +
            `👉 Tapez *!test* pour tester WhatsApp ou *!email* pour tester l'envoi Gmail !`;
    await sendWhatsAppMessage(sender, text);
    return;
  }

  // --------------------------------------------------------------------------
  // COMMANDE 6 : !rejoindre / !start / !sub / !moi
  // --------------------------------------------------------------------------
  if (cmd === '!rejoindre' || cmd === '!start' || cmd === '!sub' || cmd === '!moi') {
    const cfg = loadConfig();
    const senderClean = sender.replace(/[^0-9]/g, '');
    const currentSubs = new Set(cfg.subscribers || []);
    currentSubs.add(senderClean);
    cfg.subscribers = Array.from(currentSubs);
    saveConfig(cfg);

    await sendWhatsAppMessage(sender,
      `🎉 *Bienvenue dans les alertes du Carnet d'Entretien !*\n\n` +
      `Votre numéro (*+${senderClean}*) est maintenant inscrit.\n` +
      `Vous recevrez toutes les alertes d'entretien et les rappels kilométriques tous les 15 jours pour vos véhicules partagés.\n\n` +
      `💡 Tapez *!test* pour tester la réception ou *!statut* pour voir vos véhicules.`
    );
    return;
  }

  // --------------------------------------------------------------------------
  // COMMANDE 7 : !broadcast <texte> / !diffuser <texte>
  // --------------------------------------------------------------------------
  if (cmd === '!broadcast' || cmd === '!diffuser') {
    const bcastText = parts.slice(1).join(' ').trim();
    if (!bcastText) {
      await sendWhatsAppMessage(sender, "⚠️ Veuillez écrire le message à diffuser. Exemple : *!broadcast Pensez à relever les compteurs ce soir !*");
      return;
    }
    const data = await getTrackerData();
    const members = (data && Array.isArray(data.members)) ? data.members : [];
    const fullMsg = `📢 *MESSAGE DU CARNET D'ENTRETIEN*\n\n${bcastText}\n\n_Envoyé à tous les membres_`;
    const res = await broadcastMessage(fullMsg, null, members);
    await sendWhatsAppMessage(sender, `✅ Message diffusé à *${res.sent}/${res.total}* utilisateur(s).`);
    return;
  }

  // --------------------------------------------------------------------------
  // COMMANDE 8 : !tel <numero>
  // --------------------------------------------------------------------------
  if (cmd === '!tel') {
    const newPhone = parts[1]?.trim();
    if (!newPhone) {
      await sendWhatsAppMessage(sender, "⚠️ Format incorrect. Tapez : *!tel <votre_numero>* (ex: 213555123456)");
      return;
    }
    saveConfig({ targetPhone: newPhone });
    await sendWhatsAppMessage(sender, `✅ Numéro principal configuré : *+${newPhone}*`);
    return;
  }

  // --------------------------------------------------------------------------
  // COMMANDE 9 : !verif
  // --------------------------------------------------------------------------
  if (cmd === '!verif') {
    await sendWhatsAppMessage(sender, "⏳ Vérification manuelle des échéances en cours pour tous les utilisateurs...");
    await runReminderChecks();
    await sendWhatsAppMessage(sender, "✅ Vérification effectuée.");
    return;
  }

  // --------------------------------------------------------------------------
  // COMMANDE 10 : !statut
  // --------------------------------------------------------------------------
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

    const members = (data && Array.isArray(data.members)) ? data.members : [];
    const targets = getAllTargetJids(members);
    let report = `📋 *État de votre Carnet d'Entretien* :\n\n`;
    report += `• Salle active : *${cfg.roomId}*\n`;
    report += `• Destinataires notifiés : *${targets.length}*\n`;
    if (members.length > 0) {
      const withPhone = members.filter(m => m.phone && (m.status === 'approved' || m.role === 'owner'));
      report += `• Membres configurés : ${withPhone.length}/${members.length} avec numéro WhatsApp\n`;
    }
    report += `\n`;

    for (const v of data.vehicles) {
      report += `🚗 *${v.name || v.brand + ' ' + v.model}* (${(v.currentKm || 0).toLocaleString('fr-FR')} km)\n`;
      const vItems = data.items.filter(i => i.vehicleId === v.id && !i.deleted);
      if (vItems.length > 0) {
        report += `• Entretiens surveillés : ${vItems.length}\n`;
      }
    }
    report += `\nPour tester l'envoi à tous les utilisateurs : tapez *!test*`;
    await sendWhatsAppMessage(sender, report);
    return;
  }

  // Réponse automatique si commande '!' inconnue
  await sendWhatsAppMessage(sender, `🤖 Commande inconnue. Tapez *!aide* pour voir les commandes disponibles.`);
}

// ============================================================================
// 6. CONNEXION BAILEYS WHATSAPP MULTI-DEVICE
// ============================================================================

async function startWhatsAppBot() {
  await initFirebaseAdminIfAvailable();

  const authPath = path.join(__dirname, 'auth_info_baileys');
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`-----------------------------------------------------`);
  console.log(`  Démarrage du Bot WhatsApp Carnet d'Entretien v1.1   `);
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
      const initialData = await getTrackerData();
      const allTargets = getAllTargetJids(initialData.members || []);
      console.log(`[WhatsApp] Destinataires des alertes configurés (${allTargets.length}) : ${allTargets.join(', ')}`);

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
