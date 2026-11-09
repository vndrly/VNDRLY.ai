import { useId, useSyncExternalStore } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { BrandedSelect } from "@/components/work-hub/chrome";

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
  return <label className="block space-y-1 text-sm">
    <span>Next Steps avatar</span>
    <BrandedSelect value={avatar} onChange={event => choose(event.target.value)}>
      {Object.keys(avatars).map(name => <option key={name}>{name}</option>)}
    </BrandedSelect>
  </label>;
}

export function NextStepsAvatar({ active = false }: { active?: boolean }) {
  const { avatar } = useAvatar();
  const brand = useBrand();
  const tintId = useId();
  const [x, y, size] = badgePositions[avatar];
  return <div className="next-steps-avatar" data-active={active} key={avatar}>
    <svg viewBox={avatars[avatar]} role="img" aria-label={avatar}>
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
    </svg>
  </div>;
}
