"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import {
  burst,
  castBolt,
  castRing,
  place,
  plant,
  resetBag,
  drawHeldBall,
  frameDelta,
  newCatch,
  setStage,
  step,
  stepCatch,
  summon,
  tryCatch,
  type Catch,
  type Particle,
} from "@/lib/garden";
import {
  createHandLandmarker,
  countExtendedFingers,
  extendedCount,
  HAND_CONNECTIONS,
  handSpan,
  INDEX_TIP,
  isFist,
  isOpenFiveFingers,
  isOpenHand,
  isIndexUp,
  isPointing,
  WRIST,
} from "@/lib/hands";
import { loadImages, loadOne, type ArtSet } from "@/lib/loadImages";
import {
  addToDex,
  buildCatalog,
  dexNumber,
  dexTotal,
  dexUnique,
  speciesName,
  type Dex,
  type Entry,
} from "@/lib/dex";
import { THEME_LIST, getTheme, themeFromPath, type Theme, type ToolKey } from "@/lib/themes";
import { ShapeTracer } from "@/lib/shapes";
import { capturePhoto, Recorder, saveOrShare } from "@/lib/capture";
import { CatEngine, CAT_MOVE_START_THRESHOLD, CAT_MOVE_STOP_THRESHOLD, CAT_STILL_GRACE_MS, CAT_MAX_PARTICLES } from "@/lib/cat";
import { PenEngine } from "@/lib/pen";

const BURST_FRAMES = 4;
const BURST_COOLDOWN_MS = 800;
const DWELL_RADIUS = 26;
const THROW_COOLDOWN_MS = 700;
/** How fast the hand must grow (moving toward camera) to count as a throw. */
const THROW_RATE = 0.055;
/** Frames a stage pose must hold before evolving — stops flicker on transitions. */
const EVOLVE_FRAMES = 3;
const FIST_FRAMES = 4;
const CATCH_COOLDOWN_MS = 900;
/** Frames a summon pose must hold before it fires. */
const SUMMON_FRAMES = 5;
/** Don't let one held pose spray creatures. */
const SUMMON_COOLDOWN_MS = 900;

type Point = { x: number; y: number };
type Mode = "photo" | "video";

const PEN_TOOL: ToolKey = "pen";
const CAT_TOOL: ToolKey = "cat";

/** Tools that render their own output on the canvas instead of using the garden engine. */
const DRAWING_TOOLS: ToolKey[] = [PEN_TOOL];

export default function WandStage() {
  const pathname = usePathname();
  const initialTheme = themeFromPath(pathname);
  const initialTool = pathname === "/pen" ? PEN_TOOL : ((THEME_LIST.find((t) => t.path === pathname)?.key ?? "flowers") as ToolKey);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [activeTool, setActiveTool] = useState<ToolKey>(initialTool);
  const activeToolRef = useRef<ToolKey>(initialTool);

  const gardenRef = useRef<Particle[]>([]);
  const artRef = useRef<ArtSet>({ images: [], families: [] });
  const ballRef = useRef<HTMLImageElement | null>(null);
  const ballOpenRef = useRef<HTMLImageElement | null>(null);
  /** Star art borrowed from the constellation wand, for the catch burst. */
  const starsRef = useRef<HTMLImageElement[]>([]);
  const catchesRef = useRef<Catch[]>([]);
  /** Ball resting in an open hand: where it is and when it appeared. */
  const heldRef = useRef<{ x: number; y: number; born: number } | null>(null);
  const stagePoseRef = useRef<{ n: number; frames: number }>({ n: 0, frames: 0 });
  const fistFramesRef = useRef(0);
  const lastCatchRef = useRef(0);
  const lastSummonRef = useRef(0);
  const litRef = useRef(0);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const themeRef = useRef<Theme>(initialTheme);
  const rafRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const lastPointsRef = useRef<(Point | null)[]>([null, null]);
  const smoothRef = useRef<(Point | null)[]>([null, null]);
  const tipRef = useRef<Point | null>(null);
  const dwellRef = useRef<{ at: Point; since: number; placed: boolean } | null>(null);
  const handsRef = useRef<Point[][]>([]);
  const openFramesRef = useRef(0);
  const lastBurstRef = useRef(0);
  const tracerRef = useRef(new ShapeTracer());
  const spanRef = useRef<number | null>(null);
  const lastThrowRef = useRef(0);
  const recorderRef = useRef(new Recorder());
  const skeletonRef = useRef(true);
  const fitRef = useRef<"cover" | "contain">("cover");
  const penRef = useRef(new PenEngine());
  const catRef = useRef(new CatEngine());
  const catImgRef = useRef<HTMLImageElement>(null);
  const catAudioRef = useRef<HTMLAudioElement>(null);
  const catOverlayRef = useRef<HTMLDivElement>(null);

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [mode, setMode] = useState<Mode>("photo");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [flash, setFlash] = useState(false);
  const [toast, setToast] = useState("");
  const [dex, setDex] = useState<Dex>({});
  const [showDex, setShowDex] = useState(false);
  /** Every catchable species, built from the art once it's loaded. */
  const [catalog, setCatalog] = useState<Entry[]>([]);

  skeletonRef.current = showSkeleton;
  activeToolRef.current = activeTool;

  /** Normalized landmark -> mirrored, object-fit:cover screen coords. */
  const toScreen = useCallback((nx: number, ny: number): Point => {
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const vw = video.videoWidth || cw;
    const vh = video.videoHeight || ch;

    const scale =
      fitRef.current === "contain"
        ? Math.min(cw / vw, ch / vh)
        : Math.max(cw / vw, ch / vh);
    const dw = vw * scale;
    const dh = vh * scale;

    return {
      x: (cw - dw) / 2 + (1 - nx) * dw, // 1 - nx mirrors to match the video
      y: (ch - dh) / 2 + ny * dh,
    };
  }, []);

  const openCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    const old = video.srcObject as MediaStream | null;
    old?.getTracks().forEach((t) => t.stop());

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1920 },
      },
      audio: false,
    });

    video.srcObject = stream;
    await video.play();
  }, []);

  const updateFit = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;

    const screenRatio = canvas.clientWidth / canvas.clientHeight;
    const videoRatio = video.videoWidth / video.videoHeight;
    const mismatch = Math.max(
      videoRatio / screenRatio,
      screenRatio / videoRatio
    );

    const fit = mismatch > 1.25 ? "contain" : "cover";
    fitRef.current = fit;
    video.style.objectFit = fit;
  }, []);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  const switchTool = useCallback((tool: ToolKey) => {
    setActiveTool(tool);
    const th = getTheme(tool) ?? initialTheme;
    themeRef.current = th;
  }, [initialTheme]);

  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !canvas || !landmarker || video.readyState < 2) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const t = performance.now();
    const th = themeRef.current;

    if (video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      const hands = landmarker.detectForVideo(video, t).landmarks ?? [];
      handsRef.current = hands.map((lm) => lm.map((p) => toScreen(p.x, p.y)));

      const anyOpen = hands.some(isOpenHand);
      openFramesRef.current = anyOpen ? openFramesRef.current + 1 : 0;
      const cooling = t - lastBurstRef.current < BURST_COOLDOWN_MS;

      if (DRAWING_TOOLS.includes(activeToolRef.current)) {
        // ---- Pen Tool loop ----
        let penDetected = false;
        hands.forEach((lm, i) => {
          if (i > 1) return;
          const indexUp = isIndexUp(lm);
          const raw = toScreen(lm[INDEX_TIP].x, lm[INDEX_TIP].y);
          // Debug log every ~500ms
          if (t % 500 < 17) {
            console.log(
              `[PenDebug] tool=${activeToolRef.current} hands=${hands.length} ` +
              `indexUp=${indexUp} sx=${raw.x.toFixed(0)} sy=${raw.y.toFixed(0)} ` +
              `strokes=${penRef.current["strokes"]?.length ?? 0} idx=${penRef.current["currentStrokeIdx"] ?? -1} pts=${(penRef.current["strokes"] as any[])?.[penRef.current["currentStrokeIdx"] as number]?.points?.length ?? 0}`
            );
          }
          if (!indexUp) {
            penRef.current.finishStroke(t);
            return;
          }
          penDetected = true;
          penRef.current.addPoint(raw.x, raw.y, t, th.accent);
          // Draw landmark position on canvas
          ctx.save();
          ctx.beginPath();
          ctx.arc(raw.x, raw.y, 6, 0, Math.PI * 2);
          ctx.fillStyle = "#0ff";
          ctx.fill();
          ctx.restore();
        });
        // DEBUG: show detection status text
        if (!penDetected && hands.length > 0) {
          ctx.save();
          ctx.font = "bold 11px monospace";
          ctx.fillStyle = "#f00";
          ctx.fillText("NO INDEX UP", 8, 50);
          ctx.restore();
        }
      } else if (activeToolRef.current === CAT_TOOL) {
        // ---- Cat Tool: ANY hand movement/shake drives video + particles ----
        // No finger-count gate: fist, single finger, or open palm all work.
        // Finger info is tracked only for the debug panel.
        const cat = catRef.current;
        const lm = hands[0];
        if (lm && Array.isArray(lm) && lm.length >= 21) {
          cat.processLandmarks(lm);
          const c = toScreen(lm[9].x, lm[9].y); // palm center in screen px
          cat.trackHand(c.x, c.y);
        } else {
          cat.markNoHand();
        }
      } else if (activeToolRef.current === "creatures" && th.summonMode === "summon") {
        // ---- Pokémon-style loop: summon by finger count, catch with a ball.
        const hand = hands[0];

        if (hand && isOpenHand(hand)) {
          const at = toScreen(hand[9].x, hand[9].y);
          if (heldRef.current) {
            heldRef.current.x = at.x;
            heldRef.current.y = at.y;
          } else {
            heldRef.current = { x: at.x, y: at.y, born: t };
          }
        } else if (hand && isFist(hand) && heldRef.current) {
          const { x, y } = heldRef.current;
          if (t - lastCatchRef.current > CATCH_COOLDOWN_MS) {
            const got = tryCatch(gardenRef.current, x, y);
            lastCatchRef.current = t;
            heldRef.current = null;
            if (got) {
              catchesRef.current.push(newCatch(x, y));
              const name = speciesName(got.familyName, got.stage);
              setDex((d) => addToDex(d, name));
              setToast(`caught ${name}!`);
            } else {
              setToast("so close...");
            }
          }
        } else if (hand && !isOpenHand(hand)) {
          const n = extendedCount(hand);
          const pose = stagePoseRef.current;
          if (n === pose.n) pose.frames++;
          else {
            pose.n = n;
            pose.frames = 1;
          }
          if (
            n >= 1 &&
            n <= 3 &&
            pose.frames === SUMMON_FRAMES &&
            t - lastSummonRef.current > SUMMON_COOLDOWN_MS
          ) {
            const p = summon(
              gardenRef.current,
              n - 1,
              canvas.clientWidth,
              canvas.clientHeight,
              artRef.current.images,
              th,
              artRef.current.families
            );
            if (p) {
              lastSummonRef.current = t;
              setToast(n === 1 ? "a wild one appeared!" : `stage ${n}!`);
            }
          }
        }

        if (!hand) {
          heldRef.current = null;
          stagePoseRef.current = { n: 0, frames: 0 };
        }
      } else if (openFramesRef.current >= BURST_FRAMES && !cooling) {
        const open = hands.find(isOpenHand)!;
        const origin = toScreen(open[WRIST].x, open[WRIST].y);
        burst(gardenRef.current, origin.x, origin.y, th);
        lastBurstRef.current = t;
        lastPointsRef.current = [null, null];
        smoothRef.current = [null, null];
        dwellRef.current = null;
        tracerRef.current.clear();
        tipRef.current = null;
        litRef.current = 0;
      } else if (!anyOpen) {
        if (th.litByFist && hands.some(isFist)) {
          const anyPlanted = gardenRef.current.some((p) => p.state === "planted");
          if (anyPlanted) {
            litRef.current = Math.min(1, litRef.current + 0.035);
          }
        }

        if (th.chase > 0 && hands.length > 0) {
          const span = handSpan(hands[0]);
          const prev = spanRef.current;
          if (
            prev !== null &&
            (span - prev) / prev > THROW_RATE &&
            t - lastThrowRef.current > THROW_COOLDOWN_MS
          ) {
            const tip = toScreen(hands[0][INDEX_TIP].x, hands[0][INDEX_TIP].y);
            place(
              gardenRef.current,
              tip.x,
              tip.y,
              artRef.current.images,
              th,
              0.9,
              artRef.current.families
            );
            lastThrowRef.current = t;
          }
          spanRef.current = span;
        }

        hands.forEach((lm, i) => {
          if (i > 1) return;
          if (!isPointing(lm)) {
            lastPointsRef.current[i] = null;
            smoothRef.current[i] = null;
            if (i === 0) {
              dwellRef.current = null;
              tracerRef.current.clear();
              tipRef.current = null;
            }
            return;
          }

          const raw = toScreen(lm[INDEX_TIP].x, lm[INDEX_TIP].y);

          const prev = smoothRef.current[i];
          const target: Point = prev
            ? {
                x: prev.x + (raw.x - prev.x) * th.follow,
                y: prev.y + (raw.y - prev.y) * th.follow,
              }
            : raw;
          smoothRef.current[i] = target;
          if (i === 0) tipRef.current = raw;

          if (th.key === "spells" && i === 0) {
            const tracer = tracerRef.current;
            tracer.push(raw);
            const shape = tracer.detect(t);
            if (shape === "circle") {
              const c = tracer.center() ?? raw;
              castRing(
                gardenRef.current,
                c.x,
                c.y,
                Math.max(70, tracer.radius()),
                artRef.current.images,
                th
              );
              setToast("✦ shield");
            } else if (shape === "zigzag") {
              castBolt(gardenRef.current, raw.x, raw.y, artRef.current.images, th);
              setToast("⚡ bolt");
            }
          }

          if (th.plantMode === "dwell") {
            if (i > 0) return;
            const d = dwellRef.current;
            if (!d || Math.hypot(d.at.x - target.x, d.at.y - target.y) > DWELL_RADIUS) {
              dwellRef.current = { at: target, since: t, placed: false };
            } else if (!d.placed && t - d.since >= th.dwellMs) {
              place(gardenRef.current, target.x, target.y, artRef.current.images, th);
              d.placed = true;
            }
            return;
          }

          lastPointsRef.current[i] = plant(
            gardenRef.current,
            target.x,
            target.y,
            artRef.current.images,
            lastPointsRef.current[i],
            th,
            artRef.current.families
          );
        });

        for (let i = hands.length; i < 2; i++) {
          lastPointsRef.current[i] = null;
          smoothRef.current[i] = null;
        }
      }

      if (hands.length === 0) {
        spanRef.current = null;
        tipRef.current = null;
        fistFramesRef.current = 0;
        stagePoseRef.current = { n: 0, frames: 0 };
      }
    }

    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

    if (activeToolRef.current === CAT_TOOL) {
      catRef.current.update(ctx, t);
      const particles = catRef.current.getParticles();
      const container = catOverlayRef.current;
      if (container) {
        const imgs = container.querySelectorAll("img");
        imgs.forEach((img, i) => {
          if (i < particles.length) {
            const p = particles[i];
            img.style.display = "block";
            img.style.left = `${p.x}px`;
            img.style.top = `${p.y}px`;
            img.style.width = `${p.size}px`;
            img.style.height = `${p.size}px`;
          } else {
            img.style.display = "none";
          }
        });
      }
    } else {
      const container = catOverlayRef.current;
      if (container) {
        container.querySelectorAll("img").forEach((img) => (img.style.display = "none"));
      }
    }

    if (!DRAWING_TOOLS.includes(activeToolRef.current) && activeToolRef.current !== CAT_TOOL) {
      step(gardenRef.current, ctx, t, th, tipRef.current, litRef.current);
      if (heldRef.current) {
        const held = heldRef.current;
        drawHeldBall(
          ctx,
          held.x,
          held.y,
          ballOpenRef.current ?? ballRef.current,
          th.accent,
          (t - held.born) / 220
        );
      }

      if (catchesRef.current.length > 0) {
        const d = frameDelta();
        catchesRef.current = catchesRef.current.filter((c) =>
          stepCatch(
            c,
            gardenRef.current,
            ctx,
            t,
            ballRef.current,
            th.accent,
            starsRef.current,
            d
          )
        );
      }
    } else if (DRAWING_TOOLS.includes(activeToolRef.current)) {
      penRef.current.draw(ctx, t);
    }



    if (skeletonRef.current) {
      ctx.lineWidth = 2;
      for (const pts of handsRef.current) {
        ctx.strokeStyle = "rgba(243, 239, 230, 0.45)";
        ctx.beginPath();
        for (const [a, b] of HAND_CONNECTIONS) {
          ctx.moveTo(pts[a].x, pts[a].y);
          ctx.lineTo(pts[b].x, pts[b].y);
        }
        ctx.stroke();

        for (let i = 0; i < pts.length; i++) {
          const isTip = i === INDEX_TIP;
          ctx.beginPath();
          ctx.arc(pts[i].x, pts[i].y, isTip ? 7 : 3, 0, Math.PI * 2);
          ctx.fillStyle = isTip
            ? themeRef.current.accent
            : "rgba(243, 239, 230, 0.8)";
          ctx.fill();
        }
      }
    }

    // ── Finger debug dots (always drawn when hands detected) ──────────────────
    if (handsRef.current.length > 0) {
      const TIP_INDICES = [4, 8, 12, 16, 20];
      const FINGER_COLORS = ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#c77dff"];
      const FINGER_LABELS = ["thumb", "index", "middle", "ring", "pinky"];
      for (const pts of handsRef.current) {
        for (let f = 0; f < TIP_INDICES.length; f++) {
          const idx = TIP_INDICES[f];
          if (idx >= pts.length) continue;
          const p = pts[idx];
          // Glow ring
          ctx.beginPath();
          ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
          ctx.fillStyle = FINGER_COLORS[f] + "30";
          ctx.fill();
          // Solid dot
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = FINGER_COLORS[f];
          ctx.fill();
          // Label
          ctx.font = "bold 9px monospace";
          ctx.fillStyle = FINGER_COLORS[f];
          ctx.fillText(FINGER_LABELS[f], p.x + 10, p.y - 6);
        }
      }
    }
  }, [toScreen]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 1100);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      250
    );
    return () => clearInterval(id);
  }, [recording]);

  /** Wire the CatEngine to cat.gif image and cat.mp3 audio elements. */
  useEffect(() => {
    catRef.current.setAssets(catImgRef.current, catAudioRef.current);
  }, []);

  /** Swap art and clear state when the active tool changes. */
  useEffect(() => {
    const th = getTheme(activeTool) ?? initialTheme;
    themeRef.current = th;

    if (!running) return;
    let cancelled = false;
    setStatus("Loading...");

    // Cat Tool: wire the engine to cat.gif and cat.mp3 elements
    if (activeTool === CAT_TOOL) {
      catRef.current.setAssets(catImgRef.current, catAudioRef.current);
      penRef.current.clear();
      gardenRef.current = [];
      catchesRef.current = [];
      heldRef.current = null;
      litRef.current = 0;
      lastPointsRef.current = [null, null];
      smoothRef.current = [null, null];
      dwellRef.current = null;
      tracerRef.current.clear();
      resetBag();
      setStatus("");
      return;
    }

    // Always stop cat engine and pause cat audio when active tool is NOT cat tool
    catRef.current.clear();
    if (catAudioRef.current) {
      catAudioRef.current.pause();
      catAudioRef.current.currentTime = 0;
    }

    if (DRAWING_TOOLS.includes(activeTool)) {
      penRef.current.clear();
      gardenRef.current = [];
      catchesRef.current = [];
      heldRef.current = null;
      litRef.current = 0;
      lastPointsRef.current = [null, null];
      smoothRef.current = [null, null];
      dwellRef.current = null;
      tracerRef.current.clear();
      resetBag();
      setStatus("");
      return;
    }

    loadImages(th.manifest)
      .then((imgs) => {
        if (cancelled) return;
        artRef.current = imgs;
        if (th.summonMode === "summon") {
          setCatalog(buildCatalog(imgs.families));
        }
        gardenRef.current = [];
        catchesRef.current = [];
        heldRef.current = null;
        litRef.current = 0;
        lastPointsRef.current = [null, null];
        smoothRef.current = [null, null];
        dwellRef.current = null;
        tracerRef.current.clear();
        penRef.current.clear();
        resetBag();
        setStatus("");
      })
      .catch(() => !cancelled && setStatus(""));

    return () => {
      cancelled = true;
    };
  }, [activeTool, running, initialTheme]);

  const start = useCallback(async () => {
    setError("");
    try {
      setStatus("Loading art...");
      const th = themeRef.current;
      artRef.current = await loadImages(th.manifest);
      if (th.summonMode === "summon") {
        setCatalog(buildCatalog(artRef.current.families));
      }

      ballRef.current = await loadOne("/catch/ball.webp");
      ballOpenRef.current = await loadOne("/catch/ball-open.webp");

      try {
        starsRef.current = (await loadImages("/art/stars/manifest.json")).images;
      } catch {
        starsRef.current = [];
      }
      setStatus("Loading hand tracking...");
      landmarkerRef.current = await createHandLandmarker();

      setStatus("Starting camera...");
      await openCamera();

      setRunning(true);
      setStatus("");
      resizeCanvas();
      updateFit();
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      setRunning(false);
      setStatus("");
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Camera permission denied. Allow access and try again."
          : err instanceof Error
            ? err.message
            : "Something went wrong."
      );
    }
  }, [loop, openCamera, resizeCanvas, updateFit]);

  /** Stop everything and return to the start screen. */
  const restart = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    landmarkerRef.current?.close();
    catRef.current.stop();
    penRef.current.clear();
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    setRunning(false);
    setActiveTool(initialTool);
    setError("");
    setStatus("");
    gardenRef.current = [];
    catchesRef.current = [];
    heldRef.current = null;
    litRef.current = 0;
    lastPointsRef.current = [null, null];
    smoothRef.current = [null, null];
    dwellRef.current = null;
    tracerRef.current.clear();
    resetBag();
  }, [initialTool]);

  const withSkeletonHidden = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      const was = skeletonRef.current;
      skeletonRef.current = false;
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r))
      );
      try {
        return await fn();
      } finally {
        skeletonRef.current = was;
      }
    },
    []
  );

  const takePhoto = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    setFlash(true);
    setTimeout(() => setFlash(false), 180);

    const blob = await withSkeletonHidden(() =>
      capturePhoto({ video, canvas, fit: fitRef.current })
    );
    if (blob) await saveOrShare(blob, `${themeRef.current.key}-wand.png`);
  }, [withSkeletonHidden]);

  const toggleRecording = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    if (recorderRef.current.active) {
      const result = await recorderRef.current.stop();
      setRecording(false);
      if (result) {
        await saveOrShare(
          result.blob,
          `${themeRef.current.key}-wand.${result.ext}`
        );
      }
    } else {
      skeletonRef.current = false;
      setElapsed(0);
      recorderRef.current.start({ video, canvas, fit: fitRef.current });
      setRecording(true);
    }
  }, [showSkeleton]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "s") setShowSkeleton((v) => !v);
    };
    let wasPortrait = window.innerHeight > window.innerWidth;

    const onResize = () => {
      resizeCanvas();
      const nowPortrait = window.innerHeight > window.innerWidth;
      if (nowPortrait !== wasPortrait && videoRef.current?.srcObject) {
        wasPortrait = nowPortrait;
        openCamera()
          .then(updateFit)
          .catch(() => updateFit());
      } else {
        updateFit();
      }
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(rafRef.current);
      landmarkerRef.current?.close();
      catRef.current.stop();
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [openCamera, resizeCanvas, updateFit]);

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(
    elapsed % 60
  ).padStart(2, "0")}`;

  const squiggleIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: 20, height: 20 }}>
      <path d="M3 12c2-5 5-5 7 0s5 5 7 0" />
    </svg>
  );

  return (
    <main className="stage" style={{ ["--accent" as string]: themeRef.current.accent }}>
      <video
        ref={videoRef}
        playsInline
        muted
        onLoadedMetadata={updateFit}
      />
      <canvas ref={canvasRef} />

      {/* Cat tool assets: cat.gif image + cat.mp3 audio */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={catImgRef}
        src="/assets/cat.gif"
        alt=""
        style={{ display: "none" }}
      />
      <audio
        ref={catAudioRef}
        src="/assets/cat.mp3"
        loop
        preload="auto"
        style={{ display: "none" }}
      />

      {/* 10 animated GIF DOM overlays for Cat Tool */}
      <div ref={catOverlayRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2 }}>
        {Array.from({ length: CAT_MAX_PARTICLES }).map((_, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src="/assets/cat.gif"
            alt=""
            style={{
              position: "absolute",
              display: "none",
              pointerEvents: "none",
              transform: "translate(-50%, -50%)",
            }}
          />
        ))}
      </div>

      {flash && <div className="flash" aria-hidden />}

      {!running && (
        <div className="start">
          <div className="start-icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="32" height="32">
              <path
                d="M12 1.5 L13.9 9.4 L21.5 12 L13.9 14.6 L12 22.5 L10.1 14.6 L2.5 12 L10.1 9.4 Z"
                fill="currentColor"
              />
              <circle cx="19.6" cy="4.8" r="1.5" fill="currentColor" />
              <circle cx="4.6" cy="18.8" r="1.1" fill="currentColor" />
            </svg>
          </div>
          <h1 className="brand-title">CHROMOA</h1>
          <h3 className="brand-subtitle">Magical Hands</h3>
          <h4 className="abilities-title">Your current abilities:</h4>
          <p className="abilities-list">
            Magic Wand, Flower, Constellations, Spawn and Catch Pokemon!, Cats
          </p>
          {error && <p className="error">{error}</p>}
          <button className="primary" onClick={start} disabled={status !== ""}>
            {status || "Start camera"}
          </button>
        </div>
      )}

      {running && (
        <>
          <nav className="wands" aria-label="Choose a tool">
            <button
              className={`tool-btn ${activeTool === PEN_TOOL ? "active" : ""}`}
              onClick={() => { if (!recording) switchTool(PEN_TOOL); }}
              aria-pressed={activeTool === PEN_TOOL}
              aria-label="Pen Tool — draw with your fingertip"
              title="Pen Tool"
              disabled={recording}
            >
              {squiggleIcon}
            </button>
            {THEME_LIST.map((t) => (
              <Link
                key={t.key}
                href={t.path}
                className={`tool-btn ${activeTool === t.key ? "active" : ""}`}
                style={{ ["--tool-accent" as string]: t.accent }}
                aria-label={t.label}
                aria-current={activeTool === t.key ? "page" : undefined}
                title={t.label}
                onClick={() => { if (!recording) switchTool(t.key as ToolKey); }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t.icon} alt="" />
              </Link>
            ))}
            <button
              className={`tool-btn ${activeTool === CAT_TOOL ? "active" : ""}`}
              onClick={() => { if (!recording) switchTool(CAT_TOOL); }}
              aria-pressed={activeTool === CAT_TOOL}
              aria-label="Cat Tool"
              title="Cat Tool"
              disabled={recording}
              style={activeTool === CAT_TOOL ? { ["--tool-accent" as string]: "#c9a8ff" } : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/cat.svg" alt="" />
            </button>
          </nav>

          {activeTool === "creatures" && (
            <button
              className="dex-badge"
              onClick={() => setShowDex(true)}
              aria-label="View your collection"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/catch/ball.webp" alt="" />
              <span>{dexTotal(dex)}</span>
            </button>
          )}

          {showDex && (
            <div
              className="dex-sheet"
              role="dialog"
              aria-label="Your collection"
              onClick={() => setShowDex(false)}
            >
              <div className="dex-panel" onClick={(e) => e.stopPropagation()}>
                <header>
                  <h2>Your collection</h2>
                  <p>
                    {dexUnique(dex)} of {catalog.length} found ·{" "}
                    {dexTotal(dex)} caught
                  </p>
                </header>

                <ul className="dex-grid">
                  {catalog.map((entry, i) => {
                    const n = dex[entry.name] ?? 0;
                    return (
                      <li
                        key={entry.name}
                        className={n > 0 ? "dex-cell found" : "dex-cell"}
                      >
                        <div className="dex-art">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={entry.src} alt="" />
                          {n > 1 && <span className="dex-x">×{n}</span>}
                        </div>
                        <span className="dex-num">{dexNumber(i)}</span>
                        <span className="dex-name">
                          {n > 0 ? entry.name : "???"}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                <button
                  className="primary dex-close"
                  onClick={() => setShowDex(false)}
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {recording && (
            <div className="rec">
              <span className="dot" /> {mmss}
            </div>
          )}

          {toast && <div className="toast">{toast}</div>}

          <div className="hud">{status || (DRAWING_TOOLS.includes(activeTool) ? "Point to draw · Move finger to sketch · Fast swipe adds sparkle" : activeTool === CAT_TOOL ? "Shake or wave your hand to summon cats · Any pose works" : themeRef.current.hint)}</div>

          <div className="camera-bar">
            <div className="modes" role="tablist" aria-label="Capture mode">
              <button
                role="tab"
                aria-selected={mode === "photo"}
                className={mode === "photo" ? "on" : ""}
                onClick={() => !recording && setMode("photo")}
                disabled={recording}
              >
                PHOTO
              </button>
              <button
                role="tab"
                aria-selected={mode === "video"}
                className={mode === "video" ? "on" : ""}
                onClick={() => !recording && setMode("video")}
                disabled={recording}
              >
                VIDEO
              </button>
            </div>

            <button
              className={`shutter ${mode} ${recording ? "recording" : ""}`}
              onClick={mode === "photo" ? takePhoto : toggleRecording}
              aria-label={
                mode === "photo"
                  ? "Take a photo"
                  : recording
                    ? "Stop recording"
                    : "Start recording"
              }
            >
              <span className="inner" />
            </button>
          </div>
        </>
      )}
    </main>
  );
}
