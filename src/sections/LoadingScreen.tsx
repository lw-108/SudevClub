"use client";
/**
 * LoadingScreen.tsx — Arumai Football Club
 *
 * Sequence (one requestAnimationFrame loop driven by timestamps, so it never drifts):
 *   0.0s – 4.0s   FLAT 2D football-skin sheet (black / white hexagons, no curve, no shadow)
 *                 sliding diagonally across the whole screen, only the counter 1 -> 100 on top
 *   4.0s – 4.5s   at 100 the sheet speeds up and zooms into mega hexagons, then melts into the
 *                 real football skin that fills the screen
 *   4.5s – 4.65s  hold
 *   4.65s – 6.85s slow zoom-out until the whole ball is visible
 *   6.85s – 8.5s  the ball falls to the bottom of the hero, bounces 3x and settles at the right
 *                 end of the title, then hands a snapshot to the hero and removes itself
 *
 * Why it does not lag
 *   - both the flat sheet and the ball pattern are drawn procedurally in fragment shaders:
 *     no textures, no geometry baking, razor sharp at any zoom
 *   - the counter writes to the DOM only when the integer changes (100 writes in total)
 *   - shaders are compiled and one frame is rendered BEFORE the clock starts
 *   - no shadows, no post-processing, pixel ratio capped
 */
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import * as THREE from "three";

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */
const RED = "#ff2323";
const INK = "#1d1d1d";
const DISPLAY_FONT = "'Archivo', 'Arial Black', Impact, sans-serif";
const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=swap');";

const COUNT_MS = 4000; // 1 -> 100
const ZOOM_IN_MS = 500; // flat sheet zooms, melts into the ball skin
const HOLD_MS = 150; // screen is pure football skin
const ZOOM_OUT_MS = 2200; // slow pull-back
const T1 = COUNT_MS;
const T2 = T1 + ZOOM_IN_MS;
const T3 = T2 + HOLD_MS;
const T4 = T3 + ZOOM_OUT_MS;

const FALL_MS = 800;
const BOUNCES = [
  { ms: 420, h: 1.1 }, // heights in ball diameters
  { ms: 290, h: 0.45 },
  { ms: 190, h: 0.18 },
];
const DROP_TOTAL = FALL_MS + BOUNCES.reduce((a, b) => a + b.ms, 0);

const FOV = 38;
const D_FILL = 1.18; // camera distance (ball radius = 1) where the skin fills the whole screen

const SHEET_CELL = 0.2; // hexagon size of the flat sheet (fraction of the short screen side)
const SHEET_SPEED = 120; // px/s diagonal slide (css px)
const SHEET_ZOOM = 3.5; // how much the cells grow during the dive

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeInCubic = (t: number) => t * t * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/* ------------------------------------------------------------------ */
/*  FLAT football-skin sheet: hexagon lattice, 1 in 3 cells black.     */
/*  Pure 2D, full-screen quad, no lighting, no curve.                  */
/* ------------------------------------------------------------------ */
function makeSheetMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uRes: { value: new THREE.Vector2(1, 1) }, // drawing-buffer size in device px
      uOffset: { value: new THREE.Vector2(0, 0) }, // slide offset in device px
      uCell: { value: 200 }, // hexagon size in device px
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec2 uRes;
      uniform vec2 uOffset;
      uniform float uCell;
      void main() {
        vec2 uv = (gl_FragCoord.xy - 0.5 * uRes - uOffset) / uCell;

        // hexagon lattice (pointy-top, centre-to-centre distance 1)
        const vec2 r = vec2(1.0, 1.7320508);
        const vec2 h = r * 0.5;
        vec2 a = mod(uv, r) - h;
        vec2 b = mod(uv - h, r) - h;
        vec2 gv = dot(a, a) < dot(b, b) ? a : b;
        vec2 id = uv - gv;

        // 3-colouring of the lattice -> exactly every third hexagon is black
        float rowI = floor(id.y / 0.8660254 + 0.5);
        float colH = floor(id.x / 0.5 + 0.5);
        float qa = (colH - rowI) * 0.5;
        float k = mod(qa - rowI, 3.0);
        float isB = 1.0 - step(0.5, k);

        // distance to the nearest hexagon edge
        vec2 g = abs(gv);
        float e = 0.5 - max(g.x, dot(g, vec2(0.5, 0.8660254)));
        float w = fwidth(e) * 1.2 + 1e-4;

        float seam = 1.0 - smoothstep(0.018 - w, 0.018 + w, e);
        float ring = (1.0 - smoothstep(0.0, w * 1.6, abs(e - 0.1))) * isB;

        vec3 base = mix(vec3(0.97), vec3(0.04), isB);
        base = mix(base, vec3(0.24), ring * 0.8);
        base *= 0.95 + 0.05 * smoothstep(0.0, 0.25, e);
        vec3 col = mix(base, vec3(0.18), seam);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/* ------------------------------------------------------------------ */
/*  Football material: truncated-icosahedron pattern in the shader     */
/*  12 black pentagons + 20 white hexagons, bright wrap lighting,      */
/*  NO shadows. Light is fixed in view space so it looks identical     */
/*  with the perspective and the orthographic camera.                  */
/* ------------------------------------------------------------------ */
function makeBallMaterial() {
  const phi = (1 + Math.sqrt(5)) / 2;
  const iv: THREE.Vector3[] = [];
  for (const a of [-1, 1])
    for (const b of [-phi, phi])
      iv.push(new THREE.Vector3(0, a, b), new THREE.Vector3(a, b, 0), new THREE.Vector3(b, 0, a));

  const pent = iv.map((v) => v.clone().normalize());
  const hex: THREE.Vector3[] = [];
  for (let i = 0; i < 12; i++)
    for (let j = i + 1; j < 12; j++) {
      if (Math.abs(iv[i].distanceTo(iv[j]) - 2) > 1e-3) continue;
      for (let k = j + 1; k < 12; k++) {
        if (Math.abs(iv[i].distanceTo(iv[k]) - 2) > 1e-3) continue;
        if (Math.abs(iv[j].distanceTo(iv[k]) - 2) > 1e-3) continue;
        hex.push(iv[i].clone().add(iv[j]).add(iv[k]).normalize());
      }
    }

  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uPent: { value: pent }, uHex: { value: hex }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vObj;
      varying vec3 vN;
      varying vec3 vP;
      void main() {
        vObj = position;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vP = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uPent[12];
      uniform vec3 uHex[20];
      uniform float uOpacity;
      varying vec3 vObj;
      varying vec3 vN;
      varying vec3 vP;
      void main() {
        vec3 n = normalize(vObj);
        float best = -9.0;
        float second = -9.0;
        float isP = 0.0;
        for (int i = 0; i < 12; i++) {
          float s = dot(n, uPent[i]);
          if (s > best) { second = best; best = s; isP = 1.0; }
          else if (s > second) { second = s; }
        }
        for (int i = 0; i < 20; i++) {
          float s = dot(n, uHex[i]) / 0.9742;
          if (s > best) { second = best; best = s; isP = 0.0; }
          else if (s > second) { second = s; }
        }
        float gap = best - second;
        float w = fwidth(gap) + 1e-4;
        float seam = 1.0 - smoothstep(0.028 - w, 0.028 + w, gap);

        vec3 base = mix(vec3(0.97), vec3(0.04), isP);
        base *= 0.93 + 0.07 * smoothstep(0.0, 0.18, gap);   // panels are very slightly puffed
        vec3 col = mix(base, vec3(0.22), seam);

        vec3 N = normalize(vN);
        vec3 L = normalize(vec3(-0.45, 0.65, 0.62));
        vec3 V = normalize(-vP);
        float wrap = dot(N, L) * 0.5 + 0.5;
        float light = 0.62 + 0.5 * wrap;                      // bright, soft, no shadow
        float spec = pow(max(dot(N, normalize(L + V)), 0.0), 70.0) * 0.3;

        gl_FragColor = vec4(col * light + spec, uOpacity);
      }
    `,
  });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
interface Props {
  /** element at the right end of the hero title where the ball finally rests (square) */
  slotRef: RefObject<HTMLElement | null>;
  /** called with a PNG of the settled ball so the hero can show it in the slot */
  onLanded: (dataUrl: string) => void;
  /** loader can be unmounted */
  onDone: () => void;
}

export default function LoadingScreen({ slotRef, onLanded, onDone }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const numRef = useRef<HTMLSpanElement>(null);
  const cb = useRef({ onLanded, onDone });
  cb.current = { onLanded, onDone };

  useEffect(() => {
    const mount = mountRef.current;
    const bg = bgRef.current;
    const hud = hudRef.current;
    const num = numRef.current;
    if (!mount || !bg || !hud || !num) return;

    /* lock scrolling while loading (gutter stays reserved so nothing shifts) */
    const html = document.documentElement;
    const prev = { o: html.style.overflow, g: html.style.scrollbarGutter, r: history.scrollRestoration };
    history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
    html.style.scrollbarGutter = "stable";
    html.style.overflow = "hidden";

    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false; // we clear once per frame and layer the flat sheet under the ball
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene(); // the ball
    const persp = new THREE.PerspectiveCamera(FOV, 1, 0.05, 60);
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 3000);
    ortho.position.z = 1500;
    const tanH = Math.tan(THREE.MathUtils.degToRad(FOV / 2));

    const geo = new THREE.SphereGeometry(1, 96, 64);
    const mat = makeBallMaterial();
    const ball = new THREE.Mesh(geo, mat);
    ball.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0.4, 0.2).normalize(), 0.6);
    scene.add(ball);

    const sheetScene = new THREE.Scene(); // the flat football-skin sheet
    const sheetGeo = new THREE.PlaneGeometry(2, 2);
    const sheetMat = makeSheetMaterial();
    const sheet = new THREE.Mesh(sheetGeo, sheetMat);
    sheet.frustumCulled = false;
    sheetScene.add(sheet);

    /* sizes */
    let W = 1;
    let H = 1;
    let dEnd = 5.5; // "whole ball" distance
    let rEnd = 100; // ball radius in px at dEnd
    const dFor = (Rt: number) => {
      const k = (Rt * tanH) / (H / 2);
      return Math.sqrt(1 + k * k) / k;
    };
    const dbSize = new THREE.Vector2();
    let cellDev = 200;
    const resize = () => {
      W = mount.clientWidth || 1;
      H = mount.clientHeight || 1;
      renderer.setSize(W, H, false);
      persp.aspect = W / H;
      persp.updateProjectionMatrix();
      ortho.left = -W / 2;
      ortho.right = W / 2;
      ortho.top = H / 2;
      ortho.bottom = -H / 2;
      ortho.updateProjectionMatrix();
      const rt = Math.min(0.27 * H, 0.34 * W);
      dEnd = dFor(rt);
      rEnd = rt;
      renderer.getDrawingBufferSize(dbSize);
      sheetMat.uniforms.uRes.value.copy(dbSize);
      cellDev = clamp(Math.min(W, H) * SHEET_CELL, 90, 240) * dpr;
      sheetMat.uniforms.uCell.value = cellDev;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    /* snapshot of the settled ball, rendered by a tiny throw-away renderer */
    const snapshot = (size: number, q: THREE.Quaternion) => {
      const px = Math.max(8, Math.round(size * dpr));
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setPixelRatio(1);
      r.setSize(px, px, false);
      r.setClearColor(0x000000, 0);
      const sc = new THREE.Scene();
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      cam.position.z = 5;
      const m = new THREE.Mesh(geo, mat);
      m.quaternion.copy(q);
      sc.add(m);
      mat.uniforms.uOpacity.value = 1;
      r.render(sc, cam);
      const url = r.domElement.toDataURL("image/png");
      r.dispose();
      r.forceContextLoss();
      return url;
    };

    let raf = 0;
    let finished = false;
    let timer = 0;
    const disposeAll = () => {
      ro.disconnect();
      renderer.dispose();
      geo.dispose();
      mat.dispose();
      sheetGeo.dispose();
      sheetMat.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      html.style.overflow = prev.o;
      html.style.scrollbarGutter = prev.g;
      history.scrollRestoration = prev.r;
    };
    const finish = (size: number) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      cb.current.onLanded(snapshot(size, ball.quaternion));
      timer = window.setTimeout(() => cb.current.onDone(), 140); // let React paint the <img> first
    };

    /* reduced motion: skip the show */
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish(slotRef.current?.getBoundingClientRect().width || 120);
      return () => {
        window.clearTimeout(timer);
        disposeAll();
      };
    }

    /* animation state */
    const SPIN = new THREE.Vector3(0.45, 1, 0.3).normalize();
    const AXIS_Z = new THREE.Vector3(0, 0, 1);
    const DIR = new THREE.Vector2(1, 1).normalize(); // diagonal slide, up-right
    const dq = new THREE.Quaternion();
    let lastCount = 1;
    let t0 = 0;
    let last = 0;
    let dropInit = false;
    let Rt = 60;
    let xt = 0;
    let yt = 0;
    let prevX = 0;

    // warm everything before the clock starts
    persp.position.set(0, 0, D_FILL);
    ball.visible = false;
    renderer.compile(sheetScene, persp);
    renderer.compile(scene, persp);
    ball.visible = true;
    renderer.clear();
    renderer.render(sheetScene, persp);

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!t0) {
        t0 = now;
        last = now;
      }
      const t = now - t0;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      /* ---------------- phases 1-3: flat sheet, then perspective ball ---------------- */
      if (t < T4) {
        renderer.clear();

        if (t < T2) {
          // flat sheet slides diagonally; at 100 it speeds up and zooms into mega hexagons
          const v = seg(t, T1, T2);
          const speed = SHEET_SPEED * dpr * (1 + 6 * v * v);
          sheetMat.uniforms.uOffset.value.addScaledVector(DIR, speed * dt);
          sheetMat.uniforms.uCell.value = cellDev * lerp(1, SHEET_ZOOM, easeInCubic(v));
          renderer.render(sheetScene, persp);

          if (t < T1) {
            const n = clamp(Math.round((t / T1) * 100), 1, 100);
            if (n !== lastCount) {
              lastCount = n;
              num.textContent = String(n);
            }
          } else {
            if (lastCount !== 100) {
              lastCount = 100;
              num.textContent = "100";
            }
            hud.style.opacity = String(1 - Math.min(1, v * 2.5));
            // the real ball skin melts in over the flat sheet
            mat.uniforms.uOpacity.value = smooth(0.35, 0.95, v);
            ball.quaternion.premultiply(dq.setFromAxisAngle(SPIN, 0.55 * dt));
            ball.position.set(0, 0, 0);
            persp.position.set(0, 0, D_FILL);
            renderer.render(scene, persp);
          }
          return;
        }

        mat.uniforms.uOpacity.value = 1;
        let d = D_FILL;
        let rate = 0.55;
        if (t >= T3) {
          const w = easeInOutCubic(seg(t, T3, T4));
          d = lerp(D_FILL, dEnd, w);
          rate = lerp(0.55, 0.18, w);
        }
        ball.quaternion.premultiply(dq.setFromAxisAngle(SPIN, rate * dt));
        persp.position.set(0, 0, d);
        renderer.render(scene, persp);
        return;
      }

      /* ---------------- phase 4: orthographic, pixel-space drop ---------------- */
      if (!dropInit) {
        dropInit = true;
        hud.style.display = "none";
        const r = slotRef.current?.getBoundingClientRect();
        if (r && r.width > 0) {
          Rt = r.width / 2;
          xt = r.left + r.width / 2 - W / 2;
          yt = H / 2 - (r.top + r.height / 2);
        } else {
          Rt = rEnd * 0.35;
          xt = W * 0.4;
          yt = -H * 0.3;
        }
        prevX = 0;
      }

      const td = t - T4;
      bg.style.opacity = String(1 - easeOutCubic(clamp(td / 500, 0, 1)));

      let x = xt;
      let y = yt;
      let R = Rt;
      let spin = 0;
      let roll = 0;

      if (td < FALL_MS) {
        const u = td / FALL_MS;
        x = lerp(0, xt, easeInOutQuad(u));
        y = lerp(0, yt, u * u);
        R = lerp(rEnd, Rt, easeOutCubic(u));
        spin = lerp(0.18, 0.4, u);
        roll = -(x - prevX) / Math.max(R, 1);
      } else {
        let rem = td - FALL_MS;
        for (let i = 0; i < BOUNCES.length; i++) {
          const b = BOUNCES[i];
          if (rem < b.ms) {
            const u = rem / b.ms;
            y = yt + b.h * Rt * 2 * 4 * u * (1 - u);
            roll = -(2.2 * (1 - (i + u) / BOUNCES.length)) * dt; // small decaying roll
            break;
          }
          rem -= b.ms;
        }
        spin = 0.2;
      }
      prevX = x;

      ball.quaternion.premultiply(dq.setFromAxisAngle(SPIN, spin * dt));
      if (roll) ball.quaternion.premultiply(dq.setFromAxisAngle(AXIS_Z, roll));
      ball.position.set(x, y, 0);
      ball.scale.setScalar(R);
      renderer.clear();
      renderer.render(scene, ortho);

      if (td >= DROP_TOTAL) finish(Rt * 2);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      disposeAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="status"
      aria-label="Loading"
      className="fixed inset-0 z-[9999] select-none"
      style={{ fontFamily: DISPLAY_FONT }}
    >
      <style>{FONT_IMPORT}</style>

      {/* red backdrop — fades out while the ball drops, revealing the poster */}
      <div ref={bgRef} className="absolute inset-0" style={{ background: RED }} />

      {/* three.js canvas (transparent): flat sheet, then the ball */}
      <div ref={mountRef} className="pointer-events-none absolute inset-0" />

      {/* counter — numbers only */}
      <div
        ref={hudRef}
        className="absolute bottom-[4.7%] left-[1.1%]"
        style={{
          background: RED,
          color: INK,
          padding: "clamp(10px, 1.1vw, 18px)",
          fontWeight: 900,
          fontStretch: "125%",
          lineHeight: 0.8,
          fontVariantNumeric: "tabular-nums",
          fontSize: "clamp(64px, 15vw, 240px)",
        }}
      >
        <span ref={numRef} style={{ display: "inline-block", minWidth: "3ch" }}>
          1
        </span>
      </div>
    </div>
  );
}