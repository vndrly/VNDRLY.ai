import PillBg from "@/components/pill-bg";
import { cn } from "@/lib/utils";
import { useBrand } from "@/hooks/use-brand";
import {
  LOGIN_BUTTON_IMAGE_ASPECT,
  LOGIN_IDLE_SQUARE_SRC,
  pickLoginSquareActive,
} from "@/lib/login-button-palette";

/**
 * Login-only CTA: light-grey square at rest, brand square on hover.
 * PillBg 3-slice keeps end caps crisp; only the middle 70% stretches.
 */
export default function LoginSquareButton({
  children,
  onClick,
  type = "button",
  disabled = false,
  testId,
  className,
  height = 32,
  fullWidth = true,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  testId?: string;
  className?: string;
  height?: number;
  fullWidth?: boolean;
}) {
  const brand = useBrand();
  const idleSrc = LOGIN_IDLE_SQUARE_SRC;
  const activeSrc = pickLoginSquareActive(brand.primary, brand.name);

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        "relative cursor-pointer group select-none inline-flex items-center justify-center",
        "transition-transform active:scale-[0.99]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        fullWidth ? "w-full" : "",
        className,
      )}
      style={{ height, padding: 0, background: "transparent", border: 0 }}
    >
      <PillBg
        src={activeSrc}
        imageAspect={LOGIN_BUTTON_IMAGE_ASPECT}
        className="opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-active:opacity-100 group-disabled:opacity-0"
      />
      <PillBg
        src={idleSrc}
        imageAspect={LOGIN_BUTTON_IMAGE_ASPECT}
        className="opacity-100 transition-opacity duration-200 group-hover:opacity-0 group-active:opacity-0 group-disabled:opacity-100"
      />
      <span
        className={cn(
          "relative z-10 inline-flex items-center justify-center gap-1.5 px-4 h-full",
          "text-sm font-bold whitespace-nowrap",
        )}
      >
        <span
          className={cn(
            "inline-flex items-center justify-center gap-1.5",
            "transition-opacity duration-200 text-gray-800/85",
            "group-hover:opacity-0 group-active:opacity-0 group-disabled:opacity-100",
          )}
        >
          {children}
        </span>
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 inline-flex items-center justify-center gap-1.5 px-4",
            "opacity-0 transition-opacity duration-200 text-white",
            "drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]",
            "group-hover:opacity-100 group-active:opacity-100 group-disabled:opacity-0",
          )}
        >
          {children}
        </span>
      </span>
    </button>
  );
}
