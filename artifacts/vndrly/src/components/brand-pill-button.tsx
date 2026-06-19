import { cn } from "@/lib/utils";

import { PillColorLayer } from "@/components/png-pill-chrome";

import {

  PILL_IDLE,

  pillAmber,

  pillBlue,

  pillGreen,

  pillRed,

} from "@/lib/pill-palette-assets";

import {

  PILL_HEIGHT_CLASS,

  PILL_HEIGHT_PX,

  PILL_LABEL_CLASS,

  PILL_LABEL_HOVER_REVEAL_CLASS,

  PILL_LABEL_ON_COLOR_CLASS,

  PILL_LABEL_ON_LIGHT_CLASS,

  PILL_WRAPPER_CLASS,

  pillLabelToneClass,

} from "@/lib/pill-doctrine";



interface BrandPillButtonProps {

  children: React.ReactNode;

  onClick?: () => void;

  className?: string;

  type?: "button" | "submit";

  disabled?: boolean;

  href?: string;

  target?: string;

  rel?: string;

  tone?: "image" | "brand" | "blue" | "green" | "red" | "amber";

  /** Grey idle pill crossfades to this PNG on hover — no gloss or scale. */
  hoverSrc?: string;

  height?: number;

  attention?: boolean;

  title?: string;

  "data-testid"?: string;

}



const TONE_PILL: Record<NonNullable<BrandPillButtonProps["tone"]>, string> = {

  image: PILL_IDLE,

  brand: pillBlue,

  blue: pillBlue,

  green: pillGreen,

  red: pillRed,

  amber: pillAmber,

};



export default function BrandPillButton({

  children,

  onClick,

  className,

  type = "button",

  disabled,

  href,

  target,

  rel,

  tone = "image",

  hoverSrc,

  height = PILL_HEIGHT_PX,

  attention: _attention = false,

  title,

  ...props

}: BrandPillButtonProps) {

  const sharedClassName = cn(

    PILL_WRAPPER_CLASS,

    PILL_HEIGHT_CLASS,

    "group cursor-pointer border-0 bg-transparent p-0 disabled:opacity-50 disabled:cursor-not-allowed",

    className,

  );

  const sharedStyle: React.CSSProperties = { height };

  const toneHoverSrc =
    tone === "blue" ? pillBlue : tone === "red" ? pillRed : undefined;
  const hoverRevealSrc = hoverSrc ?? toneHoverSrc;
  const hoverReveal = !!hoverRevealSrc;
  const src = TONE_PILL[tone];
  const light = hoverReveal || src === PILL_IDLE;

  const inner = hoverReveal ? (
    <>
      <PillColorLayer
        src={hoverRevealSrc}
        className="opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-active:opacity-100 group-disabled:opacity-0"
      />
      <PillColorLayer
        src={PILL_IDLE}
        className="opacity-100 transition-opacity duration-200 group-hover:opacity-0 group-active:opacity-0 group-disabled:opacity-100"
      />
      <span
        className={cn(
          PILL_LABEL_CLASS,
          "h-full gap-1.5",
          PILL_LABEL_ON_LIGHT_CLASS,
          PILL_LABEL_HOVER_REVEAL_CLASS,
        )}
      >
        {children}
      </span>
    </>
  ) : (
    <>
      <PillColorLayer src={src} />
      <span
        className={cn(
          PILL_LABEL_CLASS,
          "h-full gap-1.5",
          pillLabelToneClass(light),
        )}
      >
        {children}
      </span>
    </>
  );



  if (href !== undefined) {

    return (

      <a

        href={href}

        target={target}

        rel={rel}

        onClick={onClick}

        className={sharedClassName}

        style={sharedStyle}

        aria-disabled={disabled || undefined}

        data-testid={props["data-testid"]}

      >

        {inner}

      </a>

    );

  }



  return (

    <button

      type={type}

      onClick={onClick}

      disabled={disabled}

      title={title}

      className={sharedClassName}

      style={sharedStyle}

      data-testid={props["data-testid"]}

    >

      {inner}

    </button>

  );

}

