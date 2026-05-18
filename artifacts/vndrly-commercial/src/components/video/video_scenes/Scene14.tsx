import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const TICKETS = [
  { id: 'T-1041', amt: '$1,850', x: '8%', y: '20%' },
  { id: 'T-1042', amt: '$2,400', x: '22%', y: '60%' },
  { id: 'T-1043', amt: '$9,600', x: '6%', y: '78%' },
  { id: 'T-1044', amt: '$340', x: '32%', y: '34%' },
];

const INVOICE_LINES = [
  { afe: 'AFE-2401', desc: 'Vac truck · Pad 14', amt: '$1,850.00' },
  { afe: 'AFE-2402', desc: 'Roustabout crew', amt: '$9,600.00' },
  { afe: 'AFE-2403', desc: 'Pump repair', amt: '$340.00' },
  { afe: 'AFE-2404', desc: 'Hot shot', amt: '$2,400.00' },
];

export function Scene14() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 4000),
      setTimeout(() => setPhase(4), 7000),
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
      {/* Left tickets pile */}
      <div className="w-[38%] h-full relative">
        <div className="absolute top-10 left-10 z-30">
          <div className="text-[1vw] uppercase tracking-[0.4em] text-[#38bdf8] mb-2 font-semibold">
            Month-end · One button
          </div>
          <h2 className="text-[2.6vw] font-black text-white tracking-tight leading-tight max-w-[18vw]">
            Tickets <span className="text-[#10b981]">become</span> invoices.
          </h2>
        </div>

        {TICKETS.map((t, i) => (
          <motion.div
            key={t.id}
            className="absolute w-[10vw] bg-slate-900/90 border border-slate-700 rounded-xl p-3 shadow-2xl backdrop-blur-md"
            style={{ left: t.x, top: t.y }}
            initial={{ opacity: 0, scale: 0.8, rotate: -8 + i * 4 }}
            animate={{
              opacity: phase >= 1 ? (phase >= 3 ? 0.4 : 1) : 0,
              scale: phase >= 1 ? 1 : 0.8,
              rotate: phase >= 3 ? 0 : -8 + i * 4,
              x: phase >= 3 ? '60vw' : 0,
            }}
            transition={{ duration: 0.9, delay: i * 0.12, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="text-[0.65vw] uppercase tracking-wider text-slate-400">
              Ticket
            </div>
            <div className="text-white font-mono font-bold text-[1vw]">{t.id}</div>
            <div className="text-[#10b981] font-mono font-black text-[1.2vw] mt-1">
              {t.amt}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Right: invoice + QBO badge */}
      <div className="w-[62%] h-full flex items-center justify-center px-10 relative">
        <motion.div
          className="w-full max-w-2xl bg-white text-slate-900 rounded-2xl shadow-2xl overflow-hidden"
          initial={{ opacity: 0, scale: 0.9, y: 30 }}
          animate={{
            opacity: phase >= 2 ? 1 : 0,
            scale: phase >= 2 ? 1 : 0.9,
            y: phase >= 2 ? 0 : 30,
          }}
          transition={{ duration: 0.8 }}
        >
          <div className="bg-slate-900 text-white px-6 py-4 flex justify-between items-center">
            <div>
              <div className="text-[0.7vw] uppercase tracking-wider text-slate-400">
                Invoice
              </div>
              <div className="font-mono font-black text-[1.3vw]">INV-2024-1041</div>
            </div>
            <div className="text-right">
              <div className="text-[0.7vw] uppercase tracking-wider text-slate-400">
                Total
              </div>
              <div className="text-[#10b981] font-mono font-black text-[1.6vw]">
                $14,190.00
              </div>
            </div>
          </div>
          <div className="p-5">
            {INVOICE_LINES.map((l, i) => (
              <motion.div
                key={l.afe}
                className="grid grid-cols-3 py-2.5 border-b border-slate-200 text-[0.95vw]"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: phase >= 3 ? 1 : 0, x: phase >= 3 ? 0 : 20 }}
                transition={{ delay: 0.2 + i * 0.15 }}
              >
                <div className="font-mono font-bold text-[#0f172a]">{l.afe}</div>
                <div className="text-slate-700">{l.desc}</div>
                <div className="text-right font-mono font-bold text-slate-900">
                  {l.amt}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* QBO badge connector */}
        <motion.div
          className="absolute right-10 top-1/2 -translate-y-1/2 flex items-center gap-3"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: phase >= 4 ? 1 : 0, x: phase >= 4 ? 0 : 30 }}
          transition={{ duration: 0.7 }}
        >
          <motion.div
            className="h-px bg-[#38bdf8] origin-left"
            initial={{ scaleX: 0, width: 60 }}
            animate={{ scaleX: phase >= 4 ? 1 : 0 }}
          />
          <div className="px-5 py-3 rounded-xl bg-[#10b981] text-[#020617] font-black text-[1.1vw] shadow-[0_0_30px_#10b981] tracking-tight">
            QuickBooks
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
