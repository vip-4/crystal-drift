/* CRYSTAL DRIFT — lightweight 3D crystal-runner (Three.js + Blender GLB assets) */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const canvas = document.getElementById("game-canvas");
const audioCtx = (typeof AudioContext !== "undefined" && new AudioContext()) || null;

// ---- tiny blip synth (no assets needed, keeps the bundle light) ----
function blip(freq = 660, dur = 0.09, type = "triangle", vol = 0.05) {
  if (!audioCtx || audioCtx.state === "suspended") return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(); o.stop(audioCtx.currentTime + dur);
}

const GAME = {
  running: false,
  over: false,
  score: 0,
  lives: 3,
  speed: 14,
  t: 0,
  spawnT: 0,
  crystalT: 0,
};

const ui = {
  score: document.getElementById("score"),
  lives: document.getElementById("lives"),
  start: document.getElementById("start-overlay"),
  over: document.getElementById("gameover-overlay"),
  final: document.getElementById("final-score"),
  best: document.getElementById("best-score"),
};

/* ---------- renderer / scene ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b14);
scene.fog = new THREE.Fog(0x070b14, 30, 95);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 2.4, 7.4);

// lights
const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x2a1b33, 0.9);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff3d6, 1.6);
key.position.set(6, 10, 6);
scene.add(key);
const rim = new THREE.DirectionalLight(0x55e6ff, 0.8);
rim.position.set(-8, 2, -6);
scene.add(rim);

// starfield
const starGeo = new THREE.BufferGeometry();
const starCount = 1600;
const pos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  pos[i * 3] = (Math.random() - 0.5) * 240;
  pos[i * 3 + 1] = (Math.random() - 0.5) * 140;
  pos[i * 3 + 2] = -Math.random() * 180 - 10;
}
starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
const starMat = new THREE.PointsMaterial({ color: 0xbfdcff, size: 0.16, sizeAttenuation: true, transparent: true, opacity: 0.85 });
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);

/* ---------- assets ---------- */
const loader = new GLTFLoader();
let ship = null;
let planet = null;
const meteors = [];
const crystals = [];
const models = { crystal: null, meteor: null };

const ASSET = (f) => new URL(`assets/${f}`, document.baseURI).href;

function loadGLB(url) {
  return new Promise((res, rej) => loader.load(url, res, undefined, rej));
}

async function init() {
  const [s, c, m, p] = await Promise.all([
    loadGLB(ASSET("ship.glb")),
    loadGLB(ASSET("crystal.glb")),
    loadGLB(ASSET("meteor.glb")),
    loadGLB(ASSET("planet.glb")),
  ]);
  models.crystal = c.scene;
  models.meteor = m.scene;

  ship = s.scene;
  ship.scale.setScalar(1.0);
  ship.rotation.y = Math.PI / 2; // nose (+X in Blender) now faces -Z
  ship.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  const shipGroup = new THREE.Group();
  shipGroup.add(ship);
  scene.add(shipGroup);

  // distant planet backdrop
  planet = p.scene;
  planet.scale.setScalar(16);
  planet.position.set(42, 16, -90);
  scene.add(planet);

  // ambient drifting asteroids already-visible
  for (let i = 0; i < 4; i++) {
    const mInst = models.meteor.clone();
    mInst.position.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 8, -20 - Math.random() * 30);
    mInst.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    const scale = 0.7 + Math.random() * 1.4;
    mInst.scale.setScalar(scale);
    scene.add(mInst);
    meteors.push({ obj: mInst, r: scale * 0.55 });
  }

  ui.start.hidden = false;
  document.getElementById("status").textContent = "assets loaded";
}

/* ---------- input ---------- */
const input = { up: false, down: false, left: false, right: false };
let targetX = 0, targetY = 0;
let dragActive = false, lastPX = 0, lastPY = 0;

addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const k = e.code;
  if (k === "ArrowUp" || k === "KeyW") input.up = true;
  if (k === "ArrowDown" || k === "KeyS") input.down = true;
  if (k === "ArrowLeft" || k === "KeyA") input.left = true;
  if (k === "ArrowRight" || k === "KeyD") input.right = true;
  if (k === "Space") e.preventDefault();
});
addEventListener("keyup", (e) => {
  const k = e.code;
  if (k === "ArrowUp" || k === "KeyW") input.up = false;
  if (k === "ArrowDown" || k === "KeyS") input.down = false;
  if (k === "ArrowLeft" || k === "KeyA") input.left = false;
  if (k === "ArrowRight" || k === "KeyD") input.right = false;
});

canvas.addEventListener("pointerdown", (e) => {
  dragActive = true; lastPX = e.clientX; lastPY = e.clientY;
});
addEventListener("pointermove", (e) => {
  if (!dragActive) return;
  targetX -= (e.clientX - lastPX) * 0.025;
  targetY += (e.clientY - lastPY) * 0.025;
  lastPX = e.clientX; lastPY = e.clientY;
  targetX = clamp(targetX, -9, 9);
  targetY = clamp(targetY, -4.5, 4.5);
});
addEventListener("pointerup", () => (dragActive = false));

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* ---------- spawning ---------- */
function spawnMeteor() {
  const m = models.meteor.clone();
  const scale = 0.8 + Math.random() * 1.8;
  m.scale.setScalar(scale);
  m.position.set((Math.random() - 0.5) * 26, (Math.random() - 0.5) * 10, -110);
  m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  scene.add(m);
  meteors.push({ obj: m, r: scale * 0.6 });
}

function spawnCrystal() {
  if (!models.crystal) return;
  const c = models.crystal.clone();
  c.scale.setScalar(0.9);
  c.position.set((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 9, -115);
  scene.add(c);
  crystals.push(c);
}

/* ---------- game control ---------- */
function startGame() {
  if (!ship) return;
  GAME.running = true;
  GAME.over = false;
  GAME.score = 0;
  GAME.lives = 3;
  GAME.speed = 14;
  GAME.t = 0; GAME.spawnT = 0; GAME.crystalT = 0;
  targetX = 0; targetY = 0;
  win();
  ui.start.hidden = true;
  ui.over.hidden = true;
  updateHud();
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  blip(520, 0.15);
}

function gameOver() {
  GAME.over = true;
  GAME.running = false;
  ui.final.textContent = GAME.score;
  const best = Math.max(+(localStorage.getItem("crystal-drift-best") || 0), GAME.score);
  localStorage.setItem("crystal-drift-best", best);
  ui.best.textContent = best;
  ui.over.hidden = false;
  blip(220, 0.3, "sawtooth", 0.08);
}

function updateHud() {
  ui.score.textContent = GAME.score;
  const dots = ui.lives.querySelectorAll("i");
  dots.forEach((d, i) => d.classList.toggle("off", i >= GAME.lives));
}

function addScore() {
  GAME.score += 10;
  GAME.speed = Math.min(14 + Math.floor(GAME.score / 100) * 1.2, 30);
  blip(720, 0.07);
}

/* ---------- loop ---------- */
const clock = new THREE.Clock();
let zPos = 0;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (GAME.running) {
    GAME.t += dt;
    zPos -= GAME.speed * dt;

    // steering
    const steerSpeed = 3.2;
    if (input.left) targetX = clamp(targetX - steerSpeed * dt * 4, -9, 9);
    if (input.right) targetX = clamp(targetX + steerSpeed * dt * 4, -9, 9);
    if (input.up) targetY = clamp(targetY + steerSpeed * dt * 4, -4.5, 4.5);
    if (input.down) targetY = clamp(targetY - steerSpeed * dt * 4, -4.5, 4.5);
    if (dragActive) { /* target set by pointer */ }

    // move ship toward target (relative to its z-band)
    const py = ship.parent.position.y;
    const px = ship.parent.position.x;
    ship.parent.position.x = lerp(px, targetX, 1 - Math.pow(0.001, dt));
    ship.parent.position.y = lerp(py, targetY, 1 - Math.pow(0.001, dt));
    ship.parent.position.z = zPos;

    // ship banking for feel
    const dxLocal = targetX - ship.parent.position.x;
    ship.rotation.z = lerp(ship.rotation.z, -dxLocal * 0.18, 0.1);
    ship.rotation.x = lerp(ship.rotation.x, (targetY - ship.parent.position.y) * 0.18, 0.1);

    // spawning
    GAME.spawnT -= dt;
    if (GAME.spawnT <= 0) {
      spawnMeteor();
      GAME.spawnT = Math.max(0.42, 1.15 - GAME.score / 3000);
    }
    GAME.crystalT -= dt;
    if (GAME.crystalT <= 0) {
      spawnCrystal();
      GAME.crystalT = 0.9 + Math.random() * 0.8;
    }

    // advance meteors/crystals toward player
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.obj.position.z += (GAME.speed + 9) * dt;
      m.obj.rotation.x += dt; m.obj.rotation.y += dt * 0.8;
      // collision
      const d = m.obj.position.distanceTo(ship.parent.position);
      if (d < m.r + 0.6) {
        scene.remove(m.obj);
        meteors.splice(i, 1);
        GAME.lives -= 1;
        blip(160, 0.2, "sawtooth", 0.09);
        if (GAME.lives <= 0) {
          updateHud();
          gameOver();
          GAME.running = false;
          return;
        }
        updateHud();
        continue;
      }
      if (m.obj.position.z > 18) { scene.remove(m.obj); meteors.splice(i, 1); }
    }
    for (let i = crystals.length - 1; i >= 0; i--) {
      const c = crystals[i];
      c.position.z += (GAME.speed - 4) * dt;
      c.rotation.y += dt * 1.5;
      const d = c.position.distanceTo(ship.parent.position);
      if (d < 1.1) {
        scene.remove(c);
        crystals.splice(i, 1);
        addScore();
        updateHud();
        continue;
      }
      if (c.position.z > 18) { scene.remove(c); crystals.splice(i, 1); }
    }
  }

  // ambient animation always
  stars.rotation.y += dt * 0.002;
  if (planet) planet.rotation.y += dt * 0.02;
  meteors.forEach((m) => { if (!GAME.running) { m.obj.rotation.x += dt; } });

  // camera trails the ship
  const shipPos = ship ? ship.parent.position : new THREE.Vector3(0, 0, zPos);
  camera.position.x = lerp(camera.position.x, shipPos.x * 0.6, 0.04);
  camera.position.y = lerp(camera.position.y, shipPos.y * 0.45 + 2.2, 0.04);
  camera.position.z = shipPos.z + 7.4;
  camera.lookAt(shipPos.x * 0.9, shipPos.y * 0.7, shipPos.z - 12);

  renderer.render(scene, camera);
}

function lerp(a, b, t) { return a + (b - a) * t; }
function win() { if (typeof window !== "undefined" && window.layoutViewport === undefined) {} }

/* ---------- wiring ---------- */
document.getElementById("btn-start").addEventListener("click", startGame);
document.getElementById("btn-restart").addEventListener("click", startGame);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// prevent space/arrow scrolling on the game page
addEventListener("keydown", (e) => {
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
});

document.getElementById("status").textContent = "loading 3D assets…";
init().then(() => undefined).catch((err) => {
  document.getElementById("status").textContent = "assets failed: " + err.message;
});
tick();
