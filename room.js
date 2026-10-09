// room.js - Gestion de la Salle Familiale (Family Room) pour Carnet d'Entretien
//
// Ce module gère :
// 1. La création de salles partagées et la génération d'invitations sécurisées (>= 128 bits).
// 2. La jonction d'une salle avec approbation propriétaire (sans email ni mot de passe).
// 3. La synchronisation en temps réel via Firestore (onSnapshot) pour véhicules, relevés, entretiens, historique et activité.
// 4. L'attribution de l'auteur sur chaque action ("Papa : 118 450 km").
// 5. La suppression d'un membre par le propriétaire et la gestion des membres.
// 6. Le fil d'activité en direct ("Maman a ajouté une vidange il y a 2h").
// 7. L'indicateur de connectivité en ligne / hors-ligne / synchronisation en attente.

import { 
  auth, 
  db, 
  isFirebaseConfigured, 
  signInAnonymously, 
  onAuthStateChanged,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  writeBatch
} from './firebase-config.js';

const ROOM_PROFILE_KEY = 'carnet_room_profile';

// Abonnements et données en mémoire vive
let activeMemberStatusUnsubscribe = null;
let activePendingMembersUnsubscribe = null;
let roomDataUnsubscribers = [];

const roomVehiclesMap = new Map();
const roomKmLogsMap = new Map();
const roomItemsMap = new Map();
const roomHistoryMap = new Map();
let roomActivityList = [];
let roomMembersList = [];

let lastActivityPing = 0;

/** Génère un token cryptographiquement sécurisé (au moins 128 bits / 16 octets d'entropie) */
export function generateSecureToken(byteLength = 16) {
  const arr = new Uint8Array(byteLength);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < byteLength; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

/** Assure que l'utilisateur est authentifié de manière anonyme auprès de Firebase */
export async function ensureAuth() {
  if (!isFirebaseConfigured() || !auth) {
    throw new Error("Firebase n'est pas encore configuré. Veuillez renseigner vos identifiants dans firebase-config.js.");
  }
  if (auth.currentUser) {
    return auth.currentUser;
  }

  // 1. Attendre la restauration de la session persistante
  if (typeof auth.authStateReady === 'function') {
    try {
      await auth.authStateReady();
      if (auth.currentUser) {
        return auth.currentUser;
      }
    } catch (e) {
      console.warn("auth.authStateReady a échoué:", e);
    }
  } else {
    await new Promise((resolve) => {
      let done = false;
      const unsub = onAuthStateChanged(auth, (u) => {
        if (!done) { done = true; unsub(); resolve(u); }
      }, () => {
        if (!done) { done = true; resolve(null); }
      });
      setTimeout(() => {
        if (!done) { done = true; try { unsub(); } catch (e) {} resolve(null); }
      }, 1200);
    });
    if (auth.currentUser) {
      return auth.currentUser;
    }
  }

  // 2. Si aucune session n'est présente, nouvelle connexion anonyme
  const credential = await signInAnonymously(auth);
  return credential.user;
}

/** Récupère le profil de la salle enregistré sur ce téléphone */
export function getStoredRoomProfile() {
  try {
    const raw = localStorage.getItem(ROOM_PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Erreur lecture carnet_room_profile:', err);
    return null;
  }
}

/** Enregistre le profil de salle sur ce téléphone */
export function saveStoredRoomProfile(profile) {
  if (!profile) {
    localStorage.removeItem(ROOM_PROFILE_KEY);
  } else {
    localStorage.setItem(ROOM_PROFILE_KEY, JSON.stringify(profile));
  }
}

/** Vérifie si l'utilisateur est actuellement dans une salle active et approuvée */
export function isRoomActive() {
  const profile = getStoredRoomProfile();
  return Boolean(profile && profile.roomId && profile.status === 'approved');
}

/** Analyse et extrait roomId et inviteId d'un texte ou d'une URL */
export function parseInviteToken(input) {
  if (!input) return null;
  let clean = input.trim();
  
  const hashIdx = clean.indexOf('#join=');
  if (hashIdx !== -1) {
    clean = clean.substring(hashIdx + 6);
  }

  const underscoreIdx = clean.indexOf('_');
  if (underscoreIdx === -1) return null;

  const roomId = clean.substring(0, underscoreIdx);
  const inviteId = clean.substring(underscoreIdx + 1);

  if (!roomId || !inviteId) return null;
  return { roomId, inviteId, fullCode: clean };
}

/**
 * Met à jour lastActivityAt sur la salle (throttled à max 1 fois par minute)
 */
export async function pingRoomActivity(roomId) {
  const now = Date.now();
  if (now - lastActivityPing < 60000) return;
  lastActivityPing = now;
  try {
    const roomRef = doc(db, 'rooms', roomId);
    await updateDoc(roomRef, {
      lastActivityAt: serverTimestamp()
    });
  } catch (err) {
    // Échec discret
  }
}

/**
 * Crée une nouvelle salle familiale avec son premier lien d'invitation
 */
export async function createFamilyRoom({ roomName, ownerName, expiryHours = 24, maxUses = 5, migrateLocal = false }) {
  if (!roomName || !roomName.trim()) throw new Error("Le nom de la salle est obligatoire.");
  if (!ownerName || !ownerName.trim()) throw new Error("Votre prénom est obligatoire.");

  const user = await ensureAuth();
  const uid = user.uid;

  const roomId = 'room' + Date.now().toString(36) + generateSecureToken(6);
  const inviteId = 'inv' + generateSecureToken(16);

  const batch = writeBatch(db);

  // 1. Document Salle
  const roomRef = doc(db, 'rooms', roomId);
  batch.set(roomRef, {
    name: roomName.trim(),
    ownerUid: uid,
    createdAt: serverTimestamp(),
    lastActivityAt: serverTimestamp(),
    schemaVersion: 1
  });

  // 2. Document Membre Propriétaire (automatiquement approuvé)
  const memberRef = doc(db, 'rooms', roomId, 'members', uid);
  batch.set(memberRef, {
    name: ownerName.trim(),
    role: 'owner',
    status: 'approved',
    joinedAt: serverTimestamp(),
    lastSeenAt: serverTimestamp()
  });

  // 3. Premier lien d'invitation (24h et 5 usages par défaut)
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + Number(expiryHours) * 3600 * 1000));
  const inviteRef = doc(db, 'rooms', roomId, 'invites', inviteId);
  batch.set(inviteRef, {
    inviteId: inviteId,
    expiresAt: expiresAt,
    maxUses: Number(maxUses),
    uses: 0,
    active: true,
    createdBy: uid
  });

  await batch.commit();

  const roomProfile = {
    roomId,
    roomName: roomName.trim(),
    myName: ownerName.trim(),
    myUid: uid,
    role: 'owner',
    status: 'approved'
  };
  saveStoredRoomProfile(roomProfile);

  // Migration des données locales si demandée
  if (migrateLocal && window.appState && window.appState.vehicles && window.appState.vehicles.length > 0) {
    await migrateLocalDataToRoom(roomId, uid, ownerName.trim());
  }

  const inviteCode = `${roomId}_${inviteId}`;
  const inviteUrl = `${window.location.origin}${window.location.pathname}#join=${inviteCode}`;

  // Démarrer la synchronisation temps réel
  startRoomSynchronization(roomId);

  return {
    roomId,
    inviteId,
    inviteCode,
    inviteUrl,
    profile: roomProfile
  };
}

/**
 * Crée une nouvelle invitation pour une salle existante (réservé au propriétaire)
 */
export async function createAdditionalInvite(roomId, { expiryHours = 24, maxUses = 5 }) {
  const user = await ensureAuth();
  const inviteId = 'inv' + generateSecureToken(16);
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + Number(expiryHours) * 3600 * 1000));

  const inviteRef = doc(db, 'rooms', roomId, 'invites', inviteId);
  await setDoc(inviteRef, {
    inviteId: inviteId,
    expiresAt: expiresAt,
    maxUses: Number(maxUses),
    uses: 0,
    active: true,
    createdBy: user.uid
  });

  const inviteCode = `${roomId}_${inviteId}`;
  const inviteUrl = `${window.location.origin}${window.location.pathname}#join=${inviteCode}`;

  return { inviteId, inviteCode, inviteUrl };
}

/**
 * Demande à rejoindre une salle avec un code d'invitation
 */
export async function joinFamilyRoom({ inviteInput, memberName }) {
  if (!memberName || !memberName.trim()) throw new Error("Votre prénom est obligatoire.");
  const parsed = parseInviteToken(inviteInput);
  if (!parsed) throw new Error("Code ou lien d'invitation invalide.");

  const { roomId, inviteId } = parsed;
  const user = await ensureAuth();
  const uid = user.uid;

  // 1. Vérification de l'invitation
  const inviteRef = doc(db, 'rooms', roomId, 'invites', inviteId);
  const inviteSnap = await getDoc(inviteRef);

  if (!inviteSnap.exists()) {
    throw new Error("Cette invitation n'existe pas ou a été supprimée.");
  }

  const inviteData = inviteSnap.data();
  if (!inviteData.active) {
    throw new Error("Cette invitation a été désactivée par le propriétaire.");
  }

  if (inviteData.expiresAt && inviteData.expiresAt.toDate() <= new Date()) {
    throw new Error("Cette invitation a expiré (délai dépassé). Demandez un nouveau lien au propriétaire.");
  }

  if (typeof inviteData.uses === 'number' && typeof inviteData.maxUses === 'number') {
    if (inviteData.uses >= inviteData.maxUses) {
      throw new Error("Cette invitation a atteint son nombre maximal d'utilisations.");
    }
  }

  // 2. Incrémenter le compteur d'utilisation (+1) selon les règles de sécurité
  await updateDoc(inviteRef, {
    uses: (inviteData.uses || 0) + 1
  });

  // 3. Créer le document membre en statut 'pending'
  const memberRef = doc(db, 'rooms', roomId, 'members', uid);
  await setDoc(memberRef, {
    name: memberName.trim(),
    role: 'member',
    status: 'pending',
    joinedAt: serverTimestamp(),
    lastSeenAt: serverTimestamp()
  });

  let roomName = 'Salle Familiale';
  try {
    const roomSnap = await getDoc(doc(db, 'rooms', roomId));
    if (roomSnap.exists()) {
      roomName = roomSnap.data().name || roomName;
    }
  } catch (e) {}

  const roomProfile = {
    roomId,
    roomName,
    myName: memberName.trim(),
    myUid: uid,
    role: 'member',
    status: 'pending'
  };
  saveStoredRoomProfile(roomProfile);

  setupMemberStatusListener(roomId, uid);

  return { roomId, roomName, profile: roomProfile };
}

/**
 * Écoute en temps réel l'évolution du statut du membre
 */
export function setupMemberStatusListener(roomId, uid, onApprovedCallback) {
  if (activeMemberStatusUnsubscribe) {
    activeMemberStatusUnsubscribe();
    activeMemberStatusUnsubscribe = null;
  }

  const memberRef = doc(db, 'rooms', roomId, 'members', uid);
  activeMemberStatusUnsubscribe = onSnapshot(memberRef, (snap) => {
    if (!snap.exists()) {
      // Rejeté ou supprimé par le propriétaire (Item 11)
      const current = getStoredRoomProfile();
      if (current) {
        saveStoredRoomProfile(null);
        stopRoomSynchronization();
        if (window.showToast) {
          window.showToast("Vous avez été retiré de la salle familiale par le propriétaire.", "warning", 6000);
        }
        hidePendingApprovalModal();
        if (window.renderApp) window.renderApp();
        renderSettingsRoomSection();
      }
      return;
    }

    const data = snap.data();
    if (data.status === 'approved') {
      const current = getStoredRoomProfile() || {};
      const wasPending = current.status === 'pending';
      current.status = 'approved';
      current.role = data.role || current.role || 'member';
      current.myName = data.name || current.myName;
      saveStoredRoomProfile(current);

      hidePendingApprovalModal();

      if (wasPending && window.showToast) {
        window.showToast("🎉 Votre accès a été validé par le propriétaire ! Bienvenue dans la salle.", "success", 5000);
      }

      // Lancer la synchronisation temps réel
      startRoomSynchronization(roomId);

      if (typeof onApprovedCallback === 'function') {
        onApprovedCallback(data);
      }
    } else {
      showPendingApprovalModal(current ? current.roomName : 'Salle Familiale', data.name);
    }
  }, (err) => {
    console.warn("Écoute du statut membre Firestore:", err);
  });
}

/** Approuve un membre en attente (Propriétaire) */
export async function approveMember(roomId, memberUid) {
  const memberRef = doc(db, 'rooms', roomId, 'members', memberUid);
  await updateDoc(memberRef, {
    status: 'approved',
    lastSeenAt: serverTimestamp()
  });
  if (window.showToast) window.showToast("Membre approuvé avec succès !", "success");
}

/** Refuse un membre en attente (Propriétaire) */
export async function rejectMember(roomId, memberUid) {
  const memberRef = doc(db, 'rooms', roomId, 'members', memberUid);
  await deleteDoc(memberRef);
  if (window.showToast) window.showToast("Demande d'accès refusée.", "info");
}

/**
 * Supprime un membre approuvé de la salle (Point 11 : réservé au propriétaire)
 */
export async function removeMember(roomId, memberUid) {
  const profile = getStoredRoomProfile();
  if (!profile || profile.role !== 'owner') {
    throw new Error("Seul le propriétaire peut retirer un membre de la salle.");
  }
  const memberRef = doc(db, 'rooms', roomId, 'members', memberUid);
  await deleteDoc(memberRef);

  // Journaliser l'activité
  await addRoomActivity(roomId, `${profile.myName} a retiré un membre de la salle.`);
  if (window.showToast) window.showToast("Membre retiré de la salle familiale.", "info");
}

/** Quitter la salle partagée */
export async function leaveRoom() {
  stopRoomSynchronization();
  if (activeMemberStatusUnsubscribe) {
    activeMemberStatusUnsubscribe();
    activeMemberStatusUnsubscribe = null;
  }
  saveStoredRoomProfile(null);
  if (window.showToast) window.showToast("Vous avez quitté la salle familiale.", "info");
  if (window.renderApp) window.renderApp();
  renderSettingsRoomSection();
  updateSyncIndicatorBadge('offline', 'Mode solo local');
}

/**
 * Migration sécurisée des véhicules et relevés locaux vers la salle Firestore
 */
export async function migrateLocalDataToRoom(roomId, ownerUid, ownerName) {
  if (!window.appState || !window.appState.vehicles) return;

  try {
    const backupKey = `carnet_backup_pre_migration_${Date.now()}`;
    localStorage.setItem(backupKey, JSON.stringify(window.appState));
    console.log(`Sauvegarde de pré-migration créée sous ${backupKey}`);

    const batch = writeBatch(db);
    let opCount = 0;

    for (const v of window.appState.vehicles) {
      if (v.isDemo) continue;

      const vRef = doc(db, 'rooms', roomId, 'vehicles', v.id);
      batch.set(vRef, {
        name: v.name || `${v.brand} ${v.model}`,
        brand: v.brand || '',
        model: v.model || '',
        year: Number(v.year) || new Date().getFullYear(),
        plate: v.plate || '',
        currentKm: Number(v.currentKm) || 0,
        updateFrequency: v.updateFrequency || 'weekly',
        isDemo: false,
        updatedAt: serverTimestamp(),
        updatedBy: ownerUid
      });
      opCount++;

      // Relevés kilométriques
      if (Array.isArray(v.kmLog)) {
        v.kmLog.forEach((log, idx) => {
          const logId = `kmlog_${v.id}_${idx}_${Date.now()}`;
          const logRef = doc(db, 'rooms', roomId, 'kmLogs', logId);
          batch.set(logRef, {
            vehicleId: v.id,
            date: log.date || new Date().toISOString().split('T')[0],
            km: Number(log.km) || 0,
            predictedKm: (log.predictedKm !== null && log.predictedKm !== undefined && !isNaN(Number(log.predictedKm))) ? Number(log.predictedKm) : null,
            authorUid: ownerUid,
            authorName: ownerName,
            createdAt: serverTimestamp()
          });
          opCount++;
        });
      }

      // Éléments d'entretien
      if (Array.isArray(v.maintenanceItems)) {
        v.maintenanceItems.forEach((item) => {
          const itemRef = doc(db, 'rooms', roomId, 'items', item.id);
          const safeLastDate = (item.lastDate && String(item.lastDate).trim() !== '') ? item.lastDate : null;
          const safeLastKm = (item.lastKm !== null && item.lastKm !== undefined && item.lastKm !== '' && !isNaN(Number(item.lastKm))) ? Number(item.lastKm) : null;

          batch.set(itemRef, {
            vehicleId: v.id,
            name: item.name,
            intervalKm: (item.intervalKm && Number(item.intervalKm) > 0) ? Number(item.intervalKm) : null,
            intervalMonths: Number(item.intervalMonths) || 0,
            lastDate: safeLastDate,
            lastKm: safeLastKm,
            updatedAt: serverTimestamp(),
            updatedBy: ownerUid,
            deleted: false
          });
          opCount++;
        });
      }
    }

    // Historique des opérations
    if (Array.isArray(window.appState.history)) {
      window.appState.history.forEach((h) => {
        if (h.isDemo) return;
        const histRef = doc(db, 'rooms', roomId, 'history', h.id);
        batch.set(histRef, {
          vehicleId: h.vehicleId,
          type: h.type || 'Entretien',
          date: h.date || new Date().toISOString().split('T')[0],
          km: Number(h.km) || 0,
          cost: (h.cost !== null && h.cost !== undefined && h.cost !== '' && !isNaN(Number(h.cost))) ? Number(h.cost) : null,
          garage: h.garage || '',
          notes: h.notes || '',
          authorUid: ownerUid,
          authorName: ownerName,
          createdAt: serverTimestamp()
        });
        opCount++;
      });
    }

    // Entrée d'activité
    const actId = `act_${Date.now()}`;
    const actRef = doc(db, 'rooms', roomId, 'activity', actId);
    batch.set(actRef, {
      text: `${ownerName} a créé la salle et importé les véhicules`,
      authorUid: ownerUid,
      authorName: ownerName,
      createdAt: serverTimestamp()
    });
    opCount++;

    if (opCount > 0) {
      await batch.commit();
      console.log(`Migration réussie : ${opCount} enregistrements synchronisés.`);
    }
  } catch (err) {
    console.error("Erreur lors de la migration des données vers Firestore:", err);
    if (window.showToast) {
      window.showToast("Note: certaines données n'ont pas pu être migrées immédiatement.", "warning");
    }
  }
}

// ============================================================================
// SYNCHRONISATION TEMPS RÉEL FIRESTORE (ÉCRITURE & LECTURE MULTI-APPAREILS)
// ============================================================================

/**
 * Démarre l'écoute en direct de toutes les sous-collections de la salle
 */
export function startRoomSynchronization(roomId) {
  stopRoomSynchronization();

  updateSyncIndicatorBadge('online', 'En ligne (Synchronisé)');

  // 1. Véhicules
  const unsubVehicles = onSnapshot(collection(db, 'rooms', roomId, 'vehicles'), (snap) => {
    roomVehiclesMap.clear();
    snap.forEach(d => roomVehiclesMap.set(d.id, { id: d.id, ...d.data() }));
    assembleRoomState();
    checkPendingWrites(snap);
  }, onSyncError);
  roomDataUnsubscribers.push(unsubVehicles);

  // 2. Relevés kilométriques
  const unsubKmLogs = onSnapshot(collection(db, 'rooms', roomId, 'kmLogs'), (snap) => {
    roomKmLogsMap.clear();
    snap.forEach(d => roomKmLogsMap.set(d.id, { id: d.id, ...d.data() }));
    assembleRoomState();
    checkPendingWrites(snap);
  }, onSyncError);
  roomDataUnsubscribers.push(unsubKmLogs);

  // 3. Éléments d'entretien
  const unsubItems = onSnapshot(collection(db, 'rooms', roomId, 'items'), (snap) => {
    roomItemsMap.clear();
    snap.forEach(d => {
      const data = d.data();
      if (!data.deleted) {
        roomItemsMap.set(d.id, { id: d.id, ...data });
      }
    });
    assembleRoomState();
    checkPendingWrites(snap);
  }, onSyncError);
  roomDataUnsubscribers.push(unsubItems);

  // 4. Historique
  const unsubHistory = onSnapshot(collection(db, 'rooms', roomId, 'history'), (snap) => {
    roomHistoryMap.clear();
    snap.forEach(d => roomHistoryMap.set(d.id, { id: d.id, ...d.data() }));
    assembleRoomState();
    checkPendingWrites(snap);
  }, onSyncError);
  roomDataUnsubscribers.push(unsubHistory);

  // 5. Fil d'activité (dernières 50 entrées)
  const qAct = query(collection(db, 'rooms', roomId, 'activity'), orderBy('createdAt', 'desc'), limit(50));
  const unsubActivity = onSnapshot(qAct, (snap) => {
    roomActivityList = [];
    snap.forEach(d => roomActivityList.push({ id: d.id, ...d.data() }));
    renderActivityFeed(roomActivityList);
    checkPendingWrites(snap);
  }, onSyncError);
  roomDataUnsubscribers.push(unsubActivity);

  // 6. Membres (pour l'onglet Paramètres et bannière propriétaire)
  const unsubMembers = onSnapshot(collection(db, 'rooms', roomId, 'members'), (snap) => {
    roomMembersList = [];
    const pendingList = [];
    snap.forEach(d => {
      const mem = { uid: d.id, ...d.data() };
      roomMembersList.push(mem);
      if (mem.status === 'pending') pendingList.push(mem);
    });

    const profile = getStoredRoomProfile();
    if (profile && profile.role === 'owner') {
      renderOwnerPendingBanner(pendingList, roomId);
    }
    renderSettingsRoomSection();
    checkPendingWrites(snap);
  }, onSyncError);
  roomDataUnsubscribers.push(unsubMembers);
}

/** Arrête tous les écouteurs de synchronisation */
export function stopRoomSynchronization() {
  roomDataUnsubscribers.forEach(unsub => {
    try { unsub(); } catch (e) {}
  });
  roomDataUnsubscribers = [];
}

function onSyncError(err) {
  console.warn("Événement de synchronisation Firestore:", err);
  updateSyncIndicatorBadge('orange', 'Synchronisation en attente');
}

function checkPendingWrites(snap) {
  if (snap.metadata && snap.metadata.hasPendingWrites) {
    updateSyncIndicatorBadge('orange', 'Synchronisation en attente');
  } else if (!navigator.onLine) {
    updateSyncIndicatorBadge('gray', 'Hors-ligne (Cache local)');
  } else {
    updateSyncIndicatorBadge('online', 'En ligne (Synchronisé)');
  }
}

/**
 * Assemble les données Firestore dans window.appState pour alimenter l'interface existante
 */
export function assembleRoomState() {
  if (!window.appState) return;

  const profile = getStoredRoomProfile();
  if (!profile || profile.status !== 'approved') return;

  const assembledVehicles = Array.from(roomVehiclesMap.values()).map(v => {
    // Relevés kilométriques du véhicule triés par date croissante
    const logs = Array.from(roomKmLogsMap.values())
      .filter(l => l.vehicleId === v.id)
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (Number(a.km) - Number(b.km)));

    // Éléments d'entretien du véhicule
    const items = Array.from(roomItemsMap.values())
      .filter(it => it.vehicleId === v.id);

    return {
      id: v.id,
      name: v.name || `${v.brand} ${v.model}`,
      brand: v.brand || '',
      model: v.model || '',
      year: Number(v.year) || new Date().getFullYear(),
      plate: v.plate || '',
      currentKm: Number(v.currentKm) || 0,
      updateFrequency: v.updateFrequency || 'weekly',
      isDemo: Boolean(v.isDemo),
      kmLog: logs,
      maintenanceItems: items
    };
  });

  const assembledHistory = Array.from(roomHistoryMap.values())
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  window.appState.vehicles = assembledVehicles;
  window.appState.history = assembledHistory;

  if (assembledVehicles.length > 0) {
    if (!window.appState.activeVehicleId || !assembledVehicles.some(v => v.id === window.appState.activeVehicleId)) {
      window.appState.activeVehicleId = assembledVehicles[0].id;
    }
  }

  // Mettre à jour l'affichage
  if (window.renderApp) {
    window.renderApp();
  }
}

/** Enregistre un relevé kilométrique dans la salle partagée avec auteur */
export async function recordKmReading(vehicleId, km, date, predictedKm) {
  const profile = getStoredRoomProfile();
  if (!profile || profile.status !== 'approved') return;

  const user = await ensureAuth();
  const logId = `kmlog_${vehicleId}_${Date.now()}`;
  const logRef = doc(db, 'rooms', profile.roomId, 'kmLogs', logId);

  // 1. Écriture append-only du log avec nom d'auteur (Point 10)
  await setDoc(logRef, {
    vehicleId,
    date,
    km: Number(km),
    predictedKm: (predictedKm !== null && predictedKm !== undefined && !isNaN(Number(predictedKm))) ? Number(predictedKm) : null,
    authorUid: user.uid,
    authorName: profile.myName,
    createdAt: serverTimestamp()
  });

  // 2. Mise à jour de l'odomètre sur le véhicule
  const vRef = doc(db, 'rooms', profile.roomId, 'vehicles', vehicleId);
  await updateDoc(vRef, {
    currentKm: Number(km),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid
  });

  // 3. Ajout au fil d'activité
  await addRoomActivity(profile.roomId, `${profile.myName} a relevé le compteur à ${km.toLocaleString('fr-FR')} km`);
  pingRoomActivity(profile.roomId);
}

/** Enregistre une intervention d'historique dans la salle partagée avec auteur */
export async function recordHistoryEntry(record, updatedItem) {
  const profile = getStoredRoomProfile();
  if (!profile || profile.status !== 'approved') return;

  const user = await ensureAuth();
  const batch = writeBatch(db);

  // 1. Historique avec attribution d'auteur (Point 10)
  const histRef = doc(db, 'rooms', profile.roomId, 'history', record.id);
  batch.set(histRef, {
    vehicleId: record.vehicleId,
    type: record.type,
    date: record.date,
    km: Number(record.km),
    cost: (record.cost !== null && record.cost !== undefined && !isNaN(Number(record.cost))) ? Number(record.cost) : null,
    garage: record.garage || '',
    notes: record.notes || '',
    authorUid: user.uid,
    authorName: profile.myName,
    createdAt: serverTimestamp()
  });

  // 2. Mise à jour de l'élément d'entretien
  if (updatedItem && updatedItem.id) {
    const itemRef = doc(db, 'rooms', profile.roomId, 'items', updatedItem.id);
    batch.update(itemRef, {
      lastDate: updatedItem.lastDate || null,
      lastKm: (updatedItem.lastKm !== null && updatedItem.lastKm !== undefined && !isNaN(Number(updatedItem.lastKm))) ? Number(updatedItem.lastKm) : null,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid
    });
  }

  // 3. Mise à jour de l'odomètre du véhicule si supérieur
  if (record.km && record.vehicleId) {
    const veh = roomVehiclesMap.get(record.vehicleId);
    if (veh && record.km > (veh.currentKm || 0)) {
      const vRef = doc(db, 'rooms', profile.roomId, 'vehicles', record.vehicleId);
      batch.update(vRef, {
        currentKm: Number(record.km),
        updatedAt: serverTimestamp(),
        updatedBy: user.uid
      });
    }
  }

  await batch.commit();

  // 4. Fil d'activité
  const costTxt = record.cost ? ` (${Number(record.cost).toLocaleString('fr-FR')} DA)` : '';
  await addRoomActivity(profile.roomId, `${profile.myName} a effectué : ${record.type}${costTxt}`);
  pingRoomActivity(profile.roomId);
}

/** Sauvegarde ou modifie un véhicule dans la salle */
export async function saveVehicle(veh) {
  const profile = getStoredRoomProfile();
  if (!profile || profile.status !== 'approved') return;
  const user = await ensureAuth();

  const vRef = doc(db, 'rooms', profile.roomId, 'vehicles', veh.id);
  await setDoc(vRef, {
    name: veh.name,
    brand: veh.brand,
    model: veh.model,
    year: Number(veh.year) || new Date().getFullYear(),
    plate: veh.plate || '',
    currentKm: Number(veh.currentKm) || 0,
    updateFrequency: veh.updateFrequency || 'weekly',
    isDemo: false,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid
  });

  await addRoomActivity(profile.roomId, `${profile.myName} a mis à jour le véhicule ${veh.name}`);
  pingRoomActivity(profile.roomId);
}

/** Supprime un véhicule de la salle */
export async function deleteVehicle(vehicleId) {
  const profile = getStoredRoomProfile();
  if (!profile || profile.status !== 'approved') return;

  const vRef = doc(db, 'rooms', profile.roomId, 'vehicles', vehicleId);
  await deleteDoc(vRef);

  await addRoomActivity(profile.roomId, `${profile.myName} a supprimé un véhicule.`);
  pingRoomActivity(profile.roomId);
}

/** Ajoute ou met à jour un élément d'entretien */
export async function saveMaintenanceItem(item) {
  const profile = getStoredRoomProfile();
  if (!profile || profile.status !== 'approved') return;
  const user = await ensureAuth();

  const itemRef = doc(db, 'rooms', profile.roomId, 'items', item.id);
  await setDoc(itemRef, {
    vehicleId: item.vehicleId,
    name: item.name,
    intervalKm: (item.intervalKm && Number(item.intervalKm) > 0) ? Number(item.intervalKm) : null,
    intervalMonths: Number(item.intervalMonths) || 0,
    lastDate: item.lastDate || null,
    lastKm: (item.lastKm !== null && item.lastKm !== undefined && !isNaN(Number(item.lastKm))) ? Number(item.lastKm) : null,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
    deleted: false
  });

  await addRoomActivity(profile.roomId, `${profile.myName} a configuré l'entretien "${item.name}"`);
  pingRoomActivity(profile.roomId);
}

/** Supprime un élément d'entretien (soft delete) */
export async function deleteMaintenanceItem(itemId) {
  const profile = getStoredRoomProfile();
  if (!profile || profile.status !== 'approved') return;
  const user = await ensureAuth();

  const itemRef = doc(db, 'rooms', profile.roomId, 'items', itemId);
  await updateDoc(itemRef, {
    deleted: true,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid
  });

  await addRoomActivity(profile.roomId, `${profile.myName} a supprimé un élément d'entretien.`);
  pingRoomActivity(profile.roomId);
}

/** Supprime une entrée d'historique */
export async function deleteHistoryEntry(historyId) {
  const profile = getStoredRoomProfile();
  if (!profile || profile.status !== 'approved') return;

  const histRef = doc(db, 'rooms', profile.roomId, 'history', historyId);
  await deleteDoc(histRef);
  pingRoomActivity(profile.roomId);
}

/**
 * Supprime TOUTES les données de la salle (véhicules, relevés, entretiens, historique, activité)
 * Réservé à l'administrateur (propriétaire) de la salle.
 */
export async function clearAllRoomData(roomId) {
  const profile = getStoredRoomProfile();
  if (!profile || profile.role !== 'owner') {
    throw new Error("Seul l'administrateur (propriétaire) peut supprimer toutes les données de la salle.");
  }

  const user = await ensureAuth();
  if (!user) {
    throw new Error("Vous n'êtes pas connecté à Firebase.");
  }

  // 1. Vérifier la propriété de la salle dans Firestore
  try {
    const roomSnap = await getDoc(doc(db, 'rooms', roomId));
    if (roomSnap.exists()) {
      const roomData = roomSnap.data();
      if (roomData.ownerUid && roomData.ownerUid !== user.uid) {
        throw new Error(`Droits insuffisants : Votre session actuelle (${user.uid.substring(0, 6)}...) ne correspond pas au créateur de la salle (${roomData.ownerUid.substring(0, 6)}...).`);
      }
    }
  } catch (checkErr) {
    if (checkErr.message && checkErr.message.includes('Droits insuffisants')) {
      throw checkErr;
    }
    console.warn("Note vérification propriétaire:", checkErr);
  }

  // 2. Supprimer les sous-collections métier (véhicules, relevés, entretiens, historique)
  const subcollections = ['vehicles', 'kmLogs', 'items', 'history'];
  let deletedCount = 0;

  for (const sub of subcollections) {
    try {
      const snap = await getDocs(collection(db, 'rooms', roomId, sub));
      if (!snap.empty) {
        const batch = writeBatch(db);
        snap.forEach((d) => {
          batch.delete(d.ref);
          deletedCount++;
        });
        await batch.commit();
      }
    } catch (e) {
      console.warn(`Erreur lors de la suppression de la sous-collection ${sub}:`, e);
      throw new Error(`Erreur lors de la suppression de ${sub}: ${e.message}`);
    }
  }

  // 3. Nettoyage de l'activité (isolé pour ne pas bloquer si les règles en ligne interdisent la suppression d'activités)
  try {
    const actSnap = await getDocs(collection(db, 'rooms', roomId, 'activity'));
    if (!actSnap.empty) {
      const actBatch = writeBatch(db);
      actSnap.forEach((d) => actBatch.delete(d.ref));
      await actBatch.commit();
    }
  } catch (actErr) {
    console.warn("Note: Les anciennes activités n'ont pas pu être supprimées (règles append-only actives):", actErr);
  }

  // 4. Ajouter une entrée d'activité annonçant la réinitialisation
  try {
    await addRoomActivity(roomId, `${profile.myName} (Admin) a effacé toutes les données de la salle`);
  } catch (e) {
    console.warn("Échec d'ajout au fil d'activité après réinitialisation:", e);
  }

  // 5. Vider les caches mémoire locaux
  roomVehiclesMap.clear();
  roomKmLogsMap.clear();
  roomItemsMap.clear();
  roomHistoryMap.clear();
  roomActivityList = [];

  if (window.appState) {
    window.appState.vehicles = [];
    window.appState.history = [];
    window.appState.activeVehicleId = null;
  }
  if (typeof window.saveState === 'function') window.saveState();
  if (typeof window.renderApp === 'function') window.renderApp();

  if (window.showToast) {
    window.showToast("Toutes les données de la salle ont été effacées avec succès.", "success", 5000);
  }

  return { deletedCount };
}

/**
 * Supprime DÉFINITIVEMENT la salle entière, tous ses membres, invitations et toutes ses données.
 * Réservé à l'administrateur (propriétaire) de la salle.
 */
export async function deleteEntireRoom(roomId) {
  const profile = getStoredRoomProfile();
  if (!profile || profile.role !== 'owner') {
    throw new Error("Seul l'administrateur (propriétaire) peut supprimer définitivement la salle.");
  }

  const user = await ensureAuth();
  if (!user) {
    throw new Error("Vous n'êtes pas connecté à Firebase.");
  }

  // 1. Vérifier la propriété de la salle
  try {
    const roomSnap = await getDoc(doc(db, 'rooms', roomId));
    if (roomSnap.exists()) {
      const roomData = roomSnap.data();
      if (roomData.ownerUid && roomData.ownerUid !== user.uid) {
        throw new Error(`Droits insuffisants : Votre session actuelle (${user.uid.substring(0, 6)}...) ne correspond pas au créateur de la salle (${roomData.ownerUid.substring(0, 6)}...).`);
      }
    }
  } catch (checkErr) {
    if (checkErr.message && checkErr.message.includes('Droits insuffisants')) {
      throw checkErr;
    }
    console.warn("Note vérification propriétaire:", checkErr);
  }

  // 2. Supprimer d'abord les sous-collections de données
  const dataSubs = ['vehicles', 'kmLogs', 'items', 'history', 'invites'];
  for (const sub of dataSubs) {
    try {
      const snap = await getDocs(collection(db, 'rooms', roomId, sub));
      if (!snap.empty) {
        const batch = writeBatch(db);
        snap.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (e) {
      console.warn(`Erreur lors de la suppression de ${sub}:`, e);
    }
  }

  // 3. Supprimer les activités (isolé pour ne pas faire échouer la suppression globale)
  try {
    const actSnap = await getDocs(collection(db, 'rooms', roomId, 'activity'));
    if (!actSnap.empty) {
      const actBatch = writeBatch(db);
      actSnap.forEach((d) => actBatch.delete(d.ref));
      await actBatch.commit();
    }
  } catch (e) {
    console.warn("Note: Activités non supprimées:", e);
  }

  // 4. Supprimer les membres
  try {
    const memSnap = await getDocs(collection(db, 'rooms', roomId, 'members'));
    if (!memSnap.empty) {
      const batch = writeBatch(db);
      memSnap.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (e) {
    console.warn("Erreur suppression membres:", e);
  }

  // 5. Supprimer le document de la salle EN DERNIER
  try {
    const roomRef = doc(db, 'rooms', roomId);
    await deleteDoc(roomRef);
  } catch (err) {
    console.warn("Erreur suppression document salle:", err);
    throw new Error("Erreur suppression de la salle: " + err.message);
  }

  // 6. Nettoyage local et arrêt de la synchronisation
  stopRoomSynchronization();
  if (activeMemberStatusUnsubscribe) {
    activeMemberStatusUnsubscribe();
    activeMemberStatusUnsubscribe = null;
  }
  saveStoredRoomProfile(null);

  if (window.appState) {
    window.appState.vehicles = [];
    window.appState.history = [];
    window.appState.activeVehicleId = null;
  }
  if (typeof window.saveState === 'function') window.saveState();
  if (typeof window.renderApp === 'function') window.renderApp();
  renderSettingsRoomSection();
  updateSyncIndicatorBadge('offline', 'Mode solo local');

  if (window.showToast) {
    window.showToast("La salle familiale et toutes ses données ont été supprimées définitivement.", "info", 5000);
  }
}

/** Ajoute une entrée dans le fil d'activité */
export async function addRoomActivity(roomId, text) {
  try {
    const profile = getStoredRoomProfile();
    const user = await ensureAuth();
    const actId = `act_${Date.now()}`;
    const actRef = doc(db, 'rooms', roomId, 'activity', actId);
    await setDoc(actRef, {
      text,
      authorUid: user.uid,
      authorName: profile ? profile.myName : 'Membre',
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.warn("Échec d'ajout au fil d'activité:", err);
  }
}

// ============================================================================
// ÉLÉMENTS D'INTERFACE UTILISATEUR, FIL D'ACTIVITÉ & MODALES
// ============================================================================

/** Formate une date relative (il y a 2 h, hier...) */
export function formatTimeAgo(timestamp) {
  if (!timestamp) return 'récemment';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 60) return "à l'instant";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `il y a ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "hier";
  if (diffDays < 7) return `il y a ${diffDays} jours`;
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

/** Affiche le fil d'activité dans le tableau de bord */
export function renderActivityFeed(activities) {
  const section = document.getElementById('activityFeedSection');
  const container = document.getElementById('activityFeedList');
  const badge = document.getElementById('activityCountBadge');
  if (!section || !container) return;

  if (!isRoomActive()) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  if (!activities || activities.length === 0) {
    if (badge) badge.textContent = '0 action';
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 12px; font-size: 0.85rem;">Aucune activité récente.</div>';
    return;
  }

  if (badge) badge.textContent = `${activities.length} action${activities.length > 1 ? 's' : ''}`;

  container.innerHTML = activities.map(act => `
    <div class="activity-feed-item">
      <span class="activity-feed-icon">📢</span>
      <div class="activity-feed-content">
        <span class="activity-feed-text">${escapeHtml(act.text)}</span>
        <span class="activity-feed-time">${formatTimeAgo(act.createdAt)}</span>
      </div>
    </div>
  `).join('');
}

/** Met à jour la pastille de synchronisation dans l'en-tête */
export function updateSyncIndicatorBadge(status, label) {
  const badge = document.getElementById('roomSyncBadge');
  const text = document.getElementById('roomSyncText');
  if (!badge || !text) return;

  if (!isRoomActive()) {
    badge.classList.add('hidden');
    return;
  }

  badge.classList.remove('hidden');
  const dot = badge.querySelector('.sync-dot');

  if (dot) {
    dot.className = 'sync-dot';
    if (status === 'online') dot.classList.add('sync-green');
    else if (status === 'orange') dot.classList.add('sync-orange');
    else dot.classList.add('sync-gray');
  }

  text.textContent = label;
}

export function showPendingApprovalModal(roomName, memberName) {
  const modal = document.getElementById('modalPendingApproval');
  if (!modal) return;
  const rn = document.getElementById('pendingRoomName');
  const mn = document.getElementById('pendingMemberName');
  if (rn) rn.textContent = roomName || 'Salle Familiale';
  if (mn) mn.textContent = memberName || 'Membre';
  modal.classList.remove('hidden');
}

export function hidePendingApprovalModal() {
  const modal = document.getElementById('modalPendingApproval');
  if (modal) modal.classList.add('hidden');
}

export function showShareInviteModal({ inviteUrl, inviteCode, roomName }) {
  const modal = document.getElementById('modalShareInvite');
  if (!modal) return;
  const urlInp = document.getElementById('shareInviteUrl');
  const codeInp = document.getElementById('shareInviteCode');
  const titleEl = document.getElementById('shareInviteRoomTitle');
  if (urlInp) urlInp.value = inviteUrl;
  if (codeInp) codeInp.value = inviteCode;
  if (titleEl && roomName) titleEl.textContent = roomName;
  modal.classList.remove('hidden');
}

export function hideShareInviteModal() {
  const modal = document.getElementById('modalShareInvite');
  if (modal) modal.classList.add('hidden');
}

export function renderOwnerPendingBanner(pendingList, roomId) {
  let banner = document.getElementById('ownerPendingBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'ownerPendingBanner';
    banner.className = 'owner-pending-banner';
    const main = document.querySelector('main') || document.body;
    main.prepend(banner);
  }

  if (!pendingList || pendingList.length === 0) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }

  banner.classList.remove('hidden');
  banner.innerHTML = `
    <div class="pending-banner-content">
      <div class="pending-banner-text">
        <span class="pending-badge">🔔 ${pendingList.length} en attente</span>
        <span>Demande(s) d'accès à valider pour votre salle :</span>
      </div>
      <div class="pending-banner-list">
        ${pendingList.map(m => `
          <div class="pending-user-card" data-uid="${m.uid}">
            <span class="pending-user-name">👤 <strong>${escapeHtml(m.name)}</strong></span>
            <div class="pending-user-actions">
              <button type="button" class="btn-approve btn-xs" data-uid="${m.uid}">Accepter</button>
              <button type="button" class="btn-reject btn-xs" data-uid="${m.uid}">Refuser</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  banner.querySelectorAll('.btn-approve').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await approveMember(roomId, btn.dataset.uid);
      } catch (e) {
        console.error(e);
        if (window.showToast) window.showToast("Erreur approbation: " + e.message, "error");
      }
    };
  });

  banner.querySelectorAll('.btn-reject').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await rejectMember(roomId, btn.dataset.uid);
      } catch (e) {
        console.error(e);
        if (window.showToast) window.showToast("Erreur refus: " + e.message, "error");
      }
    };
  });
}

/** Met à jour la section Salle Familiale dans l'onglet Paramètres (avec gestion et suppression des membres, Point 11) */
export function renderSettingsRoomSection() {
  const container = document.getElementById('settingsRoomContainer');
  if (!container) return;

  const profile = getStoredRoomProfile();

  if (!profile) {
    container.innerHTML = `
      <div class="card" style="margin-top: 15px;">
        <div class="card-header">
          <div class="card-icon">🏠</div>
          <div>
            <h3 class="card-title">Salle Familiale Partagée</h3>
            <p class="card-subtitle">Partagez l'entretien avec vos proches (père, frères, mère...)</p>
          </div>
        </div>
        <p style="font-size: 0.88rem; color: var(--text-muted); margin-bottom: 15px;">
          Actuellement en <strong>Mode Local Solo</strong>. Créez une salle pour synchroniser vos véhicules en temps réel entre plusieurs téléphones sans mot de passe.
        </p>
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <button type="button" id="btnOpenCreateRoomModal" class="btn-primary" style="flex: 1; min-width: 140px;">
            🏠 Créer une salle
          </button>
          <button type="button" id="btnOpenJoinRoomModal" class="btn-secondary" style="flex: 1; min-width: 140px;">
            🔗 Rejoindre une salle
          </button>
        </div>
      </div>
    `;

    document.getElementById('btnOpenCreateRoomModal')?.addEventListener('click', () => {
      document.getElementById('modalCreateRoom')?.classList.remove('hidden');
    });
    document.getElementById('btnOpenJoinRoomModal')?.addEventListener('click', () => {
      document.getElementById('modalJoinRoom')?.classList.remove('hidden');
    });
    return;
  }

  // Utilisateur actuellement dans une salle
  const isOwner = profile.role === 'owner';
  const isPending = profile.status === 'pending';

  container.innerHTML = `
    <div class="card" style="margin-top: 15px; border-left: 4px solid var(--primary);">
      <div class="card-header" style="margin-bottom: 10px;">
        <div class="card-icon">🏠</div>
        <div>
          <h3 class="card-title">${escapeHtml(profile.roomName || 'Salle Familiale')}</h3>
          <p class="card-subtitle">Connecté en tant que <strong>${escapeHtml(profile.myName)}</strong> (${isOwner ? '👑 Propriétaire' : (isPending ? '⏳ En attente' : '✅ Membre')})</p>
        </div>
      </div>

      <!-- Liste des membres de la salle -->
      <div style="margin-top: 14px; border-top: 1px solid var(--border-color); padding-top: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <strong style="font-size: 0.88rem; color: var(--text-main);">Membres de la salle (${roomMembersList.length || 1})</strong>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${(roomMembersList.length > 0 ? roomMembersList : [{ uid: profile.myUid, name: profile.myName, role: profile.role, status: profile.status }]).map(m => `
            <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-input); padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
              <div>
                <span style="font-weight: 600; font-size: 0.86rem; color: var(--text-main);">👤 ${escapeHtml(m.name)}</span>
                <span style="font-size: 0.74rem; color: var(--text-muted); margin-left: 6px;">
                  ${m.role === 'owner' ? '👑 Propriétaire' : (m.status === 'pending' ? '⏳ En attente' : '✅ Membre')}
                </span>
              </div>
              ${(isOwner && m.uid !== profile.myUid) ? `
                <button type="button" class="btn-reject btn-xs btn-remove-member" data-uid="${m.uid}" data-name="${escapeHtml(m.name)}">
                  Retirer
                </button>
              ` : ''}
            </div>
          `).join('')}
        </div>
      </div>

      <div style="display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap;">
        ${isOwner ? `
          <button type="button" id="btnCreateNewInvite" class="btn-primary" style="flex: 1; min-width: 150px;">
            📲 Inviter un membre
          </button>
        ` : ''}
        <button type="button" id="btnLeaveRoom" class="btn-secondary" style="flex: 1; min-width: 120px;">
          🚪 Quitter la salle
        </button>
      </div>

      ${isOwner ? `
        <!-- Zone Administrateur (Suppression de données & Dissolution) -->
        <div style="margin-top: 20px; padding-top: 14px; border-top: 1.5px dashed rgba(239, 68, 68, 0.35);">
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
            <span style="font-size: 1rem;">⚠️</span>
            <strong style="color: var(--danger); font-size: 0.88rem;">Zone Administrateur</strong>
          </div>
          <p style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 12px; line-height: 1.4;">
            En tant que propriétaire, vous avez le contrôle total sur la gestion et la suppression des données partagées.
          </p>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <button type="button" id="btnAdminClearRoomData" class="btn-danger btn-sm" style="flex: 1; min-width: 180px;">
              🗑️ Effacer toutes les données
            </button>
            <button type="button" id="btnAdminDeleteRoom" class="btn-danger btn-sm" style="flex: 1; min-width: 180px; background: #991b1b; border-color: #7f1d1d;">
              💥 Supprimer la salle
            </button>
          </div>
        </div>
      ` : ''}
    </div>
  `;

  // Gestion des retraits de membres (Point 11)
  container.querySelectorAll('.btn-remove-member').forEach(btn => {
    btn.onclick = async () => {
      const uid = btn.dataset.uid;
      const name = btn.dataset.name;
      if (confirm(`Voulez-vous vraiment retirer ${name} de la salle familiale ?`)) {
        btn.disabled = true;
        try {
          await removeMember(profile.roomId, uid);
        } catch (e) {
          if (window.showToast) window.showToast("Erreur: " + e.message, "error");
        }
      }
    };
  });

  document.getElementById('btnCreateNewInvite')?.addEventListener('click', async () => {
    try {
      const res = await createAdditionalInvite(profile.roomId, { expiryHours: 24, maxUses: 5 });
      showShareInviteModal({
        inviteUrl: res.inviteUrl,
        inviteCode: res.inviteCode,
        roomName: profile.roomName
      });
    } catch (err) {
      if (window.showToast) window.showToast("Erreur invitation: " + err.message, "error");
    }
  });

  document.getElementById('btnLeaveRoom')?.addEventListener('click', () => {
    if (confirm("Voulez-vous vraiment quitter cette salle partagée et revenir en mode autonome ?")) {
      leaveRoom();
    }
  });

  // Actions d'administration de la salle
  document.getElementById('btnAdminClearRoomData')?.addEventListener('click', async () => {
    const c1 = window.confirm(
      "⚠️ ATTENTION : Vous êtes sur le point de supprimer TOUS les véhicules, relevés de compteur, entretiens et historiques de cette salle.\n\nCette action effacera les données pour TOUS les membres de la famille.\n\nVoulez-vous continuer ?"
    );
    if (!c1) return;

    const c2 = window.prompt("Pour confirmer l'effacement complet des données de la salle, tapez SUPPRIMER ci-dessous :");
    if (c2 !== "SUPPRIMER") {
      if (window.showToast) window.showToast("Suppression annulée.", "info");
      return;
    }

    try {
      await clearAllRoomData(profile.roomId);
    } catch (err) {
      console.error(err);
      if (window.showToast) window.showToast("Erreur: " + err.message, "error");
    }
  });

  document.getElementById('btnAdminDeleteRoom')?.addEventListener('click', async () => {
    const c1 = window.confirm(
      "⚠️ ATTENTION : Vous êtes sur le point de DISSOUDRE et SUPPRIMER DÉFINITIVEMENT cette salle familiale.\n\nToutes les données du cloud seront effacées et tous les membres retourneront en mode solo.\n\nVoulez-vous continuer ?"
    );
    if (!c1) return;

    const c2 = window.prompt("Pour confirmer la suppression définitive de la salle, tapez DISSOUDRE ci-dessous :");
    if (c2 !== "DISSOUDRE") {
      if (window.showToast) window.showToast("Suppression annulée.", "info");
      return;
    }

    try {
      await deleteEntireRoom(profile.roomId);
    } catch (err) {
      console.error(err);
      if (window.showToast) window.showToast("Erreur: " + err.message, "error");
    }
  });
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Partage de lien via l'API Web Share ou WhatsApp */
export async function shareInviteLink(inviteUrl, roomName) {
  const shareText = `Rejoins le carnet d'entretien de notre véhicule sur la salle "${roomName || 'Famille'}" ! Clique ici : ${inviteUrl}`;
  if (navigator.share) {
    try {
      await navigator.share({
        title: "Carnet d'Entretien - Salle Familiale",
        text: shareText,
        url: inviteUrl
      });
      return;
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('Partage web annulé ou non disponible:', e);
    }
  }
  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
  window.open(waUrl, '_blank');
}

/** Initialisation de la salle au lancement de la page */
export async function initFamilyRoom() {
  const profile = getStoredRoomProfile();

  // 1. Détection de paramètre de lien #join=
  const hash = window.location.hash || '';
  if (hash.startsWith('#join=')) {
    const rawToken = hash.substring(6);
    const parsed = parseInviteToken(rawToken);
    if (parsed) {
      const modalJoin = document.getElementById('modalJoinRoom');
      const inpCode = document.getElementById('joinInviteCode');
      if (modalJoin && inpCode) {
        inpCode.value = parsed.fullCode;
        modalJoin.classList.remove('hidden');
      }
    }
  }

  // 2. Si une salle est déjà enregistrée sur ce téléphone
  if (profile && profile.roomId && profile.myUid) {
    try {
      await ensureAuth();
    } catch (e) {
      console.warn("Échec ensureAuth dans initFamilyRoom:", e);
    }

    if (profile.status === 'pending') {
      showPendingApprovalModal(profile.roomName, profile.myName);
      setupMemberStatusListener(profile.roomId, profile.myUid);
    } else if (profile.status === 'approved') {
      setupMemberStatusListener(profile.roomId, profile.myUid);
      startRoomSynchronization(profile.roomId);
    }
  }

  renderSettingsRoomSection();

  window.addEventListener('online', () => {
    if (isRoomActive()) updateSyncIndicatorBadge('online', 'En ligne (Synchronisé)');
  });
  window.addEventListener('offline', () => {
    if (isRoomActive()) updateSyncIndicatorBadge('gray', 'Hors-ligne (Cache local)');
  });
}

// Attacher à window pour faciliter l'interopérabilité
window.FamilyRoom = {
  createFamilyRoom,
  joinFamilyRoom,
  createAdditionalInvite,
  approveMember,
  rejectMember,
  removeMember,
  leaveRoom,
  clearAllRoomData,
  deleteEntireRoom,
  shareInviteLink,
  getStoredRoomProfile,
  isRoomActive,
  recordKmReading,
  recordHistoryEntry,
  saveVehicle,
  deleteVehicle,
  saveMaintenanceItem,
  deleteMaintenanceItem,
  deleteHistoryEntry,
  startRoomSynchronization,
  stopRoomSynchronization,
  renderActivityFeed,
  updateSyncIndicatorBadge,
  initFamilyRoom,
  renderSettingsRoomSection
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFamilyRoom);
} else {
  initFamilyRoom();
}
