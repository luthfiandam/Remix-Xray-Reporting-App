import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Equipment, Location, EquipmentType } from '../types';
import {
  Camera,
  X,
  ClipboardCheck,
  Wrench,
  History,
  TrendingUp,
  Search,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { toast } from './Toast';

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  equipments: Equipment[];
  locations?: Location[];
  equipmentTypes?: EquipmentType[];
  onSelectAction: (action: 'preventive' | 'corrective' | 'timeline' | 'trend', equipmentId: number) => void;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  isOpen,
  onClose,
  equipments,
  locations = [],
  equipmentTypes = [],
  onSelectAction,
}) => {
  const [matchedEquipment, setMatchedEquipment] = useState<Equipment | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [manualQuery, setManualQuery] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const readerElementId = 'equipment-qr-reader';

  // Find equipment from decoded QR payload
  const handleDecodedText = (decodedText: string) => {
    try {
      let targetId: number | null = null;
      let targetCode: string | null = null;

      const trimmed = decodedText.trim();

      // Check URL format (e.g. https://.../?equipment=123&code=...)
      if (trimmed.includes('equipment=') || trimmed.includes('eq=')) {
        try {
          const url = new URL(trimmed);
          const eqParam = url.searchParams.get('equipment') || url.searchParams.get('eq');
          if (eqParam) targetId = Number(eqParam);
          const codeParam = url.searchParams.get('code');
          if (codeParam) targetCode = codeParam;
        } catch {
          const matchEq = trimmed.match(/[?&](?:equipment|eq)=([^&]+)/);
          if (matchEq && matchEq[1]) targetId = Number(matchEq[1]);
          const matchCode = trimmed.match(/[?&]code=([^&]+)/);
          if (matchCode && matchCode[1]) targetCode = decodeURIComponent(matchCode[1]);
        }
      } else if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        // Check JSON payload
        const parsed = JSON.parse(trimmed);
        if (parsed.id) targetId = Number(parsed.id);
        if (parsed.code) targetCode = String(parsed.code);
      } else if (trimmed.startsWith('FASKAMPEN:EQ:') || trimmed.startsWith('SECOPS:EQ:')) {
        // e.g. SECOPS:EQ:1:XRAY-CIP-01 or FASKAMPEN:EQ:1:XRAY-CIP-01
        const parts = trimmed.split(':');
        targetId = Number(parts[2]);
        targetCode = parts[3];
      } else {
        // Try finding by code or ID directly
        targetCode = trimmed;
        const asNum = parseInt(trimmed, 10);
        if (!isNaN(asNum)) targetId = asNum;
      }

      const match = equipments.find(
        (e) => (targetId && e.id === targetId) || (targetCode && (e.equipment_code?.toLowerCase() === targetCode.toLowerCase() || e.name.toLowerCase() === targetCode.toLowerCase()))
      );

      if (match) {
        setMatchedEquipment(match);
        toast.success('Mesin Ditemukan', {
          message: `${match.name} (${match.equipment_code || 'Unit'})`,
          badge: 'QR Scan',
        });
        stopScanner();
      } else {
        toast.warning('QR Tidak Dikenal', 'Kode QR tidak cocok dengan daftar peralatan bandara.');
      }
    } catch (e) {
      console.error('QR parse error:', e);
      toast.warning('Format QR Tidak Valid', decodedText);
    }
  };

  const startScanner = async () => {
    try {
      setScannerError(null);
      setIsScanning(true);

      const html5QrCode = new Html5Qrcode(readerElementId);
      scannerRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 220, height: 220 },
        },
        (decodedText) => {
          handleDecodedText(decodedText);
        },
        () => {
          // Frame error (normal during camera movement)
        }
      );
    } catch (err: any) {
      console.warn('Camera scan start warning:', err);
      setScannerError('Kamera tidak dapat diakses langsung. Silakan pilih mesin melalui pencarian cepat di bawah.');
      setIsScanning(false);
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        await scannerRef.current.clear();
      } catch (e) {
        console.warn('Error stopping scanner:', e);
      }
      scannerRef.current = null;
    }
    setIsScanning(false);
  };

  useEffect(() => {
    if (isOpen) {
      setMatchedEquipment(null);
      setScannerError(null);
      // Small timeout to allow DOM element to mount
      const timer = setTimeout(() => {
        startScanner();
      }, 250);
      return () => {
        clearTimeout(timer);
        stopScanner();
      };
    } else {
      stopScanner();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Filtered equipments for quick manual pick fallback
  const filteredEquipments = manualQuery.trim()
    ? equipments.filter(
        (e) =>
          e.name.toLowerCase().includes(manualQuery.toLowerCase()) ||
          (e.equipment_code && e.equipment_code.toLowerCase().includes(manualQuery.toLowerCase()))
      )
    : equipments.slice(0, 6);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Scan QR Code Mesin</h3>
              <p className="text-xs text-slate-500">Arahkan kamera ke stiker QR pada fisik mesin</p>
            </div>
          </div>
          <button
            onClick={() => {
              stopScanner();
              onClose();
            }}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Decoded Action Sheet */}
          {matchedEquipment ? (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-blue-800 uppercase tracking-wide">
                    Mesin Berhasil Dikenali
                  </div>
                  <div className="text-base font-bold text-slate-900">
                    {matchedEquipment.name}
                  </div>
                  <div className="text-xs font-mono font-bold text-blue-700 bg-white/80 px-2 py-0.5 rounded inline-block border border-blue-200">
                    {matchedEquipment.equipment_code || `EQ-${matchedEquipment.id}`}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-600 px-1">Pilih Tindakan Cepat:</div>

                <button
                  onClick={() => {
                    onSelectAction('timeline', matchedEquipment.id);
                    onClose();
                  }}
                  className="w-full p-3.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-xl text-xs flex items-center justify-between transition-all cursor-pointer shadow-md shadow-blue-500/20 border border-blue-500"
                >
                  <div className="flex items-center gap-2.5">
                    <History className="w-5 h-5 text-blue-200" />
                    <div className="text-left">
                      <div className="text-sm font-black">Buka Profil & Riwayat Mesin</div>
                      <div className="text-[11px] font-normal text-blue-100">
                        Lokasi per unit, list preventif terakhir & perbaikan corrective
                      </div>
                    </div>
                  </div>
                  <span className="text-base font-black">→</span>
                </button>

                <button
                  onClick={() => {
                    onSelectAction('preventive', matchedEquipment.id);
                    onClose();
                  }}
                  className="w-full p-3 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold rounded-xl text-xs flex items-center justify-between transition-all cursor-pointer shadow-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <ClipboardCheck className="w-4 h-4" />
                    <div className="text-left">
                      <div>Mulai Checklist Preventif</div>
                      <div className="text-[10px] font-normal text-emerald-100">Buka formulir inspeksi harian/berkala shift ini</div>
                    </div>
                  </div>
                  <span>→</span>
                </button>

                <button
                  onClick={() => {
                    onSelectAction('corrective', matchedEquipment.id);
                    onClose();
                  }}
                  className="w-full p-3 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold rounded-xl text-xs flex items-center justify-between transition-all cursor-pointer shadow-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <Wrench className="w-4 h-4" />
                    <div className="text-left">
                      <div>Lapor Gangguan (Corrective)</div>
                      <div className="text-[10px] font-normal text-rose-100">Catat & tangani kerusakan peralatan</div>
                    </div>
                  </div>
                  <span>→</span>
                </button>
              </div>

              <button
                onClick={() => {
                  setMatchedEquipment(null);
                  startScanner();
                }}
                className="w-full py-2 text-slate-500 hover:text-slate-800 text-xs font-semibold hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Scan Mesin Lain
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Camera Stream Viewport */}
              <div className="relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-square flex items-center justify-center">
                <div id={readerElementId} className="w-full h-full" />
                {isScanning && (
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-48 h-48 border-2 border-blue-400/80 rounded-2xl relative animate-pulse">
                      <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-blue-400" />
                      <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-blue-400" />
                      <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-blue-400" />
                      <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-blue-400" />
                    </div>
                  </div>
                )}
              </div>

              {scannerError && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2 text-xs text-amber-900">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="leading-relaxed">{scannerError}</div>
                </div>
              )}

              {/* Zero-friction Quick Search Fallback */}
              <div className="space-y-2 pt-1 border-t border-slate-100">
                <div className="text-xs font-bold text-slate-700 flex items-center justify-between">
                  <span>Atau Pilih Mesin Langsung</span>
                  <span className="text-[10px] text-slate-400 font-normal">Jalan pintas tanpa kamera</span>
                </div>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={manualQuery}
                    onChange={(e) => setManualQuery(e.target.value)}
                    placeholder="Cari nama mesin (cth: CIP Karyawan, Backup)..."
                    className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div className="grid grid-cols-1 gap-1.5 max-h-36 overflow-y-auto">
                  {filteredEquipments.map((eq) => (
                    <button
                      key={eq.id}
                      onClick={() => {
                        setMatchedEquipment(eq);
                        stopScanner();
                      }}
                      className="p-2 text-left hover:bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-between cursor-pointer transition-colors"
                    >
                      <div>
                        <div className="text-xs font-bold text-slate-800">{eq.name}</div>
                        <div className="text-[10px] text-slate-500">{eq.equipment_code || `EQ-${eq.id}`}</div>
                      </div>
                      <span className="text-xs text-blue-600 font-semibold">Pilih →</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
