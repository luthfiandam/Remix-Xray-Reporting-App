import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ShiftType, Technician, PreventiveSession } from '../types';
import { FirestoreUserProfile } from '../types/auth';
import {
  getOperationalShift,
  resolveActiveSessionStaff,
} from '../utils/technicianSchedule';
import { isSupervisorUser } from '../services/scheduleCsvService';
import { fetchSchedulesForShiftDetailed, buildScheduleDocId, ScheduleFetchStatus, ON_DUTY_STATUSES, ShiftScheduleV2 } from '../services/scheduleService';
import { resolveTechnicianNames } from '../utils/entityLookup';
import {
  getValidCachedShiftSession,
  saveCachedShiftSession,
  CachedShiftSession,
} from '../services/sessionCacheService';
import { toast } from '../components/Toast';

export type ResolutionStatus = 'idle' | 'resolving' | 'resolved' | 'fallback';

interface UseShiftSessionProps {
  isLoggedIn: boolean;
  technicians: Technician[];
  activeDatasetId: string;
  currentUserProfile?: FirestoreUserProfile | null;
  currentUserEmail?: string | null;
}

export function useShiftSession({
  isLoggedIn,
  technicians,
  activeDatasetId,
  currentUserProfile,
  currentUserEmail,
}: UseShiftSessionProps) {
  const [currentSession, setCurrentSession] = useState<PreventiveSession>(() => {
    const op = getOperationalShift();
    const docId = buildScheduleDocId(activeDatasetId, op.operationalDate, op.shiftCode);
    const cached = getValidCachedShiftSession({
      dataset_id: activeDatasetId,
      operational_date: op.operationalDate,
      shift: op.shift,
      schedule_document_id: docId,
    });

    if (cached && cached.technician_ids.length > 0) {
      return {
        id: 101,
        operational_date: cached.operational_date,
        shift: cached.shift,
        started_at: cached.shift === 'Pagi' ? '07:00' : '19:00',
        ended_at: cached.shift === 'Pagi' ? '18:59' : '06:59',
        status: 'active',
        technician_ids: cached.technician_ids,
        technician_names: cached.technician_names,
      };
    }

    return {
      id: 101,
      operational_date: op.operationalDate,
      shift: op.shift,
      started_at: op.shift === 'Pagi' ? '07:00' : '19:00',
      ended_at: op.shift === 'Pagi' ? '18:59' : '06:59',
      status: 'active',
      technician_ids: [],
      technician_names: [],
    };
  });

  const [scheduleAvailable, setScheduleAvailable] = useState<boolean>(() => {
    const op = getOperationalShift();
    const docId = buildScheduleDocId(activeDatasetId, op.operationalDate, op.shiftCode);
    const cached = getValidCachedShiftSession({
      dataset_id: activeDatasetId,
      operational_date: op.operationalDate,
      shift: op.shift,
      schedule_document_id: docId,
    });
    return Boolean(cached && cached.technician_ids.length > 0);
  });

  const [isScheduleEmpty, setIsScheduleEmpty] = useState<boolean>(false);
  const [fetchStatus, setFetchStatus] = useState<ScheduleFetchStatus | null>(null);
  const [isScheduleLoading, setIsScheduleLoading] = useState<boolean>(false);
  const [scheduleWarning, setScheduleWarning] = useState<string | null>(null);
  const [resolutionStatus, setResolutionStatus] = useState<ResolutionStatus>('idle');
  const [currentScheduleDoc, setCurrentScheduleDoc] = useState<any | null>(null);

  const lastFetchedContextRef = useRef<string | null>(null);
  const inFlightPromiseRef = useRef<Map<string, Promise<void>>>(new Map());

  // Derive logged-in technician from master data
  const loggedInTechnician = useMemo(() => {
    if (!currentUserProfile && !currentUserEmail) return null;
    if (currentUserProfile?.technician_id) {
      const match = technicians.find((t) => t.id === currentUserProfile.technician_id);
      if (match) return match;
    }
    const nameToMatch = currentUserProfile?.display_name || currentUserProfile?.name;
    if (nameToMatch) {
      const cleanName = nameToMatch.trim().toLowerCase();
      const match = technicians.find(
        (t) =>
          t.name.toLowerCase() === cleanName ||
          cleanName.includes(t.name.toLowerCase()) ||
          t.name.toLowerCase().includes(cleanName)
      );
      if (match) return match;
    }
    const emailToMatch = currentUserProfile?.email || currentUserEmail;
    if (emailToMatch) {
      const prefix = emailToMatch.split('@')[0].trim().toLowerCase();
      const match = technicians.find(
        (t) =>
          ((t as { email?: string }).email &&
            (t as { email?: string }).email!.toLowerCase() === emailToMatch.toLowerCase()) ||
          t.name.toLowerCase() === prefix ||
          prefix.includes(t.name.toLowerCase()) ||
          t.name.toLowerCase().includes(prefix)
      );
      if (match) return match;
    }
    return null;
  }, [currentUserProfile, currentUserEmail, technicians]);

  // On Duty Technician Names derived from current session technician_ids
  const technicianNames = useMemo(() => {
    return resolveTechnicianNames(currentSession.technician_ids, technicians);
  }, [currentSession.technician_ids, technicians]);

  // Save Shift Handler
  const handleSaveShift = (selectedIds: number[], shift: ShiftType, date: string) => {
    const techNames = resolveTechnicianNames(selectedIds, technicians);
    const shiftCode = shift === 'Pagi' ? 'PS' : 'M';
    const docId = buildScheduleDocId(activeDatasetId, date, shiftCode);

    const sessionToCache: CachedShiftSession = {
      dataset_id: activeDatasetId,
      operational_date: date,
      shift: shift,
      shift_code: shiftCode,
      schedule_document_id: docId,
      updated_at: new Date().toISOString(),
      technician_ids: selectedIds,
      technician_names: techNames,
      supervisor_on_duty: false,
      resolved_at: new Date().toISOString(),
      source: 'manual',
    };
    saveCachedShiftSession(sessionToCache);

    setCurrentSession((prev) => ({
      ...prev,
      operational_date: date,
      shift: shift,
      technician_ids: selectedIds,
      technician_names: techNames,
    }));
    setScheduleAvailable(selectedIds.length > 0);
    setIsScheduleEmpty(false);
    toast.success('Penugasan Shift Disimpan', {
      message: `Shift ${shift} (${date}) berhasil disimpan untuk ${techNames.length} personil on-duty.`,
      badge: 'Jadwal Shift',
    });
  };

  // Login Technician Handler (Fallback only when schedule is not available)
  const handleLoginTechnicianSession = (selectedTechIds: number[]) => {
    if (!selectedTechIds || selectedTechIds.length === 0) return;
    // If the shift already has scheduled on-duty technicians, preserve the schedule!
    if (scheduleAvailable && !isScheduleEmpty && currentSession.technician_ids.length > 0 && resolutionStatus === 'resolved') {
      return;
    }
    const techNames = resolveTechnicianNames(selectedTechIds, technicians);
    const op = getOperationalShift();
    const docId = buildScheduleDocId(activeDatasetId, op.operationalDate, op.shiftCode);

    const sessionToCache: CachedShiftSession = {
      dataset_id: activeDatasetId,
      operational_date: op.operationalDate,
      shift: op.shift,
      shift_code: op.shiftCode,
      schedule_document_id: docId,
      updated_at: new Date().toISOString(),
      technician_ids: selectedTechIds,
      technician_names: techNames,
      supervisor_on_duty: false,
      resolved_at: new Date().toISOString(),
      source: 'manual',
    };
    saveCachedShiftSession(sessionToCache);

    setCurrentSession((prev) => ({
      ...prev,
      technician_ids: selectedTechIds,
      technician_names: techNames,
    }));
    setScheduleAvailable(selectedTechIds.length > 0);
    setIsScheduleEmpty(false);
  };

  // Centralized Automatic On-Duty Schedule Resolver Function
  const checkAndUpdateShift = useCallback(
    async (forceRefetch = false) => {
      if (!isLoggedIn) {
        setIsScheduleLoading(false);
        setScheduleWarning(null);
        setResolutionStatus('idle');
        lastFetchedContextRef.current = null;
        return;
      }

      const op = getOperationalShift();
      const currentUserId = currentUserProfile?.uid || currentUserEmail || '';
      const contextKey = `${currentUserId}:${op.operationalDate}:${op.shiftCode}`;

      // 1. Return immediately if context is already resolved & forceRefetch is false
      if (!forceRefetch && lastFetchedContextRef.current === contextKey) {
        return;
      }

      // 2. Deduplicate in-flight requests for identical contextKey
      if (!forceRefetch && inFlightPromiseRef.current.has(contextKey)) {
        await inFlightPromiseRef.current.get(contextKey);
        return;
      }

      setIsScheduleLoading(true);
      setResolutionStatus('resolving');

      const fetchPromise = (async () => {
        try {
          // Fetch both PS and M shift documents concurrently for current operational date
          const [psResult, mResult] = await Promise.all([
            fetchSchedulesForShiftDetailed(op.operationalDate, 'PS', activeDatasetId),
            fetchSchedulesForShiftDetailed(op.operationalDate, 'M', activeDatasetId),
          ]);
          lastFetchedContextRef.current = contextKey;
          setFetchStatus(psResult.status !== 'UNKNOWN_ERROR' ? psResult.status : mResult.status);

          const psDoc: ShiftScheduleV2 | null = psResult.rawV2Docs?.[0] || null;
          const mDoc: ShiftScheduleV2 | null = mResult.rawV2Docs?.[0] || null;

          // Determine which shift the logged-in technician is on-duty for
          let chosenShiftCode: 'PS' | 'M' = op.shiftCode;
          let chosenShift: ShiftType = op.shift;
          let chosenDoc: ShiftScheduleV2 | null = op.shiftCode === 'PS' ? psDoc : mDoc;

          if (loggedInTechnician) {
            const techIdStr = String(loggedInTechnician.id);
            const techNameClean = loggedInTechnician.name.trim().toLowerCase();

            const checkDocAssigned = (doc: ShiftScheduleV2 | null) => {
              if (!doc?.assignments) return false;
              if (doc.assignments[techIdStr] && ON_DUTY_STATUSES.includes(doc.assignments[techIdStr].status)) {
                return true;
              }
              return Object.entries(doc.assignments).some(([key, a]) => {
                if (!ON_DUTY_STATUSES.includes(a.status)) return false;
                if (key === techIdStr || (a.technician_id !== undefined && String(a.technician_id) === techIdStr)) return true;
                if (a.technician_name) {
                  const assignName = a.technician_name.trim().toLowerCase();
                  return assignName === techNameClean || assignName.includes(techNameClean) || techNameClean.includes(assignName);
                }
                return false;
              });
            };

            const isAssignedPS = checkDocAssigned(psDoc);
            const isAssignedM = checkDocAssigned(mDoc);

            // If technician is on-duty for Night Shift (M) and not Day Shift (PS), choose M
            if (isAssignedM && !isAssignedPS) {
              chosenShiftCode = 'M';
              chosenShift = 'Malam';
              chosenDoc = mDoc;
            } else if (isAssignedPS && !isAssignedM) {
              chosenShiftCode = 'PS';
              chosenShift = 'Pagi';
              chosenDoc = psDoc;
            } else if (isAssignedPS && isAssignedM) {
              // Assigned to both shifts: respect clock operational window
              chosenShiftCode = op.shiftCode;
              chosenShift = op.shift;
              chosenDoc = chosenShiftCode === 'PS' ? psDoc : mDoc;
            } else {
              // Not on-duty on either (or both off): default to clock operational shift
              chosenShiftCode = op.shiftCode;
              chosenShift = op.shift;
              chosenDoc = chosenShiftCode === 'PS' ? psDoc : mDoc;
            }
          }

          const canonicalDocId = buildScheduleDocId(activeDatasetId, op.operationalDate, chosenShiftCode);

          if (chosenDoc) {
            setCurrentScheduleDoc(chosenDoc);
            const resolved = resolveActiveSessionStaff(technicians, chosenShiftCode, op.operationalDate, chosenDoc);

            if (resolved.onDutyIds.length > 0) {
              let scheduledIds = resolved.onDutyIds;

              // Check if logged-in user is a supervisor (supervisors monitor, they are not duty technicians on checklist)
              const isLoggedInSupervisor = loggedInTechnician
                ? isSupervisorUser(loggedInTechnician, technicians)
                : Boolean(currentUserProfile?.role === 'supervisor');

              // If logged-in user is a regular technician and actually scheduled on-duty, prioritize their position
              if (loggedInTechnician && !isLoggedInSupervisor && scheduledIds.includes(loggedInTechnician.id)) {
                scheduledIds = [
                  loggedInTechnician.id,
                  ...scheduledIds.filter((id) => id !== loggedInTechnician.id),
                ];
              }

              const scheduledNames = resolveTechnicianNames(scheduledIds, technicians);

              const sessionToCache: CachedShiftSession = {
                dataset_id: activeDatasetId,
                operational_date: op.operationalDate,
                shift: chosenShift,
                shift_code: chosenShiftCode,
                schedule_document_id: canonicalDocId,
                updated_at: chosenDoc?.updated_at || null,
                technician_ids: scheduledIds,
                technician_names: scheduledNames,
                supervisor_on_duty: resolved.supervisorOnDuty,
                resolved_at: new Date().toISOString(),
                source: 'firestore_v2',
              };
              saveCachedShiftSession(sessionToCache);

              setScheduleAvailable(true);
              setIsScheduleEmpty(false);
              setScheduleWarning(null);

              setCurrentSession((prev) => ({
                ...prev,
                id: prev.operational_date !== op.operationalDate || prev.shift !== chosenShift ? Date.now() : prev.id,
                operational_date: op.operationalDate,
                shift: chosenShift,
                started_at: chosenShift === 'Pagi' ? '07:00' : '19:00',
                ended_at: chosenShift === 'Pagi' ? '18:59' : '06:59',
                technician_ids: scheduledIds,
                technician_names: scheduledNames,
              }));
              setResolutionStatus('resolved');
            } else {
              // Document exists but 0 on-duty staff
              setScheduleAvailable(false);
              setIsScheduleEmpty(true);
              const fallbackIds = loggedInTechnician ? [loggedInTechnician.id] : [];
              const fallbackNames = loggedInTechnician ? [loggedInTechnician.name] : [];
              setScheduleWarning(
                'Belum ada teknisi yang dijadwalkan pada shift ini. Sementara, laporan akan dicatat atas nama akun yang sedang login.'
              );
              setCurrentSession((prev) => ({
                ...prev,
                operational_date: op.operationalDate,
                shift: chosenShift,
                started_at: chosenShift === 'Pagi' ? '07:00' : '19:00',
                ended_at: chosenShift === 'Pagi' ? '18:59' : '06:59',
                technician_ids: fallbackIds,
                technician_names: fallbackNames,
              }));
              setResolutionStatus('fallback');
            }
          } else if (psResult.status === 'SUCCESS_EMPTY' && mResult.status === 'SUCCESS_EMPTY') {
            // No schedule doc found for either shift
            setScheduleAvailable(false);
            setIsScheduleEmpty(true);
            const fallbackIds = loggedInTechnician ? [loggedInTechnician.id] : [];
            const fallbackNames = loggedInTechnician ? [loggedInTechnician.name] : [];
            setScheduleWarning(
              'Belum ada teknisi yang dijadwalkan pada shift ini. Sementara, laporan akan dicatat atas nama akun yang sedang login.'
            );
            setCurrentSession((prev) => ({
              ...prev,
              operational_date: op.operationalDate,
              shift: chosenShift,
              started_at: chosenShift === 'Pagi' ? '07:00' : '19:00',
              ended_at: chosenShift === 'Pagi' ? '18:59' : '06:59',
              technician_ids: fallbackIds,
              technician_names: fallbackNames,
            }));
            setResolutionStatus('fallback');
          } else {
            // Error response (e.g. PERMISSION_DENIED, NETWORK_ERROR)
            setIsScheduleEmpty(false);
            const cached = getValidCachedShiftSession({
              dataset_id: activeDatasetId,
              operational_date: op.operationalDate,
              shift: chosenShift,
              schedule_document_id: canonicalDocId,
            });

            let fallbackIds = loggedInTechnician ? [loggedInTechnician.id] : [];
            let fallbackNames = loggedInTechnician ? [loggedInTechnician.name] : [];

            if (cached && cached.technician_ids.length > 0) {
              fallbackIds = cached.technician_ids;
              fallbackNames = cached.technician_names;
              setScheduleAvailable(true);
            } else {
              setScheduleAvailable(false);
            }

            setScheduleWarning(
              'Jadwal shift tidak dapat dimuat. Sementara, laporan akan dicatat atas nama akun yang sedang login.'
            );
            setCurrentSession((prev) => ({
              ...prev,
              operational_date: op.operationalDate,
              shift: chosenShift,
              started_at: chosenShift === 'Pagi' ? '07:00' : '19:00',
              ended_at: chosenShift === 'Pagi' ? '18:59' : '06:59',
              technician_ids: fallbackIds,
              technician_names: fallbackNames,
            }));
            setResolutionStatus('fallback');
          }
        } catch (err: any) {
          const fallbackIds = loggedInTechnician ? [loggedInTechnician.id] : [];
          const fallbackNames = loggedInTechnician ? [loggedInTechnician.name] : [];
          setScheduleWarning(
            'Jadwal shift tidak dapat dimuat. Sementara, laporan akan dicatat atas nama akun yang sedang login.'
          );
          setCurrentSession((prev) => ({
            ...prev,
            operational_date: op.operationalDate,
            shift: op.shift,
            started_at: op.shift === 'Pagi' ? '07:00' : '19:00',
            ended_at: op.shift === 'Pagi' ? '18:59' : '06:59',
            technician_ids: fallbackIds,
            technician_names: fallbackNames,
          }));
          setResolutionStatus('fallback');
        } finally {
          setIsScheduleLoading(false);
          inFlightPromiseRef.current.delete(contextKey);
        }
      })();

      inFlightPromiseRef.current.set(contextKey, fetchPromise);
      await fetchPromise;
    },
    [isLoggedIn, activeDatasetId, technicians, currentUserProfile, currentUserEmail, loggedInTechnician]
  );

  // Automatic Resolution Effect & Timer
  useEffect(() => {
    if (!isLoggedIn) {
      setIsScheduleLoading((prev) => (prev ? false : prev));
      setScheduleWarning((prev) => (prev !== null ? null : prev));
      setResolutionStatus((prev) => (prev !== 'idle' ? 'idle' : prev));
      lastFetchedContextRef.current = null;
      return;
    }

    checkAndUpdateShift(false);

    // 30s timer for checking operational shift rollover locally ONLY (zero queries if context key unchanged)
    const intervalId = setInterval(() => {
      const op = getOperationalShift();
      const dbShiftCode = op.shift === 'Pagi' ? 'PS' : 'M';
      const currentUserId = currentUserProfile?.uid || currentUserEmail || '';
      const currentKey = `${currentUserId}:${op.operationalDate}:${dbShiftCode}`;

      if (lastFetchedContextRef.current !== currentKey) {
        checkAndUpdateShift(false);
      }
    }, 30000);

    return () => {
      clearInterval(intervalId);
    };
  }, [isLoggedIn, checkAndUpdateShift, currentUserProfile, currentUserEmail]);

  // Window Focus & Visibility Change Handler
  useEffect(() => {
    if (!isLoggedIn) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const op = getOperationalShift();
        const dbShiftCode = op.shift === 'Pagi' ? 'PS' : 'M';
        const currentUserId = currentUserProfile?.uid || currentUserEmail || '';
        const currentKey = `${currentUserId}:${op.operationalDate}:${dbShiftCode}`;

        if (lastFetchedContextRef.current !== currentKey) {
          checkAndUpdateShift(false);
        }
      }
    };

    window.addEventListener('focus', handleVisibilityChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleVisibilityChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isLoggedIn, checkAndUpdateShift, currentUserProfile, currentUserEmail]);

  // Check whether the logged in user is actually scheduled on duty for this shift
  const isOnDuty = useMemo(() => {
    if (!loggedInTechnician) {
      // If supervisor without technician ID, consider as supervisor monitor
      return currentUserProfile?.role === 'supervisor';
    }
    const isSup = isSupervisorUser(loggedInTechnician, technicians);
    if (isSup) return true; // Supervisor always has operational visibility
    const isIdMatch = currentSession.technician_ids.includes(loggedInTechnician.id);
    const techNameClean = loggedInTechnician.name.toLowerCase().trim();
    const isNameMatch = Array.isArray(currentSession.technician_names) && currentSession.technician_names.some((n) => {
      if (!n) return false;
      const nClean = n.toLowerCase().trim();
      return nClean === techNameClean || nClean.includes(techNameClean) || techNameClean.includes(nClean);
    });
    return isIdMatch || isNameMatch;
  }, [loggedInTechnician, currentUserProfile, technicians, currentSession.technician_ids, currentSession.technician_names]);

  return {
    currentSession,
    setCurrentSession,
    scheduleAvailable,
    isScheduleEmpty,
    fetchStatus,
    isScheduleLoading,
    scheduleWarning,
    resolutionStatus,
    technicianNames,
    loggedInTechnician,
    currentScheduleDoc,
    isOnDuty,
    handleSaveShift,
    handleLoginTechnicianSession,
    refreshSchedule: () => checkAndUpdateShift(true),
  };
}
