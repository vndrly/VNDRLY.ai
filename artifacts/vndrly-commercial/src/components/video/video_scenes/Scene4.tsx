import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const ROLES = [
  {
    title: 'Partners',
    sub: 'Own the work',
    color: '#38bdf8',
    icon: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6',
  },
  {
    title: 'Vendors',
    sub: 'Bid the work',
    color: '#10b981',
    icon: 'M3 7h18l-2 13H5L3 7zM8 7V4a4 4 0 018 0v3',
  },
  {
    title: 'Field Employees',
    sub: 'Execute the work',
    color: '#38bdf8',
    icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  },
  {
    title: 'VNDRLY Admins',
    sub: 'Keep the rails clean',
    color: '#10b981',
    icon: 'M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z',
  },
];

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 3500),
      setTimeout(() => setPhase(5), 4500),
      setTimeout(() => setPhase(6), 7500),
      setTimeout(() => setPhase(7), 11000),
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
        className="text-[1vw] uppercase tracking-[0.4em] text-[#38bdf8] mb-2 font-semibold"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : -10 }}
        transition={{ duration: 0.6 }}
      >
        Four roles · one source of truth
      </motion.div>
      <motion.h2
        className="text-[3.4vw] font-black text-white mb-10 text-center tracking-tight"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : 20 }}
        transition={{ duration: 0.8 }}
      >
        Everyone sees what they need.
      </motion.h2>

      <div className="relative grid grid-cols-2 gap-6 w-[60vw] max-w-5xl">
        {/* Connecting lines */}
        <motion.div
          className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-700/60"
          initial={{ scaleY: 0 }}
          animate={{ scaleY: phase >= 5 ? 1 : 0 }}
          transition={{ duration: 0.8 }}
          style={{ transformOrigin: 'top' }}
        />
        <motion.div
          className="absolute top-1/2 left-0 right-0 h-px bg-slate-700/60"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: phase >= 5 ? 1 : 0 }}
          transition={{ duration: 0.8 }}
          style={{ transformOrigin: 'left' }}
        />

        {ROLES.map((r, i) => (
          <motion.div
            key={r.title}
            className="relative bg-slate-900/80 border border-slate-700 rounded-2xl p-7 backdrop-blur-md shadow-2xl"
            initial={{ opacity: 0, y: 30, scale: 0.92 }}
            animate={{
              opacity: phase >= i + 2 ? 1 : 0,
              y: phase >= i + 2 ? 0 : 30,
              scale: phase >= i + 2 ? 1 : 0.92,
            }}
            transition={{ type: 'spring', stiffness: 180, damping: 20 }}
          >
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center mb-4"
              style={{ backgroundColor: `${r.color}1f`, border: `1px solid ${r.color}80` }}
            >
              <svg
                viewBox="0 0 24 24"
                className="w-7 h-7"
                fill="none"
                stroke={r.color}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={r.icon} />
              </svg>
            </div>
            <div className="text-[1.8vw] font-black text-white leading-none">{r.title}</div>
            <div className="text-[1.1vw] mt-1" style={{ color: r.color }}>
              {r.sub}
            </div>
          </motion.div>
        ))}
      </div>

      <motion.div
        className="mt-10 text-[1.4vw] text-slate-400 italic"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 7 ? 1 : 0 }}
        transition={{ duration: 0.7 }}
      >
        Nobody sees what they shouldn't.
      </motion.div>
    </motion.div>
  );
}
