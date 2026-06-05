import { cn } from "@/lib/utils";
import { useBrand } from "@/hooks/use-brand";
import SplitToggleHalf from "@/components/split-toggle-half";
import {
  pickTogglePillSrc,
  SPLIT_TOGGLE_ACTIVE_TEXT_SHADOW,
  SPLIT_TOGGLE_IDLE_TEXT_CLASS,
  TOGGLE_IDLE_PILL_SRC,
} from "@/lib/pick-toggle-pill";

export type ThemeMode = "dark" | "light";

export default function DarkLightToggle({
  mode,
  onChange,
  className,
  variant: _variant = "light",
}: {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
  className?: string;
  variant?: "dark" | "light";
}) {
  const set = (next: ThemeMode) => {
    if (next === mode) return;
    onChange(next);
  };
  const brand = useBrand();
  const activePillSrc = pickTogglePillSrc(brand.primary, brand.name);
  const activeText = cn("text-white", SPLIT_TOGGLE_ACTIVE_TEXT_SHADOW);
  const idleText = SPLIT_TOGGLE_IDLE_TEXT_CLASS;

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
      <span aria-hidden className="w-px shrink-0 self-stretch bg-gray-400" />
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
