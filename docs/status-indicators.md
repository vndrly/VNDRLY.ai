# Status indicators

Use `components/status-indicator.tsx` for read-only status indicators on every web page. `ImagePill`, `TicketStatusBadge`, lifecycle labels, approval badges, and `LiveConnectionPill` use this same treatment. Generic `Badge` shares its layout class.

- Rounded compact shape, consistent padding, colored dot and matching text.
- Background is the same hue at 26% opacity, never a neutral replacement.
- Use the shared bright semantic palette and `readableIndicatorColor` for legacy status colors so labels remain visible on dark cards.
- Keep existing status meaning, labels, and interactive refresh behavior.
- Card-update pulses remain white; status dots retain their semantic colors.
- Do not add local glossy PNG or neutral-background status variants. Action buttons and on/off switches retain their own controls.
