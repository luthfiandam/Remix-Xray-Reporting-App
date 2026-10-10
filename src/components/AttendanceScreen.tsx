import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Camera,
  RotateCcw,
  Check,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  MapPinOff,
  SwitchCamera,
  LogIn,
  LogOut,
  MapPin,
  Clock,
  User,
  FileText,
  HelpCircle,
  UserCheck,
} from 'lucide-react';
import { Technician, AttendanceRecord, AttendanceLocation } from '../types';
import {
  getJakartaDateString,
  getJakartaTimeString,
  getJakartaISOString,
  detectDefaultShift,
  calculateAttendanceStatus,
  saveAttendanceRecord,
  validateWorkLocation,
  calculateDistanceMeters,
  AIRPORT_BASE_COORDINATES,
  getAllAttendanceHistory,
} from '../services/attendanceService';
import { applyAttendanceWatermark } from '../utils/watermark';
import { sanitizeText, sanitizeMultilineText } from '../utils/sanitizer';
import { toast } from './Toast';
import {
  formatAttendanceTelegramHtml,
  sendTelegramMessage,
  sendTelegramPhoto,
  getStoredTelegramConfig,
} from '../services/telegramService';
import {
  formatAttendanceWhatsAppText,
  sendWhatsAppAttendance,
  getWhatsAppStatus,
} from '../services/whatsappService';
import { uploadBlobDirectToStorage, isIdCloudHostStorageActive } from '../services/storageService';
import { getAttendanceFolderPathAndFileName } from '../utils/storagePathUtils';
import { ResolvedAttendanceStatus } from '../services/attendanceService';

interface AttendanceScreenProps {
  technicians: Technician[];
  currentUserProfile?: any;
  currentUserEmail?: string;
  defaultTechnicianName?: string;
  isScheduleUndefined?: boolean;
  isModal?: boolean;
  attendanceStatus?: ResolvedAttendanceStatus | null;
  scheduledShift?: 'Pagi' | 'Malam' | 'Office';
  operationalDate?: string;
  onCompleteAttendance: (record: AttendanceRecord) => void;
  onBypassAttendance?: (record?: AttendanceRecord) => void;
  onOffDuty?: (record?: AttendanceRecord) => void;
  onLogout: () => void;
}

export const AttendanceScreen: React.FC<AttendanceScreenProps> = ({
  technicians,
  currentUserProfile,
  currentUserEmail,
  defaultTechnicianName,
  isModal = false,
  attendanceStatus,
  scheduledShift,
  operationalDate,
  onCompleteAttendance,
  onBypassAttendance,
  onOffDuty,
  onLogout,
}) => {
  // Mode Absen: Masuk vs Pulang (Determined automatically by schedule / attendance state or manual toggle)
  const [selectedActionType, setSelectedActionType] = useState<'masuk' | 'pulang' | null>(null);

  const attendanceType: 'masuk' | 'pulang' = useMemo(() => {
    if (selectedActionType) {
      return selectedActionType;
    }
    if (attendanceStatus?.actionType) {
      return attendanceStatus.actionType;
    }
    return 'masuk';
  }, [selectedActionType, attendanceStatus]);

  // 1. Identify Technician Name - Prioritize currently logged in technician
  const technicianName = useMemo(() => {
    if (currentUserProfile?.display_name && currentUserProfile.display_name.trim()) {
      return currentUserProfile.display_name.trim();
    }
    if (currentUserProfile?.name && currentUserProfile.name.trim()) {
      return currentUserProfile.name.trim();
    }
    if (currentUserEmail) {
      const emailPrefix = currentUserEmail.split('@')[0].toLowerCase();
      const match = technicians.find(
        (t) =>
          t.name.toLowerCase() === emailPrefix ||
          emailPrefix.includes(t.name.toLowerCase()) ||
          t.name.toLowerCase().includes(emailPrefix)
      );
      if (match) return match.name;
    }
    if (defaultTechnicianName && defaultTechnicianName.trim()) {
      return defaultTechnicianName.trim();
    }
    const activeTech = technicians.find((t) => t.active);
    return activeTech ? activeTech.name : 'Teknisi Operasional';
  }, [currentUserProfile, currentUserEmail, defaultTechnicianName, technicians]);

  // Automatic Shift Resolution (No manual toggle)
  const selectedShift: 'Pagi' | 'Malam' | 'Office' = useMemo(() => {
    if (attendanceStatus?.shift) return attendanceStatus.shift;
    if (scheduledShift) return scheduledShift;
    return detectDefaultShift();
  }, [attendanceStatus, scheduledShift]);
  const [handoverNotes, setHandoverNotes] = useState<string>('');
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [isProcessingPhoto, setIsProcessingPhoto] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isCheckoutSuccess, setIsCheckoutSuccess] = useState<boolean>(false);

  // Popup Modal State for "Kamu terlalu jauh dari bandara" or GPS errors
  const [gpsModalState, setGpsModalState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    details?: string;
    allowBypass?: boolean;
  }>({
    isOpen: false,
    title: '',
    message: '',
    allowBypass: false,
  });

  // Camera Refs & State
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeSessionIdRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [isStartingCamera, setIsStartingCamera] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Stop Camera helper
  const stopCamera = () => {
    // Invalidate any ongoing startCamera session
    activeSessionIdRef.current += 1;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {
          console.warn('Error stopping track:', e);
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (isMountedRef.current) {
      setIsCameraActive(false);
      setIsStartingCamera(false);
    }
  };

  // Start Live Camera with robust progressive fallbacks and lifecycle safety
  const startCamera = async (targetFacing: 'user' | 'environment' = facingMode) => {
    // Increment session ID to discard stale async resolution
    const sessionId = ++activeSessionIdRef.current;

    // Clean up current stream before requesting new one
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch (e) {
          console.warn('Error stopping previous track:', e);
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraError(null);
    setIsStartingCamera(true);
    setIsCameraActive(false);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (sessionId === activeSessionIdRef.current && isMountedRef.current) {
        setCameraError(
          'Browser tidak mendukung akses kamera langsung (mediaDevices API tidak tersedia). Silakan gunakan tombol "Gunakan Kamera HP" atau buka aplikasi di tab/browser modern dengan koneksi HTTPS.'
        );
        setIsStartingCamera(false);
      }
      return;
    }

    let stream: MediaStream | null = null;
    let lastError: any = null;

    // Fallback cascade:
    // 1. Exact/ideal facing mode with standard 1280x720 resolution
    // 2. facingMode only (no resolution constraints)
    // 3. Simple video: true (universal fallback for devices/browsers that reject facingMode)
    const constraintSteps: MediaStreamConstraints[] = [
      {
        video: {
          facingMode: targetFacing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      {
        video: {
          facingMode: targetFacing,
        },
        audio: false,
      },
      {
        video: true,
        audio: false,
      },
    ];

    for (let i = 0; i < constraintSteps.length; i++) {
      // If component unmounted or another session started, abort
      if (sessionId !== activeSessionIdRef.current || !isMountedRef.current) {
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia(constraintSteps[i]);
        if (stream) break; // Success!
      } catch (err: any) {
        lastError = err;
        console.warn(`getUserMedia attempt ${i + 1} failed:`, err.name, err.message);

        // If permission was explicitly denied, further fallbacks will also fail with NotAllowedError
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          break;
        }
      }
    }

    // Check again if this session is still the active one
    if (sessionId !== activeSessionIdRef.current || !isMountedRef.current) {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      return;
    }

    if (!stream) {
      let errMsg = 'Tidak dapat mengakses kamera perangkat.';
      if (lastError) {
        if (lastError.name === 'NotAllowedError' || lastError.name === 'PermissionDeniedError') {
          errMsg = 'Izin kamera ditolak di browser. Harap klik ikon gembok / kamera pada address bar browser untuk mengizinkan akses kamera, atau gunakan tombol "Gunakan Kamera HP".';
        } else if (lastError.name === 'NotFoundError' || lastError.name === 'DevicesNotFoundError') {
          errMsg = 'Kamera tidak terdeteksi pada perangkat ini. Pastikan kamera terpasang dan aktif.';
        } else if (lastError.name === 'NotReadableError' || lastError.name === 'TrackStartError') {
          errMsg = 'Kamera sedang digunakan oleh aplikasi/tab lain. Tutup aplikasi atau tab lain lalu coba lagi.';
        } else if (lastError.name === 'OverconstrainedError') {
          errMsg = 'Spesifikasi kamera yang diminta tidak didukung oleh perangkat.';
        } else if (lastError.name === 'SecurityError') {
          errMsg = 'Akses kamera dibatasi oleh kebijakan keamanan browser (pastikan menggunakan HTTPS atau tab baru).';
        } else {
          errMsg = `Gagal membuka kamera: ${lastError.message || lastError.name}`;
        }
      }
      setCameraError(errMsg);
      setIsStartingCamera(false);
      setIsCameraActive(false);
      return;
    }

    // Stream successfully acquired
    streamRef.current = stream;

    // Attach stream to video element safely
    const attachVideo = async () => {
      if (sessionId !== activeSessionIdRef.current || !isMountedRef.current) {
        return;
      }

      const video = videoRef.current;
      if (!video) {
        // Video element not rendered or momentarily detached; wait a frame
        requestAnimationFrame(attachVideo);
        return;
      }

      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.muted = true;

      try {
        await video.play();
      } catch (playErr) {
        console.warn('video.play() autoplay exception handled:', playErr);
        // Fallback: trigger play once metadata is loaded
        video.onloadedmetadata = () => {
          if (sessionId === activeSessionIdRef.current && isMountedRef.current) {
            video.play().catch((e) => console.warn('Retry play error:', e));
          }
        };
      }

      if (sessionId === activeSessionIdRef.current && isMountedRef.current) {
        setIsCameraActive(true);
        setIsStartingCamera(false);
      }
    };

    attachVideo();
  };

  // Switch between front and back camera
  const handleToggleFacingMode = () => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);
    startCamera(nextMode);
  };

  // Lifecycle management: track mounted status and start camera on initial load
  useEffect(() => {
    isMountedRef.current = true;
    if (!photoDataUrl) {
      startCamera(facingMode);
    }
    return () => {
      isMountedRef.current = false;
      stopCamera();
    };
  }, []); // Run on mount; photoDataUrl reset will explicitly call startCamera

  // Capture Photo
  const capturePhoto = async () => {
    if (!videoRef.current) return;
    setIsProcessingPhoto(true);

    try {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Gagal menyiapkan kanvas foto');

      // Mirror selfie only if front camera
      if (facingMode === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const raw = canvas.toDataURL('image/jpeg', 0.9);
      stopCamera();
      setPhotoDataUrl(raw);
    } catch (err: any) {
      console.error('Capture error:', err);
      toast.error('Gagal mengambil foto: ' + err.message);
    } finally {
      setIsProcessingPhoto(false);
    }
  };

  // Upload / Native HP Camera fallback
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingPhoto(true);
    stopCamera();

    const reader = new FileReader();
    reader.onload = () => {
      setPhotoDataUrl(reader.result as string);
      setIsProcessingPhoto(false);
      toast.success('Foto berhasil diambil');
    };
    reader.onerror = () => {
      setIsProcessingPhoto(false);
      toast.error('Gagal membaca file foto');
    };
    reader.readAsDataURL(file);

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRetake = () => {
    setPhotoDataUrl(null);
    startCamera(facingMode);
  };

  // Process and save attendance record with given location coordinates
  const processAttendanceSubmission = async (
    lat: number,
    lng: number,
    acc: number,
    isSimulated: boolean = false
  ) => {
    try {
      setIsSubmitting(true);
      const validation = validateWorkLocation(lat, lng, acc);

      // Check if within radius of Bandara Halim Perdanakusuma (skip distance rejection if simulated/bypass)
      if (!isSimulated && !validation.isWithinRadius) {
        setIsSubmitting(false);
        setGpsModalState({
          isOpen: true,
          title: 'Presensi Ditolak',
          message: 'Kamu terlalu jauh dari bandara',
          details: `Lokasi Anda terdeteksi berjarak ${(validation.distanceMeters / 1000).toFixed(1)} km dari Bandara Halim Perdanakusuma. Presensi wajib dilakukan di dalam area bandara (maks radius ${(AIRPORT_BASE_COORDINATES.maxRadiusMeters / 1000).toFixed(1)} km).`,
          allowBypass: false,
        });
        return;
      }

      // Location is valid: apply watermark and save attendance
      const dateStr = attendanceStatus?.operationalDate || operationalDate || getJakartaDateString();
      const timeStr = getJakartaTimeString();
      const status =
        attendanceType === 'pulang'
          ? 'Tepat Waktu'
          : calculateAttendanceStatus(selectedShift);

      const locationData: AttendanceLocation = {
        latitude: lat,
        longitude: lng,
        accuracy: acc,
        area_name: 'Bandara Halim Perdanakusuma',
        distance_meters: isSimulated ? 0 : Math.round(validation.distanceMeters),
        is_within_radius: true,
      };

      const watermarkedPhoto = await applyAttendanceWatermark(photoDataUrl!, {
        technicianName,
        attendanceType,
        shift: selectedShift,
        timeString: timeStr,
        dateString: dateStr,
        status,
        locationInfo: {
          latitude: lat,
          longitude: lng,
          accuracy: acc,
          areaName: 'Bandara Halim Perdanakusuma',
          isWithinRadius: true,
        },
      });

      const recordId = `att-${attendanceType}-${dateStr}-${technicianName.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now()}`;
      let finalPhotoUrl = watermarkedPhoto;
      let photoObjectKey: string | undefined = undefined;

      // Upload to IDCloudHost S3 Object Storage with standardized path via presigned PUT upload
      try {
        const isS3Active = await isIdCloudHostStorageActive();
        if (isS3Active && watermarkedPhoto.startsWith('data:image/')) {
          const cleanTech = technicianName.replace(/[^a-zA-Z0-9]/g, '_');
          // Convert data URL to Blob for direct binary PUT upload
          const parts = watermarkedPhoto.split(',');
          const mimeMatch = parts[0].match(/:(.*?);/);
          const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
          const bstr = atob(parts[1]);
          let n = bstr.length;
          const u8arr = new Uint8Array(n);
          while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
          }
          const photoBlob = new Blob([u8arr], { type: mime });

          const effectiveTechId = currentUserProfile?.technician_id != null ? currentUserProfile.technician_id : undefined;

          const attPathInfo = getAttendanceFolderPathAndFileName({
            dateStr: dateStr,
            shift: selectedShift,
            technicianId: effectiveTechId,
            technicianName: technicianName,
            attendanceType: attendanceType,
            ext: 'jpg',
          });

          const s3Res = await uploadBlobDirectToStorage(
            photoBlob,
            attPathInfo.folderPath,
            attPathInfo.fileName,
            'image/jpeg',
            {
              entityType: 'attendance',
              dateStr: dateStr,
              shift: selectedShift,
              entityId: effectiveTechId || technicianName,
              technicianName: technicianName,
              attendanceType: attendanceType,
            }
          );
          if (s3Res.success) {
            if (s3Res.url) finalPhotoUrl = s3Res.url;
            if (s3Res.key) photoObjectKey = s3Res.key;
          }
        }
      } catch (s3Err) {
        console.warn('IDCloudHost S3 upload for attendance warning:', s3Err);
      }

      const finalNotes = sanitizeMultilineText(
        handoverNotes.trim() ||
        (isSimulated
          ? (attendanceType === 'pulang'
              ? 'Absen pulang selesai shift di Bandara Halim Perdanakusuma (Mode LAN/HTTP)'
              : status === 'Sangat Terlambat'
              ? 'Absen masuk (Sangat Terlambat) di Bandara Halim Perdanakusuma'
              : 'Absen masuk valid di Bandara Halim Perdanakusuma (Mode LAN/HTTP)')
          : (attendanceType === 'pulang'
              ? `Absen pulang selesai shift di Bandara Halim Perdanakusuma (jarak ${validation.distanceMeters}m)`
              : status === 'Sangat Terlambat'
              ? `Absen masuk (Sangat Terlambat) di Bandara Halim Perdanakusuma (jarak ${validation.distanceMeters}m)`
              : `Absen masuk valid di Bandara Halim Perdanakusuma (jarak ${validation.distanceMeters}m)`))
      );

      const verificationStatus = 'verified';

      const record: AttendanceRecord = {
        id: recordId,
        technician_id: currentUserProfile?.technician_id,
        technician_name: sanitizeText(technicianName),
        attendance_type: attendanceType,
        shift: selectedShift,
        attendance_date: dateStr,
        attendance_time: timeStr,
        status,
        verification_status: verificationStatus,
        photo_url: finalPhotoUrl,
        photo_object_key: photoObjectKey,
        location: locationData,
        notes: finalNotes,
        created_at: getJakartaISOString(),
      };

      saveAttendanceRecord(record);

      // Resolve check-in time if checking out
      let foundCheckInTime: string | undefined;
      if (attendanceType === 'pulang') {
        try {
          const allHistory = getAllAttendanceHistory();
          const cleanTech = technicianName.trim().toLowerCase();
          const match = allHistory.find(
            (r) =>
              r.attendance_type === 'masuk' &&
              r.technician_name.trim().toLowerCase() === cleanTech &&
              (r.attendance_date === dateStr || r.shift === selectedShift)
          );
          if (match && match.attendance_time) {
            foundCheckInTime = match.attendance_time;
          }
        } catch (_) {}
      }

      // Broadcast attendance report to Telegram
      try {
        const tgConfig = getStoredTelegramConfig();
        if (tgConfig.enable_bot && tgConfig.auto_notify_attendance !== false) {
          const tgHtml = formatAttendanceTelegramHtml({
            technicianName,
            attendanceType,
            shift: selectedShift,
            date: dateStr,
            time: timeStr,
            locationName: locationData.area_name,
            gpsCoords: { latitude: lat, longitude: lng, accuracy: acc },
            distanceMeters: isSimulated ? 0 : validation.distanceMeters,
            status: status === 'Sangat Terlambat' ? 'very_late' : (status === 'Telat' ? 'late' : 'ontime'),
            notes: record.notes,
            checkInTime: foundCheckInTime,
          });

          const photoToSend = watermarkedPhoto || photoDataUrl;
          const sendPromise = photoToSend
            ? sendTelegramPhoto({
                photo: photoToSend,
                caption: tgHtml,
                parseMode: 'HTML',
              })
            : sendTelegramMessage({ message: tgHtml, parseMode: 'HTML' });

          sendPromise
            .then((res) => {
              if (res.success) {
                toast.success('Laporan Presensi Terkirim', {
                  message: `Presensi & foto ${attendanceType.toUpperCase()} ${technicianName} telah dikirim ke Telegram.`,
                  badge: 'Telegram Bot',
                });
              }
            })
            .catch((err) => console.warn('Gagal kirim telegram presensi:', err));
        }
      } catch (tgErr) {
        console.warn('Gagal format telegram presensi:', tgErr);
      }

      // Broadcast attendance report to WhatsApp (Baileys)
      try {
        const waStatus = await getWhatsAppStatus().catch(() => null);
        if (waStatus && waStatus.config && waStatus.config.auto_notify_attendance === false) {
          console.log('[WhatsApp Presensi] Notifikasi WhatsApp presensi dinonaktifkan di pengaturan.');
        } else {
          const photoToSend = watermarkedPhoto || photoDataUrl;
          const waText = formatAttendanceWhatsAppText({
            technicianName,
            attendanceType,
            shift: selectedShift,
            date: dateStr,
            time: timeStr,
            status: status === 'Sangat Terlambat' ? 'very_late' : (status === 'Telat' ? 'late' : 'ontime'),
            notes: record.notes,
            checkInTime: foundCheckInTime,
          });

          sendWhatsAppAttendance({
            photo: photoToSend,
            caption: waText,
          }).catch((err) => console.warn('Gagal kirim WhatsApp presensi:', err));
        }
      } catch (waErr) {
        console.warn('Gagal format WhatsApp presensi:', waErr);
      }

      if (attendanceType === 'pulang') {
        setIsCheckoutSuccess(true);
        toast.success('Presensi Pulang Selesai', {
          message: `Terima kasih atas tugas & dedikasi Anda hari ini, ${technicianName}! Sesi shift Anda telah selesai, otomatis logout...`,
          badge: 'Shift Selesai',
        });
        setTimeout(() => {
          setGpsModalState((prev) => ({ ...prev, isOpen: false }));
          onCompleteAttendance(record);
        }, 1800);
      } else {
        toast.success('Presensi Masuk Diterima', {
          message: `Selamat bertugas, ${technicianName}!`,
          badge: 'Tervalidasi',
        });
        setGpsModalState((prev) => ({ ...prev, isOpen: false }));
        onCompleteAttendance(record);
      }
    } catch (err: any) {
      toast.error('Gagal memproses presensi: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit and verify GPS location
  const handleSubmitAttendance = async () => {
    if (!photoDataUrl) {
      toast.error('Foto selfie verifikasi wajib diambil terlebih dahulu!');
      return;
    }

    setIsSubmitting(true);

    // Get real-time GPS position from browser
    if (!navigator.geolocation) {
      setIsSubmitting(false);
      setGpsModalState({
        isOpen: true,
        title: 'Izin Lokasi (Mode HTTP LAN)',
        message: 'Browser membatasi sensor GPS pada akses IP Lokal HTTP',
        details: 'Karena aplikasi diakses via IP LAN HTTP (' + (window.location.hostname || 'IP') + '), browser Android memblokir sensor lokasi otomatis. Anda dapat melanjutkan dengan Lokasi Standar Bandara Halim.',
        allowBypass: true,
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        processAttendanceSubmission(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, false);
      },
      (err) => {
        setIsSubmitting(false);
        const isContextInsecure = typeof window !== 'undefined' && window.isSecureContext === false;
        let msg = 'Harap aktifkan GPS / izin lokasi pada perangkat Anda untuk melakukan presensi.';
        let allowBypass = true;

        if (err.code === err.PERMISSION_DENIED) {
          if (isContextInsecure) {
            msg = 'Browser memblokir izin GPS otomatis karena diakses via HTTP IP LAN (' + (window.location.hostname || 'IP') + '). Anda dapat melanjutkan menggunakan Lokasi Bandara Halim.';
          } else {
            msg = 'Izin lokasi (GPS) ditolak oleh browser. Harap aktifkan izin lokasi di browser atau lanjutkan dengan Lokasi Standar Bandara.';
          }
        } else if (err.code === err.TIMEOUT) {
          msg = 'Waktu pencarian GPS habis. Pastikan Anda berada di area dengan sinyal lokasi yang baik.';
        }

        setGpsModalState({
          isOpen: true,
          title: 'Izin Lokasi Diperlukan',
          message: 'Sistem tidak dapat memverifikasi lokasi GPS',
          details: msg,
          allowBypass,
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  return (
    <div
      className={
        isModal
          ? 'fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex flex-col justify-center items-center p-3 sm:p-4 animate-in fade-in duration-150 overflow-y-auto'
          : 'min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-center items-center p-3 sm:p-4 font-sans relative overflow-x-hidden'
      }
    >
      {/* Background ambient gradient (only for full-page mode) */}
      {!isModal && (
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(14,165,233,0.12),rgba(255,255,255,0))] pointer-events-none" />
      )}

      {/* Checkout Success Feedback Card */}
      {isCheckoutSuccess ? (
        <div className="relative z-10 w-full max-w-sm sm:max-w-md bg-slate-800/95 backdrop-blur-md rounded-2xl border border-emerald-500/40 shadow-2xl p-6 text-center my-auto flex flex-col items-center gap-3.5 animate-in fade-in zoom-in-95 duration-200">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <CheckCircle2 className="w-9 h-9" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">Presensi Pulang Berhasil!</h2>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
              Terima kasih atas tugas dan dedikasi Anda hari ini, <b className="text-white">{technicianName}</b>.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-300 px-3.5 py-2 rounded-xl bg-slate-900/80 border border-slate-700/80 mt-1">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400 shrink-0" />
            <span>Sesi shift selesai. Mengalihkan ke login...</span>
          </div>
        </div>
      ) : (
        /* Main Absen Card */
        <div className="relative z-10 w-full max-w-sm sm:max-w-md bg-slate-800/95 backdrop-blur-md rounded-2xl border border-slate-700/80 shadow-2xl overflow-hidden my-auto flex flex-col">
        {/* Header with Close (X) button */}
        <div className="px-5 py-3.5 bg-slate-800/90 border-b border-slate-700/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                attendanceType === 'masuk' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400 animate-pulse'
              }`}
            />
            <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">
              {attendanceType === 'masuk' ? 'Presensi: Absen Masuk' : 'Presensi: Absen Pulang'}
            </h1>
          </div>
          <button
            type="button"
            onClick={onLogout}
            title="Tutup & Keluar"
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 space-y-3.5">
          {/* Personel & Automatic Shift Bar */}
          <div className="flex items-center justify-between bg-slate-900/90 px-3.5 py-2.5 rounded-xl border border-slate-700/80">
            <div className="min-w-0 pr-2">
              <span className="text-[10px] text-slate-400 block uppercase font-semibold tracking-wider">
                Teknisi Bertugas
              </span>
              <p className="text-xs sm:text-sm font-bold text-white truncate">{technicianName}</p>
            </div>

            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700/90 shrink-0">
              <span
                className={`w-2 h-2 rounded-full ${
                  selectedShift.toLowerCase().includes('malam') ? 'bg-indigo-400' : 'bg-amber-400'
                }`}
              />
              <span className="text-xs font-bold text-slate-200">
                Shift {selectedShift}
              </span>
            </div>
          </div>

          {/* Selfie Camera Viewport Section */}
          <div className="relative aspect-4/3 w-full max-h-56 sm:max-h-64 bg-slate-950 rounded-xl overflow-hidden border border-slate-700 flex items-center justify-center shadow-inner">
            {/* The video element is ALWAYS mounted to prevent null ref stream bugs */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover transform ${
                facingMode === 'user' ? '-scale-x-100' : ''
              } ${isCameraActive && !photoDataUrl ? 'block' : 'hidden'}`}
            />

            {/* Oval Face Guide when Camera is Active */}
            {isCameraActive && !photoDataUrl && (
              <>
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div
                    className={`w-36 h-48 sm:w-40 sm:h-52 border-2 border-dashed ${
                      attendanceType === 'masuk' ? 'border-emerald-400/80' : 'border-rose-400/80'
                    } rounded-[50%] shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]`}
                  />
                </div>

                {/* Flip Camera Button on Viewport */}
                <button
                  type="button"
                  onClick={handleToggleFacingMode}
                  title="Putar Kamera Depan / Belakang"
                  className="absolute top-2 left-2 z-20 p-2 bg-black/60 hover:bg-black/80 text-white rounded-full border border-white/20 backdrop-blur-xs transition cursor-pointer shadow"
                >
                  <SwitchCamera className="w-4 h-4" />
                </button>

                {/* Active Indicator */}
                <div className="absolute top-2 right-2 z-20 px-2 py-0.5 bg-black/60 text-[10px] font-semibold text-emerald-300 rounded-full border border-white/10 backdrop-blur-xs flex items-center gap-1.5 shadow">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  <span>Live {facingMode === 'user' ? 'Depan' : 'Belakang'}</span>
                </div>
              </>
            )}

            {/* Photo Preview when Captured */}
            {photoDataUrl && (
              <div className="relative w-full h-full">
                <img
                  src={photoDataUrl}
                  alt="Foto Selfie"
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-2 right-2 bg-emerald-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 shadow">
                  <Check className="w-3.5 h-3.5" />
                  <span>Foto Terpilih</span>
                </div>
                <div className="absolute bottom-2 left-2 right-2 text-center text-[10px] font-medium bg-black/75 text-slate-200 py-1 px-2 rounded-lg backdrop-blur-xs border border-white/10">
                  Stempel GPS &amp; Waktu Operasional Bandara Halim
                </div>
              </div>
            )}

            {/* Inactive or Loading Placeholder */}
            {!photoDataUrl && !isCameraActive && (
              <div className="p-4 text-center space-y-3 z-10">
                {isStartingCamera ? (
                  <div className="flex flex-col items-center gap-2 text-slate-300">
                    <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
                    <p className="text-xs font-semibold">Menghubungkan ke kamera...</p>
                    <p className="text-[11px] text-slate-400">Harap izinkan akses kamera jika browser meminta izin.</p>
                  </div>
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-full bg-slate-800/80 border border-slate-700 flex items-center justify-center mx-auto text-slate-400">
                      <Camera className="w-6 h-6" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-slate-200">
                        {cameraError ? 'Kendala Akses Kamera' : 'Kamera Belum Aktif'}
                      </p>
                      <p className="text-[11px] text-slate-400 max-w-xs mx-auto leading-relaxed">
                        {cameraError || 'Kamera langsung belum aktif atau sedang memuat.'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center pt-1">
                      <button
                        type="button"
                        onClick={() => startCamera(facingMode)}
                        className="py-1.5 px-3 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg cursor-pointer transition shadow"
                      >
                        Buka Kamera Lagi
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="py-1.5 px-3 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold rounded-lg cursor-pointer transition border border-slate-600"
                      >
                        Gunakan Kamera HP
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Notes Input for Absen Pulang or Sangat Terlambat */}
          {(attendanceType === 'pulang' || calculateAttendanceStatus(selectedShift) === 'Sangat Terlambat') && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <FileText className={`w-3.5 h-3.5 ${attendanceType === 'pulang' ? 'text-rose-400' : 'text-amber-400'}`} />
                <span>
                  {attendanceType === 'pulang'
                    ? 'Catatan Serah Terima / Selesai Shift (Opsional)'
                    : 'Alasan Keterlambatan (Wajib diisi jika Sangat Terlambat)'}
                </span>
              </label>
              <textarea
                value={handoverNotes}
                onChange={(e) => setHandoverNotes(e.target.value)}
                placeholder={
                  attendanceType === 'pulang'
                    ? 'Contoh: Seluruh X-Ray normal, serah terima kunci & logbook ke regu malam...'
                    : 'Tuliskan alasan keterlambatan kehadiran...'
                }
                rows={2}
                className={`w-full px-3 py-2 bg-slate-900/90 border ${
                  attendanceType === 'pulang'
                    ? 'border-slate-700 focus:ring-rose-500 focus:border-rose-500'
                    : 'border-amber-500/40 focus:ring-amber-500 focus:border-amber-500'
                } rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 transition`}
              />
            </div>
          )}

          {/* Photo Action Buttons */}
          <div className="flex items-center gap-2">
            {!photoDataUrl ? (
              <>
                <button
                  type="button"
                  onClick={capturePhoto}
                  disabled={!isCameraActive || isProcessingPhoto}
                  className={`flex-1 py-2.5 px-4 ${
                    attendanceType === 'masuk'
                      ? 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 shadow-emerald-600/25'
                      : 'bg-rose-600 hover:bg-rose-500 active:bg-rose-700 shadow-rose-600/25'
                  } disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md`}
                >
                  {isProcessingPhoto ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Camera className="w-4 h-4" />
                  )}
                  <span>Jepret Foto Selfie</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Buka Kamera Bawaan HP / Ambil dari Galeri"
                  className="py-2.5 px-3 bg-slate-700 hover:bg-slate-600 active:bg-slate-800 text-slate-200 font-semibold rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 border border-slate-600"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Kamera HP</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="user"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </>
            ) : (
              <button
                type="button"
                onClick={handleRetake}
                className="w-full py-2.5 px-3 bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer border border-slate-600"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Ambil Ulang Foto</span>
              </button>
            )}
          </div>

          {/* Location Information Badge */}
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-900/60 rounded-xl border border-slate-800 text-[11px] text-slate-400">
            <MapPin className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="truncate">Lokasi Presensi: Bandara Halim Perdanakusuma (Radius 2.5 km)</span>
          </div>

          {/* Status Warning Badge when Button is Disabled / Waiting / Expired */}
          {attendanceStatus && !attendanceStatus.isActionable && (
            <div className="p-3 bg-amber-500/15 border border-amber-500/40 rounded-xl text-amber-300 text-xs font-semibold text-center flex items-center justify-center gap-2 shadow-2xs">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{attendanceStatus.sublabel || attendanceStatus.label}</span>
            </div>
          )}

          {/* Main Submit Button */}
          <button
            type="button"
            onClick={handleSubmitAttendance}
            disabled={!photoDataUrl || isSubmitting || (attendanceStatus ? !attendanceStatus.isActionable : false)}
            className={`w-full py-3 px-4 ${
              attendanceType === 'masuk'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:from-emerald-700 active:to-teal-700 shadow-emerald-700/20'
                : 'bg-gradient-to-r from-rose-600 to-orange-600 hover:from-rose-500 hover:to-orange-500 active:from-rose-700 active:to-orange-700 shadow-rose-700/20'
            } disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 transition-all shadow-lg cursor-pointer`}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Memeriksa Lokasi GPS Bandara...</span>
              </>
            ) : attendanceStatus && !attendanceStatus.isActionable ? (
              <span>Tombol Terdisable ({attendanceStatus.label})</span>
            ) : (
              <span>
                {attendanceType === 'masuk' ? 'Kirim Presensi (Absen Masuk)' : 'Kirim Presensi (Absen Pulang)'}
              </span>
            )}
          </button>

          {/* Special Bypass Option strictly for Luthfi / Supervisor */}
          {Boolean(
            (technicianName?.toLowerCase().includes('luthfi') ||
              currentUserProfile?.role === 'supervisor' ||
              currentUserEmail?.toLowerCase().includes('luthfi')) &&
            onBypassAttendance
          ) && (
            <button
              type="button"
              onClick={() => {
                if (onBypassAttendance) {
                  onBypassAttendance();
                  toast.info('Bypass Presensi Aktif', {
                    message: 'Anda masuk tanpa mencatat presensi shift (Bypass Khusus Luthfi).',
                  });
                }
              }}
              className="w-full py-2.5 px-4 bg-slate-900/80 hover:bg-slate-800 text-amber-300 hover:text-amber-200 border border-amber-500/40 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <UserCheck className="w-3.5 h-3.5 text-amber-400" />
              <span>Bypass Khusus Luthfi / Lewati Presensi</span>
            </button>
          )}
        </div>
      </div>
      )}

      {/* Pop Up Modal: "Kamu terlalu jauh dari bandara" / GPS Error */}
      {gpsModalState.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-sm bg-slate-800 border border-slate-700 rounded-2xl p-5 shadow-2xl space-y-3.5 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-500/20 border border-rose-500/40 flex items-center justify-center mx-auto text-rose-400">
              <MapPinOff className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-bold text-white">
                {gpsModalState.title}
              </h3>
              <p className="text-sm font-semibold text-rose-300 mt-1">
                {gpsModalState.message}
              </p>
              {gpsModalState.details && (
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed bg-slate-900/60 p-2.5 rounded-xl border border-slate-700/60 text-left">
                  {gpsModalState.details}
                </p>
              )}
            </div>

            <div className="pt-1 flex flex-col gap-2">
              {gpsModalState.allowBypass && (
                <button
                  type="button"
                  onClick={() => {
                    processAttendanceSubmission(
                      AIRPORT_BASE_COORDINATES.latitude,
                      AIRPORT_BASE_COORDINATES.longitude,
                      10,
                      true
                    );
                  }}
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Lanjutkan dengan Lokasi Bandara Halim</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setGpsModalState((prev) => ({ ...prev, isOpen: false }))}
                className="w-full py-2 px-4 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-xl text-xs transition-colors cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
