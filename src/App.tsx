import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Role,
  NavigationTab,
  Equipment,
  ShiftType,
  PreventiveSession,
} from './types';
import { AuthState } from './types/auth';
import { buildStructuredReportData } from './services/reportService';
import {
  getActivePreventiveRecords,
  getActiveCorrectiveReports,
} from './utils/contextFilter';
import { formatPersonName, isDummyOrRemovedTechnician } from './utils/entityLookup';
import { subscribeAuthState, signOutUser } from './services/authService';
import { clearProtectedCache } from './services/localCache';
import { clearCachedShiftSession } from './services/sessionCacheService';
import { localDB } from './services/indexedDB';
import { useMasterData, useShiftSession, useAppDataSync } from './hooks';
import { LoginScreen } from './components/LoginScreen';
import { Sidebar } from './components/Sidebar';
import { ShiftModal } from './components/ShiftModal';
import { SupervisorLoginModal } from './components/SupervisorLoginModal';
import { DashboardView } from './components/DashboardView';
import { PreventiveView } from './components/PreventiveView';
import { CorrectiveView } from './components/CorrectiveView';
import { ReportView } from './components/ReportView';
import { MasterDataView } from './components/MasterDataView';
import { ScheduleView } from './components/ScheduleView';
import { EquipmentTimelineView } from './components/EquipmentTimelineView';
import { EquipmentCatalogView } from './components/EquipmentCatalogView';
import { TelegramBotModal } from './components/TelegramBotModal';
import { WhatsAppModal } from './components/WhatsAppModal';
import { SupabaseDiagnosticModal } from './components/SupabaseDiagnosticModal';
import { StorageConfigModal } from './components/StorageConfigModal';
import { SupervisorHealthModal } from './components/SupervisorHealthModal';
import { BackupManagerModal } from './components/BackupManagerModal';
import { AutoExportView } from './components/AutoExportView';
import { StorageManagerView } from './components/StorageManagerView';
import { AttendanceScreen } from './components/AttendanceScreen';
import { SupervisorAttendanceView } from './components/SupervisorAttendanceView';
import { QrScannerModal } from './components/QrScannerModal';
import { MachineQrModal } from './components/MachineQrModal';
import { PublicMachineHistoryView } from './components/PublicMachineHistoryView';
import { AvsecErrorReportScreen } from './components/AvsecErrorReportScreen';
import { AvsecReportsView } from './components/AvsecReportsView';
import { AuditLogView } from './components/AuditLogView';
import { AttendanceRecord, AttendanceSessionState } from './types';
import {
  getTodayAttendanceState,
  getScheduleAwareAttendanceStatus,
  getAllAttendanceHistory,
  fetchAttendanceHistoryFromServer,
  ResolvedAttendanceStatus,
} from './services/attendanceService';
import { evaluateOperationalPermissions } from './services/rbacPermissionService';
import { syncOperationalStateToServer } from './services/telegramService';
import { loadAppSettingsFromSupabase } from './services/appSettingsService';
import {
  AlertTriangle,
  RefreshCw,
  Coffee,
  UserCheck,
} from 'lucide-react';

export default function App() {
  // Auth State
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    profile: null,
    isAuthenticated: false,
    isAuthorized: false,
    role: null,
    isLoading: true,
    error: null,
  });

  // Navigation State with Session Persistence
  const [activeTab, setActiveTabState] = useState<NavigationTab>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('faskampen_active_tab') as NavigationTab | null;
      if (saved && ['dashboard', 'preventive', 'corrective', 'reports', 'master', 'schedule', 'timeline', 'attendance', 'storage_manager', 'auto_export'].includes(saved)) {
        return saved;
      }
    }
    return 'preventive';
  });

  // Responsive Mobile Drawer and Desktop Collapsible Sidebar State
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('sidebar_collapsed');
      if (saved !== null) return saved === 'true';
    }
    return false;
  });

  // Disable browser scroll restoration and ensure page always starts at top on refresh/load
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if ('scrollRestoration' in window.history) {
        window.history.scrollRestoration = 'manual';
      }

      const scrollToTopAll = () => {
        try {
          window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        } catch {
          window.scrollTo(0, 0);
        }
        if (document.documentElement) document.documentElement.scrollTop = 0;
        if (document.body) document.body.scrollTop = 0;
        const mainEl = document.querySelector('main');
        if (mainEl) mainEl.scrollTop = 0;
      };

      scrollToTopAll();

      const t1 = setTimeout(scrollToTopAll, 30);
      const t2 = setTimeout(scrollToTopAll, 100);
      const t3 = setTimeout(scrollToTopAll, 300);

      const handleBeforeUnload = () => {
        scrollToTopAll();
      };

      window.addEventListener('beforeunload', handleBeforeUnload);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
        window.removeEventListener('beforeunload', handleBeforeUnload);
      };
    }
  }, []);

  // Always close mobile navigation drawer and scroll to top when changing tabs
  useEffect(() => {
    setIsMobileMenuOpen(false);
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    } catch {
      window.scrollTo(0, 0);
    }
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.scrollTop = 0;
  }, [activeTab]);

  const [preSelectedCorrectiveData, setPreSelectedCorrectiveData] = useState<{
    equipment_id?: number;
    problem_description?: string;
    action_taken?: string;
    photo_url?: string;
    notes?: string;
  } | null>(null);

  const handleToggleSidebarCollapse = useCallback(() => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  }, []);

  const setActiveTab = useCallback((tab: NavigationTab) => {
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('faskampen_active_tab', tab);
      }
    } catch {}
    setActiveTabState(tab);
  }, []);

  const [masterSubTab, setMasterSubTabState] = useState<
    'equipment' | 'location' | 'type' | 'checklist' | 'technician' | 'telegram' | 'reports' | 'sql'
  >(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('faskampen_master_sub_tab') as any;
      if (
        saved &&
        ['equipment', 'location', 'type', 'checklist', 'technician', 'telegram', 'reports', 'sql'].includes(saved)
      ) {
        return saved;
      }
    }
    return 'equipment';
  });

  const setMasterSubTab = useCallback(
    (subTab: 'equipment' | 'location' | 'type' | 'checklist' | 'technician' | 'telegram' | 'reports' | 'sql') => {
      try {
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('faskampen_master_sub_tab', subTab);
        }
      } catch {}
      setMasterSubTabState(subTab);
    },
    []
  );

  const [selectedTimelineEquipmentId, setSelectedTimelineEquipmentId] = useState<number | null>(null);
  const [timelineBackTab, setTimelineBackTab] = useState<'master' | 'dashboard' | 'timeline'>('master');
  const [reportSubTab, setReportSubTab] = useState<'wa' | 'excel' | 'pdf' | 'history'>('wa');

  // Modals & Pre-selection
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [isSupervisorLoginOpen, setIsSupervisorLoginOpen] = useState(false);
  const [isTelegramModalOpen, setIsTelegramModalOpen] = useState(false);
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState(false);
  const [isSupabaseModalOpen, setIsSupabaseModalOpen] = useState(false);
  const [isStorageModalOpen, setIsStorageModalOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isHealthModalOpen, setIsHealthModalOpen] = useState(false);
  const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false);
  const [isQrScannerModalOpen, setIsQrScannerModalOpen] = useState(false);
  const [qrModalEquipment, setQrModalEquipment] = useState<Equipment | null>(null);
  const [preSelectedEquipmentId, setPreSelectedEquipmentId] = useState<number | null>(null);

  // Public Guest Mode State (for QR Code scan / public machine timeline)
  const [publicMachineCode, setPublicMachineCode] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname || '';
      if (pathname.startsWith('/public/machine/')) {
        return decodeURIComponent(pathname.replace('/public/machine/', '').trim());
      }
      const params = new URLSearchParams(window.location.search);
      if (params.get('public_machine')) {
        return decodeURIComponent(params.get('public_machine') || '').trim();
      }
      if (params.get('equipment') && params.get('guest') === 'true') {
        return decodeURIComponent(params.get('equipment') || '').trim();
      }
    }
    return '';
  });

  const [isPublicGuestMode, setIsPublicGuestMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname || '';
      const params = new URLSearchParams(window.location.search);
      return (
        pathname.startsWith('/public/machine/') ||
        params.has('public_machine') ||
        params.get('guest') === 'true'
      );
    }
    return false;
  });

  // Public AVSEC QR Error Reporting Mode (for scanned QR on machine stickers)
  const [publicAvsecQrId, setPublicAvsecQrId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname || '';
      const hash = window.location.hash || '';
      if (pathname.startsWith('/r/')) {
        return decodeURIComponent(pathname.replace('/r/', '').trim());
      }
      if (hash.startsWith('#/r/')) {
        return decodeURIComponent(hash.replace('#/r/', '').trim());
      }
      const params = new URLSearchParams(window.location.search);
      if (params.get('r')) {
        return decodeURIComponent(params.get('r') || '').trim();
      }
      if (params.get('avsec_qr')) {
        return decodeURIComponent(params.get('avsec_qr') || '').trim();
      }
    }
    return '';
  });

  // Attendance Session State
  const [attendanceSession, setAttendanceSession] = useState<AttendanceSessionState>(() => {
    return {
      hasAttended: false,
      isBypassed: false,
      isOffDuty: false,
    };
  });

  // Concurrency & state refs to eliminate re-entrancy loops
  const initialStartupSyncDoneRef = useRef(false);
  const hasInitializedTabRef = useRef(false);
  const authStateRef = useRef<{ isAuthenticated: boolean; isAuthorized: boolean }>({
    isAuthenticated: false,
    isAuthorized: false,
  });

  // Master Data Hook
  const masterData = useMasterData();

  // Shift & Session Hook (auto shift & schedule polling)
  const [activeDatasetIdState, setActiveDatasetIdState] = useState<string>('default');

  const currentUserUid = authState.user?.uid || null;
  const isBaseAuthorized = authState.isAuthenticated && authState.isAuthorized;

  const shiftSession = useShiftSession({
    isLoggedIn: isBaseAuthorized,
    technicians: masterData.technicians,
    activeDatasetId: activeDatasetIdState,
    currentUserProfile: authState.profile,
    currentUserEmail: authState.user?.email,
  });

  const role: Role = useMemo(() => {
    const rawRole = authState.profile?.role || authState.role || shiftSession.loggedInTechnician?.role;
    if (rawRole === 'system_admin' || rawRole === 'admin') {
      return 'system_admin';
    }
    if (rawRole === 'operations_admin') {
      return 'operations_admin';
    }
    if (rawRole === 'supervisor') {
      return 'supervisor';
    }
    return (rawRole as Role) || 'technician';
  }, [authState.role, authState.profile?.role, shiftSession.loggedInTechnician?.role]);

  // Application Security Gate: Requires valid authentication & completed schedule resolution ('resolved' or 'fallback')
  const isResolutionFinished =
    shiftSession.resolutionStatus === 'resolved' ||
    shiftSession.resolutionStatus === 'fallback';

  const isPrivilegedRole = role === 'supervisor' || role === 'system_admin' || role === 'operations_admin' || role === 'admin';
  const canEnterOperationalApp =
    isBaseAuthorized &&
    (isPrivilegedRole || isResolutionFinished);

  // Cloud Sync & App Data Hook
  const syncData = useAppDataSync({
    isLoggedIn: canEnterOperationalApp,
    currentUserUid,
    currentSession: shiftSession.currentSession,
    equipments: masterData.equipments,
    equipmentTypes: masterData.equipmentTypes,
    locations: masterData.locations,
    authStateRef,
  });

  // Stable ref to syncFromCloud to prevent re-subscribing in effect
  const syncFromCloudRef = useRef(syncData.syncFromCloud);
  useEffect(() => {
    syncFromCloudRef.current = syncData.syncFromCloud;
  }, [syncData.syncFromCloud]);

  // Keep activeDatasetIdState in sync with syncData.activeDatasetId
  useEffect(() => {
    setActiveDatasetIdState((prev) => (prev === syncData.activeDatasetId ? prev : syncData.activeDatasetId));
  }, [syncData.activeDatasetId]);

  // Initial Startup Cloud Sync & App Settings Load (strictly ONCE on app load)
  useEffect(() => {
    if (!initialStartupSyncDoneRef.current) {
      initialStartupSyncDoneRef.current = true;
      syncFromCloudRef.current();
      fetchAttendanceHistoryFromServer().catch(() => {});
      loadAppSettingsFromSupabase().catch(() => {});
    }
  }, []);

  // Subscribe to Auth State changes (syncs data when authorized, guarded to run only once per unique user session)
  const lastSyncedAuthUidRef = useRef<string | null>(null);
  useEffect(() => {
    const unsubscribe = subscribeAuthState(async (newAuthState) => {
      setAuthState((prev) => {
        if (
          prev.isAuthenticated === newAuthState.isAuthenticated &&
          prev.isAuthorized === newAuthState.isAuthorized &&
          prev.role === newAuthState.role &&
          prev.isLoading === newAuthState.isLoading &&
          prev.error === newAuthState.error &&
          prev.user?.uid === newAuthState.user?.uid &&
          prev.profile?.role === newAuthState.profile?.role &&
          prev.profile?.display_name === newAuthState.profile?.display_name &&
          prev.profile?.technician_id === newAuthState.profile?.technician_id
        ) {
          return prev;
        }
        return newAuthState;
      });
      authStateRef.current = {
        isAuthenticated: newAuthState.isAuthenticated,
        isAuthorized: newAuthState.isAuthorized,
      };

      if (newAuthState.isAuthenticated && newAuthState.isAuthorized && newAuthState.user) {
        // ONLY pick a default tab ONCE upon initial app startup if no tab is stored in session
        if (!hasInitializedTabRef.current) {
          hasInitializedTabRef.current = true;
          const savedTab = typeof window !== 'undefined' ? sessionStorage.getItem('faskampen_active_tab') : null;
          if (!savedTab) {
            setActiveTab(newAuthState.role === 'supervisor' ? 'dashboard' : 'preventive');
          }
        }
        // Guard cloud sync to only run once per unique user session or on user switch
        if (lastSyncedAuthUidRef.current !== newAuthState.user.uid) {
          lastSyncedAuthUidRef.current = newAuthState.user.uid;
          syncFromCloudRef.current();
          // Recover any photos interrupted in UPLOADING status due to abrupt browser exit
          localDB.recoverOrphanedUploadingPhotos(newAuthState.user.uid).catch(() => {});
        }
      } else {
        lastSyncedAuthUidRef.current = null;
      }
    });
    return () => unsubscribe();
  }, [setActiveTab]);

  // Sync latest equipment & operational state to server for Telegram bot commands (/alat, /brief)
  useEffect(() => {
    if (masterData.equipments && masterData.equipments.length > 0) {
      syncOperationalStateToServer({
        operationalDate: shiftSession.currentSession.operational_date,
        shift: shiftSession.currentSession.shift,
        technicianNames: shiftSession.technicianNames,
        equipments: masterData.equipments,
        correctiveReports: syncData.correctiveReports,
      }).catch(() => {});
    }
  }, [
    masterData.equipments,
    syncData.correctiveReports,
    shiftSession.currentSession.operational_date,
    shiftSession.currentSession.shift,
    shiftSession.technicianNames,
  ]);

  // Deep-linking from scanned machine QR code URL (e.g. ?equipment=5 or ?eq=5 or ?code=SMP-VIP-01)
  useEffect(() => {
    if (!masterData.equipments || masterData.equipments.length === 0) return;
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const eqIdParam = urlParams.get('equipment') || urlParams.get('eq');
      const eqCodeParam = urlParams.get('code');

      let targetEq: Equipment | undefined;
      if (eqIdParam) {
        targetEq = masterData.equipments.find((e) => e.id === Number(eqIdParam));
      }
      if (!targetEq && eqCodeParam) {
        targetEq = masterData.equipments.find(
          (e) => (e.equipment_code || '').toLowerCase() === eqCodeParam.toLowerCase()
        );
      }

      if (targetEq?.id) {
        setSelectedTimelineEquipmentId(targetEq.id);
        setTimelineBackTab('dashboard');
        setActiveTab('timeline');
      }
    } catch (e) {
      console.warn('Gagal membaca parameter deep link URL:', e);
    }
  }, [masterData.equipments, setActiveTab]);

  // Role Access Guard: Enforce strict RBAC rules on tab navigation
  useEffect(() => {
    // Crucial: Never guard/redirect while auth state is still loading to prevent race conditions
    if (authState.isLoading) return;
    if (authState.isAuthenticated) {
      if (activeTab === 'master' && (role !== 'supervisor' && role !== 'system_admin' && role !== 'admin')) {
        setActiveTab(role === 'operations_admin' ? 'dashboard' : 'preventive');
      }
      if (activeTab === 'schedule' && (role !== 'supervisor' && role !== 'system_admin' && role !== 'operations_admin' && role !== 'admin')) {
        setActiveTab('preventive');
      }
      if ((activeTab === 'preventive' || activeTab === 'corrective' || activeTab === 'avsec_reports') && role === 'operations_admin') {
        setActiveTab('dashboard');
      }
      if (activeTab === 'attendance' && (role !== 'supervisor' && role !== 'system_admin' && role !== 'operations_admin' && role !== 'admin')) {
        setActiveTab('preventive');
      }
      if (activeTab === 'audit_logs' && (role !== 'supervisor' && role !== 'system_admin' && role !== 'admin')) {
        setActiveTab(role === 'operations_admin' ? 'dashboard' : 'preventive');
      }
      if (['storage_manager', 'health_diagnostic', 'storage_config', 'whatsapp_bot', 'telegram_bot', 'backup_manager', 'auto_export'].includes(activeTab) &&
          (role !== 'supervisor' && role !== 'system_admin' && role !== 'admin')) {
        setActiveTab(role === 'operations_admin' ? 'dashboard' : 'preventive');
      }
    }
  }, [role, activeTab, authState.isLoading, authState.isAuthenticated, setActiveTab]);

  // Check today's attendance state for active logged-in technician
  const primaryTechName =
    authState.profile?.display_name ||
    authState.profile?.name ||
    shiftSession.loggedInTechnician?.name ||
    shiftSession.technicianNames?.[0] ||
    '';

  useEffect(() => {
    if (!primaryTechName) return;
    const opDate = shiftSession.currentSession.operational_date;
    const todayState = getTodayAttendanceState(primaryTechName, opDate);
    setAttendanceSession((prev) => {
      if (
        prev.hasAttended === todayState.hasAttended &&
        prev.isBypassed === todayState.isBypassed &&
        prev.isOffDuty === todayState.isOffDuty &&
        prev.record?.id === todayState.record?.id
      ) {
        return prev;
      }
      return todayState;
    });
  }, [primaryTechName, shiftSession.currentSession.operational_date]);

  // When user is authenticated, sync latest attendance from database and refresh attendanceSession
  useEffect(() => {
    if (authState.isAuthenticated && authState.isAuthorized) {
      const opDate = shiftSession.currentSession.operational_date;
      fetchAttendanceHistoryFromServer(opDate).then(() => {
        if (primaryTechName) {
          const freshState = getTodayAttendanceState(primaryTechName, opDate);
          setAttendanceSession(freshState);
        }
      }).catch(() => {});
    }
  }, [authState.isAuthenticated, authState.isAuthorized, authState.user?.uid, primaryTechName, shiftSession.currentSession.operational_date]);

  // Logout Handler (cleans session and protected runtime state)
  const handleLogout = async () => {
    const prevUid = currentUserUid;
    await signOutUser();
    authStateRef.current = {
      isAuthenticated: false,
      isAuthorized: false,
    };
    clearCachedShiftSession();
    if (prevUid) {
      clearProtectedCache(prevUid);
    }
    syncData.clearDataOnLogout();
    // Refresh page upon logout for both technician and supervisor
    window.location.reload();
  };

  // Login / Session Selection Handler for Authorized Technician
  const handleLoginTechnician = (selectedTechIds: number[]) => {
    if (authState.role === 'technician' && (!selectedTechIds || selectedTechIds.length === 0)) {
      console.warn('Login rejected: technician_ids cannot be empty');
      return;
    }
    // Only update session on-duty technicians if the schedule has no scheduled staff (fallback mode)
    if (
      selectedTechIds &&
      selectedTechIds.length > 0 &&
      (!shiftSession.scheduleAvailable || shiftSession.isScheduleEmpty || shiftSession.resolutionStatus === 'fallback')
    ) {
      shiftSession.handleLoginTechnicianSession(selectedTechIds);
    }
    const isPrivilegedUser =
      authState.role === 'supervisor' ||
      authState.role === 'system_admin' ||
      authState.role === 'operations_admin' ||
      authState.role === 'admin';
    if (isPrivilegedUser) {
      setActiveTab('dashboard');
    } else {
      setActiveTab('preventive'); // Halaman utama teknisi langsung disuguhkan dengan preventif
    }
  };

  // Active Context Filtered & Deduplicated Records
  const activeContext = useMemo(() => ({
    datasetId: syncData.activeDatasetId,
    operationalDate: shiftSession.currentSession.operational_date,
    shift: shiftSession.currentSession.shift,
  }), [syncData.activeDatasetId, shiftSession.currentSession.operational_date, shiftSession.currentSession.shift]);

  const activePreventiveEntries = useMemo(
    () => getActivePreventiveRecords(syncData.preventiveEntries, activeContext),
    [syncData.preventiveEntries, activeContext]
  );
  const activeCorrectiveReports = useMemo(
    () => getActiveCorrectiveReports(syncData.correctiveReports, activeContext),
    [syncData.correctiveReports, activeContext]
  );

  const [historicalContext, setHistoricalContext] = useState<{ rawDate: string; shift: ShiftType } | null>(null);

  // Structured Report Builder Data (memoized to compute only when active tab is reports/master or data changes)
  const structuredReportData = useMemo(() => {
    if (activeTab !== 'reports' && activeTab !== 'master') return null;

    if (historicalContext) {
      const histContext = {
        datasetId: syncData.activeDatasetId,
        operationalDate: historicalContext.rawDate,
        shift: historicalContext.shift,
      };

      const histPreventive = getActivePreventiveRecords(syncData.preventiveEntries, histContext);
      const histCorrective = getActiveCorrectiveReports(syncData.correctiveReports, histContext);

      // Collect historical technician IDs and names from entries and reports
      const techIdSet = new Set<number>();
      const techNameSet = new Set<string>();

      histPreventive.forEach((p) => {
        if (Array.isArray(p.submitted_by_technician_ids)) {
          p.submitted_by_technician_ids.forEach((id) => techIdSet.add(Number(id)));
        }
        if ((p as any).technician_name) {
          techNameSet.add((p as any).technician_name);
        }
      });

      histCorrective.forEach((c: any) => {
        if (c.technician_id) techIdSet.add(Number(c.technician_id));
        if (Array.isArray(c.technicians)) {
          c.technicians.forEach((t: string) => techNameSet.add(t));
        }
        if (c.technician_name) techNameSet.add(c.technician_name);
      });

      // Match IDs with masterData.technicians
      techIdSet.forEach((id) => {
        const found = masterData.technicians.find((t) => Number(t.id) === id);
        if (found && found.name) {
          techNameSet.add(found.name);
        }
      });

      // Check shift_schedules from syncData or cache if available
      try {
        const rawSched = (syncData as any).shiftSchedules || localStorage.getItem('shift_schedules');
        const schedList = Array.isArray(rawSched)
          ? rawSched
          : typeof rawSched === 'string'
          ? JSON.parse(rawSched)
          : null;
        if (Array.isArray(schedList)) {
          const matchingSchedule = schedList.find(
            (s: any) =>
              s.date === historicalContext.rawDate &&
              (s.shift || '').toLowerCase() === (historicalContext.shift || '').toLowerCase()
          );
          if (matchingSchedule && Array.isArray(matchingSchedule.technicians)) {
            matchingSchedule.technicians.forEach((t: string) => techNameSet.add(t));
          }
        }
      } catch (_) {}

      const cleanHistTechs = Array.from(techNameSet).filter((n) => !isDummyOrRemovedTechnician(n));
      const finalHistTechNames = cleanHistTechs.length > 0 ? cleanHistTechs : shiftSession.technicianNames;

      const histSession: PreventiveSession = {
        id: Date.now(),
        dataset_id: syncData.activeDatasetId,
        operational_date: historicalContext.rawDate,
        shift: historicalContext.shift,
        technician_ids: Array.from(techIdSet),
        technician_names: finalHistTechNames,
        started_at: `${historicalContext.rawDate}T08:00:00`,
        ended_at: `${historicalContext.rawDate}T16:00:00`,
        status: 'completed',
      };

      return buildStructuredReportData(
        histSession,
        histPreventive,
        masterData.equipments,
        masterData.equipmentTypes,
        masterData.technicians,
        histCorrective,
        masterData.locations
      );
    }

    return buildStructuredReportData(
      shiftSession.currentSession,
      activePreventiveEntries,
      masterData.equipments,
      masterData.equipmentTypes,
      masterData.technicians,
      activeCorrectiveReports,
      masterData.locations
    );
  }, [
    activeTab,
    historicalContext,
    syncData.activeDatasetId,
    syncData.preventiveEntries,
    syncData.correctiveReports,
    shiftSession.currentSession,
    shiftSession.technicianNames,
    activePreventiveEntries,
    activeCorrectiveReports,
    masterData.equipments,
    masterData.equipmentTypes,
    masterData.technicians,
    masterData.locations,
  ]);

  const accountName = useMemo(() => {
    const raw =
      authState.profile?.display_name ||
      authState.profile?.name ||
      shiftSession.loggedInTechnician?.name ||
      (authState.user?.email ? authState.user.email.split('@')[0] : '') ||
      (authState.role === 'supervisor' ? 'Supervisor' : 'Teknisi');
    return formatPersonName(raw);
  }, [authState.profile, authState.user, authState.role, shiftSession.loggedInTechnician]);

  // Real-time 15s ticker for automatic shift transition updates without re-login
  const [nowTicker, setNowTicker] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTicker(Date.now());
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  // Centralized RBAC & Operational Permission Evaluation
  const permissionResult = useMemo(() => {
    const tech = shiftSession.loggedInTechnician || (authState.profile ? {
      id: authState.profile.technician_id,
      name: authState.profile.display_name || authState.profile.name,
      role: authState.profile.role,
    } : null);

    const effectiveRole = authState.profile?.role || authState.role;
    const userRole: 'system_admin' | 'operations_admin' | 'supervisor' | 'technician' | 'admin' =
      effectiveRole === 'system_admin' ? 'system_admin' :
      effectiveRole === 'operations_admin' ? 'operations_admin' :
      effectiveRole === 'supervisor' ? 'supervisor' :
      effectiveRole === 'admin' ? 'admin' : 'technician';

    return evaluateOperationalPermissions({
      userRole,
      technician: tech,
      nowDate: new Date(nowTicker),
      scheduleDocPS: shiftSession.currentScheduleDoc?.shift === 'PS' ? shiftSession.currentScheduleDoc : null,
      scheduleDocM: shiftSession.currentScheduleDoc?.shift === 'M' ? shiftSession.currentScheduleDoc : null,
      attendanceHistory: getAllAttendanceHistory(),
    });
  }, [
    shiftSession.loggedInTechnician,
    authState.profile,
    authState.role,
    shiftSession.currentScheduleDoc,
    attendanceSession,
    nowTicker,
  ]);

  // Schedule-aware attendance status for current logged-in technician
  const resolvedAttendanceStatus = useMemo(() => {
    const tech = shiftSession.loggedInTechnician || (authState.profile ? {
      id: authState.profile.technician_id,
      name: authState.profile.display_name || authState.profile.name,
      role: authState.profile.role,
    } : null);

    return getScheduleAwareAttendanceStatus({
      technician: tech,
      scheduleDoc: shiftSession.currentScheduleDoc,
      history: getAllAttendanceHistory(),
      nowDate: new Date(nowTicker),
    });
  }, [shiftSession.loggedInTechnician, authState.profile, shiftSession.currentScheduleDoc, attendanceSession, nowTicker]);

  const isOffTechnician = permissionResult.schedule === 'LIBUR' || attendanceSession.isOffDuty;

  // Check if technician is in viewer-only (read-only) mode
  const isPrivilegedEditor = role === 'supervisor' || role === 'system_admin' || role === 'admin';
  const isUserViewerOnly =
    !isPrivilegedEditor &&
    (!permissionResult.permissions.canSubmitPreventive || isOffTechnician);

  // Check if staff needs to complete attendance before accessing dashboard
  // Desi (Admin, Office) & Luthfi (Tech, Office) are required to attend
  const isOfficeStaff = permissionResult.schedule === 'OFFICE';
  const needsAttendance =
    canEnterOperationalApp &&
    (role !== 'supervisor' || isOfficeStaff) &&
    !attendanceSession.hasAttended &&
    !attendanceSession.isBypassed &&
    (permissionResult.attendanceState === 'CAN_CHECK_IN' || permissionResult.attendanceState === 'CAN_CHECK_IN_LATE');

  // Public AVSEC QR Error Reporting View (No Login Required)
  if (publicAvsecQrId) {
    return (
      <AvsecErrorReportScreen
        publicId={publicAvsecQrId}
        onClose={() => {
          setPublicAvsecQrId('');
          if (typeof window !== 'undefined' && window.location.pathname.startsWith('/r/')) {
            window.history.replaceState({}, '', '/');
          }
        }}
      />
    );
  }

  // Public Machine History / Guest View (No Login Required)
  if (isPublicGuestMode) {
    return (
      <PublicMachineHistoryView
        initialEquipmentCode={publicMachineCode || '1'}
        onGoToLogin={() => {
          setIsPublicGuestMode(false);
          setPublicMachineCode('');
          if (typeof window !== 'undefined' && window.location.pathname.startsWith('/public/machine/')) {
            window.history.replaceState({}, '', '/');
          }
        }}
        onSelectAnotherMachine={(code) => setPublicMachineCode(code)}
      />
    );
  }

  // Render Login Screen if not logged in / not authorized
  if (!canEnterOperationalApp) {
    return (
      <LoginScreen
        technicians={masterData.technicians}
        authState={authState}
        onLoginTechnician={handleLoginTechnician}
        onLogout={handleLogout}
        isScheduleLoading={shiftSession.isScheduleLoading}
        onOpenPublicHistory={(code) => {
          setPublicMachineCode(code || '1');
          setIsPublicGuestMode(true);
        }}
      />
    );
  }

  // Render Attendance Screen if logged in but hasn't attended / bypassed / off-duty yet
  if (needsAttendance) {
    const isScheduleUndefined =
      shiftSession.resolutionStatus === 'fallback' ||
      !shiftSession.technicianNames ||
      shiftSession.technicianNames.length === 0;

    return (
      <AttendanceScreen
        technicians={masterData.technicians}
        currentUserProfile={authState.profile}
        currentUserEmail={authState.user?.email || undefined}
        defaultTechnicianName={
          authState.profile?.display_name ||
          authState.profile?.name ||
          shiftSession.loggedInTechnician?.name ||
          shiftSession.technicianNames?.[0]
        }
        isScheduleUndefined={isScheduleUndefined}
        attendanceStatus={resolvedAttendanceStatus}
        scheduledShift={resolvedAttendanceStatus.shift}
        operationalDate={resolvedAttendanceStatus.operationalDate}
        onCompleteAttendance={(record) => {
          setAttendanceSession({
            hasAttended: true,
            isBypassed: false,
            isOffDuty: false,
            record,
          });
          syncData.syncFromCloud(undefined, undefined, false);
          if (record?.attendance_type === 'pulang') {
            handleLogout();
            return;
          }
          if (record?.technician_name) {
            const attendingTech = masterData.technicians?.find(
              (t) => t?.name && t.name.toLowerCase() === record.technician_name?.toLowerCase()
            );
            if (
              attendingTech?.id &&
              (!shiftSession.scheduleAvailable || shiftSession.isScheduleEmpty || shiftSession.resolutionStatus === 'fallback')
            ) {
              shiftSession.handleLoginTechnicianSession([attendingTech.id]);
            }
          }
        }}
        onBypassAttendance={(record) => {
          setAttendanceSession({
            hasAttended: false,
            isBypassed: true,
            isOffDuty: false,
            record,
          });
          syncData.syncFromCloud(undefined, undefined, false);
        }}
        onOffDuty={(record) => {
          setAttendanceSession({
            hasAttended: false,
            isBypassed: false,
            isOffDuty: true,
            record,
          });
        }}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col md:flex-row selection:bg-blue-100">
      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        masterSubTab={masterSubTab}
        setMasterSubTab={setMasterSubTab}
        role={role}
        shift={shiftSession.currentSession.shift}
        operationalDate={shiftSession.currentSession.operational_date}
        technicianNames={shiftSession.technicianNames}
        accountName={accountName}
        onLogout={handleLogout}
        onOpenShiftModal={() => setIsShiftModalOpen(true)}
        onOpenSupervisorLogin={() => setIsSupervisorLoginOpen(true)}
        onLogoutSupervisor={handleLogout}
        syncStatus={syncData.syncStatus}
        lastSyncTime={syncData.lastSyncTime}
        onManualSync={() => syncData.syncFromCloud(undefined, undefined, true)}
        activeDatasetId={syncData.activeDatasetId}
        onOpenTelegramModal={() => setIsTelegramModalOpen(true)}
        onOpenWhatsAppModal={() => setIsWhatsAppModalOpen(true)}
        onOpenAttendanceModal={() => setIsAttendanceModalOpen(true)}
        attendanceStatus={resolvedAttendanceStatus}
        onOpenQrScanner={() => setIsQrScannerModalOpen(true)}
        onOpenQrPrint={() => setQrModalEquipment(masterData.equipments[0] || null)}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={handleToggleSidebarCollapse}
        isMobileMenuOpen={isMobileMenuOpen}
        setIsMobileMenuOpen={setIsMobileMenuOpen}
        activeReportSubTab={reportSubTab}
        onSelectReportSubTab={setReportSubTab}
        onOpenSupabaseModal={() => setIsSupabaseModalOpen(true)}
        onOpenStorageModal={() => setIsStorageModalOpen(true)}
        onOpenBackupModal={() => setIsBackupModalOpen(true)}
        onOpenHealthModal={() => setIsHealthModalOpen(true)}
      />

      {/* Main Views Layout */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Off-Duty / Viewer Mode Banner */}
        {role !== 'supervisor' && isUserViewerOnly && !isOffTechnician && !attendanceSession.isOffDuty && permissionResult.schedule !== 'LIBUR' && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-xs text-amber-900 flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-2">
              <Coffee className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                {isOffTechnician || attendanceSession.isOffDuty ? (
                  <><b>Mode Pemantau (Libur / Off-Duty):</b> Anda sedang melihat data dalam mode baca saja.</>
                ) : !attendanceSession.hasAttended ? (
                  <><b>Mode Pemantau (Shift Belum Aktif / Belum Presensi):</b> Anda sedang melihat data dalam mode baca saja.</>
                ) : (
                  <><b>Mode Pemantau:</b> Anda tidak terdaftar sebagai personil on-duty pada shift ini.</>
                )}
              </span>
            </div>
            {resolvedAttendanceStatus.state === 'CAN_CHECK_IN' && (
              <button
                onClick={() => setIsAttendanceModalOpen(true)}
                className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs transition cursor-pointer shadow-xs"
              >
                Isi Presensi Shift Sekarang
              </button>
            )}
            {resolvedAttendanceStatus.state === 'SCHEDULED_EARLY' && (
              <div className="px-2.5 py-1.5 bg-amber-100 text-amber-900 font-medium rounded-lg text-[11px] border border-amber-300/80 leading-tight flex flex-col gap-0.5">
                <div className="font-bold">Presensi Belum Dibuka</div>
                <div>Absen mulai jam {((resolvedAttendanceStatus.shift || '').toLowerCase().includes('malam')) ? '18.00 WIB' : '06.00 WIB'}</div>
              </div>
            )}
          </div>
        )}

        {/* Main Content Area: Uniform Container Width & Spacing Across All Tabs */}
        <main className="flex-1 w-full px-3 sm:px-5 lg:px-6 xl:px-8 py-3.5 sm:py-5 max-w-[1920px] mx-auto transition-all duration-300">
          {/* Automatic Resolution Schedule Warning Banner */}
          {shiftSession.scheduleWarning && (
            <div className="mb-4 p-3.5 bg-amber-50 border border-amber-200/90 rounded-2xl flex items-center justify-between gap-3 text-amber-900 shadow-xs">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs font-medium leading-relaxed">
                  {shiftSession.scheduleWarning}
                </div>
              </div>
              {(shiftSession.resolutionStatus === 'fallback' || shiftSession.isScheduleEmpty) && (
                <button
                  onClick={() => shiftSession.refreshSchedule()}
                  disabled={shiftSession.isScheduleLoading}
                  className="shrink-0 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${shiftSession.isScheduleLoading ? 'animate-spin' : ''}`} />
                  <span>Coba Muat Ulang Jadwal</span>
                </button>
              )}
            </div>
          )}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab === 'timeline' ? `timeline-${selectedTimelineEquipmentId}` : activeTab}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="w-full"
            >
              {activeTab === 'dashboard' && (
            <DashboardView
              equipments={masterData.equipments}
              equipmentTypes={masterData.equipmentTypes}
              locations={masterData.locations}
              preventiveEntries={activePreventiveEntries}
              correctiveReports={activeCorrectiveReports}
              currentSession={shiftSession.currentSession}
              role={role}
              onStartPreventive={(eqId) => {
                setPreSelectedEquipmentId(eqId || null);
                setActiveTab('preventive');
              }}
              technicianNames={shiftSession.technicianNames}
              onOpenShiftModal={() => setIsShiftModalOpen(true)}
              onOpenTelegramModal={() => setIsTelegramModalOpen(true)}
              onOpenQrScanner={() => setIsQrScannerModalOpen(true)}
              onOpenQrPrint={(eq) => setQrModalEquipment(eq || masterData.equipments[0] || null)}
              onOpenReportsTab={() => setActiveTab('reports')}
              onDeletePreventiveEntry={syncData.handleDeletePreventiveEntry}
              onViewTimeline={(eqId) => {
                setSelectedTimelineEquipmentId(eqId);
                setTimelineBackTab('dashboard');
                setActiveTab('timeline');
              }}
            />
          )}

          {activeTab === 'preventive' && (
            <PreventiveView
              equipments={masterData.equipments}
              equipmentTypes={masterData.equipmentTypes}
              locations={masterData.locations}
              frequencies={masterData.frequencies}
              checklistItems={masterData.checklistItems}
              preventiveEntries={activePreventiveEntries}
              allPreventiveEntries={syncData.preventiveEntries}
              preSelectedEquipmentId={preSelectedEquipmentId}
              onClearPreSelectedEquipmentId={() => setPreSelectedEquipmentId(null)}
              onSubmitEntry={syncData.handleSubmitPreventiveEntry}
              onBackToDashboard={() => setActiveTab('dashboard')}
              operationalDate={shiftSession.currentSession.operational_date}
              shift={shiftSession.currentSession.shift}
              isViewerOnly={isUserViewerOnly}
              technicianNames={shiftSession.technicianNames}
              currentTechnicianId={authState.profile?.technician_id || shiftSession.loggedInTechnician?.id || shiftSession.currentSession.technician_ids?.[0]}
              shiftTechnicianIds={shiftSession.currentSession.technician_ids}
              role={role}
            />
          )}

          {activeTab === 'corrective' && (
            <CorrectiveView
              correctiveReports={syncData.correctiveReports}
              equipments={masterData.equipments}
              equipmentTypes={masterData.equipmentTypes}
              locations={masterData.locations}
              onAddCorrective={syncData.handleAddCorrective}
              onDeleteCorrective={syncData.handleDeleteCorrectiveReport}
              technicianNames={shiftSession.technicianNames}
              currentTechnicianId={authState.profile?.technician_id || shiftSession.loggedInTechnician?.id || shiftSession.currentSession.technician_ids?.[0]}
              shift={shiftSession.currentSession.shift}
              operationalDate={shiftSession.currentSession.operational_date}
              isViewerOnly={isUserViewerOnly}
              role={role}
              preSelectedData={preSelectedCorrectiveData}
              onClearPreSelectedData={() => setPreSelectedCorrectiveData(null)}
            />
          )}

          {activeTab === 'reports' && structuredReportData && (
            <ReportView
              structuredData={structuredReportData}
              preventiveEntries={syncData.preventiveEntries}
              correctiveReports={syncData.correctiveReports}
              equipments={masterData.equipments}
              equipmentTypes={masterData.equipmentTypes}
              technicians={masterData.technicians}
              locations={masterData.locations}
              currentSession={shiftSession.currentSession}
              selectedHistoricalDate={historicalContext?.rawDate}
              selectedHistoricalShift={historicalContext?.shift}
              isHistoricalActive={!!historicalContext}
              onSelectHistoricalReport={(rawDate, shift) => {
                setHistoricalContext({ rawDate, shift });
              }}
              onResetToCurrentSession={() => {
                setHistoricalContext(null);
              }}
              activeSubTab={reportSubTab}
              onSubTabChange={setReportSubTab}
              role={role}
            />
          )}

          {activeTab === 'master' && (role === 'supervisor' || role === 'system_admin' || role === 'admin') && (
            <MasterDataView
              equipments={masterData.equipments}
              equipmentTypes={masterData.equipmentTypes}
              locations={masterData.locations}
              frequencies={masterData.frequencies}
              checklistItems={masterData.checklistItems}
              preventiveEntries={syncData.preventiveEntries}
              correctiveReports={syncData.correctiveReports}
              currentSession={shiftSession.currentSession}
              onSelectHistoricalReport={(rawDate, shift) => {
                setHistoricalContext({ rawDate, shift });
              }}
              onOpenReportView={() => {
                setActiveTab('reports');
              }}
              onAddEquipment={masterData.handleAddEquipment}
              onUpdateEquipment={masterData.handleUpdateEquipment}
              onDeleteEquipment={masterData.handleDeleteEquipment}
              onToggleEquipmentActive={masterData.handleToggleEquipmentActive}
              onAddLocation={masterData.handleAddLocation}
              onUpdateLocation={masterData.handleUpdateLocation}
              onDeleteLocation={masterData.handleDeleteLocation}
              onToggleLocationActive={masterData.handleToggleLocationActive}
              onAddEquipmentType={masterData.handleAddEquipmentType}
              onUpdateEquipmentType={masterData.handleUpdateEquipmentType}
              onDeleteEquipmentType={masterData.handleDeleteEquipmentType}
              onToggleEquipmentTypeActive={masterData.handleToggleEquipmentTypeActive}
              onAddChecklistItem={masterData.handleAddChecklistItem}
              onUpdateChecklistItem={masterData.handleUpdateChecklistItem}
              onDeleteChecklistItem={masterData.handleDeleteChecklistItem}
              onToggleChecklistItemActive={masterData.handleToggleChecklistItemActive}
              technicians={masterData.technicians}
              onAddTechnician={masterData.handleAddTechnician}
              onUpdateTechnician={masterData.handleUpdateTechnician}
              onDeleteTechnician={masterData.handleDeleteTechnician}
              onToggleTechnicianActive={masterData.handleToggleTechnicianActive}
              onResetMasterData={masterData.handleResetMasterData}
              activeDatasetId={syncData.activeDatasetId}
              onSwitchDataset={syncData.handleSwitchDataset}
              activeSubTab={masterSubTab}
              onChangeSubTab={setMasterSubTab}
              role={role}
              onViewTimeline={(eqId) => {
                setSelectedTimelineEquipmentId(eqId);
                setTimelineBackTab('master');
                setActiveTab('timeline');
              }}
            />
          )}

          {activeTab === 'schedule' && (
            <ScheduleView
              technicians={masterData.technicians}
              role={role}
              activeDatasetId={syncData.activeDatasetId}
            />
          )}

          {activeTab === 'storage_manager' && (role === 'supervisor' || role === 'system_admin' || role === 'admin') && (
            <StorageManagerView isSupervisor={true} />
          )}

          {activeTab === 'attendance' && (role === 'supervisor' || role === 'system_admin' || role === 'operations_admin' || role === 'admin') && (
            <SupervisorAttendanceView technicians={masterData.technicians} />
          )}

          {activeTab === 'avsec_reports' && (
            <AvsecReportsView
              isSupervisor={role === 'supervisor' || role === 'system_admin' || role === 'admin'}
              isViewerOnly={isUserViewerOnly}
              onOpenCorrectiveWithData={(data) => {
                setPreSelectedCorrectiveData(data);
                setActiveTab('corrective');
              }}
            />
          )}

          {activeTab === 'audit_logs' && (role === 'supervisor' || role === 'system_admin' || role === 'admin') && (
            <AuditLogView isSupervisor={role === 'supervisor' || role === 'system_admin' || role === 'admin'} />
          )}

          {activeTab === 'timeline' && selectedTimelineEquipmentId === null && (
            <EquipmentCatalogView
              equipments={masterData.equipments}
              locations={masterData.locations}
              equipmentTypes={masterData.equipmentTypes}
              preventiveEntries={activePreventiveEntries}
              correctiveReports={activeCorrectiveReports}
              onSelectEquipment={(eqId) => {
                setSelectedTimelineEquipmentId(eqId);
                setTimelineBackTab('timeline');
              }}
              onOpenQrPrint={(eq) => setQrModalEquipment(eq || masterData.equipments[0] || null)}
              onOpenQrScanner={() => setIsQrScannerModalOpen(true)}
            />
          )}

          {activeTab === 'timeline' && selectedTimelineEquipmentId !== null && (
            <EquipmentTimelineView
              equipmentId={selectedTimelineEquipmentId}
              equipment={(masterData.equipments || []).find((e) => e && e.id === selectedTimelineEquipmentId)}
              datasetId={syncData.activeDatasetId}
              isLoggedIn={canEnterOperationalApp}
              currentUserUid={currentUserUid}
              techniciansList={masterData.technicians || []}
              locations={masterData.locations || []}
              equipmentTypes={masterData.equipmentTypes || []}
              role={role}
              preventiveEntries={activePreventiveEntries}
              correctiveReports={activeCorrectiveReports}
              onDeletePreventiveEntry={syncData.handleDeletePreventiveEntry}
              onStartPreventive={(eqId) => {
                setPreSelectedEquipmentId(eqId);
                setActiveTab('preventive');
              }}
              onOpenCorrective={() => {
                setActiveTab('corrective');
              }}
              onBack={() => {
                if (timelineBackTab === 'dashboard') {
                  setActiveTab('dashboard');
                } else {
                  setSelectedTimelineEquipmentId(null);
                }
              }}
            />
          )}

          {activeTab === 'health_diagnostic' && (role === 'supervisor' || role === 'system_admin' || role === 'admin') && (
            <SupervisorHealthModal isFullPage isOpen={true} />
          )}

          {activeTab === 'storage_config' && (role === 'supervisor' || role === 'system_admin' || role === 'admin') && (
            <StorageConfigModal isFullPage isOpen={true} />
          )}

          {activeTab === 'whatsapp_bot' && (role === 'supervisor' || role === 'system_admin' || role === 'admin') && (
            <WhatsAppModal isFullPage isOpen={true} />
          )}

          {activeTab === 'telegram_bot' && (role === 'supervisor' || role === 'system_admin' || role === 'admin') && (
            <TelegramBotModal isFullPage isOpen={true} />
          )}

          {activeTab === 'backup_manager' && (role === 'supervisor' || role === 'system_admin' || role === 'admin') && (
            <BackupManagerModal isFullPage isOpen={true} />
          )}

          {activeTab === 'auto_export' && (role === 'supervisor' || role === 'system_admin' || role === 'admin') && (
            <AutoExportView currentUserProfile={authState.profile} />
          )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Shift On Duty Selection Modal */}
      <ShiftModal
        isOpen={isShiftModalOpen}
        onClose={() => setIsShiftModalOpen(false)}
        technicians={masterData.technicians}
        selectedTechIds={shiftSession.currentSession.technician_ids}
        currentShift={shiftSession.currentSession.shift}
        operationalDate={shiftSession.currentSession.operational_date}
        onSaveShift={shiftSession.handleSaveShift}
        activeDatasetId={syncData.activeDatasetId}
      />

      {/* Supervisor Login Modal */}
      <SupervisorLoginModal
        isOpen={isSupervisorLoginOpen}
        onClose={() => setIsSupervisorLoginOpen(false)}
        onLoginSuccess={() => {
          setActiveTab('dashboard');
        }}
      />

      {/* Telegram Bot Notification Settings Modal */}
      <TelegramBotModal
        isOpen={isTelegramModalOpen}
        onClose={() => setIsTelegramModalOpen(false)}
      />

      {/* WhatsApp Baileys Bot Settings & Connection Modal */}
      <WhatsAppModal
        isOpen={isWhatsAppModalOpen}
        onClose={() => setIsWhatsAppModalOpen(false)}
      />

      {/* Supabase Cloud Connection / Diagnostic Modal */}
      <SupabaseDiagnosticModal
        isOpen={isSupabaseModalOpen}
        onClose={() => {
          setIsSupabaseModalOpen(false);
          // Trigger refresh from cloud and schedule when modal is closed
          syncData.syncFromCloud(undefined, undefined, true);
          shiftSession.refreshSchedule();
        }}
      />

      {/* Attendance Modal (opened on demand from Sidebar — clean single modal) */}
      {isAttendanceModalOpen && (
        <AttendanceScreen
          isModal={true}
          technicians={masterData.technicians}
          currentUserProfile={authState.profile}
          currentUserEmail={authState.user?.email || undefined}
          defaultTechnicianName={
            authState.profile?.display_name ||
            authState.profile?.name ||
            shiftSession.loggedInTechnician?.name ||
            shiftSession.technicianNames?.[0]
          }
          attendanceStatus={resolvedAttendanceStatus}
          scheduledShift={resolvedAttendanceStatus.shift}
          operationalDate={resolvedAttendanceStatus.operationalDate}
          onCompleteAttendance={(record) => {
            setAttendanceSession({
              hasAttended: true,
              isBypassed: false,
              isOffDuty: false,
              record,
            });
            setIsAttendanceModalOpen(false);
            if (record?.attendance_type === 'pulang') {
              handleLogout();
              return;
            }
            if (record?.technician_name) {
              const attendingTech = masterData.technicians?.find(
                (t) => t?.name && t.name.toLowerCase() === record.technician_name?.toLowerCase()
              );
              if (
                attendingTech?.id &&
                (!shiftSession.scheduleAvailable || shiftSession.isScheduleEmpty || shiftSession.resolutionStatus === 'fallback')
              ) {
                shiftSession.handleLoginTechnicianSession([attendingTech.id]);
              }
            }
          }}
          onBypassAttendance={() => {
            setAttendanceSession((prev) => ({
              ...prev,
              isBypassed: true,
            }));
            setIsAttendanceModalOpen(false);
          }}
          onOffDuty={() => {
            setAttendanceSession((prev) => ({
              ...prev,
              isOffDuty: true,
            }));
            setIsAttendanceModalOpen(false);
          }}
          onLogout={() => {
            setIsAttendanceModalOpen(false);
          }}
        />
      )}

      {/* QR Scanner Modal for Technicians */}
      <QrScannerModal
        isOpen={isQrScannerModalOpen}
        onClose={() => setIsQrScannerModalOpen(false)}
        equipments={masterData.equipments}
        locations={masterData.locations}
        equipmentTypes={masterData.equipmentTypes}
        onSelectAction={(action, equipmentId) => {
          setIsQrScannerModalOpen(false);
          if (action === 'timeline' || action === 'trend') {
            setSelectedTimelineEquipmentId(equipmentId);
            setTimelineBackTab('dashboard');
            setActiveTab('timeline');
          } else if (action === 'preventive') {
            setPreSelectedEquipmentId(equipmentId);
            setActiveTab('preventive');
          } else if (action === 'corrective') {
            setActiveTab('corrective');
          }
        }}
      />

      {/* Machine QR Modal (can be opened from print action or machine selection) */}
      {qrModalEquipment && (
        <MachineQrModal
          isOpen={!!qrModalEquipment}
          onClose={() => setQrModalEquipment(null)}
          equipment={qrModalEquipment}
          locations={masterData.locations}
          equipmentTypes={masterData.equipmentTypes}
          allEquipments={masterData.equipments}
        />
      )}

      {/* IDCloudHost Object Storage Modal */}
      <StorageConfigModal
        isOpen={isStorageModalOpen}
        onClose={() => setIsStorageModalOpen(false)}
      />

      {/* Backup & Restore Manager Modal */}
      <BackupManagerModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        currentUserProfile={authState.profile}
      />

      {/* Supervisor Diagnostic Health Modal */}
      <SupervisorHealthModal
        isOpen={isHealthModalOpen}
        onClose={() => setIsHealthModalOpen(false)}
      />
    </div>
  );
}
