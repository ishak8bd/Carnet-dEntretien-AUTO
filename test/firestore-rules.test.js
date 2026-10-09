/**
 * test/firestore-rules.test.js
 * 
 * Comprehensive Automated Security Rules Test Suite for the Family Room Car Maintenance Tracker.
 * Built using @firebase/rules-unit-testing.
 * 
 * Tested Scenarios:
 * 1. Non-member denied access to rooms, vehicles, and member records.
 * 2. Pending member denied access to vehicles, items, and history (allowed only on their own member doc).
 * 3. Approved member allowed to read/write vehicles, items, and history.
 * 4. Owner-only actions: creating invites, approving pending members, and deleting room.
 * 5. Expired invite rejected (read & use increment denied).
 * 6. Over-used invite rejected (uses >= maxUses).
 * 7. Append-only protections on kmLogs and activity feeds.
 */

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

// Graceful check for @firebase/rules-unit-testing
let initializeTestEnvironment, assertFails, assertSucceeds;
try {
  const rut = require('@firebase/rules-unit-testing');
  initializeTestEnvironment = rut.initializeTestEnvironment;
  assertFails = rut.assertFails;
  assertSucceeds = rut.assertSucceeds;
} catch (err) {
  console.warn('\n⚠️ @firebase/rules-unit-testing is not yet installed in node_modules.');
  console.warn('To run this test suite against the Firebase Local Emulator, install dependencies:');
  console.warn('  npm install --save-dev @firebase/rules-unit-testing firebase\n');
}

const describe = test.describe || globalThis.describe;
const it = test.it || globalThis.it;
const before = test.before || globalThis.before;
const after = test.after || globalThis.after;
const beforeEach = test.beforeEach || globalThis.beforeEach;

const PROJECT_ID = 'family-room-tracker-test';
const RULES_PATH = path.resolve(__dirname, '../firestore.rules');

// Universal Firestore helpers compatible with both modular SDK and testing wrappers
function getDocRef(db, docPath) {
  if (typeof db.doc === 'function') {
    return db.doc(docPath);
  }
  const { doc } = require('firebase/firestore');
  return doc(db, docPath);
}

function getCollectionRef(db, colPath) {
  if (typeof db.collection === 'function') {
    return db.collection(colPath);
  }
  const { collection } = require('firebase/firestore');
  return collection(db, colPath);
}

async function readDoc(db, docPath) {
  const ref = getDocRef(db, docPath);
  if (typeof ref.get === 'function') {
    return ref.get();
  }
  const { getDoc } = require('firebase/firestore');
  return getDoc(ref);
}

async function writeDoc(db, docPath, data) {
  const ref = getDocRef(db, docPath);
  if (typeof ref.set === 'function') {
    return ref.set(data);
  }
  const { setDoc } = require('firebase/firestore');
  return setDoc(ref, data);
}

async function patchDoc(db, docPath, data) {
  const ref = getDocRef(db, docPath);
  if (typeof ref.update === 'function') {
    return ref.update(data);
  }
  const { updateDoc } = require('firebase/firestore');
  return updateDoc(ref, data);
}

async function removeDoc(db, docPath) {
  const ref = getDocRef(db, docPath);
  if (typeof ref.delete === 'function') {
    return ref.delete();
  }
  const { deleteDoc } = require('firebase/firestore');
  return deleteDoc(ref);
}

// Suite execution
describe('Family Room Car Maintenance Tracker - Firestore Security Rules', () => {
  let testEnv;

  before(async () => {
    if (!initializeTestEnvironment) {
      console.log('Skipping emulator connection: test environment package missing.');
      return;
    }

    const rules = fs.readFileSync(RULES_PATH, 'utf8');
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules,
        host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1',
        port: parseInt(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] || '8080', 10),
      },
    });
  });

  after(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    if (testEnv) {
      await testEnv.clearFirestore();
    }
  });

  // -------------------------------------------------------------
  // Test Fixture Setup
  // -------------------------------------------------------------
  async function seedRoomFixtures(roomId = 'room_1', ownerUid = 'user_owner') {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      const now = new Date();

      // Seed Room
      await writeDoc(adminDb, `rooms/${roomId}`, {
        name: 'Family Garage',
        ownerUid,
        createdAt: now,
        lastActivityAt: now,
        schemaVersion: 1,
      });

      // Seed Owner Member
      await writeDoc(adminDb, `rooms/${roomId}/members/${ownerUid}`, {
        name: 'Alice Owner',
        role: 'owner',
        status: 'approved',
        joinedAt: now,
        lastSeenAt: now,
      });

      // Seed Approved Member
      await writeDoc(adminDb, `rooms/${roomId}/members/user_approved`, {
        name: 'Bob Member',
        role: 'member',
        status: 'approved',
        joinedAt: now,
        lastSeenAt: now,
      });

      // Seed Pending Member
      await writeDoc(adminDb, `rooms/${roomId}/members/user_pending`, {
        name: 'Charlie Pending',
        role: 'member',
        status: 'pending',
        joinedAt: now,
        lastSeenAt: now,
      });

      // Seed a Vehicle
      await writeDoc(adminDb, `rooms/${roomId}/vehicles/veh_1`, {
        name: 'Clio 4',
        brand: 'Renault',
        model: 'Clio IV 1.5 dCi',
        year: 2018,
        plate: '12345-116-16',
        currentKm: 120000,
        updateFrequency: 'weekly',
        isDemo: false,
        updatedAt: now,
        updatedBy: ownerUid,
      });

      // Seed an Item
      await writeDoc(adminDb, `rooms/${roomId}/items/item_1`, {
        vehicleId: 'veh_1',
        name: 'Vidange huile moteur',
        intervalKm: 10000,
        intervalMonths: 12,
        lastDate: '2026-01-15',
        lastKm: 115000,
        updatedAt: now,
        updatedBy: ownerUid,
        deleted: false,
      });

      // Seed a History Entry
      await writeDoc(adminDb, `rooms/${roomId}/history/hist_1`, {
        vehicleId: 'veh_1',
        type: 'Vidange',
        date: '2026-01-15',
        km: 115000,
        cost: 6500,
        garage: 'Auto Service Alger',
        notes: 'Changement filtre à huile et filtre à air',
        authorUid: ownerUid,
        authorName: 'Alice Owner',
        createdAt: now,
      });
    });
  }

  // -------------------------------------------------------------
  // 1. Non-member Access Checks
  // -------------------------------------------------------------
  describe('1. Non-member access control', () => {
    it('denies unauthenticated user access to room and vehicles', async () => {
      if (!testEnv) return;
      await seedRoomFixtures();
      const unauthDb = testEnv.unauthenticatedContext().firestore();

      await assertFails(readDoc(unauthDb, 'rooms/room_1'));
      await assertFails(readDoc(unauthDb, 'rooms/room_1/vehicles/veh_1'));
    });

    it('denies authenticated non-member access to room and vehicles', async () => {
      if (!testEnv) return;
      await seedRoomFixtures();
      const strangerDb = testEnv.authenticatedContext('user_stranger').firestore();

      await assertFails(readDoc(strangerDb, 'rooms/room_1'));
      await assertFails(readDoc(strangerDb, 'rooms/room_1/vehicles/veh_1'));
      await assertFails(writeDoc(strangerDb, 'rooms/room_1/vehicles/veh_hacker', {
        name: 'Hacked Car',
        brand: 'Fake',
        model: 'Fake',
        year: 2020,
        currentKm: 10,
        isDemo: false,
        updatedAt: new Date(),
        updatedBy: 'user_stranger',
      }));
    });
  });

  // -------------------------------------------------------------
  // 2. Pending Member Isolation
  // -------------------------------------------------------------
  describe('2. Pending member isolation', () => {
    it('denies pending member access to vehicles, items, and history', async () => {
      if (!testEnv) return;
      await seedRoomFixtures();
      const pendingDb = testEnv.authenticatedContext('user_pending').firestore();

      // Denied reading shared vehicles, items, history
      await assertFails(readDoc(pendingDb, 'rooms/room_1/vehicles/veh_1'));
      await assertFails(readDoc(pendingDb, 'rooms/room_1/items/item_1'));
      await assertFails(readDoc(pendingDb, 'rooms/room_1/history/hist_1'));

      // Denied writing to vehicles
      await assertFails(writeDoc(pendingDb, 'rooms/room_1/vehicles/veh_new', {
        name: 'Pending Vehicle',
        brand: 'Renault',
        model: 'Megane',
        year: 2019,
        currentKm: 50000,
        isDemo: false,
        updatedAt: new Date(),
        updatedBy: 'user_pending',
      }));
    });

    it('allows pending member to read their own member record to check status', async () => {
      if (!testEnv) return;
      await seedRoomFixtures();
      const pendingDb = testEnv.authenticatedContext('user_pending').firestore();

      // Can read own pending record
      await assertSucceeds(readDoc(pendingDb, 'rooms/room_1/members/user_pending'));

      // Cannot read other members records
      await assertFails(readDoc(pendingDb, 'rooms/room_1/members/user_approved'));
      await assertFails(readDoc(pendingDb, 'rooms/room_1/members/user_owner'));
    });
  });

  // -------------------------------------------------------------
  // 3. Approved Member Privileges
  // -------------------------------------------------------------
  describe('3. Approved member operations', () => {
    it('allows approved member to read and write vehicles', async () => {
      if (!testEnv) return;
      await seedRoomFixtures();
      const approvedDb = testEnv.authenticatedContext('user_approved').firestore();

      // Read existing vehicle
      await assertSucceeds(readDoc(approvedDb, 'rooms/room_1/vehicles/veh_1'));

      // Create new vehicle
      const now = new Date();
      await assertSucceeds(writeDoc(approvedDb, 'rooms/room_1/vehicles/veh_2', {
        name: 'Peugeot 208',
        brand: 'Peugeot',
        model: '208 GT Line',
        year: 2021,
        plate: '54321-118-16',
        currentKm: 45000,
        updateFrequency: 'monthly',
        isDemo: false,
        updatedAt: now,
        updatedBy: 'user_approved',
      }));

      // Update existing vehicle
      await assertSucceeds(patchDoc(approvedDb, 'rooms/room_1/vehicles/veh_1', {
        currentKm: 121500,
        updatedAt: new Date(),
        updatedBy: 'user_approved',
      }));
    });

    it('allows approved member to update only lastActivityAt on room document', async () => {
      if (!testEnv) return;
      await seedRoomFixtures();
      const approvedDb = testEnv.authenticatedContext('user_approved').firestore();

      // Allowed: updating lastActivityAt
      await assertSucceeds(patchDoc(approvedDb, 'rooms/room_1', {
        lastActivityAt: new Date(),
      }));

      // Denied: updating room name or ownerUid
      await assertFails(patchDoc(approvedDb, 'rooms/room_1', {
        name: 'Renamed by Member',
      }));
      await assertFails(patchDoc(approvedDb, 'rooms/room_1', {
        ownerUid: 'user_approved',
      }));
    });
  });

  // -------------------------------------------------------------
  // 4. Owner-Only Privileges
  // -------------------------------------------------------------
  describe('4. Owner-only actions', () => {
    it('allows owner to create invites, but denies non-owners', async () => {
      if (!testEnv) return;
      await seedRoomFixtures();
      const ownerDb = testEnv.authenticatedContext('user_owner').firestore();
      const approvedDb = testEnv.authenticatedContext('user_approved').firestore();

      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const inviteData = {
        inviteId: 'inv_abc123xyz789_secure_token',
        expiresAt: futureDate,
        maxUses: 5,
        uses: 0,
        active: true,
        createdBy: 'user_owner',
      };

      // Owner succeeds
      await assertSucceeds(writeDoc(ownerDb, 'rooms/room_1/invites/inv_1', inviteData));

      // Approved non-owner fails
      await assertFails(writeDoc(approvedDb, 'rooms/room_1/invites/inv_2', {
        ...inviteData,
        createdBy: 'user_approved',
      }));
    });

    it('allows owner to approve pending member, denies non-owner from approving', async () => {
      if (!testEnv) return;
      await seedRoomFixtures();
      const ownerDb = testEnv.authenticatedContext('user_owner').firestore();
      const approvedDb = testEnv.authenticatedContext('user_approved').firestore();
      const pendingDb = testEnv.authenticatedContext('user_pending').firestore();

      // Pending user cannot self-promote to approved
      await assertFails(patchDoc(pendingDb, 'rooms/room_1/members/user_pending', {
        status: 'approved',
      }));

      // Non-owner member cannot approve pending user
      await assertFails(patchDoc(approvedDb, 'rooms/room_1/members/user_pending', {
        status: 'approved',
      }));

      // Owner approves pending user
      await assertSucceeds(patchDoc(ownerDb, 'rooms/room_1/members/user_pending', {
        status: 'approved',
      }));
    });

    it('allows owner to delete room, denies non-owners', async () => {
      if (!testEnv) return;
      await seedRoomFixtures();
      const approvedDb = testEnv.authenticatedContext('user_approved').firestore();
      const ownerDb = testEnv.authenticatedContext('user_owner').firestore();

      // Non-owner fails
      await assertFails(removeDoc(approvedDb, 'rooms/room_1'));

      // Owner succeeds
      await assertSucceeds(removeDoc(ownerDb, 'rooms/room_1'));
    });
  });

  // -------------------------------------------------------------
  // 5. Invite Expiration Enforcement
  // -------------------------------------------------------------
  describe('5. Expired invite verification', () => {
    it('rejects reading and redeeming an expired invite', async () => {
      if (!testEnv) return;
      await seedRoomFixtures();
      const pastDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        await writeDoc(adminDb, 'rooms/room_1/invites/inv_expired', {
          inviteId: 'token_expired_123456789',
          expiresAt: pastDate,
          maxUses: 10,
          uses: 2,
          active: true,
          createdBy: 'user_owner',
        });
      });

      const joinerDb = testEnv.authenticatedContext('user_joiner').firestore();

      // Read denied for expired invite
      await assertFails(readDoc(joinerDb, 'rooms/room_1/invites/inv_expired'));

      // Use increment (+1) denied for expired invite
      await assertFails(patchDoc(joinerDb, 'rooms/room_1/invites/inv_expired', {
        uses: 3,
      }));
    });
  });

  // -------------------------------------------------------------
  // 6. Invite Exhaustion (Over-used) Enforcement
  // -------------------------------------------------------------
  describe('6. Over-used invite verification', () => {
    it('rejects reading and redeeming an invite whose uses >= maxUses', async () => {
      if (!testEnv) return;
      await seedRoomFixtures();
      const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        await writeDoc(adminDb, 'rooms/room_1/invites/inv_exhausted', {
          inviteId: 'token_exhausted_123456789',
          expiresAt: futureDate,
          maxUses: 3,
          uses: 3, // Exhausted
          active: true,
          createdBy: 'user_owner',
        });
      });

      const joinerDb = testEnv.authenticatedContext('user_joiner').firestore();

      // Read denied for exhausted invite
      await assertFails(readDoc(joinerDb, 'rooms/room_1/invites/inv_exhausted'));

      // Increment denied
      await assertFails(patchDoc(joinerDb, 'rooms/room_1/invites/inv_exhausted', {
        uses: 4,
      }));
    });

    it('allows atomic increment on valid active invite and forbids tampering with other fields', async () => {
      if (!testEnv) return;
      await seedRoomFixtures();
      const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24);

      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        await writeDoc(adminDb, 'rooms/room_1/invites/inv_valid', {
          inviteId: 'token_valid_123456789012',
          expiresAt: futureDate,
          maxUses: 5,
          uses: 1,
          active: true,
          createdBy: 'user_owner',
        });
      });

      const joinerDb = testEnv.authenticatedContext('user_joiner').firestore();

      // Can read valid invite
      await assertSucceeds(readDoc(joinerDb, 'rooms/room_1/invites/inv_valid'));

      // Cannot tamper with maxUses while incrementing
      await assertFails(patchDoc(joinerDb, 'rooms/room_1/invites/inv_valid', {
        uses: 2,
        maxUses: 999,
      }));

      // Allowed atomic increment by 1
      await assertSucceeds(patchDoc(joinerDb, 'rooms/room_1/invites/inv_valid', {
        uses: 2,
      }));
    });
  });

  // -------------------------------------------------------------
  // 7. Append-only KmLogs and Activity Integrity
  // -------------------------------------------------------------
  describe('7. Append-only logs & immutability', () => {
    it('allows approved member to log km, but strictly denies updates', async () => {
      if (!testEnv) return;
      await seedRoomFixtures();
      const approvedDb = testEnv.authenticatedContext('user_approved').firestore();

      const now = new Date();
      const logData = {
        vehicleId: 'veh_1',
        date: '2026-03-29',
        km: 120500,
        predictedKm: 120400,
        authorUid: 'user_approved',
        authorName: 'Bob Member',
        createdAt: now,
      };

      // Create succeeds
      await assertSucceeds(writeDoc(approvedDb, 'rooms/room_1/kmLogs/log_1', logData));

      // Update strictly prohibited
      await assertFails(patchDoc(approvedDb, 'rooms/room_1/kmLogs/log_1', {
        km: 121000,
      }));
    });

    it('allows member to create activity; denies updates and deletions', async () => {
      if (!testEnv) return;
      await seedRoomFixtures();
      const approvedDb = testEnv.authenticatedContext('user_approved').firestore();

      const now = new Date();
      const actData = {
        text: 'Bob a relevé le compteur de Clio 4 (120 500 km)',
        authorUid: 'user_approved',
        authorName: 'Bob Member',
        createdAt: now,
      };

      // Create succeeds
      await assertSucceeds(writeDoc(approvedDb, 'rooms/room_1/activity/act_1', actData));

      // Update denied
      await assertFails(patchDoc(approvedDb, 'rooms/room_1/activity/act_1', {
        text: 'Hacked message',
      }));

      // Delete denied
      await assertFails(removeDoc(approvedDb, 'rooms/room_1/activity/act_1'));
    });
  });

  // -------------------------------------------------------------
  // 8. Nullable Values Validation (lastDate, lastKm, predictedKm, cost)
  // -------------------------------------------------------------
  describe('8. Nullable values validation', () => {
    it('allows null for lastDate on item, but checks type when present', async () => {
      if (!testEnv) return;
      await seedRoomFixtures();
      const approvedDb = testEnv.authenticatedContext('user_approved').firestore();

      const baseItem = {
        vehicleId: 'veh_1',
        name: 'Liquide de freins',
        intervalMonths: 24,
        intervalKm: null,
        lastKm: 110000,
        updatedAt: new Date(),
        updatedBy: 'user_approved',
        deleted: false
      };

      // Allowed with null lastDate
      await assertSucceeds(writeDoc(approvedDb, 'rooms/room_1/items/item_null_date', {
        ...baseItem,
        lastDate: null
      }));

      // Denied with invalid lastDate (e.g. number instead of string/timestamp/null)
      await assertFails(writeDoc(approvedDb, 'rooms/room_1/items/item_bad_date', {
        ...baseItem,
        lastDate: 12345
      }));
    });

    it('allows null for lastKm on item, but checks type and bound when present', async () => {
      if (!testEnv) return;
      await seedRoomFixtures();
      const approvedDb = testEnv.authenticatedContext('user_approved').firestore();

      const baseItem = {
        vehicleId: 'veh_1',
        name: 'Liquide de refroidissement',
        intervalMonths: 36,
        intervalKm: 60000,
        lastDate: '2026-01-01',
        updatedAt: new Date(),
        updatedBy: 'user_approved',
        deleted: false
      };

      // Allowed with null lastKm
      await assertSucceeds(writeDoc(approvedDb, 'rooms/room_1/items/item_null_km', {
        ...baseItem,
        lastKm: null
      }));

      // Denied with negative lastKm
      await assertFails(writeDoc(approvedDb, 'rooms/room_1/items/item_bad_km', {
        ...baseItem,
        lastKm: -100
      }));
    });

    it('allows null for predictedKm on kmLog, but checks type and bound when present', async () => {
      if (!testEnv) return;
      await seedRoomFixtures();
      const approvedDb = testEnv.authenticatedContext('user_approved').firestore();

      const baseLog = {
        vehicleId: 'veh_1',
        date: '2026-04-01',
        km: 121000,
        authorUid: 'user_approved',
        authorName: 'Bob Member',
        createdAt: new Date()
      };

      // Allowed with null predictedKm
      await assertSucceeds(writeDoc(approvedDb, 'rooms/room_1/kmLogs/log_null_pred', {
        ...baseLog,
        predictedKm: null
      }));

      // Denied with negative predictedKm
      await assertFails(writeDoc(approvedDb, 'rooms/room_1/kmLogs/log_bad_pred', {
        ...baseLog,
        predictedKm: -500
      }));
    });

    it('allows null for cost on history, but checks type and bound when present', async () => {
      if (!testEnv) return;
      await seedRoomFixtures();
      const approvedDb = testEnv.authenticatedContext('user_approved').firestore();

      const baseHist = {
        vehicleId: 'veh_1',
        type: 'Contrôle technique',
        date: '2026-02-10',
        km: 118000,
        garage: 'Centre CT',
        notes: 'Vierge',
        authorUid: 'user_approved',
        authorName: 'Bob Member',
        createdAt: new Date()
      };

      // Allowed with null cost
      await assertSucceeds(writeDoc(approvedDb, 'rooms/room_1/history/hist_null_cost', {
        ...baseHist,
        cost: null
      }));

      // Denied with non-numeric cost
      await assertFails(writeDoc(approvedDb, 'rooms/room_1/history/hist_bad_cost', {
        ...baseHist,
        cost: 'gratuit'
      }));
    });
  });
});
