import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const VISITORS = [
  { name: 'C. Reed', co: 'Halliburton', in: '07:12', out: '08:45' },
  { name: 'P. Owens', co: 'Schlumberger', in: '08:30', out: '—' },
  { name: 'A. Diaz', co: 'NOV', in: '09:05', out: '—' },
  { name: 'K. Lin', co: 'Baker Hughes', in: '10:14', out: '11:02' },
];

const PINS = [
  { x: '22%', y: '35%', kind: 'crew' },
  { x: '40%', y: '60%', kind: 'visitor' },
  { x: '58%', y: '28%', kind: 'crew' },
  { x: '70%', y: '55%', kind: 'visitor' },
  { x: '32%', y: '75%', kind: 'crew' },
];

export function Scene13() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 3500),
      setTimeout(() => setPhase(4), 7500),
    ];
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 w-full h-full bg-[#020617] z-10 overflow-hidden flex"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      {/* Map */}
      <div className="w-[58%] h-full relative">
        <img
          src={`${import.meta.env.BASE_URL}images/gps-map.png`}
          className="absolute inset-0 w-full h-full object-cover opacity-60"
          alt=""
        />
        <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[#020617]/70" />

        <div className="absolute top-10 left-10 z-20">
          <div className="text-[1vw] uppercase tracking-[0.4em] text-[#38bdf8] mb-2 font-semibold">
            Site map · Live
          </div>
          <h2 className="text-[2.6vw] font-black text-white leading-tight tracking-tight max-w-[26vw]">
            Every crew. Every visitor. <br />
            <span className="text-[#10b981]">Real time.</span>
          </h2>
        </div>

        {PINS.map((p, i) => {
          const color = p.kind === 'crew' ? '#10b981' : '#38bdf8';
          return (
            <div key={i} className="absolute" style={{ left: p.x, top: p.y }}>
              <motion.div
                className="absolute w-10 h-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
                style={{ borderColor: color }}
                animate={{ scale: [1, 2, 1], opacity: [0.7, 0, 0.7] }}
                transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.3 }}
              />
              <motion.div
                className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ backgroundColor: color, boxShadow: `0 0 16px ${color}` }}
                initial={{ scale: 0 }}
                animate={{ scale: phase >= 2 ? 1 : 0 }}
                transition={{ delay: i * 0.12, type: 'spring', stiffness: 300 }}
              />
            </div>
          );
        })}
      </div>

      {/* Visitor log */}
      <motion.div
        className="w-[42%] h-full flex flex-col justify-center px-10"
        initial={{ x: 60, opacity: 0 }}
        animate={{ x: phase >= 3 ? 0 : 60, opacity: phase >= 3 ? 1 : 0 }}
        transition={{ duration: 0.8 }}
      >
        <div className="text-[1vw] uppercase tracking-[0.4em] text-[#38bdf8] mb-2 font-semibold">
          Visitors log
        </div>
        <div className="text-[2.2vw] font-black text-white mb-5 tracking-tight">
          Who's at the gate.
        </div>

        <div className="bg-slate-900/80 border border-slate-700 rounded-2xl backdrop-blur-md overflow-hidden shadow-2xl">
          <div className="grid grid-cols-4 px-4 py-3 bg-slate-800/80 text-[0.7vw] uppercase tracking-wider text-slate-400 font-bold">
            <div>Name</div>
            <div>Company</div>
            <div>In</div>
            <div>Out</div>
          </div>
          {VISITORS.map((v, i) => (
            <motion.div
              key={v.name}
              className="grid grid-cols-4 px-4 py-3 border-b border-slate-800 last:border-b-0 items-center"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: phase >= 3 ? 1 : 0, y: phase >= 3 ? 0 : 15 }}
              transition={{ delay: 0.2 + i * 0.15 }}
            >
              <div className="text-white font-bold text-[0.95vw]">{v.name}</div>
              <div className="text-slate-300 text-[0.85vw]">{v.co}</div>
              <div className="text-[#10b981] font-mono text-[0.85vw]">{v.in}</div>
              <div
                className="font-mono text-[0.85vw]"
                style={{ color: v.out === '—' ? '#38bdf8' : '#94a3b8' }}
              >
                {v.out}
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
