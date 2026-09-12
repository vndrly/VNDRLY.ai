# MidCon × Flywheel — VNDRLY Gate commercial pitch

**Audience:** MidCon Solutions (vendor) → Flywheel Energy (partner)  
**Brand on screen:** VNDRLY · **Spoken VO:** “vendorly”  
**Capture / encode date:** 2026-08-28

## Primary deliverable

| File | Notes |
|------|--------|
| [`midcon_flywheel_gate_commercial_pitch.mp4`](./midcon_flywheel_gate_commercial_pitch.mp4) | 1920×1080, ~77s, edge-tts VO + soft ambient |

Open the MP4 locally after checkout — it is **not** published by the site `publish.yml` path (lives under `docs/`, not web public assets).

## Package layout

```
docs/pitch/midcon-flywheel-gate/
├── midcon_flywheel_gate_commercial_pitch.mp4   # commercial
├── gate_midcon_flywheel_pitch.md               # full pitch narrative
├── README.md                                   # this file
├── stills/                                     # commercial frames + live UI shots
├── logos/                                      # MidCon / Flywheel / VNDRLY marks
└── storyboard/                                 # 6 beat boards (PNG)
```

## Beats (commercial)

1. Cold open — pad / crew atmosphere  
2. Problem — “Who’s on the pad?”  
3. Brand — MidCon booth on VNDRLY Gate  
4. Plate-first OCR · optional state  
5. Site by name — Flywheel Energy Spur  
6. Tap-to-talk voice entry  
7. GPS miles fence  
8. Visitor self check-in → pending admit  
9. Flywheel Gate Log (live)  
10. PDF / Excel / Word exports  
11. End card — MidCon + Flywheel Energy + VNDRLY Gate  

See [`gate_midcon_flywheel_pitch.md`](./gate_midcon_flywheel_pitch.md) for product-accurate Gate positioning and known capture gaps.

## Checkout (alternate machine)

```bat
cd C:\Users\JohnElerick\DEV\VNDRLY.ai
git fetch origin
git checkout cursor/midcon-flywheel-gate-pitch-8b1b
explorer docs\pitch\midcon-flywheel-gate
```

Or pull only this folder after checking out the branch:

```bat
start docs\pitch\midcon-flywheel-gate\midcon_flywheel_gate_commercial_pitch.mp4
```
