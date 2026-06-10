import { cn } from "@/lib/utils";

import { PillColorLayer } from "@/components/png-pill-chrome";

import { PILL_IDLE, pillBlue } from "@/lib/pill-palette-assets";

import {

  PILL_HEIGHT_CLASS,

  PILL_HEIGHT_PX,

  PILL_LABEL_CLASS,

  PILL_WRAPPER_CLASS,

  pillLabelToneClass,

} from "@/lib/pill-doctrine";



/** Toggle pill — active shows colored PNG, inactive shows idle grey. */

export default function BrandPill({

  active,

  onClick,

  children,

  testId,

  height = PILL_HEIGHT_PX,

  className = "",

  disabled = false,

  tone: _tone = "brand",

}: {

  active: boolean;

  onClick?: () => void;

  children: React.ReactNode;

  testId?: string;

  height?: number;

  className?: string;

  disabled?: boolean;

  tone?: "brand" | "blue";

}) {

  const src = active ? pillBlue : PILL_IDLE;



  return (

    <button

      type="button"

      onClick={onClick}

      disabled={disabled}

      data-testid={testId}

      aria-pressed={active}

      className={cn(

        PILL_WRAPPER_CLASS,

        PILL_HEIGHT_CLASS,

        "cursor-pointer border-0 bg-transparent p-0 disabled:opacity-50 disabled:cursor-not-allowed",

        className,

      )}

      style={{ height }}

    >

      <PillColorLayer src={src} />

      <span

        className={cn(

          PILL_LABEL_CLASS,

          "h-full",

          pillLabelToneClass(!active),

        )}

      >

        {children}

      </span>

    </button>

  );

}

