import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================================
// OPTIMAL · Full Body Scan — Neko-style blue halftone body
// Light background → NormalBlending (NOT additive), inverted
// depth cue, regular surface lattice, baked normals, glow from
// CSS multiply (no bloom).
// ============================================================

const SPACING = 0.052;

// ---------- geometry helpers ----------
const sq = (x) => x * x;
function insideSphere(x, y, z, cx, cy, cz, r) { return sq(x-cx)+sq(y-cy)+sq(z-cz) < sq(r); }
function insideEllipsoid(x, y, z, cx, cy, cz, rx, ry, rz) { return sq((x-cx)/rx)+sq((y-cy)/ry)+sq((z-cz)/rz) < 1; }
function insideCyl(x, y, z, ax, ay, az, bx, by, bz, r) {
  const dx=bx-ax, dy=by-ay, dz=bz-az;
  const lenSq=dx*dx+dy*dy+dz*dz;
  const t=((x-ax)*dx+(y-ay)*dy+(z-az)*dz)/lenSq;
  if (t<0 || t>1) return false;
  const px=ax+t*dx, py=ay+t*dy, pz=az+t*dz;
  return sq(x-px)+sq(y-py)+sq(z-pz) < sq(r);
}

// ---------- body silhouette (front-facing +Z, +X = body's left) ----------
function isBody(x, y, z) {
  if (insideEllipsoid(x, y, z, 0, 2.62, -0.02, 0.40, 0.50, 0.42)) return true;   // head
  if (insideEllipsoid(x, y, z, 0, 2.13, 0.02, 0.16, 0.16, 0.15)) return true;    // neck
  if (insideEllipsoid(x, y, z, 0, 1.92, 0, 0.66, 0.12, 0.22)) return true;       // shoulder yoke
  if (insideEllipsoid(x, y, z, 0, 1.45, 0, 0.50, 0.55, 0.26)) return true;       // chest
  if (insideEllipsoid(x, y, z, 0, 0.78, 0, 0.40, 0.22, 0.22)) return true;       // waist
  if (insideEllipsoid(x, y, z, 0, 0.42, 0, 0.48, 0.28, 0.26)) return true;       // pelvis
  if (insideSphere(x, y, z, -0.60, 1.88, 0, 0.20)) return true;                  // shoulders
  if (insideSphere(x, y, z,  0.60, 1.88, 0, 0.20)) return true;
  if (insideCyl(x, y, z, -0.62, 1.85, 0, -0.80, 0.92, 0.04, 0.135)) return true; // upper arms
  if (insideCyl(x, y, z,  0.62, 1.85, 0,  0.80, 0.92, 0.04, 0.135)) return true;
  if (insideSphere(x, y, z, -0.80, 0.92, 0.04, 0.125)) return true;              // elbows
  if (insideSphere(x, y, z,  0.80, 0.92, 0.04, 0.125)) return true;
  if (insideCyl(x, y, z, -0.80, 0.92, 0.04, -0.90, 0.05, 0.05, 0.11)) return true; // forearms
  if (insideCyl(x, y, z,  0.80, 0.92, 0.04,  0.90, 0.05, 0.05, 0.11)) return true;
  if (insideEllipsoid(x, y, z, -0.92, -0.12, 0.05, 0.09, 0.17, 0.07)) return true; // hands
  if (insideEllipsoid(x, y, z,  0.92, -0.12, 0.05, 0.09, 0.17, 0.07)) return true;
  if (insideSphere(x, y, z, -0.28, 0.25, 0, 0.19)) return true;                  // hips
  if (insideSphere(x, y, z,  0.28, 0.25, 0, 0.19)) return true;
  if (insideCyl(x, y, z, -0.27, 0.20, 0, -0.32, -0.95, 0, 0.185)) return true;   // thighs
  if (insideCyl(x, y, z,  0.27, 0.20, 0,  0.32, -0.95, 0, 0.185)) return true;
  if (insideSphere(x, y, z, -0.32, -0.95, 0, 0.165)) return true;                // knees
  if (insideSphere(x, y, z,  0.32, -0.95, 0, 0.165)) return true;
  if (insideCyl(x, y, z, -0.32, -0.95, 0, -0.34, -1.95, 0, 0.14)) return true;   // shins
  if (insideCyl(x, y, z,  0.32, -0.95, 0,  0.34, -1.95, 0, 0.14)) return true;
  if (insideEllipsoid(x, y, z, -0.34, -2.05, 0.10, 0.12, 0.10, 0.20)) return true; // feet
  if (insideEllipsoid(x, y, z,  0.34, -2.05, 0.10, 0.12, 0.10, 0.20)) return true;
  return false;
}

// ---------- build regular surface lattice ----------
const insideSet = new Set();
const keyOf = (xi, yi, zi) => `${xi},${yi},${zi}`;
const xMin=-1.08, xMax=1.08, yMin=-2.25, yMax=3.2, zMin=-0.5, zMax=0.5;

for (let xi=Math.floor(xMin/SPACING); xi<=Math.ceil(xMax/SPACING); xi++)
  for (let yi=Math.floor(yMin/SPACING); yi<=Math.ceil(yMax/SPACING); yi++)
    for (let zi=Math.floor(zMin/SPACING); zi<=Math.ceil(zMax/SPACING); zi++)
      if (isBody(xi*SPACING, yi*SPACING, zi*SPACING)) insideSet.add(keyOf(xi, yi, zi));

const neighborOffsets = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

// outward normal via numeric gradient of occupancy (smoothed), fallback radial-from-axis
function bodyNormal(x, y, z) {
  const h = SPACING * 0.85;
  let nx=0, ny=0, nz=0;
  // 6-axis central differences on the continuous isBody field
  nx = (isBody(x-h,y,z)?1:0) - (isBody(x+h,y,z)?1:0);
  ny = (isBody(x,y-h,z)?1:0) - (isBody(x,y+h,z)?1:0);
  nz = (isBody(x,y,z-h)?1:0) - (isBody(x,y,z+h)?1:0);
  // add diagonal samples for smoother normals
  const d = h;
  const dirs = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
  for (const [ox,oy,oz] of dirs) {
    if (!isBody(x+ox*d, y+oy*d, z+oz*d)) { nx -= ox; ny -= oy; nz -= oz; }
  }
  let len = Math.hypot(nx, ny, nz);
  if (len < 1e-4) { // fallback: radial from central axis
    nx = x; ny = 0; nz = z; len = Math.hypot(nx, ny, nz) || 1;
  }
  return [nx/len, ny/len, nz/len];
}

const positions = [];
const normals = [];
for (const k of insideSet) {
  const [xi, yi, zi] = k.split(',').map(Number);
  // surface only (any empty 6-neighbor)
  let surface = false;
  for (const [dx,dy,dz] of neighborOffsets) {
    if (!insideSet.has(keyOf(xi+dx, yi+dy, zi+dz))) { surface = true; break; }
  }
  if (!surface) continue;
  const x=xi*SPACING, y=yi*SPACING, z=zi*SPACING;
  positions.push(x, y, z);
  const n = bodyNormal(x, y, z);
  normals.push(n[0], n[1], n[2]);
}
const POINT_COUNT = positions.length / 3;

// ============================================================
// Three.js scene
// ============================================================
const container = document.getElementById('canvas-wrap');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(34, window.innerWidth/window.innerHeight, 0.1, 100);
camera.position.set(0, 0.5, 10.6);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.42, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.minDistance = 7.5;
controls.maxDistance = 14.0;
controls.minPolarAngle = Math.PI * 0.32;
controls.maxPolarAngle = Math.PI * 0.62;
controls.enableZoom = true;

// rotating body group
const bodyGroup = new THREE.Group();
scene.add(bodyGroup);

// ---------- halftone point material (NormalBlending) ----------
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
geo.setAttribute('aNormal', new THREE.Float32BufferAttribute(normals, 3));

const bodyMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  depthTest: true,
  blending: THREE.NormalBlending,
  uniforms: {
    uBaseSize:   { value: 0.095 },
    uScale:      { value: renderer.domElement.height * 0.5 },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uNear:       { value: 9.7 },
    uFar:        { value: 11.7 },
    uBlueNear:   { value: new THREE.Color(0.10, 0.28, 0.50) },  // deep cobalt, near rows
    uBlueFar:    { value: new THREE.Color(0.62, 0.72, 0.82) },  // pale dusty, far rows
    uNearAlpha:  { value: 0.92 },
    uFarAlpha:   { value: 0.14 },
    uLightDir:   { value: new THREE.Vector3(0.25, 0.7, 0.66).normalize() },
  },
  vertexShader: /* glsl */`
    attribute vec3 aNormal;
    varying float vDepth;
    varying vec3 vViewNormal;
    uniform float uBaseSize, uScale, uPixelRatio, uNear, uFar;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vViewNormal = normalize(normalMatrix * aNormal);
      vDepth = clamp((-mv.z - uNear) / (uFar - uNear), 0.0, 1.0);
      float size = uBaseSize * (uScale / -mv.z);
      size *= mix(1.0, 0.62, vDepth);
      gl_PointSize = clamp(size * uPixelRatio, 1.0, 16.0);
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
      col = mix(col * 0.78, col, lit);                 // subtle volumetric shading
      float facing = abs(vViewNormal.z);               // rim emphasis
      float a = mix(uNearAlpha, uFarAlpha, vDepth) * mask * mix(1.0, 0.66, facing);
      gl_FragColor = vec4(col, a);
    }
  `,
});

const bodyPoints = new THREE.Points(geo, bodyMat);
bodyGroup.add(bodyPoints);

// ---------- soft contact ellipse at the feet ----------
{
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(90,120,170,0.28)');
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
  'Heart & Circulation': { eyebrow:'ARTERIAL AGE', gaugeNum:44, gaugeCap:'years', gaugeArc:0.62, gaugeColor:'var(--status-monitor)', gaugeDelta:'+1 yr vs. actual', deltaColor:'var(--status-monitor)' },
  'Body':                { eyebrow:'METABOLIC AGE', gaugeNum:29, gaugeCap:'years', gaugeArc:0.42, gaugeColor:'var(--status-optimal)', gaugeDelta:'−4 yrs vs. actual', deltaColor:'var(--status-optimal)' },
  'Skin':                { eyebrow:'SKIN AGE',      gaugeNum:31, gaugeCap:'years', gaugeArc:0.5,  gaugeColor:'var(--status-optimal)', gaugeDelta:'−2 yrs vs. actual', deltaColor:'var(--status-optimal)' },
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

  // calm pendulum turntable — keeps front organs readable
  if (autoRotate) rotPhase += dt * 0.22;
  bodyGroup.rotation.y = Math.sin(rotPhase) * 0.5;
  controls.update();
  bodyGroup.updateMatrixWorld();

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

    // anchor point on the rotating body → screen
    vAnchor.set(...it.m.anchor).applyMatrix4(bodyGroup.matrixWorld);
    vView.copy(camera.position).sub(vAnchor).normalize();      // toward camera
    vAnchor.project(camera);
    const ax = (vAnchor.x + 1) * w / 2;
    const ay = (-vAnchor.y + 1) * h / 2;

    // facing test: radial surface normal rotated into world
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

    // fixed gutter slot
    const sx = it.slotX, sy = it.slotY;
    it.div.style.left = sx + 'px';
    it.div.style.top = sy + 'px';
    it.div.classList.toggle('align-left', it.sideLeft);
    it.div.classList.toggle('align-right', !it.sideLeft);

    // leader: from label inner edge → curve → anchor on body
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
    boot.classList.add('hidden');
    setTimeout(() => boot.remove(), 800);
  }
}
animate();
