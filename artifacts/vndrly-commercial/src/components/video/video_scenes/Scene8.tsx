import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const STEPS = [
  { label: 'Upload COI', icon: 'M12 4v16m8-8H4' },
  { label: 'Catalog Pricing', icon: 'M3 7h18M3 12h18M3 17h18' },
  { label: 'Sign Contract', icon: 'M9 12l2 2 4-4' },
  { label: 'Set Up Crews', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0' },
  { label: 'Approved', icon: 'M5 13l4 4L19 7' },
];

export function Scene8() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = STEPS.map((_, i) =>
      setTimeout(() => setPhase(i + 1), 800 + i * 1900),
    );
    timers.push(setTimeout(() => setPhase(STEPS.length + 1), 12000));
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 w-full h-full bg-[#020617] z-10 overflow-hidden flex flex-col items-center justify-center px-12"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      <div className="text-[1vw] uppercase tracking-[0.4em] text-[#38bdf8] mb-2 font-semibold">
        Vendor onboarding
      </div>
      <h2 className="text-[3vw] font-black text-white mb-12 text-center tracking-tight max-w-[60vw]">
        Bite-sized. Done <span className="text-[#10b981]">between jobs</span>.
      </h2>

      <div className="relative w-[75vw] max-w-5xl">
        {/* Connector line */}
        <div className="absolute top-9 left-[10%] right-[10%] h-0.5 bg-slate-800" />
        <motion.div
          className="absolute top-9 left-[10%] h-0.5 bg-[#10b981]"
          initial={{ width: 0 }}
          animate={{ width: `${(Math.min(phase, STEPS.length) / STEPS.length) * 80}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />

        <div className="grid grid-cols-5 gap-4 relative">
          {STEPS.map((s, i) => {
            const done = phase > i;
            const active = phase === i + 1;
            return (
              <div key={s.label} className="flex flex-col items-center">
                <motion.div
                  className="w-[4.5vw] h-[4.5vw] rounded-full flex items-center justify-center border-2 z-10"
                  style={{
                    borderColor: done ? '#10b981' : '#334155',
                    backgroundColor: done ? '#10b98122' : '#0f172a',
                  }}
                  animate={{
                    scale: active ? [1, 1.15, 1] : 1,
                  }}
                  transition={{ duration: 0.6 }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="w-7 h-7"
                    fill="none"
                    stroke={done ? '#10b981' : '#64748b'}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={s.icon} />
                  </svg>
                </motion.div>
                <div
                  className="mt-3 text-[1vw] font-bold text-center"
                  style={{ color: done ? '#10b981' : '#64748b' }}
                >
                  {s.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Calendar / time-saved card */}
      <motion.div
        className="mt-12 flex items-center gap-8 bg-slate-900/80 backdrop-blur-md border border-slate-700 rounded-2xl px-10 py-6 shadow-2xl"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : 30 }}
        transition={{ duration: 0.7 }}
      >
        <div className="text-center">
          <div className="text-[0.8vw] uppercase tracking-wider text-slate-500 mb-1">
            Old way
          </div>
          <div className="text-[2.4vw] font-black text-slate-400 line-through leading-none">
            Weeks
          </div>
        </div>
        <div className="text-[1.6vw] text-[#38bdf8] font-mono">→</div>
        <div className="text-center">
          <div className="text-[0.8vw] uppercase tracking-wider text-[#10b981] mb-1">
            VNDRLY
          </div>
          <div className="text-[2.4vw] font-black text-[#10b981] leading-none">Days</div>
        </div>
      </motion.div>
    </motion.div>
  );
}
