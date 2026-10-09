// firebase-config.js - Configuration Firebase & Initialisation Firestore
//
// ⚠️ NOTE DE SÉCURITÉ IMPORTANTE :
// La configuration web ci-dessous (apiKey, projectId, appId...) n'est PAS un secret confidentiel.
// Dans l'architecture Firebase, ces identifiants sont publics et permettent uniquement à votre PWA
// de cibler le bon projet Google Cloud.
//
// Ce qui protège réellement vos données et empêche les accès non autorisés, ce sont :
// 1. Les Règles de Sécurité Cloud Firestore (fichier firestore.rules déployé sur vos serveurs).
// 2. L'authentification Firebase (Firebase Anonymous Auth) qui délivre un jeton cryptographique à chaque appareil.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js';
import { 
  getAuth, 
  signInAnonymously,
  onAuthStateChanged 
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js';
import { 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';

// Configuration du projet Firebase
// Remplacez ces valeurs avec celles générées dans la console Firebase (Paramètres du projet > Vos applications > Web)
export const firebaseConfig = {
  apiKey: "AIzaSyA7qjZi_aWunCo15Y96BbvsZfX7n7O8LO8",
  authDomain: "entretien-auto-tracker.firebaseapp.com",
  projectId: "entretien-auto-tracker",
  storageBucket: "entretien-auto-tracker.firebasestorage.app",
  messagingSenderId: "642031831676",
  appId: "1:642031831676:web:fe3be6aa0bdaa602ee17f9"
};

// Vérifie si la configuration est prête
export function isFirebaseConfigured() {
  return firebaseConfig.apiKey && 
         firebaseConfig.apiKey !== "VOTRE_API_KEY" && 
         firebaseConfig.projectId && 
         firebaseConfig.projectId !== "VOTRE_PROJECT_ID";
}

let appInstance = null;
let authInstance = null;
let dbInstance = null;

if (isFirebaseConfigured()) {
  try {
    appInstance = initializeApp(firebaseConfig);
    authInstance = getAuth(appInstance);
    // Persistance hors-ligne avec synchronisation multi-onglets (API recommandée modulaire)
    dbInstance = initializeFirestore(appInstance, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
      })
    });
    console.log("🔥 Firebase initialisé avec persistance hors-ligne multi-onglets.");
  } catch (err) {
    console.error("Erreur lors de l'initialisation de Firebase:", err);
  }
} else {
  console.info("ℹ️ Firebase non configuré : l'application fonctionne actuellement en mode local autonome.");
}

export const app = appInstance;
export const auth = authInstance;
export const db = dbInstance;
export { 
  signInAnonymously, 
  onAuthStateChanged,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  writeBatch
};
