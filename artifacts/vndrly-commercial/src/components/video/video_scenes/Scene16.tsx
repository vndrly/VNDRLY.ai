import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { VNDRLY_LOGO_SQUARE as logoPng } from '@/lib/vndrly-brand-assets';

export function Scene16() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1800),
      setTimeout(() => setPhase(3), 4000),
      setTimeout(() => setPhase(4), 6500),
      setTimeout(() => setPhase(5), 9500),
    ];
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 w-full h-full bg-[#020617] z-10 overflow-hidden flex flex-col items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      <motion.div
        className="absolute w-[60vw] h-[60vw] rounded-full blur-[140px] opacity-25"
        style={{ background: 'radial-gradient(circle, #38bdf8, transparent)' }}
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Trust badges */}
      <div className="flex gap-6 mb-10 z-20">
        <motion.div
          className="flex items-center gap-3 px-5 py-3 rounded-xl border border-[#10b981]/60 bg-[#10b981]/10 backdrop-blur-md"
          initial={{ opacity: 0, scale: 0.85, y: 20 }}
          animate={{
            opacity: phase >= 1 ? 1 : 0,
            scale: phase >= 1 ? 1 : 0.85,
            y: phase >= 1 ? 0 : 20,
          }}
          transition={{ type: 'spring', stiffness: 220, damping: 18 }}
        >
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l9 4v6c0 5-3.5 9.5-9 10-5.5-.5-9-5-9-10V6l9-4z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          <div className="text-[#10b981] font-black text-[1.2vw] uppercase tracking-wider">
            SOC 2 ready
          </div>
        </motion.div>

        <motion.div
          className="flex items-center gap-3 px-5 py-3 rounded-xl border border-[#38bdf8]/60 bg-[#38bdf8]/10 backdrop-blur-md"
          initial={{ opacity: 0, scale: 0.85, y: 20 }}
          animate={{
            opacity: phase >= 2 ? 1 : 0,
            scale: phase >= 2 ? 1 : 0.85,
            y: phase >= 2 ? 0 : 20,
          }}
          transition={{ type: 'spring', stiffness: 220, damping: 18 }}
        >
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 12l2 2 4-4M21 12c0 5-4 9-9 9s-9-4-9-9 4-9 9-9 9 4 9 9z" />
          </svg>
          <div className="text-[#38bdf8] font-black text-[1.2vw] uppercase tracking-wider">
            End-to-end audit trail
          </div>
        </motion.div>
      </div>

      {/* Logo */}
      <motion.img
        src={logoPng}
        className="w-[16vw] h-[16vw] object-contain z-20 drop-shadow-2xl"
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{
          opacity: phase >= 3 ? 1 : 0,
          scale: phase >= 3 ? 1 : 0.6,
        }}
        transition={{ type: 'spring', stiffness: 180, damping: 18 }}
      />

      <motion.div
        className="text-[6vw] font-black text-white tracking-tighter mt-3 z-20 leading-none"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: phase >= 3 ? 1 : 0, y: phase >= 3 ? 0 : 20 }}
        transition={{ duration: 0.8 }}
      >
        VNDRLY
      </motion.div>

      <motion.div
        className="text-[1.6vw] text-slate-300 mt-3 z-20 italic"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 4 ? 1 : 0 }}
        transition={{ duration: 0.8 }}
      >
        Your field, on the record.
      </motion.div>

      <motion.div
        className="absolute bottom-16 z-20 text-[2.2vw] font-mono text-[#38bdf8] tracking-[0.3em] uppercase"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: phase >= 5 ? 1 : 0, y: phase >= 5 ? 0 : 20 }}
        transition={{ duration: 0.8 }}
      >
        vndrly.ai
      </motion.div>
    </motion.div>
  );
}
