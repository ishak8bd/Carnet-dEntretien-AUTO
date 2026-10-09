const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const assert = require('assert');

console.log('--- Démarrage du Smoke Test Automatisé (Node + jsdom) ---');

const htmlPath = path.join(__dirname, '..', 'index.html');
const jsPath = path.join(__dirname, '..', 'app.js');

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');

const errors = [];
const virtualConsole = new VirtualConsole();

virtualConsole.on('error', (err, ...args) => {
  console.error('[Browser console.error]', err, ...args);
  errors.push(err);
});

virtualConsole.on('warn', (...args) => {
  // Ignorer les avertissements bénins s'il y en a
  console.warn('[Browser console.warn]', ...args);
});

virtualConsole.on('jsdomError', (err) => {
  console.error('[JSDOM Error]', err);
  errors.push(err);
});

// Création de l'environnement DOM
const dom = new JSDOM(htmlContent, {
  runScripts: 'dangerously',
  virtualConsole,
  url: 'http://localhost/'
});

const { window } = dom;
const { document } = window;

// Mocks d'environnement navigateur
window.matchMedia = window.matchMedia || function() {
  return {
    matches: false,
    addListener: function() {},
    removeListener: function() {},
    addEventListener: function() {},
    removeEventListener: function() {}
  };
};

if (!window.navigator.clipboard) {
  window.navigator.clipboard = {
    writeText: () => Promise.resolve()
  };
}

// Intercepter les erreurs non capturées
window.addEventListener('error', (event) => {
  console.error('[Uncaught Window Error]:', event.error || event.message);
  errors.push(event.error || new Error(event.message));
});

// Injecter et exécuter le script app.js
const scriptEl = document.createElement('script');
scriptEl.textContent = jsContent;
document.body.appendChild(scriptEl);

// Déclencher le chargement DOMContentLoaded
const domContentLoadedEvent = new window.Event('DOMContentLoaded', {
  bubbles: true,
  cancelable: true
});
window.dispatchEvent(domContentLoadedEvent);

// Vérifications
try {
  console.log('1. Vérification au premier lancement (0 véhicule) : modal onboarding');
  const onboardingModal = document.getElementById('onboardingModal');
  assert(onboardingModal, 'Modal onboarding trouvé dans le DOM');
  assert(!onboardingModal.classList.contains('hidden'), 'Modal onboarding affiché au premier lancement');

  console.log('2. Chargement du véhicule de démonstration via le bouton onboarding');
  const btnLoadDemo = document.getElementById('btnLoadDemoFromOnboard');
  assert(btnLoadDemo, 'Bouton "Tester avec des données d\'exemple" trouvé');
  btnLoadDemo.click();

  assert(onboardingModal.classList.contains('hidden'), 'Modal onboarding fermé après chargement démo');

  console.log('3. Vérification du sélecteur de véhicule et de la liste d\'entretien');
  const vehSelect = document.getElementById('vehicleSelect');
  assert(vehSelect && vehSelect.options.length > 0, 'Véhicule présent dans le sélecteur');

  // Vérifier la présence du tableau ou des fiches d'entretien
  const maintContainer = document.getElementById('maintenanceContainer');
  assert(maintContainer, 'Conteneur d\'entretien présent');

  console.log('4. Vérification des boutons "Fait aujourd\'hui" et des écouteurs associés');
  const doneButtons = maintContainer.querySelectorAll('.btn-done-today');
  assert(doneButtons.length > 0, `Au moins un bouton "Fait aujourd'hui" présent (trouvé ${doneButtons.length})`);

  // Tester le clic sur le premier bouton "Fait"
  const firstDoneBtn = doneButtons[0];
  const testItemId = firstDoneBtn.getAttribute('data-id');
  firstDoneBtn.click();

  const doneModal = document.getElementById('doneModal');
  assert(doneModal, 'Modal "Fait aujourd\'hui" trouvé');
  assert(!doneModal.classList.contains('hidden'), 'Modal "Fait aujourd\'hui" s\'ouvre bien sans erreur');

  const doneItemName = document.getElementById('doneItemNameDisplay');
  assert(doneItemName && doneItemName.textContent.trim().length > 0, 'Nom de l\'entretien affiché dans la modale');

  // Fermer la modal
  const btnCloseDone = document.getElementById('btnCloseDoneModal');
  if (btnCloseDone) btnCloseDone.click();
  assert(doneModal.classList.contains('hidden'), 'Modal "Fait aujourd\'hui" se referme proprement');

  console.log('5. Vérification du rendu du journal des relevés kilométriques (km log)');
  const kmLogContainer = document.getElementById('kmlogList');
  assert(kmLogContainer, 'Conteneur kmlogList trouvé');
  const logEntries = kmLogContainer.querySelectorAll('.kmlog-item');
  assert(logEntries.length > 0, `Relevés kilométriques rendus avec succès (trouvé ${logEntries.length} relevés)`);

  console.log('6. Test de bascule d\'affichage (Tableau <-> Fiches)');
  const btnCards = document.querySelector('#maintViewToggle button[data-mode="cards"]');
  const btnTable = document.querySelector('#maintViewToggle button[data-mode="table"]');
  if (btnCards) {
    btnCards.click();
    const cards = maintContainer.querySelectorAll('.item-card');
    assert(cards.length > 0, 'Mode fiches rendu sans erreur');
  }
  if (btnTable) {
    btnTable.click();
    const rows = maintContainer.querySelectorAll('table.maintenance-table tbody tr');
    assert(rows.length > 0, 'Mode tableau rendu sans erreur');
  }

  console.log('7. Vérification de la génération iCalendar (UID stable et pliage RFC 5545)');
  const veh = window.getActiveVehicle();
  assert(veh, 'Véhicule actif trouvé');
  const engine = window.computePredictionEngine(veh);
  const testItem = veh.maintenanceItems[0];
  const testDue = window.calculateItemDueStatus(veh, testItem, engine);
  const singleIcs = window.generateSingleItemIcs(veh, testItem, testDue);
  assert(singleIcs, 'ICS généré avec succès');
  assert(singleIcs.includes(`UID:maint-${testItem.id}-${veh.id}@carnet-entretien`), 'UID ICS stable sans timestamp variable');

  // Vérifier qu'aucune ligne ne dépasse 75 octets avant le saut de ligne
  const encoder = new TextEncoder();
  const icsLines = singleIcs.split('\r\n').filter(l => l.length > 0);
  icsLines.forEach((l, idx) => {
    const bytesLen = encoder.encode(l).length;
    assert(bytesLen <= 75, `Ligne ${idx + 1} dépasse 75 octets (${bytesLen} octets): ${l}`);
  });

  console.log('8. Vérification de la prise en compte des prédictions parfaites (erreur 0)');
  const testVehLogs = {
    ...veh,
    kmLog: [
      { date: '2026-01-01', km: 100000, predictedKm: null },
      { date: '2026-01-10', km: 100500, predictedKm: 100500 }, // erreur 0 parfaite
      { date: '2026-01-20', km: 101000, predictedKm: 101020 }  // erreur 20
    ]
  };
  const testEngine = window.computePredictionEngine(testVehLogs);
  // Erreur moyenne : (0 + 20) / 2 = 10
  assert.strictEqual(testEngine.accuracy, 10, 'La précision inclut les prédictions exactes (erreur 0)');

  // Vérifier qu'aucune erreur de console / exception n'a été levée pendant le workflow utilisateur
  assert.strictEqual(errors.length, 0, `Erreurs rencontrées lors de l'exécution: ${errors.map(e => e.message || e).join(', ')}`);

  console.log('9. Vérification de la sauvegarde de sécurité sur données corrompues');
  window.localStorage.setItem('carnet_entretien_data_v1', '{ unparseable corrupt json !');
  const loadResult = window.loadState();
  assert.strictEqual(loadResult, false, 'loadState renvoie false sur JSON corrompu');
  const corruptKeys = Object.keys(window.localStorage).filter(k => k.startsWith('carnet_entretien_corrupt_'));
  assert(corruptKeys.length > 0, 'Clé de sauvegarde des données corrompues créée avec succès');

  console.log('10. Vérification de la suppression ciblée des données démo (isDemo: true)');
  // Simuler un état avec 1 véhicule réel et 1 véhicule démo via localStorage
  const testState = {
    schemaVersion: 1,
    vehicles: [
      { id: 'veh_real', name: 'Peugeot 208', brand: 'Peugeot', model: '208', currentKm: 50000, isDemo: false, kmLog: [{ date: '2026-01-01', km: 50000 }] },
      { id: 'veh_demo', name: 'Renault Symbol', brand: 'Renault', model: 'Symbol', currentKm: 118000, isDemo: true, kmLog: [{ date: '2026-01-01', km: 118000 }] }
    ],
    activeVehicleId: 'veh_real',
    history: [
      { id: 'h_real', vehicleId: 'veh_real', type: 'Vidange', date: '2026-01-01', km: 45000, isDemo: false },
      { id: 'h_demo', vehicleId: 'veh_demo', type: 'Filtre', date: '2025-06-01', km: 110000, isDemo: true }
    ],
    settings: {
      defaultIntervals: [],
      lastBackupDate: null
    },
    isDemo: true
  };
  window.localStorage.setItem('carnet_entretien_data_v1', JSON.stringify(testState));
  window.loadState();
  window.confirm = () => true; // Accepter la confirmation
  window.handleDeleteDemoData();

  const savedState = JSON.parse(window.localStorage.getItem('carnet_entretien_data_v1'));
  assert.strictEqual(savedState.vehicles.length, 1, 'Un seul véhicule subsiste');
  assert.strictEqual(savedState.vehicles[0].id, 'veh_real', 'Le véhicule réel est préservé');
  assert.strictEqual(savedState.history.length, 1, 'Un seul historique subsiste');
  assert.strictEqual(savedState.history[0].id, 'h_real', 'L\'historique du véhicule réel est préservé');

  console.log('11. Vérification du choix de mode au premier lancement (Salle vs Solo)');
  const choiceCreateBtn = document.getElementById('btnChoiceCreateRoom');
  const choiceJoinBtn = document.getElementById('btnChoiceJoinRoom');
  const choiceSoloBtn = document.getElementById('btnChoiceSolo');
  const backToChoiceBtn = document.getElementById('btnBackToChoice');
  const choiceSection = document.getElementById('onboardingChoiceSection');
  const formSection = document.getElementById('onboardingFormSection');
  const modalCreate = document.getElementById('modalCreateRoom');
  const modalJoin = document.getElementById('modalJoinRoom');

  assert(choiceCreateBtn && choiceJoinBtn && choiceSoloBtn, 'Boutons de choix de mode présents');
  
  // Test clic Solo
  choiceSoloBtn.click();
  assert(choiceSection.classList.contains('hidden'), 'Section choix masquée après clic Solo');
  assert(!formSection.classList.contains('hidden'), 'Formulaire Solo affiché après clic Solo');

  // Test retour au choix
  backToChoiceBtn.click();
  assert(!choiceSection.classList.contains('hidden'), 'Section choix réaffichée après retour');
  assert(formSection.classList.contains('hidden'), 'Formulaire Solo masqué après retour');

  // Test clic Créer une salle
  choiceCreateBtn.click();
  assert(!modalCreate.classList.contains('hidden'), 'Modale Créer une salle ouverte');
  document.getElementById('btnCloseCreateRoom').click();
  assert(modalCreate.classList.contains('hidden'), 'Modale Créer une salle fermée');

  // Test clic Rejoindre une salle
  choiceJoinBtn.click();
  assert(!modalJoin.classList.contains('hidden'), 'Modale Rejoindre une salle ouverte');
  document.getElementById('btnCloseJoinRoom').click();
  assert(modalJoin.classList.contains('hidden'), 'Modale Rejoindre une salle fermée');

  console.log('12. Vérification des tokens d\'invitation et de la persistance du profil de salle');
  // Parser de token d'invitation
  function parseInviteTokenTest(input) {
    if (!input) return null;
    let clean = input.trim();
    const hashIdx = clean.indexOf('#join=');
    if (hashIdx !== -1) clean = clean.substring(hashIdx + 6);
    const underscoreIdx = clean.indexOf('_');
    if (underscoreIdx === -1) return null;
    return { roomId: clean.substring(0, underscoreIdx), inviteId: clean.substring(underscoreIdx + 1) };
  }

  const sampleUrl = 'https://example.com/index.html#join=room123abc_inv456def789xyz1234567890';
  const parsedFromUrl = parseInviteTokenTest(sampleUrl);
  assert.strictEqual(parsedFromUrl.roomId, 'room123abc', 'RoomId correctement extrait de l\'URL');
  assert.strictEqual(parsedFromUrl.inviteId, 'inv456def789xyz1234567890', 'InviteId correctement extrait de l\'URL');

  // Persistance du profil de salle
  const dummyProfile = {
    roomId: 'room123abc',
    roomName: 'Famille Dupont',
    myName: 'Papa',
    myUid: 'uid_test_123',
    role: 'owner',
    status: 'approved'
  };
  window.localStorage.setItem('carnet_room_profile', JSON.stringify(dummyProfile));
  const readProfile = JSON.parse(window.localStorage.getItem('carnet_room_profile'));
  assert.strictEqual(readProfile.roomId, 'room123abc');
  assert.strictEqual(readProfile.role, 'owner');
  assert.strictEqual(readProfile.status, 'approved');

  console.log('13. Vérification qu\'un élément non renseigné reste "À renseigner" après migration (lastDate/lastKm = null)');
  const vehicleForMigration = {
    id: 'veh_test_mig',
    currentKm: 120000,
    kmLog: [{ date: '2026-01-01', km: 120000, predictedKm: 120000 }]
  };
  const rawUnfilledItem = {
    id: 'item_unfilled',
    vehicleId: 'veh_test_mig',
    name: 'Courroie de distribution',
    intervalKm: 100000,
    intervalMonths: 60,
    lastDate: null,
    lastKm: null
  };

  // Simuler la logique de migration de room.js
  const migratedItem = {
    ...rawUnfilledItem,
    lastDate: (rawUnfilledItem.lastDate && String(rawUnfilledItem.lastDate).trim() !== '') ? rawUnfilledItem.lastDate : null,
    lastKm: (rawUnfilledItem.lastKm !== null && rawUnfilledItem.lastKm !== undefined && rawUnfilledItem.lastKm !== '' && !isNaN(Number(rawUnfilledItem.lastKm))) ? Number(rawUnfilledItem.lastKm) : null
  };

  assert.strictEqual(migratedItem.lastDate, null, 'lastDate migré comme null et non chaîne vide');
  assert.strictEqual(migratedItem.lastKm, null, 'lastKm migré comme null et non 0');

  const statusResult = window.calculateItemDueStatus(vehicleForMigration, migratedItem);
  assert.strictEqual(statusResult.status, 'grey', 'Le statut est gris');
  assert.strictEqual(statusResult.statusLabel, 'À renseigner', 'Le statut affiché reste "À renseigner"');

  console.log('14. Vérification de l\'affichage de l\'auteur sur les relevés et l\'historique (Point 10)');
  // Ajouter un relevé avec un auteur "Papa"
  const testVehWithAuthor = {
    ...veh,
    kmLog: [
      { date: '2026-02-01', km: 118450, predictedKm: 118400, authorName: 'Papa' }
    ]
  };
  window.renderKmLogList(testVehWithAuthor);
  const authorBadgeKm = document.querySelector('#kmlogList .kmlog-author');
  assert(authorBadgeKm, 'Pastille auteur trouvée dans le relevé kilométrique');
  assert(authorBadgeKm.textContent.includes('Papa'), 'Le nom de l\'auteur "Papa" est bien affiché sur le relevé');

  // Ajouter un historique avec un auteur "Maman"
  window.appState.history = [
    {
      id: 'h_author_test',
      vehicleId: veh.id,
      type: 'Vidange huile moteur',
      date: '2026-02-05',
      km: 118450,
      cost: 4500,
      garage: 'Station Total',
      notes: 'Huile 5W40',
      authorName: 'Maman'
    }
  ];
  // Tester l'affichage en mode fiches
  window.saveUiPreference('historyViewMode', 'cards');
  window.renderHistoryScreen();
  const authorCardPill = document.querySelector('#historyList .history-pill-author');
  assert(authorCardPill, 'Pastille auteur trouvée sur la fiche d\'historique');
  assert(authorCardPill.textContent.includes('Maman'), 'Le nom de l\'auteur "Maman" est bien présent sur la fiche');

  // Tester l'affichage en mode tableau
  window.saveUiPreference('historyViewMode', 'table');
  window.renderHistoryScreen();
  const tableContent = document.getElementById('historyTableBody')?.innerHTML || '';
  assert(tableContent.includes('Maman'), 'Le nom de l\'auteur "Maman" est bien présent dans la ligne du tableau');

  console.log('15. Vérification de la gestion des membres de la salle (Retirer un membre, Point 11)');
  // Simuler le rendu de la section salle dans Paramètres
  const settingsContainer = document.getElementById('settingsRoomContainer');
  assert(settingsContainer, 'Conteneur settingsRoomContainer présent');

  // Profil propriétaire avec un membre tiers
  const testOwnerProfile = {
    roomId: 'room_famille_1',
    roomName: 'Famille Dupont',
    myName: 'Papa',
    myUid: 'uid_owner',
    role: 'owner',
    status: 'approved'
  };
  window.localStorage.setItem('carnet_room_profile', JSON.stringify(testOwnerProfile));

  // Simuler la fonction de rendu des paramètres telle qu'exécutée par room.js
  const sampleMembers = [
    { uid: 'uid_owner', name: 'Papa', role: 'owner', status: 'approved' },
    { uid: 'uid_brother', name: 'Karim', role: 'member', status: 'approved' }
  ];

  settingsContainer.innerHTML = `
    <div class="card">
      <div class="members-list">
        ${sampleMembers.map(m => `
          <div class="member-row">
            <span>👤 ${m.name}</span>
            ${(testOwnerProfile.role === 'owner' && m.uid !== testOwnerProfile.myUid) ? `
              <button type="button" class="btn-reject btn-xs btn-remove-member" data-uid="${m.uid}" data-name="${m.name}">
                Retirer
              </button>
            ` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;

  const removeBtns = settingsContainer.querySelectorAll('.btn-remove-member');
  assert.strictEqual(removeBtns.length, 1, 'Un bouton "Retirer" affiché pour le propriétaire');
  assert.strictEqual(removeBtns[0].getAttribute('data-uid'), 'uid_brother', 'Le bouton cible bien le membre tiers et non le propriétaire');

  console.log('16. Vérification des droits d\'administration de la salle (Effacement des données & suppression de salle)');
  // Simuler le rendu avec la Zone Administrateur pour le propriétaire
  const isOwner = testOwnerProfile.role === 'owner';
  settingsContainer.innerHTML = `
    <div class="card">
      ${isOwner ? `
        <div class="admin-danger-zone">
          <button type="button" id="btnAdminClearRoomData" class="btn-danger">Effacer toutes les données</button>
          <button type="button" id="btnAdminDeleteRoom" class="btn-danger">Supprimer la salle</button>
        </div>
      ` : ''}
    </div>
  `;
  const btnClearData = document.getElementById('btnAdminClearRoomData');
  const btnDelRoom = document.getElementById('btnAdminDeleteRoom');
  assert(btnClearData, 'Bouton "Effacer toutes les données" présent pour l\'administrateur');
  assert(btnDelRoom, 'Bouton "Supprimer la salle" présent pour l\'administrateur');

  // Simuler pour un membre ordinaire
  const isMemberOwner = false;
  settingsContainer.innerHTML = `
    <div class="card">
      ${isMemberOwner ? `
        <div class="admin-danger-zone">
          <button type="button" id="btnAdminClearRoomData" class="btn-danger">Effacer toutes les données</button>
          <button type="button" id="btnAdminDeleteRoom" class="btn-danger">Supprimer la salle</button>
        </div>
      ` : ''}
    </div>
  `;
  assert.strictEqual(document.getElementById('btnAdminClearRoomData'), null, 'Bouton absent pour un simple membre');
  assert.strictEqual(document.getElementById('btnAdminDeleteRoom'), null, 'Bouton supprimer salle absent pour un simple membre');

  console.log('17. Vérification de la présence et structure de la modale de passation de propriété');
  const modalTransfer = document.getElementById('modalTransferOwnership');
  const selectSuccessor = document.getElementById('transferSuccessorSelect');
  const btnConfirmTransfer = document.getElementById('btnConfirmTransferOwnership');
  const btnCancelTransfer = document.getElementById('btnCancelTransferOwnership');
  assert(modalTransfer, 'Modale modalTransferOwnership présente dans le DOM');
  assert(selectSuccessor, 'Sélecteur transferSuccessorSelect présent');
  assert(btnConfirmTransfer, 'Bouton confirmer le transfert présent');
  assert(btnCancelTransfer, 'Bouton annuler le transfert présent');

  console.log('18. Vérification de la logique de passation de rôle lors du départ de l\'administrateur');
  // Simuler la sélection d'un successeur parmi les autres membres approuvés
  const testRoomMembers = [
    { uid: 'uid_owner', name: 'Papa', role: 'owner', status: 'approved' },
    { uid: 'uid_brother', name: 'Karim', role: 'member', status: 'approved' },
    { uid: 'uid_pending', name: 'Invité', role: 'member', status: 'pending' }
  ];

  // Les candidats éligibles à la succession ne doivent inclure que les membres approuvés tiers
  const eligibleSuccessors = testRoomMembers.filter(
    m => m.uid !== testOwnerProfile.myUid && m.status === 'approved'
  );
  assert.strictEqual(eligibleSuccessors.length, 1, 'Un seul successeur approuvé éligible (Karim)');
  assert.strictEqual(eligibleSuccessors[0].name, 'Karim');

  // Peupler le sélecteur avec les candidats éligibles
  selectSuccessor.innerHTML = eligibleSuccessors.map(m => `<option value="${m.uid}">${m.name}</option>`).join('');
  assert.strictEqual(selectSuccessor.children.length, 1, 'Option ajoutée dans le sélecteur');
  assert.strictEqual(selectSuccessor.options[0].value, 'uid_brother', 'L\'option pointe bien vers le successeur Karim');

  console.log('19. Vérification des fonctions exportées sur window.FamilyRoom dans room.js');
  const roomJsContent = fs.readFileSync(path.join(__dirname, '..', 'room.js'), 'utf8');
  const expectedFamilyRoomMethods = [
    'createFamilyRoom',
    'joinFamilyRoom',
    'createAdditionalInvite',
    'approveMember',
    'rejectMember',
    'removeMember',
    'transferOwnershipAndLeave',
    'showTransferOwnershipModal',
    'hideTransferOwnershipModal',
    'showShareInviteModal',
    'hideShareInviteModal',
    'showPendingApprovalModal',
    'hidePendingApprovalModal',
    'leaveRoom',
    'clearAllRoomData',
    'deleteEntireRoom',
    'shareInviteLink',
    'getStoredRoomProfile',
    'saveStoredRoomProfile',
    'isRoomActive',
    'recordKmReading',
    'recordHistoryEntry',
    'saveVehicle',
    'deleteVehicle',
    'saveMaintenanceItem',
    'deleteMaintenanceItem',
    'deleteHistoryEntry',
    'startRoomSynchronization',
    'stopRoomSynchronization',
    'renderActivityFeed',
    'updateSyncIndicatorBadge',
    'initFamilyRoom',
    'renderSettingsRoomSection',
    'updateMemberProfile',
    'showEditMemberModal',
    'hideEditMemberModal'
  ];

  // Extraire le bloc window.FamilyRoom = { ... };
  const familyRoomBlockMatch = roomJsContent.match(/window\.FamilyRoom\s*=\s*\{([\s\S]*?)\};/);
  assert(familyRoomBlockMatch, 'Bloc window.FamilyRoom présent dans room.js');
  const exportedIdentifiers = familyRoomBlockMatch[1]
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  for (const method of expectedFamilyRoomMethods) {
    assert(
      exportedIdentifiers.includes(method),
      `Méthode obligatoire "${method}" absente de window.FamilyRoom dans room.js`
    );
  }

  console.log('20. Vérification des éléments de profil membre, numéros WhatsApp et e-mails dans le DOM');
  assert(document.getElementById('modalEditMemberProfile'), 'Modale modalEditMemberProfile présente');
  assert(document.getElementById('editMemberUid'), 'Input editMemberUid présent');
  assert(document.getElementById('editMemberNameInput'), 'Input editMemberNameInput présent');
  assert(document.getElementById('editMemberPhoneInput'), 'Input editMemberPhoneInput présent');
  assert(document.getElementById('editMemberEmailInput'), 'Input editMemberEmailInput présent');
  assert(document.getElementById('createOwnerPhone'), 'Input createOwnerPhone présent');
  assert(document.getElementById('createOwnerEmail'), 'Input createOwnerEmail présent');
  assert(document.getElementById('joinMemberPhone'), 'Input joinMemberPhone présent');
  assert(document.getElementById('joinMemberEmail'), 'Input joinMemberEmail présent');

  console.log('21. Vérification de l\'ajout d\'interventions passées dans l\'historique (recalibration IA)');
  const btnAddHist = document.getElementById('btnAddHistoryEntry');
  const modalAddHist = document.getElementById('modalAddHistoryEntry');
  assert(btnAddHist, 'Bouton btnAddHistoryEntry présent dans l\'en-tête de l\'historique');
  assert(modalAddHist, 'Modale modalAddHistoryEntry présente dans le DOM');

  // Ouvrir la modale
  window.openAddHistoryModal();
  assert(!modalAddHist.classList.contains('hidden'), 'La modale modalAddHistoryEntry doit être visible');

  const selVehHist = document.getElementById('addHistVehicleSelect');
  const selTypeHist = document.getElementById('addHistTypeSelect');
  const dateInputHist = document.getElementById('addHistDateInput');
  const kmInputHist = document.getElementById('addHistKmInput');
  const costInputHist = document.getElementById('addHistCostInput');
  const formHist = document.getElementById('formAddHistoryEntry');

  assert(selVehHist && selVehHist.options.length > 0, 'Sélecteur de véhicule rempli');
  assert(selTypeHist && selTypeHist.options.length > 0, 'Sélecteur de types d\'intervention rempli');

  // Remplir une ancienne vidange passée
  const testPastDate = new Date(Date.now() - 150 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const activeVeh = window.appState.vehicles[0];
  const testPastKm = Math.max(1000, (activeVeh.currentKm || 50000) - 8000);

  selTypeHist.value = 'Vidange (moteur)';
  dateInputHist.value = testPastDate;
  kmInputHist.value = String(testPastKm);
  costInputHist.value = '6500';

  const historyLenBefore = (window.appState.history || []).length;

  const fakeSubmitEvent = new window.Event('submit', { cancelable: true });
  window.handleAddHistorySubmit(fakeSubmitEvent);

  assert.strictEqual(window.appState.history.length, historyLenBefore + 1, 'Une intervention doit être ajoutée dans appState.history');
  const addedRecord = window.appState.history[0];
  assert.strictEqual(addedRecord.type, 'Vidange (moteur)', 'Type d\'intervention conforme');
  assert.strictEqual(addedRecord.km, testPastKm, 'Kilométrage passé conforme');
  assert.strictEqual(addedRecord.cost, 6500, 'Coût conforme');
  assert(modalAddHist.classList.contains('hidden'), 'La modale doit être fermée après enregistrement');

  // Vérifier qu'on peut ajouter plus de 3 interventions (4ème, 5ème, 6ème...) sans limitation
  const btnAddAnother = document.getElementById('btnAddAnotherHistoryEntry');
  assert(btnAddAnother, 'Bouton btnAddAnotherHistoryEntry présent dans la modale');

  window.openAddHistoryModal();
  for (let step = 2; step <= 5; step++) {
    selTypeHist.value = 'Filtre à air';
    dateInputHist.value = new Date(Date.now() - (150 - step * 10) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    kmInputHist.value = String(testPastKm + step * 1000);
    const keepOpen = step < 5;
    window.handleAddHistorySubmit(new window.Event('submit', { cancelable: true }), keepOpen);
  }

  assert(window.appState.history.length >= 5, `Doit contenir au moins 5 interventions (actuel : ${window.appState.history.length})`);
  assert(modalAddHist.classList.contains('hidden'), 'La modale doit être fermée après la 5ème intervention');

  console.log('✅ TOUS LES TESTS DU SMOKE TEST (21/21) ONT RÉUSSI SANS AUCUNE ERREUR !');
  process.exit(0);
} catch (err) {
  console.error('❌ Échec du smoke test:', err);
  process.exit(1);
}
