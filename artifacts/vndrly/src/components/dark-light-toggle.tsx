import { cn } from "@/lib/utils";
import { useBrand } from "@/hooks/use-brand";
import SplitToggleHalf from "@/components/split-toggle-half";
import {
  pickTogglePillSrc,
  splitToggleActiveTextClass,
  splitToggleDividerClass,
  splitToggleIdleTextClass,
  TOGGLE_IDLE_PILL_SRC,
  type SplitToggleVariant,
} from "@/lib/pick-toggle-pill";

export type ThemeMode = "dark" | "light";

export default function DarkLightToggle({
  mode,
  onChange,
  className,
  variant = "light",
}: {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
  className?: string;
  variant?: SplitToggleVariant;
}) {
  const set = (next: ThemeMode) => {
    if (next === mode) return;
    onChange(next);
  };
  const brand = useBrand();
  const activePillSrc = pickTogglePillSrc(brand.primary, brand.name);
  const activeText = splitToggleActiveTextClass(variant);
  const idleText = splitToggleIdleTextClass(variant);
  const dividerClass = splitToggleDividerClass(variant);

  return (
    <div
      className={cn(
        "inline-flex items-stretch rounded-full overflow-hidden",
        className,
      )}
      data-testid="dark-light-toggle"
    >
      <SplitToggleHalf
        side="left"
        pillSrc={mode === "dark" ? activePillSrc : TOGGLE_IDLE_PILL_SRC}
        textClassName={mode === "dark" ? activeText : idleText}
        onClick={() => set("dark")}
        data-testid="theme-dark"
        aria-pressed={mode === "dark"}
      >
        Dark
      </SplitToggleHalf>
      <span aria-hidden className={cn("w-px shrink-0 self-stretch", dividerClass)} />
      <SplitToggleHalf
        side="right"
        pillSrc={mode === "light" ? activePillSrc : TOGGLE_IDLE_PILL_SRC}
        textClassName={mode === "light" ? activeText : idleText}
        onClick={() => set("light")}
        data-testid="theme-light"
        aria-pressed={mode === "light"}
      >
        Light
      </SplitToggleHalf>
    </div>
  );
}
