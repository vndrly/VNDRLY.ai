import { cn } from "@/lib/utils";

import {

  pillAmber,

  pillBlue,

  pillGreen,

  pillRed,

  PILL_IDLE,

} from "@/lib/pill-palette-assets";

import {

  PILL_HEIGHT_PX,

  PILL_LABEL_CLASS,

  PILL_WRAPPER_CLASS,

  pillLabelToneClass,

} from "@/lib/pill-doctrine";

import { PillColorLayer } from "@/components/png-pill-chrome";



export type ImagePillColor = "amber" | "blue" | "green" | "red" | "grey";



const PILL_IMAGE: Record<ImagePillColor, string> = {

  amber: pillAmber,

  blue: pillBlue,

  green: pillGreen,

  red: pillRed,

  grey: PILL_IDLE,

};



interface ImagePillProps {

  color?: ImagePillColor;

  rest?: boolean;

  height?: number;

  className?: string;

  /** Allow nested controls (e.g. crew-chip remove button). */
  interactive?: boolean;

  children: React.ReactNode;

  title?: string;

  "aria-label"?: string;

  "data-testid"?: string;

}



export default function ImagePill({

  color = "grey",

  rest = false,

  height = PILL_HEIGHT_PX,

  className,

  interactive = false,

  children,

  title,

  "aria-label": ariaLabel,

  "data-testid": dataTestId,

}: ImagePillProps) {

  const effectiveColor: ImagePillColor = rest ? "grey" : color;

  const isLight = effectiveColor === "grey";

  return (

    <span

      className={cn(

        PILL_WRAPPER_CLASS,

        "min-w-[70px]",
        !interactive && "pointer-events-none",

        className,

      )}

      style={{ height: `${height}px` }}

      title={title}

      aria-label={ariaLabel}

      data-testid={dataTestId}

    >

      <PillColorLayer src={PILL_IMAGE[effectiveColor]} />

      <span

        className={cn(

          PILL_LABEL_CLASS,

          "h-full gap-1.5",

          pillLabelToneClass(isLight),

        )}

      >

        {children}

      </span>

    </span>

  );

}

