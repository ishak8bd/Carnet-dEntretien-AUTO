// test/prediction-engine.test.js
// Tests unitaires du modèle de prédiction intelligent multi-jalons et prior 1 000 - 2 000 km/mois

import assert from 'assert';
import { calculateIntelligentDailyRate } from '../scripts/send-email-reminders.mjs';

console.log("--- Démarrage des Tests Unitaires du Moteur de Prédiction Intelligent ---");

// Test 1: Prior baseline quand aucune donnée n'est renseignée (0 entretien, 0 log)
{
  const veh = { id: 'v1', currentKm: 0 };
  const res = calculateIntelligentDailyRate(veh, [], []);
  assert.strictEqual(res.confidence, 'prior', "Doit utiliser le prior par défaut");
  assert.strictEqual(Math.round(res.monthlyRate), 1500, "La moyenne mensuelle par défaut doit être 1 500 km/mois");
  assert(res.dailyRate >= 49 && res.dailyRate <= 50, "Le rythme journalier doit être ~49.3 km/j");
  console.log("✓ Test 1 réussi : Prior baseline standard 1 500 km/mois");
}

// Test 2: Comparaison entre 1 entretien passé et le compteur actuel (sans aucun kmLog)
{
  // Vidange il y a 180 jours à 100 000 km, compteur actuel à 109 000 km (+9 000 km en 180 jours = 50 km/j = ~1 520 km/mois)
  const d180Ago = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const veh = { id: 'v2', currentKm: 109000 };
  const vehItems = [
    { name: 'Vidange', lastDate: d180Ago, lastKm: 100000 }
  ];
  const res = calculateIntelligentDailyRate(veh, [], vehItems);
  assert(res.milestonesCount >= 2, "Doit avoir détecté au moins 2 jalons");
  assert(res.monthlyRate >= 1400 && res.monthlyRate <= 1600, `Rythme détecté (~${Math.round(res.monthlyRate)} km/mois) dans la fourchette attendue`);
  console.log(`✓ Test 2 réussi : Comparaison entretien passé / compteur actuel (~${Math.round(res.monthlyRate)} km/mois)`);
}

// Test 3: Comparaison de plusieurs entretiens successifs
{
  // Entretien 1 il y a 360 jours à 80 000 km
  // Entretien 2 il y a 180 jours à 89 000 km (+9 000 km en 180 j = 50 km/j)
  // Compteur actuel aujourd'hui à 98 000 km (+9 000 km en 180 j = 50 km/j)
  const d360Ago = new Date(Date.now() - 360 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const d180Ago = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const veh = { id: 'v3', currentKm: 98000 };
  const vehItems = [
    { name: 'Courroie', lastDate: d360Ago, lastKm: 80000 },
    { name: 'Vidange', lastDate: d180Ago, lastKm: 89000 }
  ];
  const res = calculateIntelligentDailyRate(veh, [], vehItems);
  assert.strictEqual(res.confidence, 'high', "Doit avoir une confiance élevée avec plusieurs entretiens sur 360 jours");
  assert(res.monthlyRate >= 1450 && res.monthlyRate <= 1550, "Rythme stable détecté avec précision");
  console.log(`✓ Test 3 réussi : Multi-entretiens avec confiance élevée (~${Math.round(res.monthlyRate)} km/mois)`);
}

// Test 4: Conducteur petit rouleur régularisé doucement vers 1000 - 2000 km/mois
{
  // 3 000 km parcourus en 120 jours = 25 km/j (~760 km/mois)
  const d120Ago = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const veh = { id: 'v4', currentKm: 53000 };
  const vehItems = [{ name: 'Vidange', lastDate: d120Ago, lastKm: 50000 }];
  const res = calculateIntelligentDailyRate(veh, [], vehItems);
  assert(res.monthlyRate > 760 && res.monthlyRate < 1500, "Régularisation bayésienne entre l'observé et le prior");
  console.log(`✓ Test 4 réussi : Petit rouleur régularisé (~${Math.round(res.monthlyRate)} km/mois)`);
}

// Test 5: Intervention passée enregistrée dans l'historique (sans entretien ni kmLog)
{
  // Facture / vidange passée enregistrée dans l'historique il y a 200 jours à 120 000 km, compteur actuel à 130 000 km (+10 000 km en 200 j = 50 km/j = ~1 520 km/mois)
  const d200Ago = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const veh = { id: 'v5', currentKm: 130000 };
  const history = [
    { vehicleId: 'v5', type: 'Vidange moteur', date: d200Ago, km: 120000, cost: 7000 }
  ];
  const res = calculateIntelligentDailyRate(veh, [], [], history);
  assert(res.milestonesCount >= 2, "Doit avoir détecté au moins 2 jalons (historique + compteur actuel)");
  assert(res.monthlyRate >= 1400 && res.monthlyRate <= 1600, `Rythme détecté (~${Math.round(res.monthlyRate)} km/mois) conforme aux interventions passées`);
  console.log(`✓ Test 5 réussi : Intervention passée dans l'historique prise en compte (~${Math.round(res.monthlyRate)} km/mois)`);
}

console.log("✅ TOUS LES TESTS DE PRÉDICTION INTELLIGENTE ONT RÉUSSI AVEC SUCCÈS !");
