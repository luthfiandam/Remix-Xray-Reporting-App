import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Calendar,
  Clock,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  Check,
  ShieldAlert,
  Loader,
  Download,
  Upload,
  Wand2,
  Copy,
  AlertTriangle,
  X,
  FileText,
  Info,
  Trash2,
  RotateCcw,
  Save,
  AlertCircle,
  ChevronDown,
} from 'lucide-react';
import { Technician, Role, AttendanceRecord } from '../types';
import {
  fetchMonthlySchedulesDetailed,
  fetchMonthlyShiftDocsV2,
  saveBatchShiftSchedulesV2,
  deleteMonthlySchedulesV2Batch,
  updateMonthlyScheduleCache,
  invalidateActiveShiftCache,
  ScheduleStatus,
  ShiftAssignmentV2,
  ShiftScheduleV2,
  TechnicianSchedule,
  ON_DUTY_STATUSES,
  ScheduleFetchStatus,
  mapScheduleV2ToTechnicianSchedules,
} from '../services/scheduleService';
import {
  parseScheduleCsv,
  generateScheduleCsv,
  copyPreviousMonthSchedulesPreview,
  generate2On2OffConfigurablePattern,
  applyPatternWithOverrides,
  TechnicianPatternConfig,
  PatternGenerationResult,
  CyclePosition,
  CYCLE_POSITIONS,
  CYCLE_POSITION_LABELS,
  isSupervisorUser,
  getRotationTechnicians,
  formatIndonesianDate,
  INDONESIAN_MONTH_NAMES,
  INDONESIAN_DAY_NAMES,
  CsvParseResult,
} from '../services/scheduleCsvService';
import { getJakartaNow, resolveOperationalContext } from '../services/operationalClock';
import { getOperationalShift } from '../utils/technicianSchedule';
import { getAllAttendanceHistory, fetchAttendanceHistoryFromServer } from '../services/attendanceService';
import { RosterScheduleModal } from './RosterScheduleModal';

interface ScheduleViewProps {
  technicians: Technician[];
  role: Role;
  activeDatasetId: string;
}

const STATUS_OPTIONS: { value: ScheduleStatus; label: string; bg: string; text: string }[] = [
  { value: 'scheduled', label: 'Dinas (Scheduled)', bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-800' },
  { value: 'backup', label: 'Backup', bg: 'bg-blue-50 border-blue-200', text: 'text-blue-800' },
  { value: 'overtime', label: 'Lembur (Overtime)', bg: 'bg-amber-50 border-amber-200', text: 'text-amber-800' },
  { value: 'off', label: 'Libur (Off)', bg: 'bg-slate-50 border-slate-200', text: 'text-slate-600' },
  { value: 'leave', label: 'Cuti (Leave)', bg: 'bg-orange-50 border-orange-200', text: 'text-orange-800' },
  { value: 'sick', label: 'Sakit (Sick)', bg: 'bg-rose-50 border-rose-200', text: 'text-rose-800' },
  { value: 'permission', label: 'Izin (Permission)', bg: 'bg-purple-50 border-purple-200', text: 'text-purple-800' },
];

export const ScheduleView: React.FC<ScheduleViewProps> = ({
  technicians,
  role,
  activeDatasetId,
}) => {
  const canEditSchedule = role === 'supervisor' || role === 'operations_admin' || role === 'system_admin' || role === 'admin';
  const now = getJakartaNow();
  const jktParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const jktYear = parseInt(jktParts.find((p) => p.type === 'year')?.value || String(now.getFullYear()), 10);
  const jktMonth = parseInt(jktParts.find((p) => p.type === 'month')?.value || String(now.getMonth() + 1), 10);

  const [currentYear, setCurrentYear] = useState(jktYear);
  const [currentMonth, setCurrentMonth] = useState(jktMonth); // 1-indexed (1-12)

  // Persistent Server Snapshot vs Client Draft State
  const [firestoreDocs, setFirestoreDocs] = useState<ShiftScheduleV2[]>([]);
  const [draftDocs, setDraftDocs] = useState<ShiftScheduleV2[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const [fetchStatus, setFetchStatus] = useState<ScheduleFetchStatus>('SUCCESS_EMPTY');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [lastLoadedTime, setLastLoadedTime] = useState<string | null>(null);

  // Toolbar & Navigation Safety
  const [isManageDropdownOpen, setIsManageDropdownOpen] = useState(false);
  const [isUnsavedConfirmModalOpen, setIsUnsavedConfirmModalOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<{ year: number; month: number } | null>(null);

  // Active technicians & Rotation technicians (excluding supervisor from shift rotation)
  const activeTechs = technicians.filter((t) => t.active);
  const rotationTechs = getRotationTechnicians(technicians);

  // Editing / Detail Modal State
  const [selectedSlot, setSelectedSlot] = useState<{
    date: string;
    shift: 'PS' | 'M';
    assignments: Record<string, ShiftAssignmentV2>;
  } | null>(null);

  // CSV Import Modal
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [csvParseResult, setCsvParseResult] = useState<CsvParseResult | null>(null);
  const [csvFileName, setCsvFileName] = useState<string>('');

  // Auto Pattern Modal
  const [isPatternModalOpen, setIsPatternModalOpen] = useState(false);
  const [patternStartDate, setPatternStartDate] = useState<string>('');
  const [patternConfigs, setPatternConfigs] = useState<TechnicianPatternConfig[]>([]);
  const [patternResult, setPatternResult] = useState<PatternGenerationResult | null>(null);
  const [preserveManualExceptions, setPreserveManualExceptions] = useState<boolean>(true);

  // Copy Previous Month Modal
  const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);
  const [copyPreview, setCopyPreview] = useState<ShiftScheduleV2[] | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);

  // Clear Month Modal
  const [isClearMonthModalOpen, setIsClearMonthModalOpen] = useState(false);
  const [clearConfirmInput, setClearConfirmInput] = useState('');

  // Roster & Daftar Hadir PDF Modal
  const [isRosterModalOpen, setIsRosterModalOpen] = useState(false);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>(() => getAllAttendanceHistory());

  useEffect(() => {
    fetchAttendanceHistoryFromServer().then((records) => {
      if (records && records.length > 0) {
        setAttendanceRecords(records);
      }
    }).catch(() => {});
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsManageDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Prevent accidental window unload if draft changes exist
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // --- Auto Pattern Handlers (Canonical 4-Cycle Rotation) ---
  const getContinuousRotationConfigs = (targetDateStr: string): TechnicianPatternConfig[] => {
    // Canonical rotation baseline anchor: 2026-10-01
    // [Yoan: 0 (PS), Fariz: 1 (M), Reza: 2 (L1), Zaky: 3 (L2)]
    const anchorDateUtc = Date.UTC(2026, 9, 1); // 2026-10-01 UTC
    const targetParts = targetDateStr.split('-').map((p) => parseInt(p, 10));
    const targetDateUtc = Date.UTC(targetParts[0] || 2026, (targetParts[1] || 10) - 1, targetParts[2] || 1);
    const daysPassed = Math.floor((targetDateUtc - anchorDateUtc) / (1000 * 60 * 60 * 24));

    const canonicalOffsets: Record<string, number> = {
      YOAN: 0,
      FARIZ: 1,
      REZA: 2,
      ZAKY: 3,
    };

    return rotationTechs.map((t, idx) => {
      const nameUpper = t.name.toUpperCase().trim();
      const baseOffset = canonicalOffsets[nameUpper] !== undefined ? canonicalOffsets[nameUpper] : (idx % 4);
      const continuousIndex = ((daysPassed + baseOffset) % 4 + 4) % 4;
      return {
        technicianId: String(t.id),
        technicianName: t.name,
        anchorPosition: CYCLE_POSITIONS[continuousIndex],
      };
    });
  };

  // Fetch Firestore Monthly Data
  const fetchSchedules = async (forceRefetch = false) => {
    setLoading(true);
    try {
      const res = await fetchMonthlySchedulesDetailed(currentYear, currentMonth, activeDatasetId, forceRefetch);
      setFetchStatus(res.status);

      const serverDocs = res.rawV2Docs || [];
      if (serverDocs.length === 0) {
        // Fallback to canonical continuous rotation for this month if no custom saved docs
        const pad = (n: number) => String(n).padStart(2, '0');
        const defaultAnchorDate = `${currentYear}-${pad(currentMonth)}-01`;
        const initialConfigs = getContinuousRotationConfigs(defaultAnchorDate);
        const autoResult = generate2On2OffConfigurablePattern(
          initialConfigs,
          currentYear,
          currentMonth,
          defaultAnchorDate,
          activeDatasetId,
          technicians
        );
        const autoDocs = autoResult?.docs || [];
        setFirestoreDocs(autoDocs);
        setDraftDocs(autoDocs);
      } else {
        setFirestoreDocs(serverDocs);
        setDraftDocs(serverDocs);
      }
      setHasUnsavedChanges(false);

      const formattedTime = getJakartaNow().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      setLastLoadedTime(formattedTime);

      if (res.status === 'INDEX_REQUIRED') {
        setErrorBanner('Konfigurasi index database jadwal belum siap di Firestore. Hubungi administrator.');
      } else if (res.status === 'PERMISSION_DENIED') {
        setErrorBanner('Akun Anda tidak memiliki izin membaca database jadwal.');
      } else if (res.status === 'UNAUTHENTICATED') {
        setErrorBanner('Sesi login telah berakhir. Silakan login kembali.');
      } else if (res.status === 'NETWORK_ERROR') {
        setErrorBanner('Gagal terhubung ke database jadwal. Periksa jaringan.');
      } else if (res.status === 'INVALID_QUERY') {
        setErrorBanner('Query database jadwal tidak valid.');
      } else if (res.status === 'UNKNOWN_ERROR') {
        setErrorBanner('Terjadi kesalahan saat memuat data jadwal.');
      } else {
        setErrorBanner(null);
      }
    } catch (err: any) {
      console.error('[ScheduleView] Error fetching monthly schedules:', err);
      setErrorBanner('Terjadi kesalahan saat memuat jadwal: ' + (err?.message || 'Error'));
    } finally {
      setLoading(false);
    }
  };

  const handleManualRefresh = async () => {
    if (loading || saving) return;
    await fetchSchedules(true);
  };

  useEffect(() => {
    fetchSchedules();
  }, [currentYear, currentMonth, activeDatasetId]);

  // Month Navigation Handlers (Guarded)
  const handlePrevMonth = () => {
    const nextMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const nextYear = currentMonth === 1 ? currentYear - 1 : currentYear;
    if (hasUnsavedChanges) {
      setPendingNavigation({ year: nextYear, month: nextMonth });
      setIsUnsavedConfirmModalOpen(true);
    } else {
      setCurrentMonth(nextMonth);
      setCurrentYear(nextYear);
    }
  };

  const handleNextMonth = () => {
    const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
    const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
    if (hasUnsavedChanges) {
      setPendingNavigation({ year: nextYear, month: nextMonth });
      setIsUnsavedConfirmModalOpen(true);
    } else {
      setCurrentMonth(nextMonth);
      setCurrentYear(nextYear);
    }
  };

  const confirmDiscardAndNavigate = () => {
    if (pendingNavigation) {
      setCurrentYear(pendingNavigation.year);
      setCurrentMonth(pendingNavigation.month);
      setPendingNavigation(null);
    }
    setHasUnsavedChanges(false);
    setIsUnsavedConfirmModalOpen(false);
  };

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month, 0).getDate();
  };

  const getFirstDayOfWeek = (year: number, month: number) => {
    return new Date(year, month - 1, 1).getDay();
  };

  const totalDays = getDaysInMonth(currentYear, currentMonth);
  const firstDayIndex = getFirstDayOfWeek(currentYear, currentMonth);

  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  const daysOfWeek = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

  // Helper to find draft doc for a slot
  const getSlotDoc = (day: number, shiftCode: 'PS' | 'M'): ShiftScheduleV2 | undefined => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${currentYear}-${pad(currentMonth)}-${pad(day)}`;
    return draftDocs.find((d) => d.schedule_date === dateStr && d.shift === shiftCode);
  };

  const getSlotOnDutyTechnicians = (day: number, shiftCode: 'PS' | 'M') => {
    const doc = getSlotDoc(day, shiftCode);
    if (!doc?.assignments) return [];

    const onDuty: { techId: string; name: string; status: ScheduleStatus }[] = [];
    (Object.entries(doc.assignments) as [string, ShiftAssignmentV2][]).forEach(([techId, assign]) => {
      if (ON_DUTY_STATUSES.includes(assign.status as ScheduleStatus)) {
        const techObj = activeTechs.find((t) => String(t.id) === techId);
        onDuty.push({
          techId,
          name: techObj?.name || assign.technician_name || `Tech ${techId}`,
          status: assign.status as ScheduleStatus,
        });
      }
    });
    return onDuty;
  };

  // Slot Click -> Opens Editor (Supervisor) or Detail (Technician)
  const handleSlotClick = (day: number, shiftCode: 'PS' | 'M') => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${currentYear}-${pad(currentMonth)}-${pad(day)}`;
    const existingDoc = getSlotDoc(day, shiftCode);

    const assignments: Record<string, ShiftAssignmentV2> = {};

    activeTechs.forEach((t) => {
      const techIdStr = String(t.id);
      if (existingDoc?.assignments?.[techIdStr]) {
        assignments[techIdStr] = { ...existingDoc.assignments[techIdStr] };
      } else {
        assignments[techIdStr] = {
          technician_name: t.name,
          status: 'off',
        };
      }
    });

    setSelectedSlot({ date: dateStr, shift: shiftCode, assignments });
  };

  // Slot Assignment Toggle in modal
  const handleToggleAssignment = (techId: string, checked: boolean) => {
    if (!selectedSlot || !canEditSchedule) return;
    const tech = activeTechs.find((t) => String(t.id) === techId);
    setSelectedSlot({
      ...selectedSlot,
      assignments: {
        ...selectedSlot.assignments,
        [techId]: {
          technician_name: tech?.name || `Tech ${techId}`,
          status: checked ? 'scheduled' : 'off',
        },
      },
    });
  };

  // Status dropdown change in modal
  const handleStatusChange = (techId: string, status: ScheduleStatus) => {
    if (!selectedSlot || !canEditSchedule) return;
    const tech = activeTechs.find((t) => String(t.id) === techId);
    setSelectedSlot({
      ...selectedSlot,
      assignments: {
        ...selectedSlot.assignments,
        [techId]: {
          technician_name: tech?.name || `Tech ${techId}`,
          status,
        },
      },
    });
  };

  // Apply Slot Changes to Client Draft ONLY
  const handleApplySlotToDraft = () => {
    if (!selectedSlot || !canEditSchedule) return;

    const existingIdx = draftDocs.findIndex(
      (d) => d.schedule_date === selectedSlot.date && d.shift === selectedSlot.shift
    );

    const updatedDoc: ShiftScheduleV2 = {
      dataset_id: activeDatasetId,
      schedule_date: selectedSlot.date,
      shift: selectedSlot.shift,
      assignments: selectedSlot.assignments,
      schema_version: 2,
    };

    let nextDraft: ShiftScheduleV2[];
    if (existingIdx >= 0) {
      nextDraft = [...draftDocs];
      nextDraft[existingIdx] = updatedDoc;
    } else {
      nextDraft = [...draftDocs, updatedDoc];
    }

    setDraftDocs(nextDraft);
    setHasUnsavedChanges(true);
    setSelectedSlot(null);
    setSuccessMsg(`Perubahan shift ${selectedSlot.shift} tanggal ${selectedSlot.date} diterapkan ke draft (belum disimpan).`);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  // Discard All Draft Changes
  const handleDiscardChanges = () => {
    setDraftDocs([...firestoreDocs]);
    setHasUnsavedChanges(false);
    setSuccessMsg('Perubahan draft dibatalkan. Kalender dikembalikan ke data server.');
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  // Helper to identify dirty (modified or added) shift documents compared to server baseline
  const getDirtyShiftDocs = (
    baseline: ShiftScheduleV2[],
    drafts: ShiftScheduleV2[]
  ): ShiftScheduleV2[] => {
    const dirty: ShiftScheduleV2[] = [];
    const baseMap = new Map<string, ShiftScheduleV2>();
    baseline.forEach((doc) => baseMap.set(`${doc.schedule_date}_${doc.shift}`, doc));

    drafts.forEach((draftDoc) => {
      const key = `${draftDoc.schedule_date}_${draftDoc.shift}`;
      const baseDoc = baseMap.get(key);

      if (!baseDoc) {
        dirty.push(draftDoc);
      } else {
        const baseJson = JSON.stringify(baseDoc.assignments || {});
        const draftJson = JSON.stringify(draftDoc.assignments || {});
        if (baseJson !== draftJson) {
          dirty.push(draftDoc);
        }
      }
    });

    return dirty;
  };

  // Save All Draft Changes to Firestore (Targeted Dirty Writes)
  const handleSaveAllChanges = async () => {
    if (!canEditSchedule || !hasUnsavedChanges) return;

    const dirtyShifts = getDirtyShiftDocs(firestoreDocs, draftDocs);
    if (dirtyShifts.length === 0) {
      setHasUnsavedChanges(false);
      setSuccessMsg('Tidak ada perubahan jadwal yang perlu disimpan.');
      setTimeout(() => setSuccessMsg(null), 3000);
      return;
    }

    setSaving(true);
    try {
      const shiftsToSave = dirtyShifts.map((d) => ({
        schedule_date: d.schedule_date,
        shift: d.shift,
        assignments: d.assignments,
      }));

      const res = await saveBatchShiftSchedulesV2(activeDatasetId, shiftsToSave);

      // Merge saved dirtyShifts into baseline firestoreDocs
      const newBaseMap = new Map<string, ShiftScheduleV2>();
      firestoreDocs.forEach((d) => newBaseMap.set(`${d.schedule_date}_${d.shift}`, d));
      dirtyShifts.forEach((d) => newBaseMap.set(`${d.schedule_date}_${d.shift}`, d));
      const updatedBaseline = Array.from(newBaseMap.values());

      setFirestoreDocs(updatedBaseline);
      setDraftDocs(updatedBaseline);
      setHasUnsavedChanges(false);

      // Update in-memory monthly cache directly without full-month Firestore re-fetch
      updateMonthlyScheduleCache(activeDatasetId, currentYear, currentMonth, updatedBaseline);

      // Check if current operational shift document was saved -> invalidate active shift context
      const opShift = getOperationalShift(getJakartaNow());
      const isActiveShiftSaved = dirtyShifts.some(
        (d) => d.schedule_date === opShift.operationalDate && d.shift === opShift.shiftCode
      );
      if (isActiveShiftSaved) {
        invalidateActiveShiftCache();
      }

      setSuccessMsg(`Berhasil menyimpan ${res.savedCount} dokumen jadwal ke database!`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      console.error('[ScheduleView] Error saving dirty schedules to Firestore:', err);
      setErrorBanner('Gagal menyimpan jadwal: ' + (err?.message || 'Terjadi kesalahan'));
    } finally {
      setSaving(false);
    }
  };

  // --- CSV Handlers ---
  const handleDownloadCsv = (type: 'template' | 'exported') => {
    const csvStr = generateScheduleCsv(
      technicians,
      currentYear,
      currentMonth,
      type === 'exported' ? draftDocs : []
    );
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const monthStr = String(currentMonth).padStart(2, '0');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      type === 'exported'
        ? `Jadwal_Teknisi_${currentYear}_${monthStr}.csv`
        : `Template_Jadwal_Teknisi_${currentYear}_${monthStr}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setIsManageDropdownOpen(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const parseResult = parseScheduleCsv(
          content,
          activeTechs,
          currentYear,
          currentMonth,
          draftDocs
        );
        setCsvParseResult(parseResult);
      }
    };
    reader.readAsText(file);
  };

  // Apply CSV to Client Draft ONLY
  const handleApplyCsvToDraft = () => {
    if (!csvParseResult || !csvParseResult.valid || !canEditSchedule) return;

    // Merge CSV rows into draftDocs
    const newDraftMap = new Map<string, ShiftScheduleV2>();
    draftDocs.forEach((d) => newDraftMap.set(`${d.schedule_date}_${d.shift}`, d));

    csvParseResult.rows.forEach((row) => {
      const key = `${row.schedule_date}_${row.shift}`;
      newDraftMap.set(key, {
        dataset_id: activeDatasetId,
        schedule_date: row.schedule_date,
        shift: row.shift,
        assignments: row.assignments,
        schema_version: 2,
      });
    });

    const nextDraft = Array.from(newDraftMap.values());
    setDraftDocs(nextDraft);
    setHasUnsavedChanges(true);
    setIsCsvModalOpen(false);
    setCsvParseResult(null);
    setCsvFileName('');
    setSuccessMsg(`Jadwal dari CSV (${csvParseResult.rows.length} shift) diterapkan ke draft (belum disimpan).`);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const handleOpenPatternModal = () => {
    setIsManageDropdownOpen(false);
    const pad = (n: number) => String(n).padStart(2, '0');
    const defaultAnchorDate = `${currentYear}-${pad(currentMonth)}-01`;
    setPatternStartDate(defaultAnchorDate);

    // Initialize with continuous rotation from 2026-09-01 anchor
    const initialConfigs = getContinuousRotationConfigs(defaultAnchorDate);

    setPatternConfigs(initialConfigs);
    const result = generate2On2OffConfigurablePattern(
      initialConfigs,
      currentYear,
      currentMonth,
      defaultAnchorDate,
      activeDatasetId,
      technicians
    );
    setPatternResult(result);
    setIsPatternModalOpen(true);
  };

  const handleUpdatePatternConfig = (
    techId: string,
    anchorPosition: CyclePosition
  ) => {
    const nextConfigs = patternConfigs.map((c) => {
      if (c.technicianId === techId) {
        return {
          ...c,
          anchorPosition,
        };
      }
      return c;
    });
    setPatternConfigs(nextConfigs);
    const result = generate2On2OffConfigurablePattern(
      nextConfigs,
      currentYear,
      currentMonth,
      patternStartDate,
      activeDatasetId,
      technicians
    );
    setPatternResult(result);
  };

  const handleApplyPreset4Techs = () => {
    const presetConfigs = getContinuousRotationConfigs(patternStartDate);
    setPatternConfigs(presetConfigs);
    const result = generate2On2OffConfigurablePattern(
      presetConfigs,
      currentYear,
      currentMonth,
      patternStartDate,
      activeDatasetId,
      technicians
    );
    setPatternResult(result);
  };

  const handleStartDateChange = (newDateStr: string) => {
    setPatternStartDate(newDateStr);
    const result = generate2On2OffConfigurablePattern(
      patternConfigs,
      currentYear,
      currentMonth,
      newDateStr,
      activeDatasetId,
      technicians
    );
    setPatternResult(result);
  };

  // Apply Auto Pattern to Client Draft ONLY
  const handleApplyPatternToDraft = () => {
    if (!patternResult || !patternResult.valid || !canEditSchedule) return;

    const baseDocs = draftDocs.length > 0 ? draftDocs : firestoreDocs;
    const finalDocs = preserveManualExceptions
      ? applyPatternWithOverrides(baseDocs, patternResult.docs, true)
      : patternResult.docs;

    setDraftDocs(finalDocs);
    setHasUnsavedChanges(true);
    setIsPatternModalOpen(false);
    setPatternResult(null);
    setSuccessMsg(`Pola rotasi teknisi (${finalDocs.length} shift) diterapkan ke draft (belum disimpan).`);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  // --- Copy Previous Month Handlers ---
  const handleOpenCopyModal = async () => {
    setIsManageDropdownOpen(false);
    setIsCopyModalOpen(true);
    setCopyLoading(true);
    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    try {
      const prevResult = await fetchMonthlyShiftDocsV2(prevYear, prevMonth, activeDatasetId);
      if (prevResult.docs.length === 0) {
        setErrorBanner(`Bulan sebelumnya (${monthNames[prevMonth - 1]} ${prevYear}) belum memiliki data jadwal di database.`);
        setIsCopyModalOpen(false);
        return;
      }
      const preview = copyPreviousMonthSchedulesPreview(
        prevResult.docs,
        currentYear,
        currentMonth,
        technicians,
        activeDatasetId
      );
      setCopyPreview(preview);
    } catch (err: any) {
      console.error('[ScheduleView] Error preparing copy prev month:', err);
      setErrorBanner('Gagal memuat jadwal bulan sebelumnya.');
      setIsCopyModalOpen(false);
    } finally {
      setCopyLoading(false);
    }
  };

  // Apply Copy Prev Month to Client Draft ONLY
  const handleApplyCopyToDraft = () => {
    if (!copyPreview || !canEditSchedule) return;

    setDraftDocs(copyPreview);
    setHasUnsavedChanges(true);
    setIsCopyModalOpen(false);
    setCopyPreview(null);
    setSuccessMsg(`Jadwal bulan sebelumnya (${copyPreview.length} shift) disalin ke draft (belum disimpan).`);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  // --- Clear Month Handler (Batched Delete from Firestore) ---
  const expectedClearPhrase = `HAPUS ${monthNames[currentMonth - 1].toUpperCase()} ${currentYear}`;
  const isClearPhraseMatched = clearConfirmInput.trim() === expectedClearPhrase;

  const handleOpenClearMonthModal = () => {
    setIsManageDropdownOpen(false);
    setClearConfirmInput('');
    setIsClearMonthModalOpen(true);
  };

  const handleConfirmClearMonth = async () => {
    if (!isClearPhraseMatched || !canEditSchedule) return;
    setDeleting(true);
    try {
      const res = await deleteMonthlySchedulesV2Batch(
        currentYear,
        currentMonth,
        activeDatasetId
      );
      setIsClearMonthModalOpen(false);
      setClearConfirmInput('');
      setSuccessMsg(`Berhasil mengosongkan jadwal bulan ${monthNames[currentMonth - 1]} ${currentYear} (${res.deletedCount} dokumen dihapus).`);
      await fetchSchedules();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      console.error('[ScheduleView] Error clearing monthly schedule:', err);
      setErrorBanner('Gagal mengosongkan jadwal: ' + (err?.message || 'Terjadi kesalahan'));
      setIsClearMonthModalOpen(false);
      setClearConfirmInput('');
      // Refetch current server data to ensure UI retains actual server state
      await fetchSchedules();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4" id="schedule-view-root">
      {/* Header and Controls */}
      <div className="bg-white p-4 rounded-lg border border-slate-200 flex flex-col xl:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 border border-blue-100 flex items-center justify-center">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-slate-900">Jadwal Shift Bulanan</h1>
              {hasUnsavedChanges && (
                <span className="px-2 py-0.5 bg-amber-100 border border-amber-300 text-amber-900 rounded-full text-[10px] font-extrabold flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 text-amber-700" />
                  Perubahan belum disimpan
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {canEditSchedule
                ? 'Admin / Supervisor Workspace: Atur penugasan teknisi (Draft mode dengan konfirmasi simpan)'
                : 'Workspace Teknisi: Lihat jadwal kerja bulanan Anda'}
            </p>
          </div>
        </div>

        {/* Month Selector and Action Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Month Switcher */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              id="btn-prev-month"
              onClick={handlePrevMonth}
              className="p-1 hover:bg-white rounded-md transition-all text-slate-600 hover:text-slate-900 cursor-pointer"
              title="Bulan Sebelumnya"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-bold text-slate-800 px-3 min-w-[130px] text-center select-none">
              {monthNames[currentMonth - 1]} {currentYear}
            </span>
            <button
              id="btn-next-month"
              onClick={handleNextMonth}
              className="p-1 hover:bg-white rounded-md transition-all text-slate-600 hover:text-slate-900 cursor-pointer"
              title="Bulan Berikutnya"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Manual Refresh Schedule */}
          <button
            id="btn-manual-refresh-schedule"
            disabled={loading || saving}
            onClick={handleManualRefresh}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
              loading
                ? 'bg-slate-100 border border-slate-200 text-slate-400 cursor-not-allowed'
                : 'bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 cursor-pointer shadow-xs'
            }`}
            title="Muat Ulang Jadwal langsung dari database Firestore (Bypass Cache)"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Muat Ulang Jadwal</span>
          </button>

          {lastLoadedTime && (
            <span className="text-[11px] text-slate-400 select-none hidden md:inline">
              Dimuat: {lastLoadedTime}
            </span>
          )}

          {/* Admin & Supervisor Action Toolbar */}
          {canEditSchedule && (
            <div className="flex items-center gap-2 flex-wrap">
              {/* Primary Actions: Batalkan & Simpan (Active only when draft is dirty) */}
              <button
                id="btn-discard-changes"
                disabled={!hasUnsavedChanges || saving}
                onClick={handleDiscardChanges}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                  hasUnsavedChanges
                    ? 'bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 cursor-pointer shadow-xs'
                    : 'bg-slate-50 border border-slate-200 text-slate-300 cursor-not-allowed opacity-60'
                }`}
                title="Batalkan semua perubahan draft dan kembalikan ke data server"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Batalkan Perubahan</span>
              </button>

              <button
                id="btn-save-all-changes"
                disabled={!hasUnsavedChanges || saving}
                onClick={handleSaveAllChanges}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                  hasUnsavedChanges
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-xs'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-60'
                }`}
                title="Simpan semua perubahan draft ke database Firestore"
              >
                {saving ? (
                  <>
                    <Loader className="w-3.5 h-3.5 animate-spin" />
                    <span>Menyimpan...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>Simpan Semua Perubahan</span>
                  </>
                )}
              </button>

              {/* "Daftar Hadir & Roster PDF" Direct Button */}
              <button
                id="btn-open-roster-pdf-modal"
                onClick={() => setIsRosterModalOpen(true)}
                className="px-3 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                title="Buka Format Roster Matriks & Cetak Dokumen PDF Resmi OM NTI"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Roster & Daftar Hadir PDF</span>
              </button>

              {/* "Kelola Jadwal" Dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button
                  id="btn-manage-schedule-dropdown"
                  onClick={() => setIsManageDropdownOpen(!isManageDropdownOpen)}
                  className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Menu Pengelolaan Jadwal Bulanan"
                >
                  <span>Kelola Jadwal</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isManageDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence>
                  {isManageDropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.94, y: -8 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.94, y: -8 }}
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute right-0 mt-1.5 w-60 bg-white rounded-lg border border-slate-200 shadow-xl py-1.5 z-40 text-xs origin-top-right"
                    >
                      <button
                        id="dropdown-item-roster-preview"
                        onClick={() => {
                          setIsManageDropdownOpen(false);
                          setIsRosterModalOpen(true);
                        }}
                        className="w-full text-left px-3 py-2 text-cyan-800 hover:bg-cyan-50 flex items-center gap-2.5 transition-colors cursor-pointer font-bold border-b border-slate-100"
                      >
                        <FileText className="w-4 h-4 text-cyan-600 shrink-0" />
                        <div>
                          <div>Cetak Daftar Hadir (PDF 3 Halaman)</div>
                          <div className="text-[10px] text-cyan-600/80 font-normal">Sesuai Format Resmi OM NTI</div>
                        </div>
                      </button>
                      <button
                        id="dropdown-item-auto-pattern"
                        onClick={handleOpenPatternModal}
                        className="w-full text-left px-3 py-2 text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 flex items-center gap-2.5 transition-colors cursor-pointer font-medium"
                      >
                        <Wand2 className="w-4 h-4 text-indigo-600 shrink-0" />
                        <div>
                          <div className="font-semibold">Pola Otomatis</div>
                          <div className="text-[10px] text-slate-400">Rotasi 2-Kerja 2-Libur</div>
                        </div>
                      </button>

                      <button
                        id="dropdown-item-copy-prev"
                        onClick={handleOpenCopyModal}
                        className="w-full text-left px-3 py-2 text-slate-700 hover:bg-blue-50 hover:text-blue-700 flex items-center gap-2.5 transition-colors cursor-pointer font-medium"
                      >
                        <Copy className="w-4 h-4 text-blue-600 shrink-0" />
                        <div>
                          <div className="font-semibold">Salin Bulan Lalu</div>
                          <div className="text-[10px] text-slate-400">Duplikasi jadwal bulan lalu</div>
                        </div>
                      </button>

                      <button
                        id="dropdown-item-import-csv"
                        onClick={() => {
                          setIsManageDropdownOpen(false);
                          setIsCsvModalOpen(true);
                        }}
                        className="w-full text-left px-3 py-2 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 flex items-center gap-2.5 transition-colors cursor-pointer font-medium"
                      >
                        <Upload className="w-4 h-4 text-emerald-600 shrink-0" />
                        <div>
                          <div className="font-semibold">Import CSV</div>
                          <div className="text-[10px] text-slate-400">Unggah dari spreadsheet CSV</div>
                        </div>
                      </button>

                      <button
                        id="dropdown-item-export-csv"
                        onClick={() => handleDownloadCsv('exported')}
                        className="w-full text-left px-3 py-2 text-slate-700 hover:bg-slate-100 flex items-center gap-2.5 transition-colors cursor-pointer font-medium"
                      >
                        <Download className="w-4 h-4 text-slate-600 shrink-0" />
                        <div>
                          <div className="font-semibold">Export CSV</div>
                          <div className="text-[10px] text-slate-400">Unduh jadwal bulan ini</div>
                        </div>
                      </button>

                      <div className="my-1 border-t border-slate-100" />

                      <button
                        id="dropdown-item-clear-month"
                        onClick={handleOpenClearMonthModal}
                        className="w-full text-left px-3 py-2 text-rose-600 hover:bg-rose-50 flex items-center gap-2.5 transition-colors cursor-pointer font-medium"
                      >
                        <Trash2 className="w-4 h-4 text-rose-600 shrink-0" />
                        <div>
                          <div className="font-semibold">Kosongkan Bulan Ini</div>
                          <div className="text-[10px] text-rose-400">Hapus semua jadwal bulan aktif</div>
                        </div>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Success Notification Banner */}
      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3.5 py-2.5 flex items-center gap-2.5 text-xs font-bold animate-in fade-in duration-150">
          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Error / Warning Banner */}
      {errorBanner && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-lg px-3.5 py-2.5 flex items-center justify-between text-xs font-bold animate-in fade-in duration-150">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <button
            onClick={() => setErrorBanner(null)}
            className="text-rose-600 hover:text-rose-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Calendar Grid */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
        <div className="min-w-[650px]">
          {/* Days of Week Headers */}
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center py-2 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
            {daysOfWeek.map((day) => (
              <div key={day}>{day}</div>
            ))}
          </div>

          {loading ? (
            <div className="h-96 flex flex-col items-center justify-center gap-3 text-slate-400">
              <Loader className="w-8 h-8 animate-spin text-blue-500" />
              <p className="text-xs font-bold">Mengambil data jadwal...</p>
            </div>
          ) : (
            <div className="grid grid-cols-7 divide-x divide-y divide-slate-100">
              {/* Empty leading cells */}
              {Array.from({ length: firstDayIndex }).map((_, index) => (
                <div key={`empty-${index}`} className="bg-slate-50/40 min-h-[110px] p-2" />
              ))}

            {/* Actual Month Days */}
            {Array.from({ length: totalDays }).map((_, index) => {
              const day = index + 1;
              const pad = (n: number) => String(n).padStart(2, '0');
              const dateStr = `${currentYear}-${pad(currentMonth)}-${pad(day)}`;
              const isToday = resolveOperationalContext().calendar_date === dateStr;

              const onDutyPagi = getSlotOnDutyTechnicians(day, 'PS');
              const onDutyMalam = getSlotOnDutyTechnicians(day, 'M');

              const pagiNames = onDutyPagi.map((t) => t.name);
              const malamNames = onDutyMalam.map((t) => t.name);

              const pagiDisplay =
                pagiNames.length > 2
                  ? `${pagiNames.slice(0, 2).join(', ')} +${pagiNames.length - 2}`
                  : pagiNames.join(', ');

              const malamDisplay =
                malamNames.length > 2
                  ? `${malamNames.slice(0, 2).join(', ')} +${malamNames.length - 2}`
                  : malamNames.join(', ');

              const isPagiEmpty = onDutyPagi.length === 0;
              const isMalamEmpty = onDutyMalam.length === 0;

              return (
                <div
                  key={`day-${day}`}
                  className={`min-h-[110px] p-2 flex flex-col justify-between transition-colors hover:bg-slate-50/50 ${
                    isToday ? 'bg-blue-50/20 ring-1 ring-blue-500/20' : 'bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-extrabold w-5 h-5 rounded-full flex items-center justify-center ${
                        isToday ? 'bg-blue-600 text-white' : 'text-slate-700'
                      }`}
                    >
                      {day}
                    </span>
                  </div>

                  <div className="space-y-1.5 mt-2">
                    {/* Shift Pagi (PS) */}
                    <div
                      id={`slot-${day}-PS`}
                      onClick={() => handleSlotClick(day, 'PS')}
                      className={`p-1.5 rounded text-[9px] flex flex-col gap-0.5 transition-all cursor-pointer ${
                        !isPagiEmpty
                          ? 'bg-blue-50 text-blue-900 border border-blue-200 font-semibold hover:bg-blue-100/70 hover:border-blue-300'
                          : 'bg-slate-50 text-slate-400 border border-slate-200/50 font-medium italic hover:bg-slate-100'
                      }`}
                      title={!isPagiEmpty ? `PS: ${pagiNames.join(', ')}` : 'Shift PS belum diatur'}
                    >
                      <div className="flex items-center gap-1 overflow-hidden truncate">
                        <Clock className="w-2.5 h-2.5 shrink-0 text-blue-600" />
                        <span className="font-bold text-blue-700">PS:</span>
                        <span className="truncate">
                          {!isPagiEmpty ? pagiDisplay : 'Belum diatur'}
                        </span>
                      </div>
                    </div>

                    {/* Shift Malam (M) */}
                    <div
                      id={`slot-${day}-M`}
                      onClick={() => handleSlotClick(day, 'M')}
                      className={`p-1.5 rounded text-[9px] flex flex-col gap-0.5 transition-all cursor-pointer ${
                        !isMalamEmpty
                          ? 'bg-purple-50 text-purple-900 border border-purple-200 font-semibold hover:bg-purple-100/70 hover:border-purple-300'
                          : 'bg-slate-50 text-slate-400 border border-slate-200/50 font-medium italic hover:bg-slate-100'
                      }`}
                      title={!isMalamEmpty ? `M: ${malamNames.join(', ')}` : 'Shift M belum diatur'}
                    >
                      <div className="flex items-center gap-1 overflow-hidden truncate">
                        <Clock className="w-2.5 h-2.5 shrink-0 text-purple-600" />
                        <span className="font-bold text-purple-700">M:</span>
                        <span className="truncate">
                          {!isMalamEmpty ? malamDisplay : 'Belum diatur'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>

      {/* Role Warnings for Technician */}
      {!canEditSchedule && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3.5 flex items-start gap-2.5 text-xs leading-relaxed">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold mb-0.5 text-slate-800">Mode Read-Only Aktif</p>
            <p className="text-slate-600 font-medium">
              Akun teknisi dapat melihat jadwal lengkap dengan mengklik kotak shift di atas. Pengaturan dan perubahan jadwal hanya dapat dilakukan oleh akun berwenang (<strong>Administrator / Supervisor</strong>).
            </p>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. SLOT DETAIL / ASSIGNMENT MODAL (Supervisor Draft Edit & Read-Only)     */}
      {/* ========================================================================= */}
      {selectedSlot && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-md w-full border border-slate-200 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <UserCheck className="w-4 h-4 text-blue-600" />
                <div>
                  <h3 className="text-xs font-bold text-slate-900">
                    {canEditSchedule ? 'Atur Personel Shift (Draft)' : 'Detail Penugasan Shift'}
                  </h3>
                  <p className="text-[10px] text-slate-500">
                    Tanggal: {selectedSlot.date} | Shift: {selectedSlot.shift === 'PS' ? 'Pagi (PS)' : 'Malam (M)'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedSlot(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <p className="text-xs text-slate-600 font-medium">
                {canEditSchedule
                  ? 'Tentukan status penugasan masing-masing teknisi untuk shift ini (akan disimpan ke draft):'
                  : 'Daftar status penugasan personel pada shift ini:'}
              </p>

              <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                {activeTechs.map((tech) => {
                  const currentAssignment = selectedSlot.assignments[String(tech.id)];
                  const currentStatus = currentAssignment?.status || 'off';
                  const isAssigned = ON_DUTY_STATUSES.includes(currentStatus);

                  return (
                    <div
                      key={tech.id}
                      className={`flex items-center justify-between p-2.5 rounded-lg border transition-all ${
                        isAssigned
                          ? 'bg-blue-50/40 border-blue-200'
                          : 'bg-slate-50/40 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        {canEditSchedule && (
                          <input
                            type="checkbox"
                            checked={isAssigned}
                            onChange={(e) => handleToggleAssignment(String(tech.id), e.target.checked)}
                            className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                          />
                        )}
                        <div>
                          <p className="text-xs font-bold text-slate-800">{tech.name}</p>
                          <p className="text-[10px] text-slate-400 font-mono">Kode: {tech.code}</p>
                        </div>
                      </div>

                      {canEditSchedule ? (
                        <select
                          value={currentStatus}
                          onChange={(e) =>
                            handleStatusChange(String(tech.id), e.target.value as ScheduleStatus)
                          }
                          className="text-xs font-semibold px-2 py-1 bg-white border border-slate-300 rounded-md text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                        >
                          {STATUS_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                            STATUS_OPTIONS.find((o) => o.value === currentStatus)?.bg || 'bg-slate-50'
                          } ${
                            STATUS_OPTIONS.find((o) => o.value === currentStatus)?.text || 'text-slate-600'
                          }`}
                        >
                          {STATUS_OPTIONS.find((o) => o.value === currentStatus)?.label || currentStatus}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setSelectedSlot(null)}
                className="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
              >
                {canEditSchedule ? 'Batal' : 'Tutup'}
              </button>
              {canEditSchedule && (
                <button
                  id="btn-apply-slot-draft"
                  onClick={handleApplySlotToDraft}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs font-bold text-white transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Terapkan ke Draft</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. CSV IMPORT & PREVIEW MODAL                                             */}
      {/* ========================================================================= */}
      {isCsvModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <Upload className="w-4 h-4 text-blue-600" />
                <div>
                  <h3 className="text-xs font-bold text-slate-900">Import Jadwal CSV (Draft)</h3>
                  <p className="text-[10px] text-slate-500">
                    Bulan Aktif: {monthNames[currentMonth - 1]} {currentYear}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsCsvModalOpen(false);
                  setCsvParseResult(null);
                  setCsvFileName('');
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* Template Download Prompt */}
              <div className="bg-blue-50/60 border border-blue-200 rounded-lg p-3 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-blue-900">
                  <Info className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>Belum punya template CSV untuk bulan ini?</span>
                </div>
                <button
                  onClick={() => handleDownloadCsv('template')}
                  className="px-2.5 py-1 bg-white hover:bg-blue-50 border border-blue-200 text-blue-700 font-bold rounded text-[11px] flex items-center gap-1 cursor-pointer"
                >
                  <Download className="w-3 h-3" />
                  <span>Unduh Template</span>
                </button>
              </div>

              {/* Upload Drop Area */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-lg p-6 text-center cursor-pointer transition-colors bg-slate-50/50 hover:bg-blue-50/20"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <FileText className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-xs font-bold text-slate-700">
                  {csvFileName ? `File terpilih: ${csvFileName}` : 'Klik atau seret file CSV ke sini'}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">Mendukung file .csv standar UTF-8</p>
              </div>

              {/* Parsing Results and Validation Preview */}
              {csvParseResult && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-900">Hasil Validasi File CSV:</h4>
                    <span
                      className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                        csvParseResult.valid
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {csvParseResult.valid ? 'VALID SIAP DITERAPKAN' : 'DITEMUKAN KESALAHAN'}
                    </span>
                  </div>

                  {/* Summary Metric Badges */}
                  <div className="grid grid-cols-4 gap-2 text-center text-[11px]">
                    <div className="bg-slate-100 border border-slate-200 rounded p-2">
                      <p className="text-[10px] text-slate-500 font-medium">Total Baris</p>
                      <p className="text-sm font-extrabold text-slate-800">{csvParseResult.summary.totalRows}</p>
                    </div>
                    <div className="bg-emerald-50 border border-emerald-200 rounded p-2">
                      <p className="text-[10px] text-emerald-600 font-medium">Baru (Created)</p>
                      <p className="text-sm font-extrabold text-emerald-800">{csvParseResult.summary.createdCount}</p>
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded p-2">
                      <p className="text-[10px] text-blue-600 font-medium">Diubah (Updated)</p>
                      <p className="text-sm font-extrabold text-blue-800">{csvParseResult.summary.updatedCount}</p>
                    </div>
                    <div className="bg-rose-50 border border-rose-200 rounded p-2">
                      <p className="text-[10px] text-rose-600 font-medium">Error Validasi</p>
                      <p className="text-sm font-extrabold text-rose-800">{csvParseResult.summary.errorCount}</p>
                    </div>
                  </div>

                  {/* Errors List */}
                  {csvParseResult.allErrors.length > 0 && (
                    <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 space-y-1">
                      <p className="text-xs font-bold text-rose-900 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                        Perbaiki kesalahan berikut sebelum menerapkan ke draft:
                      </p>
                      <ul className="list-disc list-inside text-[11px] text-rose-800 space-y-0.5 max-h-36 overflow-y-auto">
                        {csvParseResult.allErrors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Preview Table */}
                  {csvParseResult.valid && (
                    <div className="border border-slate-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto text-[11px]">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold sticky top-0">
                          <tr>
                            <th className="p-2">Tanggal</th>
                            <th className="p-2">Shift</th>
                            <th className="p-2">Personel On-Duty</th>
                            <th className="p-2">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {csvParseResult.rows.map((r, i) => {
                            const onDuty = (Object.values(r.assignments) as ShiftAssignmentV2[])
                              .filter((a) => ON_DUTY_STATUSES.includes(a.status as ScheduleStatus))
                              .map((a) => a.technician_name);

                            return (
                              <tr key={i} className="hover:bg-slate-50/50">
                                <td className="p-2 font-mono">{r.schedule_date}</td>
                                <td className="p-2 font-bold">{r.shift}</td>
                                <td className="p-2 text-slate-700">{onDuty.join(', ')}</td>
                                <td className="p-2">
                                  <span
                                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                      r.actionType === 'created'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : r.actionType === 'updated'
                                        ? 'bg-blue-100 text-blue-800'
                                        : 'bg-slate-100 text-slate-600'
                                    }`}
                                  >
                                    {r.actionType}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => {
                  setIsCsvModalOpen(false);
                  setCsvParseResult(null);
                  setCsvFileName('');
                }}
                className="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                id="btn-apply-csv-draft"
                disabled={!csvParseResult?.valid}
                onClick={handleApplyCsvToDraft}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg text-xs font-bold text-white transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Terapkan ke Draft</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. ENHANCED AUTO PATTERN GENERATOR (Canonical 4-Cycle Rotation)            */}
      {/* ========================================================================= */}
      {isPatternModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-3xl w-full border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
              <div className="flex items-center gap-2.5">
                <Wand2 className="w-4 h-4 text-indigo-600" />
                <div>
                  <h3 className="text-xs font-bold text-slate-900">Konfigurasi Pola Otomatis Rotasi Teknisi</h3>
                  <p className="text-[10px] text-slate-500">
                    Bulan: {monthNames[currentMonth - 1]} {currentYear} (Hanya Berlaku pada Draft Lokal)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsPatternModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              {/* 1. Cycle Anchor Date */}
              <div className="bg-indigo-50/50 border border-indigo-100 rounded-lg p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                <div>
                  <p className="font-bold text-indigo-900">1. Tanggal Acuan Siklus</p>
                  <p className="text-[11px] text-indigo-700">
                    Pola dihitung berdasarkan selisih hari modulo 4 dari tanggal acuan ini sehingga rotasi tersambung antar bulan tanpa reset.
                  </p>
                  {patternStartDate && (
                    <p className="text-[11px] font-semibold text-indigo-950 mt-0.5">
                      Acuan Terpilih: {formatIndonesianDate(patternStartDate, true)}
                    </p>
                  )}
                </div>
                <input
                  type="date"
                  value={patternStartDate}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-indigo-200 rounded text-xs font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer shrink-0"
                />
              </div>

              {/* 2. Position per Technician & Preset */}
              <div>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-2">
                  <div>
                    <p className="text-xs font-bold text-slate-900">
                      2. Posisi pada Tanggal Acuan per Teknisi:
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Siklus rotasi 4 hari: PS → M → Libur Hari 1 → Libur Hari 2 → ulang.
                    </p>
                  </div>
                  {rotationTechs.length === 4 && (
                    <button
                      type="button"
                      onClick={handleApplyPreset4Techs}
                      className="px-2.5 py-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-800 rounded font-bold text-[11px] transition-colors cursor-pointer shrink-0 flex items-center gap-1"
                    >
                      <Wand2 className="w-3 h-3" />
                      <span>Sebar Merata 4 Teknisi</span>
                    </button>
                  )}
                </div>

                {/* Info Box: Supervisor Office-Hour Rule */}
                {(() => {
                  const supTech = technicians.find((t) => isSupervisorUser(t, technicians));
                  const supName = supTech ? supTech.name : 'Supervisor';
                  return (
                    <div className="bg-amber-50/70 border border-amber-200/80 rounded-md px-3 py-2 text-[11px] text-amber-800 mb-2.5 flex items-center gap-2">
                      <span className="font-bold">Info Jadwal {supName} (Supervisor):</span>
                      <span>Otomatis bertugas Office Hour (PS) Senin–Jumat, Libur Sabtu–Minggu, dan tidak masuk rotasi shift PS/M teknisi.</span>
                    </div>
                  );
                })()}

                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-48 overflow-y-auto text-xs">
                  {patternConfigs.map((cfg) => (
                    <div key={cfg.technicianId} className="p-2.5 flex items-center justify-between gap-3 bg-slate-50/30 hover:bg-slate-50/70">
                      <div className="font-semibold text-slate-800">
                        {cfg.technicianName}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-500 font-medium">Posisi Acuan:</span>
                        <select
                          value={cfg.anchorPosition || 'PS'}
                          onChange={(e) =>
                            handleUpdatePatternConfig(cfg.technicianId, e.target.value as CyclePosition)
                          }
                          className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs font-bold text-slate-700 cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                          {CYCLE_POSITIONS.map((pos) => (
                            <option key={pos} value={pos}>
                              {CYCLE_POSITION_LABELS[pos]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 3. Validation Feedback */}
              {patternResult && (
                <div>
                  {!patternResult.valid ? (
                    <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-lg p-3 text-xs space-y-1">
                      <div className="flex items-center gap-2 font-bold text-rose-900">
                        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>Pola Tidak Valid: Terdapat Shift Kosong Tanpa Teknisi Bertugas</span>
                      </div>
                      <p className="text-[11px] text-rose-700">{patternResult.errorMessage}</p>
                    </div>
                  ) : (
                    <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-2.5 text-xs flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span className="font-bold">Validasi Berhasil: Minimal 1 teknisi bertugas pada setiap shift PS dan M.</span>
                      </div>
                      <span className="font-mono text-[11px] bg-emerald-100 px-2 py-0.5 rounded text-emerald-900 font-extrabold">
                        {patternResult.docs.length} Shift Valid
                      </span>
                    </div>
                  )}

                  {/* 4. Preview Table (8 Hari Pertama) */}
                  <div className="mt-3">
                    <p className="text-xs font-bold text-slate-900 mb-1.5">
                      3. Contoh Preview Rotasi (8 Hari Pertama):
                    </p>
                    <div className="border border-slate-200 rounded-lg overflow-x-auto text-[11px]">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                          <tr>
                            <th className="p-2 whitespace-nowrap">Tanggal</th>
                            <th className="p-2 whitespace-nowrap">Teknisi PS</th>
                            <th className="p-2 whitespace-nowrap">Teknisi M</th>
                            <th className="p-2 whitespace-nowrap">Libur Hari 1</th>
                            <th className="p-2 whitespace-nowrap">Libur Hari 2</th>
                            <th className="p-2 whitespace-nowrap text-center">Bertugas</th>
                            <th className="p-2 whitespace-nowrap">Supervisor</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {patternResult.previewDays.slice(0, 8).map((pDay, idx) => {
                            const isPsEmpty = pDay.psTechs.length === 0;
                            const isMEmpty = pDay.mTechs.length === 0;
                            const hasEmpty = isPsEmpty || isMEmpty;

                            return (
                              <tr
                                key={idx}
                                className={hasEmpty ? 'bg-rose-50 text-rose-900' : 'hover:bg-slate-50/50'}
                              >
                                <td className="p-1.5 font-medium whitespace-nowrap">{pDay.formattedDate}</td>
                                <td className="p-1.5 font-semibold text-blue-900 whitespace-nowrap">
                                  {isPsEmpty ? (
                                    <span className="text-rose-600 font-bold italic">KOSONG</span>
                                  ) : (
                                    pDay.psTechs.join(', ')
                                  )}
                                </td>
                                <td className="p-1.5 font-semibold text-purple-900 whitespace-nowrap">
                                  {isMEmpty ? (
                                    <span className="text-rose-600 font-bold italic">KOSONG</span>
                                  ) : (
                                    pDay.mTechs.join(', ')
                                  )}
                                </td>
                                <td className="p-1.5 text-slate-500 whitespace-nowrap">
                                  {pDay.libur1Techs.join(', ') || '-'}
                                </td>
                                <td className="p-1.5 text-slate-500 whitespace-nowrap">
                                  {pDay.libur2Techs.join(', ') || '-'}
                                </td>
                                <td className="p-1.5 text-center font-bold font-mono">
                                  {pDay.onDutyCount}
                                </td>
                                <td className="p-1.5 text-[10px] text-slate-600 whitespace-nowrap">
                                  {pDay.supervisorInfo}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* 5. Option: Preserve Manual Overrides */}
                  <div className="mt-3 p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={preserveManualExceptions}
                        onChange={(e) => setPreserveManualExceptions(e.target.checked)}
                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                      />
                      <span className="text-xs font-semibold text-slate-800">
                        Pertahankan pengecualian manual (Cuti, Sakit, Izin, Lembur) yang telah diedit
                      </span>
                    </label>
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 shrink-0">
              <button
                onClick={() => setIsPatternModalOpen(false)}
                className="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                id="btn-apply-pattern-draft"
                disabled={!patternResult || !patternResult.valid}
                onClick={handleApplyPatternToDraft}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg text-xs font-bold text-white transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Terapkan ke Draft</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. COPY PREVIOUS MONTH MODAL (Draft Apply)                                */}
      {/* ========================================================================= */}
      {isCopyModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <Copy className="w-4 h-4 text-blue-600" />
                <div>
                  <h3 className="text-xs font-bold text-slate-900">Salin Jadwal Bulan Lalu (Draft)</h3>
                  <p className="text-[10px] text-slate-500">
                    Ke Bulan: {monthNames[currentMonth - 1]} {currentYear}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsCopyModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              {copyLoading ? (
                <div className="h-32 flex flex-col items-center justify-center gap-2 text-slate-400">
                  <Loader className="w-6 h-6 animate-spin text-blue-500" />
                  <p className="text-xs font-bold">Menyiapkan data salinan...</p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Sistem akan menyalin penugasan shift per tanggal dari bulan sebelumnya ke dalam draft bulan ini.
                  </p>

                  {copyPreview && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs">
                      <p className="font-bold text-emerald-900 mb-0.5">Jadwal Siap Diterapkan ke Draft</p>
                      <p className="text-emerald-700">
                        {copyPreview.length} shift akan disalin ke draft kalender bulan {monthNames[currentMonth - 1]} {currentYear}.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setIsCopyModalOpen(false)}
                className="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                id="btn-apply-copy-draft"
                disabled={!copyPreview || copyPreview.length === 0}
                onClick={handleApplyCopyToDraft}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg text-xs font-bold text-white transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Terapkan ke Draft</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. CLEAR MONTH CONFIRMATION MODAL ("Kosongkan Bulan Ini")                 */}
      {/* ========================================================================= */}
      {isClearMonthModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-md w-full border border-rose-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-4 py-3 border-b border-rose-100 flex items-center justify-between bg-rose-50/50">
              <div className="flex items-center gap-2.5">
                <Trash2 className="w-4 h-4 text-rose-600" />
                <div>
                  <h3 className="text-xs font-bold text-rose-900">Kosongkan Jadwal Bulan Ini</h3>
                  <p className="text-[10px] text-rose-600">
                    Bulan: {monthNames[currentMonth - 1]} {currentYear}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsClearMonthModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3.5">
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs text-rose-900 space-y-1.5">
                <p className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  PERINGATAN TINDAKAN PERMANEN
                </p>
                <p className="text-[11px] leading-relaxed text-rose-800">
                  Tindakan ini akan <strong>menghapus {firestoreDocs.length} dokumen shift</strong> pada bulan <strong>{monthNames[currentMonth - 1]} {currentYear}</strong> dari database server. Tindakan ini tidak dapat dibatalkan setelah dikonfirmasi.
                </p>
              </div>

              <div className="space-y-1.5 text-xs">
                <label className="font-semibold text-slate-700 block">
                  Ketik <strong className="text-rose-700 select-all font-mono">{expectedClearPhrase}</strong> untuk mengonfirmasi:
                </label>
                <input
                  id="input-clear-confirm"
                  type="text"
                  value={clearConfirmInput}
                  onChange={(e) => setClearConfirmInput(e.target.value)}
                  placeholder={expectedClearPhrase}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                />
              </div>
            </div>

            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                disabled={deleting}
                onClick={() => setIsClearMonthModalOpen(false)}
                className="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                id="btn-confirm-clear-month"
                disabled={!isClearPhraseMatched || deleting}
                onClick={handleConfirmClearMonth}
                className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg text-xs font-bold text-white transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                {deleting ? (
                  <>
                    <Loader className="w-3.5 h-3.5 animate-spin" />
                    <span>Menghapus...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Konfirmasi Kosongkan Jadwal</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. UNSAVED CHANGES NAVIGATION CONFIRMATION MODAL                          */}
      {/* ========================================================================= */}
      {isUnsavedConfirmModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-md w-full border border-amber-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-4 py-3 border-b border-amber-100 flex items-center justify-between bg-amber-50">
              <div className="flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <h3 className="text-xs font-bold text-amber-900">Perubahan Belum Disimpan</h3>
              </div>
              <button
                onClick={() => setIsUnsavedConfirmModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 text-xs space-y-2 text-slate-700">
              <p className="leading-relaxed">
                Terdapat perubahan draft jadwal pada bulan <strong>{monthNames[currentMonth - 1]} {currentYear}</strong> yang belum disimpan ke database server.
              </p>
              <p className="text-amber-800 font-medium">
                Jika Anda berpindah bulan sekarang, perubahan draft pada bulan ini akan dibatalkan.
              </p>
            </div>

            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setIsUnsavedConfirmModalOpen(false)}
                className="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
              >
                Batal Pindah
              </button>
              <button
                id="btn-discard-and-navigate"
                onClick={confirmDiscardAndNavigate}
                className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 rounded-lg text-xs font-bold text-white transition-colors cursor-pointer"
              >
                Buang Perubahan & Pindah
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Official OM NTI Roster & Daftar Hadir PDF Modal */}
      <RosterScheduleModal
        isOpen={isRosterModalOpen}
        onClose={() => setIsRosterModalOpen(false)}
        year={currentYear}
        month={currentMonth}
        scheduleDocs={draftDocs.length > 0 ? draftDocs : firestoreDocs}
        attendanceRecords={attendanceRecords}
      />
    </div>
  );
};
