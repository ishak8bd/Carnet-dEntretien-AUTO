// scripts/send-email-reminders.mjs
// Envoi automatique des rappels d'entretien et de kilométrage par e-mail (Gmail / Nodemailer)
// Compatible avec exécution locale ou planifiée sans serveur via GitHub Actions (Cron gratuit)
//
// Usage:
//   node scripts/send-email-reminders.mjs           (Vérifie les échéances et envoie si nécessaire)
//   node scripts/send-email-reminders.mjs --test    (Envoie un e-mail de test immédiat)
//   node scripts/send-email-reminders.mjs --dry-run (Affiche le diagnostic sans envoyer)

import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fichiers de configuration
const LOCAL_CONFIG_FILE = path.join(__dirname, 'email-config.json');
const BOT_CONFIG_FILE = path.join(__dirname, '..', 'whatsapp-bot', 'config.json');
const BOT_AUTH_CACHE = path.join(__dirname, '..', 'whatsapp-bot', 'bot_firebase_auth.json');

/**
 * Charge la configuration depuis l'environnement, email-config.json ou whatsapp-bot/config.json
 */
export function loadConfig() {
  let cfg = {
    gmailUser: process.env.GMAIL_USER || '',
    gmailAppPassword: process.env.GMAIL_APP_PASSWORD || '',
    roomId: process.env.FIREBASE_ROOM_ID || 'roommv13dgxrc6c448ac3b69',
    projectId: process.env.FIREBASE_PROJECT_ID || 'entretien-auto-tracker',
    apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyA7qjZi_aWunCo15Y96BbvsZfX7n7O8LO8',
    appUrl: process.env.APP_URL || 'https://ishak8bd.github.io/Carnet-dEntretien-AUTO/'
  };

  // Charger depuis scripts/email-config.json si présent
  try {
    if (fs.existsSync(LOCAL_CONFIG_FILE)) {
      const fileData = JSON.parse(fs.readFileSync(LOCAL_CONFIG_FILE, 'utf-8'));
      cfg = { ...cfg, ...fileData };
    }
  } catch (e) {}

  // Charger les identifiants de salle depuis whatsapp-bot/config.json si non définis
  try {
    if (fs.existsSync(BOT_CONFIG_FILE)) {
      const botCfg = JSON.parse(fs.readFileSync(BOT_CONFIG_FILE, 'utf-8'));
      if (!cfg.roomId && botCfg.roomId) cfg.roomId = botCfg.roomId;
      if (!cfg.projectId && botCfg.projectId) cfg.projectId = botCfg.projectId;
      if (!cfg.apiKey && botCfg.apiKey) cfg.apiKey = botCfg.apiKey;
    }
  } catch (e) {}

  return cfg;
}

/**
 * Obtient un jeton d'authentification Firebase pour lire Firestore
 */
async function getFirebaseAuthToken(cfg) {
  let cached = null;
  // 1. Essayer le jeton en cache du bot s'il est encore valide
  try {
    if (fs.existsSync(BOT_AUTH_CACHE)) {
      cached = JSON.parse(fs.readFileSync(BOT_AUTH_CACHE, 'utf-8'));
      if (cached.expiresAt && Date.now() < cached.expiresAt - 60000 && cached.idToken) {
        return { idToken: cached.idToken, localId: cached.localId };
      }
    }
  } catch (e) {}

  // 2. Si on a un refreshToken, renouveler le jeton de la même identité UID
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
          fs.writeFileSync(BOT_AUTH_CACHE, JSON.stringify(updated, null, 2), 'utf-8');
        } catch (e) {}
        return { idToken: updated.idToken, localId: updated.localId };
      }
    } catch (err) {
      console.warn("Échec rafraîchissement jeton Firebase:", err.message);
    }
  }

  // 3. Sinon, générer une session anonyme avec l'API Key Firebase
  try {
    const signupUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${cfg.apiKey}`;
    const res = await fetch(signupUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true })
    });
    if (res.ok) {
      const data = await res.json();
      const tokenObj = {
        idToken: data.idToken,
        localId: data.localId,
        refreshToken: data.refreshToken,
        expiresAt: Date.now() + (parseInt(data.expiresIn || '3600', 10) - 300) * 1000
      };
      try {
        fs.writeFileSync(BOT_AUTH_CACHE, JSON.stringify(tokenObj, null, 2), 'utf-8');
      } catch (e) {}
      return { idToken: tokenObj.idToken, localId: tokenObj.localId };
    }
  } catch (e) {
    console.warn("Échec d'authentification REST Firebase:", e.message);
  }

  return { idToken: null, localId: null };
}

// Crée une demande d'accès "Bot WhatsApp" dans la salle pour que le propriétaire puisse l'approuver
async function ensureBotMemberRequest(roomId, auth, cfg) {
  if (!auth || !auth.idToken || !auth.localId) return;
  try {
    const docUrl = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/rooms/${roomId}/members/${auth.localId}`;
    const getRes = await fetch(docUrl, {
      headers: { 'Authorization': `Bearer ${auth.idToken}` }
    });

    if (getRes.status === 404) {
      console.log(`[Firestore] Création de la demande d'accès pour le Bot/script dans la salle ${roomId}...`);
      const now = new Date().toISOString();
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
            joinedAt: { timestampValue: now },
            lastSeenAt: { timestampValue: now }
          }
        })
      });
    }
  } catch (e) {
    console.warn("Erreur ensureBotMemberRequest:", e.message);
  }
}

let hasPermissionDenied = false;
let adminDb = null;

/**
 * Initialise Firebase Admin si la clé Google serviceAccountKey.json ou la variable d'environnement existe
 */
async function initFirebaseAdminIfAvailable() {
  if (adminDb) return;
  const possiblePaths = [
    path.join(__dirname, '..', 'serviceAccountKey.json'),
    path.join(__dirname, 'serviceAccountKey.json'),
    path.join(__dirname, '..', 'whatsapp-bot', 'serviceAccountKey.json')
  ];

  let saData = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        saData = JSON.parse(fs.readFileSync(p, 'utf-8'));
        break;
      } catch (e) {}
    }
  }

  if (!saData && process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      saData = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (e) {}
  }

  if (saData) {
    try {
      const { initializeApp, cert, getApps } = await import('firebase-admin/app');
      const { getFirestore } = await import('firebase-admin/firestore');
      const existing = getApps();
      const app = existing.length > 0 ? existing[0] : initializeApp({ credential: cert(saData) }, 'admin-email-app');
      adminDb = getFirestore(app);
      console.log("🔑 [Firebase Admin] Mode Administrateur Google Cloud activé ! Lecture directe sans intermédiaire.");
    } catch (err) {
      console.warn("Échec init Firebase Admin:", err.message);
    }
  }
}

/**
 * Récupère une sous-collection Firestore sous rooms/{roomId}/{subcollection}
 */
async function fetchFirestoreCollection(subcollection, auth, cfg) {
  // 1. Si Firebase Admin est connecté, lecture directe sans restriction de règles
  if (adminDb) {
    try {
      const snap = await adminDb.collection('rooms').doc(cfg.roomId).collection(subcollection).get();
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
      console.warn(`Erreur Firebase Admin sur ${subcollection}:`, e.message);
    }
  }

  // 2. Sinon, API REST avec authentification du script
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/rooms/${cfg.roomId}/${subcollection}`;
    const headers = {};
    if (auth && auth.idToken) headers['Authorization'] = `Bearer ${auth.idToken}`;

    const res = await fetch(url, { headers });
    if (res.status === 403) {
      hasPermissionDenied = true;
      await ensureBotMemberRequest(cfg.roomId, auth, cfg);
      return [];
    }
    if (!res.ok) return [];

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
    console.warn(`Erreur récupération ${subcollection}:`, err.message);
    return [];
  }
}

/**
 * Calcule intelligemment le rythme de roulage journalier d'un véhicule :
 * - Compare les dates et kilométrages de tous les entretiens passés (items) avec le compteur actuel
 * - Intègre la baseline automobile standard (1 000 à 2 000 km / mois, médiane 1 500 km/mois)
 * - Fusionne les données observées par pondération bayésienne selon la profondeur d'historique
 */
export function calculateIntelligentDailyRate(veh, vehLogs = [], vehItems = [], history = []) {
  const PRIOR_MONTHLY_KM_DEFAULT = 1500;
  const DAYS_PER_MONTH = 30.4375;
  const PRIOR_DAILY_KM_DEFAULT = PRIOR_MONTHLY_KM_DEFAULT / DAYS_PER_MONTH; // ~49.28 km/j

  const pointsMap = new Map();

  function addPoint(dateStr, kmVal) {
    if (!dateStr || kmVal === null || kmVal === undefined) return;
    const cleanDate = String(dateStr).split('T')[0];
    const kmNum = Number(kmVal);
    if (isNaN(kmNum) || kmNum <= 0) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) return;

    if (!pointsMap.has(cleanDate)) {
      pointsMap.set(cleanDate, { date: cleanDate, km: kmNum });
    } else {
      const existing = pointsMap.get(cleanDate);
      if (kmNum > existing.km) existing.km = kmNum;
    }
  }

  // 1. Relevés du journal (kmLog)
  vehLogs.forEach(l => {
    if (l && l.date && l.km) addPoint(l.date, l.km);
  });

  // 2. Derniers entretiens renseignés (items)
  vehItems.forEach(i => {
    if (i && i.lastDate && i.lastKm) addPoint(i.lastDate, i.lastKm);
  });

  // 3. Historique d'interventions
  history.forEach(h => {
    if (h && h.date && h.km) addPoint(h.date, h.km);
  });

  // 4. Compteur actuel à ce jour
  const currentKm = Number(veh.currentKm);
  if (!isNaN(currentKm) && currentKm > 0) {
    const today = new Date().toISOString().split('T')[0];
    const updateDate = veh.updatedAt ? String(veh.updatedAt).split('T')[0] : today;
    const validDate = updateDate <= today ? updateDate : today;
    addPoint(validDate, currentKm);
  }

  const milestones = Array.from(pointsMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // Filtrer les incohérences régressives
  const cleanMilestones = [];
  let maxKm = 0;
  for (const m of milestones) {
    if (m.km >= maxKm) {
      cleanMilestones.push(m);
      maxKm = m.km;
    }
  }

  if (cleanMilestones.length < 2) {
    return {
      dailyRate: PRIOR_DAILY_KM_DEFAULT,
      monthlyRate: PRIOR_MONTHLY_KM_DEFAULT,
      confidence: 'prior',
      milestonesCount: cleanMilestones.length
    };
  }

  const firstM = cleanMilestones[0];
  const lastM = cleanMilestones[cleanMilestones.length - 1];
  const totalDays = Math.max(0, Math.round((new Date(lastM.date) - new Date(firstM.date)) / (1000 * 60 * 60 * 24)));
  const totalDeltaKm = Math.max(0, lastM.km - firstM.km);

  if (totalDays < 3 || totalDeltaKm <= 0) {
    return {
      dailyRate: PRIOR_DAILY_KM_DEFAULT,
      monthlyRate: PRIOR_MONTHLY_KM_DEFAULT,
      confidence: 'prior',
      milestonesCount: cleanMilestones.length
    };
  }

  const observedRate = totalDeltaKm / totalDays;
  const clampedObserved = Math.max(5, Math.min(250, observedRate));

  // Poids W_obs croissant selon la durée d'observation et le nombre d'entretiens
  const spanWeight = Math.min(1.0, totalDays / 60);
  const pointsBonus = Math.min(1.0, (cleanMilestones.length - 1) / 3);
  const wObs = Math.min(0.95, spanWeight * 0.70 + pointsBonus * 0.30);

  const blendedRate = wObs * clampedObserved + (1 - wObs) * PRIOR_DAILY_KM_DEFAULT;
  const finalDailyRate = Math.max(0.1, blendedRate);

  return {
    dailyRate: finalDailyRate,
    monthlyRate: finalDailyRate * DAYS_PER_MONTH,
    confidence: wObs >= 0.7 ? 'high' : 'medium',
    milestonesCount: cleanMilestones.length,
    observedRate,
    wObs
  };
}

/**
 * Crée le transporteur Nodemailer pour Gmail
 */
function createEmailTransporter(cfg) {
  if (!cfg.gmailUser || !cfg.gmailAppPassword) {
    throw new Error(
      "Identifiants Gmail manquants ! Veuillez renseigner GMAIL_USER et GMAIL_APP_PASSWORD dans vos variables d'environnement ou dans scripts/email-config.json."
    );
  }

  // Nettoyer les espaces souvent présents lors du copier-coller du mot de passe d'application Google (ex: "abcd efgh ijkl mnop")
  const cleanPass = cfg.gmailAppPassword.replace(/\s+/g, '');

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: cfg.gmailUser,
      pass: cleanPass
    }
  });
}

/**
 * Construit le template HTML soigné et responsive pour les e-mails
 */
function buildEmailHtml({ title, subtitle, badges = [], sections = [], appUrl }) {
  const badgeHtml = badges.map(b => `
    <span style="display: inline-block; background: ${b.bg || '#3b82f6'}; color: #ffffff; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; margin-right: 6px; margin-bottom: 6px;">
      ${b.text}
    </span>
  `).join('');

  const sectionsHtml = sections.map(s => `
    <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
      <h3 style="margin-top: 0; margin-bottom: 10px; color: #1e293b; font-size: 16px; font-weight: 700; display: flex; align-items: center; gap: 8px;">
        ${s.title}
      </h3>
      <div style="font-size: 14px; color: #475569; line-height: 1.6;">
        ${s.content}
      </div>
    </div>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 25px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          
          <!-- En-tête -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 26px 28px; text-align: left;">
              <div style="font-size: 26px; margin-bottom: 4px;">🚗</div>
              <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 700; letter-spacing: -0.02em;">
                Carnet d'Entretien Automobile
              </h1>
              <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 13px;">
                Système d'alertes &amp; suivi prédictif
              </p>
            </td>
          </tr>

          <!-- Contenu principal -->
          <tr>
            <td style="padding: 28px; background-color: #f8fafc;">
              <div style="margin-bottom: 14px;">
                ${badgeHtml}
              </div>

              <h2 style="margin: 0 0 8px 0; color: #0f172a; font-size: 18px; font-weight: 700;">
                ${title}
              </h2>
              ${subtitle ? `<p style="margin: 0 0 20px 0; color: #64748b; font-size: 14px; line-height: 1.5;">${subtitle}</p>` : ''}

              <!-- Cartes des interventions / rappels -->
              ${sectionsHtml}

              <!-- Bouton d'action -->
              <div style="text-align: center; margin-top: 26px; margin-bottom: 10px;">
                <a href="${appUrl}" target="_blank" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 13px 28px; font-size: 15px; font-weight: 600; border-radius: 8px; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.25);">
                  Ouvrir mon Carnet d'Entretien ➔
                </a>
                <p style="font-size: 12px; color: #94a3b8; margin-top: 10px; margin-bottom: 0;">
                  Une fois l'intervention faite, cliquez sur « Fait » dans l'application pour clore ce rappel.
                </p>
              </div>
            </td>
          </tr>

          <!-- Pied de page -->
          <tr>
            <td style="padding: 20px 28px; background-color: #ffffff; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; line-height: 1.5;">
              Ce rappel automatique a été généré pour vos véhicules enregistrés.<br>
              Pour modifier vos destinataires ou vos numéros WhatsApp, rendez-vous dans les <strong>Paramètres</strong> de l'application.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Fonction principale d'évaluation des rappels et d'envoi des e-mails
 */
export async function runEmailReminders({ isTest = false, isDryRun = false } = {}) {
  console.log(`\n======================================================`);
  console.log(`  RAPPELS AUTOMATIQUES PAR E-MAIL - CARNET D'ENTRETIEN`);
  console.log(`  Date : ${new Date().toLocaleString('fr-FR')}`);
  console.log(`======================================================`);

  const cfg = loadConfig();

  if (!cfg.gmailUser || !cfg.gmailAppPassword) {
    if (isDryRun) {
      console.log("ℹ️ Identifiants Gmail non configurés. Mode Simulation (--dry-run) actif.");
      cfg.gmailUser = cfg.gmailUser || 'simulation@gmail.com';
    } else {
      console.error("❌ Identifiants Gmail non configurés.");
      console.error("👉 Créez scripts/email-config.json ou définissez GMAIL_USER et GMAIL_APP_PASSWORD.");
      return { success: false, error: 'missing_credentials' };
    }
  }

  console.log(`📧 Expéditeur configuré : ${cfg.gmailUser}`);
  console.log(`🏠 Salle Firestore : ${cfg.roomId}`);

  await initFirebaseAdminIfAvailable();
  hasPermissionDenied = false;
  const auth = !adminDb ? await getFirebaseAuthToken(cfg) : null;
  const vehicles = await fetchFirestoreCollection('vehicles', auth, cfg);
  const items = await fetchFirestoreCollection('items', auth, cfg);
  const kmLogs = await fetchFirestoreCollection('kmLogs', auth, cfg);
  const members = await fetchFirestoreCollection('members', auth, cfg);
  const history = await fetchFirestoreCollection('history', auth, cfg);

  if (hasPermissionDenied) {
    console.error(`\n🔒 [Firestore] ACCÈS EN ATTENTE D'APPROBATION (Erreur 403) :`);
    console.error(`👉 Le compte du Bot/Script a demandé à rejoindre la salle "${cfg.roomId}".`);
    console.error(`👉 Action requise :`);
    console.error(`   1. Ouvrez l'application web : https://ishak8bd.github.io/Carnet-dEntretien-AUTO/`);
    console.error(`   2. Rendez-vous dans Paramètres ⚙️ > Membres de la salle (ou sur le bandeau jaune en haut).`);
    console.error(`   3. Cliquez sur "Accepter" à côté de "Bot WhatsApp (Baileys)".\n`);
    return { success: false, error: 'permission_denied' };
  }

  if (vehicles.length === 0) {
    console.warn(`\nℹ️ Aucun véhicule trouvé dans la salle Firestore "${cfg.roomId}".`);
    console.warn(`👉 Vérifications :`);
    console.warn(`   1. Êtes-vous bien connecté en Mode Salle (et non en Mode Solo local) ?`);
    console.warn(`   2. Le code de votre salle dans l'application correspond-il bien à "${cfg.roomId}" ?\n`);
    return { success: false, error: 'no_vehicles' };
  }

  console.log(`📊 Données récupérées : ${vehicles.length} véhicule(s), ${items.length} entretien(s), ${kmLogs.length} relevé(s), ${history.length} intervention(s), ${members.length} membre(s).`);

  // Extraire la liste des destinataires e-mail avec nom et rôle
  const recipientMap = new Map();
  members.forEach(m => {
    if (m.email && (m.status === 'approved' || m.role === 'owner')) {
      const clean = m.email.trim().toLowerCase();
      if (clean.includes('@')) {
        recipientMap.set(clean, {
          email: clean,
          name: m.name ? m.name.trim() : '',
          role: m.role || 'member'
        });
      }
    }
  });

  // Toujours inclure l'expéditeur Gmail / compte admin si aucun e-mail membre n'est présent
  if (cfg.gmailUser && recipientMap.size === 0) {
    const clean = cfg.gmailUser.trim().toLowerCase();
    recipientMap.set(clean, { email: clean, name: 'Administrateur', role: 'owner' });
  }

  const recipients = Array.from(recipientMap.values());
  const recipientList = recipients.map(r => r.email);
  console.log(`📬 Destinataire(s) e-mail (${recipients.length}) :`, recipients.map(r => r.name ? `${r.name} <${r.email}>` : r.email).join(', '));

  if (recipients.length === 0) {
    console.warn("⚠️ Aucun destinataire e-mail trouvé.");
    return { success: false, error: 'no_recipients' };
  }

  const transporter = !isDryRun ? createEmailTransporter(cfg) : null;

  // --------------------------------------------------------------------------
  // CAS 1 : MODE TEST DIRECT (--test)
  // --------------------------------------------------------------------------
  if (isTest) {
    console.log("🧪 Mode Test activé : Envoi d'un e-mail de validation...");
    const sampleVeh = vehicles.length > 0 ? vehicles[0] : { name: 'Renault Symbol', brand: 'Renault', model: 'Symbol', currentKm: 250000 };
    const vehName = sampleVeh.name || `${sampleVeh.brand} ${sampleVeh.model}`.trim();
    const currentKm = sampleVeh.currentKm || 250000;

    const testHtml = buildEmailHtml({
      title: "Test de notification E-mail réussi !",
      subtitle: "Vos alertes d'entretien par e-mail sont maintenant parfaitement configurées.",
      badges: [
        { text: "🟢 SYSTÈME OPÉRATIONNEL", bg: "#16a34a" },
        { text: `🚗 ${vehName}`, bg: "#2563eb" }
      ],
      sections: [
        {
          title: "📊 Données synchronisées en direct",
          content: `
            • <strong>Salle de partage :</strong> <code>${cfg.roomId}</code><br>
            • <strong>Véhicule surveillé :</strong> ${vehName}<br>
            • <strong>Compteur actuel :</strong> ${currentKm.toLocaleString('fr-FR')} km<br>
            • <strong>Entretiens suivis :</strong> ${items.length} opération(s)<br>
            • <strong>Destinataires connectés :</strong> ${recipients.length} adresse(s) e-mail
          `
        },
        {
          title: "🔔 Rappels automatisés actifs",
          content: `
            1️⃣ <strong>Mise à jour du compteur :</strong> Vous recevrez un e-mail tous les 15 jours si le kilométrage n'a pas été actualisé.<br><br>
            2️⃣ <strong>Entretiens proches :</strong> Un e-mail d'alerte progressif sera envoyé dès qu'une vidange, des freins ou une courroie approchent de leur échéance !
          `
        }
      ],
      appUrl: cfg.appUrl
    });

    if (isDryRun) {
      console.log("🔍 [Dry Run] E-mail de test prêt à être envoyé à :", recipientList);
      return { success: true, count: recipients.length, recipients: recipientList };
    }

    const testResults = [];
    for (const r of recipients) {
      const targetTo = r.name ? `"${r.name}" <${r.email}>` : r.email;
      try {
        const info = await transporter.sendMail({
          from: `"Carnet d'Entretien" <${cfg.gmailUser}>`,
          to: targetTo,
          subject: `🚗 Test de Notification - Carnet d'Entretien Automobile`,
          html: testHtml,
          text: `Test de notification réussi ! Votre Carnet d'Entretien est synchronisé (${recipients.length} destinataires). Ouvrez l'application : ${cfg.appUrl}`
        });
        console.log(`  ✅ E-mail de test envoyé avec succès à ${r.email} (${r.name || 'Membre'}) ! MessageId : ${info.messageId}`);
        testResults.push({ email: r.email, success: true, messageId: info.messageId });
      } catch (err) {
        console.error(`  ❌ Échec de l'envoi du test à ${r.email} :`, err.message);
        testResults.push({ email: r.email, success: false, error: err.message });
      }
      if (recipients.length > 1) {
        await new Promise(res => setTimeout(res, 350));
      }
    }

    const allSuccessful = testResults.filter(r => r.success).length;
    console.log(`✨ Bilan du test : ${allSuccessful}/${recipients.length} destinataire(s) validé(s).`);
    return { success: allSuccessful > 0, recipients: recipientList, details: testResults };
  }

  // --------------------------------------------------------------------------
  // CAS 2 : VÉRIFICATION ET ENVOI RÉEL DES RAPPELS
  // --------------------------------------------------------------------------
  const now = Date.now();
  const alertsToSend = [];

  for (const veh of vehicles) {
    const vehId = veh.id;
    const vehName = veh.name || `${veh.brand || ''} ${veh.model || ''}`.trim() || 'Véhicule';
    const vehLogs = kmLogs
      .filter(l => l.vehicleId === vehId)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const lastLog = vehLogs.length > 0 ? vehLogs[vehLogs.length - 1] : null;
    const currentKm = veh.currentKm || (lastLog ? lastLog.km : 0);

    // 1. Rappel Relevé kilométrique tous les 15 jours
    if (lastLog && lastLog.date) {
      const lastLogDate = new Date(lastLog.date).getTime();
      const daysElapsed = Math.floor((now - lastLogDate) / (1000 * 60 * 60 * 24));

      if (daysElapsed >= 15) {
        alertsToSend.push({
          type: 'mileage',
          vehicle: vehName,
          title: `📅 Relevé de compteur à mettre à jour (${vehName})`,
          level: 'mileage',
          content: `
            Votre dernier relevé kilométrique date d'il y a <strong>${daysElapsed} jours</strong> (le ${lastLog.date}).<br><br>
            • Dernier kilométrage enregistré : <strong>${currentKm.toLocaleString('fr-FR')} km</strong><br><br>
            Pensez à relever votre compteur et à l'actualiser dans l'application pour maintenir la précision de vos prédictions d'entretien !
          `
        });
      }
    }

    // 2. Estimation intelligente du rythme de roulage (Prior 1000-2000 km/mois + entretiens passés)
    const vehItems = items.filter(i => i.vehicleId === vehId && !i.deleted);
    const vehHistory = history.filter(h => h.vehicleId === vehId);
    const engineRate = calculateIntelligentDailyRate(veh, vehLogs, vehItems, vehHistory);
    const dailyRate = engineRate.dailyRate;
    const monthlyRate = Math.round(engineRate.monthlyRate);
    console.log(`  🚗 ${vehName} : Rythme estimé = ~${Math.round(dailyRate)} km/j (~${monthlyRate.toLocaleString('fr-FR')} km/mois, ${engineRate.confidence === 'high' ? 'précision élevée' : (engineRate.confidence === 'medium' ? 'précision affinée' : 'prior 1 500 km/m')})`);

    // 3. Rappels d'entretiens proches
    for (const item of vehItems) {
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

      if (effectiveRemainingDays <= 15 || (remainingKm !== null && remainingKm <= 500)) {
        let level = 'info';
        let levelLabel = 'ℹ️ À PRÉVOIR';
        let badgeBg = '#0284c7';

        if (effectiveRemainingDays <= 2 || (remainingKm !== null && remainingKm <= 100)) {
          level = 'urgent';
          levelLabel = '🚨 URGENT / RETARD';
          badgeBg = '#dc2626';
        } else if (effectiveRemainingDays <= 7 || (remainingKm !== null && remainingKm <= 250)) {
          level = 'warning';
          levelLabel = '⚠️ IMMINENT';
          badgeBg = '#d97706';
        }

        const kmInfo = remainingKm !== null
          ? (remainingKm <= 0 ? `<span style="color: #dc2626; font-weight: 700;">Dépassé de ${Math.abs(remainingKm)} km</span>` : `reste ${remainingKm.toLocaleString('fr-FR')} km`)
          : '';

        alertsToSend.push({
          type: 'maintenance',
          vehicle: vehName,
          title: `${levelLabel} : ${item.name} (${vehName})`,
          level,
          badge: { text: levelLabel, bg: badgeBg },
          content: `
            • <strong>Opération :</strong> 🔧 ${item.name}<br>
            • <strong>Véhicule :</strong> ${vehName}<br>
            • <strong>Échéance estimée :</strong> ${effectiveRemainingDays <= 0 ? '<strong style="color: #dc2626;">DÉPASSÉE</strong>' : `dans environ <strong>${effectiveRemainingDays} jour(s)</strong>`} ${kmInfo ? `(${kmInfo})` : ''}<br><br>
            Pensez à planifier cette intervention ou votre rendez-vous garage.
          `
        });
      }
    }
  }

  if (alertsToSend.length === 0) {
    console.log("✅ Aucune échéance urgente ni relevé en retard détecté aujourd'hui. Aucun e-mail envoyé.");
    return { success: true, count: 0 };
  }

  console.log(`🔔 ${alertsToSend.length} alerte(s) détectée(s). Préparation de l'e-mail de synthèse...`);

  const hasUrgent = alertsToSend.some(a => a.level === 'urgent');
  const subjectPrefix = hasUrgent ? "🚨 URGENT :" : "⚠️ RAPPEL :";
  const subject = `${subjectPrefix} ${alertsToSend.length} entretien(s) & rappel(s) - Carnet d'Entretien`;

  const badges = [
    { text: `🔔 ${alertsToSend.length} ALERTE(S)`, bg: hasUrgent ? "#dc2626" : "#d97706" }
  ];

  const sections = alertsToSend.map(a => ({
    title: a.title,
    content: a.content
  }));

  const html = buildEmailHtml({
    title: "Synthèse de vos échéances d'entretien",
    subtitle: "Voici les interventions et relevés de compteur à prévoir pour vos véhicules partagés :",
    badges,
    sections,
    appUrl: cfg.appUrl
  });

  if (isDryRun) {
    console.log(`🔍 [Dry Run] E-mail prêt (${alertsToSend.length} alertes) pour :`, recipients.map(r => r.email));
    return { success: true, count: alertsToSend.length };
  }

  const sendResults = [];
  for (const r of recipients) {
    const targetTo = r.name ? `"${r.name}" <${r.email}>` : r.email;
    try {
      const info = await transporter.sendMail({
        from: `"Carnet d'Entretien" <${cfg.gmailUser}>`,
        to: targetTo,
        subject,
        html,
        text: `Carnet d'Entretien : ${alertsToSend.length} rappel(s) à consulter. Rendez-vous sur ${cfg.appUrl}`
      });
      console.log(`  ✅ E-mail d'alerte envoyé avec succès à ${r.email} (${r.name || 'Membre'}) ! MessageId : ${info.messageId}`);
      sendResults.push({ email: r.email, success: true, messageId: info.messageId });
    } catch (err) {
      console.error(`  ❌ Échec de l'envoi d'alerte à ${r.email} :`, err.message);
      sendResults.push({ email: r.email, success: false, error: err.message });
    }
    if (recipients.length > 1) {
      await new Promise(res => setTimeout(res, 350));
    }
  }

  const successCount = sendResults.filter(r => r.success).length;
  console.log(`✨ Bilan d'envoi des alertes : ${successCount}/${recipients.length} destinataire(s) ont reçu leur notification !`);
  return { success: successCount > 0, alertsCount: alertsToSend.length, details: sendResults };
}

// Exécution directe en ligne de commande
const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectExecution) {
  const args = process.argv.slice(2);
  const isTest = args.includes('--test');
  const isDryRun = args.includes('--dry-run');

  runEmailReminders({ isTest, isDryRun })
    .then(() => process.exit(0))
    .catch(err => {
      console.error("❌ Erreur lors de l'exécution :", err.message);
      process.exit(1);
    });
}
