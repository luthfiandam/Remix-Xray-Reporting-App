import React, { useState, useEffect, useMemo } from 'react';
import { 
  ArrowLeft, 
  Search, 
  Calendar, 
  Wrench, 
  CheckCircle2, 
  Clock, 
  ChevronDown, 
  ChevronUp, 
  FileText, 
  ExternalLink,
  SlidersHorizontal,
  Activity,
  AlertCircle,
  QrCode,
  TrendingUp,
  Cpu,
  Layers,
  Flame,
  Send,
  Trash2,
  MapPin,
  X,
  ClipboardCheck,
  AlertTriangle,
} from 'lucide-react';
import { Equipment, Technician, ShiftType, PreventiveEntry, CorrectiveReport, Location, EquipmentType, Role, ComponentReplacement } from '../types';
import { 
  EquipmentTimelineItem, 
  fetchEquipmentTimelineFromFirestore 
} from '../services/equipmentTimeline';
import { formatIndonesianDate, formatTimeShort, formatTimeRange } from '../utils/timeFormat';
import { MeasurementTrendChart } from './MeasurementTrendChart';
import { MachineQrModal } from './MachineQrModal';
import { getRecurringFaultsForEquipment } from '../utils/faultDetection';
import { calculateComponentAge, getComponentAgeLabel, deleteComponentReplacement, isDummyReplacement } from '../services/componentReplacementService';
import {
  formatRecurringFaultTelegramHtml,
  sendTelegramMessage,
  getTelegramShareUrl,
  convertHtmlToPlainText,
} from '../services/telegramService';
import { toast } from './Toast';

interface EquipmentTimelineViewProps {
  equipmentId: number;
  equipment?: Equipment;
  datasetId: string;
  isLoggedIn: boolean;
  currentUserUid: string | null;
  techniciansList: Technician[];
  onBack: () => void;
  locations?: Location[];
  equipmentTypes?: EquipmentType[];
  role?: Role;
  preventiveEntries?: PreventiveEntry[];
  correctiveReports?: CorrectiveReport[];
  onDeletePreventiveEntry?: (entry: PreventiveEntry) => void | Promise<void>;
  onStartPreventive?: (equipmentId: number) => void;
  onOpenCorrective?: (equipmentId: number) => void;
}

export function EquipmentTimelineView({
  equipmentId,
  equipment,
  datasetId,
  isLoggedIn,
  currentUserUid,
  techniciansList,
  onBack,
  locations = [],
  equipmentTypes = [],
  role,
  preventiveEntries = [],
  correctiveReports = [],
  onDeletePreventiveEntry,
  onStartPreventive,
  onOpenCorrective,
}: EquipmentTimelineViewProps) {
  // State
  const [timelineItems, setTimelineItems] = useState<EquipmentTimelineItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Delete preventive record state
  const [preventiveToDelete, setPreventiveToDelete] = useState<PreventiveEntry | null>(null);
  const [isDeletingPreventive, setIsDeletingPreventive] = useState(false);

  // Delete component replacement state
  const [componentToDelete, setComponentToDelete] = useState<ComponentReplacement | null>(null);
  const [isDeletingComponent, setIsDeletingComponent] = useState(false);

  // Tab & Modal State
  const [activeViewTab, setActiveViewTab] = useState<'timeline' | 'trends'>('timeline');
  const [showQrModal, setShowQrModal] = useState(false);

  const targetLocation = useMemo(
    () => (locations || []).find((l) => l && l.id === equipment?.location_id),
    [locations, equipment]
  );
  const targetType = useMemo(
    () => (equipmentTypes || []).find((t) => t && t.id === equipment?.equipment_type_id),
    [equipmentTypes, equipment]
  );

  const handleConfirmDeletePreventive = async () => {
    if (!preventiveToDelete || !onDeletePreventiveEntry) return;
    setIsDeletingPreventive(true);
    try {
      await onDeletePreventiveEntry(preventiveToDelete);
      setTimelineItems((prev) =>
        prev.filter((item) => item?.rawPreventive?.id !== preventiveToDelete.id)
      );
      setPreventiveToDelete(null);
    } catch (err: any) {
      console.error('Gagal hapus preventif:', err);
    } finally {
      setIsDeletingPreventive(false);
    }
  };

  const handleConfirmDeleteComponent = async () => {
    if (!componentToDelete) return;
    setIsDeletingComponent(true);
    try {
      await deleteComponentReplacement(componentToDelete.id);
      setTimelineItems((prev) =>
        prev.filter((item) => item?.rawComponent?.id !== componentToDelete.id)
      );
      setComponentToDelete(null);
    } catch (err: any) {
      console.error('Gagal hapus komponen:', err);
    } finally {
      setIsDeletingComponent(false);
    }
  };

  // Filters State
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'preventive' | 'corrective' | 'component'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');

  // Expanded Items State
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  // Map technician IDs to names safely
  const technicianMap = useMemo(() => {
    const map = new Map<number, string>();
    (techniciansList || []).forEach((t) => {
      if (t && t.id != null) {
        map.set(t.id, t.name || '');
      }
    });
    return map;
  }, [techniciansList]);

  // Load data - Exactly 1 Preventive Query + 1 Corrective Query per equipment/load cycle
  useEffect(() => {
    let active = true;

    async function loadData() {
      if (!isLoggedIn || !currentUserUid) {
        if (active) {
          setError('Sesi login telah berakhir.');
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setError(null);

      // Simple frequency map for preventive labels
      const frequencyMap: Record<number, string> = {
        1: 'Harian',
        2: 'Mingguan',
        3: 'Bulanan',
        4: 'Triwulan',
        5: 'Semesteran',
        6: 'Tahunan'
      };

      const result = await fetchEquipmentTimelineFromFirestore(equipmentId, datasetId, frequencyMap);

      if (active) {
        if (result.success) {
          const cleanItems = (result.data || []).filter((item) => {
            if (item.source === 'component' && item.rawComponent) {
              return !isDummyReplacement(item.rawComponent);
            }
            return true;
          });
          setTimelineItems(cleanItems);
        } else {
          setError(result.message || 'Gagal memuat timeline.');
        }
        setIsLoading(false);
      }
    }

    loadData();

    return () => {
      active = false;
    };
  }, [equipmentId, datasetId, isLoggedIn, currentUserUid]);

  // Toggle card expansion
  const toggleExpand = (itemId: string) => {
    setExpandedItems(prev => ({
      ...prev,
      [itemId]: !prev[itemId]
    }));
  };

  // Extract unique years & months for filter selection dropdowns
  const { years, months } = useMemo(() => {
    const yearsSet = new Set<string>();
    const monthsSet = new Set<string>();

    timelineItems.forEach((item) => {
      if (item.operational_date && item.operational_date.length >= 7) {
        const yr = item.operational_date.substring(0, 4);
        const mn = item.operational_date.substring(5, 7);
        yearsSet.add(yr);
        monthsSet.add(mn);
      }
    });

    return {
      years: Array.from(yearsSet).sort((a, b) => b.localeCompare(a)),
      months: Array.from(monthsSet).sort((a, b) => a.localeCompare(b))
    };
  }, [timelineItems]);

  const monthNamesIndonesian: Record<string, string> = {
    '01': 'Januari',
    '02': 'Februari',
    '03': 'Maret',
    '04': 'April',
    '05': 'Mei',
    '06': 'Juni',
    '07': 'Juli',
    '08': 'Agustus',
    '09': 'September',
    '10': 'Oktober',
    '11': 'November',
    '12': 'Desember'
  };

  // Preventive entries for trend extraction (sorted oldest to newest)
  const equipmentPreventiveEntries = useMemo(() => {
    // 1. Live entries passed as prop
    const propPrev = (preventiveEntries || [])
      .filter((e) => e && Number(e.equipment_id) === Number(equipmentId) && !String(e.operational_date || '').includes('1899'));

    // 2. Entries from timelineItems (fetched)
    const timelinePrev = timelineItems
      .filter((i) => i.source === 'preventive' && i.rawPreventive)
      .map((i) => i.rawPreventive!)
      .filter((e) => e && Number(e.equipment_id) === Number(equipmentId) && !String(e.operational_date || '').includes('1899'));

    // 3. Deduplicate by composite key
    const map = new Map<string, PreventiveEntry>();
    [...timelinePrev, ...propPrev].forEach((item) => {
      const key = `${item.id || ''}_${item.operational_date || ''}_${item.shift || ''}_${item.sequence || ''}`;
      map.set(key, item);
    });

    return Array.from(map.values()).sort((a, b) => (a.operational_date || '').localeCompare(b.operational_date || ''));
  }, [preventiveEntries, timelineItems, equipmentId]);

  // Corrective reports for recurring fault detection
  const equipmentCorrectiveReports = useMemo(() => {
    const propCorr = (correctiveReports || [])
      .filter((c) => c && Number(c.equipment_id) === Number(equipmentId));

    const timelineCorr = timelineItems
      .filter((i) => i.source === 'corrective' && i.rawCorrective)
      .map((i) => i.rawCorrective!)
      .filter((c) => c && Number(c.equipment_id) === Number(equipmentId));

    const map = new Map<string, CorrectiveReport>();
    [...timelineCorr, ...propCorr].forEach((item) => {
      const key = `${item.id || ''}_${item.corrective_code || ''}`;
      map.set(key, item);
    });

    return Array.from(map.values());
  }, [correctiveReports, timelineItems, equipmentId]);

  // Recurring faults detected for this equipment (>= 3 occurrences in 30 days)
  const recurringFaults = useMemo(() => {
    return getRecurringFaultsForEquipment(equipmentId, equipmentCorrectiveReports, 30, 3);
  }, [equipmentId, equipmentCorrectiveReports]);

  // Core metrics derived with ZERO writes
  const metrics = useMemo(() => {
    let totalPrev = 0;
    let totalCorr = 0;
    let corrLast30Days = 0;
    let totalComponents = 0;
    let lastCorrective: EquipmentTimelineItem | null = null;

    // Base 30 days calculation using Asia/Jakarta timezone boundary (using local machine time offset correctly)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    timelineItems.forEach((item) => {
      if (item.source === 'preventive') {
        totalPrev++;
      } else if (item.source === 'corrective') {
        totalCorr++;
        
        // Find latest corrective
        if (!lastCorrective) {
          lastCorrective = item;
        }

        // 30 Days ago boundary check
        if (item.operational_date) {
          const itemDate = new Date(item.operational_date);
          if (itemDate >= thirtyDaysAgo) {
            corrLast30Days++;
          }
        }
      } else if (item.source === 'component') {
        totalComponents++;
      }
    });

    return {
      totalPrev,
      totalCorr,
      corrLast30Days,
      totalComponents,
      lastCorrective
    };
  }, [timelineItems]);

  // Filtered Items logic
  const filteredItems = useMemo(() => {
    return timelineItems.filter((item) => {
      // Category filter
      if (categoryFilter === 'preventive' && item.source !== 'preventive') return false;
      if (categoryFilter === 'corrective' && item.source !== 'corrective') return false;
      if (categoryFilter === 'component' && item.source !== 'component') return false;

      // Year filter
      if (selectedYear !== 'all') {
        const yr = item.operational_date?.substring(0, 4);
        if (yr !== selectedYear) return false;
      }

      // Month filter
      if (selectedMonth !== 'all') {
        const mn = item.operational_date?.substring(5, 7);
        if (mn !== selectedMonth) return false;
      }

      // Search query (case-insensitive)
      if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase();
        
        // Tech names resolution
        const resolvedTechNames = item.source === 'preventive'
          ? (item.technicians.map(id => technicianMap.get(Number(id)) || id))
          : item.technicians;

        const matchesCode = item.title.toLowerCase().includes(query);
        const matchesSummary = item.summary?.toLowerCase().includes(query);
        const matchesTechs = resolvedTechNames.some(name => name.toLowerCase().includes(query));
        
        if (!matchesCode && !matchesSummary && !matchesTechs) {
          return false;
        }
      }

      return true;
    });
  }, [timelineItems, categoryFilter, selectedYear, selectedMonth, searchQuery, technicianMap]);

  return (
    <div className="w-full p-4 space-y-4" id="equipment-timeline-view-container">
      {/* Navigation and Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 transition text-slate-700 cursor-pointer"
            id="timeline-btn-back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-base font-bold text-slate-900 leading-tight">
              Riwayat & Timeline Alat
            </h1>
            <p className="text-xs text-slate-500">
              {equipment ? `${equipment.name} (${equipment.equipment_code})` : 'Riwayat Maintenance Alat'}
            </p>
          </div>
        </div>

        {/* Selected Equipment Metadata Header Badge & Location Card */}
        <div className="flex flex-wrap items-center gap-2">
          {onStartPreventive && (
            <button
              onClick={() => onStartPreventive(equipment?.id || equipmentId)}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
            >
              <ClipboardCheck className="w-3.5 h-3.5" />
              <span>Checklist Preventif</span>
            </button>
          )}
          {onOpenCorrective && (
            <button
              onClick={() => onOpenCorrective(equipment?.id || equipmentId)}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>Lapor Kerusakan</span>
            </button>
          )}
          {equipment && (
            <button
              onClick={() => setShowQrModal(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Cetak QR Mesin</span>
            </button>
          )}
          <button
            onClick={onBack}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border border-slate-200 shadow-2xs"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Pilih Mesin Lain</span>
          </button>
          {equipment && (
            <div className="flex items-center gap-2.5 bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-2xs">
              <div className="w-7 h-7 rounded-md bg-blue-50 text-blue-700 border border-blue-200 flex items-center justify-center shrink-0 font-bold text-xs">
                <MapPin className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">LOKASI PENEMPATAN</div>
                <div className="text-xs font-bold text-slate-800">
                  {targetLocation?.name || (equipment?.location_id ? `Lokasi ID ${equipment.location_id}` : 'Area Bandara')} &bull; {targetType?.name || equipment?.brand || 'Peralatan'}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Tab Switcher: Timeline vs Measurement Trends */}
      <div className="inline-flex bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold">
        <button
          onClick={() => setActiveViewTab('timeline')}
          className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
            activeViewTab === 'timeline'
              ? 'bg-white text-blue-700 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Timeline & Penggantian Komponen</span>
        </button>
        <button
          onClick={() => setActiveViewTab('trends')}
          className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
            activeViewTab === 'trends'
              ? 'bg-white text-blue-700 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" />
          <span>Tren Parameter Fisik (KV & Arus)</span>
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16 bg-white border border-slate-200 rounded-lg">
          <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-slate-500 mt-3 font-medium">Memuat data timeline alat...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-12 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <AlertCircle className="w-10 h-10 mb-2.5 text-red-500" />
          <p className="text-xs font-bold">{error}</p>
          <button 
            onClick={onBack} 
            className="mt-3 px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs transition cursor-pointer"
          >
            Kembali
          </button>
        </div>
      ) : activeViewTab === 'trends' ? (
        <MeasurementTrendChart
          entries={equipmentPreventiveEntries}
          equipment={equipment}
          equipmentId={equipmentId}
          equipmentName={equipment?.name}
          onStartPreventive={onStartPreventive}
        />
      ) : (
        <>
          {/* Summary Metrics Section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" id="timeline-metrics-grid">
            {/* Total Preventive */}
            <div className="bg-white border border-slate-200 p-3.5 rounded-lg flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[10px] text-slate-400 font-bold tracking-wider uppercase">Total Preventif</div>
                <div className="text-xl font-bold text-slate-900 leading-tight" id="metric-total-preventive">{metrics.totalPrev}</div>
                <div className="text-[11px] text-slate-500">Sesi pemeriksaan</div>
              </div>
            </div>

            {/* Total Corrective */}
            <div className="bg-white border border-slate-200 p-3.5 rounded-lg flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center">
                <Wrench className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[10px] text-slate-400 font-bold tracking-wider uppercase">Total Corrective</div>
                <div className="text-xl font-bold text-slate-900 leading-tight" id="metric-total-corrective">{metrics.totalCorr}</div>
                <div className="text-[11px] text-slate-500">Laporan gangguan</div>
              </div>
            </div>

            {/* Corrective 30 Days */}
            <div className="bg-white border border-slate-200 p-3.5 rounded-lg flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 border border-red-100 flex items-center justify-center">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[10px] text-slate-400 font-bold tracking-wider uppercase">Last 30 Hari</div>
                <div className="text-xl font-bold text-slate-900 leading-tight" id="metric-corrective-30days">{metrics.corrLast30Days}</div>
                <div className="text-[11px] text-red-600 font-medium">Corrective aktif</div>
              </div>
            </div>

            {/* Total Component Replacements */}
            <div className="bg-white border border-slate-200 p-3.5 rounded-lg flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center">
                <Cpu className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[10px] text-slate-400 font-bold tracking-wider uppercase">Komponen Diganti</div>
                <div className="text-xl font-bold text-slate-900 leading-tight" id="metric-total-components">{metrics.totalComponents}</div>
                <div className="text-[11px] text-indigo-600 font-medium">Riwayat spare part</div>
              </div>
            </div>
          </div>

          {/* Recurring Fault Alert Banner */}
          {recurringFaults.length > 0 && (
            <div className="space-y-2">
              {recurringFaults.map((rf, idx) => (
                <div
                  key={idx}
                  className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3 text-xs text-amber-950 shadow-2xs"
                >
                  <Flame className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="space-y-1 flex-1">
                    <div className="font-extrabold flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-amber-900">⚠️ Recurring Fault Terdeteksi:</span>
                        <span className="bg-amber-200 text-amber-900 px-2 py-0.5 rounded font-black text-[11px]">
                          {rf.fault_keyword} ({rf.occurrences_count}x dalam 30 hari)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const html = formatRecurringFaultTelegramHtml({
                              equipmentName: rf.equipment_name || 'Equipment',
                              faultKeyword: rf.fault_keyword,
                              occurrencesCount: rf.occurrences_count,
                              days: rf.window_days || 30,
                              recommendation: rf.recommendation,
                            });
                            const res = await sendTelegramMessage({
                              message: html,
                              parseMode: 'HTML',
                            });
                            if (res.success) {
                              toast.success('Peringatan Terkirim', {
                                message: `Eskalasi recurring fault ${rf.equipment_name} berhasil dikirim ke grup Telegram.`,
                                badge: 'Telegram Bot',
                              });
                            } else {
                              const plain = convertHtmlToPlainText(html);
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
                          }
                        }}
                        className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg text-[10px] flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
                      >
                        <Send className="w-3 h-3" />
                        <span>Kirim ke Telegram</span>
                      </button>
                    </div>
                    <div className="text-[11px] text-amber-800 leading-relaxed">
                      Rekomendasi teknis: {rf.recommendation}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Interactive Filters Grid */}
          <div className="bg-white border border-slate-200 p-3.5 rounded-lg flex flex-col gap-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              {/* Category Quick Chips */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setCategoryFilter('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    categoryFilter === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                  id="filter-chip-all"
                >
                  Semua ({timelineItems.length})
                </button>
                <button
                  onClick={() => setCategoryFilter('preventive')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    categoryFilter === 'preventive'
                      ? 'bg-blue-600 text-white'
                      : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                  }`}
                  id="filter-chip-preventive"
                >
                  Preventive ({metrics.totalPrev})
                </button>
                <button
                  onClick={() => setCategoryFilter('corrective')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    categoryFilter === 'corrective'
                      ? 'bg-amber-600 text-white'
                      : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                  }`}
                  id="filter-chip-corrective"
                >
                  Corrective ({metrics.totalCorr})
                </button>
                <button
                  onClick={() => setCategoryFilter('component')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    categoryFilter === 'component'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                  }`}
                  id="filter-chip-component"
                >
                  Komponen ({metrics.totalComponents})
                </button>
              </div>

              {/* Free-text Search */}
              <div className="relative flex-1 max-w-md">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <Search className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  placeholder="Cari kode, gejala, teknisi..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-800"
                  id="timeline-search-input"
                />
              </div>
            </div>

            {/* Dropdown Filters (Year & Month) */}
            <div className="flex flex-wrap items-center gap-2.5 border-t border-slate-100 pt-2.5">
              <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1.5 uppercase tracking-wider">
                <SlidersHorizontal className="w-3 h-3" /> Filter Tanggal:
              </span>

              {/* Year Dropdown */}
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1 text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                id="timeline-filter-year"
              >
                <option value="all">Semua Tahun</option>
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>

              {/* Month Dropdown */}
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1 text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                id="timeline-filter-month"
              >
                <option value="all">Semua Bulan</option>
                {months.map((m) => (
                  <option key={m} value={m}>{monthNamesIndonesian[m] || m}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Timeline Node Chain Card Container */}
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 bg-white border border-slate-200 rounded-lg text-slate-500">
              <Calendar className="w-10 h-10 text-slate-300 mb-2" />
              <p className="font-bold text-xs text-slate-700">Tidak Ada Riwayat Maintenance</p>
              <p className="text-[11px] text-slate-400 mt-0.5" id="timeline-empty-message">
                Belum ada riwayat maintenance untuk equipment ini.
              </p>
            </div>
          ) : (
            <div className="relative border-l-2 border-slate-200 ml-4 pl-6 md:pl-8 space-y-4">
              {filteredItems.map((item) => {
                const isExpanded = !!expandedItems[item.id];
                const isPrev = item.source === 'preventive';
                const isCorr = item.source === 'corrective';
                const isComp = item.source === 'component';

                // Map technician IDs to names for preventive
                const resolvedTechNames = isPrev
                  ? (item.technicians.map((id) => technicianMap.get(Number(id)) || `Tech ID ${id}`))
                  : item.technicians;

                // Shift translation
                const shiftIndonesian = item.shift === 'Pagi' ? 'Pagi' : 'Malam';

                return (
                  <div key={item.id} className="relative" id={`timeline-card-${item.id}`}>
                    {/* Event Marker Anchor Pin */}
                    <span className={`absolute -left-11 top-2.5 w-5 h-5 rounded-full flex items-center justify-center ring-4 ring-white ${
                      isPrev ? 'bg-emerald-500 text-white' : isCorr ? 'bg-amber-500 text-white' : 'bg-indigo-600 text-white'
                    }`}>
                      {isPrev ? <CheckCircle2 className="w-3 h-3" /> : isCorr ? <Wrench className="w-3 h-3" /> : <Cpu className="w-3 h-3" />}
                    </span>

                    {/* Timeline Event Body Card */}
                    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden hover:border-slate-300 transition">
                      {/* Interactive Header Row */}
                      <div 
                        onClick={() => toggleExpand(item.id)}
                        className="p-3.5 flex items-center justify-between gap-3 cursor-pointer select-none"
                      >
                        <div className="flex-1 min-w-0">
                          {/* Date and Shift row */}
                          <div className="flex flex-wrap items-center gap-1.5 mb-1">
                            <span className="text-xs font-bold text-slate-600">
                              {formatIndonesianDate(item.operational_date, { includeDayName: true })}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase ${
                              item.shift === 'Pagi' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-700'
                            }`}>
                              Shift {shiftIndonesian}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              isPrev 
                                ? 'bg-blue-50 text-blue-700' 
                                : isCorr 
                                ? 'bg-amber-50 text-amber-700' 
                                : 'bg-indigo-50 text-indigo-700'
                            }`}>
                              {isPrev ? 'PREVENTIVE' : isCorr ? 'CORRECTIVE' : 'PENGGANTIAN KOMPONEN'}
                            </span>
                          </div>

                          {/* Event Title */}
                          <h3 className="text-sm font-bold text-slate-800 leading-tight">
                            {item.title}
                          </h3>

                          {/* Summary preview text */}
                          <p className="text-xs text-slate-500 mt-0.5 truncate">
                            {item.summary}
                          </p>
                        </div>

                        {/* Right Toggle Button & Action links */}
                        <div className="flex items-center gap-1.5">
                          {isPrev && role === 'supervisor' && item.rawPreventive && onDeletePreventiveEntry && (
                            <button
                              type="button"
                              title="Hapus Catatan Preventif Ini (Khusus Admin / Supervisor)"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreventiveToDelete(item.rawPreventive!);
                              }}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-transparent hover:border-rose-200 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {isComp && item.rawComponent && (
                            <button
                              type="button"
                              title="Hapus Catatan Penggantian Komponen Ini"
                              onClick={(e) => {
                                e.stopPropagation();
                                setComponentToDelete(item.rawComponent!);
                              }}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-transparent hover:border-rose-200 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {/* Detailed Expanded Body */}
                      {isExpanded && (
                        <div className="border-t border-slate-100 bg-slate-50/60 p-3.5 space-y-3 text-xs text-slate-700">
                          {/* Technicians On Duty Row */}
                          <div>
                            <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">Teknisi Bertugas</div>
                            <div className="flex flex-wrap gap-1.5">
                              {resolvedTechNames.length > 0 ? (
                                resolvedTechNames.map((techName, idx) => (
                                  <span key={idx} className="bg-white border border-slate-200 px-2 py-0.5 rounded text-[11px] font-semibold text-slate-700">
                                    {techName}
                                  </span>
                                ))
                              ) : (
                                <span className="text-slate-400 italic">Tidak ada teknisi tercatat</span>
                              )}
                            </div>
                          </div>

                          {/* Render source-specific expanded layouts */}
                          {isPrev && item.rawPreventive && (
                            <div className="space-y-3">
                              {/* View Configuration */}
                              {item.rawPreventive.view_type && (
                                <div>
                                  <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">Konfigurasi View</div>
                                  <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-xs font-bold uppercase">
                                    {item.rawPreventive.view_type} View
                                  </span>
                                </div>
                              )}

                              {/* Measurements Table */}
                              {item.rawPreventive.measurements && item.rawPreventive.measurements.length > 0 ? (
                                <div>
                                  <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">Pengukuran Generator</div>
                                  <div className="overflow-x-auto">
                                    <table className="min-w-full bg-white border border-slate-200 rounded-md overflow-hidden text-left">
                                      <thead>
                                        <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                                          <th className="px-3 py-1.5">Generator</th>
                                          <th className="px-3 py-1.5">Pos KV</th>
                                          <th className="px-3 py-1.5">Neg KV</th>
                                          <th className="px-3 py-1.5">Arus Heater (mA)</th>
                                          <th className="px-3 py-1.5">Arus Anode (uA)</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100 font-medium">
                                        {item.rawPreventive.measurements.map((m, mIdx) => (
                                          <tr key={mIdx}>
                                            <td className="px-3 py-1.5 font-bold text-slate-800">GEN {m.generator}</td>
                                            <td className="px-3 py-1.5 font-mono">{m.positive_high_voltage != null ? Number(m.positive_high_voltage).toFixed(2) : '-'}</td>
                                            <td className="px-3 py-1.5 font-mono">{m.negative_high_voltage != null ? Number(m.negative_high_voltage).toFixed(2) : '-'}</td>
                                            <td className="px-3 py-1.5 font-mono">{m.heater_current != null ? Number(m.heater_current).toFixed(2) : '-'}</td>
                                            <td className="px-3 py-1.5 font-mono">{m.anode_current != null ? Number(m.anode_current).toFixed(2) : '-'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ) : (
                                <div className="p-2.5 bg-slate-100/70 border border-slate-200 rounded-md text-slate-500 italic text-[11px]">
                                  Tidak ada data pengukuran HV generator untuk tipe pemeriksaan ini.
                                </div>
                              )}

                              {/* Checklist results rendering */}
                              {item.rawPreventive.checklist_results && item.rawPreventive.checklist_results.length > 0 ? (
                                <div>
                                  <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">Hasil Pemeriksaan Checklist</div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 bg-white p-2.5 border border-slate-200 rounded-md">
                                    {item.rawPreventive.checklist_results.map((res, rIdx) => (
                                      <div key={rIdx} className="flex items-start justify-between gap-2 p-1 border-b border-slate-100 last:border-0 text-xs">
                                        <span className="font-medium text-slate-700 leading-snug">{res.description}</span>
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                                          res.status === 'Baik' || res.status === 'OK'
                                            ? 'bg-emerald-50 text-emerald-700'
                                            : 'bg-red-50 text-red-700'
                                        }`}>
                                          {res.status}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}

                              {/* Evidence list layout */}
                              {item.rawPreventive.evidences && item.rawPreventive.evidences.length > 0 ? (
                                <div>
                                  <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">Foto Dokumentasi Pemeriksaan</div>
                                  <div className="flex flex-wrap gap-2">
                                    {item.rawPreventive.evidences.map((ev, evIdx) => (
                                      <div key={evIdx} className="flex items-center gap-1.5 bg-white border border-slate-200 px-2 py-1 rounded-md">
                                        <FileText className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                        <span className="font-semibold truncate max-w-[120px] text-slate-700 text-xs">{ev.caption || 'Foto Bukti'}</span>
                                        {ev.drive_url && (
                                          <a 
                                            href={ev.drive_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            referrerPolicy="no-referrer"
                                            className="text-indigo-600 hover:text-indigo-800 p-0.5"
                                          >
                                            <ExternalLink className="w-3.5 h-3.5" />
                                          </a>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          )}

                          {!isPrev && item.rawCorrective && (
                            <div className="space-y-3">
                              {/* Symptoms & Fix descriptions */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="bg-white p-2.5 border border-slate-200 rounded-md">
                                  <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-0.5">Gejala Kerusakan / Masalah</div>
                                  <p className="text-xs font-medium text-slate-800 leading-normal">{item.rawCorrective.problem_description || '-'}</p>
                                </div>
                                <div className="bg-white p-2.5 border border-slate-200 rounded-md">
                                  <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-0.5">Tindakan Perbaikan</div>
                                  <p className="text-xs font-medium text-slate-800 leading-normal">{item.rawCorrective.action_taken || '-'}</p>
                                </div>
                              </div>

                              {/* Status, Time and Notes Grid */}
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                                <div className="bg-white p-2.5 border border-slate-200 rounded-md">
                                  <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-0.5">Hasil Akhir</div>
                                  <span className={`inline-block mt-0.5 px-2 py-0.5 rounded text-[11px] font-bold ${
                                    item.rawCorrective.result === 'Resolved'
                                      ? 'bg-emerald-50 text-emerald-700'
                                      : item.rawCorrective.result === 'Pending Sparepart'
                                      ? 'bg-red-50 text-red-700'
                                      : 'bg-orange-50 text-orange-700'
                                  }`}>
                                    {item.rawCorrective.result || 'Resolved'}
                                  </span>
                                </div>

                                <div className="bg-white p-2.5 border border-slate-200 rounded-md">
                                  <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-0.5">Rentang Waktu Kerja</div>
                                  <p className="text-xs font-bold text-slate-800 mt-0.5">
                                    {formatTimeRange(item.rawCorrective.start_time, item.rawCorrective.end_time)}
                                  </p>
                                </div>

                                <div className="bg-white p-2.5 border border-slate-200 rounded-md col-span-2">
                                  <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-0.5">Keterangan / Notes</div>
                                  <p className="text-xs font-medium text-slate-600 mt-0.5">{item.rawCorrective.notes || '-'}</p>
                                </div>
                              </div>

                              {/* Corrective Evidences */}
                              {item.rawCorrective.evidences && item.rawCorrective.evidences.length > 0 ? (
                                <div>
                                  <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1">Foto Dokumentasi / Lampiran Kerja</div>
                                  <div className="flex flex-wrap gap-2">
                                    {item.rawCorrective.evidences.map((evUrl, evIdx) => (
                                      <div key={evIdx} className="flex items-center gap-1.5 bg-white border border-slate-200 px-2 py-1 rounded-md">
                                        <FileText className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                        <span className="font-semibold truncate max-w-[150px] text-slate-700 text-xs">Attachment {evIdx + 1}</span>
                                        <a 
                                          href={evUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          referrerPolicy="no-referrer"
                                          className="text-amber-600 hover:text-amber-800 p-0.5"
                                        >
                                          <ExternalLink className="w-3.5 h-3.5" />
                                        </a>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          )}

                          {/* Component Replacement Specific Expanded Layout */}
                          {isComp && item.rawComponent && (
                            <div className="space-y-2.5 pt-1">
                              <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl space-y-2">
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                  <span className="text-xs font-bold text-indigo-900">
                                    Komponen: {item.rawComponent.component_name}
                                  </span>
                                  <span className="text-[11px] font-extrabold text-indigo-700 bg-white border border-indigo-200 px-2.5 py-0.5 rounded-full shadow-2xs">
                                    {String(getComponentAgeLabel(item.rawComponent.replaced_at))}
                                  </span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                  <div>
                                    <span className="text-slate-400">Nomor Seri (S/N):</span>{' '}
                                    <strong className="text-slate-800">{item.rawComponent.serial_number || 'Tidak ada S/N'}</strong>
                                  </div>
                                  <div>
                                    <span className="text-slate-400">Asal Komponen:</span>{' '}
                                    <strong className="text-slate-800">{item.rawComponent.origin || 'Baru'}</strong>
                                  </div>
                                  {item.rawComponent.corrective_code && (
                                    <div>
                                      <span className="text-slate-400">Terkait Perbaikan:</span>{' '}
                                      <strong className="text-slate-800">{item.rawComponent.corrective_code}</strong>
                                    </div>
                                  )}
                                  <div>
                                    <span className="text-slate-400">Tanggal Pasang:</span>{' '}
                                    <strong className="text-slate-800">
                                      {formatIndonesianDate(item.rawComponent.replaced_at, { includeDayName: true })}
                                    </strong>
                                  </div>
                                </div>
                                <div className="text-xs text-slate-700">
                                  <span className="text-slate-400 font-medium">Alasan Penggantian:</span> {item.rawComponent.reason}
                                </div>
                                {item.rawComponent.notes && (
                                  <div className="text-xs text-slate-500 italic">
                                    Catatan: {item.rawComponent.notes}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Source Info Footer */}
                          <div className="flex items-center justify-between text-[10px] text-slate-400 border-t border-slate-200 pt-2">
                            <span>ID Dokumen: {item.source_document_id}</span>
                            <span>Dibuat: {item.created_at ? formatIndonesianDate(item.created_at) : '-'}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Machine QR Modal */}
      {equipment && (
        <MachineQrModal
          isOpen={showQrModal}
          onClose={() => setShowQrModal(false)}
          equipment={equipment}
          locations={locations}
          equipmentTypes={equipmentTypes}
        />
      )}

      {/* Admin Delete Preventive Confirmation Modal */}
      {preventiveToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-rose-50/60">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Hapus Data Preventif?</h3>
                  <p className="text-[10px] text-slate-500 font-medium">Khusus Akses Supervisor & Admin</p>
                </div>
              </div>
              <button
                onClick={() => !isDeletingPreventive && setPreventiveToDelete(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-white/60 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-600 leading-relaxed">
                Apakah Anda yakin ingin menghapus data preventif tanggal{' '}
                <strong className="text-slate-900 font-bold">{preventiveToDelete.operational_date}</strong> (Shift {preventiveToDelete.shift || 'Pagi'}) untuk{' '}
                <strong className="text-slate-900 font-bold">{equipment?.name || 'unit ini'}</strong>?
              </p>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-amber-800">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Dampak Penghapusan:</span>
                </div>
                <ul className="list-disc pl-4 space-y-0.5 text-amber-800/90 text-[10.5px]">
                  <li>Data checklist dan pengukuran parameter kV/mA inspeksi ini akan dihapus permanen.</li>
                  <li>Folder foto bukti inspeksi & kolase di <strong>Google Drive</strong> akan otomatis dibersihkan.</li>
                  <li>Jika inspeksi berada pada shift yang aktif saat ini, status unit di dashboard akan kembali menjadi "Belum Dicek".</li>
                </ul>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPreventiveToDelete(null)}
                disabled={isDeletingPreventive}
                className="px-3.5 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDeletePreventive}
                disabled={isDeletingPreventive}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 disabled:opacity-50 rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-xs shadow-rose-600/20"
              >
                {isDeletingPreventive ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Menghapus...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Ya, Hapus Data</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Component Replacement Confirmation Modal */}
      {componentToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-rose-50/60">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Hapus Riwayat Komponen?</h3>
                  <p className="text-[10px] text-slate-500 font-medium">Hapus Pencatatan Pergantian Spare Part</p>
                </div>
              </div>
              <button
                onClick={() => !isDeletingComponent && setComponentToDelete(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-white/60 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-600 leading-relaxed">
                Apakah Anda yakin ingin menghapus catatan penggantian komponen{' '}
                <strong className="text-slate-900 font-bold">{componentToDelete.component_name}</strong>{' '}
                {componentToDelete.serial_number ? `(S/N: ${componentToDelete.serial_number})` : ''} pada tanggal{' '}
                <strong className="text-slate-900 font-bold">{componentToDelete.replaced_at}</strong>?
              </p>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setComponentToDelete(null)}
                disabled={isDeletingComponent}
                className="px-3.5 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteComponent}
                disabled={isDeletingComponent}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 disabled:opacity-50 rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-xs shadow-rose-600/20"
              >
                {isDeletingComponent ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Menghapus...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Ya, Hapus Komponen</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
