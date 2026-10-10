import React, { useState, useMemo, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { PreventiveEntry, Equipment } from '../types';
import { extractMeasurementTrendPoints, detectMeasurementAnomalies } from '../utils/measurementTrend';
import { INITIAL_EQUIPMENTS } from '../data/initialData';
import { AlertTriangle, TrendingUp, Activity, CheckCircle, Info, PlusCircle } from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';

export interface MeasurementTrendChartProps {
  entries?: PreventiveEntry[];
  equipment?: Equipment | null;
  equipmentId?: number;
  equipmentName?: string;
  onNavigatePreventive?: () => void;
  onStartPreventive?: (equipmentId: number) => void;
}

const MeasurementTrendChartContent: React.FC<MeasurementTrendChartProps> = ({
  entries = [],
  equipment,
  equipmentId,
  equipmentName,
  onNavigatePreventive,
  onStartPreventive,
}) => {
  const [selectedGenerator, setSelectedGenerator] = useState<'A' | 'B'>('B');
  const [selectedMetric, setSelectedMetric] = useState<'hv' | 'current'>('hv');

  const resolvedEquipmentId = equipment?.id ?? equipmentId;

  // Construct fallback equipment object if not fully provided
  const resolvedEquipment = useMemo(() => {
    const fallbackFromInit = resolvedEquipmentId
      ? INITIAL_EQUIPMENTS.find((e) => e.id === Number(resolvedEquipmentId))
      : null;

    if (equipment) {
      return {
        ...fallbackFromInit,
        ...equipment,
        default_measurements: equipment.default_measurements || fallbackFromInit?.default_measurements,
        default_view: equipment.default_view || fallbackFromInit?.default_view || 'single',
      } as Equipment;
    }

    if (fallbackFromInit) return fallbackFromInit;

    return {
      id: resolvedEquipmentId || 0,
      name: equipmentName || `Equipment #${resolvedEquipmentId || ''}`,
      equipment_code: `EQ-${resolvedEquipmentId || '0'}`,
    } as Equipment;
  }, [equipment, resolvedEquipmentId, equipmentName]);

  // Check if equipment is an X-Ray machine
  const isXRay = useMemo(() => {
    if (!resolvedEquipment) return true;
    const typeId = resolvedEquipment.equipment_type_id;
    const code = String(resolvedEquipment.equipment_code || '').toUpperCase();
    const name = String(resolvedEquipment.name || '').toUpperCase();
    return typeId === 1 || code.includes('XRAY') || code.includes('X-RAY') || name.includes('XRAY') || name.includes('X-RAY');
  }, [resolvedEquipment]);

  // Extract trend points safely (with baseline fallback if no records yet)
  const trendPoints = useMemo(() => {
    try {
      return extractMeasurementTrendPoints(entries || [], resolvedEquipmentId, resolvedEquipment);
    } catch (err) {
      console.error('Error extracting measurement trend points:', err);
      return [];
    }
  }, [entries, resolvedEquipmentId, resolvedEquipment]);

  // Check if equipment supports dual view (Generator A + B)
  const isDualView = useMemo(() => {
    if (resolvedEquipment?.default_view === 'dual' || resolvedEquipment?.default_view_type === 'dual') {
      return true;
    }
    return trendPoints.some((p) => p.genA_pos_hv != null || p.genA_heater != null);
  }, [resolvedEquipment, trendPoints]);

  // Automatically reset to Generator B if equipment is single view
  useEffect(() => {
    if (!isDualView && selectedGenerator === 'A') {
      setSelectedGenerator('B');
    }
  }, [isDualView, selectedGenerator]);

  // Detect degradation/anomalies safely
  const anomalies = useMemo(() => {
    try {
      if (!trendPoints || trendPoints.length === 0) return [];
      return detectMeasurementAnomalies(trendPoints, resolvedEquipment, 5.0);
    } catch (err) {
      console.error('Error detecting measurement anomalies:', err);
      return [];
    }
  }, [trendPoints, resolvedEquipment]);

  const activeAnomalies = useMemo(() => {
    return anomalies.filter((a) => a.generator === selectedGenerator);
  }, [anomalies, selectedGenerator]);

  const handleStartInspection = () => {
    if (onStartPreventive && resolvedEquipmentId) {
      onStartPreventive(resolvedEquipmentId);
    } else if (onNavigatePreventive) {
      onNavigatePreventive();
    }
  };

  // 1. Non X-Ray equipment notice
  if (!isXRay) {
    return (
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 text-center shadow-xs">
        <Info className="w-10 h-10 text-sky-500 mx-auto mb-2.5" />
        <h4 className="text-sm font-bold text-slate-800">Tren Parameter Fisik Generator (Khusus X-Ray)</h4>
        <p className="text-xs text-slate-500 max-w-md mx-auto mt-1.5 leading-relaxed">
          Peralatan ini ({resolvedEquipment?.name || 'Unit'}) bertipe pemindai non X-Ray (seperti WTMD, HHMD, atau ETD) yang tidak menggunakan generator tegangan tinggi (HV). Pemantauan parameter kV dan arus hanya berlaku untuk mesin sinar-X.
        </p>
      </div>
    );
  }

  // 2. No trend points available at all
  if (!trendPoints || trendPoints.length === 0) {
    return (
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 text-center shadow-xs space-y-4">
        <Activity className="w-10 h-10 text-slate-300 mx-auto" />
        <div>
          <h4 className="text-sm font-bold text-slate-800">Belum Ada Data Pengukuran Parameter Fisik</h4>
          <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 leading-relaxed">
            Belum ada catatan inspeksi preventif yang memuat pembacaan tegangan tinggi (HV) dan arus untuk mesin {resolvedEquipment?.name || 'ini'}.
          </p>
        </div>
        {(onStartPreventive || onNavigatePreventive) && (
          <button
            onClick={handleStartInspection}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Mulai Catat Inspeksi Preventif Sekarang</span>
          </button>
        )}
      </div>
    );
  }

  const latestPoint = trendPoints[trendPoints.length - 1];
  const isBaselineOnly = trendPoints.length === 1 && trendPoints[0].display_label === 'Baseline Pabrik';

  return (
    <div className="space-y-4 bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
              Tren Parameter Fisik Generator
              <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                {isBaselineOnly ? 'Rujukan Baseline Pabrik' : `${trendPoints.length} Sesi Terakhir`}
              </span>
            </h3>
            <p className="text-xs text-slate-500">
              Pemantauan drift dan stabilitas tabung X-Ray ({resolvedEquipment?.name || 'Mesin'})
            </p>
          </div>
        </div>

        {/* Generator & Metric Switchers */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Generator Tab */}
          <div className="inline-flex bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold">
            <button
              onClick={() => setSelectedGenerator('B')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                selectedGenerator === 'B'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Generator B {isDualView ? '(Main)' : ''}
            </button>
            {isDualView ? (
              <button
                onClick={() => setSelectedGenerator('A')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  selectedGenerator === 'A'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Generator A
              </button>
            ) : (
              <span className="px-2.5 py-1 text-[11px] text-slate-400 italic">Single View</span>
            )}
          </div>

          {/* Metric Tab */}
          <div className="inline-flex bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold">
            <button
              onClick={() => setSelectedMetric('hv')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                selectedMetric === 'hv'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              High Voltage (kV)
            </button>
            <button
              onClick={() => setSelectedMetric('current')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                selectedMetric === 'current'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Arus (mA / µA)
            </button>
          </div>
        </div>
      </div>

      {isBaselineOnly && (
        <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between gap-3 text-xs text-blue-900">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-600 shrink-0" />
            <span>
              Menampilkan titik acuan baseline spesifikasi pabrik. Grafik akan membentuk garis tren otomatis seiring inspeksi harian dicatat.
            </span>
          </div>
          {(onStartPreventive || onNavigatePreventive) && (
            <button
              onClick={handleStartInspection}
              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[11px] shrink-0 transition cursor-pointer"
            >
              Catat Inspeksi Baru
            </button>
          )}
        </div>
      )}

      {/* Degradation / Predictive Maintenance Alerts */}
      {!isBaselineOnly && (
        activeAnomalies.length > 0 ? (
          <div className="space-y-2">
            {activeAnomalies.map((anomaly) => (
              <div
                key={anomaly.id}
                className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${
                  anomaly.severity === 'critical'
                    ? 'bg-rose-50 border-rose-200 text-rose-900'
                    : 'bg-amber-50 border-amber-200 text-amber-900'
                }`}
              >
                <AlertTriangle
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    anomaly.severity === 'critical' ? 'text-rose-600' : 'text-amber-600'
                  }`}
                />
                <div className="space-y-0.5">
                  <div className="font-bold flex items-center gap-1.5">
                    <span>Peringatan Degradasi Terdeteksi</span>
                    <span
                      className={`text-[10px] uppercase font-extrabold px-1.5 py-0.2 rounded ${
                        anomaly.severity === 'critical'
                          ? 'bg-rose-200 text-rose-800'
                          : 'bg-amber-200 text-amber-800'
                      }`}
                    >
                      {anomaly.percentDelta > 0 ? `+${anomaly.percentDelta}%` : `${anomaly.percentDelta}%`}
                    </span>
                  </div>
                  <div className="leading-relaxed font-medium">{anomaly.message}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-xs text-emerald-800 font-medium">
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              Kondisi Generator {selectedGenerator} stabil. Nilai tegangan dan arus berada dalam toleransi operasi normal.
            </span>
          </div>
        )
      )}

      {/* Recharts Chart Container with guaranteed height */}
      <div className="w-full pt-2" style={{ minHeight: 280, height: 300 }}>
        <ResponsiveContainer width="100%" height={290} minHeight={270}>
          <LineChart data={trendPoints} margin={{ top: 12, right: 20, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="display_label"
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: '#cbd5e1' }}
            />

            {/* Metric HV: single YAxis with padded domain to avoid NaN on identical values */}
            {selectedMetric === 'hv' && (
              <>
                <YAxis
                  stroke="#2563eb"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#cbd5e1' }}
                  domain={[
                    (dataMin: number) => (isFinite(dataMin) ? Math.max(0, Math.floor(dataMin * 0.85) - 5) : 40),
                    (dataMax: number) => (isFinite(dataMax) ? Math.ceil(dataMax * 1.15) + 5 : 100),
                  ]}
                  unit=" kV"
                />
                <ReferenceLine
                  y={70}
                  stroke="#94a3b8"
                  strokeDasharray="3 3"
                  label={{ value: 'Standar 70 kV', fill: '#64748b', fontSize: 10, position: 'insideTopRight' }}
                />
              </>
            )}

            {/* Metric Current: dual Y-axes for mA (left) and µA (right) */}
            {selectedMetric === 'current' && (
              <>
                <YAxis
                  yAxisId="heater"
                  orientation="left"
                  stroke="#059669"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#059669' }}
                  domain={[
                    (dataMin: number) => (isFinite(dataMin) ? Math.max(0, Math.floor(dataMin * 0.85) - 10) : 80),
                    (dataMax: number) => (isFinite(dataMax) ? Math.ceil(dataMax * 1.15) + 10 : 160),
                  ]}
                  unit=" mA"
                />
                <YAxis
                  yAxisId="anode"
                  orientation="right"
                  stroke="#d97706"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#d97706' }}
                  domain={[
                    (dataMin: number) => (isFinite(dataMin) ? Math.max(0, Math.floor(dataMin * 0.85) - 20) : 150),
                    (dataMax: number) => (isFinite(dataMax) ? Math.ceil(dataMax * 1.15) + 20 : 300),
                  ]}
                  unit=" µA"
                />
              </>
            )}

            <Tooltip
              contentStyle={{
                backgroundColor: '#ffffff',
                borderColor: '#cbd5e1',
                borderRadius: '0.75rem',
                fontSize: '12px',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
              }}
            />
            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />

            {/* High Voltage Lines for Generator B */}
            {selectedMetric === 'hv' && selectedGenerator === 'B' && (
              <>
                <Line
                  type="monotone"
                  dataKey="genB_pos_hv"
                  name="Positive HV Gen B (kV)"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  dot={{ r: 5, strokeWidth: 2, fill: '#ffffff' }}
                  activeDot={{ r: 7 }}
                />
                <Line
                  type="monotone"
                  dataKey="genB_neg_hv"
                  name="Negative HV Gen B (|kV|)"
                  stroke="#7c3aed"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={{ r: 4, strokeWidth: 2, fill: '#ffffff' }}
                  activeDot={{ r: 6 }}
                />
              </>
            )}

            {/* High Voltage Lines for Generator A */}
            {selectedMetric === 'hv' && selectedGenerator === 'A' && (
              <>
                <Line
                  type="monotone"
                  dataKey="genA_pos_hv"
                  name="Positive HV Gen A (kV)"
                  stroke="#0284c7"
                  strokeWidth={2.5}
                  dot={{ r: 5, strokeWidth: 2, fill: '#ffffff' }}
                  activeDot={{ r: 7 }}
                />
                <Line
                  type="monotone"
                  dataKey="genA_neg_hv"
                  name="Negative HV Gen A (|kV|)"
                  stroke="#d97706"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={{ r: 4, strokeWidth: 2, fill: '#ffffff' }}
                  activeDot={{ r: 6 }}
                />
              </>
            )}

            {/* Current Lines for Generator B */}
            {selectedMetric === 'current' && selectedGenerator === 'B' && (
              <>
                <Line
                  type="monotone"
                  dataKey="genB_heater"
                  yAxisId="heater"
                  name="Heater Current Gen B (mA)"
                  stroke="#059669"
                  strokeWidth={2.5}
                  dot={{ r: 5, strokeWidth: 2, fill: '#ffffff' }}
                  activeDot={{ r: 7 }}
                />
                <Line
                  type="monotone"
                  dataKey="genB_anode"
                  yAxisId="anode"
                  name="Anode Current Gen B (µA)"
                  stroke="#d97706"
                  strokeWidth={2}
                  dot={{ r: 4, strokeWidth: 2, fill: '#ffffff' }}
                  activeDot={{ r: 6 }}
                />
              </>
            )}

            {/* Current Lines for Generator A */}
            {selectedMetric === 'current' && selectedGenerator === 'A' && (
              <>
                <Line
                  type="monotone"
                  dataKey="genA_heater"
                  yAxisId="heater"
                  name="Heater Current Gen A (mA)"
                  stroke="#059669"
                  strokeWidth={2.5}
                  dot={{ r: 5, strokeWidth: 2, fill: '#ffffff' }}
                  activeDot={{ r: 7 }}
                />
                <Line
                  type="monotone"
                  dataKey="genA_anode"
                  yAxisId="anode"
                  name="Anode Current Gen A (µA)"
                  stroke="#d97706"
                  strokeWidth={2}
                  dot={{ r: 4, strokeWidth: 2, fill: '#ffffff' }}
                  activeDot={{ r: 6 }}
                />
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Summary Footer */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-slate-100 text-xs">
        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
          <div className="text-slate-500 font-medium">Nilai Terakhir Pos HV</div>
          <div className="text-sm font-bold text-blue-700 mt-0.5">
            {selectedGenerator === 'B'
              ? (latestPoint?.genB_pos_hv != null ? `${latestPoint.genB_pos_hv} kV` : '-')
              : (latestPoint?.genA_pos_hv != null ? `${latestPoint.genA_pos_hv} kV` : '-')}
          </div>
        </div>
        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
          <div className="text-slate-500 font-medium">Nilai Terakhir Neg HV</div>
          <div className="text-sm font-bold text-purple-700 mt-0.5">
            {selectedGenerator === 'B'
              ? (latestPoint?.genB_neg_hv != null ? `-${latestPoint.genB_neg_hv} kV` : '-')
              : (latestPoint?.genA_neg_hv != null ? `-${latestPoint.genA_neg_hv} kV` : '-')}
          </div>
        </div>
        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
          <div className="text-slate-500 font-medium">Heater Current</div>
          <div className="text-sm font-bold text-emerald-700 mt-0.5">
            {selectedGenerator === 'B'
              ? (latestPoint?.genB_heater != null ? `${latestPoint.genB_heater} mA` : '-')
              : (latestPoint?.genA_heater != null ? `${latestPoint.genA_heater} mA` : '-')}
          </div>
        </div>
        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
          <div className="text-slate-500 font-medium">Anode Current</div>
          <div className="text-sm font-bold text-amber-700 mt-0.5">
            {selectedGenerator === 'B'
              ? (latestPoint?.genB_anode != null ? `${latestPoint.genB_anode} µA` : '-')
              : (latestPoint?.genA_anode != null ? `${latestPoint.genA_anode} µA` : '-')}
          </div>
        </div>
      </div>
    </div>
  );
};

export const MeasurementTrendChart: React.FC<MeasurementTrendChartProps> = (props) => {
  return (
    <ErrorBoundary
      fallbackTitle="Grafik Tren Parameter Mengalami Kendala"
      fallbackMessage="Tidak dapat menampilkan grafik pengukuran parameter saat ini. Silakan coba kembali."
    >
      <MeasurementTrendChartContent {...props} />
    </ErrorBoundary>
  );
};

