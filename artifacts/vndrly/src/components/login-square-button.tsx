import { cn } from "@/lib/utils";
import { PillColorLayer } from "@/components/png-pill-chrome";
import { useBrand } from "@/hooks/use-brand";
import {
  LOGIN_BUTTON_IMAGE_ASPECT,
  LOGIN_IDLE_SQUARE_SRC,
  pickLoginSquareActive,
} from "@/lib/login-button-palette";
import {
  PILL_HEIGHT_CLASS,
  PILL_HEIGHT_PX,
  PILL_LABEL_CLASS,
  PILL_TEXT_SHADOW,
  PILL_WRAPPER_CLASS,
} from "@/lib/pill-doctrine";

/** Login-only CTA: light-grey square at rest, brand square on hover. */
export default function LoginSquareButton({
  children,
  onClick,
  type = "button",
  disabled = false,
  testId,
  className,
  height = PILL_HEIGHT_PX,
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
        PILL_WRAPPER_CLASS,
        PILL_HEIGHT_CLASS,
        "cursor-pointer border-0 bg-transparent p-0",
        "transition-transform active:scale-[0.99]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        fullWidth ? "w-full" : "",
        className,
      )}
      style={{ height }}
    >
      <PillColorLayer
        src={activeSrc}
        imageAspect={LOGIN_BUTTON_IMAGE_ASPECT}
        className="opacity-0 group-hover:opacity-100 group-active:opacity-100 group-disabled:opacity-0"
      />
      <PillColorLayer
        src={idleSrc}
        imageAspect={LOGIN_BUTTON_IMAGE_ASPECT}
        className="opacity-100 group-hover:opacity-0 group-active:opacity-0 group-disabled:opacity-100"
      />
      <span className={cn(PILL_LABEL_CLASS, "h-full gap-1.5")}>
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
            "absolute inset-0 inline-flex items-center justify-center gap-1.5",
            "opacity-0 transition-opacity duration-200 text-white",
            "group-hover:opacity-100 group-active:opacity-100 group-disabled:opacity-0",
          )}
          style={{ textShadow: PILL_TEXT_SHADOW }}
        >
          {children}
        </span>
      </span>
    </button>
  );
}
