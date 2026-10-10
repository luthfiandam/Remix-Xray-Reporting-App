import React, { useState, useMemo, useEffect, useRef } from 'react';
import { compressImage } from '../utils/imageCompressor';
import { applyWatermark, buildDriveFolderPath } from '../utils/watermark';
import { CorrectiveReport, Equipment, EquipmentType, Location, ShiftType, Role } from '../types';
import { getLocalDateString, getOperationalShift, getOperationalShiftForCorrective } from '../utils/technicianSchedule';
import { formatIndonesianDate, formatTimeRange } from '../utils/timeFormat';
import { shareReport } from '../utils/webShareUtils';
import { generatePhotoCollageFile, generatePhotoCollageBlob } from '../utils/collageService';
import { processAndUploadCorrectiveEvidences } from '../services/evidenceService';
import { uploadBlobDirectToStorage } from '../services/storageService';
import { extractS3ObjectKey, storageProxyPath } from '../utils/s3ObjectKey';
import { getProxySafeImageUrl, fetchAuthenticatedImageBlob, isCollageEvidence } from '../utils/evidenceUtils';
import { getRecurringFaultsForEquipment } from '../utils/faultDetection';
import { saveComponentReplacement } from '../services/componentReplacementService';
import {
  formatCorrectiveTelegramHtml,
  sendTelegramMessage,
  getTelegramShareUrl,
  convertHtmlToPlainText,
  getStoredTelegramConfig,
} from '../services/telegramService';
import {
  formatCorrectiveWhatsAppText,
} from '../services/whatsappService';
import { toast } from './Toast';
import { recordAuditLog } from '../services/auditLogService';
import { localDB } from '../services/indexedDB';
import { CorrectiveReportsTable } from './corrective/CorrectiveReportsTable';
import { sanitizeText, sanitizeMultilineText } from '../utils/sanitizer';
import {
  Wrench,
  Plus,
  CheckCircle2,
  Camera,
  Trash2,
  Copy,
  Send,
  X,
  FileText,
  Clock,
  User,
  AlertTriangle,
  Upload,
  Check,
  Share2,
  Cpu,
  Flame,
  Calendar,
} from 'lucide-react';

interface CorrectiveViewProps {
  correctiveReports: CorrectiveReport[];
  equipments: Equipment[];
  equipmentTypes?: EquipmentType[];
  locations: Location[];
  onAddCorrective: (report: Omit<CorrectiveReport, 'id'> & { id?: number; created_at?: string }) =>
    Promise<{ cloudSynced: boolean; queued: boolean }>;
  onDeleteCorrective?: (report: CorrectiveReport) => void | Promise<void>;
  technicianNames: string[];
  currentTechnicianId?: number;
  shift?: ShiftType;
  operationalDate?: string;
  isViewerOnly?: boolean;
  role?: Role;
  preSelectedData?: {
    equipment_id?: number;
    problem_description?: string;
    action_taken?: string;
    photo_url?: string;
    notes?: string;
  } | null;
  onClearPreSelectedData?: () => void;
}

export const CorrectiveView: React.FC<CorrectiveViewProps> = ({
  correctiveReports,
  equipments,
  equipmentTypes = [],
  locations,
  onAddCorrective,
  onDeleteCorrective,
  technicianNames,
  currentTechnicianId,
  shift = 'Pagi',
  operationalDate = '',
  isViewerOnly = false,
  role,
  preSelectedData,
  onClearPreSelectedData,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [editingReport, setEditingReport] = useState<CorrectiveReport | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingTelegram, setIsSendingTelegram] = useState(false);

  // Equipment Selection Split (Jenis Mesin -> Peralatan)
  const defaultTypeId = equipmentTypes[0]?.id || 1;
  const [selectedTypeId, setSelectedTypeId] = useState<number>(defaultTypeId);

  const filteredEquipments = useMemo(
    () => (equipments || []).filter((e) => e && e.equipment_type_id === Number(selectedTypeId) && e.active),
    [equipments, selectedTypeId]
  );
  const [equipmentId, setEquipmentId] = useState<number>(
    filteredEquipments[0]?.id || (equipments || [])[0]?.id || 1
  );

  // Keep equipmentId aligned if filteredEquipments changes
  useEffect(() => {
    if (filteredEquipments.length > 0 && !filteredEquipments.some((e) => e.id === equipmentId)) {
      if (filteredEquipments[0]?.id) {
        setEquipmentId(filteredEquipments[0].id);
      }
    }
  }, [filteredEquipments, equipmentId]);

  // Auto scroll to top when opening form or changing equipment selection
  useEffect(() => {
    if (typeof window !== 'undefined' && showForm) {
      try {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      } catch {
        window.scrollTo(0, 0);
      }
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
      const mainEl = document.querySelector('main');
      if (mainEl) mainEl.scrollTop = 0;
    }
  }, [showForm, selectedTypeId, equipmentId]);

  // Pre-selected data handler (e.g. converted from AVSEC report with photo & description reference)
  useEffect(() => {
    if (preSelectedData) {
      if (preSelectedData.equipment_id) {
        setEquipmentId(preSelectedData.equipment_id);
        const eq = equipments.find((e) => e.id === preSelectedData.equipment_id);
        if (eq?.equipment_type_id) {
          setSelectedTypeId(eq.equipment_type_id);
        }
      }
      if (preSelectedData.problem_description) {
        setProblemDescription(preSelectedData.problem_description);
      }
      if (preSelectedData.action_taken) {
        setActionTaken(preSelectedData.action_taken);
      }
      if (preSelectedData.photo_url) {
        setPhotos([preSelectedData.photo_url]);
      }
      if (preSelectedData.notes) {
        setNotes(preSelectedData.notes);
      }
      setShowForm(true);
      if (onClearPreSelectedData) {
        onClearPreSelectedData();
      }
    }
  }, [preSelectedData, equipments, onClearPreSelectedData]);

  // Time & Date State
  const [eventDate, setEventDate] = useState<string>(
    operationalDate || getOperationalShift().operationalDate
  );

  // Sync eventDate whenever form opens for a new report or when operationalDate changes
  useEffect(() => {
    if (showForm && !editingReport) {
      setEventDate(operationalDate || getOperationalShift().operationalDate);
    }
  }, [showForm, editingReport, operationalDate]);

  const now = new Date();
  const defaultStart = `${String(now.getHours()).padStart(2, '0')}.${String(
    now.getMinutes()
  ).padStart(2, '0')}`;
  const endHour = new Date(now.getTime() + 30 * 60000);
  const defaultEnd = `${String(endHour.getHours()).padStart(2, '0')}.${String(
    endHour.getMinutes()
  ).padStart(2, '0')}`;

  const [startTime, setStartTime] = useState(defaultStart);
  const [endTime, setEndTime] = useState(defaultEnd);

  // Selected Technicians
  const availableTechs = useMemo(
    () => (technicianNames.length > 0 ? technicianNames : ['Luthfi', 'Zaky', 'Yoan', 'Fariz']),
    [technicianNames]
  );
  const [selectedTechs, setSelectedTechs] = useState<string[]>(availableTechs);

  // Form Inputs
  const [problemDescription, setProblemDescription] = useState('');
  const [actionTaken, setActionTaken] = useState('');
  const [result, setResult] = useState<'Resolved' | 'Pending Sparepart' | 'Temporary Fix'>('Resolved');
  const [resultText, setResultText] = useState('Xray sudah bisa di Gunakan dengan Normal 🙏🏻');
  const [notes, setNotes] = useState('-');

  // Photos State (Max 10)
  const [photos, setPhotos] = useState<string[]>([]);
  const [submittedReport, setSubmittedReport] = useState<CorrectiveReport | null>(null);
  // Keep one identity across retries of this open form, not across unrelated reports.
  const submissionIdRef = useRef<string>(crypto.randomUUID());
  const collageRetryRef = useRef<{ fingerprint: string; key: string; url: string } | null>(null);

  // Spare Part Replacement State
  const [recordReplacement, setRecordReplacement] = useState(false);
  const [componentName, setComponentName] = useState('');
  const [partSerialNumber, setPartSerialNumber] = useState('');
  const [partOrigin, setPartOrigin] = useState<'Baru' | 'Kolekan Cadangan' | 'Rekondisi'>('Baru');
  const [replacementReason, setReplacementReason] = useState('');

  // Detect recurring faults for selected equipment (>= 3 occurrences in 30 days)
  const recurringFaultsForSelected = useMemo(() => {
    return getRecurringFaultsForEquipment(Number(equipmentId), correctiveReports, 30, 3);
  }, [equipmentId, correctiveReports]);

  // WhatsApp Modal State
  const [generatedReportText, setGeneratedReportText] = useState<string | null>(null);
  const [copiedToast, setCopiedToast] = useState(false);

  // Update selected equipment when equipment type changes
  const handleTypeChange = (typeId: number) => {
    setSelectedTypeId(typeId);
    const available = equipments.filter((e) => e.equipment_type_id === typeId && e.active);
    if (available.length > 0 && available[0]?.id) {
      setEquipmentId(available[0].id);
    }
  };

  // Handle Photo Uploads (Max 10)
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const fileList = Array.from(e.target.files) as File[];

    if (photos.length + fileList.length > 10) {
      toast.warning('Batas Foto', 'Maksimal foto yang dapat diunggah adalah 10 foto.');
    }

    const availableSlots = 10 - photos.length;
    const selectedFiles: File[] = fileList.slice(0, availableSlots);

    const eq = (equipments || []).find((item) => item && item.id === Number(equipmentId));
    const loc = (locations || []).find((l) => l && l.id === eq?.location_id);
    const eqType = (equipmentTypes || []).find((t) => t && t.id === eq?.equipment_type_id);

    const watermarkOpts = {
      equipmentName: eq?.name || 'Equipment',
      locationName: loc?.name || '',
      equipmentType: eqType?.name || '',
      operationalDate: operationalDate || getLocalDateString(new Date()),
      time: startTime || '08:00',
      shift: shift,
      reportType: 'CORRECTIVE' as const,
    };

    try {
      const watermarkedPhotos = await Promise.all(
        selectedFiles.map((file: File) => applyWatermark(file, watermarkOpts, 1600, 0.85))
      );
      setPhotos((prev) => [...prev, ...watermarkedPhotos].slice(0, 10));
    } catch (err) {
      console.error('Corrective photo watermark/compression error:', err);
    }
  };

  // User identification for draft isolation
  const effectiveUserId = String(currentTechnicianId || 'technician');

  // Restore draft when opening form for new report
  useEffect(() => {
    if (showForm && !editingReport) {
      localDB.getDraft<any>('corrective_form_draft', effectiveUserId).then((draft) => {
        if (draft && (draft.photos?.length > 0 || draft.problemDescription || draft.actionTaken)) {
          if (!problemDescription && !actionTaken && photos.length === 0) {
            if (draft.equipmentId) setEquipmentId(draft.equipmentId);
            if (draft.problemDescription) setProblemDescription(draft.problemDescription);
            if (draft.actionTaken) setActionTaken(draft.actionTaken);
            if (draft.photos) setPhotos(draft.photos);
            if (draft.result) setResult(draft.result);
            if (draft.resultText) setResultText(draft.resultText);
            if (draft.notes) setNotes(draft.notes);
            toast.info('Draft Dipulihkan', 'Draft laporan corrective dipulihkan dari penyimpanan lokal.');
          }
        }
      });
    }
  }, [showForm, editingReport, effectiveUserId]);

  // Auto-save draft when inputs change
  useEffect(() => {
    if (showForm && !editingReport) {
      if (photos.length > 0 || problemDescription || actionTaken) {
        const draftPayload = {
          equipmentId,
          problemDescription,
          actionTaken,
          photos,
          result,
          resultText,
          notes,
          startTime,
          endTime,
        };
        localDB.saveDraft('corrective_form_draft', draftPayload, effectiveUserId);
      }
    }
  }, [
    showForm,
    editingReport,
    equipmentId,
    problemDescription,
    actionTaken,
    photos,
    result,
    resultText,
    notes,
    startTime,
    endTime,
    effectiveUserId,
  ]);

  const handleRemovePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleTechnician = (tech: string) => {
    if (selectedTechs.includes(tech)) {
      if (selectedTechs.length === 1) {
        toast.warning('Teknisi Diperlukan', 'Pilih minimal satu teknisi bertugas.');
        return;
      }
      setSelectedTechs((prev) => prev.filter((t) => t !== tech));
    } else {
      setSelectedTechs((prev) => [...prev, tech]);
    }
  };

  // Format WhatsApp Text helper
  const buildWhatsAppText = (data: {
    dateObj: Date;
    shift?: string;
    startTime: string;
    endTime: string;
    technicians: string[];
    equipmentName: string;
    locationName?: string;
    jenisAlat?: string;
    tipeModel?: string;
    problem: string;
    action: string;
    resultText: string;
    notes?: string;
  }) => {
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const months = [
      'Januari',
      'Februari',
      'Maret',
      'April',
      'Mei',
      'Juni',
      'Juli',
      'Agustus',
      'September',
      'Oktober',
      'November',
      'Desember',
    ];

    const dayName = days[data.dateObj.getDay()];
    const dateNum = String(data.dateObj.getDate()).padStart(2, '0');
    const monthName = months[data.dateObj.getMonth()];
    const year = data.dateObj.getFullYear();
    const shiftStr = data.shift ? ` Shift ${data.shift}.` : '.';
    const dateFormatted = `${dayName}, ${dateNum} ${monthName} ${year}${shiftStr}`;

    const techList = data.technicians && data.technicians.length > 0
      ? data.technicians.join(', ')
      : 'Teknisi';
    let locAlat = '-';
    const cleanEqName = (data.equipmentName || '').trim();
    const cleanLocName = (data.locationName || '').trim();
    if (cleanEqName && cleanLocName) {
      if (cleanEqName.toLowerCase() === cleanLocName.toLowerCase()) {
        locAlat = cleanEqName;
      } else if (cleanEqName.toLowerCase().includes(cleanLocName.toLowerCase())) {
        locAlat = cleanEqName;
      } else if (cleanLocName.toLowerCase().includes(cleanEqName.toLowerCase())) {
        locAlat = cleanLocName;
      } else {
        locAlat = `${cleanEqName} ${cleanLocName}`;
      }
    } else {
      locAlat = cleanEqName || cleanLocName || '-';
    }

    const rawAction = data.action || '-';
    const actionLines = rawAction.split('\n').map((l) => l.trim()).filter(Boolean);
    const formattedAction = actionLines
      .map((l) => (l.startsWith('-') || l.startsWith('•') ? l : `- ${l}`))
      .join('\n');

    return `*LAPORAN CORRECTIVE MAINTENANCE*
--------------------------
*Hari / Tanggal* : ${dateFormatted}
*Teknisi* : ${techList}
*Jam Mulai* : ${data.startTime || '-'}
*Jam Selesai* : ${data.endTime || '-'}
*Jenis Alat* : ${data.jenisAlat || 'X-Ray System'}
*Tipe / Model* : ${data.tipeModel || '-'}
*Lokasi Alat* : ${locAlat}
*Uraian Masalah* : 
${data.problem || '-'}
*Tindakan* : 
${formattedAction}
*Hasil* : ${data.resultText || 'Xray sudah bisa di Gunakan dengan Normal.'}

*_sent from nararyaapps.net_*`;
  };

  const handleStartEdit = (report: CorrectiveReport) => {
    if (isViewerOnly) {
      toast.warning('Akses Ditolak', 'Teknisi yang sedang LIBUR (Mode Baca Saja) tidak diizinkan mengubah laporan corrective.');
      return;
    }
    collageRetryRef.current = null;
    setEditingReport(report);
    const eq = (equipments || []).find((e) => e && e.id === Number(report.equipment_id));
    if (eq) {
      if (eq.equipment_type_id) {
        setSelectedTypeId(eq.equipment_type_id);
      }
      setEquipmentId(eq.id);
    }
    setProblemDescription(report.problem_description || '');
    setActionTaken(report.action_taken || '');
    setResult((report.result as any) || 'Resolved');
    setResultText(report.result_text || 'Xray sudah bisa di Gunakan dengan Normal 🙏🏻');
    setNotes(report.notes || '-');
    setStartTime(report.start_time || defaultStart);
    setEndTime(report.end_time || defaultEnd);
    setEventDate(report.corrective_date || operationalDate || getLocalDateString(new Date()));
    if (Array.isArray(report.technicians) && report.technicians.length > 0) {
      setSelectedTechs(report.technicians);
    } else if (report.created_by) {
      setSelectedTechs(report.created_by.split(',').map((s) => s.trim()));
    }
    if (Array.isArray(report.evidences) && report.evidences.length > 0) {
      setPhotos(report.evidences);
    } else {
      setPhotos([]);
    }
    setShowForm(true);
    toast.info('Mode Edit Aktif', {
      message: `Mengedit data laporan ${report.corrective_code || 'Corrective'}`,
      badge: 'Edit Mode',
    });
  };

  const handleCancelEdit = () => {
    collageRetryRef.current = null;
    submissionIdRef.current = crypto.randomUUID();
    setEditingReport(null);
    setProblemDescription('');
    setActionTaken('');
    setPhotos([]);
    setRecordReplacement(false);
    setComponentName('');
    setPartSerialNumber('');
    setReplacementReason('');
    setEventDate(operationalDate || getOperationalShift().operationalDate);
    setShowForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!problemDescription.trim() || !actionTaken.trim()) {
      toast.warning('Form Belum Lengkap', 'Mohon isi deskripsi masalah kerusakan dan tindakan perbaikan.');
      return;
    }

    if (photos.length === 0) {
      toast.warning('Foto Bukti Wajib Diunggah', {
        message: 'Laporan perbaikan wajib menyertakan minimal 1 foto dokumentasi perbaikan sebelum dapat disimpan.',
        badge: 'Foto Wajib',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const isEditing = Boolean(editingReport);
      const eq = (equipments || []).find((e) => e && e.id === Number(equipmentId));
      const rawDate = eventDate || operationalDate || getLocalDateString(new Date());
      const opShift = getOperationalShiftForCorrective({
        corrective_date: rawDate,
        start_time: startTime,
      });
      const dateStr = opShift.operationalDate;
      const resolvedShift = opShift.shift;
      const code = isEditing && editingReport?.corrective_code
        ? editingReport.corrective_code
        : `CR-${dateStr.replace(/-/g, '')}-${String(correctiveReports.length + 1).padStart(3, '0')}`;

      const loc = (locations || []).find((l) => l && l.id === eq?.location_id);
      const eqType = (equipmentTypes || []).find((t) => t && t.id === eq?.equipment_type_id);

      const driveFolderPath = buildDriveFolderPath({
        reportType: 'CORRECTIVE',
        operationalDate: dateStr,
        shift: resolvedShift,
        equipmentType: eqType?.name || 'EQUIPMENT',
        locationName: loc?.name || 'LOCATION',
        equipmentName: eq?.name || 'Equipment',
      });

      // Upload newly added photos (data:image URLs), keeping existing S3 keys/URLs
      const existingUrls = photos.filter((p) => typeof p === 'string' && !p.startsWith('data:image'));
      const newBase64Photos = photos.filter((p) => typeof p === 'string' && p.startsWith('data:image'));

      let uploadedEvidences: string[] = [];
      if (newBase64Photos.length > 0) {
        const uploadRes = await processAndUploadCorrectiveEvidences(newBase64Photos, driveFolderPath, {
          locationOrEquipment: loc?.name || eq?.name || 'LOCATION',
          startTime: startTime,
          correctiveDate: dateStr,
          shift: resolvedShift,
          recordId: editingReport?.event_id || editingReport?.id || submissionIdRef.current,
        });

        // Replace only successfully uploaded inputs with permanent keys. Unsuccessful
        // base64 inputs remain in the form/draft for a precise retry.
        let uploadIndex = 0;
        const recoverablePhotos = photos.map((photo) => {
          if (!photo.startsWith('data:image')) return photo;
          const uploaded = uploadRes.uploaded_results?.[uploadIndex++];
          return uploaded ? (extractS3ObjectKey(uploaded) || uploaded) : photo;
        });
        setPhotos(recoverablePhotos);
        if (!uploadRes.success || uploadRes.upload_status !== 'completed') {
          throw new Error(
            `Baru ${uploadRes.uploaded_evidence_count}/${uploadRes.expected_evidence_count} foto baru berhasil diunggah. ` +
            `${uploadRes.warning || uploadRes.last_upload_error || 'Mohon ulangi upload foto yang gagal.'} ` +
            'Foto yang berhasil tetap tersimpan, sedangkan foto gagal tetap ada di form untuk retry.'
          );
        }
        uploadedEvidences = uploadRes.evidences;
      }

      const cleanEvidences = Array.from(new Set(
        [...existingUrls, ...uploadedEvidences]
          .map((p) => extractS3ObjectKey(p) || p)
          .filter((p) => Boolean(p) && !isCollageEvidence(p))
      ));

      // Automatically generate 1 photo collage for this corrective ticket (Bagian D / Section 3)
      let correctiveCollageKey = (editingReport as any)?.collage_object_key || '';
      let correctiveCollageUrl = (editingReport as any)?.collage_url || '';

      const currentEvFingerprint = cleanEvidences.slice().sort().join('|');
      const prevEvFingerprint = (editingReport?.evidences || [])
        .map((p: string) => extractS3ObjectKey(p) || p)
        .filter((p: string) => Boolean(p) && !isCollageEvidence(p))
        .slice()
        .sort()
        .join('|');

      const cachedCollage = collageRetryRef.current;
      const isPhotoListUnchanged =
        (isEditing && Boolean(correctiveCollageKey) && currentEvFingerprint === prevEvFingerprint) ||
        (Boolean(cachedCollage?.key) && cachedCollage?.fingerprint === currentEvFingerprint);
      if (cachedCollage?.fingerprint === currentEvFingerprint) {
        correctiveCollageKey = cachedCollage.key;
        correctiveCollageUrl = cachedCollage.url;
      }

      if (cleanEvidences.length > 0 && !isPhotoListUnchanged) {
        try {
          const collageItems = cleanEvidences.map((item, idx) => ({
            key: `corr_${code}_${idx}`,
            title: `${eq?.name || 'Corrective'} #${idx + 1}`,
            dataUrl: getProxySafeImageUrl(item),
          }));

          const collageBlob = await generatePhotoCollageBlob({
            photos: collageItems,
            equipmentName: eq?.name || 'Security Equipment',
            locationName: loc?.name || '',
            equipmentType: eqType?.name || 'X-RAY',
            typeCode: eqType?.code || 'XRAY',
            date: dateStr,
            shift: resolvedShift === 'Malam' ? 'Malam' : 'Pagi',
            technicians: selectedTechs,
          });

          const collageFileName = `kolase_${code.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.jpg`;
          const collageFolder = `${driveFolderPath}/FOTO KOLASE`;

          const uploadCollage = await uploadBlobDirectToStorage(
            collageBlob,
            collageFolder,
            collageFileName,
            'image/jpeg',
            { entityType: 'corrective_collage', dateStr, shift: resolvedShift }
          );

          if (!uploadCollage.success || !uploadCollage.key) {
            throw new Error(uploadCollage.error || 'Upload kolase corrective gagal.');
          }
          correctiveCollageKey = uploadCollage.key;
          correctiveCollageUrl = storageProxyPath(uploadCollage.key) || uploadCollage.url || '';
          collageRetryRef.current = {
            fingerprint: currentEvFingerprint,
            key: correctiveCollageKey,
            url: correctiveCollageUrl,
          };
        } catch (colErr) {
          console.error('[Corrective Submit] Kolase wajib gagal:', colErr);
          throw new Error(`Laporan belum dikirim karena kolase gagal: ${colErr instanceof Error ? colErr.message : String(colErr)}`);
        }
      }
      if (cleanEvidences.length > 0 && !correctiveCollageKey) {
        throw new Error('Laporan belum dikirim karena referensi kolase corrective belum tersedia.');
      }

      const reportPayload: any = {
        ...(editingReport || {}),
        id: editingReport?.id,
        event_id: editingReport?.event_id,
        document_id: editingReport?.document_id,
        corrective_code: code,
        corrective_date: dateStr,
        shift: resolvedShift,
        equipment_id: Number(equipmentId),
        location_id: eq?.location_id || 1,
        problem_description: sanitizeMultilineText(problemDescription),
        action_taken: sanitizeMultilineText(actionTaken),
        result: result,
        result_text: sanitizeText(resultText),
        technicians: selectedTechs.map((t) => sanitizeText(t)),
        start_time: sanitizeText(startTime),
        end_time: sanitizeText(endTime),
        notes: sanitizeText(notes),
        created_by: selectedTechs.map((t) => sanitizeText(t)).join(', '),
        created_at: editingReport?.created_at || `${dateStr} ${startTime}`,
        updated_at: new Date().toISOString(),
        evidences: cleanEvidences,
        collage_object_key: correctiveCollageKey,
        collage_url: correctiveCollageUrl,
        folder_path: driveFolderPath || (editingReport as any)?.folder_path,
      };

      const saveOutcome = await onAddCorrective(reportPayload);
      const cloudSynced = Boolean(saveOutcome && saveOutcome.cloudSynced);
      setSubmittedReport(reportPayload);

      recordAuditLog({
        user_name: selectedTechs.join(', ') || 'Teknisi',
        role: role === 'supervisor' ? 'supervisor' : 'technician',
        action_type: isEditing ? 'CORRECTIVE_UPDATE' : 'CORRECTIVE_INPUT',
        title: `${isEditing ? 'Perbarui' : 'Input'} Corrective Maintenance #${code}`,
        details: `${isEditing ? 'Perubahan' : 'Penanganan'} perbaikan unit ${eq?.name || 'Equipment'} (${code}). Gejala: ${problemDescription.slice(0, 60)}.`,
      });

      if (!cloudSynced) {
        toast.warning('Corrective Menunggu Sinkronisasi', {
          message: `Laporan ${code} dan referensi evidence baru tersimpan di perangkat. Belum tercatat di Supabase, pengiriman notifikasi ditunda.`,
          badge: 'Antrean Lokal',
        });
      }

      // Kirim notifikasi hanya jika tiket baru SUDAH tersimpan di cloud.
      if (!isEditing && cloudSynced) {
        // Prepare WhatsApp Text
        const eqType = equipmentTypes.find((t) => t.id === eq?.equipment_type_id);
        const jenisAlat = eqType?.name || 'X-Ray System';
        let tipeModel = [eq?.brand, eq?.model].filter(Boolean).join(' - ');
        if (eq?.default_view || eq?.default_view_type) {
          const viewLabel = (eq.default_view_type || eq.default_view) === 'dual' ? 'Dual View' : 'Single View';
          if (!tipeModel.toLowerCase().includes(viewLabel.toLowerCase())) {
            tipeModel = tipeModel ? `${tipeModel} (${viewLabel})` : viewLabel;
          }
        }
        if (!tipeModel.trim()) {
          tipeModel = (eq as any)?.type || '-';
        }

        const dateParts = dateStr.split('-').map(Number);
        const waDateObj = dateParts.length === 3 ? new Date(dateParts[0], dateParts[1] - 1, dateParts[2]) : new Date();
        const waText = buildWhatsAppText({
          dateObj: waDateObj,
          shift: resolvedShift,
          startTime,
          endTime,
          technicians: selectedTechs.map((t) => sanitizeText(t)),
          equipmentName: eq?.name || 'Equipment',
          locationName: loc?.name || '',
          jenisAlat,
          tipeModel,
          problem: sanitizeMultilineText(problemDescription),
          action: sanitizeMultilineText(actionTaken),
          resultText: sanitizeText(resultText) || result || 'Xray sudah bisa di Gunakan dengan Normal.',
          notes: sanitizeText(notes),
        });
        setGeneratedReportText(waText);

        // 1. Telegram Notification (if configured)
        try {
          const tgConfig = getStoredTelegramConfig();
          if (tgConfig.enable_bot && tgConfig.auto_notify_preventive !== false) {
            const tgText = formatCorrectiveTelegramHtml({
              report: {
                corrective_code: code,
                problem_description: sanitizeMultilineText(problemDescription),
                action_taken: sanitizeMultilineText(actionTaken),
                result: result,
                result_text: sanitizeText(resultText),
                status: result as any,
                operational_date: dateStr,
                shift: resolvedShift,
                time_start: startTime,
                time_end: endTime,
                notes: sanitizeText(notes),
              },
              equipment: eq,
              location: loc,
              technicianNames: selectedTechs.map((t) => sanitizeText(t)),
              isNew: true,
            });

            sendTelegramMessage({ message: tgText, parseMode: 'HTML' }).catch((tgErr) => {
              console.warn('Gagal broadcast corrective ke Telegram:', tgErr);
            });
          }
        } catch (tgErr) {
          console.warn('Gagal format pesan Telegram corrective:', tgErr);
        }
      }

      // Save Spare Part Replacement if recorded
      if (recordReplacement && componentName.trim()) {
        try {
          await saveComponentReplacement({
            equipment_id: Number(equipmentId),
            equipment_name: eq?.name || 'Equipment',
            component_name: sanitizeText(componentName.trim()),
            replaced_at: dateStr,
            technician_names: selectedTechs.map((t) => sanitizeText(t)),
            reason: sanitizeMultilineText(replacementReason.trim() || problemDescription.trim() || 'Penggantian komponen rusak'),
            corrective_code: code,
            serial_number: sanitizeText(partSerialNumber.trim()) || undefined,
            origin: partOrigin,
            notes: `Dipasang pada penanganan corrective ${code}`,
          });
          toast.success('Penggantian Komponen Dicatat', {
            message: `Komponen ${componentName.trim()} berhasil ditambahkan ke riwayat masa pakai mesin.`,
            badge: 'Spare Part',
          });
        } catch (partErr) {
          console.warn('Gagal mencatat penggantian spare part:', partErr);
        }
      }

      // Clear local draft on confirmed successful submit
      try {
        await localDB.clearDraft('corrective_form_draft', effectiveUserId);
      } catch (_) {}

      // Reset Form
      collageRetryRef.current = null;
      submissionIdRef.current = crypto.randomUUID();
      setEditingReport(null);
      setProblemDescription('');
      setActionTaken('');
      setPhotos([]);
      setRecordReplacement(false);
      setComponentName('');
      setPartSerialNumber('');
      setReplacementReason('');
      setShowForm(false);
    } catch (err: any) {
      console.error('Corrective submit error:', err);
      toast.error('Gagal Menyimpan Laporan', err?.message || 'Terjadi kesalahan saat menyimpan laporan corrective.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyWA = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedToast(true);
    toast.success('Format WhatsApp Disalin', {
      message: 'Format laporan penanganan gangguan telah disalin ke clipboard.',
      badge: 'Corrective',
    });
    setTimeout(() => setCopiedToast(false), 2500);
  };

  return (
    <div className="space-y-4">
      {/* Top Header Card (Dashbyte Style) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs">
        <div>
          <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <Wrench className="w-4 h-4" />
            </div>
            <span>Corrective Maintenance</span>
          </h2>
        </div>

        {isViewerOnly ? (
          <div className="flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-full text-xs font-semibold shadow-2xs">
            <span>Mode Baca Saja (Libur)</span>
          </div>
        ) : (
          <button
            onClick={() => {
              if (showForm && editingReport) {
                handleCancelEdit();
              } else {
                setShowForm(!showForm);
              }
            }}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-full font-bold text-xs shadow-md shadow-indigo-500/20 transition-all cursor-pointer"
          >
            {showForm ? (
              <>
                <X className="w-4 h-4" />
                <span>{editingReport ? 'Batal Edit' : 'Tutup Form'}</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                <span>Buat Laporan Corrective</span>
              </>
            )}
          </button>
        )}
      </div>

      {isViewerOnly && (
        <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-2xl text-xs text-amber-900 flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            <b>Mode Pemantau (Libur / Tidak Terjadwal):</b> Anda tidak dijadwalkan bertugas pada shift ini. Data riwayat perbaikan dapat dilihat dalam mode Baca Saja.
          </span>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4 animate-in fade-in duration-150"
        >
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-600" />
              <span>
                {editingReport
                  ? `Edit Laporan Perbaikan (${editingReport.corrective_code})`
                  : 'Form Laporan Perbaikan (Corrective)'}
              </span>
            </h3>
            <span
              className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${
                editingReport
                  ? 'text-amber-700 bg-amber-50 border-amber-200'
                  : 'text-indigo-600 bg-indigo-50 border-indigo-100'
              }`}
            >
              {editingReport ? 'Mode Ubah Data' : 'Format WA Otomatis'}
            </span>
          </div>

          {/* Equipment Dropdown Split: Jenis Mesin & Peralatan */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                1. Jenis Mesin
              </label>
              <select
                value={selectedTypeId}
                onChange={(e) => handleTypeChange(Number(e.target.value))}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200/90 rounded-full text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-[#6366f1]"
              >
                {equipmentTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.code} - {type.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                2. Lokasi / Peralatan
              </label>
              <select
                value={equipmentId}
                onChange={(e) => setEquipmentId(Number(e.target.value))}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200/90 rounded-full text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-[#6366f1]"
              >
                {filteredEquipments.map((eq) => {
                  const loc = locations.find((l) => l.id === eq.location_id);
                  return (
                    <option key={eq.id} value={eq.id}>
                      {eq.name} ({loc?.name || 'Area Bandara'})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Recurring Fault Alert Banner for Selected Equipment */}
          {recurringFaultsForSelected.length > 0 && (
            <div className="space-y-2 pt-1">
              {recurringFaultsForSelected.map((rf, idx) => (
                <div
                  key={idx}
                  className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3 text-xs text-amber-950 shadow-2xs"
                >
                  <Flame className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-extrabold flex items-center gap-2 flex-wrap">
                      <span className="text-amber-900">⚠️ Recurring Fault Terdeteksi:</span>
                      <span className="bg-amber-200/90 text-amber-900 px-2 py-0.5 rounded-md text-[11px] font-black">
                        {rf.fault_keyword} ({rf.occurrences_count}x dalam 30 hari)
                      </span>
                    </div>
                    <div className="text-[11px] text-amber-900/80 leading-relaxed">
                      Mesin ini mengalami pola kendala berulang. Rekomendasi teknis: {rf.recommendation}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tanggal & Jam Pengerjaan */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5">
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                <span>Tanggal Laporan</span>
              </label>
              <input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200/90 rounded-full text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-[#6366f1]"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>Jam Mulai</span>
              </label>
              <input
                type="text"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                placeholder="misal: 13.30"
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200/90 rounded-full text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-[#6366f1]"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>Jam Selesai</span>
              </label>
              <input
                type="text"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                placeholder="misal: 14.00"
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200/90 rounded-full text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-[#6366f1]"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Hasil / Status
              </label>
              <select
                value={result}
                onChange={(e) =>
                  setResult(e.target.value as 'Resolved' | 'Pending Sparepart' | 'Temporary Fix')
                }
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200/90 rounded-full text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-[#6366f1]"
              >
                <option value="Resolved">Resolved (Selesai/Normal)</option>
                <option value="Temporary Fix">Temporary Fix (Sementara)</option>
                <option value="Pending Sparepart">Pending Sparepart (Suku Cadang)</option>
              </select>
            </div>
          </div>

          {/* Teknisi Multi-Select */}
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5 flex items-center gap-1">
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span>Pilih Teknisi Bertugas</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {availableTechs.map((tech) => {
                const isSelected = selectedTechs.includes(tech);
                return (
                  <button
                    key={tech}
                    type="button"
                    onClick={() => toggleTechnician(tech)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                      isSelected
                        ? 'bg-[#6366f1] text-white border-[#6366f1] shadow-xs'
                        : 'bg-slate-50 text-slate-600 border-slate-200/90 hover:bg-slate-100'
                    }`}
                  >
                    <Check className={`w-3.5 h-3.5 ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
                    <span>{tech}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Kerusakan */}
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Kerusakan (Problem Description)
            </label>
            <textarea
              rows={2}
              value={problemDescription}
              onChange={(e) => setProblemDescription(e.target.value)}
              placeholder="Contoh: Air tumpah kedalam baki conveyor belt."
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200/90 rounded-2xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-[#6366f1]"
            ></textarea>
          </div>

          {/* Tindakan */}
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Tindakan (Action Taken) - Pisahkan per baris
            </label>
            <textarea
              rows={3}
              value={actionTaken}
              onChange={(e) => setActionTaken(e.target.value)}
              placeholder={`Contoh:\nMelakukan pengecekan tumpahan air di conveyor belt, dalam tunnel, dan didalam mesin xray.\nMelakukan restart mesin xray\nMelakukan kalibrasi detector line.`}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200/90 rounded-2xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-[#6366f1] font-mono"
            ></textarea>
          </div>

          {/* Hasil & Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Pesan Hasil Laporan WA
              </label>
              <input
                type="text"
                value={resultText}
                onChange={(e) => setResultText(e.target.value)}
                placeholder="Contoh: Xray sudah bisa di Gunakan dengan Normal 🙏🏻"
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200/90 rounded-full text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-[#6366f1]"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Catatan Tambahan (Notes)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Catatan tambahan (default: -)"
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200/90 rounded-full text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-[#6366f1]"
              />
            </div>
          </div>

          {/* Photo Upload Field (Max 10) */}
          <div className="border-t border-slate-100 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Camera className="w-4 h-4 text-indigo-600" />
                <span>Upload Foto Dokumentasi Corrective ({photos.length}/10 Foto)</span>
                <span className="text-rose-600 font-extrabold normal-case text-xs">* (Wajib Diunggah)</span>
              </label>
            </div>

            {photos.length === 0 && (
              <p className="text-[11px] text-rose-600 font-semibold bg-rose-50 border border-rose-200/80 rounded-xl px-3 py-1.5 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Wajib melampirkan minimal 1 foto dokumentasi perbaikan sebelum menyimpan laporan.</span>
              </p>
            )}

            {photos.length < 10 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* Option 1: Direct Camera */}
                <label className="cursor-pointer bg-slate-50 hover:bg-indigo-50/40 border border-slate-200 hover:border-indigo-300 rounded-xl p-2.5 flex items-center gap-2.5 transition-all shadow-2xs group">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                    <Camera className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-slate-800 block truncate">Ambil Kamera</span>
                    <span className="text-[10px] text-slate-500 font-medium block truncate">Kamera HP / Webcam Laptop</span>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                </label>

                {/* Option 2: Folder / File / Gallery Picker */}
                <label className="cursor-pointer bg-slate-50 hover:bg-blue-50/40 border border-slate-200 hover:border-blue-300 rounded-xl p-2.5 flex items-center gap-2.5 transition-all shadow-2xs group">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                    <Upload className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-slate-800 block truncate">Pilih File / Galeri</span>
                    <span className="text-[10px] text-slate-500 font-medium block truncate">Folder HP / Laptop / PC</span>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                </label>
              </div>
            )}

            {/* Photo Thumbnails Preview Grid */}
            {photos.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {photos.map((photo, idx) => (
                  <div
                    key={idx}
                    className="relative aspect-square rounded-2xl overflow-hidden border border-slate-200/90 group bg-slate-100"
                  >
                    <img
                      src={photo}
                      alt={`Foto Corrective ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button
                        type="button"
                        onClick={() => handleRemovePhoto(idx)}
                        className="p-1.5 bg-red-600 text-white rounded-full hover:bg-red-700 transition-all cursor-pointer shadow-md"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <span className="absolute bottom-1.5 left-1.5 bg-black/60 text-white text-[10px] font-bold px-2 py-0.5 rounded-full backdrop-blur-xs">
                      #{idx + 1}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 border border-dashed border-slate-200/90 rounded-2xl text-center bg-slate-50/50">
                <p className="text-xs text-slate-400 font-medium">
                  Belum ada foto diunggah. Anda dapat mengunggah hingga 10 foto bukti perbaikan.
                </p>
              </div>
            )}
          </div>

          {/* Spare Part / Component Replacement Field */}
          <div className="border-t border-slate-100 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={recordReplacement}
                  onChange={(e) => setRecordReplacement(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                />
                <Cpu className="w-4 h-4 text-indigo-600" />
                <span>Catat Penggantian Spare Part / Komponen Mesin?</span>
              </label>
              {recordReplacement && (
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                  Masa Pakai Akan Dilacak
                </span>
              )}
            </div>

            {recordReplacement && (
              <div className="p-4 bg-indigo-50/40 border border-indigo-100 rounded-2xl space-y-3 animate-in fade-in duration-150">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                      Nama Komponen
                    </label>
                    <input
                      type="text"
                      value={componentName}
                      onChange={(e) => setComponentName(e.target.value)}
                      placeholder="cth: Detector Board, Solenoid Shutter"
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                      Nomor Seri (S/N)
                    </label>
                    <input
                      type="text"
                      value={partSerialNumber}
                      onChange={(e) => setPartSerialNumber(e.target.value)}
                      placeholder="cth: SN-9942A (opsional)"
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                      Asal Komponen
                    </label>
                    <select
                      value={partOrigin}
                      onChange={(e) => setPartOrigin(e.target.value as any)}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="Baru">Baru (Gudang AVSEC)</option>
                      <option value="Kolekan Cadangan">Kolekan dari Mesin Cadangan</option>
                      <option value="Rekondisi">Rekondisi / Servis Ulang</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                    Alasan Penggantian
                  </label>
                  <input
                    type="text"
                    value={replacementReason}
                    onChange={(e) => setReplacementReason(e.target.value)}
                    placeholder="Kosongkan jika sama dengan deskripsi kerusakan"
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={handleCancelEdit}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-full text-xs transition-all cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`px-5 py-2 font-bold rounded-full text-xs shadow-md transition-all flex items-center gap-1.5 text-white disabled:opacity-60 disabled:cursor-not-allowed ${
                isSubmitting
                  ? 'bg-slate-400 cursor-not-allowed shadow-none'
                  : editingReport
                  ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/20 cursor-pointer'
                  : 'bg-[#6366f1] hover:bg-[#4f46e5] shadow-indigo-500/20 cursor-pointer'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {isSubmitting
                  ? 'Menyimpan...'
                  : editingReport
                  ? 'Simpan Perubahan'
                  : 'Simpan & Buat Laporan WA'}
              </span>
            </button>
          </div>
        </form>
      )}

      {/* Generated WhatsApp Report Modal */}
      {generatedReportText && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-in fade-in duration-150 relative border border-slate-200/80">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-emerald-600">
                <Share2 className="w-5 h-5" />
                <h3 className="font-extrabold text-sm sm:text-base text-slate-900">Format Laporan WhatsApp</h3>
              </div>
              <button
                onClick={() => setGeneratedReportText(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-4 font-mono text-xs text-slate-800 whitespace-pre-wrap max-h-80 overflow-y-auto leading-relaxed select-all">
              {generatedReportText}
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => handleCopyWA(generatedReportText)}
                className="w-full sm:w-auto px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-full text-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {copiedToast ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span className="text-emerald-700">Berhasil Disalin!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-slate-600" />
                    <span>Salin Laporan WA</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={isSendingTelegram}
                onClick={async () => {
                  setIsSendingTelegram(true);
                  try {
                    const eq = equipments.find((e) => e.id === Number(equipmentId));
                    const tgHtml = formatCorrectiveTelegramHtml({
                      report: {
                        corrective_code: 'CR-' + new Date().toISOString().slice(0, 10).replace(/-/g, ''),
                        problem_description: problemDescription || 'Laporan gangguan peralatan',
                        action_taken: actionTaken || 'Tindakan perbaikan telah dilakukan',
                        status: result as any,
                        operational_date: operationalDate,
                        shift,
                        time_start: startTime,
                        time_end: endTime,
                        notes: notes,
                      },
                      equipment: eq,
                      technicianNames: selectedTechs,
                      isNew: true,
                    });
                    const res = await sendTelegramMessage({
                      message: tgHtml,
                      parseMode: 'HTML',
                    });

                    if (res.success) {
                      toast.success('Disiarkan ke Telegram', {
                        message: 'Laporan perbaikan berhasil dikirim ke bot Telegram.',
                        badge: 'Notifikasi Otomatis',
                      });
                    } else {
                      const plain = convertHtmlToPlainText(tgHtml);
                      window.open(getTelegramShareUrl(plain), '_blank');
                      toast.info('Buka Telegram Web', {
                        message: `${res.error || 'Bot belum diatur'}. Membuka tautan Telegram.`,
                        badge: 'Telegram',
                      });
                    }
                  } catch (err: any) {
                    toast.error('Gagal Mengirim Telegram', {
                      message: err.message || 'Terjadi kesalahan jaringan.',
                    });
                  } finally {
                    setIsSendingTelegram(false);
                  }
                }}
                className="w-full sm:w-auto px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white font-bold rounded-full text-xs shadow-md shadow-sky-200 transition-all flex items-center justify-center gap-2 text-center cursor-pointer disabled:opacity-60"
              >
                <Send className="w-4 h-4" />
                <span>{isSendingTelegram ? 'Mengirim...' : 'Kirim Telegram'}</span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  try {
                    const activeReport = submittedReport || editingReport;
                    const activeEvidences = activeReport?.evidences || photos;
                    let file: File | undefined = undefined;

                    if (activeReport?.collage_url) {
                      try {
                        const blobUrl = await fetchAuthenticatedImageBlob(activeReport.collage_url);
                        const res = await fetch(blobUrl);
                        if (res.ok) {
                          const blob = await res.blob();
                          file = new File(
                            [blob],
                            `Kolase_Corrective_${activeReport.corrective_code || 'Laporan'}.jpg`,
                            { type: 'image/jpeg' }
                          );
                        }
                      } catch (_) {}
                    }

                    if (!file && activeEvidences.length > 0) {
                      const photosList = activeEvidences.filter((url) => !isCollageEvidence(url)).map((url, i) => ({
                        key: `photo_${i}`,
                        title: `Foto ${i + 1}`,
                        dataUrl: getProxySafeImageUrl(url),
                      }));
                      file = await generatePhotoCollageFile(
                        {
                          photos: photosList,
                          equipmentName: equipments.find((e) => e.id === Number(equipmentId))?.name || 'Equipment',
                          technicians: selectedTechs,
                        },
                        `Kolase_Corrective_${activeReport?.corrective_code || operationalDate || 'Laporan'}.jpg`
                      );
                    }
                    await shareReport({
                      title: 'Laporan Corrective Maintenance',
                      text: generatedReportText,
                      files: file ? [file] : undefined,
                    });
                  } catch (e) {
                    console.warn('[WebShare] Gagal share corrective, fallback ke WA:', e);
                    window.open(`https://wa.me/?text=${encodeURIComponent(generatedReportText)}`, '_blank');
                  }
                }}
                className="w-full sm:w-auto px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-full text-xs shadow-md shadow-emerald-200 transition-all flex items-center justify-center gap-2 text-center cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>Kirim Laporan</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List of Corrective Reports History & Filterable Table */}
      <CorrectiveReportsTable
        correctiveReports={correctiveReports}
        equipments={equipments}
        equipmentTypes={equipmentTypes}
        locations={locations}
        role={role}
        isViewerOnly={isViewerOnly}
        onDeleteCorrective={role === 'supervisor' ? onDeleteCorrective : undefined}
        onEditCorrective={isViewerOnly ? undefined : handleStartEdit}
        onSelectReportForWa={(_report, formattedWaText) => {
          setGeneratedReportText(formattedWaText);
        }}
      />
    </div>
  );
};
