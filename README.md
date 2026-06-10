# Optimal · Full Body Scan — 3D Biomarker Visualizer

A **Neko Health–style** preventive-health scan interface: a glowing blue **halftone-dot human body** rendered in 3D, floating on warm off-white paper, with biomarker measurements anchored to the relevant organs by hairline leader lines (ApoB at the heart, ALT at the liver, eGFR at the kidney, and so on).

Built with **vanilla Three.js** — no build step, no framework.

**Live:** https://optimal-research-team.github.io/neko-visualizer/

## Design language

Researched and rebuilt to match Neko Health's actual visual identity:

- **Warm off-white paper** (`#FCFBFA` under a 4% wash + a pale cool-blue bloom) — never stark white.
- **Blue halftone point-cloud body** rendered as a regular surface lattice of soft round dots. The depth read is *inverted for a light background*: near rows are deep cobalt and opaque, far rows desaturate to a pale dusty blue and melt into the paper.
- **Editorial typography** — [Fraunces](https://fonts.google.com/specimen/Fraunces) serif (weight 400, never bold) for headers and the big tabular numerals, [IBM Plex Sans](https://fonts.google.com/specimen/IBM+Plex+Sans) for UI/labels, [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) for units.
- **Hairline leader lines** (1px, 10–18% charcoal) with small scan-blue measurement-node anchors. Bare type floating on the paper — no cards, no chips, no drop shadows.
- **Earthy semantic status** — optimal `#5E8C6A`, monitor `#C99A4E`, elevated `#C2614F` (desaturated, never neon).

## The hard part: blending on a light background

The original dark-theme build used **additive blending**, which only ever pushes pixels toward white. On a light/cream background that makes every dot *vanish*. The fix is the core of this rebuild:

- `THREE.NormalBlending` with `premultipliedAlpha: false` and `depthWrite: false` — each dark-blue dot **subtracts** brightness from the paper via per-fragment alpha, so it reads as crisp ink instead of washing out.
- `renderer.outputColorSpace = SRGBColorSpace` so the blue stays a true blue, not muddy grey.
- The glow is built from **darkening, not bloom**: a CSS `mix-blend-mode: multiply` blurred blue radial sits behind the transparent canvas. No `UnrealBloomPass` (which would haze the whole cream frame toward white).

A custom `ShaderMaterial` drives per-point size (perspective attenuation, clamped 1–16px × pixelRatio), an inverted depth cue (near = dark/saturated/large, far = pale/faint/small), subtle normal-based volumetric shading, and silhouette-rim emphasis.

## Anatomy

The body is generated procedurally as a voxel field — each grid point tested against a union of ellipsoids and capsules (head, neck, torso, pelvis, arms, legs). Only **surface** voxels are kept (any empty 6-neighbour), and an outward **normal** is baked per point from the numeric gradient of the occupancy field. The result is a translucent dotted shell you can see through to the far side.

## Biomarkers

Grouped Neko-style. Switch groups to re-anchor the leader lines and swap the hero gauge (Arterial / Metabolic / Skin age).

| Group | Markers |
|-------|---------|
| **Heart & Circulation** | Resting HR · hs-CRP · Blood Pressure · VO₂ Max · ApoB · Lp(a) |
| **Body** | ALT · eGFR · Cortisol AM · Body Fat · TSH · Ferritin · HbA1c · Fasting Glucose · Vitamin D |
| **Skin** | Hydration · Thermal Map · Lesion Scan · Surface Area · Microcirculation |

Each marker carries a realistic value, unit, reference range, and status, and is anchored to its organ (heart, liver, pancreas, kidney, thyroid, adrenal, skin…). Labels live in stable side gutters; the hairline leaders track the rotating anchor points and fade gracefully as an organ turns away.

## Interaction

- Calm **pendulum turntable** auto-rotation (±28°) that keeps the front organs readable.
- **Drag to rotate**, scroll to zoom (OrbitControls). Auto-rotation resumes after interaction.
- **Group tabs** (Heart & Circulation / Body / Skin) re-anchor the measurements and swap the gauge.

## Run locally

```bash
python3 -m http.server 3009
# open http://localhost:3009
```

No dependencies — Three.js r160 loads from CDN via an importmap.

## Tech

- Three.js r160 (ES modules via importmap)
- Custom GLSL `ShaderMaterial` point cloud (NormalBlending, baked normals)
- HTML + SVG overlay for leader lines and floating annotations
- Fraunces · IBM Plex Sans · IBM Plex Mono
