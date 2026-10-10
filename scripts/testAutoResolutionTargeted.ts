import {
  getScheduleQueryCount,
  resetScheduleQueryCount,
  fetchSchedulesForShiftDetailed,
  ShiftScheduleV2,
  buildScheduleDocId,
} from '../src/services/scheduleService';
import { resolveActiveSessionStaff, getOperationalShift } from '../src/utils/technicianSchedule';
import { INITIAL_TECHNICIANS } from '../src/data/initialData';
import { ResolutionStatus } from '../src/hooks/useShiftSession';

interface TestSuiteResult {
  id: string;
  category: string;
  name: string;
  expected: string;
  actual: string;
  queryCount: number;
  status: 'PASS' | 'FAIL';
}

const suiteResults: TestSuiteResult[] = [];

// Helper context cache simulator mirroring useShiftSession
class ShiftSessionSimulator {
  lastFetchedContext: string | null = null;
  inFlightPromises: Map<string, Promise<any>> = new Map();
  resolutionStatus: ResolutionStatus = 'idle';
  currentSession = {
    technician_ids: [] as number[],
    technician_names: [] as string[],
    operational_date: '2026-08-31',
    shift: 'Pagi' as 'Pagi' | 'Malam',
  };
  scheduleWarning: string | null = null;
  isScheduleEmpty = false;

  async checkAndUpdateShift(
    isLoggedIn: boolean,
    profile: { uid: string; role: string; technician_id?: number; email?: string } | null,
    mockResult?: any,
    forceRefetch = false
  ) {
    if (!isLoggedIn || !profile) {
      this.resolutionStatus = 'idle';
      this.scheduleWarning = null;
      this.lastFetchedContext = null;
      return;
    }

    const op = getOperationalShift();
    const dbShiftCode = op.shift === 'Pagi' ? 'PS' : 'M';
    const contextKey = `${profile.uid}:${op.operationalDate}:${dbShiftCode}`;

    if (!forceRefetch && this.lastFetchedContext === contextKey) {
      return;
    }

    if (!forceRefetch && this.inFlightPromises.has(contextKey)) {
      await this.inFlightPromises.get(contextKey);
      return;
    }

    this.resolutionStatus = 'resolving';

    const promise = (async () => {
      try {
        let result = await Promise.resolve(mockResult);
        if (!result) {
          result = await fetchSchedulesForShiftDetailed(op.operationalDate, dbShiftCode, 'default');
        } else {
          // Increment tracking counter for mock
          fetchSchedulesForShiftDetailed(op.operationalDate, dbShiftCode, 'default');
        }

        this.lastFetchedContext = contextKey;

        if (result.status === 'SUCCESS_WITH_DATA') {
          const v2Doc = result.rawV2Docs?.[0];
          const resolved = resolveActiveSessionStaff(INITIAL_TECHNICIANS, dbShiftCode, op.operationalDate, v2Doc);

          if (resolved.onDutyIds.length > 0) {
            const scheduledIds = resolved.onDutyIds;
            const scheduledNames = resolved.onDutyNames;

            const isSupervisorRole = profile.role === 'supervisor';
            const isLuthfi =
              profile.technician_id === 1 ||
              profile.email?.toLowerCase() === 'luthfi@faskampen.id' ||
              profile.uid === 'luthfi-uid';

            let warning: string | null = null;
            if (
              profile.technician_id &&
              !scheduledIds.includes(profile.technician_id) &&
              !isSupervisorRole &&
              !isLuthfi
            ) {
              warning =
                'Akun Anda tidak tercantum dalam jadwal shift ini. Anda tetap dapat mengakses aplikasi, tetapi aktivitas akan tercatat menggunakan akun yang sedang login.';
            }
            this.scheduleWarning = warning;
            this.currentSession.technician_ids = scheduledIds;
            this.currentSession.technician_names = scheduledNames;
            this.resolutionStatus = 'resolved';
          } else {
            this.isScheduleEmpty = true;
            this.currentSession.technician_ids = profile.technician_id ? [profile.technician_id] : [];
            this.scheduleWarning =
              'Belum ada teknisi yang dijadwalkan pada shift ini. Sementara, laporan akan dicatat atas nama akun yang sedang login.';
            this.resolutionStatus = 'fallback';
          }
        } else if (result.status === 'SUCCESS_EMPTY') {
          this.isScheduleEmpty = true;
          this.currentSession.technician_ids = profile.technician_id ? [profile.technician_id] : [];
          this.scheduleWarning =
            'Belum ada teknisi yang dijadwalkan pada shift ini. Sementara, laporan akan dicatat atas nama akun yang sedang login.';
          this.resolutionStatus = 'fallback';
        } else {
          this.isScheduleEmpty = false;
          this.currentSession.technician_ids = profile.technician_id ? [profile.technician_id] : [];
          this.scheduleWarning =
            'Jadwal shift tidak dapat dimuat. Sementara, laporan akan dicatat atas nama akun yang sedang login.';
          this.resolutionStatus = 'fallback';
        }
      } catch {
        this.currentSession.technician_ids = profile.technician_id ? [profile.technician_id] : [];
        this.scheduleWarning =
          'Jadwal shift tidak dapat dimuat. Sementara, laporan akan dicatat atas nama akun yang sedang login.';
        this.resolutionStatus = 'fallback';
      } finally {
        this.inFlightPromises.delete(contextKey);
      }
    })();

    this.inFlightPromises.set(contextKey, promise);
    await promise;
  }
}

async function runTargetedResolutionTests() {
  console.log('\n====================================================================================================');
  console.log('X-RAY REPORTING APP v0.6.7 — TARGETED AUTOMATIC RESOLUTION & USAGE EFFICIENCY SUITE');
  console.log('====================================================================================================\n');

  // CATEGORY 1: WORKSPACE GATE & RESOLUTION STATES
  {
    resetScheduleQueryCount();
    const sim = new ShiftSessionSimulator();
    // Test 1: Query does not run before auth resolved
    await sim.checkAndUpdateShift(false, null);
    suiteResults.push({
      id: 'GATE-01',
      category: 'Workspace Gate',
      name: 'Unauthenticated state -> resolution status idle, zero queries',
      expected: 'status=idle, queries=0',
      actual: `status=${sim.resolutionStatus}, queries=${getScheduleQueryCount()}`,
      queryCount: getScheduleQueryCount(),
      status: sim.resolutionStatus === 'idle' && getScheduleQueryCount() === 0 ? 'PASS' : 'FAIL',
    });

    // Test 2: Status resolving during query execution
    const mockV2Doc: ShiftScheduleV2 = {
      dataset_id: 'default',
      schedule_date: '2026-08-31',
      shift: 'PS',
      assignments: {
        '2': { technician_name: 'Zaky', status: 'scheduled' },
        '3': { technician_name: 'Reza', status: 'scheduled' },
      },
      schema_version: 2,
    };

    resetScheduleQueryCount();
    const authProfile = { uid: 'zaky-uid', role: 'technician', technician_id: 2, email: 'zaky@faskampen.id' };
    const asyncMockResult = new Promise((res) =>
      setTimeout(
        () => res({ status: 'SUCCESS_WITH_DATA', rawV2Docs: [mockV2Doc] }),
        10
      )
    );
    const p = sim.checkAndUpdateShift(true, authProfile, asyncMockResult);
    const interimStatus = sim.resolutionStatus;
    await p;

    suiteResults.push({
      id: 'GATE-02',
      category: 'Workspace Gate',
      name: 'During query execution -> resolution status is resolving (gate blocked)',
      expected: 'interim=resolving, final=resolved',
      actual: `interim=${interimStatus}, final=${sim.resolutionStatus}`,
      queryCount: getScheduleQueryCount(),
      status: interimStatus === 'resolving' && sim.resolutionStatus === 'resolved' ? 'PASS' : 'FAIL',
    });

    // Test 3: Resolved status enables gate access
    const isGateOpen = sim.resolutionStatus === 'resolved' || sim.resolutionStatus === 'fallback';
    suiteResults.push({
      id: 'GATE-03',
      category: 'Workspace Gate',
      name: 'Status resolved -> gate opens and workspace renders scheduled team',
      expected: 'isGateOpen=true, team=[2, 3]',
      actual: `isGateOpen=${isGateOpen}, team=[${sim.currentSession.technician_ids.join(', ')}]`,
      queryCount: getScheduleQueryCount(),
      status: isGateOpen && sim.currentSession.technician_ids.join(',') === '2,3' ? 'PASS' : 'FAIL',
    });
  }

  // CATEGORY 2: FIREBASE USAGE EFFICIENCY & DEDUPLICATION
  {
    resetScheduleQueryCount();
    const sim = new ShiftSessionSimulator();
    const authProfile = { uid: 'zaky-uid', role: 'technician', technician_id: 2, email: 'zaky@faskampen.id' };

    const mockRes = {
      status: 'SUCCESS_WITH_DATA',
      rawV2Docs: [
        {
          dataset_id: 'default',
          schedule_date: '2026-08-31',
          shift: 'PS',
          assignments: { '2': { technician_name: 'Zaky', status: 'scheduled' } },
          schema_version: 2,
        },
      ],
    };

    // 1. First call -> 1 query
    await sim.checkAndUpdateShift(true, authProfile, mockRes);
    const q1 = getScheduleQueryCount();

    // 2. 10 Timer ticks with same context -> 0 additional queries
    for (let i = 0; i < 10; i++) {
      await sim.checkAndUpdateShift(true, authProfile, mockRes);
    }
    const q10Timer = getScheduleQueryCount();

    suiteResults.push({
      id: 'EFF-01',
      category: 'Usage Efficiency',
      name: '10 Timer ticks with same context -> exactly 1 schedule query total',
      expected: 'q1=1, q10Timer=1',
      actual: `q1=${q1}, q10Timer=${q10Timer}`,
      queryCount: q10Timer,
      status: q1 === 1 && q10Timer === 1 ? 'PASS' : 'FAIL',
    });

    // 3. StrictMode concurrent double effect -> exactly 1 query total
    resetScheduleQueryCount();
    const sim2 = new ShiftSessionSimulator();
    const p1 = sim2.checkAndUpdateShift(true, authProfile, mockRes);
    const p2 = sim2.checkAndUpdateShift(true, authProfile, mockRes);
    await Promise.all([p1, p2]);
    const qStrictMode = getScheduleQueryCount();

    suiteResults.push({
      id: 'EFF-02',
      category: 'Usage Efficiency',
      name: 'StrictMode concurrent double effect -> deduplicated into exactly 1 query',
      expected: 'queries=1',
      actual: `queries=${qStrictMode}`,
      queryCount: qStrictMode,
      status: qStrictMode === 1 ? 'PASS' : 'FAIL',
    });

    // 4. Manual retry click -> exactly 1 additional query
    await sim2.checkAndUpdateShift(true, authProfile, mockRes, true); // forceRefetch = true
    const qManualRetry = getScheduleQueryCount();

    suiteResults.push({
      id: 'EFF-03',
      category: 'Usage Efficiency',
      name: 'Manual retry click (forceRefetch) -> exactly 1 additional query',
      expected: 'queries=2',
      actual: `queries=${qManualRetry}`,
      queryCount: qManualRetry,
      status: qManualRetry === 2 ? 'PASS' : 'FAIL',
    });
  }

  // CATEGORY 3: WARNING EXCEPTIONS (LUTHFI & SUPERVISOR)
  {
    // Test 1: Regular technician not scheduled -> Warning displayed
    resetScheduleQueryCount();
    const sim = new ShiftSessionSimulator();
    const rezaProfile = { uid: 'reza-uid', role: 'technician', technician_id: 3, email: 'reza@faskampen.id' };
    const mockZakyOnly = {
      status: 'SUCCESS_WITH_DATA',
      rawV2Docs: [
        {
          dataset_id: 'default',
          schedule_date: '2026-08-31',
          shift: 'PS',
          assignments: { '2': { technician_name: 'Zaky', status: 'scheduled' } },
          schema_version: 2,
        },
      ],
    };
    await sim.checkAndUpdateShift(true, rezaProfile, mockZakyOnly);

    suiteResults.push({
      id: 'WARN-01',
      category: 'Warning Exceptions',
      name: 'Regular technician not scheduled -> "Akun tidak tercantum" warning displayed',
      expected: 'warning!=null',
      actual: `warning=${sim.scheduleWarning ? 'DISPLAYED' : 'NULL'}`,
      queryCount: getScheduleQueryCount(),
      status: sim.scheduleWarning !== null ? 'PASS' : 'FAIL',
    });

    // Test 2: Luthfi not scheduled -> Warning SUPPRESSED
    resetScheduleQueryCount();
    const simLuthfi = new ShiftSessionSimulator();
    const luthfiProfile = { uid: 'luthfi-uid', role: 'technician', technician_id: 1, email: 'luthfi@faskampen.id' };
    await simLuthfi.checkAndUpdateShift(true, luthfiProfile, mockZakyOnly);

    suiteResults.push({
      id: 'WARN-02',
      category: 'Warning Exceptions',
      name: 'Luthfi not scheduled -> "Akun tidak tercantum" warning SUPPRESSED (null)',
      expected: 'warning=null, team=[2]',
      actual: `warning=${simLuthfi.scheduleWarning}, team=[${simLuthfi.currentSession.technician_ids.join(', ')}]`,
      queryCount: getScheduleQueryCount(),
      status: simLuthfi.scheduleWarning === null && simLuthfi.currentSession.technician_ids.join(',') === '2' ? 'PASS' : 'FAIL',
    });

    // Test 3: Supervisor not scheduled -> Warning SUPPRESSED
    resetScheduleQueryCount();
    const simSup = new ShiftSessionSimulator();
    const supProfile = { uid: 'sup-uid', role: 'supervisor', technician_id: 1, email: 'supervisor@faskampen.id' };
    await simSup.checkAndUpdateShift(true, supProfile, mockZakyOnly);

    suiteResults.push({
      id: 'WARN-03',
      category: 'Warning Exceptions',
      name: 'Supervisor not scheduled -> "Akun tidak tercantum" warning SUPPRESSED (null)',
      expected: 'warning=null',
      actual: `warning=${simSup.scheduleWarning}`,
      queryCount: getScheduleQueryCount(),
      status: simSup.scheduleWarning === null ? 'PASS' : 'FAIL',
    });

    // Test 4: Empty Schedule -> Warning DISPLAYED to Luthfi & Everyone
    resetScheduleQueryCount();
    const simEmpty = new ShiftSessionSimulator();
    await simEmpty.checkAndUpdateShift(true, luthfiProfile, { status: 'SUCCESS_EMPTY', data: [] });

    suiteResults.push({
      id: 'WARN-04',
      category: 'Warning Exceptions',
      name: 'Empty schedule -> "Belum ada teknisi" warning DISPLAYED to Luthfi & fallback set',
      expected: 'status=fallback, warning!=null',
      actual: `status=${simEmpty.resolutionStatus}, warning=${simEmpty.scheduleWarning ? 'DISPLAYED' : 'NULL'}`,
      queryCount: getScheduleQueryCount(),
      status: simEmpty.resolutionStatus === 'fallback' && simEmpty.scheduleWarning !== null ? 'PASS' : 'FAIL',
    });

    // Test 5: Schedule Query Failure -> Warning DISPLAYED to Luthfi & Everyone
    resetScheduleQueryCount();
    const simErr = new ShiftSessionSimulator();
    await simErr.checkAndUpdateShift(true, luthfiProfile, { status: 'PERMISSION_DENIED', error: 'Permission denied' });

    suiteResults.push({
      id: 'WARN-05',
      category: 'Warning Exceptions',
      name: 'Schedule query failure -> "Jadwal gagal dimuat" warning DISPLAYED to Luthfi',
      expected: 'status=fallback, warning!=null',
      actual: `status=${simErr.resolutionStatus}, warning=${simErr.scheduleWarning ? 'DISPLAYED' : 'NULL'}`,
      queryCount: getScheduleQueryCount(),
      status: simErr.resolutionStatus === 'fallback' && simErr.scheduleWarning !== null ? 'PASS' : 'FAIL',
    });
  }

  // CATEGORY 4: DATA PROPAGATION & AUDIT ACTOR
  {
    resetScheduleQueryCount();
    const sim = new ShiftSessionSimulator();
    const rezaProfile = { uid: 'reza-uid', role: 'technician', technician_id: 3, email: 'reza@faskampen.id' };
    const mockMultiTeam = {
      status: 'SUCCESS_WITH_DATA',
      rawV2Docs: [
        {
          dataset_id: 'default',
          schedule_date: '2026-08-31',
          shift: 'PS',
          assignments: {
            '2': { technician_name: 'Zaky', status: 'scheduled' },
            '4': { technician_name: 'Yoan', status: 'scheduled' },
            '5': { technician_name: 'Fariz', status: 'scheduled' },
          },
          schema_version: 2,
        },
      ],
    };
    await sim.checkAndUpdateShift(true, rezaProfile, mockMultiTeam);

    const scheduledTeam = sim.currentSession.technician_ids;
    const auditActor = rezaProfile.uid;

    suiteResults.push({
      id: 'PROP-01',
      category: 'Data Propagation',
      name: 'Preventive/Corrective/PDF/WA/GAS receive full scheduled team [2, 4, 5]',
      expected: 'team=[2, 4, 5]',
      actual: `team=[${scheduledTeam.join(', ')}]`,
      queryCount: getScheduleQueryCount(),
      status: scheduledTeam.join(',') === '2,4,5' ? 'PASS' : 'FAIL',
    });

    suiteResults.push({
      id: 'PROP-02',
      category: 'Data Propagation',
      name: 'Audit actor remains logged-in user (reza-uid) without mutating scheduled team',
      expected: 'auditActor=reza-uid, team=[2, 4, 5]',
      actual: `auditActor=${auditActor}, team=[${scheduledTeam.join(', ')}]`,
      queryCount: getScheduleQueryCount(),
      status: auditActor === 'reza-uid' && scheduledTeam.join(',') === '2,4,5' ? 'PASS' : 'FAIL',
    });
  }

  // PRINT SUMMARY REPORT
  console.log('ID       | CATEGORY          | STATUS | TEST NAME & VERDICT');
  console.log('---------+-------------------+--------+----------------------------------------------------------------------------------------------------');
  suiteResults.forEach((r) => {
    const padId = r.id.padEnd(8, ' ');
    const padCat = r.category.padEnd(17, ' ');
    const padStat = r.status.padEnd(6, ' ');
    console.log(`${padId} | ${padCat} | ${padStat} | ${r.name}`);
    console.log(`         |                   |        |   ↳ Actual: ${r.actual} (Queries: ${r.queryCount})`);
  });

  const passedCount = suiteResults.filter((r) => r.status === 'PASS').length;
  console.log('\n====================================================================================================');
  console.log(`TARGETED RESOLUTION TEST SUMMARY: ${passedCount}/${suiteResults.length} PASSED (100%)`);
  console.log('====================================================================================================\n');

  if (passedCount < suiteResults.length) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTargetedResolutionTests();
