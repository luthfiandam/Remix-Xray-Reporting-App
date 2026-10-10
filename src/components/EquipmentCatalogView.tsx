import React, { useState, useMemo } from 'react';
import { Equipment, Location, EquipmentType, PreventiveEntry, CorrectiveReport } from '../types';
import { sanitizeSearchQuery } from '../utils/sanitizer';
import {
  Search,
  MapPin,
  CheckCircle2,
  Clock,
  ArrowRight,
  QrCode,
  Camera,
  Activity,
  FileText,
  AlertTriangle,
} from 'lucide-react';

interface EquipmentCatalogViewProps {
  equipments: Equipment[];
  locations: Location[];
  equipmentTypes: EquipmentType[];
  preventiveEntries?: PreventiveEntry[];
  correctiveReports?: CorrectiveReport[];
  isSupervisor?: boolean;
  onSelectEquipment: (equipmentId: number) => void;
  onOpenQrPrint: (equipment?: Equipment) => void;
  onOpenQrScanner: () => void;
  onCreateCorrectiveShortcut?: (equipmentId: number) => void;
}

export const EquipmentCatalogView: React.FC<EquipmentCatalogViewProps> = ({
  equipments,
  locations,
  equipmentTypes,
  preventiveEntries = [],
  correctiveReports = [],
  onSelectEquipment,
  onOpenQrPrint,
  onOpenQrScanner,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState<number | 'all'>('all');
  const [selectedTypeId, setSelectedTypeId] = useState<number | 'all'>('all');

  // Filter equipments
  const filteredEquipments = useMemo(() => {
    const cleanQ = sanitizeSearchQuery(searchQuery).toLowerCase();
    return equipments.filter((eq) => {
      // Search
      if (cleanQ) {
        const matchesName = (eq.name || '').toLowerCase().includes(cleanQ);
        const matchesCode = (eq.equipment_code || '').toLowerCase().includes(cleanQ);
        const matchesBrand = (eq.brand || '').toLowerCase().includes(cleanQ);
        const matchesModel = (eq.model || '').toLowerCase().includes(cleanQ);
        const loc = locations.find((l) => l.id === eq.location_id);
        const matchesLoc = loc && loc.name.toLowerCase().includes(cleanQ);
        if (!matchesName && !matchesCode && !matchesBrand && !matchesModel && !matchesLoc) {
          return false;
        }
      }

      // Location filter
      if (selectedLocationId !== 'all' && eq.location_id !== selectedLocationId) {
        return false;
      }

      // Type filter
      if (selectedTypeId !== 'all' && eq.equipment_type_id !== selectedTypeId) {
        return false;
      }

      return true;
    });
  }, [equipments, searchQuery, selectedLocationId, selectedTypeId, locations]);

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner / Hero */}
      <div className="bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 rounded-2xl p-5 sm:p-7 text-white shadow-xl relative overflow-hidden border border-blue-900/40">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-blue-500/20 text-blue-300 rounded-full text-xs font-semibold border border-blue-400/30 backdrop-blur-xs">
              <Activity className="w-3.5 h-3.5 text-blue-400" />
              <span>Katalog Profil & Stiker QR Mesin</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
              Profil Equipment X-Ray & Security
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Pilih unit mesin untuk melihat timeline riwayat inspeksi preventif, catatan gangguan corrective,
              atau cetak stiker QR code untuk ditempel langsung pada fisik mesin.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={onOpenQrScanner}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-md"
            >
              <Camera className="w-4 h-4" />
              <span>Scan QR Mesin</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs">
        <div className="flex flex-col md:flex-row items-center justify-between gap-3">
          {/* Search Bar */}
          <div className="relative w-full md:flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Cari kode mesin, nama unit, merk, tipe, atau lokasi..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
            />
          </div>

          {/* Location Filter */}
          <div className="w-full md:w-48 shrink-0">
            <select
              value={selectedLocationId}
              onChange={(e) => setSelectedLocationId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition cursor-pointer"
            >
              <option value="all">Semua Lokasi ({locations.length})</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>

          {/* Type Filter */}
          <div className="w-full md:w-48 shrink-0">
            <select
              value={selectedTypeId}
              onChange={(e) => setSelectedTypeId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition cursor-pointer"
            >
              <option value="all">Semua Tipe ({equipmentTypes.length})</option>
              {equipmentTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Results Counter */}
        <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
          <span>
            Menampilkan <strong>{filteredEquipments.length}</strong> dari {equipments.length} unit mesin
          </span>
          {(searchQuery || selectedLocationId !== 'all' || selectedTypeId !== 'all') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedLocationId('all');
                setSelectedTypeId('all');
              }}
              className="text-blue-600 hover:text-blue-800 font-semibold cursor-pointer"
            >
              Reset Filter
            </button>
          )}
        </div>
      </div>

      {/* Equipment Cards Grid */}
      {filteredEquipments.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
            <Search className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-900">Mesin Tidak Ditemukan</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Tidak ada peralatan yang sesuai dengan kata kunci atau filter yang Anda pilih. Coba sesuaikan kata pencarian.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredEquipments.map((eq) => {
            const loc = locations.find((l) => l.id === eq.location_id);
            const type = equipmentTypes.find((t) => t.id === eq.equipment_type_id);
            const isInspectedToday = preventiveEntries.some((p) => p.equipment_id === eq.id);
            const eqCorrectives = correctiveReports.filter((c) => c.equipment_id === eq.id);
            const hasActiveIssue = eqCorrectives.some((c) => c.result !== 'Resolved');

            return (
              <div
                key={eq.id}
                className="bg-white rounded-2xl border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all flex flex-col justify-between overflow-hidden group"
              >
                <div className="p-5 space-y-3.5">
                  {/* Top Header Card */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-blue-800 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                        {eq.equipment_code || `EQ-${eq.id}`}
                      </span>
                      {type && (
                        <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                          {type.name}
                        </span>
                      )}
                    </div>

                    {/* Inspection Status Badge */}
                    {isInspectedToday ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Dicek</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                        <Clock className="w-3 h-3" />
                        <span>Belum Dicek</span>
                      </span>
                    )}
                  </div>

                  {/* Machine Name & Location */}
                  <div>
                    <h3 className="text-base font-bold text-slate-900 group-hover:text-blue-700 transition-colors">
                      {eq.name}
                    </h3>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-medium text-slate-700">{loc?.name || 'Area Bandara'}</span>
                    </div>
                  </div>

                  {/* Specifications & Hardware Info */}
                  <div className="bg-slate-50/60 rounded-xl p-3 border border-slate-100 space-y-1 text-xs">
                    <div className="flex items-center justify-between text-slate-600">
                      <span className="text-slate-400">Merk / Brand:</span>
                      <span className="font-semibold text-slate-800">{eq.brand || '-'}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-600">
                      <span className="text-slate-400">Model / Tipe:</span>
                      <span className="font-semibold text-slate-800">{eq.model || '-'}</span>
                    </div>
                    {eq.serial_number && (
                      <div className="flex items-center justify-between text-slate-600">
                        <span className="text-slate-400">Serial No:</span>
                        <span className="font-mono text-[11px] text-slate-700">{eq.serial_number}</span>
                      </div>
                    )}
                  </div>

                  {/* Active Issue Warning if any */}
                  {hasActiveIssue && (
                    <div className="flex items-center gap-1.5 text-xs text-rose-700 bg-rose-50 px-2.5 py-1.5 rounded-lg border border-rose-200 font-medium">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
                      <span>Ada laporan perbaikan yang belum selesai</span>
                    </div>
                  )}
                </div>

                {/* Bottom Action Buttons */}
                <div className="px-5 py-3.5 bg-slate-50/70 border-t border-slate-100 flex items-center gap-2">
                  <button
                    onClick={() => onSelectEquipment(eq.id)}
                    className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Profil & Riwayat</span>
                    <ArrowRight className="w-3 h-3 ml-0.5" />
                  </button>

                  <button
                    onClick={() => onOpenQrPrint(eq)}
                    title="Cetak Stiker QR Code Mesin Ini"
                    className="p-2 bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-700 rounded-xl border border-slate-200 transition-all cursor-pointer shadow-2xs"
                  >
                    <QrCode className="w-4 h-4 text-indigo-600" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
