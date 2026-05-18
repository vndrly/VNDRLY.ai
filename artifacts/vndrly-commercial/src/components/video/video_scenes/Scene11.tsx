import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const CREW = [
  { name: 'M. Alvarez', role: 'Foreman', initials: 'MA' },
  { name: 'J. Becker', role: 'Operator', initials: 'JB' },
  { name: 'R. Cortez', role: 'Operator', initials: 'RC' },
  { name: 'D. Hoang', role: 'Helper', initials: 'DH' },
  { name: 'T. Pierce', role: 'Helper', initials: 'TP' },
];

const COMPLIANCE = [
  { label: 'Safety', pct: 100, color: '#10b981', warn: false },
  { label: 'Certifications', pct: 86, color: '#38bdf8', warn: true },
  { label: 'Training', pct: 94, color: '#10b981', warn: false },
];

export function Scene11() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 4500),
      setTimeout(() => setPhase(4), 8500),
      setTimeout(() => setPhase(5), 12000),
    ];
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
      <motion.div
        className="text-center mb-8"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : -20 }}
      >
        <div className="text-[1vw] uppercase tracking-[0.4em] text-[#38bdf8] mb-2 font-semibold">
          Crews & Compliance
        </div>
        <h2 className="text-[3vw] font-black text-white leading-tight tracking-tight">
          Foremen run the crew. <span className="text-[#10b981]">VNDRLY runs the cards.</span>
        </h2>
      </motion.div>

      <div className="grid grid-cols-2 gap-8 w-[80vw] max-w-6xl">
        {/* Crew roster */}
        <div className="bg-slate-900/80 border border-slate-700 rounded-2xl p-6 backdrop-blur-md shadow-2xl">
          <div className="text-[0.85vw] uppercase tracking-wider text-slate-400 font-bold mb-4">
            Crew · Pad 14
          </div>
          <div className="flex flex-col gap-2.5">
            {CREW.map((c, i) => (
              <motion.div
                key={c.name}
                className="flex items-center justify-between bg-slate-800/60 rounded-xl p-3"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: phase >= 2 ? 1 : 0, x: phase >= 2 ? 0 : -20 }}
                transition={{ delay: i * 0.12 }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#38bdf8]/20 border border-[#38bdf8]/60 flex items-center justify-center text-[#38bdf8] font-bold text-[0.85vw]">
                    {c.initials}
                  </div>
                  <div>
                    <div className="text-white font-bold text-[1vw]">{c.name}</div>
                    <div className="text-slate-400 text-[0.75vw]">{c.role}</div>
                  </div>
                </div>
                <motion.div
                  className="w-12 h-6 rounded-full p-0.5"
                  animate={{
                    backgroundColor: phase >= 2 ? '#10b981' : '#334155',
                  }}
                  transition={{ delay: 0.4 + i * 0.12 }}
                >
                  <motion.div
                    className="w-5 h-5 rounded-full bg-white"
                    initial={{ x: 0 }}
                    animate={{ x: phase >= 2 ? 24 : 0 }}
                    transition={{
                      delay: 0.4 + i * 0.12,
                      type: 'spring',
                      stiffness: 300,
                    }}
                  />
                </motion.div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Compliance cards */}
        <div className="grid grid-rows-3 gap-3">
          {COMPLIANCE.map((c, i) => (
            <motion.div
              key={c.label}
              className="bg-slate-900/80 border rounded-2xl p-5 backdrop-blur-md shadow-xl flex items-center gap-5"
              style={{
                borderColor: c.warn && phase >= 4 ? '#38bdf8' : '#334155',
              }}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: phase >= 3 ? 1 : 0, x: phase >= 3 ? 0 : 30 }}
              transition={{ delay: i * 0.18 }}
            >
              {/* Progress ring */}
              <div className="relative w-[5vw] h-[5vw]">
                <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                  <circle
                    cx="18"
                    cy="18"
                    r="15"
                    fill="none"
                    stroke="#1e293b"
                    strokeWidth="3"
                  />
                  <motion.circle
                    cx="18"
                    cy="18"
                    r="15"
                    fill="none"
                    stroke={c.color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={`${94.25}`}
                    initial={{ strokeDashoffset: 94.25 }}
                    animate={{
                      strokeDashoffset:
                        phase >= 3 ? 94.25 - (94.25 * c.pct) / 100 : 94.25,
                    }}
                    transition={{ duration: 1.2, delay: i * 0.18 + 0.2 }}
                  />
                </svg>
                <div
                  className="absolute inset-0 flex items-center justify-center text-[1.1vw] font-bold tabular-nums"
                  style={{ color: c.color }}
                >
                  {c.pct}%
                </div>
              </div>
              <div className="flex-1">
                <div className="text-white font-black text-[1.4vw]">{c.label}</div>
                {c.warn && (
                  <motion.div
                    className="mt-1 inline-block px-3 py-0.5 rounded-full bg-[#38bdf8]/15 border border-[#38bdf8]/60 text-[#38bdf8] font-bold text-[0.75vw] uppercase tracking-wider"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{
                      opacity: phase >= 4 ? 1 : 0,
                      scale: phase >= 4 ? [1, 1.08, 1] : 0.8,
                    }}
                    transition={{
                      duration: 1.2,
                      repeat: phase >= 4 ? Infinity : 0,
                    }}
                  >
                    Expires in 7 days
                  </motion.div>
                )}
                {!c.warn && (
                  <div className="text-slate-400 text-[0.85vw] mt-1">All current</div>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
