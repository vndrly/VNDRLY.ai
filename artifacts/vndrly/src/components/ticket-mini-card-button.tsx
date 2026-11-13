import { forwardRef, type ButtonHTMLAttributes, type ComponentProps } from "react";
import type { PngPillButton } from "./png-pill-rollover";
import "./ticket-detail-surfaces.css";

type Props = Omit<ComponentProps<typeof PngPillButton>, keyof ButtonHTMLAttributes<HTMLButtonElement>> & ButtonHTMLAttributes<HTMLButtonElement>;
/** Ticket actions retain native button semantics and the shared branded minicard treatment. */
export const TicketMiniCardButton = forwardRef<HTMLButtonElement, Props>(function TicketMiniCardButton({
  color: _color, activeSrc: _activeSrc, idleSrc: _idleSrc, idleOpacity: _idleOpacity,
  fullWidth, activeTextShadowClass: _activeText, hoverTextShadowClass: _hoverShadow,
  hoverTextClass: _hoverText, height: _height, size: _size, attention: _attention,
  className = "", children, type = "button", ...props
}, ref) {
  return <button ref={ref} type={type} {...props} className={`vendor-mini-card-button ticket-mini-card-button ${fullWidth ? "w-full" : ""} ${className}`}>{children}</button>;
});
