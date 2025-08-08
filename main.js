import * as THREE from 'https://unpkg.com/three@0.160.1/build/three.module.js';
import { FontLoader } from 'https://unpkg.com/three@0.160.1/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'https://unpkg.com/three@0.160.1/examples/jsm/geometries/TextGeometry.js';

// --- Game Config ---
const GRID_SIZE = 7;
const CELL_SIZE = 1.2; // world units
const LINE_WIDTH = 0.06;
const P1_COLOR = 0x4f9cff; // blue
const P2_COLOR = 0xff6b6b; // red

// --- State ---
const State = {
  mode: 'menu', // 'menu' | 'game'
  singlePlayer: false,
  currentPlayer: 1, // 1 or 2
  pickLetter: 'S', // 'S' or 'O'
  board: Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill('')),
  scores: { 1: 0, 2: 0 },
  remaining: GRID_SIZE * GRID_SIZE,
  gameOver: false,
  soundOn: true,
  musicOn: true,
};

// --- Three.js Setup ---
const canvas = document.getElementById('three');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0); // transparent to show CSS animated background

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
const cameraTarget = new THREE.Vector3(0, 0, 0);
camera.position.set(0, 7.5, 10.5);
camera.lookAt(cameraTarget);
// Zoom state
let zoomFactor = 1; // 1 = default, <1 closer, >1 farther
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.0;
let baseScaleGlobal = 1; // updated on resize
function applyCameraScale() {
  camera.position.set(0, 7.5 * baseScaleGlobal * zoomFactor, 10.5 * baseScaleGlobal * zoomFactor);
}
function setZoom(z) {
  zoomFactor = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
  applyCameraScale();
}

// lights
scene.add(new THREE.AmbientLight(0xffffff, 0.9));
const dir = new THREE.DirectionalLight(0xffffff, 0.6);
dir.position.set(3, 5, 4);
scene.add(dir);

// plane background grid holder
const root = new THREE.Group();
scene.add(root);

// Raycaster for input
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// Geometry caches
const cellGeom = new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE);
cellGeom.rotateX(-Math.PI / 2);

// Materials
const baseCellMat = new THREE.MeshStandardMaterial({ color: 0x151822, metalness: 0.1, roughness: 0.9 });
const hoverMat = new THREE.MeshStandardMaterial({ color: 0x1f2433, metalness: 0.1, roughness: 0.85 });
// base neutral colors (unused for letters now, kept for potential UI)
const sColor = new THREE.Color('#e8e8ea');
const oColor = new THREE.Color('#cfd3e6');

// Text
const loader = new FontLoader();
let font;

// Cell data
const cells = []; // {mesh, i, j, letterMesh}
// Pinch tracking (we'll integrate into existing onPointerMove later in file)
const pointers = new Map(); // id -> {x,y}
let pinching = false;
let pinchStartDist = 0;
let zoomStart = 1;

// --- Ambient Music (non-droning synth fallback) ---
let padNodes = null; // { timers: number[], baseGain: GainNode }

function scheduleArpNote(ctx, dest, freq, when, dur, vol, type='sine') {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, when);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(vol, when + 0.02);
  const end = when + dur;
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  o.connect(g).connect(dest);
  o.start(when);
  o.stop(end + 0.02);
}

function startPadFallback() {
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  const baseGain = ctx.createGain();
  baseGain.gain.value = 0.45; // louder overall music level for mobile
  baseGain.connect(ctx.destination);

  // gentle lowpass to keep it soft
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1800;
  lp.Q.value = 0.4;
  lp.connect(baseGain);

  // simple 4-chord ambient loop (Amin – F – C – G)
  const chords = [
    [220.00, 261.63, 329.63],  // A3, C4, E4
    [174.61, 220.00, 261.63],  // F3, A3, C4
    [196.00, 246.94, 329.63],  // G3 (as walk), B3, E4 (C flavour)
    [196.00, 246.94, 293.66],  // G3, B3, D4
  ];
  let chordIndex = 0;
  const beat = 0.42; // seconds per step (slightly slower)
  let step = 0;
  const timers = [];

  // animate filter a little
  const filterTimer = setInterval(()=>{
    const t = ctx.currentTime;
    const target = 1400 + 400*Math.sin(t*0.08);
    lp.frequency.setTargetAtTime(target, t, 0.6);
  }, 600);
  timers.push(filterTimer);

  function loopTick() {
    if (!padNodes) return; // stopped
    const t0 = ctx.currentTime + 0.05;
    const chord = chords[chordIndex];
    // pick 2 short notes from the chord, sometimes add a soft high harmonic
    const root = chord[0], mid = chord[1], top = chord[2];
    const pattern = [root, mid, top, mid];
    const pick1 = pattern[(step) % pattern.length];
    const pick2 = pattern[(step+2) % pattern.length];
    // schedule two staggered plucks
    scheduleArpNote(ctx, lp, pick1, t0, 0.28, 0.085, 'sine');
    scheduleArpNote(ctx, lp, pick2, t0 + beat*0.5, 0.25, 0.075, 'triangle');
    // occasional airy overtone at low volume
    if ((step % 8) === 4) {
      scheduleArpNote(ctx, lp, top*2, t0 + beat*0.25, 0.22, 0.035, 'sine');
    }
    step++;
    if (step % 8 === 0) {
      chordIndex = (chordIndex + 1) % chords.length;
    }
  }

  // run the loop
  loopTick();
  const seqTimer = setInterval(loopTick, beat*1000);
  timers.push(seqTimer);

  padNodes = { timers, baseGain };
}

function stopPadFallback() {
  if (!padNodes) return;
  const { timers, baseGain } = padNodes;
  timers.forEach(id => { try { clearInterval(id); } catch {} });
  try {
    const ctx = ensureAudioCtx();
    const now = ctx ? ctx.currentTime : 0;
    if (baseGain && baseGain.gain) baseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
  } catch {}
  padNodes = null;
}

function startBGM() {
  if (!State.musicOn || State.mode !== 'game') return;
  // Prefer file if available
  if (bgmEl && !bgmError) {
    try {
      bgmEl.currentTime = 0;
      bgmEl.volume = 0.8; // boost for mobile
      bgmEl.play().then(()=>{/* ok */}).catch(()=>{ startPadFallback(); });
      return;
    } catch { /* fallthrough */ }
  }
  // fallback synth
  startPadFallback();
}

function stopBGM() {
  if (bgmEl) { try { bgmEl.pause(); } catch {} }
  stopPadFallback();
}

// Lines for scored SOS
const lineGroup = new THREE.Group();
scene.add(lineGroup);

function buildBoard() {
  // grid frame lines
  const frame = new THREE.Group();
  const gridMat = new THREE.LineBasicMaterial({ color: 0x30364a, linewidth: 1 });
  const half = (GRID_SIZE * CELL_SIZE) / 2;
  for (let r = 0; r <= GRID_SIZE; r++) {
    const z = r * CELL_SIZE - half;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-half, 0.001, z),
      new THREE.Vector3(half, 0.001, z),
    ]);
    frame.add(new THREE.Line(geo, gridMat));
  }
  for (let c = 0; c <= GRID_SIZE; c++) {
    const x = c * CELL_SIZE - half;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0.001, -half),
      new THREE.Vector3(x, 0.001, half),
    ]);
    frame.add(new THREE.Line(geo, gridMat));
  }
  root.add(frame);

  // cells
  for (let i = 0; i < GRID_SIZE; i++) {
    for (let j = 0; j < GRID_SIZE; j++) {
      const mesh = new THREE.Mesh(cellGeom, baseCellMat.clone());
      mesh.position.set(j * CELL_SIZE - (GRID_SIZE - 1) * CELL_SIZE / 2, 0, i * CELL_SIZE - (GRID_SIZE - 1) * CELL_SIZE / 2);
      mesh.userData = { i, j };
      mesh.receiveShadow = true;
      root.add(mesh);
      cells.push({ mesh, i, j, letterMesh: null });
    }
  }
}

function createLetter(letter, player) {
  const size = 0.52;
  const height = 0.06;
  const playerColor = new THREE.Color(player===1 ? P1_COLOR : P2_COLOR);
  const mat = new THREE.MeshStandardMaterial({ color: playerColor, metalness: 0.2, roughness: 0.4 });
  const geo = new TextGeometry(letter, { font, size, height, curveSegments: 6, bevelEnabled: false });
  geo.center();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.05;
  return mesh;
}

function updateHUD() {
  document.getElementById('p1Score').textContent = String(State.scores[1]);
  document.getElementById('p2Score').textContent = String(State.scores[2]);
  document.getElementById('turnLabel').textContent = State.currentPlayer === 1 ? 'Player 1' : (State.singlePlayer ? 'AI' : 'Player 2');
  document.getElementById('pickS').classList.toggle('active', State.pickLetter === 'S');
  document.getElementById('pickO').classList.toggle('active', State.pickLetter === 'O');
  const sb = document.getElementById('soundBtn');
  if (sb) { sb.setAttribute('aria-pressed', String(State.soundOn)); sb.textContent = `Sound: ${State.soundOn? 'On':'Off'}`; }
  const mb = document.getElementById('musicBtn');
  if (mb) { mb.setAttribute('aria-pressed', String(State.musicOn)); mb.textContent = `Music: ${State.musicOn? 'On':'Off'}`; }
}

let audioCtx = null;
let pacdotReady = false;
let pacdotError = false;
const pacEl = document.getElementById('pacdot');
// BGM element flags
let bgmReady = false;
let bgmError = false;
const bgmEl = document.getElementById('bgm');
if (pacEl) {
  pacEl.addEventListener('canplaythrough', ()=>{ pacdotReady = true; }, { once: true });
  pacEl.addEventListener('error', ()=>{ pacdotError = true; }, { once: true });
  try { pacEl.volume = 0.9; } catch {}
}
if (bgmEl) {
  bgmEl.addEventListener('canplaythrough', ()=>{ bgmReady = true; }, { once: true });
  bgmEl.addEventListener('error', ()=>{ bgmError = true; }, { once: true });
}

function ensureAudioCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(()=>{});
  }
  return audioCtx;
}

function beepFallback() {
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  // Soft, modern two-note chime with quick decay
  const now = ctx.currentTime;
  const main = ctx.createOscillator();
  const overtone = ctx.createOscillator();
  const gain = ctx.createGain();
  main.type = 'sine';
  overtone.type = 'triangle';
  main.frequency.setValueAtTime(880, now);        // A5
  overtone.frequency.setValueAtTime(1320, now);   // E6-ish overtone
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.2, now + 0.01); // attack louder
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2); // decay
  main.connect(gain);
  overtone.connect(gain);
  gain.connect(ctx.destination);
  main.start(now);
  overtone.start(now);
  // Second quick blip slightly higher
  const blip = ctx.createOscillator();
  blip.type = 'sine';
  blip.frequency.setValueAtTime(988, now + 0.12); // B5
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.0001, now + 0.12);
  g2.gain.exponentialRampToValueAtTime(0.14, now + 0.13);
  g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
  blip.connect(g2).connect(ctx.destination);
  blip.start(now + 0.12);
  // stop
  main.stop(now + 0.25);
  overtone.stop(now + 0.25);
  blip.stop(now + 0.3);
}

function playScoreSound() {
  if (!State.soundOn) return;
  const el = pacEl;
  if (el && !pacdotError) {
    // if not really ready, fallback
    if (!pacdotReady && el.readyState < 2) {
      beepFallback();
      return;
    }
    try {
      el.currentTime = 0;
      const p = el.play();
      if (p && p.catch) p.catch(()=>{ beepFallback(); });
    } catch { beepFallback(); }
  } else {
    beepFallback();
  }
}

function checkSOSAt(i, j) {
  // returns array of sequences: each is [{i,j},{i,j},{i,j}] and direction
  const res = [];
  const dirs = [
    [0,1], [1,0], [1,1], [1,-1]
  ];
  const inB = (r,c)=> r>=0 && r<GRID_SIZE && c>=0 && c<GRID_SIZE;
  for (const [di,dj] of dirs) {
    // center 'O' case: (i,j) could be O, check S-O-S around
    if (State.board[i][j] === 'O') {
      const a = [i-di, j-dj];
      const b = [i+di, j+dj];
      if (inB(a[0],a[1]) && inB(b[0],b[1]) && State.board[a[0]][a[1]]==='S' && State.board[b[0]][b[1]]==='S') {
        res.push([{i:a[0],j:a[1]},{i,j},{i:b[0],j:b[1]}]);
      }
    }
    // starting 'S' case: (i,j) is S, check S-O-S forward
    if (State.board[i][j] === 'S') {
      const mid = [i+di, j+dj];
      const end = [i+2*di, j+2*dj];
      if (inB(mid[0],mid[1]) && inB(end[0],end[1]) && State.board[mid[0]][mid[1]]==='O' && State.board[end[0]][end[1]]==='S') {
        res.push([{i,j},{i:mid[0],j:mid[1]},{i:end[0],j:end[1]}]);
      }
      // ending 'S' case: (i,j) is S and completes ... O S (backward)
      const midB = [i-di, j-dj];
      const startB = [i-2*di, j-2*dj];
      if (inB(midB[0],midB[1]) && inB(startB[0],startB[1]) && State.board[midB[0]][midB[1]]==='O' && State.board[startB[0]][startB[1]]==='S') {
        res.push([{i:startB[0],j:startB[1]},{i:midB[0],j:midB[1]},{i,j}]);
      }
    }
  }
  return res;
}

function drawLineThrough(seq, color) {
  // seq is length 3 of grid coords, draw a line in world space
  const toWorld = (r,c)=> new THREE.Vector3(
    c * CELL_SIZE - (GRID_SIZE - 1) * CELL_SIZE / 2,
    0.12,
    r * CELL_SIZE - (GRID_SIZE - 1) * CELL_SIZE / 2,
  );
  const a = toWorld(seq[0].i, seq[0].j);
  const c = toWorld(seq[2].i, seq[2].j);
  const geo = new THREE.BufferGeometry().setFromPoints([a, c]);
  const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
  const line = new THREE.Line(geo, mat);
  lineGroup.add(line);
}

function indexOfCellMesh(mesh) {
  return cells.findIndex(c=>c.mesh===mesh);
}

let hoverCell = null;
function onPointerMove(e) {
  // Update pinch pointers if present
  if (pointers.has(e.pointerId)) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  if (pinching && pointers.size >= 2) {
    // Handle pinch zoom and skip hover while pinching
    e.preventDefault();
    const pts = Array.from(pointers.values());
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (dist > 0.0001) {
      const factor = pinchStartDist / dist; // spread -> zoom out
      setZoom(zoomStart * factor);
    }
    return;
  }
  if (State.mode !== 'game' || State.gameOver) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects(cells.map(c=>c.mesh));
  if (hoverCell && hoverCell.material) hoverCell.material.color.set(baseCellMat.color);
  hoverCell = null;
  if (intersects.length>0) {
    const m = intersects[0].object;
    const idx = indexOfCellMesh(m);
    if (idx>=0) {
      const { i, j } = cells[idx];
      // Only highlight if cell is empty
      if (State.board[i][j] === '') {
        hoverCell = m;
        m.material.color.set(hoverMat.color);
      }
    }
  }
}

function onPointerDown(e) {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const pts = Array.from(pointers.values());
    pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    zoomStart = zoomFactor;
    pinching = true;
  }
}

function onPointerUp(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinching = false;
}

function placeAt(i, j, letter, player) {
  if (State.board[i][j] !== '') return false;
  State.board[i][j] = letter;
  State.remaining--;
  // add visual letter
  const cell = cells.find(c=>c.i===i && c.j===j);
  if (cell) {
    const lm = createLetter(letter, player);
    cell.letterMesh = lm;
    lm.position.set(cell.mesh.position.x, 0.05, cell.mesh.position.z);
    root.add(lm);
  }
  // check SOS
  const sequences = checkSOSAt(i, j);
  if (sequences.length>0) {
    for (const seq of sequences) {
      drawLineThrough(seq, player===1?P1_COLOR:P2_COLOR);
      State.scores[player]++;
      playScoreSound();
    }
    updateHUD();
    return true; // scored, extra turn
  }
  return false;
}

function nextTurn(scored) {
  if (!scored) State.currentPlayer = State.currentPlayer===1?2:1;
  updateHUD();
  maybeAIMove();
}

function maybeAIMove() {
  if (State.gameOver) return;
  if (!State.singlePlayer) return;
  if (State.currentPlayer !== 2) return; // AI is player 2
  // Heuristic AI:
  // 1) Take any immediate scoring move (maximize number of SOS formed)
  // 2) Otherwise block opponent's immediate scoring move (play that exact scoring move if possible)
  // 3) Otherwise build threats: prefer creating patterns likely to form SOS next
  // 4) Prefer center and add small randomness to break ties

  const emptyMoves = [];
  for (let i=0;i<GRID_SIZE;i++){
    for (let j=0;j<GRID_SIZE;j++){
      if (State.board[i][j] !== '') continue;
      emptyMoves.push({i,j});
    }
  }

  const simulateSeqs = (i,j,L)=>{
    const prev = State.board[i][j];
    State.board[i][j] = L;
    const n = checkSOSAt(i,j).length;
    State.board[i][j] = prev;
    return n;
  };

  // 1) Immediate scoring
  let bestScore = -1; let bestChoices = [];
  for (const {i,j} of emptyMoves){
    for (const L of ['S','O']){
      const n = simulateSeqs(i,j,L);
      if (n>0){
        const value = n; // could weight more for multi-SOS
        if (value>bestScore){ bestScore=value; bestChoices=[{i,j,L}]; }
        else if (value===bestScore){ bestChoices.push({i,j,L}); }
      }
    }
  }
  if (bestChoices.length){
    const pick = bestChoices[Math.floor(Math.random()*bestChoices.length)];
    State.pickLetter = pick.L;
    setTimeout(()=>{
      const scored = placeAt(pick.i, pick.j, pick.L, 2);
      if (State.remaining===0) endGame();
      if (!State.gameOver) nextTurn(scored);
    }, 250);
    return;
  }

  // 2) Block opponent's immediate scoring (assume opponent can choose S or O freely)
  const opponentThreats = [];
  for (const {i,j} of emptyMoves){
    for (const L of ['S','O']){
      if (simulateSeqs(i,j,L)>0){
        opponentThreats.push({i,j,L});
      }
    }
  }
  if (opponentThreats.length){
    // Play on one of those cells with the letter that would have scored for them
    const pick = opponentThreats[Math.floor(Math.random()*opponentThreats.length)];
    State.pickLetter = pick.L;
    setTimeout(()=>{
      const scored = placeAt(pick.i, pick.j, pick.L, 2);
      if (State.remaining===0) endGame();
      if (!State.gameOver) nextTurn(scored);
    }, 250);
    return;
  }

  // 3) Build threats evaluation
  const center = (GRID_SIZE-1)/2;
  const inB = (r,c)=> r>=0 && r<GRID_SIZE && c>=0 && c<GRID_SIZE;
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  const threatValue = (i,j,L)=>{
    let v = 0;
    for (const [di,dj] of dirs){
      if (L==='O'){
        const a=[i-di,j-dj], b=[i+di,j+dj];
        if (inB(a[0],a[1]) && inB(b[0],b[1])){
          const A = State.board[a[0]][a[1]]; const B = State.board[b[0]][b[1]];
          // empty ends are good for potential S-O-S next
          if ((A==='') && (B==='')) v += 2;
          // one end already S gives near-immediate set-up
          if ((A==='S' && B==='') || (A==='' && B==='S')) v += 1;
        }
      } else { // L==='S'
        const mid=[i+di,j+dj], end=[i+2*di,j+2*dj];
        if (inB(mid[0],mid[1]) && inB(end[0],end[1])){
          const M = State.board[mid[0]][mid[1]]; const E = State.board[end[0]][end[1]];
          // S _ _ with empty mid and end can become S-O-S later
          if (M==='' && E==='') v += 1;
          // S O _ is very close to scoring
          if (M==='O' && E==='') v += 2;
        }
      }
    }
    // prefer center
    const dx = Math.abs(j-center), dy = Math.abs(i-center);
    const dist = Math.sqrt(dx*dx + dy*dy);
    v += 0.1 * (GRID_SIZE - dist);
    // small randomness to avoid deterministic lines
    v += Math.random()*0.05;
    return v;
  };

  let best = null; let bestV = -1;
  for (const {i,j} of emptyMoves){
    for (const L of ['S','O']){
      const val = threatValue(i,j,L);
      if (val>bestV){ bestV=val; best={i,j,L}; }
    }
  }
  if (!best){ best = { ...emptyMoves[Math.floor(Math.random()*emptyMoves.length)], L: 'S' }; }
  State.pickLetter = best.L;
  setTimeout(()=>{
    const scored = placeAt(best.i, best.j, best.L, 2);
    if (State.remaining===0) endGame();
    if (!State.gameOver) nextTurn(scored);
  }, 250);
}

function endGame() {
  State.gameOver = true;
  const p1 = State.scores[1], p2 = State.scores[2];
  const winner = p1===p2 ? 'Draw' : (p1>p2 ? 'Player 1 Wins!' : (State.singlePlayer ? 'AI Wins!' : 'Player 2 Wins!'));
  const eg = document.getElementById('endgame');
  eg.classList.remove('hidden');
  eg.innerHTML = `<div class="winner">${winner}</div><div>Final Score — P1: ${p1} · ${State.singlePlayer?'AI':'P2'}: ${p2}</div><button id="againBtn" class="primary" style="margin-top:10px">Play Again</button>`;
  document.getElementById('againBtn').onclick = ()=> startMenu();
}

function handleClick(e) {
  if (State.mode !== 'game' || State.gameOver) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects(cells.map(c=>c.mesh));
  if (intersects.length===0) return;
  const mesh = intersects[0].object;
  const idx = indexOfCellMesh(mesh);
  if (idx<0) return;
  const { i, j } = cells[idx];
  // Ignore clicks on occupied cells — do NOT end turn
  if (State.board[i][j] !== '') return;
  const letter = State.pickLetter;
  const player = State.currentPlayer;
  const scored = placeAt(i, j, letter, player);
  if (State.remaining===0) endGame();
  if (!State.gameOver) nextTurn(scored);
}

function resetBoard() {
  // clear three objects for letters and lines
  for (const c of cells) {
    if (c.letterMesh) { root.remove(c.letterMesh); c.letterMesh.geometry.dispose(); c.letterMesh.material.dispose(); c.letterMesh = null; }
    c.mesh.material.color.set(baseCellMat.color);
  }
  for (let i=lineGroup.children.length-1;i>=0;i--) {
    const ch = lineGroup.children[i];
    lineGroup.remove(ch);
  }
  // reset state
  State.board = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(''));
  State.scores = {1:0,2:0};
  State.remaining = GRID_SIZE*GRID_SIZE;
  State.currentPlayer = 1;
  State.pickLetter = 'S';
  State.gameOver = false;
  document.getElementById('endgame').classList.add('hidden');
  updateHUD();
}

function startGame(single) {
  State.mode = 'game';
  State.singlePlayer = single;
  State.currentPlayer = 1;
  State.pickLetter = 'S';
  State.gameOver = false;
  State.scores[1] = 0; State.scores[2] = 0;
  State.remaining = GRID_SIZE * GRID_SIZE;
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  resetBoard();
  updateHUD();
  // start ambient music if enabled
  startBGM();
  if (State.singlePlayer && State.currentPlayer === 2) maybeAIMove();
}

function startMenu() {
  State.mode = 'menu';
  document.getElementById('menu').classList.remove('hidden');
  document.getElementById('hud').classList.add('hidden');
  resetBoard();
  stopBGM();
}

function setupUI() {
  const bind = (id, fn)=>{
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', (e)=>{ e.stopPropagation(); fn(e); });
  };
  bind('singleBtn', ()=> startGame(true));
  bind('vsBtn', ()=> startGame(false));
  bind('restartBtn', ()=> startGame(State.singlePlayer));
  bind('menuBtn', ()=> startMenu());
  bind('soundBtn', ()=> { State.soundOn = !State.soundOn; updateHUD(); });
  bind('musicBtn', ()=> {
    State.musicOn = !State.musicOn;
    updateHUD();
    if (State.musicOn) startBGM(); else stopBGM();
  });
  bind('pickS', ()=> { State.pickLetter='S'; updateHUD(); });
  bind('pickO', ()=> { State.pickLetter='O'; updateHUD(); });
}

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Mobile-friendly: back the camera off only when very small to keep board larger
  const minWH = Math.min(window.innerWidth, window.innerHeight);
  const desiredMin = 560; // was 720; lower value = less backing off => larger board on phones
  baseScaleGlobal = Math.max(1, desiredMin / minWH);
  applyCameraScale();
}

// Boot
window.addEventListener('resize', onResize);
// Bind game interactions to the renderer's canvas to avoid interfering with UI clicks
renderer.domElement.addEventListener('pointermove', onPointerMove);
renderer.domElement.addEventListener('click', handleClick);
renderer.domElement.addEventListener('pointerdown', onPointerDown, { passive: false });
renderer.domElement.addEventListener('pointerup', onPointerUp, { passive: false });
renderer.domElement.addEventListener('pointercancel', onPointerUp, { passive: false });
// Wheel zoom (desktop)
renderer.domElement.addEventListener('wheel', (e)=>{
  e.preventDefault();
  const delta = -e.deltaY * 0.0015;
  setZoom(zoomFactor * (1 + delta));
}, { passive: false });

setupUI();

// Unlock audio on first user interaction
const unlock = ()=>{ ensureAudioCtx(); document.removeEventListener('pointerdown', unlock, true); document.removeEventListener('keydown', unlock, true); };
document.addEventListener('pointerdown', unlock, true);
document.addEventListener('keydown', unlock, true);

// Load font then build scene
loader.load('https://unpkg.com/three@0.160.1/examples/fonts/helvetiker_regular.typeface.json', (f)=>{
  font = f;
  buildBoard();
  onResize();
  animate();
});
