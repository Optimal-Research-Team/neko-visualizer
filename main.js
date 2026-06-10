import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

// ============================================================
// OPTIMAL · Full Body Scan — Neko-style blue halftone body.
// A REAL rigged human mesh is loaded, re-posed into Neko's
// arms-down A-pose, then uniformly surface-sampled into a dense
// point cloud. Light background → NormalBlending (not additive),
// inverted depth cue, real mesh normals, glow from CSS multiply.
// Body faces +Z; +X is the body's left.
// ============================================================

// ============================================================
// Three.js scene
// ============================================================
const container = document.getElementById('canvas-wrap');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(34, window.innerWidth/window.innerHeight, 0.1, 100);
camera.position.set(0, 0.48, 11.1);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.43, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.minDistance = 8.0;
controls.maxDistance = 15.0;
controls.minPolarAngle = Math.PI * 0.32;
controls.maxPolarAngle = Math.PI * 0.62;
controls.enableZoom = true;

// rotating body group
const bodyGroup = new THREE.Group();
scene.add(bodyGroup);

// ---------- halftone point material (NormalBlending) ----------
const bodyMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  depthTest: true,
  blending: THREE.NormalBlending,
  uniforms: {
    uBaseSize:   { value: 0.036 },
    uScale:      { value: renderer.domElement.height * 0.5 },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uNear:       { value: 10.4 },
    uFar:        { value: 12.4 },
    uBlueNear:   { value: new THREE.Color(0.08, 0.25, 0.47) },  // deep cobalt, near
    uBlueFar:    { value: new THREE.Color(0.60, 0.70, 0.81) },  // pale dusty, far
    uNearAlpha:  { value: 0.95 },
    uFarAlpha:   { value: 0.11 },
    uLightDir:   { value: new THREE.Vector3(0.28, 0.66, 0.70).normalize() },
  },
  vertexShader: /* glsl */`
    attribute vec3 aNormal;
    attribute float aSize;
    varying float vDepth;
    varying vec3 vViewNormal;
    uniform float uBaseSize, uScale, uPixelRatio, uNear, uFar;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vViewNormal = normalize(normalMatrix * aNormal);
      vDepth = clamp((-mv.z - uNear) / (uFar - uNear), 0.0, 1.0);
      float size = uBaseSize * aSize * (uScale / -mv.z);
      size *= mix(1.0, 0.6, vDepth);
      gl_PointSize = clamp(size * uPixelRatio, 1.0, 12.0);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */`
    varying float vDepth;
    varying vec3 vViewNormal;
    uniform vec3 uBlueNear, uBlueFar, uLightDir;
    uniform float uNearAlpha, uFarAlpha;
    void main() {
      vec2 uv = gl_PointCoord - 0.5;
      float d = length(uv);
      float mask = smoothstep(0.5, 0.38, d);
      if (mask < 0.01) discard;
      vec3 col = mix(uBlueNear, uBlueFar, vDepth);
      float lit = clamp(dot(normalize(vViewNormal), uLightDir) * 0.5 + 0.5, 0.0, 1.0);
      col = mix(col * 0.78, col, lit);
      float facing = abs(vViewNormal.z);
      float a = mix(uNearAlpha, uFarAlpha, vDepth) * mask * mix(1.0, 0.66, facing);
      gl_FragColor = vec4(col, a);
    }
  `,
});

let bodyPoints = null;
let bodyReady = false;

// ---------- soft contact ellipse at the feet ----------
{
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(90,120,170,0.26)');
  g.addColorStop(1, 'rgba(90,120,170,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.NormalBlending });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.1), mat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -2.18;
  scene.add(shadow);
}

// ============================================================
// Load real human, re-pose to A-pose, surface-sample to points
// ============================================================
const MODEL_URL = './assets/xbot.glb';
const CELL = 0.028;         // halftone lattice spacing (world units)
const ARM_DROP = 1.24;      // radians the upper arms swing down from T-pose
const FLIP = false;         // set true if the figure faces away from camera
const TARGET_HEIGHT = 5.04;
const FEET_Y = -2.08;

const loader = new GLTFLoader();
loader.load(MODEL_URL, onModelLoaded, undefined, (err) => {
  console.error('model load failed', err);
  const boot = document.getElementById('boot');
  if (boot) boot.classList.add('hidden');
});

function findBone(bones, includes, excludes = []) {
  for (const name in bones) {
    const l = name.toLowerCase();
    if (includes.every(s => l.includes(s)) && excludes.every(s => !l.includes(s))) return bones[name];
  }
  return null;
}

function onModelLoaded(gltf) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  const bones = {};
  const skinned = [];
  root.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isSkinnedMesh) skinned.push(o);
  });

  // --- re-pose: swing the upper arms down into an A-pose. Compute the
  //     swing axis from the actual bone world positions so it works
  //     regardless of the rig's bind frame. ---
  const La = findBone(bones, ['leftarm'], ['fore']);
  const Ra = findBone(bones, ['rightarm'], ['fore']);
  const Lf = findBone(bones, ['leftforearm']);
  const Rf = findBone(bones, ['rightforearm']);
  console.log('bones found:', Object.keys(bones).length, 'arms:', !!La, !!Ra, !!Lf, !!Rf);
  const DOWN = new THREE.Vector3(0, -1, 0);
  function dropArm(upper, elbow, angle) {
    if (!upper || !elbow) return;
    const a = new THREE.Vector3().setFromMatrixPosition(upper.matrixWorld);
    const b = new THREE.Vector3().setFromMatrixPosition(elbow.matrixWorld);
    const dir = b.sub(a).normalize();
    const axis = new THREE.Vector3().crossVectors(dir, DOWN).normalize();
    if (axis.lengthSq() < 1e-6) return;     // already vertical
    upper.rotateOnWorldAxis(axis, angle);
    upper.updateMatrixWorld(true);
  }
  dropArm(La, Lf, ARM_DROP);
  dropArm(Ra, Rf, ARM_DROP);
  root.updateMatrixWorld(true);

  // --- bake each posed skinned mesh into its own geometry (kept separate
  //     so the parts can be UNIONED correctly via per-part inside tests) ---
  const v = new THREE.Vector3();
  const bakedList = [];
  for (const mesh of skinned) {
    mesh.updateMatrixWorld(true);
    const src = mesh.geometry;
    const pos = src.attributes.position;
    const arr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      mesh.applyBoneTransform(i, v);     // apply current (A-pose) skinning
      arr[i*3] = v.x; arr[i*3+1] = v.y; arr[i*3+2] = v.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    if (src.index) g.setIndex(src.index.clone());
    bakedList.push(g);
  }

  // combined bbox; correct up-axis if Z-up; then fit to target space
  const whole = new THREE.Box3();
  for (const g of bakedList) { g.computeBoundingBox(); whole.union(g.boundingBox); }
  let size = new THREE.Vector3(); whole.getSize(size);
  if (size.z > size.y * 1.3) {
    for (const g of bakedList) g.rotateX(-Math.PI / 2);
    whole.makeEmpty();
    for (const g of bakedList) { g.computeBoundingBox(); whole.union(g.boundingBox); }
    whole.getSize(size);
  }
  const s = TARGET_HEIGHT / size.y;
  const cx = (whole.min.x + whole.max.x) / 2, cz = (whole.min.z + whole.max.z) / 2, minY = whole.min.y;
  const rmeshes = [];
  for (const g of bakedList) {
    const a = g.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) {
      let X = (a[i]-cx)*s, Y = (a[i+1]-minY)*s + FEET_Y, Z = (a[i+2]-cz)*s;
      if (FLIP) { X = -X; Z = -Z; }
      a[i] = X; a[i+1] = Y; a[i+2] = Z;
    }
    g.attributes.position.needsUpdate = true;
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.updateMatrixWorld(true);
    rmeshes.push(m);
  }

  // --- scanline-voxelize the UNION into a regular halftone lattice.
  //     One ray per (y,z) line; a cell is solid if it's inside ANY part
  //     (odd crossings). This fills every gap and absorbs joint balls. ---
  const xMin=-1.1, xMax=1.1, yMin=FEET_Y-0.05, yMax=FEET_Y+TARGET_HEIGHT+0.06, zMin=-0.62, zMax=0.62;
  const NX = Math.ceil((xMax-xMin)/CELL)+1, NY = Math.ceil((yMax-yMin)/CELL)+1, NZ = Math.ceil((zMax-zMin)/CELL)+1;
  const gi = (i,j,k) => (i*NY+j)*NZ+k;
  const inside = new Uint8Array(NX*NY*NZ);
  const ray = new THREE.Raycaster(); ray.far = (xMax-xMin)+0.4;
  const o = new THREE.Vector3(), d = new THREE.Vector3(1,0,0);
  for (let j = 0; j < NY; j++) {
    const Y = yMin + j*CELL;
    for (let k = 0; k < NZ; k++) {
      const Z = zMin + k*CELL;
      o.set(xMin-0.2, Y, Z); ray.set(o, d);
      const partXs = [];
      for (const m of rmeshes) {
        const hits = ray.intersectObject(m, false);
        if (hits.length) partXs.push(hits.map(h => h.point.x));   // sorted by distance = ascending x
      }
      if (!partXs.length) continue;
      for (let i = 0; i < NX; i++) {
        const X = xMin + i*CELL;
        let ins = false;
        for (const xs of partXs) { let c = 0; for (let t = 0; t < xs.length; t++) { if (xs[t] < X) c++; else break; } if (c & 1) { ins = true; break; } }
        if (ins) inside[gi(i,j,k)] = 1;
      }
    }
  }

  // --- surface extraction + smoothed occupancy-gradient normals ---
  const dirs26 = [];
  for (let dx=-1;dx<=1;dx++) for (let dy=-1;dy<=1;dy++) for (let dz=-1;dz<=1;dz++) if (dx||dy||dz) dirs26.push([dx,dy,dz]);
  const positions = [], normals = [], sizes = [];
  for (let i = 1; i < NX-1; i++) for (let j = 1; j < NY-1; j++) for (let k = 1; k < NZ-1; k++) {
    if (!inside[gi(i,j,k)]) continue;
    if (inside[gi(i-1,j,k)]&&inside[gi(i+1,j,k)]&&inside[gi(i,j-1,k)]&&inside[gi(i,j+1,k)]&&inside[gi(i,j,k-1)]&&inside[gi(i,j,k+1)]) continue;
    let nx=0, ny=0, nz=0;
    for (const [dx,dy,dz] of dirs26) {
      const ii=i+dx, jj=j+dy, kk=k+dz;
      if (ii<0||jj<0||kk<0||ii>=NX||jj>=NY||kk>=NZ || !inside[gi(ii,jj,kk)]) { nx+=dx; ny+=dy; nz+=dz; }
    }
    const nl = Math.hypot(nx,ny,nz) || 1;
    positions.push(xMin+i*CELL, yMin+j*CELL, zMin+k*CELL);
    normals.push(nx/nl, ny/nl, nz/nl);
    sizes.push(0.78 + Math.random()*0.5);
  }
  console.log('lattice points', positions.length/3);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aNormal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  bodyPoints = new THREE.Points(geo, bodyMat);
  bodyGroup.add(bodyPoints);
  bodyReady = true;
}

// ============================================================
// Biomarker markers (grouped)  — anchor & labelPos in body space
// ============================================================
const MARKERS = [
  // ---- Heart & Circulation ----
  { g:'Heart & Circulation', name:'ApoB',          value:'78',     unit:'mg/dL', range:'<80 optimal',  status:'optimal', anchor:[0.05,1.62,0.20],  labelPos:[1.42,1.78,0.42] },
  { g:'Heart & Circulation', name:'Lp(a)',         value:'92',     unit:'nmol/L',range:'<75 optimal',  status:'monitor', anchor:[0.17,1.50,0.18],  labelPos:[1.5,1.18,0.40] },
  { g:'Heart & Circulation', name:'Resting HR',    value:'62',     unit:'bpm',   range:'50–70 optimal',status:'optimal', anchor:[0.05,1.60,0.19],  labelPos:[-1.42,1.78,0.42] },
  { g:'Heart & Circulation', name:'hs-CRP',        value:'0.8',    unit:'mg/L',  range:'<1.0 low',     status:'optimal', anchor:[-0.02,1.42,0.21], labelPos:[-1.5,1.18,0.40] },
  { g:'Heart & Circulation', name:'VO₂ Max',       value:'44',     unit:'mL/kg', range:'≥42 excellent',status:'optimal', anchor:[0.30,1.72,0.14],  labelPos:[1.55,2.34,0.34] },
  { g:'Heart & Circulation', name:'Blood Pressure',value:'118/76', unit:'mmHg',  range:'<120/80',      status:'optimal', anchor:[-0.40,1.30,0.20], labelPos:[-1.55,0.5,0.40] },

  // ---- Body ----
  { g:'Body', name:'HbA1c',          value:'5.4',  unit:'%',      range:'<5.7 optimal',  status:'optimal', anchor:[0.0,0.90,0.18],   labelPos:[1.46,1.02,0.42] },
  { g:'Body', name:'Fasting Glucose',value:'97',   unit:'mg/dL',  range:'70–99 optimal', status:'monitor', anchor:[0.05,0.84,0.18],  labelPos:[1.52,0.42,0.40] },
  { g:'Body', name:'ALT',            value:'26',   unit:'U/L',    range:'<30 optimal',   status:'optimal', anchor:[-0.20,1.05,0.20], labelPos:[-1.46,1.18,0.42] },
  { g:'Body', name:'eGFR',           value:'96',   unit:'mL/min', range:'≥90 optimal',   status:'optimal', anchor:[-0.24,0.78,0.14], labelPos:[-1.5,0.55,0.40] },
  { g:'Body', name:'TSH',            value:'2.1',  unit:'mIU/L',  range:'0.4–2.5',       status:'optimal', anchor:[0.0,2.05,0.18],   labelPos:[1.5,2.18,0.34] },
  { g:'Body', name:'Ferritin',       value:'38',   unit:'ng/mL',  range:'30–150',        status:'optimal', anchor:[0.22,1.00,0.18],  labelPos:[1.55,1.58,0.40] },
  { g:'Body', name:'Vitamin D',      value:'28',   unit:'ng/mL',  range:'40–60 optimal', status:'monitor', anchor:[0.20,0.60,0.16],  labelPos:[1.52,-0.12,0.40] },
  { g:'Body', name:'Cortisol AM',    value:'18',   unit:'µg/dL',  range:'6–18 (AM)',     status:'high',    anchor:[-0.20,0.60,0.16], labelPos:[-1.5,-0.05,0.40] },
  { g:'Body', name:'Body Fat',       value:'19',   unit:'%',      range:'11–21 optimal', status:'optimal', anchor:[0.0,0.50,0.24],   labelPos:[-1.46,-0.66,0.40] },

  // ---- Skin ----
  { g:'Skin', name:'Lesion Scan',    value:'0',    unit:'flagged',range:'0 atypical',    status:'optimal', anchor:[0.42,1.78,0.14],  labelPos:[1.5,2.0,0.34] },
  { g:'Skin', name:'Surface Area',   value:'1.81', unit:'m²',     range:'mapped',        status:'optimal', anchor:[0.18,1.30,0.24],  labelPos:[1.52,1.1,0.42] },
  { g:'Skin', name:'Microcirc.',     value:'Normal',unit:'perf.', range:'normal',        status:'optimal', anchor:[0.88,0.40,0.10],  labelPos:[1.55,0.3,0.40] },
  { g:'Skin', name:'Hydration',      value:'54',   unit:'%',      range:'45–60 optimal', status:'optimal', anchor:[-0.40,1.55,0.16], labelPos:[-1.5,1.5,0.40] },
  { g:'Skin', name:'Thermal Map',    value:'36.6', unit:'°C',     range:'even',          status:'optimal', anchor:[-0.30,0.80,0.20], labelPos:[-1.5,0.55,0.40] },
];

const GROUP_META = {
  'Heart & Circulation': {
    eyebrow:'ARTERIAL AGE', gaugeNum:44, gaugeCap:'years', gaugeArc:0.62, gaugeColor:'var(--status-monitor)', gaugeDelta:'+1 yr vs. actual', deltaColor:'var(--status-monitor)',
    substats:[{v:'360+',l:'Pulse waves'},{v:'120+',l:'Heart sound'},{v:'ECG',l:'Rhythm'}],
    scaleLabel:'INFLAMMATION · hs-CRP', scaleMarker:16, scaleTicks:['Optimal','Mild','High'],
  },
  'Body': {
    eyebrow:'METABOLIC AGE', gaugeNum:29, gaugeCap:'years', gaugeArc:0.42, gaugeColor:'var(--status-optimal)', gaugeDelta:'−4 yrs vs. actual', deltaColor:'var(--status-optimal)',
    substats:[{v:'16',l:'Bloodwork'},{v:'10',l:'Measures'},{v:'5.4%',l:'HbA1c'}],
    scaleLabel:'GLUCOSE · HbA1c', scaleMarker:26, scaleTicks:['Optimal','Raised','High'],
  },
  'Skin': {
    eyebrow:'SKIN AGE', gaugeNum:31, gaugeCap:'years', gaugeArc:0.5, gaugeColor:'var(--status-optimal)', gaugeDelta:'−2 yrs vs. actual', deltaColor:'var(--status-optimal)',
    substats:[{v:'2000+',l:'Surface img'},{v:'12',l:'Thermal'},{v:'2.5mm',l:'Tissue'}],
    scaleLabel:'UV EXPOSURE · index', scaleMarker:22, scaleTicks:['Low','Moderate','High'],
  },
};

const STATUS_HEX = { optimal:'#5E8C6A', monitor:'#C99A4E', high:'#C2614F' };
const STATUS_LABEL = { optimal:'Optimal', monitor:'Monitor', high:'Elevated' };

// ---------- build DOM annotations + SVG leaders ----------
const labelsEl = document.getElementById('labels');
const leadersEl = document.getElementById('leaders');
const SVGNS = 'http://www.w3.org/2000/svg';
const items = [];

for (const m of MARKERS) {
  const div = document.createElement('div');
  div.className = 'annot';
  div.dataset.status = m.status;
  div.innerHTML = `
    <div class="annot-name">${m.name}</div>
    <div class="annot-value">${m.value}<span class="annot-unit">${m.unit}</span></div>
    <div class="annot-meta">
      <span class="annot-status">${STATUS_LABEL[m.status]}</span>
      <span class="annot-range">${m.range}</span>
    </div>`;
  labelsEl.appendChild(div);

  const hex = STATUS_HEX[m.status];
  const path = document.createElementNS(SVGNS, 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'rgba(38,44,46,0.18)');
  path.setAttribute('stroke-width', '1');
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  leadersEl.appendChild(path);

  const ring = document.createElementNS(SVGNS, 'circle');
  ring.setAttribute('r', '5'); ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke', hex); ring.setAttribute('stroke-width', '1');
  ring.setAttribute('stroke-opacity', '0.5');
  leadersEl.appendChild(ring);

  const dot = document.createElementNS(SVGNS, 'circle');
  dot.setAttribute('r', '2.6'); dot.setAttribute('fill', hex);
  leadersEl.appendChild(dot);

  items.push({ m, div, path, ring, dot, group: m.g });
}

// ============================================================
// Group nav
// ============================================================
let activeGroup = 'Heart & Circulation';
const groupButtons = [...document.querySelectorAll('.group')];
const countEl = document.getElementById('measuring-count');
const gaugeArcEl = document.getElementById('gauge-arc');
const gaugeNumEl = document.getElementById('gauge-num');
const gaugeCapEl = document.querySelector('.gauge-cap');
const gaugeEyebrowEl = document.getElementById('gauge-eyebrow');
const gaugeDeltaEl = document.getElementById('gauge-delta');
const substatsEl = document.getElementById('substats');
const scaleLabelEl = document.getElementById('scale-label');
const scaleMarkerEl = document.getElementById('scale-marker');
const scaleTicksEl = document.querySelector('.scale-ticks');
const GAUGE_CIRC = 2 * Math.PI * 66;

function setGroup(g) {
  activeGroup = g;
  groupButtons.forEach(b => b.classList.toggle('active', b.dataset.group === g));
  countEl.textContent = MARKERS.filter(m => m.g === g).length;
  const meta = GROUP_META[g];
  gaugeEyebrowEl.textContent = meta.eyebrow;
  gaugeNumEl.textContent = meta.gaugeNum;
  gaugeCapEl.textContent = meta.gaugeCap;
  gaugeArcEl.style.stroke = meta.gaugeColor;
  gaugeArcEl.style.strokeDashoffset = GAUGE_CIRC * (1 - meta.gaugeArc);
  gaugeDeltaEl.textContent = meta.gaugeDelta;
  gaugeDeltaEl.style.color = meta.deltaColor;
  substatsEl.innerHTML = meta.substats.map(s =>
    `<div class="substat"><div class="substat-v">${s.v}</div><div class="substat-l">${s.l}</div></div>`).join('');
  scaleLabelEl.textContent = meta.scaleLabel;
  scaleMarkerEl.style.left = meta.scaleMarker + '%';
  scaleTicksEl.innerHTML = meta.scaleTicks.map(t => `<span>${t}</span>`).join('');
  layoutSlots();
}
groupButtons.forEach(b => b.addEventListener('click', () => setGroup(b.dataset.group)));

// ---------- fixed gutter slot layout for the active group ----------
function layoutSlots() {
  const w = window.innerWidth, h = window.innerHeight;
  const leftX = Math.max(180, w * 0.28);
  const rightX = Math.min(w - 210, w * 0.72);
  const top = h * 0.15, bot = h * 0.60;
  const active = items.filter(it => it.group === activeGroup);
  const left = active.filter(it => it.m.labelPos[0] < 0).sort((p, q) => q.m.anchor[1] - p.m.anchor[1]);
  const right = active.filter(it => it.m.labelPos[0] >= 0).sort((p, q) => q.m.anchor[1] - p.m.anchor[1]);
  const place = (arr, x, sideLeft) => arr.forEach((it, i) => {
    it.slotX = x;
    it.slotY = arr.length === 1 ? (top + bot) / 2 : top + (bot - top) * i / (arr.length - 1);
    it.sideLeft = sideLeft;
  });
  place(left, leftX, true);
  place(right, rightX, false);
}

// initialise gauge dash + first group
gaugeArcEl.style.strokeDasharray = GAUGE_CIRC;
gaugeArcEl.style.strokeDashoffset = GAUGE_CIRC;
setTimeout(() => setGroup('Heart & Circulation'), 200);

// ============================================================
// Interaction: gentle auto-rotate, pause on drag
// ============================================================
let autoRotate = true;
let resumeTimer;
controls.addEventListener('start', () => { autoRotate = false; clearTimeout(resumeTimer); });
controls.addEventListener('end', () => { clearTimeout(resumeTimer); resumeTimer = setTimeout(() => autoRotate = true, 3000); });

// ============================================================
// Resize
// ============================================================
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  bodyMat.uniforms.uScale.value = renderer.domElement.height * 0.5;
  bodyMat.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  leadersEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
  leadersEl.setAttribute('width', w); leadersEl.setAttribute('height', h);
  layoutSlots();
}
window.addEventListener('resize', onResize);
onResize();

// ============================================================
// Animate
// ============================================================
const clock = new THREE.Clock();
const vAnchor = new THREE.Vector3();
const vNormal = new THREE.Vector3();
const vView = new THREE.Vector3();
let rotPhase = 0;
let booted = false;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (autoRotate) rotPhase += dt * 0.2;
  bodyGroup.rotation.y = Math.sin(rotPhase) * 0.34;
  controls.update();
  bodyGroup.updateMatrixWorld();

  if (!bodyReady) { renderer.render(scene, camera); return; }

  const w = window.innerWidth, h = window.innerHeight;

  for (const it of items) {
    const isActive = it.group === activeGroup;
    if (!isActive) {
      if (it.div.style.visibility !== 'hidden') {
        it.div.style.visibility = 'hidden';
        it.path.style.opacity = it.ring.style.opacity = it.dot.style.opacity = 0;
      }
      continue;
    }

    vAnchor.set(...it.m.anchor).applyMatrix4(bodyGroup.matrixWorld);
    vView.copy(camera.position).sub(vAnchor).normalize();
    vAnchor.project(camera);
    const ax = (vAnchor.x + 1) * w / 2;
    const ay = (-vAnchor.y + 1) * h / 2;

    vNormal.set(it.m.anchor[0], 0, it.m.anchor[2]);
    if (vNormal.lengthSq() < 1e-5) vNormal.set(0, 0, 1);
    vNormal.normalize().applyQuaternion(bodyGroup.quaternion);
    const facing = vNormal.dot(vView);
    const vis = Math.max(0, Math.min(1, (facing + 0.05) * 1.7));

    it.div.style.visibility = 'visible';
    it.div.style.opacity = vis;
    it.path.style.opacity = vis * 0.9;
    it.ring.style.opacity = vis * 0.55;
    it.dot.style.opacity = vis;

    const sx = it.slotX, sy = it.slotY;
    it.div.style.left = sx + 'px';
    it.div.style.top = sy + 'px';
    it.div.classList.toggle('align-left', it.sideLeft);
    it.div.classList.toggle('align-right', !it.sideLeft);

    const ex = sx + (it.sideLeft ? 89 : -89);
    const ey = sy;
    const cx = ex + (ax - ex) * 0.55;
    it.path.setAttribute('d', `M ${ex.toFixed(1)} ${ey.toFixed(1)} Q ${cx.toFixed(1)} ${ey.toFixed(1)} ${ax.toFixed(1)} ${ay.toFixed(1)}`);
    it.ring.setAttribute('cx', ax); it.ring.setAttribute('cy', ay);
    it.dot.setAttribute('cx', ax); it.dot.setAttribute('cy', ay);
  }

  renderer.render(scene, camera);

  if (!booted) {
    booted = true;
    const boot = document.getElementById('boot');
    if (boot) { boot.classList.add('hidden'); setTimeout(() => boot.remove(), 800); }
  }
}
animate();
