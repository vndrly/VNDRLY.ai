import { useId, useRef, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { ProfileRow } from "@/components/gate-profile-chrome";

const avatars = {
  Rivet: "814 128 288 313",
  V: "57 145 294 296",
  Beacon: "417 145 325 296",
  Scout: "1212 128 273 313",
  Relay: "196 545 277 359",
  Tally: "599 550 312 354",
  "Field Worker": "1047 544 356 360",
} as const;
const badgePositions: Record<keyof typeof avatars, [number, number, number]> = {
  Rivet: [946, 289, 63],
  V: [187, 304, 43],
  Beacon: [541, 361, 52],
  Scout: [1313, 133, 47],
  Relay: [347, 791, 48],
  Tally: [750, 786, 50],
  "Field Worker": [1244, 794, 48],
};
const changeEvent = "vndrly:next-steps-avatar";
function subscribe(callback: () => void) {
  window.addEventListener(changeEvent, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(changeEvent, callback);
    window.removeEventListener("storage", callback);
  };
}
function useAvatar() {
  const { user } = useAuth();
  const key = `vndrly:next-steps-avatar:${user?.userId}`;
  const avatar = useSyncExternalStore(subscribe, () => {
    try {
      const saved = localStorage.getItem(key);
      return saved && Object.hasOwn(avatars, saved) ? saved as keyof typeof avatars : "Rivet";
    }
    catch { return "Rivet"; }
  });
  return { avatar, choose(value: string) {
    try { localStorage.setItem(key, value); } catch { return; }
    window.dispatchEvent(new Event(changeEvent));
  } };
}

export function NextStepsAvatarPreference() {
  const { avatar, choose } = useAvatar();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  return <div ref={container}>
    <ProfileRow label="VNDRLY Avatar" open={open} onClick={() => setOpen(value => !value)} unframed
      trailing={<span className="shrink-0 text-sm text-muted-foreground">{avatar}</span>}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3" aria-label="VNDRLY avatars">
        {(Object.keys(avatars) as Array<keyof typeof avatars>).map(name => <button
          key={name} type="button" aria-label={name} aria-pressed={avatar === name}
          onClick={() => { choose(name); setOpen(false); container.current?.querySelector<HTMLButtonElement>('button')?.focus(); }}
          className="flex min-w-0 flex-col items-center gap-2 rounded-xl border border-transparent p-3 text-sm hover:bg-white/5 aria-pressed:border-[var(--brand-primary)] focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)]">
          <AvatarImage avatar={name} className="h-28 w-28 max-w-full" /><span>{name}</span>
        </button>)}
      </div>
    </ProfileRow>
  </div>;
}

export function NextStepsAvatar({ active = false }: { active?: boolean }) {
  const { avatar } = useAvatar();
  return <div className="next-steps-avatar" data-active={active} key={avatar}><AvatarImage avatar={avatar} /></div>;
}

function AvatarImage({ avatar, className }: { avatar: keyof typeof avatars; className?: string }) {
  const brand = useBrand();
  const tintId = useId();
  const [x, y, size] = badgePositions[avatar];
  return <svg className={className} viewBox={avatars[avatar]} role="img" aria-label={avatar}>
      {brand.isOrgBranded && <defs>
        <filter id={tintId} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
          {/* Select warm accents by their red-to-blue difference, then retain their shading. */}
          <feColorMatrix in="SourceGraphic" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2 0 -2 0 -.22" result="accents" />
          <feFlood floodColor={brand.primary} result="brandColor" />
          <feBlend in="brandColor" in2="SourceGraphic" mode="color" result="tinted" />
          <feComposite in="tinted" in2="accents" operator="in" />
          <feComposite in2="SourceGraphic" operator="over" />
        </filter>
      </defs>}
      <image href="/next-steps-avatars.png" width="1536" height="1024"
        filter={brand.isOrgBranded ? `url(#${tintId})` : undefined} />
      {brand.logoSquareUrl && <image href={brand.logoSquareUrl} x={x} y={y} width={size} height={size} />}
    </svg>;
}
