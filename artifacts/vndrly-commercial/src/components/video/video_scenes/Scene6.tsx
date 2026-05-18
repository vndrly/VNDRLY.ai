import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const ROWS = [
  { wt: 'Water Haul', vendor: 'Permian Logistics', partner: 'Mach NR', price: '$18.50 / bbl' },
  { wt: 'Vac Truck', vendor: 'Basin Vac Co.', partner: 'Mach NR', price: '$185.00 / hr' },
  { wt: 'Roustabout Crew', vendor: 'Lone Star Field', partner: 'Mach NR', price: '$2,400 / day' },
  { wt: 'Pump Repair', vendor: 'Apex Mechanical', partner: 'Mach NR', price: '$340.00 / hr' },
  { wt: 'Hot Shot', vendor: 'West TX Express', partner: 'Mach NR', price: '$3.10 / mi' },
];

export function Scene6() {
  const [phase, setPhase] = useState(0);
  const [highlight, setHighlight] = useState(-1);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1200),
    ];
    const sweep = setInterval(() => {
      setHighlight((h) => (h + 1) % ROWS.length);
    }, 900);
    return () => {
      timers.forEach((t) => clearTimeout(t));
      clearInterval(sweep);
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
      <motion.div
        className="text-[1vw] uppercase tracking-[0.4em] text-[#38bdf8] mb-2 font-semibold"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : -10 }}
      >
        Master catalog · Negotiated pricing
      </motion.div>
      <motion.h2
        className="text-[3vw] font-black text-white mb-8 text-center tracking-tight"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : 20 }}
      >
        Quotes stop being arguments.{' '}
        <span className="text-[#10b981]">They become lookups.</span>
      </motion.h2>

      <div className="w-[70vw] max-w-5xl bg-slate-900/80 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-md">
        {/* Header */}
        <div className="grid grid-cols-4 bg-slate-800/80 border-b border-slate-700 px-6 py-3 text-[0.8vw] uppercase tracking-wider text-slate-400 font-bold">
          <div>Work Type</div>
          <div>Vendor</div>
          <div>Partner</div>
          <div className="text-right">Negotiated Price</div>
        </div>
        {ROWS.map((r, i) => (
          <motion.div
            key={r.wt}
            className="grid grid-cols-4 px-6 py-4 border-b border-slate-800 items-center relative"
            initial={{ opacity: 0, x: -30 }}
            animate={{
              opacity: phase >= 2 ? 1 : 0,
              x: phase >= 2 ? 0 : -30,
              backgroundColor: highlight === i ? 'rgba(56,189,248,0.08)' : 'transparent',
            }}
            transition={{ delay: i * 0.12, duration: 0.5 }}
          >
            <div className="text-white font-bold text-[1.1vw]">{r.wt}</div>
            <div className="text-slate-300 text-[1vw]">{r.vendor}</div>
            <div className="text-slate-300 text-[1vw]">{r.partner}</div>
            <div className="text-right text-[#10b981] font-mono font-bold text-[1.1vw]">
              {r.price}
            </div>
            {highlight === i && (
              <motion.div
                layoutId="row-sweep"
                className="absolute left-0 top-0 bottom-0 w-1 bg-[#38bdf8]"
              />
            )}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
