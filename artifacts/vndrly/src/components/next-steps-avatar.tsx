import { useSyncExternalStore } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { BrandedSelect } from "@/components/work-hub/chrome";

const avatars = ["Rivet", "Field Worker"] as const;
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
    try { return localStorage.getItem(key) === "Field Worker" ? "Field Worker" : "Rivet"; }
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
      {avatars.map(name => <option key={name}>{name}</option>)}
    </BrandedSelect>
  </label>;
}

export function NextStepsAvatar({ active = false }: { active?: boolean }) {
  const { avatar } = useAvatar();
  const brand = useBrand();
  return <svg className="next-steps-avatar" data-active={active} viewBox="0 0 48 48" role="img" aria-label={avatar}>
    <rect x="9" y="28" width="30" height="17" rx="7" fill={brand.primary} />
    {avatar === "Rivet" ? <>
      <path d="M24 9V4m-4 0h8" stroke={brand.primary} strokeWidth="3" strokeLinecap="round" />
      <rect x="8" y="9" width="32" height="23" rx="8" fill={brand.primary} />
      <rect x="12" y="13" width="24" height="15" rx="5" fill="#232323" />
    </> : <>
      <rect x="14" y="14" width="20" height="17" rx="8" fill="#232323" stroke={brand.primary} />
      <path d="M12 15a12 12 0 0 1 24 0m-27 1h30" stroke={brand.primary} strokeWidth="3" strokeLinecap="round" />
    </>}
    <circle cx="19" cy="21" r="1.7" fill="white" /><circle cx="29" cy="21" r="1.7" fill="white" />
    {brand.logoSquareUrl && <image href={brand.logoSquareUrl} x="18" y="32" width="12" height="12" />}
  </svg>;
}
