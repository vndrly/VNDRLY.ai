# UI Presets — vdark & vlight

Detailed reference for the named visual treatments. Short pointers in `replit.md`
under "vdark" / "vlight" preset entries; the canonical detail lives here.

## vdark — vendor sign-in dark treatment (May 2026)

When the user says "apply vdark to [page]", change that page to match these
settings exactly. **Reference implementation: `artifacts/vndrly/src/pages/login.tsx`** —
mirror its structure, class names, and components rather than re-deriving.

### Surface
- Page background: `#3a3d42` (matches the sidebar `--sidebar` token).
- Card / divider borders that previously used `border-gray-200`: switch to `border-white/20`.

### Typography (inverted for legibility on the dark surface)
- Headlines / brand name: `text-white` (was `text-gray-900`).
- Section titles / labels / strong inline emphasis: `text-gray-100` (was `text-gray-700`).
- Body copy / helper text / attributions: `text-gray-300` (was `text-gray-500`).
- Secondary links (e.g. "Reset my Password"): `text-gray-200`, brand-color hover preserved.
- **Do NOT invert text inside surfaces that remain white** (e.g. dev-only demo-accounts
  panels with `bg-white/50`) — keep dark `text-gray-*` there.

### Inputs
- Email/password and similar text inputs: add `bg-white` so they stay white on the dark surface.
- Password fields: include a clickable eye / eye-off icon (lucide `Eye` / `EyeOff`)
  on the right side that toggles `type` between `password` and `text`. Wrap `<Input>`
  in a `relative` div, add `pr-10` to the input, and absolutely-position the toggle
  button at `inset-y-0 right-0 w-10`.

### Primary action buttons → `<BakerPillButton>`
File: `artifacts/vndrly/src/components/baker-pill-button.tsx`.

- Doctrine pill for vdark pages. Layer stack: bottom = teal Baker pill PNG;
  top = grey pill PNG (idle, fully opaque). Hover/active fades the grey layer
  out to reveal the teal.
- Idle text: `text-gray-700`. Hover/active text: `text-white` with
  `drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]`. Two cross-fading label spans, 200 ms.
- 3-slice rendering via `<PillBg>` (aspect = 900/229) so corners stay rounded
  and the middle stretches.
- Disabled state: locks to grey idle (no hover swap) and dark-grey label —
  used for "Sign In" until both username and password are entered.
- Two canonical placements on the vendor sign-in: **Sign In to Portal**
  (submit, disabled until form is valid) and **Continue as Visitor**
  (always interactive). Both default to `idleVariant="grey"`.
- **Brand-aware active color (`brandColor` prop)**: always pass
  `brandColor={brand.primary}` from `useBrand()`. `BakerPillButton` swaps the
  bottom layer to the closest matching pill PNG via `pickPillForBrand()`.
  Default unbranded brand is VNDRLY gold (`#e6ac00` → amber pill).
  Very-low-saturation brand colors fall back to the neutral grey pill;
  `brandColor={null}` keeps Baker teal. Do not hand-pick a pill — let
  `pickPillForBrand()` choose.

### Top-right: EN/ES toggle
- `<LanguageToggle variant="light" />` positioned `absolute top-4 right-4 z-20`.

### Bottom-right "…powered by" attribution (always shown on a vdark page)
- Container: `absolute bottom-4 right-4 z-20 flex items-center gap-2 text-sm text-gray-300 leading-relaxed`.
- Text: `<span className="italic">…powered by</span>` (no quotes).
- VNDRLY square mark: `<img src={vndrlyMark} className="w-6 h-6 shrink-0" />` (24×24 px).
  Asset: `@assets/vndrlylogo7_1778217520404.png`.

### Branded company logo treatment (only when a partner-square logo is loaded)
Render the partner's 64×64 rounded square badge as three stacked layers inside a
`relative w-16 h-16 rounded-lg overflow-hidden` wrapper:

1. **Bottom**: grey radial-vignette underlay PNG at `opacity: 0.5`
   (`@assets/logo-underrlay_1778217900673.png`).
2. **Middle**: the partner logo (`object-cover`, fills the square).
3. **Top**: white glossy highlight overlay PNG at `opacity: 0.7`
   (`@assets/logo-overlay_1778217860263.png`).

All three are `absolute inset-0 w-full h-full object-cover`; underlay and overlay
are `pointer-events-none aria-hidden`. Apply to the partner-square branch only —
leave the irregular partner-logo branch and the default unbranded VNDRLY-logo
branch as plain `<img>`.

## vlight — known-good vendor login snapshot

Frozen at commit `a5ea8f4f` (May 8, 2026). When the user says
"apply vlight to the vendor login" (or "revert / restore vlight"), restore the
affected files from the snapshot rather than re-deriving:

```
cp snapshots/vlight-vendor-login/login.tsx artifacts/vndrly/src/pages/login.tsx
cp snapshots/vlight-vendor-login/baker-pill-button.tsx artifacts/vndrly/src/components/baker-pill-button.tsx
```

Snapshot lives in `snapshots/vlight-vendor-login/` with its own README.

**Important nuance**: at capture time the page was already in the **vdark**
treatment, so "vlight" is shorthand for "the user's known-good vendor login,"
not a light color scheme. The preset is currently scoped to the vendor login
only — if the user later asks for vlight on a different page, ask before
generalizing.
