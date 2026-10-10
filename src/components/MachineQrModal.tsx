import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { Equipment, Location, EquipmentType } from '../types';
import { INITIAL_EQUIPMENTS } from '../data/initialData';
import { QrCode, Printer, X, Download, ShieldCheck, Copy, Check } from 'lucide-react';
import { toast } from './Toast';

interface MachineQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  equipment: Equipment | null;
  locations?: Location[];
  equipmentTypes?: EquipmentType[];
  allEquipments?: Equipment[];
}

export const MachineQrModal: React.FC<MachineQrModalProps> = ({
  isOpen,
  onClose,
  equipment,
  locations = [],
  equipmentTypes = [],
  allEquipments = [],
}) => {
  const [qrMode, setQrMode] = useState<'avsec' | 'history'>('avsec');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isBatchMode, setIsBatchMode] = useState<boolean>(false);
  const [batchQrs, setBatchQrs] = useState<{ eq: Equipment; qr: string }[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasCopiedUrl, setHasCopiedUrl] = useState(false);

  const getEquipmentUrl = (eq?: Equipment | null, mode: 'avsec' | 'history' = qrMode) => {
    if (!eq) return '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    if (mode === 'avsec') {
      const fallbackEq = INITIAL_EQUIPMENTS.find(
        (i) => i.id === eq.id || (i.equipment_code && i.equipment_code === eq.equipment_code)
      );
      const publicId = (eq.public_id || fallbackEq?.public_id || '').trim();
      const pId = publicId || eq.equipment_code || String(eq.id || '');
      return `https://report.nararyaapps.net/r/${pId}`;
    }
    const code = encodeURIComponent(eq.equipment_code || String(eq.id || ''));
    return `${origin}/public/machine/${code}`;
  };

  // Generate single QR code
  useEffect(() => {
    if (!isOpen || !equipment) return;

    const qrPayload = getEquipmentUrl(equipment, qrMode);
    if (!qrPayload) return;

    QRCode.toDataURL(qrPayload, {
      width: 280,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('Error generating QR:', err));
  }, [isOpen, equipment, qrMode]);

  // Generate batch QR codes for all equipments
  const handleGenerateBatch = async () => {
    if (!allEquipments || allEquipments.length === 0) return;
    setIsGenerating(true);
    setIsBatchMode(true);

    try {
      const results: { eq: Equipment; qr: string }[] = [];
      for (const eq of allEquipments) {
        if (!eq) continue;
        const payload = getEquipmentUrl(eq, qrMode);
        const url = await QRCode.toDataURL(payload, { width: 200, margin: 2 });
        results.push({ eq, qr: url });
      }
      setBatchQrs(results);
    } catch (err) {
      console.error(err);
      toast.error('Gagal Generate QR', 'Terjadi kesalahan saat membuat batch QR code.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyLink = () => {
    if (!equipment) return;
    const url = getEquipmentUrl(equipment, qrMode);
    if (!url) return;
    navigator.clipboard.writeText(url);
    setHasCopiedUrl(true);
    toast.success('Tautan Disalin', {
      message: `Link ${qrMode === 'avsec' ? 'Lapor Gangguan AVSEC' : 'Riwayat'} ${equipment.name || 'Peralatan'} berhasil disalin.`,
      badge: 'QR Code',
    });
    setTimeout(() => setHasCopiedUrl(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  if (!isOpen) return null;

  const loc = equipment?.location_id ? locations.find((l) => l && l.id === equipment.location_id) : undefined;
  const type = equipment?.equipment_type_id ? equipmentTypes.find((t) => t && t.id === equipment.equipment_type_id) : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${qrMode === 'avsec' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
              <QrCode className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {isBatchMode ? 'Cetak Label QR Semua Mesin' : qrMode === 'avsec' ? 'QR Stiker Lapor Gangguan AVSEC' : 'QR Code Identitas Mesin'}
              </h3>
              <p className="text-xs text-slate-500">
                {isBatchMode
                  ? `${allEquipments.length} unit siap dicetak pada kertas stiker`
                  : `${equipment?.name || 'Peralatan'} (${equipment?.equipment_code || 'Kode Mesin'})`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Selector Tabs */}
        {!isBatchMode && (
          <div className="px-5 pt-3 pb-0 flex gap-2 border-b border-slate-100 bg-slate-50/30 text-xs">
            <button
              onClick={() => setQrMode('avsec')}
              className={`pb-2.5 px-3 font-semibold border-b-2 transition ${
                qrMode === 'avsec'
                  ? 'border-red-600 text-red-600 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Stiker Lapor Gangguan AVSEC (Statis)
            </button>
            <button
              onClick={() => setQrMode('history')}
              className={`pb-2.5 px-3 font-semibold border-b-2 transition ${
                qrMode === 'history'
                  ? 'border-blue-600 text-blue-600 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Riwayat & Spesifikasi Mesin
            </button>
          </div>
        )}

        {/* Modal Content */}
        <div className="p-5 max-h-[70vh] overflow-y-auto">
          {!isBatchMode && equipment && (
            <div className="space-y-4">
              {/* Printable Physical Sticker Preview */}
              <div
                id="printable-machine-qr"
                className="bg-white border-2 border-dashed border-slate-300 rounded-2xl p-5 text-center flex flex-col items-center space-y-3"
              >
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-blue-800 uppercase tracking-wider bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>OPERASIONAL & PEMELIHARAAN BANDARA</span>
                </div>

                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={`QR Code ${equipment.name}`}
                    className="w-48 h-48 rounded-xl shadow-xs border border-slate-100"
                  />
                ) : (
                  <div className="w-48 h-48 flex items-center justify-center bg-slate-50 rounded-xl">
                    <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}

                <div className="space-y-1">
                  <div className="text-base font-black text-slate-900 tracking-tight">
                    {equipment?.name || 'Peralatan'}
                  </div>
                  <div className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded inline-block">
                    {equipment?.equipment_code || `EQ-${equipment?.id ?? ''}`}
                  </div>
                  <div className="text-xs text-slate-500 font-medium">
                    {loc?.name || 'Area Bandara'} • {type?.name || 'Peralatan'}
                  </div>
                </div>

                <div className="text-[10px] text-slate-500 pt-2 border-t border-slate-100 w-full space-y-1">
                  <p className="font-semibold text-slate-700">Buka Otomatis Halaman Mesin Saat Di-scan</p>
                  <p className="text-slate-400">
                    Scan menggunakan kamera HP (iPhone / Android) atau fitur Scan QR di aplikasi untuk langsung membuka riwayat preventif, perbaikan corrective, dan spesifikasi unit ini.
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handlePrint}
                    className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Cetak Stiker Label Mesin</span>
                  </button>
                  <button
                    onClick={handleCopyLink}
                    className="px-3 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer border border-slate-200"
                    title="Salin Tautan Langsung Mesin"
                  >
                    {hasCopiedUrl ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    <span>{hasCopiedUrl ? 'Tersalin' : 'Salin Link'}</span>
                  </button>
                </div>
                {allEquipments.length > 1 && (
                  <button
                    onClick={handleGenerateBatch}
                    disabled={isGenerating}
                    className="w-full py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer border border-slate-200"
                  >
                    <span>Cetak Semua Label Mesin ({allEquipments.length} Unit Sekaligus)</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {isBatchMode && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-100">
                <span className="font-semibold text-slate-600">
                  Daftar Label Siap Cetak ({batchQrs.length} unit)
                </span>
                <button
                  onClick={() => setIsBatchMode(false)}
                  className="text-blue-600 hover:underline cursor-pointer"
                >
                  Kembali ke Satuan
                </button>
              </div>

              {isGenerating ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  Membuat QR Code untuk {allEquipments.length} peralatan...
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 max-h-[50vh] overflow-y-auto pr-1">
                  {batchQrs.map(({ eq, qr }, idx) => (
                    <div
                      key={eq?.id ?? idx}
                      className="border border-slate-200 rounded-xl p-3 text-center flex flex-col items-center space-y-1.5 bg-slate-50/50"
                    >
                      <img src={qr} alt={eq?.name || 'Mesin'} className="w-24 h-24 rounded-lg bg-white p-1 border border-slate-100" />
                      <div className="text-[11px] font-bold text-slate-800 line-clamp-1">{eq?.name || 'Peralatan'}</div>
                      <div className="text-[10px] font-mono text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                        {eq?.equipment_code || `EQ-${eq?.id ?? ''}`}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={handlePrint}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Cetak Lembar Stiker Sekarang</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
