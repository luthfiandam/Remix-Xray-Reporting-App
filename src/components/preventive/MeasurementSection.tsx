import React, { useState, useEffect } from 'react';
import { Sliders } from 'lucide-react';
import { MeasurementValue } from '../../types';

interface MeasurementSectionProps {
  viewType: 'single' | 'dual';
  onToggleViewType: () => void;
  genAMeasurement: MeasurementValue;
  onGenAMeasurementChange: (val: MeasurementValue) => void;
  genBMeasurement: MeasurementValue;
  onGenBMeasurementChange: (val: MeasurementValue) => void;
  mobileStep: number;
  isViewerOnly?: boolean;
}

export const MeasurementSection: React.FC<MeasurementSectionProps> = ({
  viewType,
  onToggleViewType,
  genAMeasurement,
  onGenAMeasurementChange,
  genBMeasurement,
  onGenBMeasurementChange,
  mobileStep,
  isViewerOnly = false,
}) => {
  // Local string inputs for seamless editing without annoying 0 snaps on backspace
  const [inputsA, setInputsA] = useState({
    positive: genAMeasurement?.positive_high_voltage !== undefined ? String(genAMeasurement.positive_high_voltage) : '80.0',
    negative: genAMeasurement?.negative_high_voltage !== undefined ? String(Math.abs(genAMeasurement.negative_high_voltage)) : '75.0',
    heater: genAMeasurement?.heater_current !== undefined ? String(genAMeasurement.heater_current) : '450.0',
    anode: genAMeasurement?.anode_current !== undefined ? String(genAMeasurement.anode_current) : '400.0',
  });

  const [inputsB, setInputsB] = useState({
    positive: genBMeasurement?.positive_high_voltage !== undefined ? String(genBMeasurement.positive_high_voltage) : '80.0',
    negative: genBMeasurement?.negative_high_voltage !== undefined ? String(Math.abs(genBMeasurement.negative_high_voltage)) : '75.0',
    heater: genBMeasurement?.heater_current !== undefined ? String(genBMeasurement.heater_current) : '500.0',
    anode: genBMeasurement?.anode_current !== undefined ? String(genBMeasurement.anode_current) : '450.0',
  });

  // Keep local inputs in sync when switching between machines or when external props update
  useEffect(() => {
    setInputsA({
      positive: genAMeasurement?.positive_high_voltage !== undefined ? String(genAMeasurement.positive_high_voltage) : '80.0',
      negative: genAMeasurement?.negative_high_voltage !== undefined ? String(Math.abs(genAMeasurement.negative_high_voltage)) : '75.0',
      heater: genAMeasurement?.heater_current !== undefined ? String(genAMeasurement.heater_current) : '450.0',
      anode: genAMeasurement?.anode_current !== undefined ? String(genAMeasurement.anode_current) : '400.0',
    });
  }, [
    genAMeasurement?.positive_high_voltage,
    genAMeasurement?.negative_high_voltage,
    genAMeasurement?.heater_current,
    genAMeasurement?.anode_current,
  ]);

  useEffect(() => {
    setInputsB({
      positive: genBMeasurement?.positive_high_voltage !== undefined ? String(genBMeasurement.positive_high_voltage) : '80.0',
      negative: genBMeasurement?.negative_high_voltage !== undefined ? String(Math.abs(genBMeasurement.negative_high_voltage)) : '75.0',
      heater: genBMeasurement?.heater_current !== undefined ? String(genBMeasurement.heater_current) : '500.0',
      anode: genBMeasurement?.anode_current !== undefined ? String(genBMeasurement.anode_current) : '450.0',
    });
  }, [
    genBMeasurement?.positive_high_voltage,
    genBMeasurement?.negative_high_voltage,
    genBMeasurement?.heater_current,
    genBMeasurement?.anode_current,
  ]);

  const handleFieldChangeA = (field: 'positive' | 'negative' | 'heater' | 'anode', rawVal: string) => {
    // Clean input to allow digits and dot
    const sanitized = rawVal.replace(/[^0-9.]/g, '');
    const newInputs = { ...inputsA, [field]: sanitized };
    setInputsA(newInputs);

    const parsedNum = parseFloat(sanitized);
    const numVal = isNaN(parsedNum) ? 0 : parsedNum;

    onGenAMeasurementChange({
      ...genAMeasurement,
      positive_high_voltage: field === 'positive' ? numVal : (parseFloat(newInputs.positive) || 0),
      // Automatically keep magnitude, will be negated on submit
      negative_high_voltage: field === 'negative' ? (numVal > 0 ? -numVal : numVal) : -(parseFloat(newInputs.negative) || 0),
      heater_current: field === 'heater' ? numVal : (parseFloat(newInputs.heater) || 0),
      anode_current: field === 'anode' ? numVal : (parseFloat(newInputs.anode) || 0),
    });
  };

  const handleFieldChangeB = (field: 'positive' | 'negative' | 'heater' | 'anode', rawVal: string) => {
    const sanitized = rawVal.replace(/[^0-9.]/g, '');
    const newInputs = { ...inputsB, [field]: sanitized };
    setInputsB(newInputs);

    const parsedNum = parseFloat(sanitized);
    const numVal = isNaN(parsedNum) ? 0 : parsedNum;

    onGenBMeasurementChange({
      ...genBMeasurement,
      positive_high_voltage: field === 'positive' ? numVal : (parseFloat(newInputs.positive) || 0),
      negative_high_voltage: field === 'negative' ? (numVal > 0 ? -numVal : numVal) : -(parseFloat(newInputs.negative) || 0),
      heater_current: field === 'heater' ? numVal : (parseFloat(newInputs.heater) || 0),
      anode_current: field === 'anode' ? numVal : (parseFloat(newInputs.anode) || 0),
    });
  };

  return (
    <div
      className={`bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 shadow-xs space-y-3.5 ${
        mobileStep !== 2 ? 'hidden lg:block' : ''
      }`}
    >
      <div className="border-b border-slate-100 pb-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Sliders className="w-4 h-4 text-blue-600" />
            <span>2. Pengukuran Tegangan Generator</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5 font-medium">
            Masukkan nilai pengukuran tegangan (HV negatif otomatis ditambahkan minus saat submit)
          </p>
        </div>

        {/* Single View / Dual View Toggle */}
        <div className="bg-slate-100 p-1 rounded-xl flex items-center gap-1.5 self-start sm:self-auto border border-slate-200">
          <span className="text-xs font-bold text-slate-700 px-2">Mode Mesin</span>
          <button
            type="button"
            onClick={onToggleViewType}
            disabled={isViewerOnly}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              isViewerOnly
                ? 'opacity-60 cursor-not-allowed bg-white text-slate-600 border border-slate-200'
                : viewType === 'dual'
                ? 'bg-blue-600 text-white shadow-xs cursor-pointer'
                : 'bg-white text-slate-800 shadow-xs border border-slate-200 cursor-pointer'
            }`}
          >
            {viewType === 'dual' ? 'Dual View' : 'Single View'}
          </button>
        </div>
      </div>

      {/* Generator Measurements Input Grid */}
      <div className="space-y-4">
        {/* Generator A (if Dual View) */}
        {viewType === 'dual' && (
          <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-3 sm:p-3.5 space-y-2.5">
            <span className="text-xs font-bold text-blue-900 uppercase tracking-wider block">
              Generator A (Side View)
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Positive High Voltage (+kV)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="80.0"
                  disabled={isViewerOnly}
                  readOnly={isViewerOnly}
                  value={inputsA.positive}
                  onChange={(e) => handleFieldChangeA('positive', e.target.value)}
                  className={`w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs sm:text-sm font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 ${
                    isViewerOnly ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'bg-white'
                  }`}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Negative High Voltage (-kV)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="75.0"
                  disabled={isViewerOnly}
                  readOnly={isViewerOnly}
                  value={inputsA.negative}
                  onChange={(e) => handleFieldChangeA('negative', e.target.value)}
                  className={`w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs sm:text-sm font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 ${
                    isViewerOnly ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'bg-white'
                  }`}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Heater Current (mA)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="450.0"
                  disabled={isViewerOnly}
                  readOnly={isViewerOnly}
                  value={inputsA.heater}
                  onChange={(e) => handleFieldChangeA('heater', e.target.value)}
                  className={`w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs sm:text-sm font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 ${
                    isViewerOnly ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'bg-white'
                  }`}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Anode Current (mA)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="400.0"
                  disabled={isViewerOnly}
                  readOnly={isViewerOnly}
                  value={inputsA.anode}
                  onChange={(e) => handleFieldChangeA('anode', e.target.value)}
                  className={`w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs sm:text-sm font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 ${
                    isViewerOnly ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'bg-white'
                  }`}
                />
              </div>
            </div>
          </div>
        )}

        {/* Generator B */}
        <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-3 sm:p-3.5 space-y-2.5">
          <span className="text-xs font-bold text-blue-900 uppercase tracking-wider block">
            Generator B (Top/Bottom View)
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Positive High Voltage (+kV)
              </label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="80.0"
                disabled={isViewerOnly}
                readOnly={isViewerOnly}
                value={inputsB.positive}
                onChange={(e) => handleFieldChangeB('positive', e.target.value)}
                className={`w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs sm:text-sm font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 ${
                  isViewerOnly ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'bg-white'
                }`}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Negative High Voltage (-kV)
              </label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="75.0"
                disabled={isViewerOnly}
                readOnly={isViewerOnly}
                value={inputsB.negative}
                onChange={(e) => handleFieldChangeB('negative', e.target.value)}
                className={`w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs sm:text-sm font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 ${
                  isViewerOnly ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'bg-white'
                }`}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Heater Current (mA)
              </label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="500.0"
                disabled={isViewerOnly}
                readOnly={isViewerOnly}
                value={inputsB.heater}
                onChange={(e) => handleFieldChangeB('heater', e.target.value)}
                className={`w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs sm:text-sm font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 ${
                  isViewerOnly ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'bg-white'
                }`}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Anode Current (mA)
              </label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="450.0"
                disabled={isViewerOnly}
                readOnly={isViewerOnly}
                value={inputsB.anode}
                onChange={(e) => handleFieldChangeB('anode', e.target.value)}
                className={`w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs sm:text-sm font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 ${
                  isViewerOnly ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'bg-white'
                }`}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
