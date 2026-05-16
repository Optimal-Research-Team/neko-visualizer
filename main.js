import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const SPACING = 0.055;
const POINT_SIZE = 0.085;
const ORGAN_POINT_SIZE = 0.11;

// ----- Geometry helpers -----
const sq = (x) => x * x;

function insideSphere(x, y, z, cx, cy, cz, r) {
  return sq(x - cx) + sq(y - cy) + sq(z - cz) < sq(r);
}

function insideEllipsoid(x, y, z, cx, cy, cz, rx, ry, rz) {
  return sq((x - cx) / rx) + sq((y - cy) / ry) + sq((z - cz) / rz) < 1;
}

function insideCyl(x, y, z, ax, ay, az, bx, by, bz, r) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const lenSq = dx * dx + dy * dy + dz * dz;
  let t = ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / lenSq;
  if (t < 0 || t > 1) return false;
  const px = ax + t * dx, py = ay + t * dy, pz = az + t * dz;
  return sq(x - px) + sq(y - py) + sq(z - pz) < sq(r);
}

// ----- Body silhouette -----
function isBody(x, y, z) {
  // Head
  if (insideEllipsoid(x, y, z, 0, 2.62, -0.02, 0.42, 0.5, 0.43)) return true;
  // Neck
  if (insideEllipsoid(x, y, z, 0, 2.13, 0.02, 0.17, 0.16, 0.16)) return true;
  // Trapezius / shoulder yoke
  if (insideEllipsoid(x, y, z, 0, 1.92, 0, 0.66, 0.12, 0.22)) return true;
  // Torso - chest + abs
  if (insideEllipsoid(x, y, z, 0, 1.45, 0, 0.52, 0.55, 0.27)) return true;
  // Waist taper
  if (insideEllipsoid(x, y, z, 0, 0.78, 0, 0.42, 0.2, 0.23)) return true;
  // Pelvis
  if (insideEllipsoid(x, y, z, 0, 0.42, 0, 0.5, 0.28, 0.27)) return true;
  // Shoulders
  if (insideSphere(x, y, z, -0.6, 1.88, 0, 0.21)) return true;
  if (insideSphere(x, y, z, 0.6, 1.88, 0, 0.21)) return true;
  // Upper arms
  if (insideCyl(x, y, z, -0.62, 1.85, 0, -0.78, 0.92, 0.04, 0.14)) return true;
  if (insideCyl(x, y, z, 0.62, 1.85, 0, 0.78, 0.92, 0.04, 0.14)) return true;
  // Elbows
  if (insideSphere(x, y, z, -0.78, 0.92, 0.04, 0.13)) return true;
  if (insideSphere(x, y, z, 0.78, 0.92, 0.04, 0.13)) return true;
  // Forearms
  if (insideCyl(x, y, z, -0.78, 0.92, 0.04, -0.88, 0.05, 0.05, 0.12)) return true;
  if (insideCyl(x, y, z, 0.78, 0.92, 0.04, 0.88, 0.05, 0.05, 0.12)) return true;
  // Hands
  if (insideEllipsoid(x, y, z, -0.9, -0.12, 0.05, 0.1, 0.17, 0.08)) return true;
  if (insideEllipsoid(x, y, z, 0.9, -0.12, 0.05, 0.1, 0.17, 0.08)) return true;
  // Hips
  if (insideSphere(x, y, z, -0.28, 0.25, 0, 0.2)) return true;
  if (insideSphere(x, y, z, 0.28, 0.25, 0, 0.2)) return true;
  // Upper legs
  if (insideCyl(x, y, z, -0.27, 0.2, 0, -0.32, -0.95, 0, 0.2)) return true;
  if (insideCyl(x, y, z, 0.27, 0.2, 0, 0.32, -0.95, 0, 0.2)) return true;
  // Knees
  if (insideSphere(x, y, z, -0.32, -0.95, 0, 0.18)) return true;
  if (insideSphere(x, y, z, 0.32, -0.95, 0, 0.18)) return true;
  // Shins
  if (insideCyl(x, y, z, -0.32, -0.95, 0, -0.34, -1.95, 0, 0.15)) return true;
  if (insideCyl(x, y, z, 0.32, -0.95, 0, 0.34, -1.95, 0, 0.15)) return true;
  // Feet
  if (insideEllipsoid(x, y, z, -0.34, -2.05, 0.1, 0.13, 0.1, 0.2)) return true;
  if (insideEllipsoid(x, y, z, 0.34, -2.05, 0.1, 0.13, 0.1, 0.2)) return true;
  return false;
}

// ----- Organ atlas -----
const ORGANS = {
  brain:     { color: 0xB57CFF, intensity: 1.4 },
  thyroid:   { color: 0xFF8FCB, intensity: 1.2 },
  heart:     { color: 0xFF5566, intensity: 1.8 },
  lung:      { color: 0x7CC9FF, intensity: 1.1 },
  liver:     { color: 0xFFA85B, intensity: 1.3 },
  stomach:   { color: 0xC4F26B, intensity: 1.0 },
  pancreas:  { color: 0xFFE45C, intensity: 1.15 },
  kidney:    { color: 0x7CF5C1, intensity: 1.25 },
  intestine: { color: 0xE07CFF, intensity: 1.0 },
};

function getOrgan(x, y, z) {
  // Brain - inside head
  if (insideEllipsoid(x, y, z, 0, 2.68, -0.04, 0.32, 0.38, 0.32)) return 'brain';
  // Thyroid - front of neck
  if (insideEllipsoid(x, y, z, 0, 2.05, 0.1, 0.1, 0.06, 0.06)) return 'thyroid';
  // Heart - chest, anatomically slightly left (positive X = body's left, since body faces +Z)
  if (insideEllipsoid(x, y, z, 0.06, 1.6, 0.04, 0.16, 0.2, 0.14)) return 'heart';
  // Lungs - flanking heart
  if (insideEllipsoid(x, y, z, -0.26, 1.6, 0, 0.2, 0.32, 0.18)) return 'lung';
  if (insideEllipsoid(x, y, z, 0.28, 1.55, -0.02, 0.18, 0.3, 0.17) &&
      !insideEllipsoid(x, y, z, 0.06, 1.6, 0.04, 0.16, 0.2, 0.14)) return 'lung';
  // Liver - upper right abdomen (body's right = -X)
  if (insideEllipsoid(x, y, z, -0.2, 1.05, 0.05, 0.26, 0.2, 0.18)) return 'liver';
  // Stomach - upper left
  if (insideEllipsoid(x, y, z, 0.2, 1.0, 0.0, 0.16, 0.16, 0.13)) return 'stomach';
  // Pancreas - center, behind stomach
  if (insideEllipsoid(x, y, z, 0.0, 0.88, -0.06, 0.22, 0.06, 0.08)) return 'pancreas';
  // Kidneys - posterior, sides
  if (insideEllipsoid(x, y, z, -0.24, 0.78, -0.14, 0.08, 0.16, 0.08)) return 'kidney';
  if (insideEllipsoid(x, y, z, 0.24, 0.78, -0.14, 0.08, 0.16, 0.08)) return 'kidney';
  // Intestines
  if (insideEllipsoid(x, y, z, 0, 0.45, 0.05, 0.35, 0.22, 0.2)) return 'intestine';
  return null;
}

// ----- Build voxel sets -----
const insideSet = new Set();
const keyOf = (xi, yi, zi) => `${xi},${yi},${zi}`;

const xMin = -1.05, xMax = 1.05;
const yMin = -2.2, yMax = 3.2;
const zMin = -0.5, zMax = 0.5;

for (let xi = Math.floor(xMin / SPACING); xi <= Math.ceil(xMax / SPACING); xi++) {
  for (let yi = Math.floor(yMin / SPACING); yi <= Math.ceil(yMax / SPACING); yi++) {
    for (let zi = Math.floor(zMin / SPACING); zi <= Math.ceil(zMax / SPACING); zi++) {
      if (isBody(xi * SPACING, yi * SPACING, zi * SPACING)) insideSet.add(keyOf(xi, yi, zi));
    }
  }
}

const bodyVoxels = [];
const organVoxelsByName = {};
for (const o of Object.keys(ORGANS)) organVoxelsByName[o] = [];

const neighborOffsets = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

for (const k of insideSet) {
  const [xi, yi, zi] = k.split(',').map(Number);
  const x = xi * SPACING, y = yi * SPACING, z = zi * SPACING;

  const organ = getOrgan(x, y, z);
  if (organ) {
    organVoxelsByName[organ].push([x, y, z]);
    continue;
  }

  // Surface check: keep voxel if it has any neighbor outside body
  let isSurface = false;
  for (const [dx, dy, dz] of neighborOffsets) {
    if (!insideSet.has(keyOf(xi + dx, yi + dy, zi + dz))) { isSurface = true; break; }
  }
  if (!isSurface) continue;

  // Keep ALL surface voxels for a dense fuzzy shell, plus a sparse interior sample
  // (interior voxels are added in a separate pass below)
  bodyVoxels.push([x, y, z]);
}

// Sparse interior voxels for body solidity
for (const k of insideSet) {
  const [xi, yi, zi] = k.split(',').map(Number);
  const x = xi * SPACING, y = yi * SPACING, z = zi * SPACING;
  if (getOrgan(x, y, z)) continue;
  // Check if this voxel is fully interior (all 6 neighbors inside)
  let isInterior = true;
  for (const [dx, dy, dz] of neighborOffsets) {
    if (!insideSet.has(keyOf(xi + dx, yi + dy, zi + dz))) { isInterior = false; break; }
  }
  if (!isInterior) continue;
  if (Math.random() < 0.12) bodyVoxels.push([x, y, z]);
}

// ----- Three.js scene -----
const container = document.getElementById('canvas-wrap');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x040810, 0.08);

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0.5, 7.8);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 5.0;
controls.maxDistance = 10.0;
controls.minPolarAngle = Math.PI * 0.3;
controls.maxPolarAngle = Math.PI * 0.65;
controls.enablePan = false;
controls.autoRotate = false;

// Lights
scene.add(new THREE.AmbientLight(0x3a4868, 0.5));

const keyLight = new THREE.DirectionalLight(0x9bb5ff, 1.1);
keyLight.position.set(3, 4, 4);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xff7cb5, 0.6);
rimLight.position.set(-3, 1, -3);
scene.add(rimLight);

const fillLight = new THREE.DirectionalLight(0x7cf5c1, 0.3);
fillLight.position.set(0, -2, 3);
scene.add(fillLight);

// Soft dot texture for the point cloud
function makeDotTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.25)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}
const dotTex = makeDotTexture();

// Rotating body group so labels can be anchored in world space and follow the body
const bodyGroup = new THREE.Group();
scene.add(bodyGroup);

// Body point cloud — white/blue-tinted with stochastic alpha per point
{
  const N = bodyVoxels.length;
  const positions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);
  const sizes = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const [x, y, z] = bodyVoxels[i];
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
    // Mostly white with slight cool tint, occasional brighter point
    const warm = Math.random();
    const r = 0.78 + warm * 0.22;
    const g = 0.86 + warm * 0.14;
    const b = 0.96 + warm * 0.04;
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
    sizes[i] = POINT_SIZE * (0.5 + Math.random() * 0.8);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const bodyMat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: dotTex },
      uOpacity: { value: 0.55 },
      uPixelRatio: { value: renderer.getPixelRatio() },
    },
    vertexShader: `
      attribute float aSize;
      varying vec3 vColor;
      uniform float uPixelRatio;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * 300.0 * uPixelRatio / -mv.z;
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform float uOpacity;
      varying vec3 vColor;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        if (t.a < 0.02) discard;
        gl_FragColor = vec4(vColor, t.a * uOpacity);
      }
    `,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const bodyPoints = new THREE.Points(geo, bodyMat);
  bodyGroup.add(bodyPoints);
}

// Organ point clouds — colored, brighter, slightly larger points
const organMeshes = {};
const organCenters = {};

for (const [name, props] of Object.entries(ORGANS)) {
  const voxels = organVoxelsByName[name];
  if (!voxels.length) continue;

  const N = voxels.length;
  const positions = new Float32Array(N * 3);
  const sizes = new Float32Array(N);
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < N; i++) {
    const [x, y, z] = voxels[i];
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
    sizes[i] = ORGAN_POINT_SIZE * (0.7 + Math.random() * 0.7);
    cx += x; cy += y; cz += z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: dotTex },
      uColor: { value: new THREE.Color(props.color) },
      uIntensity: { value: props.intensity },
      uPixelRatio: { value: renderer.getPixelRatio() },
    },
    vertexShader: `
      attribute float aSize;
      uniform float uPixelRatio;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * 320.0 * uPixelRatio / -mv.z;
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      uniform float uIntensity;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        if (t.a < 0.02) discard;
        gl_FragColor = vec4(uColor * uIntensity, t.a * 0.85);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geo, mat);
  bodyGroup.add(points);
  organMeshes[name] = points;
  organCenters[name] = [cx / N, cy / N, cz / N];

  // Inner point light (also follows the rotating body)
  const light = new THREE.PointLight(props.color, 0.55, 1.4, 2);
  light.position.set(...organCenters[name]);
  bodyGroup.add(light);
}

// Outline ring + halo at base
const ringGeo = new THREE.RingGeometry(1.2, 1.35, 96);
const ringMat = new THREE.MeshBasicMaterial({
  color: 0x4fb2ff,
  transparent: true,
  opacity: 0.25,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
});
const ring = new THREE.Mesh(ringGeo, ringMat);
ring.rotation.x = -Math.PI / 2;
ring.position.y = -2.15;
scene.add(ring);

const ring2Mat = new THREE.MeshBasicMaterial({
  color: 0x7cf5c1, transparent: true, opacity: 0.4, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
});
const ring2 = new THREE.Mesh(new THREE.RingGeometry(1.42, 1.46, 96), ring2Mat);
ring2.rotation.x = -Math.PI / 2;
ring2.position.y = -2.15;
scene.add(ring2);

// Background star particles
{
  const N = 240;
  const positions = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 4 + Math.random() * 6;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi) * 0.6;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta) - 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.025, color: 0x6a8acb, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  scene.add(new THREE.Points(geo, mat));
}

// Scan plane (slow horizontal sweep with edge glow)
const scanMat = new THREE.ShaderMaterial({
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  uniforms: {
    uColor: { value: new THREE.Color(0x7cf5c1) },
    uOpacity: { value: 0.45 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    varying vec2 vUv;
    uniform vec3 uColor;
    uniform float uOpacity;
    void main() {
      float d = abs(vUv.y - 0.5);
      float band = smoothstep(0.5, 0.0, d);
      float pulse = pow(band, 6.0);
      float radial = smoothstep(0.5, 0.0, length(vUv - 0.5));
      float a = pulse * radial * uOpacity;
      gl_FragColor = vec4(uColor, a);
    }
  `,
});
const scanPlane = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.12), scanMat);
scanPlane.rotation.x = -Math.PI / 2;
scene.add(scanPlane);

// Subtle vertical orbit lines
{
  const lineMat = new THREE.LineBasicMaterial({ color: 0x4fb2ff, transparent: true, opacity: 0.18 });
  for (let i = 0; i < 3; i++) {
    const pts = [];
    const radius = 1.35;
    const tilt = (i - 1) * 0.2;
    for (let a = 0; a <= Math.PI * 2; a += 0.04) {
      pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius * 0.15 + tilt, Math.sin(a) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.LineLoop(geo, lineMat);
    line.position.y = 0.5;
    line.rotation.z = (i - 1) * 0.18;
    scene.add(line);
  }
}

// Post-processing
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.45, 0.35, 0.5);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// ----- Biomarker labels -----
// labelPos is absolute world position; anchor is the point on the body the leader line draws to.
const BIOMARKERS = [
  // LEFT column (top → bottom)
  { name: 'Cortisol',  value: '14.2', unit: 'μg/dL',     organ: 'BRAIN · HPA',        anchor: [-0.1, 2.78, 0.2],  labelPos: [-1.85, 2.05, 0.3], status: 'optimal', range: 0.55, delta: '−6%' },
  { name: 'TSH',       value: '1.84', unit: 'mIU/L',     organ: 'THYROID',            anchor: [-0.05, 2.1, 0.18], labelPos: [-1.9, 1.4, 0.3], status: 'optimal', range: 0.45, delta: '−2%' },
  { name: 'hs-CRP',    value: '0.6',  unit: 'mg/L',      organ: 'INFLAMMATION',       anchor: [-0.26, 1.55, 0.2], labelPos: [-1.95, 0.75, 0.3], status: 'optimal', range: 0.2,  delta: '−18%' },
  { name: 'ALT',       value: '24',   unit: 'U/L',       organ: 'LIVER',              anchor: [-0.2, 1.05, 0.22], labelPos: [-1.95, 0.1, 0.3], status: 'optimal', range: 0.4,  delta: '−1%' },
  { name: 'eGFR',      value: '96',   unit: 'mL/min',    organ: 'KIDNEY · L',         anchor: [-0.24, 0.78, -0.05], labelPos: [-1.95, -0.55, 0.3], status: 'optimal', range: 0.66, delta: '+1%' },
  { name: 'Microbiome',value: '7.8',  unit: 'index',     organ: 'GUT · DIVERSITY',    anchor: [-0.1, 0.42, 0.22], labelPos: [-1.9, -1.2, 0.3], status: 'optimal', range: 0.78, delta: '+12%' },

  // RIGHT column (top → bottom)
  { name: 'BDNF',      value: '28.4', unit: 'ng/mL',     organ: 'BRAIN · NEURO',      anchor: [0.1, 2.7, 0.2],    labelPos: [1.45, 2.05, 0.3], status: 'optimal', range: 0.72, delta: '+11%' },
  { name: 'VO₂ Max',   value: '52',   unit: 'mL/kg/min', organ: 'LUNGS',              anchor: [0.28, 1.78, 0.18], labelPos: [1.5, 1.4, 0.3], status: 'optimal', range: 0.78, delta: '+4%' },
  { name: 'ApoB',      value: '78',   unit: 'mg/dL',     organ: 'HEART · LIPIDS',     anchor: [0.08, 1.62, 0.2],  labelPos: [1.55, 0.75, 0.3], status: 'optimal', range: 0.42, delta: '−9%' },
  { name: 'HbA1c',     value: '5.2',  unit: '%',         organ: 'PANCREAS · GLUCOSE', anchor: [0.05, 0.88, 0.08], labelPos: [1.55, 0.1, 0.3], status: 'optimal', range: 0.38, delta: '−3%' },
  { name: 'Ferritin',  value: '142',  unit: 'ng/mL',     organ: 'STOMACH · IRON',     anchor: [0.18, 1.0, 0.15],  labelPos: [1.55, -0.55, 0.3], status: 'optimal', range: 0.55, delta: '+8%' },
  { name: 'Vitamin D', value: '38',   unit: 'ng/mL',     organ: 'ENDOCRINE',          anchor: [0.24, 0.78, -0.05],labelPos: [1.55, -1.2, 0.3], status: 'watch',   range: 0.52, delta: '−5%' },
];

const labelsContainer = document.getElementById('labels');
const leadersSvg = document.getElementById('leaders');
const labelElements = [];

const statusColors = { optimal: '#7CF5C1', watch: '#F2C57C', action: '#F26B7A' };
const statusLabels = { optimal: 'Optimal', watch: 'Monitor', action: 'Action' };

for (const bm of BIOMARKERS) {
  const div = document.createElement('div');
  div.className = 'biomarker';
  div.dataset.status = bm.status;
  div.innerHTML = `
    <div class="biomarker-card">
      <div class="biomarker-row">
        <div class="biomarker-name">${bm.name}</div>
        <div class="biomarker-organ">${bm.organ}</div>
      </div>
      <div class="biomarker-value">${bm.value}<span class="biomarker-unit">${bm.unit}</span></div>
      <div class="biomarker-bar">
        <div class="biomarker-bar-track"></div>
        <div class="biomarker-bar-fill" style="width:${Math.round(bm.range * 100)}%"></div>
      </div>
      <div class="biomarker-meta">
        <div class="biomarker-status">${statusLabels[bm.status]}</div>
        <div class="biomarker-delta">90d ${bm.delta}</div>
      </div>
    </div>
  `;
  labelsContainer.appendChild(div);

  const lineColor = statusColors[bm.status];

  const linePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  linePath.setAttribute('stroke', lineColor);
  linePath.setAttribute('stroke-width', '1');
  linePath.setAttribute('fill', 'none');
  linePath.setAttribute('stroke-opacity', '0.45');
  linePath.setAttribute('stroke-linecap', 'round');
  leadersSvg.appendChild(linePath);

  const dotOuter = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dotOuter.setAttribute('r', '6');
  dotOuter.setAttribute('fill', 'none');
  dotOuter.setAttribute('stroke', lineColor);
  dotOuter.setAttribute('stroke-opacity', '0.5');
  dotOuter.setAttribute('stroke-width', '1');
  leadersSvg.appendChild(dotOuter);

  const dotInner = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dotInner.setAttribute('r', '2.5');
  dotInner.setAttribute('fill', lineColor);
  leadersSvg.appendChild(dotInner);

  labelElements.push({ div, linePath, dotOuter, dotInner, data: bm });
}

// Resize
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloomPass.setSize(w, h);
  leadersSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  leadersSvg.setAttribute('width', w);
  leadersSvg.setAttribute('height', h);
}
window.addEventListener('resize', onResize);
onResize();

// Disable auto-rotate on interaction
let arTimeout;
controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(arTimeout); });
controls.addEventListener('end', () => { clearTimeout(arTimeout); arTimeout = setTimeout(() => controls.autoRotate = true, 3500); });

// ----- Animate -----
const clock = new THREE.Clock();
const v3a = new THREE.Vector3();
const v3b = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();

  controls.update();

  // Continuous slow rotation of the body group
  bodyGroup.rotation.y = t * 0.18;

  // Scan plane sweep
  const scanY = -2.0 + ((t * 0.5) % 5.2);
  scanPlane.position.y = scanY;
  scanPlane.position.x = 0; scanPlane.position.z = 0;

  // Organ breathing pulse via shader uniform
  for (const [name, mesh] of Object.entries(organMeshes)) {
    const seed = name.charCodeAt(0) * 0.03;
    const pulse = 1.0 + Math.sin(t * 1.8 + seed) * 0.22;
    mesh.material.uniforms.uIntensity.value = ORGANS[name].intensity * pulse;
  }

  // Heart special — extra throb
  if (organMeshes.heart) {
    const beat = Math.pow(Math.max(0, Math.sin(t * 4.2)), 6) * 0.9 + 1.0;
    organMeshes.heart.material.uniforms.uIntensity.value = ORGANS.heart.intensity * beat;
  }

  // Ring rotation
  ring.rotation.z = t * 0.1;
  ring2.rotation.z = -t * 0.06;

  // Update labels — both label and anchor live in body-group space, so they orbit with the body.
  bodyGroup.updateMatrixWorld();
  for (const item of labelElements) {
    const { div, linePath, dotOuter, dotInner, data } = item;

    // Label world position (attached to rotating body group)
    v3a.set(data.labelPos[0], data.labelPos[1], data.labelPos[2]);
    v3a.applyMatrix4(bodyGroup.matrixWorld);
    const labelWorldZ = v3a.z;
    v3a.project(camera);
    const labelX = (v3a.x + 1) * window.innerWidth / 2;
    const labelY = (-v3a.y + 1) * window.innerHeight / 2;

    // Anchor world position (also attached to rotating body group)
    v3b.set(data.anchor[0], data.anchor[1], data.anchor[2]);
    v3b.applyMatrix4(bodyGroup.matrixWorld);
    v3b.project(camera);
    const anchorX = (v3b.x + 1) * window.innerWidth / 2;
    const anchorY = (-v3b.y + 1) * window.innerHeight / 2;

    // Visibility: fade as label orbits behind the body (labelWorldZ < 0 means behind body axis).
    const visibility = Math.max(0, Math.min(1, (labelWorldZ + 0.6) * 1.6));

    div.style.left = labelX + 'px';
    div.style.top = labelY + 'px';
    div.style.opacity = visibility;

    // Curved leader path with elbow near card
    const isRight = labelX > anchorX;
    const cardEdge = isRight ? -90 : 90;
    const lineEndX = labelX + cardEdge;
    const lineEndY = labelY;
    const ctrlX = anchorX + (lineEndX - anchorX) * 0.55;
    const ctrlY = anchorY;
    const path = `M ${anchorX} ${anchorY} Q ${ctrlX} ${ctrlY} ${lineEndX} ${lineEndY}`;
    linePath.setAttribute('d', path);
    linePath.setAttribute('stroke-opacity', visibility * 0.55);

    dotOuter.setAttribute('cx', anchorX);
    dotOuter.setAttribute('cy', anchorY);
    dotOuter.setAttribute('stroke-opacity', visibility * 0.6);
    dotInner.setAttribute('cx', anchorX);
    dotInner.setAttribute('cy', anchorY);
    dotInner.setAttribute('opacity', visibility * 0.95);
  }

  composer.render();
}
animate();
