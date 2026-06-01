import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { VNDRLY_LOGO_SQUARE as logoPng } from '@/lib/vndrly-brand-assets';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 2200),
      setTimeout(() => setPhase(3), 4500),
      setTimeout(() => setPhase(4), 7000),
    ];
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 w-full h-full bg-[#020617] z-10 flex flex-col items-center justify-center overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      {/* Orbs */}
      <motion.div
        className="absolute w-[40vw] h-[40vw] rounded-full blur-[120px] opacity-30"
        style={{ background: 'radial-gradient(circle, #38bdf8, transparent)' }}
        animate={{ scale: [1, 1.2, 1], x: [-40, 40, -40] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute w-[28vw] h-[28vw] rounded-full blur-[100px] opacity-20"
        style={{ background: 'radial-gradient(circle, #10b981, transparent)' }}
        animate={{ scale: [1.1, 0.9, 1.1], x: [50, -50, 50], y: [30, -30, 30] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="relative z-20 flex flex-col items-center">
        <motion.img
          src={logoPng}
          className="w-[14vw] h-[14vw] object-contain mb-6 drop-shadow-2xl"
          initial={{ scale: 0.4, opacity: 0, rotate: -20 }}
          animate={{
            scale: phase >= 1 ? 1 : 0.4,
            opacity: phase >= 1 ? 1 : 0,
            rotate: phase >= 1 ? 0 : -20,
          }}
          transition={{ type: 'spring', stiffness: 180, damping: 16 }}
        />

        <motion.div
          className="text-[1vw] uppercase tracking-[0.5em] text-[#38bdf8] mb-4 font-semibold"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 2 ? 1 : 0 }}
          transition={{ duration: 0.6 }}
        >
          Meet
        </motion.div>

        <motion.h1
          className="text-[8vw] font-black tracking-tighter text-white leading-none"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: phase >= 2 ? 1 : 0, y: phase >= 2 ? 0 : 30 }}
          transition={{ duration: 0.8 }}
        >
          VNDRLY
        </motion.h1>

        <motion.div
          className="text-[1.5vw] text-slate-400 mt-3 font-mono"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 3 ? 1 : 0 }}
          transition={{ duration: 0.6 }}
        >
          /ven·der·lee/
        </motion.div>

        <motion.div
          className="mt-10 text-[2.4vw] font-bold text-white text-center max-w-[60vw]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: phase >= 4 ? 1 : 0, y: phase >= 4 ? 0 : 20 }}
          transition={{ duration: 0.8 }}
        >
          One platform.{' '}
          <span className="text-[#38bdf8]">Office</span> and{' '}
          <span className="text-[#10b981]">field</span>.
        </motion.div>
      </div>
    </motion.div>
  );
}
