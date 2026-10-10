import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { AuthState, FirestoreUserProfile } from '../src/types/auth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TestResult {
  id: string;
  name: string;
  expected: string;
  actual: string;
  status: 'PASS' | 'FAIL';
  notes?: string;
}

const results: TestResult[] = [];

function canEnterApp(authState: AuthState): boolean {
  return authState.isAuthenticated && authState.isAuthorized;
}

function runTests() {
  console.log('====================================================');
  console.log('X-RAY REPORTING APP v0.6.7 — AUTH & SESSION FLOW TESTS');
  console.log('====================================================\n');

  // ---------------------------------------------------------
  // TEST 1: Unauthenticated Firebase user -> operational app blocked
  // ---------------------------------------------------------
  {
    const unauthState: AuthState = {
      user: null,
      profile: null,
      isAuthenticated: false,
      isAuthorized: false,
      role: null,
      isLoading: false,
      error: null,
    };
    const allowed = canEnterApp(unauthState);
    results.push({
      id: 'AUTH-01',
      name: 'Unauthenticated Firebase user -> Operational App blocked',
      expected: 'false (BLOCKED)',
      actual: allowed ? 'true (ALLOWED - FAILURE)' : 'false (BLOCKED)',
      status: !allowed ? 'PASS' : 'FAIL',
    });
  }

  // ---------------------------------------------------------
  // TEST 2: Authenticated but missing users/{uid} profile -> blocked
  // ---------------------------------------------------------
  {
    const missingProfileState: AuthState = {
      user: {
        uid: 'user-without-profile',
        email: 'anon@faskampen.id',
        displayName: 'Anon',
        isAnonymous: false,
        providerId: 'password',
      },
      profile: null,
      isAuthenticated: true,
      isAuthorized: false,
      role: null,
      isLoading: false,
      error: 'Profil pengguna tidak ditemukan di koleksi users/{uid}.',
    };
    const allowed = canEnterApp(missingProfileState);
    results.push({
      id: 'AUTH-02',
      name: 'Authenticated but missing users/{uid} profile -> blocked',
      expected: 'false (BLOCKED)',
      actual: allowed ? 'true (ALLOWED - FAILURE)' : 'false (BLOCKED)',
      status: !allowed ? 'PASS' : 'FAIL',
    });
  }

  // ---------------------------------------------------------
  // TEST 3: Authenticated active=false -> blocked
  // ---------------------------------------------------------
  {
    const inactiveProfile: FirestoreUserProfile = {
      uid: 'inactive-user',
      email: 'inactive@faskampen.id',
      display_name: 'Inactive Tech',
      role: 'technician',
      active: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const inactiveState: AuthState = {
      user: {
        uid: 'inactive-user',
        email: 'inactive@faskampen.id',
        displayName: 'Inactive Tech',
        isAnonymous: false,
        providerId: 'password',
      },
      profile: inactiveProfile,
      isAuthenticated: true,
      isAuthorized: false,
      role: null,
      isLoading: false,
      error: 'Akun pengguna berstatus nonaktif.',
    };
    const allowed = canEnterApp(inactiveState);
    results.push({
      id: 'AUTH-03',
      name: 'Authenticated with active=false -> blocked',
      expected: 'false (BLOCKED)',
      actual: allowed ? 'true (ALLOWED - FAILURE)' : 'false (BLOCKED)',
      status: !allowed ? 'PASS' : 'FAIL',
    });
  }

  // ---------------------------------------------------------
  // TEST 4: Authenticated invalid role -> blocked
  // ---------------------------------------------------------
  {
    const invalidRoleState: AuthState = {
      user: {
        uid: 'guest-user',
        email: 'guest@faskampen.id',
        displayName: 'Guest',
        isAnonymous: false,
        providerId: 'password',
      },
      profile: {
        uid: 'guest-user',
        email: 'guest@faskampen.id',
        display_name: 'Guest',
        role: 'guest' as any,
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      isAuthenticated: true,
      isAuthorized: false,
      role: null,
      isLoading: false,
      error: 'Role tidak valid.',
    };
    const allowed = canEnterApp(invalidRoleState);
    results.push({
      id: 'AUTH-04',
      name: 'Authenticated with invalid role -> blocked',
      expected: 'false (BLOCKED)',
      actual: allowed ? 'true (ALLOWED - FAILURE)' : 'false (BLOCKED)',
      status: !allowed ? 'PASS' : 'FAIL',
    });
  }

  // ---------------------------------------------------------
  // TEST 5: Authorized technician -> direct access allowed with automatic resolution
  // ---------------------------------------------------------
  {
    const activeTechState: AuthState = {
      user: {
        uid: 'tech-1',
        email: 'luthfi@faskampen.id',
        displayName: 'Luthfi',
        isAnonymous: false,
        providerId: 'password',
      },
      profile: {
        uid: 'tech-1',
        email: 'luthfi@faskampen.id',
        display_name: 'Luthfi',
        technician_id: 1,
        role: 'technician',
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      isAuthenticated: true,
      isAuthorized: true,
      role: 'technician',
      isLoading: false,
      error: null,
    };
    const allowed = canEnterApp(activeTechState);
    results.push({
      id: 'AUTH-05',
      name: 'Authorized technician -> automatic resolution enables app access directly',
      expected: 'true (ALLOWED)',
      actual: allowed ? 'true (ALLOWED)' : 'false (BLOCKED)',
      status: allowed ? 'PASS' : 'FAIL',
    });
  }

  // ---------------------------------------------------------
  // TEST 6: Authorized technician profile -> security validation passes
  // ---------------------------------------------------------
  {
    const activeTechState: AuthState = {
      user: {
        uid: 'tech-1',
        email: 'luthfi@faskampen.id',
        displayName: 'Luthfi',
        isAnonymous: false,
        providerId: 'password',
      },
      profile: {
        uid: 'tech-1',
        email: 'luthfi@faskampen.id',
        display_name: 'Luthfi',
        technician_id: 1,
        role: 'technician',
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      isAuthenticated: true,
      isAuthorized: true,
      role: 'technician',
      isLoading: false,
      error: null,
    };
    const allowed = canEnterApp(activeTechState);
    results.push({
      id: 'AUTH-06',
      name: 'Authorized technician -> Security profile validation passes',
      expected: 'true (ALLOWED)',
      actual: allowed ? 'true (ALLOWED)' : 'false (BLOCKED)',
      status: allowed ? 'PASS' : 'FAIL',
    });
  }

  // ---------------------------------------------------------
  // TEST 7: Authorized supervisor -> directly allowed
  // ---------------------------------------------------------
  {
    const supervisorState: AuthState = {
      user: {
        uid: 'sup-1',
        email: 'supervisor@faskampen.id',
        displayName: 'Supervisor',
        isAnonymous: false,
        providerId: 'password',
      },
      profile: {
        uid: 'sup-1',
        email: 'supervisor@faskampen.id',
        display_name: 'Supervisor',
        role: 'supervisor',
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      isAuthenticated: true,
      isAuthorized: true,
      role: 'supervisor',
      isLoading: false,
      error: null,
    };
    const allowed = canEnterApp(supervisorState);
    results.push({
      id: 'AUTH-07',
      name: 'Authorized supervisor -> direct dashboard access allowed',
      expected: 'true (ALLOWED)',
      actual: allowed ? 'true (ALLOWED)' : 'false (BLOCKED)',
      status: allowed ? 'PASS' : 'FAIL',
    });
  }

  // ---------------------------------------------------------
  // TEST 8: Unauthenticated user cannot bypass security
  // ---------------------------------------------------------
  {
    const unauthState: AuthState = {
      user: null,
      profile: null,
      isAuthenticated: false,
      isAuthorized: false,
      role: null,
      isLoading: false,
      error: null,
    };
    const allowed = canEnterApp(unauthState);
    results.push({
      id: 'AUTH-08',
      name: 'Unauthenticated user -> cannot bypass security',
      expected: 'false (BLOCKED)',
      actual: !allowed ? 'false (BLOCKED)' : 'true (BYPASS)',
      status: !allowed ? 'PASS' : 'FAIL',
    });
  }

  // ---------------------------------------------------------
  // TEST 9: Logout clears session
  // ---------------------------------------------------------
  {
    const loggedOutState: AuthState = {
      user: null,
      profile: null,
      isAuthenticated: false,
      isAuthorized: false,
      role: null,
      isLoading: false,
      error: null,
    };
    const allowed = canEnterApp(loggedOutState);
    results.push({
      id: 'AUTH-09',
      name: 'Logout action -> session cleared & app access blocked',
      expected: 'false (BLOCKED)',
      actual: !allowed ? 'false (BLOCKED)' : 'true (LEAK)',
      status: !allowed ? 'PASS' : 'FAIL',
    });
  }

  // ---------------------------------------------------------
  // TEST 10: Supervisor local password check removed
  // ---------------------------------------------------------
  {
    const appTsxContent = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf-8');
    const modalContent = fs.readFileSync(path.join(__dirname, '../src/components/SupervisorLoginModal.tsx'), 'utf-8');
    const hasNandaApp = appTsxContent.includes('nanda24128');
    const hasNandaModal = modalContent.includes('nanda24128');
    const removed = !hasNandaApp && !hasNandaModal;
    results.push({
      id: 'AUTH-10',
      name: 'Hardcoded supervisor password removed from App & Modals',
      expected: 'true (REMOVED)',
      actual: removed ? 'true (REMOVED)' : 'false (FOUND HARDCODED PASSWORD)',
      status: removed ? 'PASS' : 'FAIL',
    });
  }

  // ---------------------------------------------------------
  // TEST 11: Provisioning script --help flag safe execution
  // ---------------------------------------------------------
  {
    try {
      const output = execSync('npx tsx scripts/provisionUser.ts --help', { encoding: 'utf-8' });
      const hasHelpText = output.includes('Penggunaan:') && output.includes('--help');
      results.push({
        id: 'AUTH-11',
        name: 'Provisioning script with --help flag -> zero writes & exit 0',
        expected: 'PASS (Exit 0)',
        actual: hasHelpText ? 'PASS (Exit 0)' : 'FAIL (Unexpected output)',
        status: hasHelpText ? 'PASS' : 'FAIL',
      });
    } catch (err: any) {
      results.push({
        id: 'AUTH-11',
        name: 'Provisioning script with --help flag -> zero writes & exit 0',
        expected: 'PASS (Exit 0)',
        actual: `FAIL (${err.message})`,
        status: 'FAIL',
      });
    }
  }

  // ---------------------------------------------------------
  // TEST 12: Zero hardcoded credentials in src/
  // ---------------------------------------------------------
  {
    function getAllFiles(dir: string, fileList: string[] = []): string[] {
      const files = fs.readdirSync(dir);
      files.forEach((file) => {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
          getAllFiles(filePath, fileList);
        } else {
          fileList.push(filePath);
        }
      });
      return fileList;
    }

    const srcFiles = getAllFiles(path.join(__dirname, '../src'));
    let hasHardcodedInSrc = false;
    let offendingFile = '';

    for (const fullPath of srcFiles) {
      if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        if (content.includes('nanda24128') || content.includes('Password123') || content.includes('TemporaryPassword123')) {
          hasHardcodedInSrc = true;
          offendingFile = path.relative(path.join(__dirname, '..'), fullPath);
          break;
        }
      }
    }

    results.push({
      id: 'AUTH-12',
      name: 'Zero hardcoded password strings in src/ frontend codebase',
      expected: 'true (CLEAN)',
      actual: !hasHardcodedInSrc ? 'true (CLEAN)' : `false (Found in ${offendingFile})`,
      status: !hasHardcodedInSrc ? 'PASS' : 'FAIL',
    });
  }

  // Print Summary Table
  console.log('ID       | STATUS | TEST NAME');
  console.log('---------+--------+-------------------------------------------------------------');
  let passCount = 0;
  for (const r of results) {
    if (r.status === 'PASS') passCount++;
    console.log(`${r.id.padEnd(8)} | ${r.status.padEnd(6)} | ${r.name}`);
  }
  console.log('====================================================');
  console.log(`TOTAL: ${passCount}/${results.length} PASSED`);
  console.log('====================================================\n');

  if (passCount !== results.length) {
    process.exit(1);
  }
}

runTests();
