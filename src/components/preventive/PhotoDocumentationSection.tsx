import React from 'react';
import { Camera, Trash2, Image as ImageIcon } from 'lucide-react';
import { PhotoDocs } from './types';
import { S3Image } from '../S3Image';

interface PhotoDocumentationSectionProps {
  isXRay: boolean;
  isHidingMeasurements: boolean;
  photoDocs: PhotoDocs;
  mobileStep: number;
  onSinglePhotoUpload: (key: 'tegangan' | 'report' | 'sinyal_gen_a' | 'sinyal_gen_b', file: File) => void;
  onRemoveSinglePhoto: (key: 'tegangan' | 'report' | 'sinyal_gen_a' | 'sinyal_gen_b') => void;
  onBebersihUpload: (files: FileList | null) => void;
  onSimpleDocsUpload: (files: FileList | null) => void;
  onRemoveBebersih: (index: number) => void;
  isViewerOnly?: boolean;
}

export const PhotoDocumentationSection: React.FC<PhotoDocumentationSectionProps> = ({
  photoDocs,
  mobileStep,
  onBebersihUpload,
  onRemoveBebersih,
  isViewerOnly = false,
}) => {
  const photos = photoDocs.bebersih || [];
  const maxPhotos = 9;

  return (
    <div
      className={`bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 shadow-xs space-y-3.5 ${
        mobileStep !== 1 ? 'hidden lg:block' : ''
      }`}
    >
      <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Camera className="w-4 h-4 text-indigo-600" />
            <span>1. Foto Bebersih (Max 9 Foto)</span>
          </h3>
          <p className="text-xs text-slate-600 mt-0.5 font-medium">
            Dokumentasi pembersihan dan kegiatan maintenance (maksimal 9 foto)
          </p>
        </div>
        <span className="text-xs font-bold px-2.5 py-0.5 bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-full">
          {photos.length} / {maxPhotos} Foto
        </span>
      </div>

      {/* Grid of uploaded photo thumbnails */}
      {photos.filter(Boolean).length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {photos.filter(Boolean).map((imgUrl, idx) => {
            return (
              <div key={idx} className="relative rounded-xl overflow-hidden border border-slate-200 group bg-slate-100 shadow-xs flex flex-col items-center justify-center min-h-[112px]">
                <S3Image
                  src={imgUrl}
                  alt={`Foto Bebersih ${idx + 1}`}
                  className="w-full h-28 object-cover"
                />
                {!isViewerOnly && (
                  <button
                    type="button"
                    onClick={() => onRemoveBebersih(idx)}
                    className="absolute top-1.5 right-1.5 p-1 bg-red-600 text-white rounded-lg shadow-xs hover:bg-red-700 transition-colors cursor-pointer z-10"
                    title="Hapus foto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <span className="absolute bottom-1.5 left-1.5 bg-slate-900/80 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded backdrop-blur-xs z-10">
                  #{idx + 1}
                </span>
              </div>
            );
          })}
        </div>
      ) : isViewerOnly ? (
        <div className="p-6 text-center text-xs text-slate-400 italic bg-slate-50/50 rounded-xl border border-slate-200">
          Belum ada foto dokumentasi yang diunggah untuk sesi inspeksi ini.
        </div>
      ) : null}

      {/* Upload Dual Option Buttons - Hidden in viewer only mode */}
      {!isViewerOnly && photos.length < maxPhotos && (
        <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800">
              {photos.length > 0 ? 'Tambah Foto Bebersih' : 'Unggah Foto Bebersih'} ({photos.length}/{maxPhotos})
            </span>
            <span className="text-[11px] text-slate-500 font-medium">
              Pilih metode pengunggan foto
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* Option 1: Direct Camera */}
            <label className="cursor-pointer bg-white border border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50/30 rounded-xl p-3 flex items-center gap-3 transition-all shadow-2xs group active:scale-[0.98]">
              <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100 group-hover:scale-105 transition-transform">
                <Camera className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="text-xs font-bold text-slate-900 block truncate">
                  Ambil Kamera
                </span>
                <span className="text-[10px] text-slate-500 font-medium block truncate">
                  Kamera HP / Webcam Laptop
                </span>
              </div>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={(e) => onBebersihUpload(e.target.files)}
                className="hidden"
              />
            </label>

            {/* Option 2: Folder / File / Gallery Picker */}
            <label className="cursor-pointer bg-white border border-blue-200 hover:border-blue-400 hover:bg-blue-50/30 rounded-xl p-3 flex items-center gap-3 transition-all shadow-2xs group active:scale-[0.98]">
              <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100 group-hover:scale-105 transition-transform">
                <ImageIcon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="text-xs font-bold text-slate-900 block truncate">
                  Pilih File / Galeri
                </span>
                <span className="text-[10px] text-slate-500 font-medium block truncate">
                  Folder HP, Laptop, atau PC
                </span>
              </div>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => onBebersihUpload(e.target.files)}
                className="hidden"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
};
