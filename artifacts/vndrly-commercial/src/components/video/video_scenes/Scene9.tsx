import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene9() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 3500),
      setTimeout(() => setPhase(4), 6500),
    ];
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  const baseUrl = import.meta.env.BASE_URL;

  return (
    <motion.div
      className="absolute inset-0 w-full h-full bg-[#020617] z-10 overflow-hidden flex items-center justify-center px-12"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      <div className="absolute top-10 left-0 right-0 text-center z-20">
        <div className="text-[1vw] uppercase tracking-[0.4em] text-[#38bdf8] mb-2 font-semibold">
          Dispatch
        </div>
        <div className="text-[3vw] font-black text-white tracking-tight">
          One click. <span className="text-[#10b981]">Already in their pocket.</span>
        </div>
      </div>

      <div className="relative flex items-center justify-between w-full max-w-6xl mt-16">
        {/* Web mock */}
        <motion.div
          className="w-[44%] rounded-xl overflow-hidden border border-slate-700 shadow-2xl bg-slate-900"
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: phase >= 1 ? 1 : 0, x: phase >= 1 ? 0 : -40 }}
          transition={{ duration: 0.7 }}
        >
          <div className="h-8 bg-slate-800 border-b border-slate-700 flex items-center px-3 gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <div className="w-2.5 h-2.5 rounded-full bg-slate-500" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
            <div className="ml-3 text-[0.7vw] text-slate-400 font-mono">vndrly.ai</div>
          </div>
          <img
            src={`${baseUrl}images/web/web-home.jpg`}
            className="block w-full h-auto"
            alt=""
          />
        </motion.div>

        {/* Light beam */}
        <div className="relative flex-1 h-1 mx-4">
          <motion.div
            className="absolute inset-y-0 left-0 right-0 bg-gradient-to-r from-[#38bdf8] via-[#10b981] to-[#38bdf8] rounded-full"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: phase >= 2 ? 1 : 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: 'left' }}
          />
          <motion.div
            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow-[0_0_30px_#38bdf8]"
            initial={{ left: '0%' }}
            animate={{ left: phase >= 2 ? '100%' : '0%' }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>

        {/* Phone mock */}
        <motion.div
          className="relative w-[18vw] aspect-[9/19] rounded-[2.5vw] bg-slate-950 border-[0.4vw] border-slate-700 shadow-[0_25px_60px_rgba(56,189,248,0.3)] overflow-hidden"
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: phase >= 1 ? 1 : 0, x: phase >= 1 ? 0 : 40 }}
          transition={{ duration: 0.7 }}
        >
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[6vw] h-[1.2vw] bg-slate-950 rounded-b-[1vw] z-30" />
          <img
            src={`${baseUrl}images/mobile/mobile-screen-ticket-detail.jpg`}
            className="absolute inset-0 w-full h-full object-cover object-top"
            alt=""
          />
          <motion.div
            className="absolute inset-x-3 top-[18%] z-20 bg-slate-900/95 border-2 border-[#10b981] rounded-xl p-3 shadow-[0_0_30px_#10b981]"
            initial={{ opacity: 0, y: -10, scale: 0.9 }}
            animate={{
              opacity: phase >= 3 ? 1 : 0,
              y: phase >= 3 ? 0 : -10,
              scale: phase >= 3 ? 1 : 0.9,
            }}
            transition={{ type: 'spring', stiffness: 220, damping: 18 }}
          >
            <div className="text-[0.6vw] uppercase tracking-wider text-[#10b981] font-bold">
              New ticket
            </div>
            <div className="text-white text-[0.85vw] font-bold mt-0.5">
              Vac Truck — Pad 14
            </div>
            <div className="text-[#38bdf8] text-[0.7vw] font-mono mt-1">
              AFE-2401 · $1,850
            </div>
          </motion.div>
        </motion.div>
      </div>
    </motion.div>
  );
}
