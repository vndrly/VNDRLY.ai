import { useSyncExternalStore } from "react";
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
  return <div className="next-steps-avatar" data-active={active} key={avatar}>
    <svg viewBox={avatars[avatar]} role="img" aria-label={avatar}>
      <image href="/next-steps-avatars.png" width="1536" height="1024" />
    </svg>
    {brand.logoSquareUrl && <img className="next-steps-avatar-badge" src={brand.logoSquareUrl} alt="" />}
  </div>;
}
