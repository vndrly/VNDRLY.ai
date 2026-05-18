import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const BARS = [
  { label: 'Apex', val: 96 },
  { label: 'Permian', val: 88 },
  { label: 'Lone Star', val: 72 },
  { label: 'West TX', val: 64 },
  { label: 'Basin', val: 54 },
];

export function Scene15() {
  const [phase, setPhase] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 3200),
      setTimeout(() => setPhase(4), 5500),
    ];
    const ticker = setInterval(() => setTick((t) => t + 1), 80);
    return () => {
      timers.forEach((t) => clearTimeout(t));
      clearInterval(ticker);
    };
  }, []);

  const burn = Math.min(tick * 1.2, 68);
  const onTimeRate = Math.min(tick * 1.6, 92);

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
          Analytics
        </div>
        <h2 className="text-[2.8vw] font-black text-white tracking-tight">
          From data to <span className="text-[#10b981]">signal</span>.
        </h2>
      </motion.div>

      <div className="grid grid-cols-3 gap-5 w-[80vw] max-w-6xl">
        {/* Bar chart */}
        <motion.div
          className="bg-slate-900/80 border border-slate-700 rounded-2xl p-5 shadow-2xl backdrop-blur-md"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: phase >= 2 ? 1 : 0, y: phase >= 2 ? 0 : 30 }}
        >
          <div className="text-[0.75vw] uppercase tracking-wider text-slate-400 mb-1">
            Vendors on time
          </div>
          <div className="text-white font-mono font-black text-[2vw] tabular-nums">
            {onTimeRate.toFixed(0)}%
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {BARS.map((b, i) => (
              <div key={b.label} className="flex items-center gap-2">
                <div className="text-[0.7vw] text-slate-400 w-[3.5vw]">{b.label}</div>
                <div className="flex-1 h-3 bg-slate-800 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{
                      background: `linear-gradient(90deg, #38bdf8, #10b981)`,
                    }}
                    initial={{ width: 0 }}
                    animate={{ width: phase >= 2 ? `${b.val}%` : 0 }}
                    transition={{ duration: 1.2, delay: 0.2 + i * 0.12 }}
                  />
                </div>
                <div className="text-[0.7vw] text-slate-300 font-mono w-[2.5vw] text-right">
                  {b.val}
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Donut */}
        <motion.div
          className="bg-slate-900/80 border border-slate-700 rounded-2xl p-5 shadow-2xl backdrop-blur-md flex flex-col items-center"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: phase >= 3 ? 1 : 0, y: phase >= 3 ? 0 : 30 }}
        >
          <div className="text-[0.75vw] uppercase tracking-wider text-slate-400 self-start mb-1">
            Budget burn (MTD)
          </div>
          <div className="relative w-[10vw] h-[10vw] mt-2">
            <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
              <circle cx="18" cy="18" r="15" fill="none" stroke="#1e293b" strokeWidth="4" />
              <motion.circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                stroke="#38bdf8"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${94.25}`}
                initial={{ strokeDashoffset: 94.25 }}
                animate={{
                  strokeDashoffset: phase >= 3 ? 94.25 - (94.25 * burn) / 100 : 94.25,
                }}
                transition={{ duration: 1.4 }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-white font-mono font-black text-[1.8vw] tabular-nums">
                {burn.toFixed(0)}%
              </div>
              <div className="text-[0.7vw] text-slate-400">of $1.2M</div>
            </div>
          </div>
        </motion.div>

        {/* Line graph */}
        <motion.div
          className="bg-slate-900/80 border border-slate-700 rounded-2xl p-5 shadow-2xl backdrop-blur-md"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: phase >= 4 ? 1 : 0, y: phase >= 4 ? 0 : 30 }}
        >
          <div className="text-[0.75vw] uppercase tracking-wider text-slate-400 mb-1">
            Labor trend
          </div>
          <div className="text-white font-mono font-black text-[2vw] tabular-nums">
            12,840 hrs
          </div>
          <div className="mt-3">
            <svg viewBox="0 0 100 50" className="w-full h-[8vw]">
              <motion.path
                d="M0 35 L15 30 L30 32 L45 22 L60 25 L75 12 L90 16 L100 8"
                fill="none"
                stroke="#10b981"
                strokeWidth="1.5"
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: phase >= 4 ? 1 : 0 }}
                transition={{ duration: 1.6 }}
              />
              <motion.path
                d="M0 35 L15 30 L30 32 L45 22 L60 25 L75 12 L90 16 L100 8 L100 50 L0 50 Z"
                fill="url(#g15)"
                initial={{ opacity: 0 }}
                animate={{ opacity: phase >= 4 ? 0.4 : 0 }}
                transition={{ duration: 1.6 }}
              />
              <defs>
                <linearGradient id="g15" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="#10b981" stopOpacity="0.6" />
                  <stop offset="1" stopColor="#10b981" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div className="text-[0.7vw] text-[#10b981] font-mono">↑ 14% vs prior</div>
        </motion.div>
      </div>

      <motion.div
        className="mt-8 text-[1.3vw] text-slate-300 italic"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 4 ? 1 : 0 }}
        transition={{ delay: 0.6 }}
      >
        Stop reacting. Start steering.
      </motion.div>
    </motion.div>
  );
}
