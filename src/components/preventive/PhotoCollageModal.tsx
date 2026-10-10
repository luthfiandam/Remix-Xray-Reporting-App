import React from 'react';
import { Image as ImageIcon, X, Download, Send } from 'lucide-react';
import { Equipment } from '../../types';
import { shareReport, triggerFileDownload, dataUrlToFile } from '../../utils/webShareUtils';

interface PhotoCollageModalProps {
  show: boolean;
  collageUrl: string | null;
  selectedEquipment?: Equipment;
  onClose: () => void;
}

export const PhotoCollageModal: React.FC<PhotoCollageModalProps> = ({
  show,
  collageUrl,
  selectedEquipment,
  onClose,
}) => {
  if (!show || !collageUrl) return null;

  const isHHMD = Boolean(
    selectedEquipment?.equipment_code?.toUpperCase().includes('HHMD') ||
    selectedEquipment?.name?.toUpperCase().includes('HHMD')
  );
  const typePrefix = isHHMD
    ? 'HHMD'
    : selectedEquipment?.equipment_code?.split('-')[1] || 'ALAT';
  const fileName = `Kolase_${typePrefix}_${selectedEquipment?.equipment_code || 'Machine'}.jpg`;

  const handleDownload = () => {
    triggerFileDownload(collageUrl, fileName);
  };

  const handleShare = async () => {
    const text = `*DOKUMENTASI FOTO PREVENTIVE*\nMesin: ${selectedEquipment?.name}\nKode: ${selectedEquipment?.equipment_code}\nTanggal: ${new Date().toLocaleDateString('id-ID')}\nStatus: NORMAL (OK)\n\n*(Dokumentasi foto kolase preventive maintenance)*`;
    try {
      const file = dataUrlToFile(collageUrl, fileName);
      await shareReport({
        title: `Dokumentasi Foto ${selectedEquipment?.name || 'Mesin'}`,
        text,
        files: [file],
      });
    } catch (e) {
      console.warn('[WebShare] Gagal share kolase:', e);
      triggerFileDownload(collageUrl, fileName);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-lg w-full p-4 space-y-4 shadow-2xl border border-slate-100 my-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <ImageIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Kolase Foto WhatsApp</h3>
              <p className="text-[10px] text-slate-500">Siap diunduh dan dikirim ke grup WhatsApp</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Image Preview */}
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-100 shadow-inner max-h-80 flex items-center justify-center p-1">
          <img src={collageUrl} alt="Photo Collage" className="max-h-80 w-auto object-contain rounded-lg" />
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={handleDownload}
            className="py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer text-center"
          >
            <Download className="w-4 h-4" />
            <span>Download Foto (JPG)</span>
          </button>

          <button
            type="button"
            onClick={handleShare}
            className="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer text-center"
          >
            <Send className="w-4 h-4" />
            <span>Kirim Laporan</span>
          </button>
        </div>
      </div>
    </div>
  );
};
