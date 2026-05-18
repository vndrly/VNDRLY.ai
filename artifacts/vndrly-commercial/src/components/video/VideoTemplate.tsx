import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';
import { Scene6 } from './video_scenes/Scene6';
import { Scene7 } from './video_scenes/Scene7';
import { Scene8 } from './video_scenes/Scene8';
import { Scene9 } from './video_scenes/Scene9';
import { Scene10 } from './video_scenes/Scene10';
import { Scene11 } from './video_scenes/Scene11';
import { Scene12 } from './video_scenes/Scene12';
import { Scene13 } from './video_scenes/Scene13';
import { Scene14 } from './video_scenes/Scene14';
import { Scene15 } from './video_scenes/Scene15';
import { Scene16 } from './video_scenes/Scene16';

const SCENE_DURATIONS = {
  hook: 12000,
  pain: 20000,
  enter: 10000,
  principals: 17000,
  sites: 15000,
  catalog: 15000,
  hotlist: 22000,
  onboarding: 15000,
  dispatch: 10000,
  execution: 27000,
  crew: 16000,
  parts: 10000,
  visitors: 12000,
  accounting: 11000,
  analytics: 14000,
  trust: 14000,
};

export default function VideoTemplate() {
  // Capture mode: skip audio entirely (audio is muxed in post). Loading two
  // long mp3s during a 1080p screencast causes chromium OOM crashes.
  const params =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const isCapture = params.get('capture') === '1';
  const startScene = Math.max(0, parseInt(params.get('startScene') || '0', 10) || 0);
  // Capture mode renders for screen recording and must auto-start. Interactive
  // preview waits for an explicit user click so the canvas/iframe doesn't
  // start blasting audio + animation the moment it loads.
  const [hasStarted, setHasStarted] = useState(isCapture);
  const { currentScene } = useVideoPlayer({
    durations: SCENE_DURATIONS,
    startScene,
    loop: !isCapture,
    autoStart: hasStarted,
  });
  const musicRef = useRef<HTMLAudioElement>(null);
  const voRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (isCapture) return;
    if (!hasStarted) return;
    const music = musicRef.current;
    const vo = voRef.current;
    if (!music || !vo) return;
    music.volume = 0.22; // ducked while VO plays
    vo.volume = 1.0;

    const tryPlay = async () => {
      try {
        await Promise.all([music.play(), vo.play()]);
      } catch {
        const onClick = () => {
          music.play().catch(() => {});
          vo.play().catch(() => {});
          window.removeEventListener('click', onClick);
        };
        window.addEventListener('click', onClick, { once: true });
      }
    };
    tryPlay();

    // Swell music after VO finishes
    const onVoEnd = () => {
      music.volume = 0.55;
    };
    vo.addEventListener('ended', onVoEnd);
    return () => vo.removeEventListener('ended', onVoEnd);
  }, [hasStarted, isCapture]);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#020617] font-sans text-slate-50">
      {!isCapture && (
        <>
          <audio
            ref={musicRef}
            src={`${import.meta.env.BASE_URL}audio/background-music.mp3`}
            preload="auto"
          />
          <audio
            ref={voRef}
            src={`${import.meta.env.BASE_URL}audio/voiceover.mp3`}
            preload="auto"
          />
        </>
      )}

      {/* Persistent Background FX */}
      <div className="absolute inset-0 pointer-events-none mix-blend-screen z-0">
         <motion.div className="absolute w-[800px] h-[800px] rounded-full opacity-10 blur-[120px]"
          style={{ background: 'radial-gradient(circle, #38bdf8, transparent)' }}
          animate={{ x: ['-10%', '60%', '20%'], y: ['10%', '50%', '30%'], scale: [1, 1.3, 0.9] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }} />
      </div>

      <AnimatePresence initial={false} mode="wait">
        {currentScene === 0 && <Scene1 key="hook" />}
        {currentScene === 1 && <Scene2 key="pain" />}
        {currentScene === 2 && <Scene3 key="enter" />}
        {currentScene === 3 && <Scene4 key="principals" />}
        {currentScene === 4 && <Scene5 key="sites" />}
        {currentScene === 5 && <Scene6 key="catalog" />}
        {currentScene === 6 && <Scene7 key="hotlist" />}
        {currentScene === 7 && <Scene8 key="onboarding" />}
        {currentScene === 8 && <Scene9 key="dispatch" />}
        {currentScene === 9 && <Scene10 key="execution" />}
        {currentScene === 10 && <Scene11 key="crew" />}
        {currentScene === 11 && <Scene12 key="parts" />}
        {currentScene === 12 && <Scene13 key="visitors" />}
        {currentScene === 13 && <Scene14 key="accounting" />}
        {currentScene === 14 && <Scene15 key="analytics" />}
        {currentScene === 15 && <Scene16 key="trust" />}
      </AnimatePresence>

      {!hasStarted && !isCapture && (
        <button
          type="button"
          onClick={() => setHasStarted(true)}
          className="absolute inset-0 z-50 flex items-center justify-center bg-[#020617]/80 backdrop-blur-sm cursor-pointer group"
          aria-label="Play commercial"
        >
          <div className="flex flex-col items-center gap-4">
            <div className="w-20 h-20 rounded-full bg-[#38bdf8] flex items-center justify-center transition-transform group-hover:scale-110">
              <svg
                viewBox="0 0 24 24"
                fill="#020617"
                className="w-8 h-8 ml-1"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <span className="text-sm tracking-[0.3em] uppercase text-slate-300 font-semibold">
              Click to play
            </span>
          </div>
        </button>
      )}
    </div>
  );
}
