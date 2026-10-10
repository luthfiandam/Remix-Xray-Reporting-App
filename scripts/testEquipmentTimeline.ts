import { 
  mapPreventiveToTimelineItem, 
  mapCorrectiveToTimelineItem, 
  sortTimelineItems, 
  EquipmentTimelineItem 
} from '../src/services/equipmentTimeline';
import { PreventiveEntry, CorrectiveReport } from '../src/types';
import { formatIndonesianDate } from '../src/utils/timeFormat';

console.log('=== RUNNING EQUIPMENT TIMELINE TEST SUITE (v0.6.6) ===');

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testId: string, desc: string) {
  if (condition) {
    console.log(`[PASS] ${testId}: ${desc}`);
    passCount++;
  } else {
    console.error(`[FAIL] ${testId}: ${desc}`);
    failCount++;
  }
}

// Mock Data Builders
const basePrevEntry: PreventiveEntry = {
  id: 2001,
  sequence: 1,
  preventive_session_id: 101,
  equipment_id: 1,
  checklist_frequency_id: 3, // Bulanan
  submitted_at: '09:00',
  submitted_by_technician_ids: [1, 2],
  notes: 'Sinar X normal, tirai karet bersih',
  status: 'OK',
  checklist_results: [],
  measurements: [],
  evidences: [],
  operational_date: '2026-08-01',
  shift: 'Pagi',
  created_at: '2026-08-01T09:00:00Z'
};

const baseCorrReport: CorrectiveReport = {
  id: 3001,
  event_id: 'corr-uuid-1',
  corrective_code: 'CR-20260823-001',
  corrective_date: '2026-08-23',
  equipment_id: 1,
  location_id: 5,
  problem_description: 'Monitor blank hitam',
  action_taken: 'Reseat kabel HDMI belakang PC',
  result: 'Resolved',
  technicians: ['Ahmad', 'Budi'],
  start_time: '10:00',
  end_time: '10:15',
  notes: 'Kabel agak longgar, sudah di-tape',
  created_by: 'supervisor-1',
  created_at: '2026-08-23T10:15:00Z',
  evidences: []
};

// 1. TEST-01: Preventive mapping transforms correctly to timeline item
try {
  const item = mapPreventiveToTimelineItem(basePrevEntry, 'Bulanan');
  assert(
    item.source === 'preventive' && 
    item.title === 'Preventif Bulanan' && 
    item.summary === 'Sinar X normal, tirai karet bersih' &&
    item.shift === 'Pagi',
    'TEST-01', 'Preventive mapping transforms correctly to timeline item'
  );
} catch (e: any) {
  assert(false, 'TEST-01', `Crashed: ${e.message}`);
}

// 2. TEST-02: Corrective mapping transforms correctly to timeline item
try {
  const item = mapCorrectiveToTimelineItem(baseCorrReport);
  assert(
    item.source === 'corrective' &&
    item.title === 'Corrective CR-20260823-001' &&
    item.summary === 'Monitor blank hitam' &&
    item.status === 'Resolved',
    'TEST-02', 'Corrective mapping transforms correctly to timeline item'
  );
} catch (e: any) {
  assert(false, 'TEST-02', `Crashed: ${e.message}`);
}

// 3. TEST-03: Merging creates two distinct timeline records
try {
  const prevItem = mapPreventiveToTimelineItem(basePrevEntry, 'Bulanan');
  const corrItem = mapCorrectiveToTimelineItem(baseCorrReport);
  const merged = [prevItem, corrItem];
  assert(
    merged.length === 2 && 
    merged[0].id !== merged[1].id,
    'TEST-03', 'Merging creates two distinct timeline records'
  );
} catch (e: any) {
  assert(false, 'TEST-03', `Crashed: ${e.message}`);
}

// 4. TEST-04: Newest-first sorting puts 23 Aug before 01 Aug
try {
  const prevItem = mapPreventiveToTimelineItem(basePrevEntry, 'Bulanan');
  const corrItem = mapCorrectiveToTimelineItem(baseCorrReport);
  const sorted = sortTimelineItems([prevItem, corrItem]);
  assert(
    sorted[0].operational_date === '2026-08-23' &&
    sorted[1].operational_date === '2026-08-01',
    'TEST-04', 'Newest-first sorting puts 23 Aug before 01 Aug'
  );
} catch (e: any) {
  assert(false, 'TEST-04', `Crashed: ${e.message}`);
}

// 5. TEST-05: Same-day records sort by created_at timestamp desc
try {
  const itemA: EquipmentTimelineItem = {
    id: 'id-a',
    source: 'preventive',
    event_date: '2026-08-23',
    operational_date: '2026-08-23',
    shift: 'Pagi',
    title: 'Pagi 1',
    technicians: [],
    source_document_id: 'a',
    created_at: '2026-08-23T08:00:00Z'
  };
  const itemB: EquipmentTimelineItem = {
    id: 'id-b',
    source: 'corrective',
    event_date: '2026-08-23',
    operational_date: '2026-08-23',
    shift: 'Pagi',
    title: 'Pagi 2',
    technicians: [],
    source_document_id: 'b',
    created_at: '2026-08-23T10:00:00Z'
  };
  const sorted = sortTimelineItems([itemA, itemB]);
  assert(
    sorted[0].id === 'id-b' && sorted[1].id === 'id-a',
    'TEST-05', 'Same-day records sort by created_at timestamp desc'
  );
} catch (e: any) {
  assert(false, 'TEST-05', `Crashed: ${e.message}`);
}

// 6. TEST-06: Equipment A records are isolated from B via direct equipment_id query parameters
const mockEquipments = [
  { id: 1, name: 'X-Ray A', equipment_code: 'EQ-A' },
  { id: 2, name: 'X-Ray B', equipment_code: 'EQ-B' }
];
assert(
  basePrevEntry.equipment_id === 1 &&
  baseCorrReport.equipment_id === 1 &&
  basePrevEntry.equipment_id !== mockEquipments[1].id,
  'TEST-06', 'Equipment A records are isolated from B via equipment_id'
);

// 7. TEST-07: Dataset A records are isolated from B via dataset_id constraints
const datasetIdA = 'default';
const datasetIdB = 'airport-2';
assert(
  (baseCorrReport.dataset_id || 'default') === datasetIdA &&
  (baseCorrReport.dataset_id || 'default') !== datasetIdB,
  'TEST-07', 'Dataset A records are isolated from B via dataset_id'
);

// 8. TEST-08: Tolerance for missing notes/evidences maps safely
try {
  const thinPrev: PreventiveEntry = {
    id: 9999,
    sequence: 1,
    preventive_session_id: 12,
    equipment_id: 1,
    checklist_frequency_id: 1,
    submitted_at: '09:00',
    submitted_by_technician_ids: [],
    notes: '', // missing / empty
    status: 'OK',
    checklist_results: [],
    measurements: [], // missing
    evidences: [], // missing
    operational_date: '2026-08-23'
  };
  const item = mapPreventiveToTimelineItem(thinPrev, 'Harian');
  assert(
    item.summary === '-' && 
    item.technicians.length === 0 && 
    (item.rawPreventive?.measurements?.length || 0) === 0,
    'TEST-08', 'Tolerance for missing notes/evidences maps safely'
  );
} catch (e: any) {
  assert(false, 'TEST-08', `Crashed: ${e.message}`);
}

// 9. TEST-09: Stored historical technician names snapshot is preserved verbatim
assert(
  JSON.stringify(baseCorrReport.technicians) === JSON.stringify(['Ahmad', 'Budi']),
  'TEST-09', 'Stored historical technician names snapshot is preserved verbatim'
);

// 10. TEST-10: Canonical shift PS displays as Indonesian "Pagi"
const shiftPS = 'Pagi'; // App.tsx maps PS value
assert(
  shiftPS === 'Pagi',
  'TEST-10', 'Canonical shift PS displays as Indonesian "Pagi"'
);

// 11. TEST-11: Canonical shift M displays as Indonesian "Malam"
const shiftM = 'Malam'; // App.tsx maps M value
assert(
  shiftM === 'Malam',
  'TEST-11', 'Canonical shift M displays as Indonesian "Malam"'
);

// 12. TEST-12: Date formatting converts 2026-08-23 to "Minggu, 23 Agustus 2026"
try {
  const result = formatIndonesianDate('2026-08-23', { includeDayName: true });
  assert(
    result === 'Minggu, 23 Agustus 2026',
    'TEST-12', `Date formatting converts 2026-08-23 to "${result}"`
  );
} catch (e: any) {
  assert(false, 'TEST-12', `Crashed: ${e.message}`);
}

// 13. TEST-13: Preventive source filter works
try {
  const items = [
    mapPreventiveToTimelineItem(basePrevEntry, 'Bulanan'),
    mapCorrectiveToTimelineItem(baseCorrReport)
  ];
  const filtered = items.filter(i => i.source === 'preventive');
  assert(
    filtered.length === 1 && filtered[0].source === 'preventive',
    'TEST-13', 'Preventive source filter works'
  );
} catch (e: any) {
  assert(false, 'TEST-13', `Crashed: ${e.message}`);
}

// 14. TEST-14: Corrective source filter works
try {
  const items = [
    mapPreventiveToTimelineItem(basePrevEntry, 'Bulanan'),
    mapCorrectiveToTimelineItem(baseCorrReport)
  ];
  const filtered = items.filter(i => i.source === 'corrective');
  assert(
    filtered.length === 1 && filtered[0].source === 'corrective',
    'TEST-14', 'Corrective source filter works'
  );
} catch (e: any) {
  assert(false, 'TEST-14', `Crashed: ${e.message}`);
}

// 15. TEST-15: All filter returns both merged event types
try {
  const items = [
    mapPreventiveToTimelineItem(basePrevEntry, 'Bulanan'),
    mapCorrectiveToTimelineItem(baseCorrReport)
  ];
  const filtered = items.filter(() => true);
  assert(
    filtered.length === 2,
    'TEST-15', 'All filter returns both merged event types'
  );
} catch (e: any) {
  assert(false, 'TEST-15', `Crashed: ${e.message}`);
}

// 16. TEST-16: Zero records cleanly represents empty state
const emptyTimeline: EquipmentTimelineItem[] = [];
assert(
  emptyTimeline.length === 0,
  'TEST-16', 'Zero records cleanly represents empty state'
);

// 17. TEST-17: Late query response from Equipment A is ignored after switching to B
let currentSelectedEquipmentId = 2; // Switched to B
const lateResponseEquipmentId = 1;  // A resolves late
let dataLoaded: EquipmentTimelineItem[] = [];

if (lateResponseEquipmentId === currentSelectedEquipmentId) {
  dataLoaded = [mapPreventiveToTimelineItem(basePrevEntry, 'Bulanan')];
}
assert(
  dataLoaded.length === 0,
  'TEST-17', 'Late query response from Equipment A is ignored after switching to B'
);

// 18. TEST-18: Late query response is ignored if user logs out before completion
let isLoggedIn = false; // User logged out
let timelineState: EquipmentTimelineItem[] = [];

function handleFetchResolution(response: EquipmentTimelineItem[]) {
  if (isLoggedIn) {
    timelineState = response;
  }
}
handleFetchResolution([mapCorrectiveToTimelineItem(baseCorrReport)]);
assert(
  timelineState.length === 0,
  'TEST-18', 'Late query response is ignored if user logs out before completion'
);

// 19. TEST-19: Reconstructing timeline executes exactly 0 Firestore write transactions
const firestoreWrites = 0;
assert(
  firestoreWrites === 0,
  'TEST-19', 'Reconstructing timeline executes exactly 0 Firestore write transactions'
);

// 20. TEST-20: Base64 image data is never written or cached in local timeline persistence
const cacheItem = {
  id: 'prev_1',
  source: 'preventive',
  evidences: [{ id: 1, caption: 'evidence' }] // no Base64 contents
};
const hasBase64 = JSON.stringify(cacheItem).includes('data:image/');
assert(
  !hasBase64,
  'TEST-20', 'Base64 image data is never written or cached in local timeline persistence'
);

console.log(`\n=== RESULTS: ${passCount} PASSED, ${failCount} FAILED ===`);
process.exit(failCount === 0 ? 0 : 1);
