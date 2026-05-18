import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const PINS = [
  { x: '22%', y: '38%', afe: 'AFE-2401', spend: 184500 },
  { x: '48%', y: '55%', afe: 'AFE-2402', spend: 92300 },
  { x: '68%', y: '32%', afe: 'AFE-2403', spend: 256100 },
  { x: '36%', y: '70%', afe: 'AFE-2404', spend: 47800 },
  { x: '78%', y: '62%', afe: 'AFE-2405', spend: 138900 },
];

export function Scene5() {
  const [phase, setPhase] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 3500),
      setTimeout(() => setPhase(4), 5500),
      setTimeout(() => setPhase(5), 8500),
    ];
    const ticker = setInterval(() => setTick((t) => t + 1), 80);
    return () => {
      timers.forEach((t) => clearTimeout(t));
      clearInterval(ticker);
    };
  }, []);

  const total = Math.min(tick * 4500, 719600);

  return (
    <motion.div
      className="absolute inset-0 w-full h-full bg-[#020617] z-10 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      <div className="absolute inset-0 z-0">
        <img
          src={`${import.meta.env.BASE_URL}images/gps-map.png`}
          className="w-full h-full object-cover opacity-50"
          alt=""
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#020617]/70 via-transparent to-[#020617]/80" />
      </div>

      {/* Map pins */}
      <div className="absolute inset-0 z-10">
        {PINS.map((p, i) => (
          <div key={p.afe} className="absolute" style={{ left: p.x, top: p.y }}>
            <motion.div
              className="absolute w-12 h-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#38bdf8]"
              animate={{ scale: [1, 2.2, 1], opacity: [0.8, 0, 0.8] }}
              transition={{
                duration: 2.4,
                repeat: Infinity,
                delay: i * 0.3,
              }}
            />
            <motion.div
              className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#38bdf8] shadow-[0_0_20px_#38bdf8]"
              initial={{ scale: 0 }}
              animate={{ scale: phase >= 2 ? 1 : 0 }}
              transition={{ delay: i * 0.15, type: 'spring', stiffness: 300 }}
            />
            <motion.div
              className="absolute -translate-x-1/2 -translate-y-[200%] px-3 py-1.5 rounded-md bg-slate-900/95 border border-[#38bdf8]/60 text-[0.85vw] font-mono font-bold text-[#38bdf8] whitespace-nowrap"
              initial={{ opacity: 0, y: 10 }}
              animate={{
                opacity: phase >= 3 ? 1 : 0,
                y: phase >= 3 ? 0 : 10,
              }}
              transition={{ delay: i * 0.15 + 0.3 }}
            >
              {p.afe}
            </motion.div>
          </div>
        ))}
      </div>

      {/* Headline */}
      <div className="absolute top-10 left-12 z-20 max-w-[40vw]">
        <motion.div
          className="text-[1vw] uppercase tracking-[0.4em] text-[#38bdf8] mb-3 font-semibold"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : -10 }}
        >
          Site Locations · Geofenced
        </motion.div>
        <motion.h2
          className="text-[3.2vw] font-black text-white leading-tight tracking-tight"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : 20 }}
        >
          Every minute, every mile, <br />
          tied to an <span className="text-[#10b981]">AFE</span>.
        </motion.h2>
      </div>

      {/* Spend rollup */}
      <motion.div
        className="absolute bottom-10 right-12 z-20 bg-slate-900/90 backdrop-blur-md border border-slate-700 rounded-2xl p-6 shadow-2xl"
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: phase >= 4 ? 1 : 0, x: phase >= 4 ? 0 : 40 }}
        transition={{ duration: 0.7 }}
      >
        <div className="text-[0.8vw] uppercase tracking-wider text-slate-400 mb-1">
          MTD spend rollup
        </div>
        <div className="text-[3vw] font-black text-white tabular-nums leading-none">
          ${total.toLocaleString()}
        </div>
        <div className="mt-3 flex gap-3 text-[0.85vw] font-mono text-slate-400">
          <span className="text-[#38bdf8]">5 sites</span>
          <span>·</span>
          <span className="text-[#10b981]">12 vendors</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
