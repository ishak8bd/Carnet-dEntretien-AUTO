/**
 * Carnet d'Entretien - PWA Suivi & Prédiction de Maintenance Automobile
 * Étape 1 : Véhicules + Kilométrage + kmLog + Bannière d'inactivité
 * Plain vanilla JS, stockage localStorage avec schemaVersion.
 */

'use strict';

// ============================================================================
// 1. CONSTANTES & STRUCTURE INITIALE DU MODÈLE
// ============================================================================
const STORAGE_KEY = 'carnet_entretien_data_v1';
const SCHEMA_VERSION = 1;
const MAX_VEHICLES = 3;

// Types d'entretien par défaut (prévus pour l'étape 2)
const DEFAULT_MAINTENANCE_TYPES = [
  { id: 'vidange', name: 'Vidange (moteur)', intervalKm: 10000, intervalMonths: 12 },
  { id: 'filtre_huile', name: 'Filtre à huile', intervalKm: 10000, intervalMonths: 12 },
  { id: 'filtre_air', name: 'Filtre à air', intervalKm: 15000, intervalMonths: 12 },
  { id: 'filtre_carburant', name: 'Filtre à carburant', intervalKm: 30000, intervalMonths: 24 },
  { id: 'filtre_habitacle', name: "Filtre d'habitacle", intervalKm: 15000, intervalMonths: 12 },
  { id: 'bougies', name: 'Bougies', intervalKm: 40000, intervalMonths: 48 },
  { id: 'freins', name: 'Plaquettes de frein', intervalKm: 30000, intervalMonths: 24 },
  { id: 'liquide_refroidissement', name: 'Liquide de refroidissement', intervalKm: 40000, intervalMonths: 24 },
  { id: 'courroie_distribution', name: 'Courroie de distribution', intervalKm: 100000, intervalMonths: 60 },
  { id: 'pneus', name: 'Pneus', intervalKm: null, intervalMonths: 48 },
  { id: 'batterie', name: 'Batterie', intervalKm: null, intervalMonths: 36 },
  { id: 'controle_technique', name: 'Contrôle technique', intervalKm: null, intervalMonths: 12 },
  { id: 'assurance', name: 'Assurance', intervalKm: null, intervalMonths: 12 }
];

// État en mémoire
let appState = {
  schemaVersion: SCHEMA_VERSION,
  vehicles: [],
  activeVehicleId: null,
  history: [],
  settings: {
    defaultIntervals: JSON.parse(JSON.stringify(DEFAULT_MAINTENANCE_TYPES)),
    lastBackupDate: null
  },
  isDemo: false
};

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'appState', {
    get() { return appState; },
    set(val) { appState = val; },
    configurable: true
  });
}

// ============================================================================
// 2. UTILITAIRES (FORMATAGE DATES, DISTANCES & MONNAIE)
// ============================================================================

/** Échappe les caractères HTML réservés pour prévenir les attaques XSS */
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Formate une date ISO (YYYY-MM-DD) en format français DD/MM/YYYY */
function formatDate(dateStr) {
  if (!dateStr) return '--/--/----';
  const parts = dateStr.split('T')[0].split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/** Formate un nombre de kilomètres avec séparateur d'espace : 118 000 km */
function formatKm(km) {
  if (km === null || km === undefined || isNaN(km)) return '0 km';
  const formatted = Math.round(Number(km))
    .toLocaleString('fr-FR')
    .replace(/\u202F/g, ' ');
  return `${formatted} km`;
}

/** Formate un coût en Dinars Algériens : 12 500 DA */
function formatCost(cost) {
  if (cost === null || cost === undefined || isNaN(cost)) return '0 DA';
  const formatted = Math.round(Number(cost))
    .toLocaleString('fr-FR')
    .replace(/\u202F/g, ' ');
  return `${formatted} DA`;
}

/** Retourne la date du jour au format ISO YYYY-MM-DD (en heure locale) */
function getTodayIsoString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Retourne une date ISO située n jours dans le passé */
function getDateMinusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Calcule le nombre de jours entre une date ISO et aujourd'hui */
function getDaysElapsed(dateStr) {
  if (!dateStr) return 0;
  const parts = dateStr.split('-');
  const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  const todayObj = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffTime = todayObj.getTime() - dateObj.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

// ============================================================================
// 2b. PRÉFÉRENCES D'AFFICHAGE UI (TABLEAU GLISSABLE VS FICHES)
// ============================================================================

const UI_PREFERENCES_KEY = 'suivi_entretien_ui_prefs';

function getUiPreferences() {
  try {
    const raw = localStorage.getItem(UI_PREFERENCES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        maintViewMode: parsed.maintViewMode || 'table',
        historyViewMode: parsed.historyViewMode || 'table',
        intervalsViewMode: parsed.intervalsViewMode || 'table'
      };
    }
  } catch (e) {}
  return {
    maintViewMode: 'table',      // 'table' glissable par défaut
    historyViewMode: 'table',    // 'table' glissable par défaut
    intervalsViewMode: 'table'   // 'table' glissable par défaut
  };
}

function saveUiPreference(key, val) {
  const prefs = getUiPreferences();
  prefs[key] = val;
  try {
    localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(prefs));
  } catch (e) {}
}

function updateViewToggleButtons(toggleId, activeMode) {
  const toggle = document.getElementById(toggleId);
  if (!toggle) return;
  toggle.querySelectorAll('.view-toggle-btn').forEach(btn => {
    if (btn.getAttribute('data-mode') === activeMode) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// ============================================================================
// 3. GESTION DU STOCKAGE & MIGRATIONS LOCALSTORAGE
// ============================================================================

/** Sauvegarde l'état complet dans le localStorage avec gestion des erreurs */
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  } catch (err) {
    console.error('Erreur lors de la sauvegarde dans localStorage:', err);
    showToast("Erreur d'enregistrement : stockage local saturé ou désactivé.", 'error');
  }
}

/** Charge l'état depuis le localStorage ou initialise les données */
function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw);
    // Migration éventuelle de schéma
    if (!parsed.schemaVersion || parsed.schemaVersion < SCHEMA_VERSION) {
      parsed.schemaVersion = SCHEMA_VERSION;
    }
    if (!Array.isArray(parsed.history)) {
      parsed.history = [];
    }
    if (!parsed.settings) {
      parsed.settings = {
        defaultIntervals: JSON.parse(JSON.stringify(DEFAULT_MAINTENANCE_TYPES)),
        lastBackupDate: null
      };
    } else if (!parsed.settings.defaultIntervals) {
      parsed.settings.defaultIntervals = JSON.parse(JSON.stringify(DEFAULT_MAINTENANCE_TYPES));
    }

    // Si un seul véhicule, s'assurer que les historiques pointent bien vers son id
    if (parsed.vehicles && parsed.vehicles.length === 1 && parsed.history && parsed.history.length > 0) {
      const singleVehId = parsed.vehicles[0].id;
      parsed.history.forEach(h => {
        if (!parsed.vehicles.some(v => v.id === h.vehicleId)) {
          h.vehicleId = singleVehId;
        }
      });
    }

    // S'assurer que le drapeau isDemo reflète l'état des véhicules
    parsed.isDemo = Boolean(parsed.vehicles && parsed.vehicles.some(v => v.isDemo));

    appState = parsed;
    return true;
  } catch (err) {
    console.error('Données corrompues détectées dans le stockage local:', err);
    try {
      const backupKey = `carnet_entretien_corrupt_${Date.now()}`;
      localStorage.setItem(backupKey, raw);
      console.warn(`Sauvegarde des données brutes corrompues dans ${backupKey}`);
    } catch (e) {}
    showToast("⚠️ Données locales corrompues. Une copie de sécurité a été archivée.", 'error', 7000);
    return false;
  }
}

/** Génère les interventions d'historique de démonstration */
function createSeedHistory(vehicleId) {
  const vId = vehicleId || (appState && appState.vehicles && appState.vehicles[0] ? appState.vehicles[0].id : 'veh_default');
  return [
    {
      id: 'hist_1',
      vehicleId: vId,
      type: 'Vidange (moteur)',
      date: getDateMinusDays(180),
      km: 109000,
      cost: 6500,
      garage: 'Garage El Bahia',
      notes: 'Huile 10W40 Total + filtre à huile Purflux',
      isDemo: true
    },
    {
      id: 'hist_2',
      vehicleId: vId,
      type: 'Filtre à air',
      date: getDateMinusDays(20),
      km: 117500,
      cost: 1200,
      garage: 'Fait soi-même',
      notes: "Remplacement cartouche d'origine",
      isDemo: true
    },
    {
      id: 'hist_3',
      vehicleId: vId,
      type: 'Bougies',
      date: getDateMinusDays(600),
      km: 75000,
      cost: 4500,
      garage: 'Station Naftal',
      notes: 'Lot de 4 bougies NGK neuves',
      isDemo: true
    },
    {
      id: 'hist_4',
      vehicleId: vId,
      type: 'Assurance',
      date: getDateMinusDays(40),
      km: 116500,
      cost: 18000,
      garage: 'SAA Assurances',
      notes: 'Contrat tous risques 1 an',
      isDemo: true
    }
  ];
}

/** Génère les données de démonstration avec ~10 semaines de kmLog */
function createSeedVehicle() {
  // Le dernier relevé est fixé à il y a exactement 9 jours pour déclencher la bannière d'inactivité
  const logs = [
    { date: getDateMinusDays(70), km: 115200, predictedKm: 115200 },
    { date: getDateMinusDays(63), km: 115480, predictedKm: 115500 },
    { date: getDateMinusDays(56), km: 115790, predictedKm: 115760 },
    { date: getDateMinusDays(49), km: 116120, predictedKm: 116100 },
    { date: getDateMinusDays(42), km: 116410, predictedKm: 116430 },
    { date: getDateMinusDays(35), km: 116730, predictedKm: 116700 },
    { date: getDateMinusDays(28), km: 117050, predictedKm: 117040 },
    { date: getDateMinusDays(21), km: 117380, predictedKm: 117360 },
    { date: getDateMinusDays(14), km: 117690, predictedKm: 117700 },
    { date: getDateMinusDays(9),  km: 118000, predictedKm: 118020 }
  ];

  // Items d'entretien avec statuts variés (vert / orange / rouge / gris)
  const maintenanceItems = DEFAULT_MAINTENANCE_TYPES.map(def => {
    let lastKm = 110000;
    let lastDate = getDateMinusDays(120);

    // Varier selon le type
    if (def.id === 'vidange' || def.id === 'filtre_huile') {
      lastKm = 109000; // ~9 000 km depuis la dernière vidange -> Orange (échéance proche)
      lastDate = getDateMinusDays(180);
    } else if (def.id === 'filtre_air') {
      lastKm = 117500; // 500 km -> Vert (OK)
      lastDate = getDateMinusDays(20);
    } else if (def.id === 'bougies') {
      lastKm = 75000; // 43 000 km depuis le changement (dépasse 40k) -> Rouge (dépassé)
      lastDate = getDateMinusDays(600);
    } else if (def.id === 'liquide_refroidissement') {
      lastKm = null; // Gris (à renseigner)
      lastDate = null;
    } else if (def.id === 'controle_technique') {
      lastDate = getDateMinusDays(380); // Dépassé de plus de 12 mois -> Rouge
      lastKm = null;
    } else if (def.id === 'assurance') {
      lastDate = getDateMinusDays(40); // Récent -> Vert
      lastKm = null;
    }

    return {
      id: def.id,
      name: def.name,
      intervalKm: def.intervalKm,
      intervalMonths: def.intervalMonths,
      lastDate: lastDate,
      lastKm: lastKm
    };
  });

  return {
    id: 'veh_demo',
    name: 'Ma voiture',
    brand: 'Renault',
    model: 'Symbol',
    year: 2015,
    plate: '12345 115 16',
    currentKm: 118000,
    updateFrequency: 'biweekly', // Rappel tous les 15 jours
    isDemo: true,
    kmLog: logs,
    maintenanceItems: maintenanceItems
  };
}

/** Initialise l'état avec le véhicule de démonstration */
function initDemoState() {
  const seedVeh = createSeedVehicle();
  const seedHist = createSeedHistory(seedVeh.id);
  appState = {
    schemaVersion: SCHEMA_VERSION,
    vehicles: [seedVeh],
    activeVehicleId: seedVeh.id,
    history: seedHist,
    settings: {
      defaultIntervals: (appState && appState.settings && appState.settings.defaultIntervals)
        ? JSON.parse(JSON.stringify(appState.settings.defaultIntervals))
        : JSON.parse(JSON.stringify(DEFAULT_MAINTENANCE_TYPES)),
      lastBackupDate: null
    },
    isDemo: true
  };
  saveState();
}

// ============================================================================
// 4. MOTEUR DE PRÉDICTION AVANCÉ & CALIBRATION CONTINUE (ÉTAPE 2)
// ============================================================================

/** Convertit une date YYYY-MM-DD en objet Date local sans décalage UTC */
function parseDateOnly(dateStr) {
  if (!dateStr) return new Date();
  const parts = dateStr.split('T')[0].split('-');
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
}

/** Formate un objet Date en YYYY-MM-DD */
function formatDateToIso(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Ajoute n mois à une date ISO */
function addMonthsToDate(dateStr, months) {
  if (!dateStr || !months) return null;
  const d = parseDateOnly(dateStr);
  d.setMonth(d.getMonth() + parseInt(months, 10));
  return formatDateToIso(d);
}

/** Ajoute n jours à une date ISO */
function addDaysToDate(dateStr, days) {
  if (!dateStr) return null;
  const d = parseDateOnly(dateStr);
  d.setDate(d.getDate() + Math.round(days));
  return formatDateToIso(d);
}

/**
 * Construit la série journalière à partir du journal kmLog.
 * Les kilomètres parcourus entre deux relevés sont répartis uniformément
 * sur chacun des jours d'intervalle.
 */
function buildDailyTimeline(kmLog) {
  if (!kmLog || kmLog.length < 2) return [];

  const sorted = [...kmLog].sort((a, b) => a.date.localeCompare(b.date));
  const timeline = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];

    const dStart = parseDateOnly(start.date);
    const dEnd = parseDateOnly(end.date);
    const days = Math.round((dEnd.getTime() - dStart.getTime()) / (1000 * 60 * 60 * 24));

    if (days <= 0) continue;

    const deltaKm = Math.max(0, end.km - start.km);
    const dailyRate = deltaKm / days;

    for (let day = 1; day <= days; day++) {
      const dayDate = new Date(dStart.getTime() + day * 24 * 60 * 60 * 1000);
      timeline.push({
        date: formatDateToIso(dayDate),
        km: dailyRate,
        dayOfWeek: dayDate.getDay() // 0 = dimanche, 5 = vendredi, 6 = samedi (week-end ven/sam)
      });
    }
  }

  return timeline;
}

/**
 * Calcule tous les paramètres du moteur de prédiction pour un véhicule :
 * - Vérifie le seuil minimal (>= 2 relevés ET >= 7 jours entre le 1er et le dernier)
 * - Combine deux fenêtres temporelles : court terme (~14 jours) et long terme (~90 jours)
 * - Pondère vers le court terme quand les relevés récents abondent, et vers le long terme sinon
 * - Applique une décroissance exponentielle pour donner plus de poids aux données fraîches
 * - Active le motif semaine / week-end uniquement après ~8 semaines (56 jours) de données
 * - Calcule l'incertitude et la fourchette (range) selon la variabilité observée
 * - Calcule le km actuel estimé : dernier km + moyenne * jours écoulés (jamais sauvegardé)
 */
function computePredictionEngine(vehicle) {
  const fallback = {
    hasSufficientData: false,
    dailyRate: 0,
    weeklyRate: 0,
    monthlyRate: 0,
    effectiveCurrentKm: vehicle ? vehicle.currentKm : 0,
    isEstimated: false,
    accuracy: null,
    weekdayWeekendPattern: false,
    weekdayFactor: 1.0,
    weekendFactor: 1.0,
    uncertaintySpread: 0.25,
    daysSinceLastLog: 0
  };

  if (!vehicle || !vehicle.kmLog || vehicle.kmLog.length < 2) {
    return fallback;
  }

  const logs = [...vehicle.kmLog].sort((a, b) => a.date.localeCompare(b.date));
  const firstLog = logs[0];
  const lastLog = logs[logs.length - 1];

  const firstDate = parseDateOnly(firstLog.date);
  const lastDate = parseDateOnly(lastLog.date);
  const totalSpanDays = Math.round((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));

  // Condition requise : au moins 2 relevés et ~7 jours
  if (logs.length < 2 || totalSpanDays < 7) {
    return fallback;
  }

  const timeline = buildDailyTimeline(logs);
  if (timeline.length === 0) {
    return fallback;
  }

  const daysSinceLastLog = getDaysElapsed(lastLog.date);
  const totalDays = timeline.length;
  const shortWindowDays = Math.min(14, totalDays);
  const longWindowDays = Math.min(90, totalDays);

  // Court terme avec décroissance exponentielle (demi-vie ~7 jours)
  let shortWeightedSum = 0;
  let shortWeightTotal = 0;
  for (let i = 0; i < shortWindowDays; i++) {
    const dayItem = timeline[totalDays - 1 - i];
    const weight = Math.exp(-i / 7);
    shortWeightedSum += dayItem.km * weight;
    shortWeightTotal += weight;
  }
  const shortRate = shortWeightTotal > 0 ? (shortWeightedSum / shortWeightTotal) : 0;

  // Long terme avec décroissance exponentielle (demi-vie ~30 jours)
  let longWeightedSum = 0;
  let longWeightTotal = 0;
  for (let i = 0; i < longWindowDays; i++) {
    const dayItem = timeline[totalDays - 1 - i];
    const weight = Math.exp(-i / 30);
    longWeightedSum += dayItem.km * weight;
    longWeightTotal += weight;
  }
  const longRate = longWeightTotal > 0 ? (longWeightedSum / longWeightTotal) : 0;

  // Fréquence des relevés récents dans les 14 derniers jours
  const fourteenDaysAgoIso = getDateMinusDays(14);
  const recentLogsCount = logs.filter(l => l.date >= fourteenDaysAgoIso).length;

  let alpha = 0.5;
  if (recentLogsCount >= 3) {
    alpha = 0.75;
  } else if (recentLogsCount === 2) {
    alpha = 0.60;
  } else if (recentLogsCount === 1) {
    alpha = 0.35;
  } else {
    alpha = 0.20;
  }

  let blendedDailyRate = alpha * shortRate + (1 - alpha) * longRate;
  if (blendedDailyRate < 0.1) blendedDailyRate = 0.1;

  // Motif semaine vs week-end : activé uniquement après ~8 semaines (56 jours)
  const hasWeekdayPattern = totalSpanDays >= 56;
  let weekdayFactor = 1.0;
  let weekendFactor = 1.0;

  if (hasWeekdayPattern) {
    let weekdaySum = 0, weekdayCount = 0;
    let weekendSum = 0, weekendCount = 0;

    timeline.forEach(item => {
      // Week-end = Vendredi (5) et Samedi (6)
      if (item.dayOfWeek === 5 || item.dayOfWeek === 6) {
        weekendSum += item.km;
        weekendCount++;
      } else {
        weekdaySum += item.km;
        weekdayCount++;
      }
    });

    const weekdayAvg = weekdayCount > 0 ? (weekdaySum / weekdayCount) : blendedDailyRate;
    const weekendAvg = weekendCount > 0 ? (weekendSum / weekendCount) : blendedDailyRate;
    const overallAvg = (5 * weekdayAvg + 2 * weekendAvg) / 7;

    if (overallAvg > 0) {
      weekdayFactor = Math.max(0.2, Math.min(2.5, weekdayAvg / overallAvg));
      weekendFactor = Math.max(0.2, Math.min(2.5, weekendAvg / overallAvg));
    }
  }

  // Calcul de la variabilité / incertitude (écart-type et intervalle)
  let sumSqDiff = 0;
  timeline.forEach(item => {
    sumSqDiff += Math.pow(item.km - blendedDailyRate, 2);
  });
  const variance = sumSqDiff / timeline.length;
  const stdDev = Math.sqrt(variance);

  // Le range se resserre à mesure que le nombre de données augmente
  const effectivePoints = Math.min(timeline.length, 90);
  const standardError = stdDev / Math.sqrt(effectivePoints);
  const rawSpread = blendedDailyRate > 0 ? (1.645 * standardError) / blendedDailyRate : 0.25;
  const uncertaintySpread = Math.max(0.08, Math.min(0.35, rawSpread));

  // Kilométrage actuel estimé si non mis à jour aujourd'hui (jamais sauvegardé)
  const estimatedKm = Math.round(lastLog.km + blendedDailyRate * daysSinceLastLog);

  // Précision moyenne sur les relevés récents (inclut les prédictions parfaites où l'erreur est 0)
  let errorSum = 0;
  let errorCount = 0;
  logs.forEach(l => {
    if (typeof l.predictedKm === 'number' && !isNaN(l.predictedKm)) {
      errorSum += Math.abs(l.km - l.predictedKm);
      errorCount++;
    }
  });
  const avgAccuracy = errorCount > 0 ? Math.round(errorSum / errorCount) : null;

  return {
    hasSufficientData: true,
    dailyRate: blendedDailyRate,
    weeklyRate: blendedDailyRate * 7,
    monthlyRate: blendedDailyRate * 30.4375,
    effectiveCurrentKm: daysSinceLastLog > 0 ? estimatedKm : lastLog.km,
    isEstimated: daysSinceLastLog > 0,
    accuracy: avgAccuracy,
    weekdayWeekendPattern: hasWeekdayPattern,
    weekdayFactor: weekdayFactor,
    weekendFactor: weekendFactor,
    uncertaintySpread: uncertaintySpread,
    daysSinceLastLog: daysSinceLastLog
  };
}

/**
 * Prédit le kilométrage attendu à une date cible pour un véhicule.
 */
function predictKmForDate(vehicle, targetDateIso) {
  if (!vehicle || !vehicle.kmLog || vehicle.kmLog.length === 0) {
    return vehicle ? vehicle.currentKm : 0;
  }

  const logs = vehicle.kmLog;
  const lastLog = logs[logs.length - 1];

  const engine = computePredictionEngine(vehicle);
  if (!engine.hasSufficientData) {
    return lastLog.km;
  }

  const targetDate = parseDateOnly(targetDateIso);
  const lastDate = parseDateOnly(lastLog.date);
  const diffDays = Math.round((targetDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) {
    return lastLog.km;
  }

  if (!engine.weekdayWeekendPattern) {
    return Math.round(lastLog.km + engine.dailyRate * diffDays);
  }

  let accumulatedKm = 0;
  for (let d = 1; d <= diffDays; d++) {
    const curDate = new Date(lastDate.getTime() + d * 24 * 60 * 60 * 1000);
    // Week-end = Vendredi (5) et Samedi (6)
    const isWeekend = curDate.getDay() === 5 || curDate.getDay() === 6;
    const factor = isWeekend ? engine.weekendFactor : engine.weekdayFactor;
    accumulatedKm += engine.dailyRate * factor;
  }

  return Math.round(lastLog.km + accumulatedKm);
}

/**
 * Convertit un kilométrage cible en date prévisionnelle et fourchette de dates.
 */
function estimateDateForTargetKm(vehicle, targetKm, predEngine) {
  if (!predEngine) predEngine = computePredictionEngine(vehicle);

  if (!predEngine.hasSufficientData) {
    return {
      hasSufficientData: false,
      targetDate: null,
      rangeStart: null,
      rangeEnd: null
    };
  }

  const currentEffKm = predEngine.effectiveCurrentKm;
  const remainingKm = targetKm - currentEffKm;

  if (remainingKm <= 0) {
    const todayIso = getTodayIsoString();
    return {
      hasSufficientData: true,
      targetDate: todayIso,
      rangeStart: todayIso,
      rangeEnd: todayIso
    };
  }

  const baseRate = predEngine.dailyRate;
  const spread = predEngine.uncertaintySpread;

  const rateHigh = baseRate * (1 + spread);
  const rateLow = Math.max(0.1, baseRate * (1 - spread));

  if (!predEngine.weekdayWeekendPattern) {
    const daysExpected = remainingKm / baseRate;
    const daysMin = remainingKm / rateHigh;
    const daysMax = remainingKm / rateLow;

    const todayIso = getTodayIsoString();
    return {
      hasSufficientData: true,
      targetDate: addDaysToDate(todayIso, daysExpected),
      rangeStart: addDaysToDate(todayIso, daysMin),
      rangeEnd: addDaysToDate(todayIso, daysMax)
    };
  }

  function simulateDaysNeeded(rate) {
    const today = parseDateOnly(getTodayIsoString());
    let kmAcc = 0;
    let days = 0;
    while (kmAcc < remainingKm && days < 3650) {
      days++;
      const nextDate = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
      // Week-end = Vendredi (5) et Samedi (6)
      const isWeekend = nextDate.getDay() === 5 || nextDate.getDay() === 6;
      const factor = isWeekend ? predEngine.weekendFactor : predEngine.weekdayFactor;
      kmAcc += rate * factor;
    }
    return days;
  }

  const daysExp = simulateDaysNeeded(baseRate);
  const daysMin = simulateDaysNeeded(rateHigh);
  const daysMax = simulateDaysNeeded(rateLow);

  const todayIso = getTodayIsoString();
  return {
    hasSufficientData: true,
    targetDate: addDaysToDate(todayIso, daysExp),
    rangeStart: addDaysToDate(todayIso, daysMin),
    rangeEnd: addDaysToDate(todayIso, daysMax)
  };
}

/**
 * Calcule l'état d'échéance complet d'un élément d'entretien :
 * - Règle du premier échu (km ou date)
 * - Statut couleur : Vert (OK), Orange (dans < 1000 km ou < 30 j), Rouge (dépassé), Gris (à renseigner)
 * - Score d'urgence pour trier la liste
 */
function calculateItemDueStatus(vehicle, item, predEngine) {
  if (!predEngine) predEngine = computePredictionEngine(vehicle);

  const currentEffKm = predEngine.effectiveCurrentKm;
  const todayIso = getTodayIsoString();

  // Éléments non renseignés
  if (item.lastKm === null && item.lastDate === null) {
    return {
      status: 'grey',
      statusLabel: 'À renseigner',
      urgencyScore: -1000,
      targetDate: null,
      rangeStart: null,
      rangeEnd: null,
      isDateEstimated: false,
      isSufficientData: true,
      remainingKm: null,
      remainingDays: null,
      dueKm: null,
      dueDateCalendar: null,
      primaryReason: 'none'
    };
  }

  let dueKm = null;
  let remainingKm = null;
  let kmPredResult = null;

  if (item.intervalKm && item.lastKm !== null) {
    dueKm = item.lastKm + item.intervalKm;
    remainingKm = dueKm - currentEffKm;
    kmPredResult = estimateDateForTargetKm(vehicle, dueKm, predEngine);
  }

  let dueDateCalendar = null;
  let remainingDaysCalendar = null;

  if (item.intervalMonths && item.lastDate !== null) {
    dueDateCalendar = addMonthsToDate(item.lastDate, item.intervalMonths);
    const dTarget = parseDateOnly(dueDateCalendar);
    const dNow = parseDateOnly(todayIso);
    remainingDaysCalendar = Math.round((dTarget.getTime() - dNow.getTime()) / (1000 * 60 * 60 * 24));
  }

  // Choix de la prochaine échéance : premier échu !
  let primaryDueDate = null;
  let primaryRangeStart = null;
  let primaryRangeEnd = null;
  let isDateEstimated = false;
  let primaryReason = 'none';

  if (kmPredResult && kmPredResult.hasSufficientData && dueDateCalendar) {
    if (kmPredResult.targetDate <= dueDateCalendar) {
      primaryDueDate = kmPredResult.targetDate;
      primaryRangeStart = kmPredResult.rangeStart;
      primaryRangeEnd = kmPredResult.rangeEnd;
      isDateEstimated = true;
      primaryReason = 'km';
    } else {
      primaryDueDate = dueDateCalendar;
      primaryRangeStart = dueDateCalendar;
      primaryRangeEnd = dueDateCalendar;
      isDateEstimated = false;
      primaryReason = 'months';
    }
  } else if (kmPredResult && kmPredResult.hasSufficientData) {
    primaryDueDate = kmPredResult.targetDate;
    primaryRangeStart = kmPredResult.rangeStart;
    primaryRangeEnd = kmPredResult.rangeEnd;
    isDateEstimated = true;
    primaryReason = 'km';
  } else if (dueDateCalendar) {
    primaryDueDate = dueDateCalendar;
    primaryRangeStart = dueDateCalendar;
    primaryRangeEnd = dueDateCalendar;
    isDateEstimated = false;
    primaryReason = 'months';
  }

  let effectiveRemainingDays = null;
  if (primaryDueDate) {
    const dTarget = parseDateOnly(primaryDueDate);
    const dNow = parseDateOnly(todayIso);
    effectiveRemainingDays = Math.round((dTarget.getTime() - dNow.getTime()) / (1000 * 60 * 60 * 24));
  } else if (remainingDaysCalendar !== null) {
    effectiveRemainingDays = remainingDaysCalendar;
  }

  // Calcul du statut couleur
  let status = 'green';
  let statusLabel = 'OK';
  let urgencyScore = 0;

  const isKmOverdue = remainingKm !== null && remainingKm <= 0;
  const isDateOverdue = effectiveRemainingDays !== null && effectiveRemainingDays <= 0;

  const isKmClose = remainingKm !== null && remainingKm <= 1000 && remainingKm > 0;
  const isDateClose = effectiveRemainingDays !== null && effectiveRemainingDays <= 30 && effectiveRemainingDays > 0;

  if (isKmOverdue || isDateOverdue) {
    status = 'red';
    statusLabel = 'Dépassé';
    const overdueKm = remainingKm !== null && remainingKm < 0 ? Math.abs(remainingKm) : 0;
    const overdueDays = effectiveRemainingDays !== null && effectiveRemainingDays < 0 ? Math.abs(effectiveRemainingDays) : 0;
    urgencyScore = 10000 + overdueKm + overdueDays * 40;
  } else if (isKmClose || isDateClose) {
    status = 'orange';
    statusLabel = 'Bientôt';
    const distFactor = remainingKm !== null ? (1000 - remainingKm) : 0;
    const daysFactor = effectiveRemainingDays !== null ? (30 - effectiveRemainingDays) * 30 : 0;
    urgencyScore = 5000 + Math.max(distFactor, daysFactor);
  } else {
    status = 'green';
    statusLabel = 'OK';
    const distRemaining = remainingKm !== null ? remainingKm : 100000;
    urgencyScore = 1000 - Math.min(distRemaining, 50000) / 100;
  }

  return {
    status,
    statusLabel,
    urgencyScore,
    targetDate: primaryDueDate,
    rangeStart: primaryRangeStart,
    rangeEnd: primaryRangeEnd,
    isDateEstimated,
    isSufficientData: kmPredResult ? kmPredResult.hasSufficientData : true,
    remainingKm,
    remainingDays: effectiveRemainingDays,
    dueKm,
    dueDateCalendar,
    primaryReason
  };
}

// ============================================================================
// 5. GESTION DES RELEVÉS KILOMÉTRIQUES & CORRECTION AUTOMATIQUE
// ============================================================================

/**
 * Enregistre une mise à jour de kilométrage et applique la correction automatique :
 * 1. Compare le km réel avec le km prédit
 * 2. Recalcule les taux de conduite
 * 3. Recalcule toutes les échéances
 * 4. Affiche le message de correction
 * 5. Met à jour la précision
 */
function handleQuickKmSubmit(e) {
  e.preventDefault();
  clearKmFeedback();

  const vehicle = getActiveVehicle();
  if (!vehicle) {
    showKmError("Aucun véhicule actif sélectionné.");
    return;
  }

  const input = document.getElementById('quickKmInput');
  const rawVal = input.value.trim();

  if (!rawVal) {
    showKmError("Veuillez saisir un kilométrage.");
    input.focus();
    return;
  }

  const newKm = parseInt(rawVal, 10);
  if (isNaN(newKm) || newKm < 0) {
    showKmError("Le kilométrage doit être un entier positif.");
    input.focus();
    return;
  }

  if (newKm < vehicle.currentKm) {
    showKmError(`Le kilométrage ne peut pas être inférieur au kilométrage actuel (${formatKm(vehicle.currentKm)}).`);
    input.focus();
    return;
  }

  const jump = newKm - vehicle.currentKm;
  if (jump > 3000) {
    const confirmJump = window.confirm(
      `Attention : Vous avez saisi une augmentation de +${formatKm(jump)} d'un coup.\nConfirmez-vous que ce relevé est exact ?`
    );
    if (!confirmJump) {
      input.focus();
      return;
    }
  }

  const todayIso = getTodayIsoString();

  // Prédire le kilométrage avant d'enregistrer le nouveau point
  const oldEngine = computePredictionEngine(vehicle);
  const predicted = predictKmForDate(vehicle, todayIso);
  const delta = newKm - predicted;

  // Mémoriser les dates prévisionnelles de chaque élément avant recalcul (pour détection de décalage > 7j)
  const prevTargetDates = {};
  let trackedItemName = '';
  let oldDueDateFormatted = '';
  if (vehicle.maintenanceItems && vehicle.maintenanceItems.length > 0) {
    vehicle.maintenanceItems.forEach(item => {
      const due = calculateItemDueStatus(vehicle, item, oldEngine);
      if (due.targetDate) {
        prevTargetDates[item.id] = { name: item.name, date: due.targetDate };
      }
    });

    const scoredBefore = vehicle.maintenanceItems.map(item => ({
      item,
      due: calculateItemDueStatus(vehicle, item, oldEngine)
    })).filter(x => x.due.status !== 'grey');

    scoredBefore.sort((a, b) => b.due.urgencyScore - a.due.urgencyScore);
    if (scoredBefore.length > 0 && scoredBefore[0].due.targetDate) {
      trackedItemName = scoredBefore[0].item.name;
      oldDueDateFormatted = formatDate(scoredBefore[0].due.targetDate);
    }
  }

  const existingLogIndex = vehicle.kmLog.findIndex(log => log.date === todayIso);

  const currentProfile = (window.FamilyRoom && typeof window.FamilyRoom.getStoredRoomProfile === 'function')
    ? window.FamilyRoom.getStoredRoomProfile()
    : null;
  const currentAuthorName = (currentProfile && currentProfile.myName) ? currentProfile.myName : null;

  if (existingLogIndex !== -1) {
    // Une correction le même jour conserve le predictedKm d'origine de cette journée
    vehicle.kmLog[existingLogIndex].km = newKm;
    if (currentAuthorName) vehicle.kmLog[existingLogIndex].authorName = currentAuthorName;
    showToast(`Correction du jour enregistrée : ${formatKm(newKm)}.`, 'info');
    showKmSuccess(`Relevé du jour mis à jour à ${formatKm(newKm)} (remplacement).`);
  } else {
    vehicle.kmLog.push({
      date: todayIso,
      km: newKm,
      predictedKm: predicted,
      authorName: currentAuthorName
    });

    vehicle.kmLog.sort((a, b) => a.date.localeCompare(b.date));
    showToast(`Kilométrage enregistré : ${formatKm(newKm)}.`, 'success');
    showKmSuccess(`Kilométrage mis à jour avec succès : ${formatKm(newKm)}.`);
  }

  vehicle.currentKm = newKm;
  saveState();

  // Synchronisation avec la salle familiale si active (Point 10)
  if (window.FamilyRoom && typeof window.FamilyRoom.isRoomActive === 'function' && window.FamilyRoom.isRoomActive()) {
    window.FamilyRoom.recordKmReading(vehicle.id, newKm, todayIso, predicted).catch(err => {
      console.warn("Erreur synchronisation relevé salle:", err);
    });
  }

  input.value = '';

  // Recalculer le moteur de prédiction avec le nouveau point
  const newEngine = computePredictionEngine(vehicle);

  // Message de correction automatique
  displayCorrectionBanner(delta, trackedItemName, oldDueDateFormatted, vehicle, newEngine);

  // Détecter si une date d'échéance a été décalée de plus de 7 jours (Étape 5)
  const shiftedItems = [];
  if (vehicle.maintenanceItems) {
    vehicle.maintenanceItems.forEach(item => {
      const newDue = calculateItemDueStatus(vehicle, item, newEngine);
      if (newDue.targetDate && prevTargetDates[item.id]) {
        const oldD = prevTargetDates[item.id].date;
        const newD = newDue.targetDate;
        const d1 = parseDateOnly(oldD).getTime();
        const d2 = parseDateOnly(newD).getTime();
        const daysDiff = Math.round(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));
        if (daysDiff >= 7) {
          shiftedItems.push({
            name: item.name,
            oldDate: oldD,
            newDate: newD,
            diff: daysDiff
          });
        }
      }
    });
  }

  updateCalendarShiftBanner(shiftedItems);

  renderApp();
}

/** Affiche la bannière de correction automatique */
function displayCorrectionBanner(delta, itemName, oldDueDateStr, vehicle, newEngine) {
  const banner = document.getElementById('correctionBanner');
  const textEl = document.getElementById('correctionBannerText');
  const metaEl = document.getElementById('correctionBannerMeta');
  if (!banner || !textEl || !metaEl) return;

  const absDelta = Math.abs(delta);
  const sign = delta > 0 ? '+' : (delta < 0 ? '-' : '');
  const deltaFormatted = `${sign}${absDelta} km`;

  let newDueDateStr = '';
  if (itemName && vehicle.maintenanceItems) {
    const itemObj = vehicle.maintenanceItems.find(i => i.name === itemName);
    if (itemObj) {
      const newDue = calculateItemDueStatus(vehicle, itemObj, newEngine);
      if (newDue.targetDate) {
        newDueDateStr = formatDate(newDue.targetDate);
      }
    }
  }

  if (itemName && oldDueDateStr && newDueDateStr && oldDueDateStr !== newDueDateStr) {
    textEl.textContent = `Prédiction corrigée : écart de ${absDelta} km. ${itemName} maintenant estimée vers le ${newDueDateStr} (avant : vers le ${oldDueDateStr}).`;
  } else {
    textEl.textContent = `Prédiction corrigée : écart de ${absDelta} km par rapport à l'estimation. Toutes les échéances ont été recalculées instantanément.`;
  }

  metaEl.textContent = `Nouveau rythme calculé : ~${Math.round(newEngine.dailyRate)} km/jour (~${Math.round(newEngine.weeklyRate)} km/semaine).`;
  banner.classList.remove('hidden');
}

function showKmError(msg) {
  const box = document.getElementById('kmErrorBox');
  const text = document.getElementById('kmErrorText');
  const successBox = document.getElementById('kmSuccessBox');
  if (box && text) {
    text.textContent = msg;
    box.classList.remove('hidden');
  }
  if (successBox) successBox.classList.add('hidden');
}

function showKmSuccess(msg) {
  const box = document.getElementById('kmSuccessBox');
  const text = document.getElementById('kmSuccessText');
  const errBox = document.getElementById('kmErrorBox');
  if (box && text) {
    text.textContent = msg;
    box.classList.remove('hidden');
  }
  if (errBox) errBox.classList.add('hidden');
}

function clearKmFeedback() {
  const errBox = document.getElementById('kmErrorBox');
  const successBox = document.getElementById('kmSuccessBox');
  if (errBox) errBox.classList.add('hidden');
  if (successBox) successBox.classList.add('hidden');
}

// ============================================================================
// 6. GESTION DES VÉHICULES (AJOUT, ÉDITION, SUPPRESSION)
// ============================================================================

function getActiveVehicle() {
  if (!appState.vehicles || appState.vehicles.length === 0) return null;
  let current = appState.vehicles.find(v => v.id === appState.activeVehicleId);
  if (!current) {
    current = appState.vehicles[0];
    appState.activeVehicleId = current.id;
  }
  return current;
}

function openAddVehicleModal() {
  if (appState.vehicles.length >= MAX_VEHICLES) {
    showToast(`Limite atteinte : vous pouvez gérer au maximum ${MAX_VEHICLES} véhicules.`, 'warning');
    return;
  }

  document.getElementById('vehicleModalTitle').textContent = 'Ajouter un véhicule';
  document.getElementById('editVehicleId').value = '';
  document.getElementById('vehName').value = `Véhicule ${appState.vehicles.length + 1}`;
  document.getElementById('vehBrand').value = '';
  document.getElementById('vehModel').value = '';
  document.getElementById('vehYear').value = new Date().getFullYear();
  document.getElementById('vehPlate').value = '';
  document.getElementById('vehCurrentKm').value = '';
  document.getElementById('vehCurrentKmGroup').classList.remove('hidden');
  document.getElementById('vehFrequency').value = 'weekly';

  document.getElementById('btnDeleteVehicle').classList.add('hidden');
  document.getElementById('vehicleModal').classList.remove('hidden');
  document.getElementById('vehBrand').focus();
}

function openEditVehicleModal() {
  const vehicle = getActiveVehicle();
  if (!vehicle) return;

  document.getElementById('vehicleModalTitle').textContent = `Modifier ${vehicle.name}`;
  document.getElementById('editVehicleId').value = vehicle.id;
  document.getElementById('vehName').value = vehicle.name || '';
  document.getElementById('vehBrand').value = vehicle.brand || '';
  document.getElementById('vehModel').value = vehicle.model || '';
  document.getElementById('vehYear').value = vehicle.year || '';
  document.getElementById('vehPlate').value = vehicle.plate || '';
  document.getElementById('vehCurrentKm').value = vehicle.currentKm;
  document.getElementById('vehCurrentKmGroup').classList.add('hidden'); // Modifié via quick update
  document.getElementById('vehFrequency').value = vehicle.updateFrequency || 'biweekly';

  document.getElementById('btnDeleteVehicle').classList.remove('hidden');
  document.getElementById('vehicleModal').classList.remove('hidden');
}

function closeVehicleModal() {
  document.getElementById('vehicleModal').classList.add('hidden');
}

function handleVehicleFormSubmit(e) {
  e.preventDefault();
  const editId = document.getElementById('editVehicleId').value;
  const name = document.getElementById('vehName').value.trim();
  const brand = document.getElementById('vehBrand').value.trim();
  const model = document.getElementById('vehModel').value.trim();
  const year = parseInt(document.getElementById('vehYear').value, 10) || new Date().getFullYear();
  const plate = document.getElementById('vehPlate').value.trim();
  const frequency = document.getElementById('vehFrequency').value;

  if (!brand || !model) {
    showToast('La marque et le modèle sont obligatoires.', 'warning');
    return;
  }

  if (editId) {
    // Modification
    const veh = appState.vehicles.find(v => v.id === editId);
    if (veh) {
      veh.name = name || `${brand} ${model}`;
      veh.brand = brand;
      veh.model = model;
      veh.year = year;
      veh.plate = plate;
      veh.updateFrequency = frequency;
      showToast('Véhicule mis à jour avec succès.', 'success');

      if (window.FamilyRoom && typeof window.FamilyRoom.isRoomActive === 'function' && window.FamilyRoom.isRoomActive()) {
        window.FamilyRoom.saveVehicle(veh).catch(err => console.warn('Erreur mise à jour véhicule salle:', err));
      }
    }
  } else {
    // Création
    if (appState.vehicles.length >= MAX_VEHICLES) {
      showToast(`Maximum ${MAX_VEHICLES} véhicules autorisés.`, 'warning');
      return;
    }

    const currentKmInput = document.getElementById('vehCurrentKm');
    const kmVal = parseInt(currentKmInput.value, 10);
    if (isNaN(kmVal) || kmVal < 0) {
      showToast('Kilométrage initial invalide.', 'warning');
      currentKmInput.focus();
      return;
    }

    const todayIso = getTodayIsoString();
    const newVeh = {
      id: 'veh_' + Date.now(),
      name: name || `${brand} ${model}`,
      brand: brand,
      model: model,
      year: year,
      plate: plate,
      currentKm: kmVal,
      updateFrequency: frequency,
      kmLog: [{ date: todayIso, km: kmVal, predictedKm: kmVal }],
      maintenanceItems: (
        (appState && appState.settings && Array.isArray(appState.settings.defaultIntervals))
          ? appState.settings.defaultIntervals
          : DEFAULT_MAINTENANCE_TYPES
      ).map(def => ({
        id: def.id,
        name: def.name,
        intervalKm: def.intervalKm,
        intervalMonths: def.intervalMonths,
        lastDate: null,
        lastKm: null
      }))
    };

    appState.vehicles.push(newVeh);
    appState.activeVehicleId = newVeh.id;
    appState.isDemo = false; // Tout ajout désactive le mode démo
    showToast('Véhicule ajouté avec succès !', 'success');

    if (window.FamilyRoom && typeof window.FamilyRoom.isRoomActive === 'function' && window.FamilyRoom.isRoomActive()) {
      window.FamilyRoom.saveVehicle(newVeh).catch(err => console.warn('Erreur création véhicule salle:', err));
    }
  }

  saveState();
  closeVehicleModal();
  renderApp();
}

function handleDeleteVehicle() {
  const editId = document.getElementById('editVehicleId').value;
  if (!editId) return;

  const veh = appState.vehicles.find(v => v.id === editId);
  if (!veh) return;

  const confirmDel = window.confirm(`Supprimer définitivement le véhicule "${veh.name}" et son historique ?`);
  if (!confirmDel) return;

  if (window.FamilyRoom && typeof window.FamilyRoom.isRoomActive === 'function' && window.FamilyRoom.isRoomActive()) {
    window.FamilyRoom.deleteVehicle(editId).catch(err => console.warn('Erreur suppression véhicule salle:', err));
  }

  appState.vehicles = appState.vehicles.filter(v => v.id !== editId);
  if (appState.history) {
    appState.history = appState.history.filter(h => h.vehicleId !== editId);
  }
  if (appState.vehicles.length > 0) {
    appState.activeVehicleId = appState.vehicles[0].id;
  } else {
    appState.activeVehicleId = null;
    appState.isDemo = false;
  }

  saveState();
  closeVehicleModal();
  showToast('Véhicule supprimé.', 'info');
  renderApp();
  if (currentView === 'history') {
    renderHistoryScreen();
  }
}

/** Supprime définitivement les données de démonstration */
function handleDeleteDemoData() {
  const confirmClean = window.confirm(
    "Voulez-vous supprimer définitivement le véhicule et les interventions de démonstration pour repartir de zéro avec votre propre véhicule ?"
  );
  if (!confirmClean) return;

  const demoVehicleIds = new Set(
    (appState.vehicles || []).filter(v => v.isDemo).map(v => v.id)
  );

  // Supprimer les véhicules de démo
  appState.vehicles = (appState.vehicles || []).filter(v => !v.isDemo);

  // Supprimer les historiques de démo
  appState.history = (appState.history || []).filter(h => !h.isDemo && !demoVehicleIds.has(h.vehicleId));

  appState.isDemo = false;

  if (appState.vehicles.length > 0) {
    if (!appState.vehicles.some(v => v.id === appState.activeVehicleId)) {
      appState.activeVehicleId = appState.vehicles[0].id;
    }
  } else {
    appState.activeVehicleId = null;
  }

  saveState();
  showToast("Données de démonstration supprimées avec succès.", 'info');
  renderApp();

  if (currentView === 'settings') {
    renderSettingsScreen();
  } else if (currentView === 'history') {
    renderHistoryScreen();
  }
}

// ============================================================================
// 7. PREMIER LANCEMENT & ONBOARDING (0 VÉHICULE)
// ============================================================================

function checkOnboarding() {
  const modal = document.getElementById('onboardingModal');
  const hasRoom = window.FamilyRoom && window.FamilyRoom.getStoredRoomProfile();
  if ((!appState.vehicles || appState.vehicles.length === 0) && !hasRoom) {
    const choiceSec = document.getElementById('onboardingChoiceSection');
    const formSec = document.getElementById('onboardingFormSection');
    if (choiceSec) choiceSec.classList.remove('hidden');
    if (formSec) formSec.classList.add('hidden');
    modal.classList.remove('hidden');
  } else {
    modal.classList.add('hidden');
  }
}

function handleOnboardingSubmit(e) {
  e.preventDefault();
  const brand = document.getElementById('onboardBrand').value.trim();
  const model = document.getElementById('onboardModel').value.trim();
  const kmVal = parseInt(document.getElementById('onboardKm').value, 10);
  const frequency = document.getElementById('onboardFrequency').value;
  const year = parseInt(document.getElementById('onboardYear').value, 10) || new Date().getFullYear();
  const plate = document.getElementById('onboardPlate').value.trim();

  if (!brand || !model) {
    showToast('Marque et modèle obligatoires.', 'warning');
    return;
  }

  if (isNaN(kmVal) || kmVal < 0) {
    showToast('Kilométrage actuel obligatoire.', 'warning');
    document.getElementById('onboardKm').focus();
    return;
  }

  const todayIso = getTodayIsoString();
  const newVeh = {
    id: 'veh_' + Date.now(),
    name: `${brand} ${model}`,
    brand: brand,
    model: model,
    year: year,
    plate: plate,
    currentKm: kmVal,
    updateFrequency: frequency,
    kmLog: [{ date: todayIso, km: kmVal, predictedKm: kmVal }],
    maintenanceItems: (
      (appState && appState.settings && Array.isArray(appState.settings.defaultIntervals))
        ? appState.settings.defaultIntervals
        : DEFAULT_MAINTENANCE_TYPES
    ).map(def => ({
      id: def.id,
      name: def.name,
      intervalKm: def.intervalKm,
      intervalMonths: def.intervalMonths,
      lastDate: null,
      lastKm: null
    }))
  };

  appState.vehicles = [newVeh];
  appState.activeVehicleId = newVeh.id;
  appState.isDemo = false;
  saveState();

  document.getElementById('onboardingModal').classList.add('hidden');
  showToast('Bienvenue ! Votre véhicule est configuré.', 'success');
  renderApp();

  const exportReminderCheck = document.getElementById('onboardRecurringReminder');
  if (exportReminderCheck && exportReminderCheck.checked) {
    exportRecurringReminderIcs();
  }
}

function handleLoadDemoFromOnboard() {
  initDemoState();
  document.getElementById('onboardingModal').classList.add('hidden');
  showToast("Véhicule de démonstration chargé avec succès !", 'success');
  renderApp();
}

// ============================================================================
// 8. BANNIÈRE DE RAPPEL DE MISE À JOUR (STALE UPDATE BANNER)
// ============================================================================

/**
 * Affiche la bannière d'inactivité quand le dernier relevé est plus ancien
 * que la fréquence choisie (quotidienne = >= 1 jour, hebdomadaire = >= 7 jours).
 */
function updateStaleBanner(vehicle) {
  const staleBanner = document.getElementById('staleBanner');
  const bannerText = document.getElementById('staleBannerText');
  if (!vehicle || !vehicle.kmLog || vehicle.kmLog.length === 0) {
    staleBanner.classList.add('hidden');
    return;
  }

  const lastLog = vehicle.kmLog[vehicle.kmLog.length - 1];
  const daysElapsed = getDaysElapsed(lastLog.date);
  let threshold = 15;
  if (vehicle.updateFrequency === 'daily') {
    threshold = 1;
  } else if (vehicle.updateFrequency === 'weekly') {
    threshold = 7;
  } else {
    threshold = 15; // Par défaut tous les 15 jours
  }

  if (daysElapsed >= threshold) {
    staleBanner.classList.remove('hidden');
    if (daysElapsed === 1) {
      bannerText.textContent = "Mets à jour ton kilométrage (dernière mise à jour : hier)";
    } else {
      bannerText.textContent = `Mets à jour ton kilométrage (dernière mise à jour : il y a ${daysElapsed} jours)`;
    }
  } else {
    staleBanner.classList.add('hidden');
  }
}

// ============================================================================
// 9. RENDU DE L'INTERFACE UTILISATEUR
// ============================================================================

function renderApp() {
  checkOnboarding();

  const vehicle = getActiveVehicle();
  const demoBanner = document.getElementById('demoBanner');

  // Bannière démo (si présente)
  if (demoBanner) {
    if (appState.isDemo && vehicle) {
      demoBanner.classList.remove('hidden');
    } else {
      demoBanner.classList.add('hidden');
    }
  }

  // Bannière de rappel de sauvegarde (> 30 jours)
  checkBackupReminder();

  // Sélecteur de véhicule
  renderVehicleSelector();

  if (!vehicle) return;

  // Calcul du moteur de prédiction
  const engine = computePredictionEngine(vehicle);

  // Badge véhicule & odomètre
  const vehicleBadge = document.getElementById('vehicleBadge');
  const plateText = vehicle.plate ? ` • ${vehicle.plate}` : '';
  vehicleBadge.textContent = `${vehicle.brand} ${vehicle.model} (${vehicle.year})${plateText}`;

  // Affichage du kilométrage principal
  document.getElementById('currentKmDisplay').textContent = formatKm(vehicle.currentKm).replace(' km', '');

  // Date du dernier relevé
  const lastLog = vehicle.kmLog && vehicle.kmLog.length > 0 ? vehicle.kmLog[vehicle.kmLog.length - 1] : null;
  const lastDateStr = lastLog ? formatDate(lastLog.date) : '--/--/----';
  document.getElementById('lastReadingDateDisplay').textContent = `Dernier relevé : ${lastDateStr}`;

  // Bannière d'inactivité
  updateStaleBanner(vehicle);

  // Synthèse prédictive
  renderPredictionStats(vehicle, engine);

  // Plan d'entretien (Étape 2)
  renderMaintenanceList(vehicle, engine);

  // Journal des relevés (kmLog)
  renderKmLogList(vehicle);
}

function renderPredictionStats(vehicle, engine) {
  const dailyEl = document.getElementById('statDailyRate');
  const weeklyEl = document.getElementById('statWeeklyRate');
  const effKmEl = document.getElementById('statEffectiveKm');
  const effSubEl = document.getElementById('statEffectiveSub');
  const accEl = document.getElementById('statAccuracy');

  if (!dailyEl || !effKmEl || !accEl) return;

  if (engine.hasSufficientData) {
    dailyEl.textContent = `~${Math.round(engine.dailyRate)} km/j`;
    weeklyEl.textContent = `~${Math.round(engine.weeklyRate)} km/sem`;

    if (engine.isEstimated) {
      effKmEl.textContent = formatKm(engine.effectiveCurrentKm);
      effSubEl.textContent = `Estimé (+${engine.daysSinceLastLog} j sans relevé)`;
    } else {
      effKmEl.textContent = formatKm(engine.effectiveCurrentKm);
      effSubEl.textContent = `À ce jour (relevé du jour)`;
    }

    if (engine.accuracy !== null) {
      accEl.textContent = `±${engine.accuracy} km`;
    } else {
      accEl.textContent = `En apprentissage`;
    }
  } else {
    dailyEl.textContent = `-- km/j`;
    weeklyEl.textContent = `Besoin de 7 jours`;
    effKmEl.textContent = formatKm(vehicle.currentKm);
    effSubEl.textContent = `Relevé réel`;
    accEl.textContent = `En apprentissage`;
  }
}

// État actif du filtre par statut (Étape 3)
let activeStatusFilter = 'all';

function setStatusFilter(filter) {
  activeStatusFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(btn => {
    if (btn.getAttribute('data-filter') === filter) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  const vehicle = getActiveVehicle();
  if (vehicle) {
    const engine = computePredictionEngine(vehicle);
    renderMaintenanceList(vehicle, engine);
  }
}

function renderMaintenanceList(vehicle, engine) {
  const container = document.getElementById('maintenanceContainer') || document.getElementById('maintenanceList');
  const badgeEl = document.getElementById('maintenanceCountBadge');
  if (!container) return;

  const prefs = getUiPreferences();
  updateViewToggleButtons('maintViewToggle', prefs.maintViewMode);

  container.innerHTML = '';

  if (!vehicle.maintenanceItems || vehicle.maintenanceItems.length === 0) {
    if (badgeEl) badgeEl.textContent = '0 élément';
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 18px;">Aucun entretien configuré. Cliquez sur "+ Ajouter" pour en créer un.</div>';
    return;
  }

  // Calcul du statut de chaque élément
  const itemsWithStatus = vehicle.maintenanceItems.map(item => ({
    item,
    due: calculateItemDueStatus(vehicle, item, engine)
  }));

  // Mise à jour des compteurs des filtres de statut (Étape 3)
  const counts = { all: itemsWithStatus.length, red: 0, orange: 0, green: 0, grey: 0 };
  itemsWithStatus.forEach(({ due }) => {
    if (counts[due.status] !== undefined) counts[due.status]++;
  });

  const cAll = document.getElementById('countFilterAll');
  const cRed = document.getElementById('countFilterRed');
  const cOrange = document.getElementById('countFilterOrange');
  const cGreen = document.getElementById('countFilterGreen');
  const cGrey = document.getElementById('countFilterGrey');

  if (cAll) cAll.textContent = counts.all;
  if (cRed) cRed.textContent = counts.red;
  if (cOrange) cOrange.textContent = counts.orange;
  if (cGreen) cGreen.textContent = counts.green;
  if (cGrey) cGrey.textContent = counts.grey;

  if (badgeEl) {
    badgeEl.textContent = `${itemsWithStatus.length} élément${itemsWithStatus.length > 1 ? 's' : ''}`;
  }

  // Tri par score d'urgence décroissant
  itemsWithStatus.sort((a, b) => b.due.urgencyScore - a.due.urgencyScore);

  // Filtrage selon le statut sélectionné
  const displayedItems = activeStatusFilter === 'all'
    ? itemsWithStatus
    : itemsWithStatus.filter(x => x.due.status === activeStatusFilter);

  if (displayedItems.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 28px;">Aucun entretien ne correspond à ce filtre de statut.</div>';
    return;
  }

  if (prefs.maintViewMode === 'table') {
    // ==========================================
    // AFFICHAGE 1 : TABLEAU GLISSABLE (PAR DÉFAUT)
    // ==========================================
    const tableWrap = document.createElement('div');
    tableWrap.innerHTML = `
      <div class="table-scroll-hint"><span>👈 Défilement horizontal pour tout voir 👉</span></div>
      <div class="table-scroll-wrapper">
        <table class="app-data-table maintenance-table">
          <thead>
            <tr>
              <th>Statut</th>
              <th>Opération</th>
              <th>Intervalle</th>
              <th>Prochaine échéance</th>
              <th>Restant</th>
              <th>Délai</th>
              <th>Usure</th>
              <th>Dernier réalisé</th>
              <th style="text-align: center;">Actions</th>
            </tr>
          </thead>
          <tbody id="maintenanceTableBody"></tbody>
        </table>
      </div>
    `;
    container.appendChild(tableWrap);
    const tbody = document.getElementById('maintenanceTableBody');

    displayedItems.forEach(({ item, due }) => {
      let badgeHtml = '';
      if (due.status === 'red') {
        badgeHtml = `<span class="status-badge status-badge-red">🔴 ${due.statusLabel}</span>`;
      } else if (due.status === 'orange') {
        badgeHtml = `<span class="status-badge status-badge-orange">🟠 ${due.statusLabel}</span>`;
      } else if (due.status === 'green') {
        badgeHtml = `<span class="status-badge status-badge-green">🟢 ${due.statusLabel}</span>`;
      } else {
        badgeHtml = `<span class="status-badge status-badge-grey">⚪ ${due.statusLabel}</span>`;
      }

      let intervalDesc = '';
      if (item.intervalKm && item.intervalMonths) {
        intervalDesc = `${formatKm(item.intervalKm)} / ${item.intervalMonths} m`;
      } else if (item.intervalKm) {
        intervalDesc = `${formatKm(item.intervalKm)}`;
      } else if (item.intervalMonths) {
        intervalDesc = `${item.intervalMonths} mois`;
      } else {
        intervalDesc = `Libre`;
      }

      let dueDateHtml = '';
      if (due.status === 'grey') {
        dueDateHtml = `<span class="text-muted">À renseigner</span>`;
      } else if (due.targetDate) {
        const formattedDate = formatDate(due.targetDate);
        if (due.isDateEstimated) {
          dueDateHtml = `<strong>~${formattedDate}</strong>`;
        } else {
          dueDateHtml = `<strong>${formattedDate}</strong>`;
        }
      } else {
        dueDateHtml = `<span class="text-muted">--</span>`;
      }

      let wearPct = 0;
      if (item.intervalKm && item.lastKm !== null) {
        const elapsedKm = Math.max(0, engine.effectiveCurrentKm - item.lastKm);
        wearPct = Math.min(100, Math.round((elapsedKm / item.intervalKm) * 100));
      } else if (item.intervalMonths && item.lastDate !== null) {
        const elapsedDays = Math.max(0, getDaysElapsed(item.lastDate));
        const totalDays = item.intervalMonths * 30.4375;
        wearPct = Math.min(100, Math.round((elapsedDays / totalDays) * 100));
      }

      let kmMetricText = '--';
      let kmMetricClass = '';
      if (due.remainingKm !== null) {
        if (due.remainingKm < 0) {
          kmMetricText = `-${formatKm(Math.abs(due.remainingKm))}`;
          kmMetricClass = 'metric-danger';
        } else if (due.remainingKm <= 1000) {
          kmMetricText = formatKm(due.remainingKm);
          kmMetricClass = 'metric-warning';
        } else {
          kmMetricText = formatKm(due.remainingKm);
        }
      }

      let daysMetricText = '--';
      let daysMetricClass = '';
      if (due.remainingDays !== null) {
        if (due.remainingDays < 0) {
          daysMetricText = `-${Math.abs(due.remainingDays)} j`;
          daysMetricClass = 'metric-danger';
        } else if (due.remainingDays <= 30) {
          daysMetricText = `${due.remainingDays} j`;
          daysMetricClass = 'metric-warning';
        } else {
          daysMetricText = `${due.remainingDays} j`;
        }
      }

      let lastDoneText = 'Non renseigné';
      if (item.lastKm !== null && item.lastDate) {
        lastDoneText = `${formatKm(item.lastKm)} (${formatDate(item.lastDate)})`;
      } else if (item.lastKm !== null) {
        lastDoneText = `${formatKm(item.lastKm)}`;
      } else if (item.lastDate) {
        lastDoneText = `${formatDate(item.lastDate)}`;
      }

      const tr = document.createElement('tr');
      tr.className = `row-${due.status}`;
      tr.innerHTML = `
        <td>${badgeHtml}</td>
        <td>
          <div class="table-col-name">${escapeHtml(item.name)}</div>
        </td>
        <td><span class="table-col-sub">${escapeHtml(intervalDesc)}</span></td>
        <td>${dueDateHtml}</td>
        <td><span class="${kmMetricClass}" style="font-weight:700;">${kmMetricText}</span></td>
        <td><span class="${daysMetricClass}" style="font-weight:700;">${daysMetricText}</span></td>
        <td>
          ${due.status !== 'grey' ? `
            <div style="display:flex; align-items:center; gap:6px;">
              <div class="progress-track" style="width:44px; height:6px;">
                <div class="progress-bar-fill progress-fill-${due.status}" style="width: ${wearPct}%;"></div>
              </div>
              <span style="font-size:0.75rem; font-weight:700; color:var(--text-muted);">${wearPct}%</span>
            </div>
          ` : `<span style="font-size:0.75rem; color:var(--text-muted);">--</span>`}
        </td>
        <td><span class="table-col-sub">${escapeHtml(lastDoneText)}</span></td>
        <td>
          <div class="table-actions-cell" style="justify-content: center;">
            <button type="button" class="btn-sm btn-done-today btn-open-done" data-id="${item.id}" title="Fait aujourd'hui">✅ Fait</button>
            <button type="button" class="btn-sm btn-export-item-ics" data-id="${item.id}" title="Exporter (.ics)">📅</button>
            <button type="button" class="btn-sm btn-edit-maint" data-id="${item.id}" title="Modifier">✏️</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } else {
    // ==========================================
    // AFFICHAGE 2 : FICHES / CARTES
    // ==========================================
    const grid = document.createElement('div');
    grid.className = 'items-grid';
    grid.id = 'maintenanceList';
    container.appendChild(grid);

    displayedItems.forEach(({ item, due }) => {
      const card = document.createElement('div');
      card.className = `item-card item-card-${due.status}`;

      let badgeHtml = '';
      if (due.status === 'red') {
        badgeHtml = `<span class="status-badge status-badge-red">🔴 ${due.statusLabel}</span>`;
      } else if (due.status === 'orange') {
        badgeHtml = `<span class="status-badge status-badge-orange">🟠 ${due.statusLabel}</span>`;
      } else if (due.status === 'green') {
        badgeHtml = `<span class="status-badge status-badge-green">🟢 ${due.statusLabel}</span>`;
      } else {
        badgeHtml = `<span class="status-badge status-badge-grey">⚪ ${due.statusLabel}</span>`;
      }

      let intervalDesc = '';
      if (item.intervalKm && item.intervalMonths) {
        intervalDesc = `Tous les ${formatKm(item.intervalKm)} ou ${item.intervalMonths} mois`;
      } else if (item.intervalKm) {
        intervalDesc = `Tous les ${formatKm(item.intervalKm)}`;
      } else if (item.intervalMonths) {
        intervalDesc = `Tous les ${item.intervalMonths} mois`;
      } else {
        intervalDesc = `Intervalle libre`;
      }

      let dueDateHtml = '';
      if (due.status === 'grey') {
        dueDateHtml = `<span class="due-date-value text-muted">À renseigner</span>`;
      } else if (due.targetDate) {
        const formattedDate = formatDate(due.targetDate);
        if (due.isDateEstimated) {
          dueDateHtml = `<span class="due-date-value">vers le ${formattedDate} <span style="font-size:0.75rem; color:var(--text-muted); font-weight:500;">(estimation)</span></span>`;
        } else {
          dueDateHtml = `<span class="due-date-value">le ${formattedDate}</span>`;
        }
      } else {
        dueDateHtml = `<span class="due-date-value text-muted">Estimation indisponible</span>`;
      }

      let rangeHtml = '';
      if (due.isDateEstimated && due.rangeStart && due.rangeEnd && due.rangeStart !== due.rangeEnd) {
        rangeHtml = `
          <div class="due-range-line">
            <span>Fourchette :</span>
            <span class="due-range-badge">entre le ${formatDate(due.rangeStart)} et le ${formatDate(due.rangeEnd)}</span>
          </div>
        `;
      }

      let wearPct = 0;
      if (item.intervalKm && item.lastKm !== null) {
        const elapsedKm = Math.max(0, engine.effectiveCurrentKm - item.lastKm);
        wearPct = Math.min(100, Math.round((elapsedKm / item.intervalKm) * 100));
      } else if (item.intervalMonths && item.lastDate !== null) {
        const elapsedDays = Math.max(0, getDaysElapsed(item.lastDate));
        const totalDays = item.intervalMonths * 30.4375;
        wearPct = Math.min(100, Math.round((elapsedDays / totalDays) * 100));
      }

      let progressHtml = '';
      if (due.status !== 'grey') {
        progressHtml = `
          <div class="item-progress-wrapper">
            <div class="progress-header">
              <span>Usure / Intervalle parcouru</span>
              <span>${wearPct}%</span>
            </div>
            <div class="progress-track">
              <div class="progress-bar-fill progress-fill-${due.status}" style="width: ${wearPct}%;"></div>
            </div>
          </div>
        `;
      }

      let metricsHtml = '';
      if (due.status !== 'grey') {
        let kmMetricText = '--';
        let kmMetricClass = '';
        if (due.remainingKm !== null) {
          if (due.remainingKm < 0) {
            kmMetricText = `Dépassé de ${formatKm(Math.abs(due.remainingKm))}`;
            kmMetricClass = 'metric-danger';
          } else if (due.remainingKm <= 1000) {
            kmMetricText = `Reste ${formatKm(due.remainingKm)}`;
            kmMetricClass = 'metric-warning';
          } else {
            kmMetricText = `Reste ${formatKm(due.remainingKm)}`;
          }
        } else {
          kmMetricText = 'Non basé sur km';
        }

        let daysMetricText = '--';
        let daysMetricClass = '';
        if (due.remainingDays !== null) {
          if (due.remainingDays < 0) {
            daysMetricText = `Dépassé de ${Math.abs(due.remainingDays)} j`;
            daysMetricClass = 'metric-danger';
          } else if (due.remainingDays <= 30) {
            daysMetricText = `Reste ${due.remainingDays} j`;
            daysMetricClass = 'metric-warning';
          } else {
            daysMetricText = `Reste ${due.remainingDays} j`;
          }
        } else {
          daysMetricText = 'Date non fixée';
        }

        metricsHtml = `
          <div class="item-metrics">
            <div class="metric-pill">
              <span class="metric-pill-label">Kilomètres</span>
              <span class="metric-pill-val ${kmMetricClass}">${kmMetricText}</span>
            </div>
            <div class="metric-pill">
              <span class="metric-pill-label">Délai calendaire</span>
              <span class="metric-pill-val ${daysMetricClass}">${daysMetricText}</span>
            </div>
          </div>
        `;
      }

      let lastDoneText = 'Non renseigné';
      if (item.lastKm !== null && item.lastDate) {
        lastDoneText = `${formatKm(item.lastKm)} le ${formatDate(item.lastDate)}`;
      } else if (item.lastKm !== null) {
        lastDoneText = `${formatKm(item.lastKm)}`;
      } else if (item.lastDate) {
        lastDoneText = `Le ${formatDate(item.lastDate)}`;
      }

      card.innerHTML = `
        <div class="item-card-top">
          <div class="item-info">
            <span class="item-name">${escapeHtml(item.name)}</span>
            <span class="item-interval">${escapeHtml(intervalDesc)}</span>
          </div>
          ${badgeHtml}
        </div>

        <div class="item-due-box">
          <div class="due-primary-line">
            <span class="due-date-label">Prochaine échéance :</span>
            ${dueDateHtml}
          </div>
          ${rangeHtml}
        </div>

        ${progressHtml}

        ${metricsHtml}

        <div class="item-card-bottom">
          <span class="item-last-done-text">Dernier : ${lastDoneText}</span>
          <div class="item-actions">
            <button type="button" class="btn-sm btn-export-item-ics" data-id="${item.id}" title="Ajouter cette échéance à mon calendrier (.ics)">📅 Agenda</button>
            <button type="button" class="btn-sm btn-done-today btn-open-done" data-id="${item.id}">✅ Fait aujourd'hui</button>
            <button type="button" class="btn-sm btn-edit-maint" data-id="${item.id}">Modifier</button>
          </div>
        </div>
      `;

      grid.appendChild(card);
    });
  }

  // Écouteurs d'actions (communs au tableau et aux fiches)
  container.querySelectorAll('.btn-export-item-ics').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      exportSingleMaintenanceItemIcs(id);
    });
  });

  container.querySelectorAll('.btn-open-done').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      openDoneModal(id);
    });
  });

  container.querySelectorAll('.btn-edit-maint').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      openEditMaintenanceItemModal(id);
    });
  });
}

// ============================================================================
// ÉTAPE 3b : ÉCRAN HABITUDES & GRAPHIQUES SVG NATIFS
// ============================================================================

/**
 * Génère un graphique en barres au format SVG natif réactif
 */
function generateSvgBarChart(data, options = {}) {
  if (!data || data.length === 0) {
    return '<div style="text-align:center; padding: 40px; color: var(--text-muted); font-size: 0.9rem;">Aucune donnée enregistrée pour cette période.</div>';
  }

  const width = options.width || 500;
  const height = options.height || 200;
  const paddingBottom = 32;
  const paddingTop = 26;
  const paddingLeft = 40;
  const paddingRight = 16;

  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;

  const maxVal = Math.max(...data.map(d => d.value), 20);
  const avgVal = data.reduce((acc, d) => acc + d.value, 0) / data.length;

  const barCount = data.length;
  const totalSlot = chartW / barCount;
  const barWidth = Math.max(12, Math.min(36, totalSlot * 0.65));

  // Lignes de guidage horizontales
  const gridRatios = [0.33, 0.66, 1.0];
  const gridLines = gridRatios.map(ratio => {
    const val = Math.round(maxVal * ratio);
    const y = paddingTop + chartH * (1 - ratio);
    return `
      <line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" class="grid-line" />
      <text x="${paddingLeft - 6}" y="${y + 3}" text-anchor="end" font-size="9">${val}</text>
    `;
  }).join('');

  // Ligne de moyenne en pointillés
  let avgLineSvg = '';
  if (options.showAvg && avgVal > 0) {
    const yAvg = paddingTop + chartH * (1 - (avgVal / maxVal));
    avgLineSvg = `
      <line x1="${paddingLeft}" y1="${yAvg}" x2="${width - paddingRight}" y2="${yAvg}" class="avg-line" />
      <text x="${width - paddingRight}" y="${yAvg - 6}" text-anchor="end" font-size="10" font-weight="700" fill="var(--warning)">Moy : ${Math.round(avgVal)} ${options.unit || 'km'}</text>
    `;
  }

  // Barres individuelles
  const barsSvg = data.map((d, idx) => {
    const x = paddingLeft + idx * totalSlot + (totalSlot - barWidth) / 2;
    const barH = Math.max(4, (d.value / maxVal) * chartH);
    const y = paddingTop + chartH - barH;
    const isCurrent = d.isHighlight;
    const fillClass = isCurrent ? 'bar bar-highlight' : 'bar';

    return `
      <g class="bar-group">
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" rx="4" class="${fillClass}">
          <title>${d.label} : ${Math.round(d.value)} ${options.unit || 'km'}</title>
        </rect>
        <text x="${x + barWidth / 2}" y="${y - 6}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--text-main)">${Math.round(d.value)}</text>
        <text x="${x + barWidth / 2}" y="${height - 10}" text-anchor="middle" font-size="10">${d.label}</text>
      </g>
    `;
  }).join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" class="svg-chart" preserveAspectRatio="none">
      ${gridLines}
      ${barsSvg}
      ${avgLineSvg}
    </svg>
  `;
}

/** Calcule les séries hebdomadaires à partir de la timeline */
function getWeeklyChartData(timeline) {
  if (!timeline || timeline.length === 0) return [];

  const total = timeline.length;
  const numWeeks = Math.min(8, Math.max(1, Math.ceil(total / 7)));
  const weeks = [];

  for (let w = 0; w < numWeeks; w++) {
    const endIdx = total - w * 7;
    const startIdx = Math.max(0, endIdx - 7);
    if (startIdx >= endIdx) break;

    const slice = timeline.slice(startIdx, endIdx);
    const sumKm = slice.reduce((acc, d) => acc + d.km, 0);
    const label = w === 0 ? 'Actuel' : `S-${w}`;

    weeks.unshift({
      label: label,
      value: sumKm,
      isHighlight: w === 0
    });
  }

  return weeks;
}

/** Calcule les séries mensuelles à partir de la timeline */
function getMonthlyChartData(timeline) {
  if (!timeline || timeline.length === 0) return [];
  const monthMap = {};
  const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];

  timeline.forEach(item => {
    const parts = item.date.split('-');
    const key = `${parts[0]}-${parts[1]}`;
    if (!monthMap[key]) {
      const monthIdx = parseInt(parts[1], 10) - 1;
      monthMap[key] = { label: monthNames[monthIdx], value: 0 };
    }
    monthMap[key].value += item.km;
  });

  return Object.values(monthMap).slice(-6);
}

/** Rendu complet de l'écran Habitudes */
function renderHabitudesScreen(vehicle, engine) {
  if (!vehicle) return;

  // KPIs principaux
  const kpiDaily = document.getElementById('kpiDaily');
  const kpiWeekly = document.getElementById('kpiWeekly');
  const kpiMonthly = document.getElementById('kpiMonthly');
  const kpiAcc = document.getElementById('kpiAccuracy');
  const kpiAccSub = document.getElementById('kpiAccuracySub');

  if (kpiDaily) kpiDaily.textContent = engine.hasSufficientData ? `${Math.round(engine.dailyRate)} km` : 'Estimation indisponible';
  if (kpiWeekly) kpiWeekly.textContent = engine.hasSufficientData ? `${Math.round(engine.weeklyRate)} km` : 'Estimation indisponible';
  if (kpiMonthly) kpiMonthly.textContent = engine.hasSufficientData ? `${Math.round(engine.monthlyRate)} km` : 'Estimation indisponible';

  if (kpiAcc) {
    if (engine.accuracy !== null) {
      kpiAcc.textContent = `±${engine.accuracy} km`;
      if (kpiAccSub) kpiAccSub.textContent = `Écart moyen sur vos relevés`;
    } else {
      kpiAcc.textContent = `En calibrage`;
      if (kpiAccSub) kpiAccSub.textContent = `Calculé après plusieurs relevés`;
    }
  }

  // Comparaison kilométrage réel vs estimé
  const lastLog = vehicle.kmLog && vehicle.kmLog.length > 0 ? vehicle.kmLog[vehicle.kmLog.length - 1] : null;
  const habReal = document.getElementById('habLastRealKm');
  const habEst = document.getElementById('habEstimatedKm');
  const habNote = document.getElementById('habEstimatedNote');

  if (habReal && lastLog) {
    habReal.textContent = `${formatKm(lastLog.km)} (le ${formatDate(lastLog.date)})`;
  }
  if (habEst) {
    habEst.textContent = formatKm(engine.effectiveCurrentKm);
  }
  if (habNote) {
    if (engine.isEstimated) {
      habNote.textContent = `+${engine.effectiveCurrentKm - lastLog.km} km estimés sur les ${engine.daysSinceLastLog} jours écoulés sans relevé.`;
    } else {
      habNote.textContent = `Votre relevé est à jour pour la journée d'aujourd'hui.`;
    }
  }

  // Graphiques SVG
  const timeline = buildDailyTimeline(vehicle.kmLog);
  const weeksData = getWeeklyChartData(timeline);
  const monthsData = getMonthlyChartData(timeline);

  const weeksContainer = document.getElementById('svgWeeksContainer');
  const monthsContainer = document.getElementById('svgMonthsContainer');

  if (weeksContainer) {
    weeksContainer.innerHTML = generateSvgBarChart(weeksData, { unit: 'km', showAvg: true });
  }
  if (monthsContainer) {
    monthsContainer.innerHTML = generateSvgBarChart(monthsData, { unit: 'km', showAvg: true });
  }

  // Schéma Semaine vs Week-end
  const patternCard = document.getElementById('patternCard');
  const badgePattern = document.getElementById('patternStatusBadge');
  const weekdayBar = document.getElementById('patternWeekdayBar');
  const weekendBar = document.getElementById('patternWeekendBar');
  const weekdayVal = document.getElementById('patternWeekdayVal');
  const weekendVal = document.getElementById('patternWeekendVal');
  const patternExpl = document.getElementById('patternExplanation');

  if (engine.weekdayWeekendPattern) {
    if (badgePattern) {
      badgePattern.textContent = 'Actif (8+ sem.)';
      badgePattern.className = 'chart-badge status-badge-green';
    }

    const weekdayAvg = engine.dailyRate * engine.weekdayFactor;
    const weekendAvg = engine.dailyRate * engine.weekendFactor;
    const maxDay = Math.max(weekdayAvg, weekendAvg, 1);

    if (weekdayVal) weekdayVal.textContent = `${Math.round(weekdayAvg)} km/j`;
    if (weekendVal) weekendVal.textContent = `${Math.round(weekendAvg)} km/j`;

    if (weekdayBar) weekdayBar.style.width = `${Math.round((weekdayAvg / maxDay) * 100)}%`;
    if (weekendBar) weekendBar.style.width = `${Math.round((weekendAvg / maxDay) * 100)}%`;

    if (patternExpl) {
      patternExpl.textContent = 'L\'algorithme intègre la différence de roulage entre jours de travail et week-end dans la prédiction des échéances.';
    }
  } else {
    if (badgePattern) {
      badgePattern.textContent = 'Inactif (< 8 sem.)';
      badgePattern.className = 'chart-badge status-badge-grey';
    }
    if (weekdayVal) weekdayVal.textContent = `${Math.round(engine.dailyRate)} km/j`;
    if (weekendVal) weekendVal.textContent = `${Math.round(engine.dailyRate)} km/j`;
    if (weekdayBar) weekdayBar.style.width = '50%';
    if (weekendBar) weekendBar.style.width = '50%';
    if (patternExpl) {
      patternExpl.textContent = 'Cette distinction s\'activera automatiquement dès que vous aurez accumulé 8 semaines d\'historique de relevés.';
    }
  }
}

// Navigation entre les écrans (Bottom Nav)
let currentView = 'dashboard';

function switchView(viewName) {
  currentView = viewName;
  const viewDash = document.getElementById('viewDashboard');
  const viewHab = document.getElementById('viewHabitudes');
  const viewHist = document.getElementById('viewHistory');
  const viewSet = document.getElementById('viewSettings');
  const tabDash = document.getElementById('tabDashboard');
  const tabHab = document.getElementById('tabHabitudes');
  const tabHist = document.getElementById('tabHistory');
  const tabSet = document.getElementById('tabSettings');

  // Masquer toutes les vues
  if (viewDash) viewDash.classList.add('hidden');
  if (viewHab) viewHab.classList.add('hidden');
  if (viewHist) viewHist.classList.add('hidden');
  if (viewSet) viewSet.classList.add('hidden');

  // Désactiver tous les onglets
  if (tabDash) tabDash.classList.remove('active');
  if (tabHab) tabHab.classList.remove('active');
  if (tabHist) tabHist.classList.remove('active');
  if (tabSet) tabSet.classList.remove('active');

  if (viewName === 'habitudes') {
    if (viewHab) viewHab.classList.remove('hidden');
    if (tabHab) tabHab.classList.add('active');

    const vehicle = getActiveVehicle();
    if (vehicle) {
      const engine = computePredictionEngine(vehicle);
      renderHabitudesScreen(vehicle, engine);
    }
  } else if (viewName === 'history') {
    if (viewHist) viewHist.classList.remove('hidden');
    if (tabHist) tabHist.classList.add('active');

    renderHistoryScreen();
  } else if (viewName === 'settings') {
    if (viewSet) viewSet.classList.remove('hidden');
    if (tabSet) tabSet.classList.add('active');

    renderSettingsScreen();
  } else {
    // dashboard
    if (viewDash) viewDash.classList.remove('hidden');
    if (tabDash) tabDash.classList.add('active');

    renderApp();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================================================
// 10. GESTION DES ÉLÉMENTS D'ENTRETIEN (MODAL CRUD)
// ============================================================================

let currentMaintMode = 'km_months';

function setMaintenanceTypeMode(mode) {
  currentMaintMode = mode;
  const btnKm = document.getElementById('btnTypeKmMonths');
  const btnDate = document.getElementById('btnTypeDateOnly');
  const groupKm = document.getElementById('groupIntervalKm');
  const groupLastKm = document.getElementById('groupLastKm');

  if (mode === 'date_only') {
    if (btnDate) btnDate.classList.add('active');
    if (btnKm) btnKm.classList.remove('active');
    if (groupKm) groupKm.classList.add('hidden');
    if (groupLastKm) groupLastKm.classList.add('hidden');
  } else {
    if (btnKm) btnKm.classList.add('active');
    if (btnDate) btnDate.classList.remove('active');
    if (groupKm) groupKm.classList.remove('hidden');
    if (groupLastKm) groupLastKm.classList.remove('hidden');
  }
}

function openAddMaintenanceItemModal() {
  document.getElementById('maintModalTitle').textContent = "Ajouter un élément d'entretien";
  document.getElementById('editMaintItemId').value = '';
  document.getElementById('maintName').value = '';
  document.getElementById('maintIntervalKm').value = '10000';
  document.getElementById('maintIntervalMonths').value = '12';
  document.getElementById('maintLastKm').value = '';
  document.getElementById('maintLastDate').value = '';
  document.getElementById('btnDeleteMaintItem').classList.add('hidden');

  setMaintenanceTypeMode('km_months');
  document.getElementById('maintenanceItemModal').classList.remove('hidden');
  document.getElementById('maintName').focus();
}

function openEditMaintenanceItemModal(itemId) {
  const vehicle = getActiveVehicle();
  if (!vehicle || !vehicle.maintenanceItems) return;

  const item = vehicle.maintenanceItems.find(i => i.id === itemId);
  if (!item) return;

  document.getElementById('maintModalTitle').textContent = `Modifier ${item.name}`;
  document.getElementById('editMaintItemId').value = item.id;
  document.getElementById('maintName').value = item.name;
  document.getElementById('maintIntervalKm').value = item.intervalKm || '';
  document.getElementById('maintIntervalMonths').value = item.intervalMonths || '12';
  document.getElementById('maintLastKm').value = item.lastKm !== null ? item.lastKm : '';
  document.getElementById('maintLastDate').value = item.lastDate || '';

  if (item.intervalKm === null) {
    setMaintenanceTypeMode('date_only');
  } else {
    setMaintenanceTypeMode('km_months');
  }

  document.getElementById('btnDeleteMaintItem').classList.remove('hidden');
  document.getElementById('maintenanceItemModal').classList.remove('hidden');
}

function closeMaintenanceItemModal() {
  document.getElementById('maintenanceItemModal').classList.add('hidden');
}

function handleMaintenanceItemSubmit(e) {
  e.preventDefault();
  const vehicle = getActiveVehicle();
  if (!vehicle) return;

  const editId = document.getElementById('editMaintItemId').value;
  const name = document.getElementById('maintName').value.trim();
  const monthsVal = parseInt(document.getElementById('maintIntervalMonths').value, 10);
  const kmRaw = document.getElementById('maintIntervalKm').value.trim();
  const lastKmRaw = document.getElementById('maintLastKm').value.trim();
  const lastDate = document.getElementById('maintLastDate').value;

  if (!name) {
    showToast("Le nom de l'entretien est requis.", 'warning');
    return;
  }

  if (isNaN(monthsVal) || monthsVal <= 0) {
    showToast("L'intervalle en mois doit être supérieur à 0.", 'warning');
    return;
  }

  let intervalKm = null;
  let lastKm = null;

  if (currentMaintMode === 'km_months') {
    const kmVal = parseInt(kmRaw, 10);
    if (isNaN(kmVal) || kmVal <= 0) {
      showToast("Veuillez saisir un intervalle kilométrique valide.", 'warning');
      return;
    }
    intervalKm = kmVal;

    if (lastKmRaw !== '') {
      const lKm = parseInt(lastKmRaw, 10);
      if (!isNaN(lKm) && lKm >= 0) {
        lastKm = lKm;
      }
    }
  }

  if (!vehicle.maintenanceItems) vehicle.maintenanceItems = [];

  let itemToSync = null;
  if (editId) {
    const existing = vehicle.maintenanceItems.find(i => i.id === editId);
    if (existing) {
      existing.name = name;
      existing.intervalKm = intervalKm;
      existing.intervalMonths = monthsVal;
      existing.lastKm = lastKm;
      existing.lastDate = lastDate || null;
      itemToSync = existing;
      showToast(`Entretien "${name}" mis à jour.`, 'success');
    }
  } else {
    const newItem = {
      id: 'maint_' + Date.now(),
      name: name,
      intervalKm: intervalKm,
      intervalMonths: monthsVal,
      lastKm: lastKm,
      lastDate: lastDate || null
    };
    vehicle.maintenanceItems.push(newItem);
    itemToSync = newItem;
    showToast(`Entretien "${name}" ajouté avec succès.`, 'success');
  }

  saveState();

  if (itemToSync && window.FamilyRoom && typeof window.FamilyRoom.isRoomActive === 'function' && window.FamilyRoom.isRoomActive()) {
    itemToSync.vehicleId = vehicle.id;
    window.FamilyRoom.saveMaintenanceItem(itemToSync).catch(err => console.warn('Erreur enregistrement entretien salle:', err));
  }

  closeMaintenanceItemModal();
  renderApp();
}

function handleDeleteMaintenanceItem() {
  const editId = document.getElementById('editMaintItemId').value;
  if (!editId) return;

  const vehicle = getActiveVehicle();
  if (!vehicle || !vehicle.maintenanceItems) return;

  const item = vehicle.maintenanceItems.find(i => i.id === editId);
  if (!item) return;

  const confirmDel = window.confirm(`Supprimer l'élément d'entretien "${item.name}" ?`);
  if (!confirmDel) return;

  if (window.FamilyRoom && typeof window.FamilyRoom.isRoomActive === 'function' && window.FamilyRoom.isRoomActive()) {
    window.FamilyRoom.deleteMaintenanceItem(editId).catch(err => console.warn('Erreur suppression entretien salle:', err));
  }

  vehicle.maintenanceItems = vehicle.maintenanceItems.filter(i => i.id !== editId);
  saveState();
  closeMaintenanceItemModal();
  showToast(`Entretien "${item.name}" supprimé.`, 'info');
  renderApp();
}

// ============================================================================
// ÉTAPE 4 : MODAL "FAIT AUJOURD'HUI" & ENREGISTREMENT DE MAINTENANCE
// ============================================================================

function openDoneModal(itemId) {
  const vehicle = getActiveVehicle();
  if (!vehicle || !vehicle.maintenanceItems) return;

  const item = vehicle.maintenanceItems.find(i => i.id === itemId);
  if (!item) return;

  const todayIso = getTodayIsoString();

  document.getElementById('doneItemId').value = item.id;
  document.getElementById('doneItemNameDisplay').textContent = item.name;

  const dateInput = document.getElementById('doneDateInput');
  dateInput.value = todayIso;
  dateInput.max = todayIso;
  if (vehicle.year) {
    dateInput.min = `${vehicle.year}-01-01`;
  }

  const kmInput = document.getElementById('doneKmInput');
  kmInput.value = vehicle.currentKm !== undefined && vehicle.currentKm !== null ? vehicle.currentKm : '';
  kmInput.min = '0';

  document.getElementById('doneCostInput').value = '';
  document.getElementById('doneGarageInput').value = '';
  document.getElementById('doneNotesInput').value = '';

  document.getElementById('doneModal').classList.remove('hidden');
  setTimeout(() => {
    document.getElementById('doneCostInput').focus();
  }, 100);
}

function closeDoneModal() {
  document.getElementById('doneModal').classList.add('hidden');
}

function handleDoneFormSubmit(e) {
  e.preventDefault();
  const vehicle = getActiveVehicle();
  if (!vehicle) return;

  const itemId = document.getElementById('doneItemId').value;
  const item = vehicle.maintenanceItems ? vehicle.maintenanceItems.find(i => i.id === itemId) : null;
  if (!item) {
    showToast("Élément d'entretien introuvable.", 'error');
    return;
  }

  const dateVal = String(document.getElementById('doneDateInput').value || '').trim();
  const kmRaw = String(document.getElementById('doneKmInput').value ?? '').trim();
  const costRaw = String(document.getElementById('doneCostInput').value ?? '').trim();
  const garageVal = String(document.getElementById('doneGarageInput').value || '').trim();
  const notesVal = String(document.getElementById('doneNotesInput').value || '').trim();

  // 1. Validation de la date
  if (!dateVal) {
    showToast("La date d'intervention est obligatoire.", 'warning');
    return;
  }

  const todayIso = getTodayIsoString();
  if (dateVal > todayIso) {
    showToast("La date d'entretien ne peut pas être dans le futur.", 'warning');
    return;
  }

  if (vehicle.year && parseInt(dateVal.split('-')[0], 10) < vehicle.year) {
    showToast(`La date ne peut pas être antérieure à l'année du véhicule (${vehicle.year}).`, 'warning');
    return;
  }

  // 2. Validation du kilométrage
  const kmVal = parseInt(kmRaw, 10);
  if (isNaN(kmVal) || kmVal < 0) {
    showToast("Veuillez saisir un kilométrage valide (≥ 0).", 'warning');
    return;
  }

  if (dateVal === todayIso && kmVal < vehicle.currentKm) {
    showToast("Le kilométrage ne peut pas être inférieur au kilométrage actuel du véhicule.", 'warning');
    return;
  }

  // 3. Validation du coût
  let costVal = null;
  if (costRaw !== '') {
    const c = parseFloat(costRaw);
    if (isNaN(c) || c < 0) {
      showToast("Le montant du coût doit être supérieur ou égal à 0.", 'warning');
      return;
    }
    costVal = Math.round(c);
  }

  // 4. Réinitialisation de l'échéance de l'élément d'entretien
  item.lastDate = dateVal;
  item.lastKm = kmVal;

  // Si le kilométrage saisi dépasse le kilométrage actuel du véhicule
  if (kmVal > vehicle.currentKm) {
    vehicle.currentKm = kmVal;

    if (!vehicle.kmLog) vehicle.kmLog = [];
    const existingLogIdx = vehicle.kmLog.findIndex(l => l.date === dateVal);
    if (existingLogIdx >= 0) {
      // Même jour : conserver le predictedKm d'origine de cette journée
      vehicle.kmLog[existingLogIdx].km = kmVal;
    } else {
      const realPredicted = typeof predictKmForDate === 'function' ? predictKmForDate(vehicle, dateVal) : null;
      vehicle.kmLog.push({
        date: dateVal,
        km: kmVal,
        predictedKm: (typeof realPredicted === 'number' && !isNaN(realPredicted)) ? realPredicted : null
      });
      vehicle.kmLog.sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  const currentProfile = (window.FamilyRoom && typeof window.FamilyRoom.getStoredRoomProfile === 'function')
    ? window.FamilyRoom.getStoredRoomProfile()
    : null;
  const currentAuthorName = (currentProfile && currentProfile.myName) ? currentProfile.myName : null;

  // 5. Création de l'enregistrement d'historique (avec auteur si en salle partagée)
  const record = {
    id: 'hist_' + Date.now(),
    vehicleId: vehicle.id,
    type: item.name,
    date: dateVal,
    km: kmVal,
    cost: costVal,
    garage: garageVal || '',
    notes: notesVal || '',
    authorName: currentAuthorName
  };

  if (!appState.history) appState.history = [];
  appState.history.unshift(record);

  saveState();

  // Synchronisation avec la salle familiale si active (Point 10)
  if (window.FamilyRoom && typeof window.FamilyRoom.isRoomActive === 'function' && window.FamilyRoom.isRoomActive()) {
    window.FamilyRoom.recordHistoryEntry(record, item).catch(err => {
      console.warn("Erreur synchronisation intervention salle:", err);
    });
  }

  closeDoneModal();
  showToast(`✅ Entretien "${item.name}" enregistré avec succès !`, 'success');

  // Actualiser l'interface
  renderApp();
  if (currentView === 'history') {
    renderHistoryScreen();
  }
}

// ============================================================================
// ÉTAPE 4 : ÉCRAN HISTORIQUE & SYNTHÈSE DES DÉPENSES
// ============================================================================

function renderHistoryScreen() {
  const container = document.getElementById('historyContainer') || document.getElementById('historyList');
  const selVehicle = document.getElementById('histFilterVehicle');
  const selType = document.getElementById('histFilterType');
  const totalCostEl = document.getElementById('histTotalCost');
  const totalCountEl = document.getElementById('histTotalCount');

  if (!container) return;

  // Si un seul véhicule, s'assurer que les historiques pointent bien vers son id
  if (appState.vehicles && appState.vehicles.length === 1 && appState.history && appState.history.length > 0) {
    const singleVehId = appState.vehicles[0].id;
    appState.history.forEach(h => {
      if (!appState.vehicles.some(v => v.id === h.vehicleId)) {
        h.vehicleId = singleVehId;
      }
    });
  }

  const history = appState.history || [];

  // Mémoriser la sélection active
  const currentVehFilter = selVehicle ? selVehicle.value : 'all';
  const currentTypeFilter = selType ? selType.value : 'all';

  // Mettre à jour la liste des véhicules dans le filtre
  if (selVehicle) {
    selVehicle.innerHTML = `<option value="all">Tous les véhicules (${appState.vehicles.length})</option>`;
    appState.vehicles.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = `${v.name} (${v.brand} ${v.model})`;
      if (v.id === currentVehFilter) opt.selected = true;
      selVehicle.appendChild(opt);
    });
  }

  // Mettre à jour la liste des types dans le filtre
  if (selType) {
    const distinctTypes = new Set();
    history.forEach(h => {
      if (h.type) distinctTypes.add(h.type);
    });
    DEFAULT_MAINTENANCE_TYPES.forEach(d => distinctTypes.add(d.name));
    appState.vehicles.forEach(v => {
      if (v.maintenanceItems) {
        v.maintenanceItems.forEach(mi => distinctTypes.add(mi.name));
      }
    });

    const sortedTypes = Array.from(distinctTypes).sort();
    selType.innerHTML = `<option value="all">Tous les types d'entretien</option>`;
    sortedTypes.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      if (t === currentTypeFilter) opt.selected = true;
      selType.appendChild(opt);
    });
  }

  const selectedVehId = selVehicle ? selVehicle.value : 'all';
  const selectedType = selType ? selType.value : 'all';

  // Filtrer l'historique
  const filtered = history.filter(h => {
    if (selectedVehId !== 'all' && h.vehicleId !== selectedVehId) return false;
    if (selectedType !== 'all' && h.type !== selectedType) return false;
    return true;
  });

  // Tri par date décroissante
  filtered.sort((a, b) => b.date.localeCompare(a.date));

  // Calcul du coût total & du nombre d'opérations
  const totalCost = filtered.reduce((sum, h) => sum + (Number(h.cost) || 0), 0);
  if (totalCostEl) totalCostEl.textContent = formatCost(totalCost);
  if (totalCountEl) totalCountEl.textContent = `${filtered.length} intervention${filtered.length > 1 ? 's' : ''}`;

  const countBadge = document.getElementById('historyCountBadge');
  if (countBadge) countBadge.textContent = `${filtered.length} intervention${filtered.length > 1 ? 's' : ''}`;

  container.innerHTML = '';

  if (filtered.length === 0) {
    if (!appState.history || appState.history.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 36px 16px; background: var(--bg-card); border: 1.5px dashed var(--border-color); border-radius: var(--radius-lg); display: flex; flex-direction: column; align-items: center; gap: 12px;">
          <span style="font-size: 2.6rem;">📜</span>
          <strong style="color: var(--text-main); font-size: 1.05rem;">Historique vide</strong>
          <p style="font-size: 0.88rem; max-width: 380px; line-height: 1.45; margin: 0;">
            Aucune opération n'a encore été enregistrée. Utilisez le bouton <strong>« ✅ Fait aujourd'hui »</strong> sur une carte d'entretien du tableau de bord pour l'enregistrer ici, ou chargez les données d'exemple.
          </p>
          <div style="display: flex; gap: 10px; margin-top: 6px; flex-wrap: wrap; justify-content: center;">
            <button type="button" class="btn-primary btn-sm" id="btnGoToDashboardFromHist">
              📋 Aller au tableau de bord
            </button>
            <button type="button" class="btn-secondary btn-sm" id="btnLoadDemoHistory">
              ✨ Charger 4 interventions d'exemple
            </button>
          </div>
        </div>
      `;

      const btnGo = document.getElementById('btnGoToDashboardFromHist');
      if (btnGo) btnGo.addEventListener('click', () => switchView('dashboard'));

      const btnSeed = document.getElementById('btnLoadDemoHistory');
      if (btnSeed) {
        btnSeed.addEventListener('click', () => {
          const vehId = appState.activeVehicleId || (appState.vehicles[0] ? appState.vehicles[0].id : null);
          appState.history = createSeedHistory(vehId);
          appState.isDemo = true;
          saveState();
          showToast('4 interventions d\'exemple chargées avec succès !', 'success');
          renderHistoryScreen();
        });
      }
    } else {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 40px 16px; background: var(--bg-card); border: 1px dashed var(--border-color); border-radius: var(--radius-md);">
          <span style="font-size: 2.2rem; display: block; margin-bottom: 8px;">🔍</span>
          <strong style="color: var(--text-main); font-size: 0.95rem;">Aucune intervention trouvée</strong>
          <p style="font-size: 0.85rem; margin-top: 4px;">Aucun entretien ne correspond aux filtres de sélection actuels.</p>
        </div>
      `;
    }
    return;
  }

  const prefs = getUiPreferences();
  updateViewToggleButtons('historyViewToggle', prefs.historyViewMode);

  if (prefs.historyViewMode === 'table') {
    // ==========================================
    // AFFICHAGE 1 : TABLEAU GLISSABLE (PAR DÉFAUT)
    // ==========================================
    const tableWrap = document.createElement('div');
    tableWrap.innerHTML = `
      <div class="table-scroll-hint"><span>👈 Défilement horizontal pour tout voir 👉</span></div>
      <div class="table-scroll-wrapper">
        <table class="app-data-table history-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Opération</th>
              <th>Véhicule</th>
              <th>Kilométrage</th>
              <th>Coût</th>
              <th>Lieu / Garage</th>
              <th>Notes</th>
              <th style="text-align: center;">Action</th>
            </tr>
          </thead>
          <tbody id="historyTableBody"></tbody>
        </table>
      </div>
    `;
    container.appendChild(tableWrap);
    const tbody = document.getElementById('historyTableBody');

    filtered.forEach(record => {
      const veh = appState.vehicles.find(v => v.id === record.vehicleId);
      const vehName = veh ? `${veh.name}` : 'Véhicule';

      const costHtml = (record.cost !== null && record.cost !== undefined)
        ? `<span class="table-cost-pill">💰 ${formatCost(record.cost)}</span>`
        : `<span style="color:var(--text-muted); font-size:0.8rem;">--</span>`;

      const garageHtml = record.garage
        ? `<span>🏢 ${escapeHtml(record.garage)}</span>`
        : `<span style="color:var(--text-muted); font-size:0.8rem;">--</span>`;

      const notesHtml = record.notes
        ? `<span class="table-col-sub" title="${escapeHtml(record.notes)}">📝 ${escapeHtml(record.notes)}</span>`
        : `<span style="color:var(--text-muted); font-size:0.8rem;">--</span>`;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${formatDate(record.date)}</strong></td>
        <td><strong class="table-col-name">${escapeHtml(record.type)}</strong></td>
        <td>
          <span class="table-col-sub">🚗 ${escapeHtml(vehName)}</span>
          ${record.authorName ? `<br><span class="table-col-sub" style="color:var(--primary); font-weight:600; font-size:0.75rem;">👤 ${escapeHtml(record.authorName)}</span>` : ''}
        </td>
        <td><span style="font-weight:700;">📍 ${formatKm(record.km)}</span></td>
        <td>${costHtml}</td>
        <td>${garageHtml}</td>
        <td>${notesHtml}</td>
        <td>
          <div class="table-actions-cell" style="justify-content: center;">
            <button type="button" class="btn-sm btn-delete-hist" data-id="${record.id}" style="color: var(--danger); border-color: rgba(239, 68, 68, 0.3);" title="Supprimer de l'historique">
              🗑️
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } else {
    // ==========================================
    // AFFICHAGE 2 : FICHES / CARTES
    // ==========================================
    const listDiv = document.createElement('div');
    listDiv.className = 'history-list';
    listDiv.id = 'historyList';
    container.appendChild(listDiv);

    filtered.forEach(record => {
      const card = document.createElement('div');
      card.className = 'history-card';

      const veh = appState.vehicles.find(v => v.id === record.vehicleId);
      const vehName = veh ? `${veh.name} (${veh.brand} ${veh.model})` : 'Véhicule';

      const costBadge = (record.cost !== null && record.cost !== undefined)
        ? `<span class="history-pill history-pill-cost">💰 ${formatCost(record.cost)}</span>`
        : '';

      const authorBadge = record.authorName
        ? `<span class="history-pill history-pill-author">👤 ${escapeHtml(record.authorName)}</span>`
        : '';

      const garageHtml = record.garage
        ? `<span class="history-pill">🏢 ${escapeHtml(record.garage)}</span>`
        : '';

      const notesHtml = record.notes
        ? `<div class="history-notes-box">📝 ${escapeHtml(record.notes)}</div>`
        : '';

      card.innerHTML = `
        <div class="history-card-header">
          <div>
            <span class="history-type-title">${escapeHtml(record.type)}</span>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
              🚗 ${escapeHtml(vehName)}
            </div>
          </div>
          <span class="history-date-badge">${formatDate(record.date)}</span>
        </div>

        <div class="history-card-pills">
          <span class="history-pill">📍 ${formatKm(record.km)}</span>
          ${costBadge}
          ${authorBadge}
          ${garageHtml}
        </div>

        ${notesHtml}

        <div class="history-card-footer">
          <span>Opération effectuée${record.authorName ? ` par <strong>${escapeHtml(record.authorName)}</strong>` : ''}</span>
          <button type="button" class="btn-sm btn-delete-hist" data-id="${record.id}" style="color: var(--danger); border-color: rgba(239, 68, 68, 0.3);">
            🗑️ Supprimer
          </button>
        </div>
      `;

      listDiv.appendChild(card);
    });
  }

  // Attacher écouteurs de suppression
  container.querySelectorAll('.btn-delete-hist').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      deleteHistoryRecord(id);
    });
  });
}

function deleteHistoryRecord(id) {
  const record = (appState.history || []).find(h => h.id === id);
  if (!record) return;

  const confirmDel = window.confirm(`Supprimer cette intervention "${record.type}" du ${formatDate(record.date)} de l'historique ?`);
  if (!confirmDel) return;

  if (window.FamilyRoom && typeof window.FamilyRoom.isRoomActive === 'function' && window.FamilyRoom.isRoomActive()) {
    window.FamilyRoom.deleteHistoryEntry(id).catch(err => console.warn('Erreur suppression historique salle:', err));
  }

  appState.history = appState.history.filter(h => h.id !== id);
  saveState();
  showToast("Intervention supprimée de l'historique.", 'info');
  renderHistoryScreen();
}

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================================
// ÉTAPE 5 : EXPORT CALENDRIER (.ICS / ICALENDAR RFC 5545)
// ============================================================================

/** Formate une date ISO YYYY-MM-DD en YYYYMMDD pour iCalendar */
function formatIcsDate(dateStr) {
  if (!dateStr) return '';
  return dateStr.replace(/-/g, '').slice(0, 8);
}

/** Génère un horodatage UTC au format YYYYMMDDTHHMMSSZ */
function getIcsTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

/** Échappe les caractères réservés selon RFC 5545 */
function escapeIcsText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

/**
 * Plie une ligne iCalendar à 75 octets maximum conformément au RFC 5545 (Section 3.1).
 * Chaque ligne de continuation débute par un saut de ligne CRLF et une espace.
 */
function foldIcsLine(line) {
  if (typeof TextEncoder === 'undefined') {
    if (line.length <= 75) return line;
    const parts = [line.slice(0, 75)];
    for (let i = 75; i < line.length; i += 74) {
      parts.push(' ' + line.slice(i, i + 74));
    }
    return parts.join('\r\n');
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(line);
  if (bytes.length <= 75) return line;

  const parts = [];
  let offset = 0;
  while (offset < bytes.length) {
    const maxLen = offset === 0 ? 75 : 74;
    let end = Math.min(offset + maxLen, bytes.length);
    if (end < bytes.length) {
      while (end > offset && (bytes[end] & 0xC0) === 0x80) {
        end--;
      }
    }
    const chunkStr = decoder.decode(bytes.slice(offset, end));
    parts.push(offset === 0 ? chunkStr : ' ' + chunkStr);
    offset = end;
  }
  return parts.join('\r\n');
}

/** Déclenche le téléchargement côté client d'un fichier .ics */
function downloadIcsFile(filename, content) {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return;
  }
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a);
    URL.revokeObjectURL(url);
  }, 250);
}

/** Génère le contenu iCalendar pour un seul élément d'entretien avec VALARM 7j et 1j */
function generateSingleItemIcs(vehicle, item, due) {
  if (!due || !due.targetDate) return null;

  const dtStamp = getIcsTimestamp();
  const dtStart = formatIcsDate(due.targetDate);
  const dtEnd = formatIcsDate(addDaysToDate(due.targetDate, 1));
  // UID stable pour permettre la mise à jour de l'événement lors des ré-imports
  const uid = `maint-${item.id}-${vehicle.id}@carnet-entretien`;

  const isEstimated = Boolean(due.isDateEstimated);
  const summary = `${item.name} - ${vehicle.brand} ${vehicle.model}${isEstimated ? ' (estimation)' : ''}`;

  const descParts = [
    `Entretien : ${item.name}`,
    `Véhicule : ${vehicle.name} (${vehicle.brand} ${vehicle.model}${vehicle.plate ? ' - ' + vehicle.plate : ''})`,
    `Date d'échéance : ${formatDate(due.targetDate)}${isEstimated ? ' (estimation adaptative)' : ''}`
  ];

  if (due.remainingKm !== null) {
    descParts.push(`Kilométrage restant : environ ${due.remainingKm} km`);
  }
  if (due.dueKm !== null) {
    descParts.push(`Kilométrage cible : ${formatKm(due.dueKm)}`);
  }
  if (isEstimated && due.rangeStart && due.rangeEnd && due.rangeStart !== due.rangeEnd) {
    descParts.push(`Fourchette estimée : entre le ${formatDate(due.rangeStart)} et le ${formatDate(due.rangeEnd)}`);
  }
  if (item.lastDate || item.lastKm !== null) {
    const lastDone = `${item.lastKm !== null ? formatKm(item.lastKm) : ''} ${item.lastDate ? 'le ' + formatDate(item.lastDate) : ''}`.trim();
    if (lastDone) descParts.push(`Dernière intervention : ${lastDone}`);
  }

  descParts.push('', 'Généré par Carnet d\'Entretien Automobile (PWA).');
  const description = descParts.join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Carnet d\'Entretien Automobile//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART;VALUE=DATE:${dtStart}`,
    `DTEND;VALUE=DATE:${dtEnd}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Rappel entretien dans 7 jours',
    'TRIGGER:-P7D',
    'END:VALARM',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Rappel entretien demain',
    'TRIGGER:-P1D',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ];

  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

/** Génère le contenu iCalendar pour toutes les échéances prévues d'un véhicule */
function generateAllItemsIcs(vehicle, itemsWithDue) {
  const todayIso = getTodayIsoString();
  // Choix architectural : l'export global n'inclut que les échéances à venir ou échues aujourd'hui (targetDate >= todayIso).
  // Les échéances antérieures sont exclues pour ne pas encombrer l'agenda avec des dates passées obsolètes.
  const valid = itemsWithDue.filter(x => x.due && x.due.targetDate && x.due.status !== 'grey' && x.due.targetDate >= todayIso);
  if (valid.length === 0) return null;

  const dtStamp = getIcsTimestamp();

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Carnet d\'Entretien Automobile//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];

  valid.forEach(({ item, due }) => {
    const dtStart = formatIcsDate(due.targetDate);
    const dtEnd = formatIcsDate(addDaysToDate(due.targetDate, 1));
    // UID stable pour synchroniser/mettre à jour les événements existants
    const uid = `maint-${item.id}-${vehicle.id}@carnet-entretien`;
    const isEstimated = Boolean(due.isDateEstimated);
    const summary = `${item.name} - ${vehicle.brand} ${vehicle.model}${isEstimated ? ' (estimation)' : ''}`;

    const descParts = [
      `Entretien : ${item.name}`,
      `Véhicule : ${vehicle.name} (${vehicle.brand} ${vehicle.model}${vehicle.plate ? ' - ' + vehicle.plate : ''})`,
      `Date d'échéance : ${formatDate(due.targetDate)}${isEstimated ? ' (estimation adaptative)' : ''}`
    ];
    if (due.remainingKm !== null) {
      descParts.push(`Kilométrage restant : environ ${due.remainingKm} km`);
    }
    if (due.dueKm !== null) {
      descParts.push(`Kilométrage cible : ${formatKm(due.dueKm)}`);
    }
    if (isEstimated && due.rangeStart && due.rangeEnd && due.rangeStart !== due.rangeEnd) {
      descParts.push(`Fourchette estimée : entre le ${formatDate(due.rangeStart)} et le ${formatDate(due.rangeEnd)}`);
    }
    descParts.push('', 'Généré par Carnet d\'Entretien Automobile.');
    const description = descParts.join('\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART;VALUE=DATE:${dtStart}`,
      `DTEND;VALUE=DATE:${dtEnd}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Rappel entretien dans 7 jours',
      'TRIGGER:-P7D',
      'END:VALARM',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Rappel entretien demain',
      'TRIGGER:-P1D',
      'END:VALARM',
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

/** Génère un rappel récurrent (RRULE) pour la saisie du kilométrage */
function generateRecurringReminderIcs(vehicle) {
  const dtStamp = getIcsTimestamp();
  const todayIso = getTodayIsoString();
  const dtStart = formatIcsDate(todayIso);
  const dtEnd = formatIcsDate(addDaysToDate(todayIso, 1));
  const uid = `rappel-km-${vehicle.id}@carnet-entretien`;

  let freq = 'DAILY';
  let freqLabel = 'tous les 15 jours';
  let rrule = 'RRULE:FREQ=DAILY;INTERVAL=15';
  if (vehicle.updateFrequency === 'daily') {
    freqLabel = 'quotidien';
    rrule = 'RRULE:FREQ=DAILY';
  } else if (vehicle.updateFrequency === 'weekly') {
    freqLabel = 'hebdomadaire';
    rrule = 'RRULE:FREQ=WEEKLY';
  }

  const summary = `Mettre à jour le kilométrage - ${vehicle.name}`;
  const description = `Pensez à relever le compteur de votre véhicule ${vehicle.name} (${vehicle.brand} ${vehicle.model}) et à mettre à jour votre Carnet d'Entretien pour recalibrer vos échéances.\n\nRappel ${freqLabel} configuré depuis Carnet d'Entretien.`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Carnet d\'Entretien Automobile//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART;VALUE=DATE:${dtStart}`,
    `DTEND;VALUE=DATE:${dtEnd}`,
    rrule,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Rappel relevé kilométrique',
    'TRIGGER:-PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ];

  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

function exportSingleMaintenanceItemIcs(itemId) {
  const vehicle = getActiveVehicle();
  if (!vehicle || !vehicle.maintenanceItems) return;

  const item = vehicle.maintenanceItems.find(i => i.id === itemId);
  if (!item) return;

  const engine = computePredictionEngine(vehicle);
  const due = calculateItemDueStatus(vehicle, item, engine);

  if (!due || !due.targetDate || due.status === 'grey') {
    showToast(`Échéance pour "${item.name}" non définie. Renseignez la date ou le kilométrage avant d'exporter.`, 'warning');
    return;
  }

  const ics = generateSingleItemIcs(vehicle, item, due);
  if (!ics) {
    showToast("Impossible de générer le fichier d'agenda.", 'error');
    return;
  }

  const safeName = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const filename = `entretien_${safeName}.ics`;
  downloadIcsFile(filename, ics);
  showToast(`Échéance "${item.name}" téléchargée (.ics) !`, 'success');
}

function exportAllMaintenanceItemsIcs() {
  const vehicle = getActiveVehicle();
  if (!vehicle || !vehicle.maintenanceItems || vehicle.maintenanceItems.length === 0) {
    showToast("Aucun élément d'entretien à exporter.", 'warning');
    return;
  }

  const engine = computePredictionEngine(vehicle);
  const itemsWithDue = vehicle.maintenanceItems.map(item => ({
    item,
    due: calculateItemDueStatus(vehicle, item, engine)
  }));

  const todayIso = getTodayIsoString();
  const validItems = itemsWithDue.filter(x => x.due && x.due.targetDate && x.due.status !== 'grey' && x.due.targetDate >= todayIso);
  if (validItems.length === 0) {
    showToast("Aucune échéance à venir à exporter vers l'agenda.", 'warning');
    return;
  }

  const ics = generateAllItemsIcs(vehicle, validItems);
  if (!ics) {
    showToast("Impossible de générer le fichier iCalendar.", 'error');
    return;
  }

  const safeVeh = (vehicle.name || 'vehicule').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const filename = `calendrier_entretiens_${safeVeh}.ics`;
  downloadIcsFile(filename, ics);
  showToast(`${validItems.length} échéance(s) exportée(s) vers votre agenda (.ics) !`, 'success');
}

function exportRecurringReminderIcs() {
  const vehicle = getActiveVehicle();
  if (!vehicle) {
    showToast("Sélectionnez ou ajoutez d'abord un véhicule.", 'warning');
    return;
  }

  const ics = generateRecurringReminderIcs(vehicle);
  if (!ics) {
    showToast("Impossible de générer le rappel de kilométrage.", 'error');
    return;
  }

  const safeVeh = (vehicle.name || 'vehicule').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const filename = `rappel_kilometrage_${safeVeh}.ics`;
  downloadIcsFile(filename, ics);
  const freqLabel = vehicle.updateFrequency === 'daily' ? 'quotidien' : (vehicle.updateFrequency === 'weekly' ? 'hebdomadaire' : 'tous les 15 jours');
  showToast(`Rappel ${freqLabel} exporté vers votre calendrier (.ics) !`, 'success');
}

function updateCalendarShiftBanner(shiftedItems) {
  const banner = document.getElementById('calendarShiftBanner');
  const textEl = document.getElementById('calendarShiftBannerText');
  const metaEl = document.getElementById('calendarShiftBannerMeta');
  if (!banner) return;

  if (shiftedItems && shiftedItems.length > 0) {
    if (textEl) textEl.textContent = "Date modifiée, ré-exporter vers le calendrier ?";
    if (metaEl) {
      const details = shiftedItems.map(s => `${s.name} : décalé de ${s.diff} j (du ${formatDate(s.oldDate)} au ${formatDate(s.newDate)})`).join(' • ');
      metaEl.textContent = details;
    }
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function renderVehicleSelector() {
  const select = document.getElementById('vehicleSelect');
  const addBtn = document.getElementById('btnAddVehicle');
  if (!select) return;

  select.innerHTML = '';

  appState.vehicles.forEach(veh => {
    const opt = document.createElement('option');
    opt.value = veh.id;
    opt.textContent = `${veh.name} (${veh.brand} ${veh.model})`;
    if (veh.id === appState.activeVehicleId) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });

  // Limite de 3 véhicules
  if (addBtn) {
    if (appState.vehicles.length >= MAX_VEHICLES) {
      addBtn.disabled = true;
      addBtn.title = `Maximum de ${MAX_VEHICLES} véhicules atteint`;
      if (addBtn.style) addBtn.style.opacity = '0.4';
    } else {
      addBtn.disabled = false;
      addBtn.title = 'Ajouter un véhicule';
      if (addBtn.style) addBtn.style.opacity = '1';
    }
  }
}

function renderKmLogList(vehicle) {
  const container = document.getElementById('kmlogList');
  const badge = document.getElementById('kmlogCountBadge');
  if (!container) return;
  container.innerHTML = '';

  if (!vehicle.kmLog || vehicle.kmLog.length === 0) {
    if (badge) badge.textContent = '0 relevé';
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 16px;">Aucun relevé enregistré.</div>';
    return;
  }

  if (badge) badge.textContent = `${vehicle.kmLog.length} relevé${vehicle.kmLog.length > 1 ? 's' : ''}`;

  const reversedLogs = [...vehicle.kmLog].reverse();

  reversedLogs.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'kmlog-item';

    const delta = entry.predictedKm ? entry.km - entry.predictedKm : 0;
    const deltaText = delta === 0 ? 'prévu pile' : (delta > 0 ? `+${delta} km vs prévu` : `${delta} km vs prévu`);

    const authorHtml = entry.authorName
      ? `<span class="kmlog-author">👤 ${escapeHtml(entry.authorName)}</span>`
      : '';

    item.innerHTML = `
      <div class="kmlog-item-left">
        <span class="kmlog-date">${formatDate(entry.date)}</span>
        ${authorHtml}
        <span class="kmlog-pred">Prédit : ${entry.predictedKm ? formatKm(entry.predictedKm) : '--'}</span>
      </div>
      <div class="kmlog-item-right">
        <span class="kmlog-km">${formatKm(entry.km)}</span>
        <span class="kmlog-delta">${deltaText}</span>
      </div>
    `;
    container.appendChild(item);
  });
}

// ============================================================================
// 11. TOAST NOTIFICATIONS
// ============================================================================

function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => {
      if (typeof toast.remove === 'function') {
        toast.remove();
      } else if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, duration);
}

// ============================================================================
// 12. ÉTAPE 6 : PARAMÈTRES, SAUVEGARDE/RESTAURATION JSON & PWA HORS-LIGNE
// ============================================================================

/** Vérifie et affiche la bannière de rappel de sauvegarde si plus de 30 jours se sont écoulés */
function checkBackupReminder() {
  const banner = document.getElementById('backupReminderBanner');
  const meta = document.getElementById('backupReminderMeta');
  if (!banner) return;

  if (!appState.vehicles || appState.vehicles.length === 0) {
    banner.classList.add('hidden');
    return;
  }

  const lastBackup = appState.settings && appState.settings.lastBackupDate;
  if (!lastBackup) {
    if (meta) meta.textContent = "Dernière sauvegarde : jamais effectuée";
    banner.classList.remove('hidden');
  } else {
    const daysElapsed = getDaysElapsed(lastBackup);
    if (daysElapsed >= 30) {
      if (meta) meta.textContent = `Dernière sauvegarde : il y a ${daysElapsed} jours`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }
}

/** Rendu complet de l'écran des Paramètres */
function renderSettingsScreen() {
  const lastBackupEl = document.getElementById('lastBackupDateDisplay');
  const backupBadge = document.getElementById('backupStatusBadge');
  const listEl = document.getElementById('defaultIntervalsList');

  // 1. Information sur la sauvegarde
  const lastBackup = appState.settings && appState.settings.lastBackupDate;
  if (lastBackup) {
    const daysElapsed = getDaysElapsed(lastBackup);
    if (lastBackupEl) {
      lastBackupEl.textContent = `${formatDate(lastBackup)} (${daysElapsed === 0 ? "aujourd'hui" : `il y a ${daysElapsed} jour${daysElapsed > 1 ? 's' : ''}`})`;
    }
    if (backupBadge) {
      if (daysElapsed < 30) {
        backupBadge.textContent = "À jour 🟢";
        backupBadge.className = "vehicle-meta-badge status-badge-green";
      } else {
        backupBadge.textContent = "Sauvegarde recommandée 🟠";
        backupBadge.className = "vehicle-meta-badge status-badge-orange";
      }
    }
  } else {
    if (lastBackupEl) lastBackupEl.textContent = "Jamais effectuée";
    if (backupBadge) {
      backupBadge.textContent = "Non sauvegardé 🟠";
      backupBadge.className = "vehicle-meta-badge status-badge-orange";
    }
  }

  // 2. Statut réseau
  updateNetworkStatus();

  // 3. Liste ou Tableau des intervalles par défaut
  const container = document.getElementById('defaultIntervalsContainer') || document.getElementById('defaultIntervalsList');
  if (container) {
    container.innerHTML = '';
    const prefs = getUiPreferences();
    updateViewToggleButtons('intervalsViewToggle', prefs.intervalsViewMode);

    const intervals = (appState.settings && appState.settings.defaultIntervals) ? appState.settings.defaultIntervals : DEFAULT_MAINTENANCE_TYPES;

    if (prefs.intervalsViewMode === 'table') {
      const tableWrap = document.createElement('div');
      tableWrap.innerHTML = `
        <div class="table-scroll-hint"><span>👈 Défilement horizontal pour tout voir 👉</span></div>
        <div class="table-scroll-wrapper">
          <table class="app-data-table intervals-table">
            <thead>
              <tr>
                <th>Opération d'entretien</th>
                <th>Mode</th>
                <th>Intervalle Kilométrique</th>
                <th>Intervalle Calendrier</th>
              </tr>
            </thead>
            <tbody id="defaultIntervalsTableBody"></tbody>
          </table>
        </div>
      `;
      container.appendChild(tableWrap);
      const tbody = document.getElementById('defaultIntervalsTableBody');
      intervals.forEach((def, index) => {
        const isDateOnly = def.intervalKm === null;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong class="table-col-name">${escapeHtml(def.name)}</strong></td>
          <td><span class="vehicle-meta-badge" style="font-size:0.72rem;">${isDateOnly ? 'Date seule' : 'Km + Mois'}</span></td>
          <td>
            <div style="display:flex; align-items:center; gap:6px;">
              <input type="number" id="defKm_${index}" class="table-input-km def-km-input" data-index="${index}" value="${def.intervalKm !== null ? def.intervalKm : ''}" placeholder="Non applicable" min="500" step="100">
              <span style="font-size:0.78rem; color:var(--text-muted);">km</span>
            </div>
          </td>
          <td>
            <div style="display:flex; align-items:center; gap:6px;">
              <input type="number" id="defMonths_${index}" class="table-input-months def-months-input" data-index="${index}" value="${def.intervalMonths || 12}" min="1" max="120" required>
              <span style="font-size:0.78rem; color:var(--text-muted);">mois</span>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } else {
      const listEl = document.createElement('div');
      listEl.className = 'default-intervals-list';
      listEl.id = 'defaultIntervalsList';
      container.appendChild(listEl);

      intervals.forEach((def, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'default-interval-item';
        const isDateOnly = def.intervalKm === null;

        itemEl.innerHTML = `
          <div class="default-interval-header">
            <span>${escapeHtml(def.name)}</span>
            <span class="vehicle-meta-badge" style="font-size:0.75rem;">${isDateOnly ? 'Date seule' : 'Km + Mois'}</span>
          </div>
          <div class="default-interval-inputs">
            <div class="form-group" style="flex: 1.2;">
              <label class="form-label" style="font-size: 0.76rem;" for="defKm_${index}">Km (vide si date seule)</label>
              <input type="number" id="defKm_${index}" class="form-input def-km-input" data-index="${index}" value="${def.intervalKm !== null ? def.intervalKm : ''}" placeholder="Non applicable" min="500" step="100">
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label" style="font-size: 0.76rem;" for="defMonths_${index}">Mois</label>
              <input type="number" id="defMonths_${index}" class="form-input def-months-input" data-index="${index}" value="${def.intervalMonths || 12}" min="1" max="120" required>
            </div>
          </div>
        `;

        listEl.appendChild(itemEl);
      });
    }
  }

  // 4. Carte Données de démonstration
  const demoCard = document.getElementById('settingsDemoCard');
  if (demoCard) {
    const hasDemo = Boolean(appState.isDemo || (appState.vehicles && appState.vehicles.some(v => v.isDemo)));
    if (hasDemo) {
      demoCard.classList.remove('hidden');
    } else {
      demoCard.classList.add('hidden');
    }
  }
}

/** Export complet de l'état en fichier JSON téléchargeable */
function handleExportJsonBackup() {
  const exportPayload = {
    schemaVersion: SCHEMA_VERSION,
    appName: "Carnet d'Entretien Automobile",
    exportDate: new Date().toISOString(),
    vehicles: appState.vehicles || [],
    activeVehicleId: appState.activeVehicleId,
    history: appState.history || [],
    settings: {
      defaultIntervals: (appState.settings && appState.settings.defaultIntervals) ? appState.settings.defaultIntervals : DEFAULT_MAINTENANCE_TYPES,
      lastBackupDate: getTodayIsoString()
    }
  };

  const jsonString = JSON.stringify(exportPayload, null, 2);
  const todayStr = getTodayIsoString();
  const filename = `carnet_entretien_backup_${todayStr}.json`;

  if (typeof document !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 250);
  }

  // Mettre à jour la date de dernière sauvegarde
  if (!appState.settings) appState.settings = {};
  appState.settings.lastBackupDate = todayStr;
  saveState();
  checkBackupReminder();

  if (currentView === 'settings') {
    renderSettingsScreen();
  }

  showToast("✅ Sauvegarde JSON exportée avec succès !", "success");
}

/** Importation et restauration d'un fichier de sauvegarde JSON */
function handleImportJsonBackup(event) {
  const fileInput = event.target;
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const content = e.target.result;
      const parsed = JSON.parse(content);

      // Validation de structure
      if (!parsed || typeof parsed !== 'object') {
        throw new Error("Le fichier ne contient pas un objet JSON valide.");
      }

      if (!Array.isArray(parsed.vehicles)) {
        throw new Error("Structure manquante : aucun tableau 'vehicles' trouvé.");
      }

      // Validation approfondie des véhicules
      parsed.vehicles.forEach((v, vIdx) => {
        if (!v || typeof v !== 'object') {
          throw new Error(`Le véhicule #${vIdx + 1} n'est pas un objet valide.`);
        }
        if (!v.id || typeof v.id !== 'string') {
          throw new Error(`Le véhicule #${vIdx + 1} n'a pas d'identifiant valide.`);
        }
        if (!v.name || typeof v.name !== 'string') {
          throw new Error(`Le véhicule #${vIdx + 1} n'a pas de nom valide.`);
        }
        if (typeof v.currentKm !== 'number' || isNaN(v.currentKm) || v.currentKm < 0) {
          throw new Error(`Kilométrage actuel invalide pour le véhicule "${v.name || v.id}".`);
        }

        // Validation des relevés kilométriques kmLog
        if (!Array.isArray(v.kmLog)) {
          throw new Error(`Le carnet de relevés kilométriques est manquant pour le véhicule "${v.name}".`);
        }
        v.kmLog.forEach((log, logIdx) => {
          if (!log || typeof log !== 'object') {
            throw new Error(`Relevé kilométrique #${logIdx + 1} invalide pour le véhicule "${v.name}".`);
          }
          if (typeof log.date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(log.date)) {
            throw new Error(`Date de relevé invalide (${log.date || 'vide'}) pour le véhicule "${v.name}". Format attendu : AAAA-MM-JJ.`);
          }
          if (typeof log.km !== 'number' || isNaN(log.km) || log.km < 0) {
            throw new Error(`Valeur kilométrique invalide (${log.km}) pour le véhicule "${v.name}".`);
          }
        });

        // Validation des éléments d'entretien maintenanceItems
        if (!Array.isArray(v.maintenanceItems)) {
          throw new Error(`La liste des éléments d'entretien est manquante pour le véhicule "${v.name}".`);
        }
        v.maintenanceItems.forEach((item, itemIdx) => {
          if (!item || typeof item !== 'object') {
            throw new Error(`Élément d'entretien #${itemIdx + 1} invalide pour le véhicule "${v.name}".`);
          }
          if (!item.id || typeof item.id !== 'string') {
            throw new Error(`Identifiant d'entretien manquant pour l'élément #${itemIdx + 1}.`);
          }
          if (!item.name || typeof item.name !== 'string') {
            throw new Error(`Nom d'entretien manquant pour l'élément "${item.id}".`);
          }
          if (item.intervalKm !== null && (typeof item.intervalKm !== 'number' || isNaN(item.intervalKm) || item.intervalKm <= 0)) {
            throw new Error(`Intervalle kilométrique invalide pour "${item.name}" (nombre positif ou null attendu).`);
          }
          if (item.intervalMonths !== null && (typeof item.intervalMonths !== 'number' || isNaN(item.intervalMonths) || item.intervalMonths <= 0)) {
            throw new Error(`Intervalle calendaire en mois invalide pour "${item.name}" (nombre positif ou null attendu).`);
          }
        });
      });

      // Valider l'historique
      if (parsed.history) {
        if (!Array.isArray(parsed.history)) {
          throw new Error("Format du journal d'historique invalide (tableau attendu).");
        }
        parsed.history.forEach((h, hIdx) => {
          if (!h || typeof h !== 'object' || !h.id || typeof h.type !== 'string' || typeof h.date !== 'string') {
            throw new Error(`Intervention #${hIdx + 1} invalide dans l'historique.`);
          }
        });
      }

      // Demande de confirmation avant écrasement
      const existingCount = (appState.vehicles || []).length;
      const confirmMsg = existingCount > 0
        ? `⚠️ Attention : L'importation va remplacer l'ensemble de vos données actuelles (${existingCount} véhicule(s)).\n\nVoulez-vous charger cette sauvegarde (${parsed.vehicles.length} véhicule(s), ${(parsed.history || []).length} intervention(s)) ?`
        : `Voulez-vous charger cette sauvegarde contenant ${parsed.vehicles.length} véhicule(s) ?`;

      const proceed = window.confirm(confirmMsg);
      if (!proceed) {
        fileInput.value = '';
        return;
      }

      // Remplacement sécurisé
      appState = {
        schemaVersion: parsed.schemaVersion || SCHEMA_VERSION,
        vehicles: parsed.vehicles,
        activeVehicleId: parsed.activeVehicleId || (parsed.vehicles[0] ? parsed.vehicles[0].id : null),
        history: Array.isArray(parsed.history) ? parsed.history : [],
        settings: {
          defaultIntervals: (parsed.settings && parsed.settings.defaultIntervals) ? parsed.settings.defaultIntervals : DEFAULT_MAINTENANCE_TYPES,
          lastBackupDate: getTodayIsoString()
        },
        isDemo: false
      };

      saveState();
      renderApp();
      if (currentView === 'settings') {
        renderSettingsScreen();
      } else if (currentView === 'history') {
        renderHistoryScreen();
      }

      showToast(`✅ Sauvegarde restaurée ! (${appState.vehicles.length} véhicule(s) chargé(s))`, "success");
    } catch (err) {
      console.error("Erreur lors de l'import JSON:", err);
      showToast(`Erreur d'import : ${err.message}`, "error", 5000);
    } finally {
      fileInput.value = '';
    }
  };

  reader.onerror = function() {
    showToast("Impossible de lire le fichier de sauvegarde sélectionné.", "error");
    fileInput.value = '';
  };

  reader.readAsText(file);
}

/** Enregistre les modifications des intervalles par défaut */
function handleDefaultIntervalsSubmit(e) {
  e.preventDefault();
  if (!appState.settings) appState.settings = {};

  const currentDefaults = (appState.settings.defaultIntervals && appState.settings.defaultIntervals.length > 0)
    ? appState.settings.defaultIntervals
    : JSON.parse(JSON.stringify(DEFAULT_MAINTENANCE_TYPES));

  const newDefaults = currentDefaults.map((item, index) => {
    const kmInput = document.getElementById(`defKm_${index}`);
    const monthsInput = document.getElementById(`defMonths_${index}`);

    let intervalKm = null;
    if (kmInput && kmInput.value.trim() !== '') {
      const val = parseInt(kmInput.value.trim(), 10);
      if (!isNaN(val) && val > 0) {
        intervalKm = val;
      }
    }

    let intervalMonths = item.intervalMonths || 12;
    if (monthsInput && monthsInput.value.trim() !== '') {
      const val = parseInt(monthsInput.value.trim(), 10);
      if (!isNaN(val) && val > 0) {
        intervalMonths = val;
      }
    }

    return {
      id: item.id,
      name: item.name,
      intervalKm: intervalKm,
      intervalMonths: intervalMonths
    };
  });

  appState.settings.defaultIntervals = newDefaults;
  saveState();
  showToast("✅ Intervalles par défaut mis à jour pour les nouveaux véhicules.", "success");
  renderSettingsScreen();
}

/** Réinitialise les intervalles par défaut aux réglages d'usine */
function handleResetDefaultIntervals() {
  const confirmReset = window.confirm("Rétablir les 13 intervalles d'entretien par défaut aux valeurs d'origine ?");
  if (!confirmReset) return;

  if (!appState.settings) appState.settings = {};
  appState.settings.defaultIntervals = JSON.parse(JSON.stringify(DEFAULT_MAINTENANCE_TYPES));
  saveState();
  showToast("Intervalles par défaut rétablis aux valeurs d'origine.", "info");
  renderSettingsScreen();
}

// Gestion de l'installation PWA et de la détection réseau
let deferredInstallPrompt = null;

function handleInstallPwaClick() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        showToast("Installation en cours...", "info");
      }
      deferredInstallPrompt = null;
    });
  } else {
    const isIos = /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase());
    const iosHelp = document.getElementById('pwaIosInstructions');
    if (isIos && iosHelp) {
      iosHelp.classList.toggle('hidden');
    } else {
      showToast("Pour installer l'application, ouvrez le menu de votre navigateur (⋮ ou Partager) puis 'Installer' ou 'Ajouter à l'écran d'accueil'.", "info", 5000);
    }
  }
}

function updateNetworkStatus() {
  const isOnline = typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : true;
  const badge = document.getElementById('networkStatusBadge');
  const offlineBanner = document.getElementById('offlineBanner');

  if (badge) {
    if (isOnline) {
      badge.textContent = "🟢 En ligne";
      badge.className = "vehicle-meta-badge status-badge-green";
    } else {
      badge.textContent = "📴 Mode hors-ligne";
      badge.className = "vehicle-meta-badge status-badge-orange";
    }
  }

  if (offlineBanner) {
    if (isOnline) {
      offlineBanner.classList.add('hidden');
    } else {
      offlineBanner.classList.remove('hidden');
    }
  }
}



// 13. ENREGISTREMENT DES ÉVÉNEMENTS (LISTENERS)
// ============================================================================

function attachEventListeners() {
  // Changement de véhicule
  document.getElementById('vehicleSelect').addEventListener('change', (e) => {
    appState.activeVehicleId = e.target.value;
    clearKmFeedback();
    saveState();
    renderApp();
  });

  // Bouton Ajouter véhicule
  document.getElementById('btnAddVehicle').addEventListener('click', openAddVehicleModal);

  // Bouton Modifier véhicule
  document.getElementById('btnEditVehicle').addEventListener('click', openEditVehicleModal);

  // Formulaire d'ajout/modification véhicule
  document.getElementById('vehicleForm').addEventListener('submit', handleVehicleFormSubmit);
  document.getElementById('btnCloseVehicleModal').addEventListener('click', closeVehicleModal);
  document.getElementById('btnCancelVehicleModal').addEventListener('click', closeVehicleModal);
  document.getElementById('btnDeleteVehicle').addEventListener('click', handleDeleteVehicle);

  // Éléments d'entretien (Étape 2)
  document.getElementById('btnAddMaintenanceItem').addEventListener('click', openAddMaintenanceItemModal);
  document.getElementById('maintenanceItemForm').addEventListener('submit', handleMaintenanceItemSubmit);
  document.getElementById('btnCloseMaintModal').addEventListener('click', closeMaintenanceItemModal);
  document.getElementById('btnCancelMaintModal').addEventListener('click', closeMaintenanceItemModal);
  document.getElementById('btnDeleteMaintItem').addEventListener('click', handleDeleteMaintenanceItem);

  document.getElementById('btnTypeKmMonths').addEventListener('click', () => setMaintenanceTypeMode('km_months'));
  document.getElementById('btnTypeDateOnly').addEventListener('click', () => setMaintenanceTypeMode('date_only'));

  // Mise à jour rapide du kilométrage
  document.getElementById('quickUpdateForm').addEventListener('submit', handleQuickKmSubmit);

  // Clic sur bouton de la bannière Stale : focus l'input
  document.getElementById('btnFocusQuickUpdate').addEventListener('click', () => {
    const input = document.getElementById('quickKmInput');
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // Supprimer données d'exemple (si bouton présent)
  const btnDeleteDemo = document.getElementById('btnDeleteDemo');
  if (btnDeleteDemo) btnDeleteDemo.addEventListener('click', handleDeleteDemoData);

  // Filtres par statut (Étape 3)
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      const filter = e.currentTarget.getAttribute('data-filter');
      setStatusFilter(filter);
    });
  });

  // Navigation par onglets (Étape 3b & 4)
  const tabDash = document.getElementById('tabDashboard');
  const tabHist = document.getElementById('tabHistory');
  const tabHab = document.getElementById('tabHabitudes');
  if (tabDash) tabDash.addEventListener('click', () => switchView('dashboard'));
  if (tabHist) tabHist.addEventListener('click', () => switchView('history'));
  if (tabHab) tabHab.addEventListener('click', () => switchView('habitudes'));

  // Modal "Fait aujourd'hui" (Étape 4)
  document.getElementById('doneForm').addEventListener('submit', handleDoneFormSubmit);
  document.getElementById('btnCloseDoneModal').addEventListener('click', closeDoneModal);
  document.getElementById('btnCancelDoneModal').addEventListener('click', closeDoneModal);

  // Filtres de l'écran Historique (Étape 4)
  const histFilterVeh = document.getElementById('histFilterVehicle');
  const histFilterType = document.getElementById('histFilterType');
  if (histFilterVeh) histFilterVeh.addEventListener('change', renderHistoryScreen);
  if (histFilterType) histFilterType.addEventListener('change', renderHistoryScreen);

  // Fermeture des fenêtres modales au clic sur l'arrière-plan
  [
    document.getElementById('vehicleModal'),
    document.getElementById('maintenanceItemModal'),
    document.getElementById('doneModal'),
    document.getElementById('modalCreateRoom'),
    document.getElementById('modalJoinRoom'),
    document.getElementById('modalShareInvite')
  ].forEach(modal => {
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.add('hidden');
        }
      });
    }
  });

  // Fermeture des modales avec la touche Échap
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeVehicleModal();
      closeMaintenanceItemModal();
      closeDoneModal();
      document.getElementById('modalCreateRoom')?.classList.add('hidden');
      document.getElementById('modalJoinRoom')?.classList.add('hidden');
      document.getElementById('modalShareInvite')?.classList.add('hidden');
    }
  });

  // Étape 3 : Onboarding & Choix du mode
  document.getElementById('btnChoiceSolo')?.addEventListener('click', () => {
    document.getElementById('onboardingChoiceSection')?.classList.add('hidden');
    document.getElementById('onboardingFormSection')?.classList.remove('hidden');
  });

  document.getElementById('btnBackToChoice')?.addEventListener('click', () => {
    document.getElementById('onboardingFormSection')?.classList.add('hidden');
    document.getElementById('onboardingChoiceSection')?.classList.remove('hidden');
  });

  document.getElementById('btnChoiceCreateRoom')?.addEventListener('click', () => {
    document.getElementById('onboardingModal')?.classList.add('hidden');
    const migrateGrp = document.getElementById('createMigrateGroup');
    if (migrateGrp) {
      migrateGrp.style.display = (appState.vehicles && appState.vehicles.length > 0) ? 'flex' : 'none';
    }
    document.getElementById('modalCreateRoom')?.classList.remove('hidden');
  });

  document.getElementById('btnChoiceJoinRoom')?.addEventListener('click', () => {
    document.getElementById('onboardingModal')?.classList.add('hidden');
    document.getElementById('modalJoinRoom')?.classList.remove('hidden');
  });

  document.getElementById('btnCloseCreateRoom')?.addEventListener('click', () => {
    document.getElementById('modalCreateRoom')?.classList.add('hidden');
    if (!appState.vehicles || appState.vehicles.length === 0) {
      document.getElementById('onboardingModal')?.classList.remove('hidden');
    }
  });

  document.getElementById('btnCancelCreateRoom')?.addEventListener('click', () => {
    document.getElementById('modalCreateRoom')?.classList.add('hidden');
    if (!appState.vehicles || appState.vehicles.length === 0) {
      document.getElementById('onboardingModal')?.classList.remove('hidden');
    }
  });

  document.getElementById('btnCloseJoinRoom')?.addEventListener('click', () => {
    document.getElementById('modalJoinRoom')?.classList.add('hidden');
    if (!appState.vehicles || appState.vehicles.length === 0) {
      document.getElementById('onboardingModal')?.classList.remove('hidden');
    }
  });

  document.getElementById('btnCancelJoinRoom')?.addEventListener('click', () => {
    document.getElementById('modalJoinRoom')?.classList.add('hidden');
    if (!appState.vehicles || appState.vehicles.length === 0) {
      document.getElementById('onboardingModal')?.classList.remove('hidden');
    }
  });

  // Formulaire Créer une salle
  const formCreate = document.getElementById('formCreateRoom');
  if (formCreate) {
    formCreate.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!window.FamilyRoom) {
        showToast("Le module Multi-utilisateurs est en cours d'initialisation...", "warning");
        return;
      }
      const roomName = document.getElementById('createRoomName')?.value.trim() || "Multi-utilisateurs";
      const ownerName = document.getElementById('createOwnerName').value.trim();
      const ownerPhone = document.getElementById('createOwnerPhone')?.value.trim() || '';
      const expiryHours = parseInt(document.getElementById('createExpiryHours').value, 10) || 24;
      const maxUses = parseInt(document.getElementById('createMaxUses').value, 10) || 5;
      const migrateLocal = document.getElementById('createMigrateLocal')?.checked || false;

      const submitBtn = formCreate.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = "Création en cours...";

      try {
        const res = await window.FamilyRoom.createFamilyRoom({
          roomName,
          ownerName,
          ownerPhone,
          expiryHours,
          maxUses,
          migrateLocal
        });
        document.getElementById('modalCreateRoom')?.classList.add('hidden');
        window.FamilyRoom.showShareInviteModal({
          inviteUrl: res.inviteUrl,
          inviteCode: res.inviteCode,
          roomName: res.profile.roomName
        });
        showToast("Multi-utilisateurs (multi-appareils) activé avec succès !", "success");
        renderApp();
        window.FamilyRoom.renderSettingsRoomSection();
      } catch (err) {
        showToast("Erreur lors de la création : " + err.message, "error");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Activer & Inviter";
      }
    });
  }

  // Formulaire Rejoindre en multi-utilisateurs
  const formJoin = document.getElementById('formJoinRoom');
  if (formJoin) {
    formJoin.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!window.FamilyRoom) {
        showToast("Le module Multi-utilisateurs est en cours d'initialisation...", "warning");
        return;
      }
      const memberName = document.getElementById('joinMemberName').value.trim();
      const memberPhone = document.getElementById('joinMemberPhone')?.value.trim() || '';
      const inviteInput = document.getElementById('joinInviteCode').value.trim();

      const submitBtn = formJoin.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = "Vérification...";

      try {
        const res = await window.FamilyRoom.joinFamilyRoom({
          inviteInput,
          memberName,
          memberPhone
        });
        document.getElementById('modalJoinRoom')?.classList.add('hidden');
        window.FamilyRoom.showPendingApprovalModal(res.roomName, res.profile.myName);
        showToast("Demande d'accès envoyée à l'administrateur !", "info");
      } catch (err) {
        showToast("Erreur d'accès : " + err.message, "error");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Demander l'accès";
      }
    });
  }

  // Annuler la demande d'accès en attente
  document.getElementById('btnCancelPendingJoin')?.addEventListener('click', async () => {
    if (confirm("Voulez-vous annuler votre demande d'accès ?")) {
      if (window.FamilyRoom) await window.FamilyRoom.leaveRoom();
      document.getElementById('modalPendingApproval')?.classList.add('hidden');
      renderApp();
    }
  });

  // Modale Partage d'invitation
  ['btnCloseShareInvite', 'btnCloseShareModalBtn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      document.getElementById('modalShareInvite')?.classList.add('hidden');
    });
  });

  document.getElementById('btnShareWhatsApp')?.addEventListener('click', () => {
    const url = document.getElementById('shareInviteUrl')?.value;
    const roomTitle = document.getElementById('shareInviteRoomTitle')?.textContent;
    if (window.FamilyRoom && url) {
      window.FamilyRoom.shareInviteLink(url, roomTitle);
    }
  });

  document.getElementById('btnCopyInviteLink')?.addEventListener('click', () => {
    const url = document.getElementById('shareInviteUrl')?.value;
    if (url) {
      navigator.clipboard.writeText(url).then(() => {
        showToast("Lien d'invitation copié !", "success");
      }).catch(() => {
        showToast("Impossible de copier automatiquement.", "warning");
      });
    }
  });

  document.getElementById('btnCopyInviteCode')?.addEventListener('click', () => {
    const code = document.getElementById('shareInviteCode')?.value;
    if (code) {
      navigator.clipboard.writeText(code).then(() => {
        showToast("Code d'accès copié !", "success");
      }).catch(() => {
        showToast("Impossible de copier automatiquement.", "warning");
      });
    }
  });

  // Formulaire onboarding classique
  document.getElementById('onboardingForm').addEventListener('submit', handleOnboardingSubmit);
  document.getElementById('btnLoadDemoFromOnboard').addEventListener('click', handleLoadDemoFromOnboard);

  // Étape 5 : Export iCalendar (.ics)
  const btnExportAll = document.getElementById('btnExportAllIcs');
  if (btnExportAll) {
    btnExportAll.addEventListener('click', exportAllMaintenanceItemsIcs);
  }

  const btnExportShifted = document.getElementById('btnExportShiftedIcs');
  if (btnExportShifted) {
    btnExportShifted.addEventListener('click', () => {
      exportAllMaintenanceItemsIcs();
      updateCalendarShiftBanner([]);
    });
  }

  const btnExportRecurring = document.getElementById('btnExportRecurringReminder');
  if (btnExportRecurring) {
    btnExportRecurring.addEventListener('click', exportRecurringReminderIcs);
  }

  const btnVehExportReminder = document.getElementById('btnVehExportReminder');
  if (btnVehExportReminder) {
    btnVehExportReminder.addEventListener('click', exportRecurringReminderIcs);
  }

  // Étape 6 : Navigation vers Paramètres & Sauvegardes
  const tabSet = document.getElementById('tabSettings');
  if (tabSet) tabSet.addEventListener('click', () => switchView('settings'));

  // Export / Import JSON & Paramètres
  const btnExportJson = document.getElementById('btnExportJsonBackup');
  if (btnExportJson) btnExportJson.addEventListener('click', handleExportJsonBackup);

  const btnQuickBackup = document.getElementById('btnQuickBackup');
  if (btnQuickBackup) btnQuickBackup.addEventListener('click', handleExportJsonBackup);

  const backupInput = document.getElementById('backupFileInput');
  if (backupInput) backupInput.addEventListener('change', handleImportJsonBackup);

  const defForm = document.getElementById('defaultIntervalsForm');
  if (defForm) defForm.addEventListener('submit', handleDefaultIntervalsSubmit);

  const btnResetDefaults = document.getElementById('btnResetDefaultIntervals');
  if (btnResetDefaults) btnResetDefaults.addEventListener('click', handleResetDefaultIntervals);

  // Bouton installation PWA
  const btnInstallPwa = document.getElementById('btnInstallPwa');
  if (btnInstallPwa) btnInstallPwa.addEventListener('click', handleInstallPwaClick);

  // Bouton suppression Renault Symbol dans Paramètres
  const btnDeleteDemoSettings = document.getElementById('btnDeleteDemoDataSettings');
  if (btnDeleteDemoSettings) btnDeleteDemoSettings.addEventListener('click', handleDeleteDemoData);

  // Bascules d'affichage (Tableau glissable vs Fiches) pour Plan d'entretien, Historique, Intervalles
  ['maintViewToggle', 'historyViewToggle', 'intervalsViewToggle'].forEach(toggleId => {
    const el = document.getElementById(toggleId);
    if (!el) return;
    el.querySelectorAll('.view-toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mode = e.currentTarget.getAttribute('data-mode');
        if (toggleId === 'maintViewToggle') {
          saveUiPreference('maintViewMode', mode);
          const vehicle = getActiveVehicle();
          if (vehicle) renderMaintenanceList(vehicle, computePredictionEngine(vehicle));
        } else if (toggleId === 'historyViewToggle') {
          saveUiPreference('historyViewMode', mode);
          renderHistoryScreen();
        } else if (toggleId === 'intervalsViewToggle') {
          saveUiPreference('intervalsViewMode', mode);
          renderSettingsScreen();
        }
      });
    });
  });

}

// ============================================================================
// 14. INITIALISATION AU CHARGEMENT DE LA PAGE
// ============================================================================

window.addEventListener('DOMContentLoaded', () => {
  const hasData = loadState();
  if (!hasData) {
    // Premier lancement : aucun véhicule chargé, ce qui affichera l'onboarding au renderApp()
  }

  attachEventListeners();
  renderApp();

  // Détection connectivité réseau (En ligne / Hors-ligne)
  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);
  updateNetworkStatus();

  // Événements d'installation PWA
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btn = document.getElementById('btnInstallPwa');
    const text = document.getElementById('btnInstallPwaText');
    if (btn && text) {
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-primary');
      text.textContent = "📲 Installer l'application maintenant";
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const text = document.getElementById('btnInstallPwaText');
    if (text) text.textContent = "✅ Application installée";
    showToast("Application installée avec succès !", "success");
  });

  // Enregistrement du Service Worker pour PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => console.log('Service Worker enregistré:', reg.scope))
      .catch((err) => console.warn('Erreur Service Worker:', err));
  }
});
