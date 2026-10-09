// test-broadcast.js - Script autonome pour tester l'envoi WhatsApp à tous les utilisateurs
// Usage: node test-broadcast.js

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = path.join(__dirname, 'config.json');
const AUTH_CACHE_FILE = path.join(__dirname, 'bot_firebase_auth.json');

function loadConfig() {
  let cfg = {
    targetPhone: '',
    targetPhones: [],
    subscribers: [],
    roomId: 'roommv13dgxrc6c448ac3b69',
    projectId: 'entretien-auto-tracker',
    apiKey: 'AIzaSyA7qjZi_aWunCo15Y96BbvsZfX7n7O8LO8'
  };
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) };
    }
  } catch (e) {}
  return cfg;
}

async function getTrackerData() {
  const cfg = loadConfig();
  try {
    if (!fs.existsSync(AUTH_CACHE_FILE)) return { vehicles: [], members: [] };
    const auth = JSON.parse(fs.readFileSync(AUTH_CACHE_FILE, 'utf-8'));
    
    // Véhicules
    const vehUrl = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/rooms/${cfg.roomId}/vehicles`;
    const vehRes = await fetch(vehUrl, { headers: { 'Authorization': `Bearer ${auth.idToken}` } });
    let vehicles = [];
    if (vehRes.ok) {
      const data = await vehRes.json();
      vehicles = (data.documents || []).map(d => ({
        name: d.fields?.name?.stringValue || 'Véhicule',
        brand: d.fields?.brand?.stringValue || '',
        model: d.fields?.model?.stringValue || '',
        currentKm: parseInt(d.fields?.currentKm?.integerValue || '0', 10)
      }));
    }

    // Membres
    const memUrl = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/rooms/${cfg.roomId}/members`;
    const memRes = await fetch(memUrl, { headers: { 'Authorization': `Bearer ${auth.idToken}` } });
    let members = [];
    if (memRes.ok) {
      const data = await memRes.json();
      members = (data.documents || []).map(d => ({
        id: d.name.split('/').pop(),
        name: d.fields?.name?.stringValue || 'Membre',
        role: d.fields?.role?.stringValue || 'member',
        status: d.fields?.status?.stringValue || 'pending',
        phone: d.fields?.phone?.stringValue || null
      }));
    }

    return { vehicles, members };
  } catch (e) {
    return { vehicles: [], members: [] };
  }
}

async function run() {
  console.log("=====================================================");
  console.log(" TEST D'ENVOI WHATSAPP MULTI-UTILISATEURS (BAILEYS) ");
  console.log("=====================================================");

  const cfg = loadConfig();
  const authPath = path.join(__dirname, 'auth_info_baileys');
  if (!fs.existsSync(path.join(authPath, 'creds.json'))) {
    console.error("❌ Session Baileys introuvable. Veuillez lancer 'npm start' d'abord pour scanner le QR code.");
    process.exit(1);
  }

  const { state } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: ['Carnet Entretien Auto', 'Desktop', '1.0.0']
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error("❌ Session déconnectée de WhatsApp.");
        process.exit(1);
      }
    }

    if (connection === 'open') {
      console.log("✅ Connecté à WhatsApp !");

      const trackerData = await getTrackerData();
      const members = trackerData.members || [];
      const vehicles = trackerData.vehicles || [];

      // Construire la liste de tous les destinataires
      const targets = new Set();
      if (sock.user && sock.user.id) {
        const selfNum = sock.user.id.split(':')[0].replace(/[^0-9]/g, '');
        targets.add(`${selfNum}@s.whatsapp.net`);
      }

      // Membres Firestore avec téléphone
      members.forEach(m => {
        if (m.phone && (m.status === 'approved' || m.role === 'owner')) {
          const clean = m.phone.replace(/[^0-9]/g, '');
          if (clean) targets.add(`${clean}@s.whatsapp.net`);
        }
      });

      if (cfg.targetPhone) {
        targets.add(`${cfg.targetPhone.replace(/[^0-9]/g, '')}@s.whatsapp.net`);
      }
      if (Array.isArray(cfg.targetPhones)) {
        cfg.targetPhones.forEach(p => targets.add(`${p.replace(/[^0-9]/g, '')}@s.whatsapp.net`));
      }
      if (Array.isArray(cfg.subscribers)) {
        cfg.subscribers.forEach(s => targets.add(`${s.replace(/[^0-9]/g, '')}@s.whatsapp.net`));
      }

      const targetList = Array.from(targets);
      console.log(`📱 Destinataires détectés (${targetList.length}) :`, targetList.map(j => {
        const num = '+' + j.replace('@s.whatsapp.net', '');
        const mem = members.find(m => m.phone && m.phone.replace(/[^0-9]/g, '') === j.replace('@s.whatsapp.net', ''));
        return mem ? `${num} (${mem.name})` : num;
      }).join(', '));

      // Données du véhicule
      const veh = vehicles.length > 0 ? vehicles[0] : { name: 'Renault Symbol', currentKm: 250000 };

      const testMsg =
        `🚗 *TEST DE NOTIFICATION WHATSAPP - Carnet d'Entretien*\n\n` +
        `✅ *Diffusion multi-utilisateurs réussie !*\n\n` +
        `📊 *Données de la salle :*\n` +
        `• Salle Firestore : *${cfg.roomId}*\n` +
        `• Véhicule : *${veh.name || 'Renault Symbol'}*\n` +
        `• Kilométrage enregistré : *${(veh.currentKm || 250000).toLocaleString('fr-FR')} km*\n` +
        `• Statut du bot : 🟢 Opérationnel et synchronisé\n\n` +
        `👥 Ce message est délivré à l'ensemble des ${targetList.length} destinataire(s) enregistré(s).\n\n` +
        `_Test exécuté avec succès le ${new Date().toLocaleString('fr-FR')}_`;

      let sent = 0;
      for (const jid of targetList) {
        try {
          await sock.sendMessage(jid, { text: testMsg });
          console.log(`  [OK] Message envoyé avec succès à +${jid.replace('@s.whatsapp.net', '')}`);
          sent++;
          await new Promise(r => setTimeout(r, 400));
        } catch (err) {
          console.error(`  [ERREUR] Échec pour +${jid.replace('@s.whatsapp.net', '')}:`, err.message);
        }
      }

      console.log(`\n🎉 Test terminé : ${sent}/${targetList.length} message(s) envoyé(s) !`);
      setTimeout(() => {
        sock.end();
        process.exit(0);
      }, 1000);
    }
  });
}

run().catch(err => {
  console.error("Erreur critique :", err);
  process.exit(1);
});
