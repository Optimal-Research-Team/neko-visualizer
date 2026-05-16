# Biometric Twin — 3D Voxel Visualizer

A Neko Health–inspired 3D visualization of a pixellated human body with floating biomarker labels positioned around the relevant organs (ApoB near the heart, ALT near the liver, eGFR near the kidneys, etc.).

Built with vanilla Three.js, no build step.

## Tech

- Three.js r160 (CDN, ES modules via importmap)
- `InstancedMesh` for ~3,000 body + organ voxels
- `UnrealBloomPass` for the organ glow
- HTML/SVG overlay for biomarker cards and curved leader lines
- Inter + JetBrains Mono typography

## Run locally

```bash
python3 -m http.server 3009
# open http://localhost:3009
```

## Anatomy

The body is generated procedurally as a voxel field: each grid point is tested against a union of ellipsoids and capsules (head, torso, pelvis, arms, legs). Voxels inside the body but not inside an organ region are rendered only on the surface, giving a translucent shell. Organ regions (brain, thyroid, heart, lungs, liver, stomach, pancreas, kidneys, intestines) are filled solid with a distinct emissive color and an inner point light.

## Biomarkers shown

| Side  | Marker       | Anchor organ        |
|-------|--------------|---------------------|
| Left  | Cortisol     | Brain · HPA         |
| Left  | TSH          | Thyroid             |
| Left  | hs-CRP       | Heart · Inflammation|
| Left  | ALT          | Liver               |
| Left  | eGFR         | Kidney (L)          |
| Left  | Microbiome   | Gut · Diversity     |
| Right | BDNF         | Brain · Neuro       |
| Right | VO₂ Max      | Lungs               |
| Right | ApoB         | Heart · Lipids      |
| Right | HbA1c        | Pancreas · Glucose  |
| Right | Ferritin     | Stomach · Iron      |
| Right | Vitamin D    | Endocrine           |
