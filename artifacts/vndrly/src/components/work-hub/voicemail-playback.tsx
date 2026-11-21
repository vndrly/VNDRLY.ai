import { useState, type RefObject } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";

const controlClass = "grid size-8 shrink-0 place-items-center rounded-md border-0 bg-transparent text-[var(--brand-primary)] hover:brightness-125 focus-visible:outline-2 focus-visible:outline-current";

function clock(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export default function VoicemailPlayback({
  audioRef, src, label, durationMs, onPlay,
}: {
  audioRef: RefObject<HTMLAudioElement | null>;
  src: string;
  label: string;
  durationMs: number;
  onPlay: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(Math.max(0, durationMs / 1000) || 0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState(false);
  const playLabel = playing ? "Pause voicemail" : "Play voicemail";
  const muteLabel = muted ? "Unmute voicemail" : "Mute voicemail";

  return (
    <div className="min-w-0">
      <audio
        ref={audioRef}
        preload="none"
        src={src}
        aria-label={label}
        onLoadedMetadata={event => {
          const actual = event.currentTarget.duration;
          if (Number.isFinite(actual) && actual > 0) setDuration(actual);
        }}
        onTimeUpdate={event => setPosition(event.currentTarget.currentTime)}
        onPlay={() => { setPlaying(true); setError(false); onPlay(); }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onVolumeChange={event => {
          setVolume(event.currentTarget.volume);
          setMuted(event.currentTarget.muted);
        }}
        onError={() => { setPlaying(false); setError(true); }}
      />
      <div role="group" aria-label="Voicemail playback" className="flex w-full max-w-80 items-center gap-2 bg-transparent">
        <button type="button" className={controlClass} aria-label={playLabel} title={playLabel} onClick={() => {
          const audio = audioRef.current;
          if (!audio) return;
          if (audio.paused) void audio.play().catch(() => setError(true));
          else audio.pause();
        }}>
          {playing ? <Pause aria-hidden="true" className="size-4" /> : <Play aria-hidden="true" className="size-4" />}
        </button>
        <span aria-hidden="true" className="shrink-0 text-xs tabular-nums">{clock(position)}</span>
        <input
          type="range"
          aria-label="Voicemail position"
          aria-valuetext={`${clock(position)} of ${clock(duration)}`}
          className="min-w-0 flex-1 cursor-pointer accent-[var(--brand-primary)]"
          min={0}
          max={duration}
          step={0.01}
          value={Math.min(position, duration)}
          disabled={!duration}
          onChange={event => {
            if (!audioRef.current) return;
            audioRef.current.currentTime = event.currentTarget.valueAsNumber;
            setPosition(audioRef.current.currentTime);
          }}
        />
        <button type="button" className={controlClass} aria-label={muteLabel} title={muteLabel} onClick={() => {
          if (audioRef.current) audioRef.current.muted = !audioRef.current.muted;
        }}>
          {muted || volume === 0 ? <VolumeX aria-hidden="true" className="size-4" /> : <Volume2 aria-hidden="true" className="size-4" />}
        </button>
        <input
          type="range"
          aria-label="Voicemail volume"
          className="w-12 shrink-0 cursor-pointer accent-[var(--brand-primary)]"
          min={0}
          max={100}
          value={muted ? 0 : Math.round(volume * 100)}
          onChange={event => {
            if (!audioRef.current) return;
            audioRef.current.volume = event.currentTarget.valueAsNumber / 100;
            audioRef.current.muted = false;
          }}
        />
      </div>
      {error && <p role="status" className="mt-1 text-xs text-muted-foreground">Could not play this voicemail.</p>}
    </div>
  );
}
