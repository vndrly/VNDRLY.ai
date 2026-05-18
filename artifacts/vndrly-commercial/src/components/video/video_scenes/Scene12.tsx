import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const ITEMS = [
  { label: 'Labor', desc: '6.5 hrs @ $85/hr', amount: 552.5 },
  { label: 'Part', desc: 'Pump seal kit', amount: 184.0 },
  { label: 'Equipment', desc: 'Vac truck (day)', amount: 1850.0 },
  { label: 'Mileage', desc: '142.5 mi @ $0.67', amount: 95.48 },
];

export function Scene12() {
  const [phase, setPhase] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 3000),
      setTimeout(() => setPhase(4), 4500),
      setTimeout(() => setPhase(5), 6500),
    ];
    const ticker = setInterval(() => setTick((t) => t + 1), 60);
    return () => {
      timers.forEach((t) => clearTimeout(t));
      clearInterval(ticker);
    };
  }, []);

  const visibleSum = ITEMS.slice(0, Math.max(0, phase - 1)).reduce(
    (a, b) => a + b.amount,
    0,
  );
  const animatedSum = Math.min(tick * 35, visibleSum);

  return (
    <motion.div
      className="absolute inset-0 w-full h-full bg-[#020617] z-10 overflow-hidden flex flex-col items-center justify-center px-12"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      <motion.div
        className="text-center mb-6"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : -20 }}
      >
        <div className="text-[1vw] uppercase tracking-[0.4em] text-[#38bdf8] mb-2 font-semibold">
          Parts & Labor
        </div>
        <h2 className="text-[2.8vw] font-black text-white tracking-tight">
          Lines write <span className="text-[#10b981]">themselves</span>.
        </h2>
      </motion.div>

      <div className="w-[55vw] max-w-3xl bg-slate-900/80 border border-slate-700 rounded-2xl backdrop-blur-md shadow-2xl overflow-hidden">
        {ITEMS.map((it, i) => (
          <motion.div
            key={it.label}
            className="flex justify-between items-center px-6 py-4 border-b border-slate-800 last:border-b-0"
            initial={{ opacity: 0, y: 20 }}
            animate={{
              opacity: phase >= i + 2 ? 1 : 0,
              y: phase >= i + 2 ? 0 : 20,
            }}
            transition={{ duration: 0.5 }}
          >
            <div className="flex items-center gap-4">
              <div
                className="w-2 h-8 rounded"
                style={{ backgroundColor: i % 2 === 0 ? '#38bdf8' : '#10b981' }}
              />
              <div>
                <div className="text-white font-black text-[1.2vw] uppercase tracking-wide">
                  {it.label}
                </div>
                <div className="text-slate-400 text-[0.85vw]">{it.desc}</div>
              </div>
            </div>
            <div className="text-[#10b981] font-mono font-bold text-[1.4vw] tabular-nums">
              ${it.amount.toFixed(2)}
            </div>
          </motion.div>
        ))}
        <div className="bg-slate-800/60 px-6 py-5 flex justify-between items-center">
          <div className="text-[0.9vw] uppercase tracking-wider text-slate-400 font-bold">
            Subtotal
          </div>
          <div className="text-white font-mono font-black text-[2vw] tabular-nums">
            ${animatedSum.toFixed(2)}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
