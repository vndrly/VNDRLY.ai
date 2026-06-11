import * as React from "react"

import { cn } from "@/lib/utils"

/** Shared corner radius — outer cards, mini stat tiles, and inner sub-cards. */
export const CARD_CORNER_CLASS = "rounded-xl"

/** Outer card shell — canonical dashboard/content-pane card. */
export const CARD_SURFACE_CLASS =
  `${CARD_CORNER_CLASS} border-2 border-gray-300 bg-white text-gray-900 shadow-[var(--card-shadow)] transition-shadow duration-200 hover:shadow-[var(--card-shadow-hover)] dark:border-gray-400 dark:bg-white dark:text-gray-900`

/** Read-only inner tile (stat box, subsection) — grey outline matches outer card. */
export const CARD_INNER_TILE_CLASS =
  `${CARD_CORNER_CLASS} border-2 border-gray-300 bg-white p-3 dark:border-gray-400 dark:bg-white`

/** Shared hover lift for inner tiles — shadow only; clickable tiles add brand border below. */
const CARD_INNER_TILE_HOVER_SHADOW_CLASS =
  "shadow-[var(--card-shadow)] transition-[border-color,box-shadow] duration-200 hover:shadow-[var(--card-shadow-hover)]"

/** Read-only subcard — grey outline; hover shadow lift only (no border change). */
export const CARD_INNER_TILE_HOVER_CLASS =
  `${CARD_INNER_TILE_CLASS} ${CARD_INNER_TILE_HOVER_SHADOW_CLASS}`

/** Clickable subcard — grey outline + card shadow at rest; brand outline + hover lift on hover. */
export const CARD_INNER_TILE_CLICKABLE_CLASS =
  `${CARD_INNER_TILE_HOVER_CLASS} hover:!border-[color:var(--brand-primary)]`

/** Clickable plain / side-by-side card — brand outline on hover (Card shell already lifts shadow). */
export const CARD_SURFACE_LINK_HOVER_CLASS =
  "transition-[border-color,box-shadow] duration-200 hover:!border-[color:var(--brand-primary)]"

/** Mini stat tile body — icon row + single primary value. */
export const CARD_MINI_CONTENT_CLASS = "p-4 h-24 flex flex-col"

/** Drop shadow for branded Lucide icons in card headers / stat rows. */
export const CARD_ICON_DROP_SHADOW_CLASS = "card-icon-drop-shadow"

/** Canonical card icon size — matches Hotlist card header (w-5). Top-aligned when label text wraps. */
export const CARD_ICON_CLASS = "w-5 h-5 shrink-0 self-start card-icon-drop-shadow"

/** Flex row for icon + label/title — icon stays on the first line when text wraps. */
export const CARD_ICON_ROW_CLASS = "flex items-start gap-2"

/** CardTitle header icon. */
export const CARD_TITLE_ICON_CLASS = CARD_ICON_CLASS

/** Branded icon in inner sub-card label row (Ask VNDRLY stat tiles, etc.). */
export const CARD_SUBCARD_ICON_CLASS = CARD_ICON_CLASS

/** Branded metadata icon in sub-card detail rows (Hotlist location, date, etc.). */
export const CARD_SUBCARD_META_ICON_CLASS = CARD_ICON_CLASS

/** CardTitle direct-child SVGs inherit header icon size + drop shadow. */
const CARD_TITLE_SVG_CLASS =
  "[&>svg]:w-5 [&>svg]:h-5 [&>svg]:shrink-0 [&>svg]:self-start [&>svg]:card-icon-drop-shadow"

/** Horizontal rule / chart baseline matching card outline grey. */
export const CARD_INNER_RULE_CLASS = "border-t-2 border-gray-300 dark:border-gray-400"

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(CARD_SURFACE_CLASS, className)}
    {...props}
  />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="card-title"
    className={cn(
      "font-semibold leading-none tracking-tight",
      CARD_TITLE_SVG_CLASS,
      className,
    )}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }