import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const STATUSES = [
  'accepted',
  'en route',
  'on location',
  'in progress',
  'completed',
  'approved',
];
const MOBILE_SCREENS = [
  'mobile-screen-home.jpg',
  'mobile-screen-ticket-detail.jpg',
  'mobile-screen-location-consent.jpg',
  'mobile-screen-schedule.jpg',
  'mobile-screen-history.jpg',
];

export function Scene10() {
  const [phase, setPhase] = useState(0);
  const [screenIdx, setScreenIdx] = useState(0);
  const [mileage, setMileage] = useState(0);

  useEffect(() => {
    const timers = STATUSES.map((_, i) =>
      setTimeout(() => setPhase(i + 1), 800 + i * 3800),
    );
    const screenTimer = setInterval(
      () => setScreenIdx((i) => (i + 1) % MOBILE_SCREENS.length),
      4500,
    );
    const mileTimer = setInterval(
      () => setMileage((m) => Math.min(m + 1.4, 142.5)),
      80,
    );
    return () => {
      timers.forEach((t) => clearTimeout(t));
      clearInterval(screenTimer);
      clearInterval(mileTimer);
    };
  }, []);

  const baseUrl = import.meta.env.BASE_URL;
  const activeStatusIdx = Math.max(0, Math.min(phase - 1, STATUSES.length - 1));

  return (
    <motion.div
      className="absolute inset-0 w-full h-full bg-[#020617] z-10 overflow-hidden flex"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      {/* Left status ladder */}
      <div className="w-[35%] h-full relative flex flex-col justify-center px-12 border-r border-slate-800">
        <div className="text-[1vw] uppercase tracking-[0.4em] text-[#38bdf8] mb-3 font-semibold">
          Field Execution
        </div>
        <h2 className="text-[3.4vw] font-black text-white leading-tight tracking-tight mb-10">
          The field <br />
          <span className="text-[#10b981]">takes over.</span>
        </h2>

        <div className="flex flex-col gap-3">
          {STATUSES.map((s, i) => {
            const done = i < activeStatusIdx;
            const active = i === activeStatusIdx;
            return (
              <motion.div
                key={s}
                className="flex items-center gap-4"
                animate={{
                  opacity: i <= activeStatusIdx ? 1 : 0.35,
                }}
                transition={{ duration: 0.4 }}
              >
                <motion.div
                  className="w-4 h-4 rounded-full border-2"
                  style={{
                    borderColor: done ? '#10b981' : active ? '#38bdf8' : '#334155',
                    backgroundColor: done ? '#10b981' : active ? '#38bdf8' : 'transparent',
                  }}
                  animate={{ scale: active ? [1, 1.4, 1] : 1 }}
                  transition={{ duration: 1.2, repeat: active ? Infinity : 0 }}
                />
                <div
                  className="text-[1.5vw] font-bold uppercase tracking-wider"
                  style={{
                    color: done ? '#10b981' : active ? '#38bdf8' : '#475569',
                  }}
                >
                  {s}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Center phone */}
      <div className="w-[35%] h-full flex items-center justify-center relative">
        {/* Geofence pulse */}
        <motion.div
          className="absolute w-[26vw] h-[26vw] rounded-full border-2 border-[#38bdf8]/40"
          animate={{ scale: [1, 1.25, 1], opacity: [0.4, 0, 0.4] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
        />
        <motion.div
          className="absolute w-[20vw] h-[20vw] rounded-full border border-[#38bdf8]/30"
          animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0, 0.3] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut', delay: 0.6 }}
        />

        <div className="relative w-[20vw] aspect-[9/19] rounded-[2.5vw] bg-slate-950 border-[0.4vw] border-slate-700 shadow-[0_25px_60px_rgba(56,189,248,0.4)] overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[6vw] h-[1.2vw] bg-slate-950 rounded-b-[1vw] z-30" />
          {MOBILE_SCREENS.map((src, i) => (
            <motion.img
              key={src}
              src={`${baseUrl}images/mobile/${src}`}
              alt=""
              className="absolute inset-0 w-full h-full object-cover object-top"
              initial={{ opacity: 0 }}
              animate={{ opacity: i === screenIdx ? 1 : 0, scale: i === screenIdx ? 1.04 : 1 }}
              transition={{ duration: 0.8 }}
            />
          ))}
        </div>
      </div>

      {/* Right metrics */}
      <div className="w-[30%] h-full flex flex-col justify-center px-10 gap-5">
        <motion.div
          className="bg-slate-900/80 border border-slate-700 rounded-2xl p-5 backdrop-blur-md"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: phase >= 2 ? 1 : 0, x: phase >= 2 ? 0 : 30 }}
        >
          <div className="text-[0.7vw] uppercase tracking-wider text-slate-400">
            Live GPS
          </div>
          <div className="text-[#38bdf8] font-mono text-[1.4vw] font-bold">
            32.0023° N · −102.0779° W
          </div>
        </motion.div>

        <motion.div
          className="bg-slate-900/80 border border-slate-700 rounded-2xl p-5 backdrop-blur-md"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: phase >= 3 ? 1 : 0, x: phase >= 3 ? 0 : 30 }}
        >
          <div className="text-[0.7vw] uppercase tracking-wider text-slate-400">
            Site geofence
          </div>
          <div className="text-[#10b981] font-mono text-[1.4vw] font-bold">
            ✓ Verified · Pad 14
          </div>
        </motion.div>

        <motion.div
          className="bg-slate-900/80 border border-slate-700 rounded-2xl p-5 backdrop-blur-md"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: phase >= 4 ? 1 : 0, x: phase >= 4 ? 0 : 30 }}
        >
          <div className="text-[0.7vw] uppercase tracking-wider text-slate-400">
            Mileage captured
          </div>
          <div className="text-white font-mono text-[2vw] font-black tabular-nums">
            {mileage.toFixed(1)} <span className="text-[1vw] text-slate-400">mi</span>
          </div>
        </motion.div>

        <motion.div
          className="bg-slate-900/80 border border-slate-700 rounded-2xl p-5 backdrop-blur-md"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: phase >= 5 ? 1 : 0, x: phase >= 5 ? 0 : 30 }}
        >
          <div className="text-[0.7vw] uppercase tracking-wider text-slate-400">
            Labor (auto-calc)
          </div>
          <div className="text-white font-mono text-[1.4vw] font-bold">
            6.5 hrs · tax included
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
