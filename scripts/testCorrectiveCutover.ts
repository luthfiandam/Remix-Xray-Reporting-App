import 'dotenv/config';
import { normalizeCorrectiveIdentity, MAX_LEGACY_SEQUENTIAL_ID } from '../src/services/correctiveMapper.js';

interface CutoverTestCase {
  name: string;
  run: () => void;
}

const tests: CutoverTestCase[] = [
  {
    name: "TEST 1: Legacy Generic Mapping (record_id = 1)",
    run: () => {
      const record = { id: 1 };
      const { event_id, document_id } = normalizeCorrectiveIdentity(record, 'default');
      
      if (event_id !== 'legacy_1') {
        throw new Error(`Expected event_id to be 'legacy_1', got '${event_id}'`);
      }
      if (document_id !== 'default_cr_legacy_1') {
        throw new Error(`Expected document_id to be 'default_cr_legacy_1', got '${document_id}'`);
      }
      console.log("   ✅ Subtest Passed");
    }
  },
  {
    name: "TEST 2: Legacy Generic Mapping (record_id = 25)",
    run: () => {
      const record = { record_id: 25 };
      const { event_id, document_id } = normalizeCorrectiveIdentity(record, 'default');
      
      if (event_id !== 'legacy_25') {
        throw new Error(`Expected event_id to be 'legacy_25', got '${event_id}'`);
      }
      if (document_id !== 'default_cr_legacy_25') {
        throw new Error(`Expected document_id to be 'default_cr_legacy_25', got '${document_id}'`);
      }
      console.log("   ✅ Subtest Passed");
    }
  },
  {
    name: "TEST 3: Existing Canonical Identity Preservation",
    run: () => {
      const record = {
        id: 12345,
        event_id: 'existing-event-uuid',
        document_id: 'default_cr_existing-event-uuid'
      };
      const { event_id, document_id } = normalizeCorrectiveIdentity(record, 'default');
      
      if (event_id !== 'existing-event-uuid') {
        throw new Error(`Expected event_id to be preserved as 'existing-event-uuid', got '${event_id}'`);
      }
      if (document_id !== 'default_cr_existing-event-uuid') {
        throw new Error(`Expected document_id to be preserved as 'default_cr_existing-event-uuid', got '${document_id}'`);
      }
      console.log("   ✅ Subtest Passed");
    }
  },
  {
    name: "TEST 4: New Post-Cutover UUID Identity Generation",
    run: () => {
      // Millisecond timestamp greater than MAX_LEGACY_SEQUENTIAL_ID
      const timestampId = Date.now();
      const record = { id: timestampId };
      const { event_id, document_id } = normalizeCorrectiveIdentity(record, 'default');
      
      if (event_id.startsWith('legacy_')) {
        throw new Error(`New post-cutover record should not have 'legacy_' prefix, got '${event_id}'`);
      }
      if (event_id.length !== 36) { // standard UUID v4 length
        throw new Error(`Expected a valid generated UUID, got '${event_id}'`);
      }
      if (document_id !== `default_cr_${event_id}`) {
        throw new Error(`Expected document_id to match buildCorrectiveDocumentId with the new UUID, got '${document_id}'`);
      }
      console.log("   ✅ Subtest Passed");
    }
  },
  {
    name: "TEST 5: MAX_LEGACY_SEQUENTIAL_ID Boundary Validation",
    run: () => {
      const maxLegacy = MAX_LEGACY_SEQUENTIAL_ID - 1;
      const justOverMax = MAX_LEGACY_SEQUENTIAL_ID;

      const { event_id: legacyEvent } = normalizeCorrectiveIdentity({ id: maxLegacy });
      if (legacyEvent !== `legacy_${maxLegacy}`) {
        throw new Error(`Expected sequential id ${maxLegacy} to be classified as legacy`);
      }

      const { event_id: newEvent } = normalizeCorrectiveIdentity({ id: justOverMax });
      if (newEvent.startsWith('legacy_')) {
        throw new Error(`Expected id ${justOverMax} to be classified as post-cutover new record, got legacy`);
      }
      console.log("   ✅ Subtest Passed");
    }
  }
];

console.log("==================================================");
console.log("🚀 STARTING CORRECTIVE RUNTIME CUTOVER UNIT TESTS");
console.log("==================================================");

let failed = 0;
for (const tc of tests) {
  console.log(`\n🏃 Running: ${tc.name}`);
  try {
    tc.run();
  } catch (err: any) {
    console.error(`❌ Test failed: ${err.message}`);
    failed++;
  }
}

console.log("\n==================================================");
if (failed === 0) {
  console.log("🎉 ALL CUTOVER TESTS PASSED SUCCESSFUL (5/5)");
  process.exit(0);
} else {
  console.log(`⚠ ${failed} TEST(S) FAILED`);
  process.exit(1);
}
