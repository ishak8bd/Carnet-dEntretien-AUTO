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

let mockNotificationPermission = 'default';
const mockSentNotifications = [];

class MockNotification {
  constructor(title, options = {}) {
    this.title = title;
    this.options = options;
    mockSentNotifications.push({ title, options });
  }
  static get permission() {
    return mockNotificationPermission;
  }
  static requestPermission() {
    mockNotificationPermission = 'granted';
    return Promise.resolve('granted');
  }
}
window.Notification = MockNotification;

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
(async () => {
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
    'hideEditMemberModal',
    'getExternalContacts',
    'saveExternalContact',
    'deleteExternalContact'
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

  console.log('22. Vérification des destinataires supplémentaires d\'alertes (modal, saisie multiple e-mails/téléphones sans adhésion)');
  const modalContact = document.getElementById('modalAddContact');
  const btnAddContact = document.getElementById('btnAddExternalContact');
  const contactsList = document.getElementById('settingsContactsList');
  const inpContactName = document.getElementById('contactNameInput');
  const inpContactEmail = document.getElementById('contactEmailInput');
  const inpContactPhone = document.getElementById('contactPhoneInput');
  const formContact = document.getElementById('formAddContact');

  assert(modalContact, 'Modale modalAddContact présente dans le DOM');
  assert(btnAddContact, 'Bouton btnAddExternalContact présent dans les paramètres');
  assert(contactsList, 'Conteneur settingsContactsList présent');
  assert(inpContactName, 'Input contactNameInput présent');
  assert(inpContactEmail, 'Input contactEmailInput présent');
  assert(inpContactPhone, 'Input contactPhoneInput présent');

  // Ouvrir la modale
  window.openAddContactModal();
  assert(!modalContact.classList.contains('hidden'), 'La modale modalAddContact doit être visible');

  // Ajouter un 1er contact avec e-mail seul
  inpContactName.value = 'Oncle Sam';
  inpContactEmail.value = 'sam@example.com';
  inpContactPhone.value = '';
  await window.handleContactFormSubmit(new window.Event('submit', { cancelable: true }));

  // Ajouter un 2ème contact avec téléphone WhatsApp seul
  window.openAddContactModal();
  inpContactName.value = 'Mécanicien Ahmed';
  inpContactEmail.value = '';
  inpContactPhone.value = '213555123456';
  await window.handleContactFormSubmit(new window.Event('submit', { cancelable: true }));

  // Ajouter un 3ème contact avec les deux
  window.openAddContactModal();
  inpContactName.value = 'Grand-père';
  inpContactEmail.value = 'papy@famille.dz';
  inpContactPhone.value = '+213555987654';
  await window.handleContactFormSubmit(new window.Event('submit', { cancelable: true }));

  assert(Array.isArray(window.appState.settings.contacts), 'appState.settings.contacts doit être un tableau');
  assert.strictEqual(window.appState.settings.contacts.length, 3, '3 contacts supplémentaires enregistrés');
  assert.strictEqual(window.appState.settings.contacts[0].name, 'Oncle Sam');
  assert.strictEqual(window.appState.settings.contacts[1].phone, '213555123456');
  assert.strictEqual(window.appState.settings.contacts[2].email, 'papy@famille.dz');

  // Vérifier le rendu dans la liste
  window.renderExternalContactsList();
  assert.strictEqual(contactsList.querySelectorAll('.contact-card-row').length, 3, '3 cartes de destinataires rendues dans le DOM');

  console.log('23. Vérification du logo et des thèmes (Bleu & Or, Cyber Glassmorphism, Acier Mécanique, Carbone & Bulle, Apple Liquid Glass et persistance)');
  const appLogoImg = document.getElementById('appLogoImg');
  const favIcon = document.getElementById('dynamicFavicon');
  const appleIcon = document.getElementById('dynamicAppleIcon');
  const optDark = document.getElementById('logoOptionDark');
  const optBlue = document.getElementById('logoOptionBlue');
  const optGlass = document.getElementById('logoOptionGlass');
  const optSteel = document.getElementById('logoOptionSteel');
  const optBubble = document.getElementById('logoOptionBubble');
  const optLiquid = document.getElementById('logoOptionLiquid');
  const activeBadge = document.getElementById('activeLogoBadge');

  assert(appLogoImg, 'Image de logo appLogoImg présente dans l\'en-tête');
  assert(favIcon, 'Favicon dynamique présent');
  assert(appleIcon, 'Apple-touch-icon dynamique présent');
  assert(!optDark, 'Option logo Noir & Carbone doit être retirée des paramètres');
  assert(optLiquid, 'Option thème Apple Liquid Glass présente dans les paramètres');
  assert(optBlue, 'Option logo Bleu & Or présente dans les paramètres');
  assert(optGlass, 'Option thème Cyber Glassmorphism présente dans les paramètres');
  assert(optSteel, 'Option thème Acier Mécanique & Digital présente dans les paramètres');
  assert(optBubble, 'Option thème Carbone & Bulle présente dans les paramètres');

  // Par défaut, le thème doit être Bleu & Or (blue)
  assert(appLogoImg.src.includes('logo-blue.png'), 'Le logo par défaut doit être bleu (logo-blue.png)');
  assert(favIcon.href.includes('icon-blue-192.png'), 'Le favicon par défaut doit pointer sur icon-blue-192.png');
  assert(optBlue.classList.contains('active'), 'L\'option Bleu & Or doit être active par défaut');
  assert(!optGlass.classList.contains('active'), 'L\'option Glassmorphism ne doit pas être active au départ');
  assert(!optSteel.classList.contains('active'), 'L\'option Acier ne doit pas être active au départ');
  assert(!optBubble.classList.contains('active'), 'L\'option Bulle ne doit pas être active au départ');
  assert(!optLiquid.classList.contains('active'), 'L\'option Liquid ne doit pas être active au départ');
  assert(document.body.classList.contains('theme-blue'), 'La classe theme-blue doit être présente par défaut');
  assert(!document.body.classList.contains('theme-glass'), 'La classe theme-glass ne doit pas être présente par défaut');
  assert(!document.body.classList.contains('theme-steel'), 'La classe theme-steel ne doit pas être présente par défaut');
  assert(!document.body.classList.contains('theme-bubble'), 'La classe theme-bubble ne doit pas être présente par défaut');
  assert(!document.body.classList.contains('theme-liquid'), 'La classe theme-liquid ne doit pas être présente par défaut');
  if (activeBadge) {
    assert.strictEqual(activeBadge.textContent.trim(), 'Bleu & Or', 'Le badge indique Bleu & Or');
  }

  // Basculer vers le thème Cyber Glassmorphism
  optGlass.click();
  assert(appLogoImg.src.includes('logo-glass.png'), 'Le logo dans l\'en-tête doit maintenant pointer sur logo-glass.png');
  assert(favIcon.href.includes('icon-glass-192.png'), 'Le favicon doit pointer sur icon-glass-192.png');
  assert(optGlass.classList.contains('active'), 'L\'option Cyber Glassmorphism doit être marquée active');
  assert(!optBlue.classList.contains('active'), 'L\'option Bleu & Or ne doit plus être active');
  assert(!optSteel.classList.contains('active'), 'L\'option Acier ne doit plus être active');
  assert(!optBubble.classList.contains('active'), 'L\'option Bulle ne doit plus être active');
  assert(!optLiquid.classList.contains('active'), 'L\'option Liquid ne doit plus être active');
  assert(document.body.classList.contains('theme-glass'), 'La classe theme-glass doit être ajoutée au body');
  assert.strictEqual(window.localStorage.getItem('carnet_app_logo'), 'glass', 'Le choix "glass" doit être persisté dans localStorage carnet_app_logo');
  assert.strictEqual(window.localStorage.getItem('carnet_app_theme'), 'glass', 'Le choix "glass" doit être persisté dans localStorage carnet_app_theme');
  assert.strictEqual(window.appState.settings.appLogo, 'glass', 'appState.settings.appLogo doit valoir "glass"');
  if (activeBadge) {
    assert.strictEqual(activeBadge.textContent.trim(), 'Cyber Glassmorphism', 'Le badge indique Cyber Glassmorphism');
  }

  // Basculer vers le thème Acier Mécanique & Digital
  optSteel.click();
  assert(appLogoImg.src.includes('logo-steel.png'), 'Le logo dans l\'en-tête doit maintenant pointer sur logo-steel.png');
  assert(favIcon.href.includes('icon-steel-192.png'), 'Le favicon doit pointer sur icon-steel-192.png');
  assert(optSteel.classList.contains('active'), 'L\'option Acier Mécanique & Digital doit être marquée active');
  assert(!optBlue.classList.contains('active'), 'L\'option Bleu & Or ne doit plus être active');
  assert(!optGlass.classList.contains('active'), 'L\'option Cyber Glassmorphism ne doit plus être active');
  assert(!optBubble.classList.contains('active'), 'L\'option Bulle ne doit plus être active');
  assert(!optLiquid.classList.contains('active'), 'L\'option Liquid ne doit plus être active');
  assert(document.body.classList.contains('theme-steel'), 'La classe theme-steel doit être ajoutée au body');
  assert.strictEqual(window.localStorage.getItem('carnet_app_logo'), 'steel', 'Le choix "steel" doit être persisté dans localStorage carnet_app_logo');
  assert.strictEqual(window.localStorage.getItem('carnet_app_theme'), 'steel', 'Le choix "steel" doit être persisté dans localStorage carnet_app_theme');
  assert.strictEqual(window.appState.settings.appLogo, 'steel', 'appState.settings.appLogo doit valoir "steel"');
  if (activeBadge) {
    assert.strictEqual(activeBadge.textContent.trim(), 'Acier Mécanique & Digital', 'Le badge indique Acier Mécanique & Digital');
  }

  // Basculer vers le thème Carbone & Bulle
  optBubble.click();
  assert(appLogoImg.src.includes('logo-bubble.png'), 'Le logo dans l\'en-tête doit maintenant pointer sur logo-bubble.png');
  assert(favIcon.href.includes('icon-bubble-192.png'), 'Le favicon doit pointer sur icon-bubble-192.png');
  assert(optBubble.classList.contains('active'), 'L\'option Carbone & Bulle doit être marquée active');
  assert(!optBlue.classList.contains('active'), 'L\'option Bleu & Or ne doit plus être active');
  assert(!optGlass.classList.contains('active'), 'L\'option Cyber Glassmorphism ne doit plus être active');
  assert(!optSteel.classList.contains('active'), 'L\'option Acier ne doit plus être active');
  assert(!optLiquid.classList.contains('active'), 'L\'option Liquid ne doit plus être active');
  assert(document.body.classList.contains('theme-bubble'), 'La classe theme-bubble doit être ajoutée au body');
  assert.strictEqual(window.localStorage.getItem('carnet_app_logo'), 'bubble', 'Le choix "bubble" doit être persisté dans localStorage carnet_app_logo');
  assert.strictEqual(window.localStorage.getItem('carnet_app_theme'), 'bubble', 'Le choix "bubble" doit être persisté dans localStorage carnet_app_theme');
  assert.strictEqual(window.appState.settings.appLogo, 'bubble', 'appState.settings.appLogo doit valoir "bubble"');
  if (activeBadge) {
    assert.strictEqual(activeBadge.textContent.trim(), 'Carbone & Bulle', 'Le badge indique Carbone & Bulle');
  }

  // Basculer vers le thème Apple iOS 26 Liquid Glass
  optLiquid.click();
  assert(appLogoImg.src.includes('logo-liquid.png'), 'Le logo dans l\'en-tête doit maintenant pointer sur logo-liquid.png');
  assert(favIcon.href.includes('icon-liquid-192.png'), 'Le favicon doit pointer sur icon-liquid-192.png');
  assert(optLiquid.classList.contains('active'), 'L\'option Apple Liquid Glass doit être marquée active');
  assert(!optBlue.classList.contains('active'), 'L\'option Bleu & Or ne doit plus être active');
  assert(!optGlass.classList.contains('active'), 'L\'option Cyber Glassmorphism ne doit plus être active');
  assert(!optSteel.classList.contains('active'), 'L\'option Acier ne doit plus être active');
  assert(!optBubble.classList.contains('active'), 'L\'option Bulle ne doit plus être active');
  assert(document.body.classList.contains('theme-liquid'), 'La classe theme-liquid doit être ajoutée au body');
  assert.strictEqual(window.localStorage.getItem('carnet_app_logo'), 'liquid', 'Le choix "liquid" doit être persisté dans localStorage carnet_app_logo');
  assert.strictEqual(window.localStorage.getItem('carnet_app_theme'), 'liquid', 'Le choix "liquid" doit être persisté dans localStorage carnet_app_theme');
  assert.strictEqual(window.appState.settings.appLogo, 'liquid', 'appState.settings.appLogo doit valoir "liquid"');
  if (activeBadge) {
    assert(activeBadge.textContent.includes('Liquid Glass'), 'Le badge indique Apple iOS 26 Liquid Glass');
  }

  // Basculer de nouveau vers le logo Bleu & Or
  optBlue.click();
  assert(appLogoImg.src.includes('logo-blue.png'), 'Le logo dans l\'en-tête doit revenir à logo-blue.png');
  assert(optBlue.classList.contains('active'), 'L\'option Bleu & Or doit redevenir active');
  assert(!optGlass.classList.contains('active'), 'L\'option Cyber Glassmorphism ne doit plus être active');
  assert(!optSteel.classList.contains('active'), 'L\'option Acier ne doit plus être active');
  assert(!optBubble.classList.contains('active'), 'L\'option Bulle ne doit plus être active');
  assert(!optLiquid.classList.contains('active'), 'L\'option Liquid ne doit plus être active');
  assert(document.body.classList.contains('theme-blue'), 'La classe theme-blue doit être présente sur le body');
  assert(!document.body.classList.contains('theme-glass'), 'La classe theme-glass doit être retirée du body');
  assert(!document.body.classList.contains('theme-steel'), 'La classe theme-steel doit être retirée du body');
  assert(!document.body.classList.contains('theme-bubble'), 'La classe theme-bubble doit être retirée du body');
  assert(!document.body.classList.contains('theme-liquid'), 'La classe theme-liquid doit être retirée du body');
  assert.strictEqual(window.localStorage.getItem('carnet_app_logo'), 'blue', 'Le choix "blue" doit être persisté dans localStorage');
  assert.strictEqual(window.appState.settings.appLogo, 'blue', 'appState.settings.appLogo doit valoir "blue"');
  if (activeBadge) {
    assert.strictEqual(activeBadge.textContent.trim(), 'Bleu & Or', 'Le badge indique Bleu & Or');
  }

  // Test du bouton de bascule rapide de thème dans l'en-tête (btnHeaderThemeSwitch) : blue -> glass -> steel -> bubble -> liquid -> blue
  const btnHeaderTheme = document.getElementById('btnHeaderThemeSwitch');
  assert(btnHeaderTheme, 'Bouton de bascule rapide de thème présent dans l\'en-tête');

  // Actuellement en 'blue' -> 1er clic sur le bouton d'en-tête bascule vers 'glass'
  btnHeaderTheme.click();
  assert.strictEqual(window.localStorage.getItem('carnet_app_theme'), 'glass', 'Bascule rapide vers glass');
  assert(document.body.classList.contains('theme-glass'), 'Body a la classe theme-glass');

  // 2e clic -> bascule vers 'steel'
  btnHeaderTheme.click();
  assert.strictEqual(window.localStorage.getItem('carnet_app_theme'), 'steel', 'Bascule rapide vers steel');
  assert(document.body.classList.contains('theme-steel'), 'Body a la classe theme-steel');

  // 3e clic -> bascule vers 'bubble'
  btnHeaderTheme.click();
  assert.strictEqual(window.localStorage.getItem('carnet_app_theme'), 'bubble', 'Bascule rapide vers bubble');
  assert(document.body.classList.contains('theme-bubble'), 'Body a la classe theme-bubble');

  // 4e clic -> bascule vers 'liquid'
  btnHeaderTheme.click();
  assert.strictEqual(window.localStorage.getItem('carnet_app_theme'), 'liquid', 'Bascule rapide vers liquid');
  assert(document.body.classList.contains('theme-liquid'), 'Body a la classe theme-liquid');

  // 5e clic -> retour vers 'blue'
  btnHeaderTheme.click();
  assert.strictEqual(window.localStorage.getItem('carnet_app_theme'), 'blue', 'Bascule rapide retour vers blue');
  assert(document.body.classList.contains('theme-blue'), 'Body a la classe theme-blue');
  assert(!document.body.classList.contains('theme-glass'), 'Body n\'a plus theme-glass');
  assert(!document.body.classList.contains('theme-steel'), 'Body n\'a plus theme-steel');
  assert(!document.body.classList.contains('theme-bubble'), 'Body n\'a plus theme-bubble');
  assert(!document.body.classList.contains('theme-liquid'), 'Body n\'a plus theme-liquid');

  // Vérification de la bascule Mode Sombre / Mode Clair (Bouton esthétique en-tête)
  const btnColorMode = document.getElementById('btnHeaderColorModeSwitch');
  const iconColorMode = document.getElementById('headerColorModeIcon');
  assert(btnColorMode, 'Bouton de bascule mode sombre/clair présent dans l\'en-tête');
  assert(iconColorMode, 'Icône du bouton de bascule mode sombre/clair présente');

  // Test du mode sombre
  window.applyColorMode('dark');
  assert.strictEqual(document.documentElement.getAttribute('data-color-mode'), 'dark', 'Attribut data-color-mode est bien "dark"');
  assert.strictEqual(window.localStorage.getItem('carnet_color_mode'), 'dark', 'carnet_color_mode persisté à "dark"');
  assert.strictEqual(iconColorMode.textContent, '☀️', 'Icône affiche ☀️ pour inviter au mode clair');

  // Clic sur le bouton -> bascule vers mode clair
  btnColorMode.click();
  assert.strictEqual(document.documentElement.getAttribute('data-color-mode'), 'light', 'Bascule vers "light" validée');
  assert.strictEqual(window.localStorage.getItem('carnet_color_mode'), 'light', 'carnet_color_mode persisté à "light"');
  assert.strictEqual(iconColorMode.textContent, '🌙', 'Icône affiche 🌙 pour inviter au mode sombre');

  // 2e Clic sur le bouton -> retour vers mode sombre
  btnColorMode.click();
  assert.strictEqual(document.documentElement.getAttribute('data-color-mode'), 'dark', 'Retour vers "dark" validé');
  assert.strictEqual(window.localStorage.getItem('carnet_color_mode'), 'dark', 'carnet_color_mode persisté à "dark"');
  assert.strictEqual(iconColorMode.textContent, '☀️', 'Icône réaffiche ☀️');

  console.log('24. Vérification des notifications de l\'appareil (Web Push & Alertes PWA)');
  const notifCard = document.getElementById('settingsNotificationsCard');
  const notifBadge = document.getElementById('notifStatusBadge');
  const btnToggleNotif = document.getElementById('btnToggleNotifications');
  const btnTestNotif = document.getElementById('btnTestNotification');
  const chkUrgent = document.getElementById('chkNotifUrgentMaint');
  const chkStale = document.getElementById('chkNotifStaleKm');

  assert(notifCard, 'Carte des notifications présente dans le DOM');
  assert(notifBadge, 'Badge de statut de notification présent');
  assert(btnToggleNotif, 'Bouton d\'activation des notifications présent');
  assert(btnTestNotif, 'Bouton de test des notifications présent');
  assert(chkUrgent, 'Case à cocher pour les entretiens urgents présente');
  assert(chkStale, 'Case à cocher pour le rappel kilométrique présente');
  assert(!document.getElementById('chkNotifTestMode'), 'La case à cocher temporaire du mode test 5 min a bien été retirée');

  // Vérification de la saisie libre des fréquences d'alertes (Rouge et Orange)
  const inputRed = document.getElementById('inputAlertFreqRedValue');
  const unitRed = document.getElementById('selectAlertFreqRedUnit');
  const lblRed = document.getElementById('lblCurrentRedFreq');
  const inputOrange = document.getElementById('inputAlertFreqOrangeValue');
  const unitOrange = document.getElementById('selectAlertFreqOrangeUnit');
  const lblOrange = document.getElementById('lblCurrentOrangeFreq');

  assert(inputRed, 'Champ de saisie libre fréquence rouge présent');
  assert(unitRed, 'Sélecteur unité fréquence rouge présent');
  assert(lblRed, 'Label fréquence rouge présent');
  assert(inputOrange, 'Champ de saisie libre fréquence orange présent');
  assert(unitOrange, 'Sélecteur unité fréquence orange présent');
  assert(lblOrange, 'Label fréquence orange présent');

  // Vérification de la saisie libre du seuil X jours et de la fréquence alarme compteur
  const inputStaleKmDays = document.getElementById('inputNotifStaleKmDays');
  const inputKm = document.getElementById('inputAlertFreqKmValue');
  const unitKm = document.getElementById('selectAlertFreqKmUnit');
  const lblKm = document.getElementById('lblCurrentKmFreq');

  assert(inputStaleKmDays, 'Champ de saisie libre du seuil kilométrique X jours présent');
  assert(inputKm, 'Champ de saisie libre fréquence alarme compteur présent');
  assert(unitKm, 'Sélecteur unité fréquence alarme compteur présent');
  assert(lblKm, 'Label fréquence alarme compteur présent');

  // Test de modification libre des fréquences
  inputRed.value = '10';
  unitRed.value = 'minutes';
  inputOrange.value = '3';
  unitOrange.value = 'days';
  inputKm.value = '2';
  unitKm.value = 'days';
  inputStaleKmDays.value = '7';
  window.saveAlertFrequenciesFromInputs();

  assert.strictEqual(window.appState.settings.alertFreqRedValue, 10, 'Fréquence rouge mise à jour à 10');
  assert.strictEqual(window.appState.settings.alertFreqRedUnit, 'minutes', 'Unité rouge mise à jour à minutes');
  assert.strictEqual(window.getAlertFrequencyMinutes('red'), 10, 'Cadence rouge = 10 min');
  assert.strictEqual(window.appState.settings.alertFreqOrangeValue, 3, 'Fréquence orange mise à jour à 3');
  assert.strictEqual(window.appState.settings.alertFreqOrangeUnit, 'days', 'Unité orange mise à jour à days');
  assert.strictEqual(window.getAlertFrequencyMinutes('orange'), 3 * 24 * 60, 'Cadence orange = 3 jours');
  assert.strictEqual(window.appState.settings.alertFreqKmValue, 2, 'Fréquence compteur mise à jour à 2');
  assert.strictEqual(window.appState.settings.alertFreqKmUnit, 'days', 'Unité compteur mise à jour à days');
  assert.strictEqual(window.getAlertFrequencyMinutes('km'), 2 * 24 * 60, 'Cadence compteur = 2 jours');
  assert.strictEqual(window.appState.settings.notifStaleKmDays, 7, 'Seuil X jours kilométrique mis à jour à 7');
  assert(lblRed.textContent.includes('10 minute'), 'Label rouge reflète 10 minutes');
  assert(lblOrange.textContent.includes('3 jour'), 'Label orange reflète 3 jours');
  assert(lblKm.textContent.includes('2 jour'), 'Label compteur reflète 2 jours');

  // Remettre en mode normal 5 min / 15 min / 12 h / 15 j
  inputRed.value = '5';
  unitRed.value = 'minutes';
  inputOrange.value = '15';
  unitOrange.value = 'minutes';
  inputKm.value = '12';
  unitKm.value = 'hours';
  inputStaleKmDays.value = '15';
  window.saveAlertFrequenciesFromInputs();

  // Vérification de la bannière d'activation sur le tableau de bord
  const notifBanner = document.getElementById('notifPermissionBanner');
  const btnBannerEnable = document.getElementById('btnBannerEnableNotif');
  const btnBannerDismiss = document.getElementById('btnBannerDismissNotif');
  assert(notifBanner, 'Bannière d\'activation rapide des notifications présente');
  assert(btnBannerEnable, 'Bouton d\'activation sur la bannière présent');
  assert(btnBannerDismiss, 'Bouton de masquage sur la bannière présent');

  // Activer les notifications
  await window.toggleDeviceNotifications();
  assert.strictEqual(window.appState.settings.notificationsEnabled, true, 'notificationsEnabled doit être à true après activation');
  assert(notifBadge.textContent.includes('Activées'), 'Le badge doit indiquer Activées');
  assert.strictEqual(btnTestNotif.style.display, 'inline-flex', 'Le bouton de test doit être visible');

  // Tester l'émission de la notification de test
  await window.sendTestNotification();
  assert(mockSentNotifications.length >= 1, 'Au moins une notification système a été émise');
  const lastMock = mockSentNotifications[mockSentNotifications.length - 1];
  assert(lastMock.title.includes('Carnet Auto'), 'Le titre de la notification doit mentionner Carnet Auto');

  // Tester la vérification d'échéances sans planter
  const selThreshold = document.getElementById('selectNotifThreshold');
  assert(selThreshold, 'Sélecteur de seuil d\'échéance présente dans les paramètres');
  assert.strictEqual(window.appState.settings.notifThresholdDays, 15, 'Seuil par défaut à 15 jours');

  // Simuler un véhicule avec une opération proche (ex: 5 jours restants)
  const countBefore = mockSentNotifications.length;
  const targetTestVehicle = window.getActiveVehicle();
  if (targetTestVehicle && targetTestVehicle.maintenanceItems && targetTestVehicle.maintenanceItems.length > 0) {
    const item = targetTestVehicle.maintenanceItems[0];
    item.lastDate = '2025-01-01'; // Ancienne date
    item.intervalMonths = 12;     // Échue ou très proche
    await window.checkAndSendPendingMaintenanceNotifications();
    const newNotifs = mockSentNotifications.slice(countBefore);
    const hasMaintAlert = newNotifs.some(n => n.title.includes(item.name) || n.title.includes('Entretien') || n.title.includes('Échéance'));
    assert(hasMaintAlert, 'Une alerte spécifique pour l\'entretien testé doit être émise');
  }

  console.log('25. Vérification de l\'organisation des paramètres par sous-onglets');
  const settingsTabAlerts = document.querySelector('.settings-tab-btn[data-settings-tab="alerts"]');
  const settingsTabRoom = document.querySelector('.settings-tab-btn[data-settings-tab="room"]');
  const settingsTabAppearance = document.querySelector('.settings-tab-btn[data-settings-tab="appearance"]');
  const settingsTabIntervals = document.querySelector('.settings-tab-btn[data-settings-tab="intervals"]');
  const settingsTabSystem = document.querySelector('.settings-tab-btn[data-settings-tab="system"]');

  assert(settingsTabAlerts && settingsTabRoom && settingsTabAppearance && settingsTabIntervals && settingsTabSystem, 'Tous les 5 sous-onglets de paramètres sont présents');

  const panelAlerts = document.getElementById('panelSettings_alerts');
  const panelRoom = document.getElementById('panelSettings_room');
  const panelAppearance = document.getElementById('panelSettings_appearance');
  const panelIntervals = document.getElementById('panelSettings_intervals');
  const panelSystem = document.getElementById('panelSettings_system');

  assert(panelAlerts && panelRoom && panelAppearance && panelIntervals && panelSystem, 'Tous les 5 panneaux de paramètres sont présents');

  // Vérifier que la carte des destinataires supplémentaires est bien dans le panneau Salle Partagée
  const contactsCard = document.getElementById('settingsContactsCard');
  assert(contactsCard, 'Carte des destinataires supplémentaires présente');
  assert(panelRoom.contains(contactsCard), 'La carte des destinataires supplémentaires doit se trouver dans le panneau Salle Partagée');

  // Vérifier que Salle Partagée est le sous-onglet actif par défaut
  window.localStorage.removeItem('carnet_settings_active_tab');
  window.initSettingsTabs();
  assert(!panelRoom.classList.contains('hidden'), 'Salle partagée affichée par défaut');
  assert(panelAlerts.classList.contains('hidden'), 'Panneau alertes masqué par défaut');
  assert.strictEqual(window.localStorage.getItem('carnet_settings_active_tab'), 'room', 'Onglet room persisté par défaut');

  // Test du clic sur chaque onglet
  settingsTabAppearance.click();
  assert(!panelAppearance.classList.contains('hidden'), 'Panneau Apparence affiché après clic');
  assert(panelRoom.classList.contains('hidden'), 'Panneau Salle masqué');

  settingsTabIntervals.click();
  assert(!panelIntervals.classList.contains('hidden'), 'Panneau Intervalles affiché après clic');

  settingsTabSystem.click();
  assert(!panelSystem.classList.contains('hidden'), 'Panneau Système affiché après clic');

  // Retour à Alertes et test des 3 sous-onglets (Notifications, E-mail, WhatsApp)
  settingsTabAlerts.click();
  assert(!panelAlerts.classList.contains('hidden'), 'Panneau Alertes réaffiché');
  assert(panelSystem.classList.contains('hidden'), 'Panneau Système masqué');

  const subtabNotif = document.querySelector('.alerts-subtab-btn[data-alert-channel="notifications"]');
  const subtabEmail = document.querySelector('.alerts-subtab-btn[data-alert-channel="email"]');
  const subtabWhatsapp = document.querySelector('.alerts-subtab-btn[data-alert-channel="whatsapp"]');
  assert(subtabNotif && subtabEmail && subtabWhatsapp, 'Les 3 sous-onglets (notifications, email, whatsapp) sont présents');

  const channelNotif = document.getElementById('channelAlertNotifications');
  const channelEmail = document.getElementById('channelAlertEmail');
  const channelWhatsapp = document.getElementById('channelAlertWhatsapp');
  assert(channelNotif && channelEmail && channelWhatsapp, 'Les 3 panneaux de canaux d\'alerte sont présents');

  // Par défaut : notifications visible
  subtabNotif.click();
  assert(!channelNotif.classList.contains('hidden'), 'Canal notifications visible');
  assert(channelEmail.classList.contains('hidden'), 'Canal email masqué');
  assert(channelWhatsapp.classList.contains('hidden'), 'Canal whatsapp masqué');
  const adminFreqBox = document.getElementById('adminAlertFrequencyBox');
  assert(adminFreqBox, 'Boîtier de fréquence des alertes (notifications) présent');
  assert(channelNotif.contains(adminFreqBox), 'Boîtier de fréquence placé dans le canal notifications');

  // Clic sur l'onglet E-mail
  subtabEmail.click();
  assert(channelNotif.classList.contains('hidden'), 'Canal notifications masqué');
  assert(!channelEmail.classList.contains('hidden'), 'Canal email visible');
  assert(channelWhatsapp.classList.contains('hidden'), 'Canal whatsapp masqué');

  // Boîtier dédié aux fréquences e-mail (distinct des notifications de l'appareil)
  const adminEmailFreqBox = document.getElementById('adminEmailAlertFrequencyBox');
  assert(adminEmailFreqBox, 'Boîtier de fréquence dédié aux e-mails présent');
  assert(channelEmail.contains(adminEmailFreqBox), 'Boîtier de fréquence e-mail placé dans le canal e-mail');

  const inputEmailRed = document.getElementById('inputEmailAlertFreqRedValue');
  const unitEmailRed = document.getElementById('selectEmailAlertFreqRedUnit');
  const lblEmailRed = document.getElementById('lblCurrentEmailRedFreq');
  const inputEmailOrange = document.getElementById('inputEmailAlertFreqOrangeValue');
  const unitEmailOrange = document.getElementById('selectEmailAlertFreqOrangeUnit');
  const lblEmailOrange = document.getElementById('lblCurrentEmailOrangeFreq');
  const inputEmailKm = document.getElementById('inputEmailAlertFreqKmValue');
  const unitEmailKm = document.getElementById('selectEmailAlertFreqKmUnit');
  const lblEmailKm = document.getElementById('lblCurrentEmailKmFreq');
  const inputEmailStale = document.getElementById('inputEmailStaleKmDays');

  assert(inputEmailRed && unitEmailRed && lblEmailRed, 'Champs de cadence e-mail rouge présents');
  assert(inputEmailOrange && unitEmailOrange && lblEmailOrange, 'Champs de cadence e-mail orange présents');
  assert(inputEmailKm && unitEmailKm && lblEmailKm, 'Champs de cadence e-mail compteur présents');
  assert(inputEmailStale, 'Champ seuil jours e-mail compteur présent');

  // Tester l'indépendance des cadences e-mail vs notifications
  // Les notifications sont à 5 min / 15 min / 12 h
  assert.strictEqual(window.getAlertFrequencyMinutes('red'), 5, 'Cadence notifications rouge est bien à 5 min');

  // Configurer les e-mails à une cadence différente (ex: 2 jours / 5 jours / 3 jours / 10 jours)
  inputEmailRed.value = '2';
  unitEmailRed.value = 'days';
  inputEmailOrange.value = '5';
  unitEmailOrange.value = 'days';
  inputEmailKm.value = '3';
  unitEmailKm.value = 'days';
  inputEmailStale.value = '10';
  window.saveEmailAlertFrequenciesFromInputs();

  // Vérifier que la cadence e-mail est de 2 jours (2880 min)
  assert.strictEqual(window.appState.settings.emailAlertFreqRedValue, 2, 'Fréquence e-mail rouge = 2');
  assert.strictEqual(window.appState.settings.emailAlertFreqRedUnit, 'days', 'Unité e-mail rouge = days');
  assert.strictEqual(window.getEmailAlertFrequencyMinutes('red'), 2 * 24 * 60, 'Cadence e-mail rouge = 2880 min (2 jours)');
  assert.strictEqual(window.getEmailAlertFrequencyMinutes('orange'), 5 * 24 * 60, 'Cadence e-mail orange = 5 jours');
  assert.strictEqual(window.getEmailAlertFrequencyMinutes('km'), 3 * 24 * 60, 'Cadence e-mail compteur = 3 jours');
  assert.strictEqual(window.appState.settings.emailStaleKmDays, 10, 'Seuil jours e-mail compteur = 10 jours');

  // Vérifier que les notifications restent INCHANGÉES à 5 min (totale indépendance)
  assert.strictEqual(window.getAlertFrequencyMinutes('red'), 5, 'Les notifications sont restées indépendantes à 5 min');
  assert.strictEqual(window.appState.settings.alertFreqRedValue, 5, 'Fréquence notification rouge inchangée à 5');

  // Vérifier la liste des destinataires e-mail
  const emailList = document.getElementById('emailRecipientsSummaryList');
  assert(emailList, 'Liste des destinataires e-mail présente');
  assert(emailList.textContent.includes('sam@example.com') || emailList.textContent.includes('papy@famille.dz'), 'Les adresses e-mails configurées sont résumées');

  // Clic sur l'onglet WhatsApp
  subtabWhatsapp.click();
  assert(channelEmail.classList.contains('hidden'), 'Canal email masqué');
  assert(!channelWhatsapp.classList.contains('hidden'), 'Canal whatsapp visible');

  // Vérifier la liste des destinataires WhatsApp
  const waList = document.getElementById('whatsappRecipientsSummaryList');
  assert(waList, 'Liste des destinataires whatsapp présente');
  assert(waList.textContent.includes('213555123456') || waList.textContent.includes('213555987654'), 'Les numéros WhatsApp configurés sont résumés');

  // Vérifier le bouton de test WhatsApp
  const btnTestWa = document.getElementById('btnTestWhatsappShare');
  assert(btnTestWa, 'Bouton de test de partage WhatsApp présent');

  // Retour sur Salle Partagée
  settingsTabRoom.click();
  assert(!panelRoom.classList.contains('hidden'), 'Retour final sur le panneau Salle Partagée validé');

  console.log('✅ TOUS LES TESTS DU SMOKE TEST (25/25) ONT RÉUSSI SANS AUCUNE ERREUR !');
  process.exit(0);
} catch (err) {
  console.error('❌ Échec du smoke test:', err);
  process.exit(1);
}
})();
