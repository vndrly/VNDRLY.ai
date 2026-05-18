import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const CARDS = [
  {
    wt: 'Vac Truck — 200 bbl',
    site: 'Wolfcamp Pad 14',
    partner: 'Mach NR',
    deadline: 'Need by 0600',
    price: '$1,850',
    approved: true,
  },
  {
    wt: 'Roustabout Crew (4)',
    site: 'Bone Spring 7B',
    partner: 'Mach NR',
    deadline: 'Today 14:00',
    price: '$9,600',
    approved: true,
  },
  {
    wt: 'Hot Shot — Midland → Pad 22',
    site: 'Spraberry 22',
    partner: 'Mach NR',
    deadline: '4 hours',
    price: '$740',
    approved: false,
  },
];

export function Scene7() {
  const [phase, setPhase] = useState(0);
  const [bidPulse, setBidPulse] = useState(0);
  const [awarded, setAwarded] = useState(false);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 3500),
      setTimeout(() => setPhase(4), 6500),
      setTimeout(() => setPhase(5), 11000),
      setTimeout(() => setAwarded(true), 14000),
      setTimeout(() => setPhase(6), 18000),
    ];
    const pulse = setInterval(() => setBidPulse((p) => p + 1), 1100);
    return () => {
      timers.forEach((t) => clearTimeout(t));
      clearInterval(pulse);
    };
  }, []);

  return (
    <motion.div
      className="absolute inset-0 w-full h-full bg-[#020617] z-10 overflow-hidden flex flex-col items-center justify-center px-12"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      {/* Title card */}
      <motion.div
        className="text-center mb-8"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : -20 }}
        transition={{ duration: 0.7 }}
      >
        <div className="text-[1vw] uppercase tracking-[0.5em] text-[#38bdf8] mb-3 font-bold">
          Flagship feature
        </div>
        <h1 className="text-[6vw] font-black text-white leading-none tracking-tighter">
          THE HOTLIST
        </h1>
        <motion.div
          className="h-1 bg-[#38bdf8] mt-3 mx-auto rounded-full"
          initial={{ width: 0 }}
          animate={{ width: phase >= 2 ? '60%' : 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        />
      </motion.div>

      {/* Hotlist feed */}
      <div className="grid grid-cols-3 gap-5 w-[80vw] max-w-6xl">
        {CARDS.map((c, i) => {
          const isFirst = i === 0;
          const isUnapproved = !c.approved;
          const showAward = isFirst && awarded;
          return (
            <motion.div
              key={c.wt}
              className="relative rounded-2xl border bg-slate-900/85 backdrop-blur-md p-5 shadow-2xl overflow-hidden"
              style={{
                borderColor: isUnapproved ? '#334155' : '#38bdf8',
                opacity: isUnapproved ? 0.55 : 1,
              }}
              initial={{ opacity: 0, y: 40, rotateY: -10 }}
              animate={{
                opacity: phase >= i + 3 ? (isUnapproved ? 0.6 : 1) : 0,
                y: phase >= i + 3 ? 0 : 40,
                rotateY: 0,
                scale: showAward ? 1.04 : 1,
              }}
              transition={{ type: 'spring', stiffness: 160, damping: 18 }}
            >
              {showAward && (
                <motion.div
                  className="absolute inset-0 border-2 rounded-2xl pointer-events-none"
                  style={{ borderColor: '#10b981' }}
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                />
              )}

              <div className="flex justify-between items-start mb-3">
                <div className="text-[0.7vw] uppercase tracking-wider text-slate-400 font-bold">
                  {c.partner}
                </div>
                {isUnapproved ? (
                  <div className="text-[0.65vw] uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                    view only
                  </div>
                ) : (
                  <div
                    className="text-[0.65vw] uppercase tracking-wider px-2 py-0.5 rounded-full font-bold"
                    style={{
                      color: '#38bdf8',
                      backgroundColor: 'rgba(56,189,248,0.12)',
                      border: '1px solid #38bdf8',
                    }}
                  >
                    approved
                  </div>
                )}
              </div>

              <div className="text-white font-black text-[1.4vw] leading-tight mb-1">
                {c.wt}
              </div>
              <div className="text-slate-300 text-[0.95vw] mb-3">{c.site}</div>

              <div className="flex justify-between items-end mt-4">
                <div>
                  <div className="text-[0.7vw] uppercase tracking-wider text-slate-500">
                    Deadline
                  </div>
                  <div className="text-[#38bdf8] font-mono text-[1vw] font-bold">
                    {c.deadline}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[0.7vw] uppercase tracking-wider text-slate-500">
                    Bid
                  </div>
                  <div className="text-[#10b981] font-mono text-[1.3vw] font-black">
                    {c.price}
                  </div>
                </div>
              </div>

              {!isUnapproved && (
                <motion.div
                  className="mt-4 w-full text-center py-2 rounded-lg font-bold text-[1vw] uppercase tracking-wider"
                  style={{
                    backgroundColor: showAward ? '#10b981' : '#38bdf8',
                    color: '#020617',
                  }}
                  animate={{
                    scale: showAward ? 1 : bidPulse % 2 === 0 ? 1 : 1.04,
                  }}
                  transition={{ duration: 0.4 }}
                >
                  {showAward ? 'AWARDED · LIVE TICKET' : 'Place Bid'}
                </motion.div>
              )}
              {isUnapproved && (
                <div className="mt-4 w-full text-center py-2 rounded-lg font-bold text-[1vw] uppercase tracking-wider bg-slate-800 text-slate-500 border border-slate-700">
                  Not yet approved
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      <motion.div
        className="mt-8 text-[1.3vw] text-slate-300 text-center max-w-[60vw]"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 6 ? 1 : 0 }}
        transition={{ duration: 0.7 }}
      >
        Award goes out — the post becomes a{' '}
        <span className="text-[#10b981] font-bold">live ticket</span>.
      </motion.div>
    </motion.div>
  );
}
