"use client";
/**
 * HeroSection.tsx — Arumai Football Club
 *
 * Install:
 *   npm i three gsap
 *   npm i -D @types/three
 *   (Tailwind CSS already configured)
 *
 * Files:
 *   HeroSection.tsx     <- this file
 *   LoadingScreen.tsx   <- loader (same folder)
 *
 * Usage:
 *   <HeroSection />
 *   <NextSection />     <- scrolls in right after the hero finishes
 *
 * How it works
 *   A tall wrapper + CSS position:sticky keeps the hero on screen while one GSAP ScrollTrigger scrubs a single master timeline (0 -> 1).
 *   A shared `progress.p` value drives the whole three.js scene, so every frame of the
 *   animation is a pure function of scroll position (fully reversible when scrolling up).
 *
 *   loader  1 -> 100 counter with a spinning close-up ball, mega-skin zoom-out, ball drops, bounces
 *           and rests at the right end of the title (see LoadingScreen.tsx)
 *   p 0.00  poster: red + grid + big title
 *   p 0.03  title leaves, pitch pops up (diagonal -> straight)
 *   p 0.20  camera swings from the normal angle to a top view over the centre circle
 *   p 0.22  black/white hexagon ball rolls in and stops on the centre spot
 *   p 0.36  a block footballer (red #07 jersey, white shorts, red boots) runs in, winds up, kicks at p 0.50
 *   p 0.50  ball flies; 4 camera angles + 4 corner dialogues tell the club story
 *   p 0.93  ball settles in the net (no goalkeeper), GOAL, pin releases, next section
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import LoadingScreen from "@/sections/LoadingScreen";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/* ------------------------------------------------------------------ */
/*  Config — tweak freely                                              */
/* ------------------------------------------------------------------ */
const SCROLL_SCREENS = 7.5; // how many screen-heights of scrolling the whole sequence takes
const DEBUG = false; // true = show ScrollTrigger start/end markers
const RED = "#ff2323";
const INK = "#1d1d1d";

// Wide, heavy grotesk (closest free match to the reference). Swap for "Overrun" if you own a licence.
const DISPLAY_FONT = "'Archivo', 'Arial Black', Impact, sans-serif";
const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=swap');";

// grid lines, in % of the hero (taken from the reference image)
// vertical lines now run the full height of the hero, behind the title as well
const V_LINES = [1.14, 12.86, 39.8, 60.1, 87.2, 98.8];
const H_LINES = [6.3]; // header line (add more percentages here for extra horizontal lines)
const GRID_COLOR = "rgba(29,29,29,.55)";

// header cells (outlined by the grid lines only): AFC logo on the left, EST. on the right
const EST = "EST.1997";

// Placeholder copy — replace with the real club story.
const CHAPTERS = [
  {
    no: "01",
    title: "Where it began",
    text: "A handful of friends, one battered ball and an open ground. No stands, no trophies, just the love of the game.",
    pos: "left-[3%] top-[11%]",
    from: 0.53,
    to: 0.64,
  },
  {
    no: "02",
    title: "How we play",
    text: "Quick passes, fearless pressing and a team that moves as one. Arumai means excellence, and we earn the name every matchday.",
    pos: "right-[3%] bottom-[10%]",
    from: 0.65,
    to: 0.75,
  },
  {
    no: "03",
    title: "More than a club",
    text: "An academy for the young, a home for the loyal and a family in the stands. Everyone who joins, belongs.",
    pos: "right-[3%] top-[11%]",
    from: 0.77,
    to: 0.86,
  },
  {
    no: "04",
    title: "Your turn",
    text: "The next goal is yours. Join Arumai FC and write the next chapter with us.",
    pos: "left-[3%] bottom-[10%]",
    from: 0.87,
    to: 1,
  },
];

/* ------------------------------------------------------------------ */
/*  Scene constants                                                    */
/* ------------------------------------------------------------------ */
const HALF_L = 32;
const HALF_W = 11;
const GOAL_HALF = 3.5;
const GOAL_H = 2.6;
const NET_D = 2.2;
const NET_BACK_H = 1.8;
const BALL_R = 0.5;

// Block footballer: hip position chosen so the right boot meets the ball on the centre spot
const PLAYER_POS = new THREE.Vector3(-2.24, 5.02, -0.65);
const LEG_LEN = 4.5; // hip to ankle (one solid block)

/* ------------------------------------------------------------------ */
/*  Math helpers                                                       */
/* ------------------------------------------------------------------ */
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a), 0, 1);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number) => t * t * t;
const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

const UP = new THREE.Vector3(0, 1, 0);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function bar(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  m.castShadow = true;
  return m;
}

/* ------------------------------------------------------------------ */
/*  Pitch texture                                                      */
/* ------------------------------------------------------------------ */
function makePitchTexture() {
  const S = 40;
  const W = 72 * S;
  const H = 30 * S;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;
  const X = (x: number) => (x + 36) * S;
  const Z = (z: number) => (z + 15) * S;

  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = i % 2 ? "#1d7a39" : "#25893f";
    ctx.fillRect(i * 4 * S, 0, 4 * S, H);
  }

  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 0.22 * S;
  ctx.lineCap = "butt";

  ctx.strokeRect(X(-HALF_L), Z(-HALF_W), HALF_L * 2 * S, HALF_W * 2 * S);

  ctx.beginPath();
  ctx.moveTo(X(0), Z(-HALF_W));
  ctx.lineTo(X(0), Z(HALF_W));
  ctx.stroke();

  // centre circle + centre spot
  ctx.beginPath();
  ctx.arc(X(0), Z(0), 6 * S, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(X(0), Z(0), 0.4 * S, 0, Math.PI * 2);
  ctx.fill();

  for (const s of [-1, 1]) {
    ctx.strokeRect(X(s > 0 ? HALF_L - 8 : -HALF_L), Z(-7), 8 * S, 14 * S);
    ctx.strokeRect(X(s > 0 ? HALF_L - 3 : -HALF_L), Z(-4.5), 3 * S, 9 * S);
    const sx = s * (HALF_L - 5.5);
    ctx.beginPath();
    ctx.arc(X(sx), Z(0), 0.3 * S, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    if (s > 0) ctx.arc(X(sx), Z(0), 4 * S, 2.245, Math.PI * 2 - 2.245);
    else ctx.arc(X(sx), Z(0), 4 * S, -0.896, 0.896);
    ctx.stroke();
  }

  const corners: [number, number, number, number][] = [
    [1, 1, Math.PI, Math.PI * 1.5],
    [1, -1, Math.PI * 0.5, Math.PI],
    [-1, 1, Math.PI * 1.5, Math.PI * 2],
    [-1, -1, 0, Math.PI * 0.5],
  ];
  for (const [sx, sz, a0, a1] of corners) {
    ctx.beginPath();
    ctx.arc(X(sx * HALF_L), Z(sz * HALF_W), 1.1 * S, a0, a1);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* ------------------------------------------------------------------ */
/*  Goal + net (no goalkeeper!)                                        */
/* ------------------------------------------------------------------ */
function buildGoal(side: 1 | -1) {
  const root = new THREE.Group();
  root.position.x = side * HALF_L;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x * side, y, z);
  const W = GOAL_HALF;
  const H = GOAL_H;
  const D = NET_D;
  const BH = NET_BACK_H;

  const p = {
    tfl: v(0, H, -W),
    tfr: v(0, H, W),
    bfl: v(0, 0, -W),
    bfr: v(0, 0, W),
    tbl: v(D, BH, -W),
    tbr: v(D, BH, W),
    bbl: v(D, 0, -W),
    bbr: v(D, 0, W),
  };

  const frame: [THREE.Vector3, THREE.Vector3][] = [
    [p.bfl, p.tfl],
    [p.bfr, p.tfr],
    [p.tfl, p.tfr],
    [p.tfl, p.tbl],
    [p.tfr, p.tbr],
    [p.tbl, p.tbr],
    [p.tbl, p.bbl],
    [p.tbr, p.bbr],
    [p.bbl, p.bbr],
    [p.bfl, p.bbl],
    [p.bfr, p.bbr],
  ];
  frame.forEach(([a, b]) => root.add(bar(a, b, 0.09, mat)));

  const verts: number[] = [];
  const push = (a: THREE.Vector3, b: THREE.Vector3) =>
    verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const grid = (
    p00: THREE.Vector3,
    p10: THREE.Vector3,
    p01: THREE.Vector3,
    p11: THREE.Vector3,
    nu: number,
    nv: number
  ) => {
    for (let i = 0; i <= nu; i++) {
      const t = i / nu;
      push(p00.clone().lerp(p10, t), p01.clone().lerp(p11, t));
    }
    for (let j = 0; j <= nv; j++) {
      const t = j / nv;
      push(p00.clone().lerp(p01, t), p10.clone().lerp(p11, t));
    }
  };
  grid(p.bbl, p.bbr, p.tbl, p.tbr, 14, 6);
  grid(p.tfl, p.tfr, p.tbl, p.tbr, 14, 5);
  grid(p.bfl, p.bbl, p.tfl, p.tbl, 5, 6);
  grid(p.bfr, p.bbr, p.tfr, p.tbr, 5, 6);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  const net = new THREE.Group();
  net.add(
    new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })
    )
  );
  root.add(net);
  return { root, net };
}

/* ------------------------------------------------------------------ */
/*  Classic black & white football (truncated icosahedron pattern)     */
/*  12 black pentagons + 20 white hexagons, coloured per vertex        */
/* ------------------------------------------------------------------ */
function buildBall(r: number) {
  const phi = (1 + Math.sqrt(5)) / 2;
  const iv: THREE.Vector3[] = [];
  for (const a of [-1, 1])
    for (const b of [-phi, phi])
      iv.push(new THREE.Vector3(0, a, b), new THREE.Vector3(a, b, 0), new THREE.Vector3(b, 0, a));

  const pent = iv.map((v) => v.clone().normalize()); // 12 pentagon centres
  const hex: THREE.Vector3[] = []; // 20 hexagon centres (icosahedron face centres)
  for (let i = 0; i < 12; i++)
    for (let j = i + 1; j < 12; j++) {
      if (Math.abs(iv[i].distanceTo(iv[j]) - 2) > 1e-3) continue;
      for (let k = j + 1; k < 12; k++) {
        if (Math.abs(iv[i].distanceTo(iv[k]) - 2) > 1e-3) continue;
        if (Math.abs(iv[j].distanceTo(iv[k]) - 2) > 1e-3) continue;
        hex.push(iv[i].clone().add(iv[j]).add(iv[k]).normalize());
      }
    }

  const HEX_PLANE = 0.9742; // hexagon-plane / pentagon-plane distance of a truncated icosahedron
  const geo = new THREE.SphereGeometry(r, 128, 96);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const n = new THREE.Vector3();
  const WHITE = [0.93, 0.93, 0.93];
  const BLACK = [0.02, 0.02, 0.02];
  const SEAM = [0.16, 0.16, 0.16];

  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(pos, i).normalize();
    let best = -9;
    let second = -9;
    let bestIsPent = false;
    const consider = (s: number, isP: boolean) => {
      if (s > best) {
        second = best;
        best = s;
        bestIsPent = isP;
      } else if (s > second) second = s;
    };
    for (const c of pent) consider(n.dot(c), true);
    for (const c of hex) consider(n.dot(c) / HEX_PLANE, false);
    const c = best - second < 0.035 ? SEAM : bestIsPent ? BLACK : WHITE;
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.02 })
  );
  mesh.castShadow = true;
  return mesh;
}

/* ------------------------------------------------------------------ */
/*  Block footballer: every body part is ONE solid, glossy block.      */
/*  Shiny black body, red #07 jersey, white shorts, red boots.         */
/* ------------------------------------------------------------------ */
const cubeGeo = new THREE.BoxGeometry(1, 1, 1);

/** one solid rounded block; anchor = which point of the block sits at the group origin */
function block(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  anchor: "top" | "bottom" | "center" = "center",
  r = 0.14
) {
  const g = new RoundedBoxGeometry(w, h, d, 3, r);
  if (anchor === "top") g.translate(0, -h / 2, 0);
  else if (anchor === "bottom") g.translate(0, h / 2, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

const DIGITS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
};

/** pixel-font number printed on the back of the shirt (+z = screen right when seen from behind) */
function buildNumber(text: string, mat: THREE.Material) {
  const c = 0.3;
  const total = text.length * 4 - 1;
  const cells: [number, number][] = [];
  [...text].forEach((ch, d) =>
    DIGITS[ch].forEach((row, ry) =>
      [...row].forEach((v, cx) => {
        if (v === "1") cells.push([d * 4 + cx - (total - 1) / 2, 2 - ry]);
      })
    )
  );
  const mesh = new THREE.InstancedMesh(cubeGeo, mat, cells.length);
  const m = new THREE.Matrix4();
  cells.forEach(([cx, cy], i) => {
    m.makeScale(0.08, c * 0.94, c * 0.94);
    m.setPosition(0, cy * c, cx * c);
    mesh.setMatrixAt(i, m);
  });
  mesh.frustumCulled = false;
  return mesh;
}

function buildPlayer(envMap: THREE.Texture) {
  const skin = new THREE.MeshPhysicalMaterial({
    color: 0x080808,
    metalness: 0.35,
    roughness: 0.16,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMap,
    envMapIntensity: 1.7,
  });
  const red = new THREE.MeshStandardMaterial({ color: 0xd2111a, roughness: 0.5, envMap, envMapIntensity: 0.5 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.6, envMap, envMapIntensity: 0.5 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0xe01218, roughness: 0.3, envMap, envMapIntensity: 0.9 });

  // root = hip joints, player faces +x
  const root = new THREE.Group();
  const shorts = block(1.7, 1.8, 2.9, white, "center", 0.2); // white shorts: one block
  shorts.position.y = -0.3;
  root.add(shorts);

  const torso = new THREE.Group();
  torso.position.y = 0.5;
  root.add(torso);
  torso.add(block(1.5, 3.0, 3.0, red, "bottom", 0.2)); // red jersey: one block

  const num = buildNumber("07", white);
  num.position.set(-0.75 - 0.04, 1.8, 0);
  torso.add(num);

  const head = block(1.5, 1.5, 1.5, skin, "bottom", 0.25); // head: one block
  head.position.y = 3.0;
  torso.add(head);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(cubeGeo, white);
    eye.scale.set(0.08, 0.25, 0.25);
    eye.position.set(0.76, 3.85, s * 0.35);
    torso.add(eye);
  }

  // arms: [0] = right (+z), [1] = left (-z). Each arm + hand = ONE block.
  const arms = [1, -1].map((s) => {
    const sh = new THREE.Group();
    sh.position.set(0, 2.8, s * 2.05);
    torso.add(sh);
    sh.add(block(1.0, 2.8, 0.9, skin, "top", 0.2));
    return { sh };
  });

  // legs: [0] = right / kicking (+z), [1] = left / standing (-z). Each leg = ONE block, boot = ONE block.
  const legs = [1, -1].map((s) => {
    const hip = new THREE.Group();
    hip.position.set(0, 0, s * 0.65);
    root.add(hip);
    hip.add(block(1.0, LEG_LEN, 1.0, skin, "top", 0.2));
    const boot = block(1.5, 0.5, 1.1, shoe, "top", 0.18); // spans x -0.25..1.25 under the ankle
    boot.position.set(0.5, -LEG_LEN, 0);
    hip.add(boot);
    return { hip };
  });

  return { root, torso, legs, arms };
}

/* ------------------------------------------------------------------ */
/*  Camera rig: a list of shots, cross-faded by scroll progress        */
/* ------------------------------------------------------------------ */
interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function HeroSection() {
  const rootRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const goalRef = useRef<HTMLDivElement>(null);
  const chapterRefs = useRef<(HTMLDivElement | null)[]>([]);
  const progress = useRef({ p: 0 });

  // loading screen: the ball finally rests in this slot at the right end of the title
  const slotRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [parked, setParked] = useState("");

  /* ---------------- three.js scene (reads progress.p every frame) ---------------- */
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
    const view = { dist: 55, topH: 20, zf: 1 };
    let dirty = true;

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect;
      view.dist = clamp(34 / tanH, 40, 110); // whole pitch visible
      view.topH = clamp(12.5 / tanH, 14, 70); // centre circle fills the frame
      view.zf = Math.max(1, 1.45 / camera.aspect); // pull back on portrait screens
      dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    /* lights */
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6a1010, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(-14, 38, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -44;
    sun.shadow.camera.right = 44;
    sun.shadow.camera.top = 24;
    sun.shadow.camera.bottom = -24;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 110;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    /* stage = pitch + goals (this group does the diagonal pop-up) */
    const stage = new THREE.Group();
    scene.add(stage);

    const sideMat = new THREE.MeshStandardMaterial({ color: 0x0c3a1c, roughness: 0.9 });
    const topMat = new THREE.MeshStandardMaterial({ map: makePitchTexture(), roughness: 0.95 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(72, 0.8, 30), [
      sideMat,
      sideMat,
      topMat,
      sideMat,
      sideMat,
      sideMat,
    ]);
    slab.position.y = -0.4;
    slab.receiveShadow = true;
    stage.add(slab);

    const goalL = buildGoal(-1);
    const goalR = buildGoal(1);
    stage.add(goalL.root, goalR.root);

    /* ball + leg live in world space (the stage is identity by the time they appear) */
    const ball = buildBall(BALL_R);
    ball.visible = false;
    scene.add(ball);

    // soft studio reflections, used only on the player so the black body really shines
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const player = buildPlayer(envTex);
    player.root.visible = false;
    scene.add(player.root);

    /* ball flight path: up over the pitch, round the stadium, down into the net */
    const path = new THREE.CatmullRomCurve3(
      [
        V(0, BALL_R, 0),
        V(4.5, 5.5, -1.2),
        V(10, 11.5, 3.5),
        V(16, 13.5, -2.5),
        V(22, 9.5, -4.5),
        V(27, 5, 1.5),
        V(30.5, 2.4, 1.0),
        V(32.4, 1.5, 0.9),
        V(33.6, 0.95, 1.0),
      ],
      false,
      "centripetal"
    );
    const pathEnd = path.getPointAt(1);

    /* camera shots */
    const shots: { s: number; w: number; f: (b: THREE.Vector3) => Shot }[] = [
      {
        // 0 — normal angle, whole pitch
        s: 0,
        w: 1,
        f: () => ({
          pos: V(0, Math.sin(0.58) * view.dist, Math.cos(0.58) * view.dist),
          look: V(0, 0, 0),
        }),
      },
      {
        // 1 — top view over the centre circle & spot
        s: 0.25,
        w: 0.12,
        f: () => ({ pos: V(0, view.topH, 0.01), look: V(0, 0, 0) }),
      },
      {
        // 2 — three-quarter view of the kick
        s: 0.4,
        w: 0.08,
        f: () => {
          // from behind-right so the number 07 and the kicking boot are both in frame
          const look = V(-1.4, 4.6, -0.3);
          return { look, pos: look.clone().add(V(-10, 2.5, 16).multiplyScalar(view.zf)) };
        },
      },
      {
        // 3 — chase cam behind the ball
        s: 0.52,
        w: 0.06,
        f: (b) => ({
          look: b.clone().add(V(5, 0.4, 0)),
          pos: b.clone().add(V(-8, 4, 3.5).multiplyScalar(view.zf)),
        }),
      },
      {
        // 4 — side-on from the touchline
        s: 0.65,
        w: 0.07,
        f: (b) => ({ look: b.clone(), pos: V(b.x + 2, 3 + b.y * 0.5, 20 * view.zf) }),
      },
      {
        // 5 — low, near the goal, ball comes at us
        s: 0.76,
        w: 0.06,
        f: (b) => ({ look: b.clone(), pos: V(HALF_L - 10, 2.4, -10 * view.zf) }),
      },
      {
        // 6 — behind the goal, watching it hit the net
        s: 0.85,
        w: 0.05,
        f: (b) => ({
          look: b.clone(),
          pos: V(HALF_L + 8.5 * view.zf, 2.6, 5.5 * view.zf),
        }),
      },
      {
        // 7 — slow pull-back on the finished goal
        s: 0.95,
        w: 0.05,
        f: () => ({
          look: V(HALF_L + 0.5, 1.0, 0),
          pos: V(HALF_L + 11 * view.zf, 4.5, 9 * view.zf),
        }),
      },
    ];

    /* update — everything is a function of scroll progress */
    const ballPos = ball.position;
    const prevBall = new THREE.Vector3();
    let havePrev = false;
    const dv = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const qTmp = new THREE.Quaternion();

    const update = (p: number) => {
      /* pitch pop: diagonal -> straight */
      const ps = seg(p, 0.03, 0.2);
      stage.visible = ps > 0;
      stage.scale.setScalar(Math.max(0.001, lerp(0.05, 1, easeOutBack(ps))));
      stage.rotation.y = lerp(-0.78, 0, easeOutCubic(ps));
      stage.position.set(0, lerp(-16, 0, easeOutCubic(ps)), lerp(8, 0, easeOutCubic(ps)));

      /* ball */
      let visible = p >= 0.215;
      if (p < 0.5) {
        const u = easeOutQuart(seg(p, 0.22, 0.38)); // rolls in, decelerates, stops on the spot
        ballPos.set(lerp(-17, 0, u), BALL_R, lerp(3.5, 0, u));
      } else if (p <= 0.93) {
        const u = seg(p, 0.5, 0.93);
        const e = 1 - Math.pow(1 - u, 1.25);
        path.getPointAt(e, dv);
        ballPos.set(dv.x, Math.max(BALL_R, dv.y), dv.z);
      } else {
        const u = easeOutCubic(seg(p, 0.93, 0.985));
        ballPos.set(lerp(pathEnd.x, pathEnd.x + 0.3, u), lerp(pathEnd.y, BALL_R, u), pathEnd.z);
      }
      ball.visible = visible;

      if (visible) {
        if (havePrev) {
          dv.subVectors(ballPos, prevBall);
          const len = dv.length();
          if (len > 1e-5 && len < 8) {
            axis.crossVectors(UP, dv);
            if (axis.lengthSq() > 1e-8) {
              axis.normalize();
              qTmp.setFromAxisAngle(axis, len / BALL_R);
              ball.quaternion.premultiply(qTmp);
            }
          }
        }
        prevBall.copy(ballPos);
        havePrev = true;
      } else havePrev = false;

      /* footballer: runs in, winds up, kicks at p = 0.50, follows through, jogs away */
      const ls = seg(p, 0.36, 0.43);
      player.root.visible = ls > 0 && p < 0.67;
      const arrive = easeOutCubic(ls);
      const ampIn = ls > 0 && ls < 1 ? 1 - smooth(0.6, 1, ls) : 0;
      const ampOut = seg(p, 0.56, 0.62);
      const amp = Math.max(ampIn, ampOut); // stride amount
      const ph = p * 240;
      const sw = Math.sin(ph) * amp;

      const wind = easeInOutCubic(seg(p, 0.43, 0.475));
      const strike = Math.pow(seg(p, 0.475, 0.5), 1.6);
      const follow = easeOutCubic(seg(p, 0.5, 0.55));
      const pose = 1 - seg(p, 0.55, 0.6); // 1 = kick choreography, 0 = plain jog

      // kicking (right) leg: one rigid block swinging from the hip
      let aR = 0.05;
      aR = lerp(aR, -0.9, wind);
      aR = lerp(aR, 0.12, strike); // contact: boot meets the ball on the centre spot
      aR = lerp(aR, 1.1, follow);
      aR = lerp(0, aR, pose);
      const aPose = aR;
      aR += sw * 0.7;
      const aL = -sw * 0.7; // standing leg stays planted beside the ball

      const [legR, legL] = player.legs;
      legR.hip.rotation.z = aR;
      legL.hip.rotation.z = aL;

      // arms counter-swing the legs
      const [armR, armL] = player.arms;
      const armKick = (aPose - 0.05) * 0.5;
      armR.sh.rotation.z = -armKick - sw * 0.8;
      armL.sh.rotation.z = armKick + sw * 0.8;
      armR.sh.rotation.x = -0.12;
      armL.sh.rotation.x = 0.12;

      // body lean: back on the wind-up, over the ball on the strike
      let lean = -0.08;
      lean = lerp(lean, 0.16, wind);
      lean = lerp(lean, -0.12, strike);
      lean = lerp(lean, 0.05, follow);
      lean = lerp(-0.08, lean, pose) - 0.14 * amp;
      player.torso.rotation.z = lean;

      // placement: slides in from the left, turns and jogs off to the side after the kick
      const away = easeInCubic(seg(p, 0.58, 0.67));
      player.root.position.set(
        PLAYER_POS.x - 14 * (1 - arrive),
        PLAYER_POS.y + Math.abs(Math.sin(ph)) * 0.25 * amp,
        PLAYER_POS.z - 20 * away
      );
      player.root.rotation.y = easeInOutCubic(seg(p, 0.55, 0.59)) * (Math.PI / 2);

      /* net bulge on the goal the ball scores in */
      const nb = smooth(32, 33.6, ballPos.x) * (1 - 0.5 * seg(p, 0.94, 1));
      goalR.net.scale.x = 1 + 0.28 * nb;

      /* camera: cross-fade between shots */
      let cur = shots[0].f(ballPos);
      for (let i = 1; i < shots.length; i++) {
        const t = smooth(shots[i].s - shots[i].w / 2, shots[i].s + shots[i].w / 2, p);
        if (t <= 0) continue;
        const nxt = shots[i].f(ballPos);
        cur = { pos: cur.pos.lerp(nxt.pos, t), look: cur.look.lerp(nxt.look, t) };
      }
      camera.position.copy(cur.pos);
      camera.lookAt(cur.look);
    };

    let raf = 0;
    let lastP = -1;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const p = progress.current.p;
      if (!dirty && Math.abs(p - lastP) < 1e-6) return;
      dirty = false;
      lastP = p;
      update(p);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      });
      topMat.map?.dispose();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  /* ---------------- title fitting: edge to edge, never overflows ---------------- */
  useIsoLayoutEffect(() => {
    const el = fitRef.current;
    const tag = tagRef.current;
    const root = stickyRef.current;
    if (!el || !tag || !root) return;
    let alive = true;
    const fit = () => {
      if (!alive) return;
      const PROBE = 200;
      el.style.fontSize = `${PROBE}px`;
      const target = (el.parentElement as HTMLElement).clientWidth;
      const w = el.offsetWidth || 1; // offsetWidth ignores GSAP transforms
      const byWidth = (PROBE * target) / w;
      const byHeight = (root.clientHeight * 0.3) / 0.74; // keep the title inside its grid row on short screens
      const size = Math.floor(Math.min(byWidth, byHeight));
      el.style.fontSize = `${size}px`;
      tag.style.fontSize = `${Math.floor(size * 0.3)}px`;

      const sectionH = root.clientHeight;
      const titleTop = (el.parentElement as HTMLElement).offsetTop;

      // NOTE: the grid is no longer clipped above the title, so the vertical
      // grid lines now run behind "AFC / Arumai" all the way to the bottom.

      // resting spot of the loader ball: the very bottom edge of the hero, at the right end.
      // slotRef lives inside titleRef (absolute), so `top` is measured from the title's top edge.
      const slot = slotRef.current;
      if (slot) {
        const D = Math.round(size * 0.34); // ball diameter
        slot.style.width = `${D}px`;
        slot.style.height = `${D}px`;
        slot.style.top = `${sectionH - titleTop - D}px`;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(root);
    const refit = () => {
      fit();
      ScrollTrigger.refresh();
    };
    // re-fit when the web font actually arrives (fallback font is narrower than Archivo Expanded)
    document.fonts.addEventListener("loadingdone", fit);
    document.fonts.load("900 expanded 100px Archivo").then(refit).catch(() => {});
    window.addEventListener("load", refit);
    return () => {
      alive = false;
      ro.disconnect();
      document.fonts.removeEventListener("loadingdone", fit);
      window.removeEventListener("load", refit);
    };
  }, []);

  /* ---------------- GSAP ScrollTrigger master timeline ---------------- */
  useIsoLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: rootRef.current, // tall wrapper; the hero inside it is CSS-sticky
          start: "top top",
          end: "bottom bottom",
          scrub: 0.6,
          invalidateOnRefresh: true,
          markers: DEBUG,
        },
      });

      // drives the whole 3D scene
      tl.to(progress.current, { p: 1, duration: 1 }, 0);

      // poster leaves as the pitch pops up
      tl.to(hintRef.current, { opacity: 0, duration: 0.03 }, 0);
      tl.to(labelsRef.current, { opacity: 0, y: -16, duration: 0.06 }, 0.02);
      tl.to(
        titleRef.current,
        { y: "-16vh", scale: 0.9, opacity: 0, transformOrigin: "50% 100%", duration: 0.14, ease: "power2.in" },
        0.04
      );

      // story dialogues in different corners
      CHAPTERS.forEach((c, i) => {
        const el = chapterRefs.current[i];
        if (!el) return;
        tl.fromTo(
          el,
          { autoAlpha: 0, y: 28, clipPath: "inset(0 0 100% 0)" },
          { autoAlpha: 1, y: 0, clipPath: "inset(0 0 0% 0)", duration: 0.035, ease: "power3.out" },
          c.from
        );
        if (c.to < 1) {
          tl.to(el, { autoAlpha: 0, y: -18, duration: 0.025, ease: "power2.in" }, c.to - 0.01);
        }
      });

      // GOAL!
      tl.fromTo(
        goalRef.current,
        { autoAlpha: 0, scale: 0.6 },
        { autoAlpha: 1, scale: 1, duration: 0.03, ease: "back.out(2)" },
        0.925
      );
    }, rootRef);
    return () => ctx.revert();
  }, []);

  /* ---------------- markup ---------------- */
  // every text size below uses clamp(min, fluid, max) so it adapts from phones to ultrawide
//   const labelCls = "font-extrabold uppercase leading-[1.1] tracking-[0.01em]";
//   const labelStyle = { fontSize: "clamp(8px, 0.55vw + 5px, 12px)" };

  return (
    <div
      ref={rootRef}
      className="relative w-full"
      style={{ height: `calc(100svh * ${1 + SCROLL_SCREENS})` }}
    >
      <section
        ref={stickyRef}
        className="sticky top-0 isolate h-[100svh] w-full overflow-hidden"
        style={{ background: RED, color: INK, fontFamily: DISPLAY_FONT }}
      >
        <style>{FONT_IMPORT}</style>

        {/* grid (full height, visible behind the title) */}
        <div ref={gridRef} aria-hidden className="pointer-events-none absolute inset-0 z-0">
          {V_LINES.map((x) => (
            <i
              key={`v${x}`}
              className="absolute bottom-0 top-0 w-px"
              style={{ left: `${x}%`, background: GRID_COLOR }}
            />
          ))}
          {H_LINES.map((y) => (
            <i
              key={`h${y}`}
              className="absolute left-0 right-0 h-px"
              style={{ top: `${y}%`, background: GRID_COLOR }}
            />
          ))}
        </div>

        {/* header cells: AFC logo (left) and EST. (right), no extra borders, the grid lines frame them */}
        <div ref={labelsRef} className="pointer-events-none absolute inset-x-0 top-0 z-10" style={{ height: "6.3%" }}>
          <div
            className="absolute bottom-0 top-0 flex items-center justify-center uppercase leading-none"
            style={{
              left: "1.14%",
              width: "11.72%",
              fontWeight: 900,
              fontStretch: "125%",
              letterSpacing: "-0.02em",
              fontSize: "clamp(14px, 1.5vw, 28px)",
            }}
          >
            AFC
          </div>
          <div
            className="absolute bottom-0 top-0 flex items-center justify-center uppercase leading-none"
            style={{
              left: "87.2%",
              width: "11.6%",
              fontWeight: 800,
              fontSize: "clamp(12px, 1.25vw, 24px)",
              letterSpacing: "0.02em",
            }}
          >
            {EST}
          </div>
        </div>

        {/* poster title */}
        <div
          ref={titleRef}
          className="absolute bottom-[4.7%] left-[1.1%] right-[1.1%] z-10 will-change-transform"
        >
          <div
            ref={tagRef}
            className="mb-[0.6vw] uppercase leading-[0.8]"
            style={{ fontWeight: 900, fontStretch: "125%", letterSpacing: "-0.02em", fontSize: "clamp(24px, 8vw, 120px)" }}
          >
            AFC
          </div>
          <div
            ref={fitRef}
            className="inline-block whitespace-nowrap uppercase leading-[0.74]"
            style={{ fontWeight: 900, fontStretch: "125%", letterSpacing: "-0.02em", fontSize: "clamp(60px, 22vw, 600px)" }}
          >
            Arumai
          </div>

          {/* the loading-screen football comes to rest here (right end of the title) */}
          <div
            ref={slotRef}
            aria-hidden
            className="pointer-events-none absolute right-0"
            style={{ width: 0, height: 0 }}
          >
            {parked && <img src={parked} alt="" draggable={false} className="block h-full w-full" />}
          </div>
        </div>

        {/* three.js canvas */}
        <div
          ref={mountRef}
          role="img"
          aria-label="Animated football kicked from the centre spot into the goal"
          className="pointer-events-none absolute inset-0 z-20"
        />

        {/* story dialogues */}
        {CHAPTERS.map((c, i) => (
          <div
            key={c.no}
            ref={(el) => {
              chapterRefs.current[i] = el;
            }}
            className={`pointer-events-none absolute z-30 text-white opacity-0 ${c.pos}`}
            style={{
              background: INK,
              visibility: "hidden",
              width: "clamp(200px, 26vw, 380px)",
              maxWidth: "calc(100% - 6%)",
              padding: "clamp(10px, 1.1vw, 18px)",
            }}
          >
            <div className="mb-[0.5em] flex items-baseline gap-3" style={{ fontSize: "clamp(14px, 0.8vw + 9px, 22px)" }}>
              <span className="font-extrabold" style={{ color: RED, fontSize: "0.6em" }}>
                {c.no}
              </span>
              <h2 className="uppercase leading-none" style={{ fontWeight: 900, fontStretch: "125%", fontSize: "1em" }}>
                {c.title}
              </h2>
            </div>
            <p
              className="font-medium leading-snug text-white/85"
              style={{ fontSize: "clamp(11.5px, 0.35vw + 9px, 15px)" }}
            >
              {c.text}
            </p>
          </div>
        ))}

        {/* goal call-out */}
        <div
          ref={goalRef}
          aria-live="polite"
          className="pointer-events-none absolute left-1/2 top-[40%] z-30 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap uppercase text-white opacity-0"
          style={{
            fontWeight: 900,
            fontStretch: "125%",
            fontSize: "clamp(2.5rem, min(14vw, 24svh), 12rem)",
            lineHeight: 0.8,
            visibility: "hidden",
            textShadow: "0 6px 0 rgba(29,29,29,.9)",
          }}
        >
          Polichu!
        </div>
      </section>

      {/* loading screen: counter 1 -> 100, mega football skin, drop + bounce into the title slot */}
      {!loaded && (
        <LoadingScreen
          slotRef={slotRef}
          onLanded={setParked}
          onDone={() => {
            setLoaded(true);
            requestAnimationFrame(() => ScrollTrigger.refresh());
          }}
        />
      )}
    </div>
  );
}
