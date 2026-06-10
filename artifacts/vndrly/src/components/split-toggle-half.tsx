import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { toggleHalfPillBgStyle } from "@/lib/pick-toggle-pill";

import { splitToggleLabelClass } from "@/lib/pill-doctrine";



/** Fixed pill height — all toggle halves share this exactly. */

export const SPLIT_TOGGLE_PILL_HEIGHT_PX = 23;



type SplitToggleHalfProps = {

  side: "left" | "right";

  pillSrc: string;

  /** Whether this half is the selected/active state. */

  active: boolean;

  children: ReactNode;

  className?: string;

  /** Override nav-doctrine label classes when needed. */

  textClassName?: string;

  bgClassName?: string;

} & ButtonHTMLAttributes<HTMLButtonElement>;



/**

 * One half of a split EN/ES, Dark/Light, Map/Satellite, etc. toggle.

 * Label styling matches sidebar nav square buttons via pill-doctrine.

 */

export default function SplitToggleHalf({

  side,

  pillSrc,

  active,

  children,

  className,

  textClassName,

  bgClassName,

  type = "button",

  ...props

}: SplitToggleHalfProps) {

  return (

    <button

      type={type}

      {...props}

      className={cn(

        "relative inline-flex shrink-0 items-center justify-center",

        "border-0 m-0 p-0 px-2 bg-transparent",

        "text-xs leading-none cursor-pointer select-none",

        className,

      )}

      style={{

        height: SPLIT_TOGGLE_PILL_HEIGHT_PX,

        minHeight: SPLIT_TOGGLE_PILL_HEIGHT_PX,

        maxHeight: SPLIT_TOGGLE_PILL_HEIGHT_PX,

      }}

    >

      <span

        aria-hidden

        className={cn("absolute inset-0 pointer-events-none", bgClassName)}

        style={toggleHalfPillBgStyle(pillSrc, side)}

      />

      <span

        className={cn(

          "relative z-10 flex items-center justify-center",

          textClassName ?? splitToggleLabelClass(active),

        )}

      >

        {children}

      </span>

    </button>

  );

}

