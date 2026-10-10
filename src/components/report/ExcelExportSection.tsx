import React, { useState } from 'react';
import { FileSpreadsheet, Download, ExternalLink, Loader2, CheckCircle2, Filter } from 'lucide-react';
import { StructuredReportData } from '../../types';
import { formatTimeRange } from '../../utils/timeFormat';
import { getSingleCollagePhotoUrl } from '../../utils/evidenceUtils';
import { INTERVAL_NAMES } from './types';
import { generateOfficialExcelReport, downloadExcelFile } from '../../services/excelReportGenerator';
import { toast } from '../Toast';
import logoNararya from '../../assets/logopt.png';

interface ExcelExportSectionProps {
  structuredData: StructuredReportData;
  submittedFrequencyIds?: number[];
  onDownloadCsv?: () => void;
}

export const ExcelExportSection: React.FC<ExcelExportSectionProps> = ({
  structuredData,
  submittedFrequencyIds = [],
  onDownloadCsv,
}) => {
  const [selectedFreqId, setSelectedFreqId] = useState<number>(0); // 0 = Semua
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportingFreqId, setExportingFreqId] = useState<number | null>(null);

  // Compute available frequency IDs
  const computedFreqIds = Array.from(
    new Set(
      structuredData.entries_by_type.flatMap((g) =>
        g.entries.map((e) => e.checklist_frequency_id)
      )
    )
  ).filter(Boolean);

  const activeFreqList = submittedFrequencyIds.length > 0 ? submittedFrequencyIds : computedFreqIds;
  if (!activeFreqList.includes(1)) {
    activeFreqList.unshift(1);
  }

  // Format date helper
  const formatDayDate = (dateStr: string) => {
    if (!dateStr) return '';
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    if (days.some((day) => dateStr.startsWith(day))) {
      return dateStr;
    }
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

    let d: Date | null = null;
    if (dateStr.includes('-')) {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      }
    } else {
      d = new Date(dateStr);
    }

    if (!d || isNaN(d.getTime())) {
      const now = new Date();
      return `${days[now.getDay()]}, ${dateStr}`;
    }

    return `${days[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
  };

  const rawTechs =
    structuredData.technicians && structuredData.technicians.length > 0
      ? structuredData.technicians
      : ['LUTHFIANDA MUZAKI SULAEMAN'];

  // Filter items for preview
  const filteredPreventive = structuredData.entries_by_type.flatMap((group) =>
    group.entries
      .filter((e) => !selectedFreqId || e.checklist_frequency_id === selectedFreqId)
      .map((e) => ({
        kind: 'preventive' as const,
        equipment_name: e.equipment_name,
        type_code: group.type_code,
        notes: e.notes,
        evidences: e.evidences || [],
        checklist_frequency_id: e.checklist_frequency_id,
        time_range: formatTimeRange(structuredData.start_time, structuredData.end_time),
      }))
  );

  const includeCorrective = !selectedFreqId || selectedFreqId === 1;
  const filteredCorrective = includeCorrective
    ? (structuredData.corrective_entries || []).map((c) => ({
        kind: 'corrective' as const,
        equipment_name: c.equipment_name,
        type_code: c.type_code,
        notes: c.notes,
        evidences: c.evidences || [],
        problem_description: c.problem_description,
        action_taken: c.action_taken,
        result: c.result,
        result_text: c.result_text,
        time_range: c.time_range ? `${c.time_range} WIB` : formatTimeRange(structuredData.start_time, structuredData.end_time),
        checklist_frequency_id: 1,
      }))
    : [];

  const previewRows = [...filteredPreventive, ...filteredCorrective];

  const handleDownloadOfficialExcel = async (freqId?: number) => {
    const targetFreqId = freqId !== undefined ? freqId : selectedFreqId;
    setIsExporting(true);
    setExportingFreqId(targetFreqId);

    const freqLabel = targetFreqId && INTERVAL_NAMES[targetFreqId] ? INTERVAL_NAMES[targetFreqId] : 'Semua';
    const dateFormatted = structuredData.operational_date.replace(/[^a-zA-Z0-9]/g, '_');
    const shiftFormatted = (structuredData.shift || 'Pagi').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `Laporan_Maintenance_NTI_${freqLabel}_${dateFormatted}_Shift_${shiftFormatted}.xlsx`;

    try {
      toast.info('Membuat Dokumen Excel...', {
        message: `Menyusun template resmi Excel (.xlsx) untuk ${freqLabel}...`,
        badge: 'Excel Template',
      });

      const blob = await generateOfficialExcelReport(structuredData, {
        freqId: targetFreqId,
        includeCorrective: !targetFreqId || targetFreqId === 1,
        logoUrl: logoNararya,
      });

      downloadExcelFile(blob, filename);

      toast.success('Ekspor Excel Berhasil!', {
        message: `File ${filename} berhasil diunduh dengan format resmi PT. Nararya Teknologi Indonesia.`,
        badge: 'Format Excel (.xlsx)',
      });
    } catch (err: any) {
      console.error('[ExcelExport] Error generating excel:', err);
      toast.error('Gagal Membuat File Excel', {
        message: err?.message || 'Terjadi kesalahan saat memproses spreadsheet Excel.',
        badge: 'Error',
      });
    } finally {
      setIsExporting(false);
      setExportingFreqId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Card Grid: Export Excel Resmi per Interval */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>Export Laporan Excel Resmi (.xlsx) per Interval</span>
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {onDownloadCsv && (
              <button
                type="button"
                onClick={onDownloadCsv}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all cursor-pointer"
                title="Download file CSV mentah"
              >
                Download Raw CSV
              </button>
            )}
            <button
              type="button"
              onClick={() => handleDownloadOfficialExcel(0)}
              disabled={isExporting}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer disabled:opacity-50"
            >
              {isExporting && exportingFreqId === 0 ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              <span>Download Semua Interval (.xlsx)</span>
            </button>
          </div>
        </div>

        {/* Interval Export Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {/* Card: Semua Interval */}
          <div
            className={`p-4 border rounded-2xl transition-all flex flex-col justify-between ${
              selectedFreqId === 0
                ? 'border-emerald-600 bg-emerald-50/40 ring-1 ring-emerald-600'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className="space-y-1 mb-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800 text-sm">Semua Interval</span>
                {selectedFreqId === 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-700 text-white rounded-md flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Preview Aktif
                  </span>
                )}
              </div>
              <span className="text-[11px] text-slate-500 block">
                Seluruh checklist preventif + perbaikan korektif
              </span>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleDownloadOfficialExcel(0)}
                disabled={isExporting}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer disabled:opacity-50"
              >
                {isExporting && exportingFreqId === 0 ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span>Export Excel</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedFreqId(0)}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                  selectedFreqId === 0
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-200'
                }`}
              >
                Preview
              </button>
            </div>
          </div>

          {/* Cards for each specific interval */}
          {activeFreqList.map((freqId) => {
            const freqName = INTERVAL_NAMES[freqId] || `Interval #${freqId}`;
            const isSelected = selectedFreqId === freqId;

            return (
              <div
                key={freqId}
                className={`p-4 border rounded-2xl transition-all flex flex-col justify-between ${
                  isSelected
                    ? 'border-emerald-600 bg-emerald-50/40 ring-1 ring-emerald-600'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="space-y-1 mb-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 text-sm">
                      Preventive {freqName}
                    </span>
                    {isSelected && (
                      <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-700 text-white rounded-md flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Preview Aktif
                      </span>
                    )}
                  </div>
                  {freqId === 1 ? (
                    <span className="text-[10px] text-emerald-700 font-bold block">
                      + Corrective Maintenance
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-500 block">
                      Checklist berkala {freqName.toLowerCase()}
                    </span>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFreqId(freqId);
                      handleDownloadOfficialExcel(freqId);
                    }}
                    disabled={isExporting}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isExporting && exportingFreqId === freqId ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    <span>Export Excel</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedFreqId(freqId)}
                    className={`px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                      isSelected
                        ? 'bg-slate-800 text-white border-slate-800'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-200'
                    }`}
                  >
                    Preview
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Spreadsheet Preview: Formatted Layout Identical to PDF Template */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        {/* Ribbon Header bar */}
        <div className="bg-slate-50 border-b border-slate-200 px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-emerald-100 text-emerald-800 text-xs font-bold">
              XLS
            </span>
            <h4 className="text-xs font-bold text-slate-800">
              Live Preview: Template Excel Resmi PT. NTI ({selectedFreqId === 0 ? 'Semua Interval' : INTERVAL_NAMES[selectedFreqId]})
            </h4>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleDownloadOfficialExcel(selectedFreqId)}
              disabled={isExporting}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer disabled:opacity-50"
            >
              {isExporting && exportingFreqId === selectedFreqId ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>Download Sheet Ini (.xlsx)</span>
            </button>
          </div>
        </div>

        {/* Excel Sheet Simulator View */}
        <div className="p-4 sm:p-6 overflow-x-auto bg-slate-100/50">
          <div
            className="bg-white p-6 shadow-sm border border-slate-300 mx-auto min-w-[760px] max-w-[960px] space-y-0"
            style={{ fontFamily: "'Times New Roman', Times, serif" }}
          >
            {/* Header: Logo & Title */}
            <table className="w-full border-collapse border border-black text-xs">
              <tbody>
                <tr>
                  <td className="w-[18%] border border-black p-2 text-center align-middle bg-white">
                    <img
                      src={logoNararya}
                      alt="Logo PT Nararya Teknologi Indonesia"
                      className="h-12 w-auto max-w-[85%] object-contain mx-auto block"
                    />
                  </td>
                  <td className="w-[82%] border border-black p-3 text-center align-middle bg-white">
                    <div className="font-bold text-lg text-black tracking-wide uppercase">
                      PT. NARARYA TEKNOLOGI INDONESIA
                    </div>
                    <div className="text-xs font-bold text-slate-700 mt-1 uppercase">
                      {selectedFreqId === 0
                        ? 'LAPORAN PREVENTIVE & CORRECTIVE MAINTENANCE'
                        : `LAPORAN PREVENTIVE MAINTENANCE ${INTERVAL_NAMES[selectedFreqId]?.toUpperCase() || ''}${selectedFreqId === 1 ? ' & CORRECTIVE MAINTENANCE' : ''}`}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Operational Info Table */}
            <table className="w-full border-collapse border border-black border-t-0 text-xs">
              <tbody>
                <tr>
                  <td className="w-[18%] border border-black p-2 font-bold bg-white">
                    Hari / Tanggal
                  </td>
                  <td className="w-[42%] border border-black p-2 bg-white">
                    : {formatDayDate(structuredData.operational_date)}
                  </td>
                  <td className="w-[12%] border border-black p-2 font-bold bg-white">
                    Shift
                  </td>
                  <td className="w-[28%] border border-black p-2 font-bold text-black bg-white">
                    : {(structuredData.shift || 'PAGI').toUpperCase()}
                  </td>
                </tr>
                <tr>
                  <td className="w-[18%] border border-black p-2 font-bold bg-white align-middle">
                    Teknisi On Duty
                  </td>
                  <td className="w-[42%] border border-black p-2 bg-white align-middle">
                    : 1. {rawTechs[0] || '-'}
                  </td>
                  <td colSpan={2} className="w-[40%] border border-black p-2 bg-white align-middle">
                    {rawTechs[1] ? `2. ${rawTechs[1]}` : ''}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Main Inspection Table */}
            <table className="w-full border-collapse border border-black border-t-0 text-xs">
              <thead>
                <tr className="bg-slate-100 text-black font-bold text-center">
                  <th className="p-2 border border-black w-10">No</th>
                  <th className="p-2 border border-black w-32">Tipe Alat</th>
                  <th className="p-2 border border-black w-40">Jenis Kegiatan</th>
                  <th className="p-2 border border-black w-24">Waktu</th>
                  <th className="p-2 border border-black w-48">Uraian Kegiatan</th>
                  <th className="p-2 border border-black w-40">Notes</th>
                  <th className="p-2 border border-black w-44">Dokumentasi Foto</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-500 italic border border-black">
                      Tidak ada checklist atau perbaikan yang sesuai dengan filter ini.
                    </td>
                  </tr>
                ) : (
                  previewRows.map((row, idx) => {
                    const isPreventive = row.kind === 'preventive';
                    const eqNameUpper = row.equipment_name.toUpperCase();
                    const typeUpper = row.type_code.toUpperCase();
                    const displayEqName = eqNameUpper.includes(typeUpper)
                      ? eqNameUpper
                      : `${typeUpper} ${eqNameUpper}`;

                    const jenisKegiatan = isPreventive
                      ? `Preventive Maintenance ${INTERVAL_NAMES[row.checklist_frequency_id || selectedFreqId || 1] || 'Harian'}`
                      : 'Corrective Maintenance';

                    let defaultNote = `${row.type_code} bisa digunakan dengan normal`;
                    if (row.type_code === 'XRAY') defaultNote = 'Xray bisa digunakan dengan normal';
                    if (row.type_code === 'WTMD') defaultNote = 'WTMD bisa digunakan dengan normal';
                    if (row.type_code === 'HHMD') defaultNote = 'HHMD bisa digunakan dengan normal';

                    const displayCollageUrl = getSingleCollagePhotoUrl(row.evidences || []);

                    return (
                      <tr key={idx} className="hover:bg-slate-50/60">
                        <td className="p-2 border border-black text-center align-middle font-medium">
                          {idx + 1}
                        </td>
                        <td className="p-2 border border-black text-center align-middle font-medium uppercase leading-tight">
                          {displayEqName}
                        </td>
                        <td className="p-2 border border-black text-center align-middle">
                          {jenisKegiatan}
                        </td>
                        <td className="p-2 border border-black text-center align-middle">
                          {row.time_range}
                        </td>
                        <td className="p-2 border border-black align-middle text-left leading-tight text-[11px]">
                          {isPreventive ? (
                            <div className="text-center">Melakukan Pembersihan dan Check List</div>
                          ) : (
                            <div className="space-y-1">
                              <div>
                                <span className="font-bold">Kerusakan: </span>
                                <span>{(row as any).problem_description || '-'}</span>
                              </div>
                              <div>
                                <span className="font-bold">Tindakan: </span>
                                <span>{(row as any).action_taken || '-'}</span>
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="p-2 border border-black text-center align-middle text-[11px]">
                          {isPreventive
                            ? row.notes || defaultNote
                            : (row as any).result_text || row.notes || 'Equipment sudah dapat digunakan kembali dengan normal.'}
                        </td>
                        <td className="p-2 border border-black text-center align-middle">
                          {displayCollageUrl ? (
                            <a
                              href={displayCollageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-semibold underline text-[11px] p-1 rounded hover:bg-blue-50 transition-colors"
                            >
                              <span>Buka Foto ↗</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {/* Official Signature Block */}
            <div className="pt-6 grid grid-cols-2 text-center text-xs text-black">
              <div>
                <p className="font-bold">Pelaksana</p>
                <p className="font-bold uppercase mt-0.5">PT. NARARYA TEKNOLOGI INDONESIA</p>
                <div className="h-16"></div>
                <p className="font-bold underline uppercase tracking-wider">
                  {rawTechs[0] ? rawTechs[0].toUpperCase() : 'LUTHFIANDA MUZAKI SULAEMAN'}
                </p>
              </div>

              <div>
                <p className="font-bold">Pengawas Pekerjaan</p>
                <p className="font-bold uppercase mt-0.5">FACILITY MAINTENANCE - ELEKTRONIKA</p>
                <div className="h-16"></div>
                <p className="font-bold underline uppercase tracking-wider">
                  RIZKO ENDRA NUGRAHA
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
