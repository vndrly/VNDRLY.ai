import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 2200),
      setTimeout(() => setPhase(3), 4200),
      setTimeout(() => setPhase(4), 6200),
      setTimeout(() => setPhase(5), 8500),
    ];
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  const chips = [
    { label: 'whiteboards', color: '#38bdf8', delay: 2 },
    { label: 'group texts', color: '#10b981', delay: 3 },
    { label: 'fuel receipts', color: '#38bdf8', delay: 4 },
  ];

  return (
    <motion.div
      className="absolute inset-0 w-full h-full z-10 bg-[#020617] overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      <div className="absolute inset-0 z-0">
        <video
          src={`${import.meta.env.BASE_URL}videos/sunrise-rig.mp4`}
          className="w-full h-full object-cover opacity-60"
          autoPlay
          loop
          muted
          playsInline
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-[#020617]/60 to-[#020617]/30" />
      </div>

      <motion.div
        className="absolute inset-0 z-0"
        animate={{ opacity: phase >= 2 ? 0.18 : 0 }}
        transition={{ duration: 1.2 }}
      >
        <img
          src={`${import.meta.env.BASE_URL}images/whiteboard.png`}
          className="w-full h-full object-cover mix-blend-overlay"
          alt=""
        />
      </motion.div>

      <div className="absolute inset-0 flex flex-col items-center justify-center px-12 z-20 text-center">
        <motion.div
          className="text-[1.1vw] tracking-[0.4em] uppercase text-[#38bdf8] mb-6 font-semibold"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : -10 }}
          transition={{ duration: 0.7 }}
        >
          Out in the field
        </motion.div>

        <motion.h1
          className="text-[5.2vw] font-black tracking-tighter leading-[0.95] text-white max-w-[90vw]"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : 30 }}
          transition={{ duration: 0.9 }}
        >
          The work that powers America <br />
          still runs on
        </motion.h1>

        <div className="flex flex-wrap gap-4 mt-10 justify-center">
          {chips.map((c) => (
            <motion.div
              key={c.label}
              className="px-7 py-3 rounded-full border backdrop-blur-md"
              style={{ borderColor: `${c.color}80`, backgroundColor: `${c.color}1a` }}
              initial={{ opacity: 0, scale: 0.7, y: 20 }}
              animate={{
                opacity: phase >= c.delay ? 1 : 0,
                scale: phase >= c.delay ? 1 : 0.7,
                y: phase >= c.delay ? 0 : 20,
              }}
              transition={{ type: 'spring', stiffness: 200, damping: 18 }}
            >
              <span
                className="text-[2.2vw] font-bold uppercase tracking-wider"
                style={{ color: c.color }}
              >
                {c.label}
              </span>
            </motion.div>
          ))}
        </div>

        <motion.div
          className="absolute bottom-12 text-[1.1vw] text-slate-400 italic"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 5 ? 1 : 0 }}
          transition={{ duration: 0.8 }}
        >
          ...and the back of a fuel receipt.
        </motion.div>
      </div>
    </motion.div>
  );
}
