import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene2() {
  const [phase, setPhase] = useState(0);
  const [clock, setClock] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 3000),
      setTimeout(() => setPhase(3), 6000),
      setTimeout(() => setPhase(4), 9000),
      setTimeout(() => setPhase(5), 12000),
      setTimeout(() => setPhase(6), 15000),
      setTimeout(() => setPhase(7), 18000),
    ];
    const ticker = setInterval(() => setClock((c) => c + 1), 60);
    return () => {
      timers.forEach((t) => clearTimeout(t));
      clearInterval(ticker);
    };
  }, []);

  const lostMinutes = Math.min(clock * 7, 4380);
  const lostDollars = Math.min(clock * 1180, 720000);

  const bubbles = [
    { t: 'Did anyone call them?', x: '8%', y: '18%', r: -4, p: 1 },
    { t: 'Ticket missing.', x: '62%', y: '12%', r: 5, p: 2 },
    { t: 'Wrong pad.', x: '70%', y: '70%', r: -3, p: 3 },
    { t: 'I texted Steve...', x: '12%', y: '72%', r: 4, p: 4 },
    { t: 'Receipt is in the truck.', x: '40%', y: '82%', r: -2, p: 5 },
  ];

  return (
    <motion.div
      className="absolute inset-0 w-full h-full bg-[#020617] z-10 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      {/* Burning paper bg */}
      <div className="absolute inset-0 z-0">
        <img
          src={`${import.meta.env.BASE_URL}images/paper-burning.png`}
          className="w-full h-full object-cover opacity-25"
          alt=""
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#020617] via-transparent to-[#020617]" />
      </div>

      {/* Failing text bubbles */}
      <div className="absolute inset-0 z-10">
        {bubbles.map((b) => (
          <motion.div
            key={b.t}
            className="absolute px-5 py-3 rounded-2xl bg-slate-800/80 border border-slate-700 backdrop-blur-md"
            style={{ left: b.x, top: b.y, rotate: b.r }}
            initial={{ opacity: 0, scale: 0.6, y: 20 }}
            animate={{
              opacity: phase >= b.p ? 0.85 : 0,
              scale: phase >= b.p ? 1 : 0.6,
              y: phase >= b.p ? 0 : 20,
            }}
            transition={{ type: 'spring', stiffness: 180, damping: 18 }}
          >
            <div className="text-[1.2vw] text-slate-200 font-medium">{b.t}</div>
            <div className="text-[0.7vw] text-red-400 mt-1 uppercase tracking-wider">
              not delivered
            </div>
          </motion.div>
        ))}
      </div>

      {/* Center counter card */}
      <div className="absolute inset-0 flex items-center justify-center z-20">
        <motion.div
          className="bg-[#020617]/85 backdrop-blur-md p-12 rounded-3xl border border-slate-700 shadow-[0_30px_80px_rgba(0,0,0,0.6)] text-center"
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: phase >= 1 ? 1 : 0, y: 0, scale: 1 }}
          transition={{ duration: 0.9 }}
        >
          <div className="text-[1vw] uppercase tracking-[0.4em] text-slate-400 mb-3">
            Per missed window
          </div>
          <div className="text-[6.5vw] font-black text-white leading-none tabular-nums">
            ${lostDollars.toLocaleString()}
          </div>
          <div className="mt-4 text-[1.3vw] text-slate-400">
            <span className="text-[#38bdf8] font-mono tabular-nums">
              {Math.floor(lostMinutes / 60)}h {lostMinutes % 60}m
            </span>{' '}
            of phone tag
          </div>

          <motion.div
            className="mt-8 inline-flex items-center gap-3 px-5 py-2 rounded-full bg-red-500/10 border border-red-500/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: phase >= 6 ? 1 : 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="text-red-400 text-[1vw] font-bold uppercase tracking-wider line-through">
              billed
            </span>
            <span className="text-red-400 text-[1vw] font-bold uppercase tracking-wider">
              late · wrong · never
            </span>
          </motion.div>
        </motion.div>
      </div>
    </motion.div>
  );
}
