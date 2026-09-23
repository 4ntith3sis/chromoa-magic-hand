/**
 * Cat Tool engine — single video source, many small cat particles on canvas.
 *
 * One <video> element provides both video frames and audio.
 * Canvas stamps transparent copies at different positions/sizes/rotations.
 *
 * Activation: hand detected + landmarks valid + hand MOVING (no finger requirement).
 * Deactivation: hand lost, landmarks invalid, or hand still past the grace period.
 */

import type { Point } from "./shapes";

// ── movement thresholds (exported for debug panel) ────────────────────────────
// STOP < START on purpose: hysteresis band prevents MOVING/IDLE flicker.
export const CAT_MOVE_START_THRESHOLD = 0.3;   // px/camera-frame — enter MOVING
export const CAT_MOVE_STOP_THRESHOLD  = 0.12;  // px/camera-frame — still below this
export const CAT_STILL_GRACE_MS       = 250;   // still-time before IDLE → pause
const MOVE_SMOOTHING       = 0.45;  // EMA smoothing for speed + velocity vector
export const CAT_NO_HAND_TICKS        = 3;     // missed detection ticks before NO_HAND

// ── particle config ───────────────────────────────────────────────────────────
export const CAT_MAX_PARTICLES        = 10;         // 10 cats on screen
const CAT_SIZE_MIN         = 140;        // enlarged min size (CSS px)
const CAT_SIZE_MAX         = 200;        // enlarged max size (CSS px)
const PARTICLE_LIFETIME_MS = 99999;      // particles persist — no automatic death
const SPAWN_INTERVAL_MS    = 100;        // spawn interval
const CAT_BURST_COUNT      = 10;         // fill 10 slots on activation

type CatParticle = {
  x: number; y: number; vx: number; vy: number;
  size: number; rot: number; spin: number;
  born: number; phase: number;
};

type FingerStates = { thumb: boolean; index: boolean; middle: boolean; ring: boolean; pinky: boolean };

export type CatMovementState = "MOVING" | "IDLE";
export type CatDirection = "LEFT" | "RIGHT" | "UP" | "DOWN" | "MIXED" | "STABLE";

export class CatEngine {
  private imgEl: HTMLImageElement | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private playing           = false;
  private pendingPlay       = false;
  private becameMoving      = false;   // edge: flipped IDLE→MOVING (burst spawn once)
  private sessionPlayed     = false;   // any successful play this activation session

  smoothedSpeed = 0;
  rawSpeed      = 0;
  /** EMA of the velocity vector (screen px per hand-frame) — drives direction label. */
  velX = 0;
  velY = 0;
  /** Debug-only finger info. NEVER an activation gate. */
  fingerStates: FingerStates = { thumb: false, index: false, middle: false, ring: false, pinky: false };
  extendedCount = 0;
  /** Hand presence/validity for the latest processed frame. */
  handPresent = false;
  landmarksValid = false;

  movementState: CatMovementState = "IDLE";
  direction: CatDirection = "STABLE";
  lastMoveTime = 0;
  private stillSince: number | null = null;

  private history: { cx: number; cy: number }[] = [];
  private prevSmoothed: Point | null = null;
  private stillFrames = 0;
  /** Update-tick bookkeeping: a hand frame sets lastHandSeq = frameSeq. */
  private frameSeq = 0;
  private lastHandSeq = -10;
  private particles: CatParticle[] = [];
  private lastSpawnTime = 0;
  private lastRejectAt = 0;
  private lastRejectMsg = "";

  get isPlaying()               { return this.playing; }
  get videoReadyState()         { return 4; }
  get videoNetworkState()       { return 1; }
  get videoError()              { return null; }
  get videoWidth()              { return this.imgEl?.naturalWidth || 300; }
  get videoHeight()             { return this.imgEl?.naturalHeight || 300; }
  get videoPaused()             { return !this.playing; }
  get videoEnded()              { return false; }
  get videoCurrentTime()        { return this.audioEl?.currentTime || 0; }
  get videoDuration()           { return this.audioEl?.duration || 0; }
  get videoSrc()                { return "/assets/cat.gif"; }

  getParticles(): Array<{ x: number; y: number; size: number }> {
    return this.particles.map((p) => ({ x: p.x, y: p.y, size: p.size }));
  }

  setAssets(img: HTMLImageElement | null, audio: HTMLAudioElement | null) {
    this.imgEl = img;
    this.audioEl = audio;
    if (audio) {
      audio.loop = true;
    }
  }

  setVideo(el: HTMLVideoElement | null) {
    // Backward compatibility stub
  }

  // ── robust finger detection ─────────────────────────────────────────────────

  /**
   * Update debug-only finger info from raw MediaPipe landmarks.
   * Finger count NEVER gates activation — open, fist, or single finger all work.
   */
  processLandmarks(lm: { x: number; y: number; z: number }[]): void {
    if (!lm || lm.length < 21) {
      this.landmarksValid = false;
      this.extendedCount = 0;
      this.fingerStates = { thumb: false, index: false, middle: false, ring: false, pinky: false };
      return;
    }
    this.landmarksValid = true;
    const fingers = this._countExtendedFingers(lm);
    this.extendedCount = fingers.count;
    this.fingerStates  = fingers.states;
  }

  /**
   * Count extended fingers using distance-from-wrist method.
   * Works regardless of hand rotation, tilt, left/right hand, or distance.
   */
  private _countExtendedFingers(lm: { x: number; y: number; z: number }[]): { count: number; states: FingerStates } {
    const s: FingerStates = { thumb: false, index: false, middle: false, ring: false, pinky: false };
    let count = 0;
    const wr = lm[0]; // wrist

    // Non-thumb fingers: tip farther from wrist than PIP joint
    const fingerPairs: [number, number][] = [[8, 6], [12, 10], [16, 14], [20, 18]];
    for (const [tipIdx, pipIdx] of fingerPairs) {
      const tipDist = Math.hypot(lm[tipIdx].x - wr.x, lm[tipIdx].y - wr.y);
      const pipDist = Math.hypot(lm[pipIdx].x - wr.x, lm[pipIdx].y - wr.y);
      const extended = tipDist > pipDist * 1.05;
      if (extended) count++;
    }
    s.index  = Math.hypot(lm[8].x - wr.x, lm[8].y - wr.y) > Math.hypot(lm[6].x - wr.x, lm[6].y - wr.y) * 1.05;
    s.middle = Math.hypot(lm[12].x - wr.x, lm[12].y - wr.y) > Math.hypot(lm[10].x - wr.x, lm[10].y - wr.y) * 1.05;
    s.ring   = Math.hypot(lm[16].x - wr.x, lm[16].y - wr.y) > Math.hypot(lm[14].x - wr.x, lm[14].y - wr.y) * 1.05;
    s.pinky  = Math.hypot(lm[20].x - wr.x, lm[20].y - wr.y) > Math.hypot(lm[18].x - wr.x, lm[18].y - wr.y) * 1.05;

    // Thumb: tip farther from wrist than IP joint
    const tipW = Math.hypot(lm[4].x - wr.x, lm[4].y - wr.y);
    const ipW  = Math.hypot(lm[3].x - wr.x, lm[3].y - wr.y);
    s.thumb = tipW > ipW * 1.15;
    if (s.thumb) count++;

    return { count, states: s };
  }

  // ── hand movement tracking ──────────────────────────────────────────────────

  trackHand(x: number, y: number) {
    this.handPresent = true;
    this.lastHandSeq = this.frameSeq;
    this.history.push({ cx: x, cy: y });
    if (this.history.length > 60) this.history.shift();

    const cx = this.history[this.history.length - 1].cx;
    const cy = this.history[this.history.length - 1].cy;

    if (this.prevSmoothed) {
      const dx = cx - this.prevSmoothed.x;
      const dy = cy - this.prevSmoothed.y;
      this.rawSpeed = Math.hypot(dx, dy);
      this.smoothedSpeed = this.smoothedSpeed * (1 - MOVE_SMOOTHING) + this.rawSpeed * MOVE_SMOOTHING;
      this.velX = this.velX * (1 - MOVE_SMOOTHING) + dx * MOVE_SMOOTHING;
      this.velY = this.velY * (1 - MOVE_SMOOTHING) + dy * MOVE_SMOOTHING;
    } else {
      this.rawSpeed = 0;
      this.smoothedSpeed = 0;
      this.velX = 0;
      this.velY = 0;
    }
    this.prevSmoothed = { x: cx, y: cy };
  }

  /** Called when no hand landmark is visible this tick. */
  markNoHand(): void {
    this.handPresent = false;
  }

  /**
   * Advance one update tick and fold the MOVING/IDLE state machine.
   * When hand stops moving (IDLE), particles disappear immediately.
   */
  private _updateMovement(t: number): void {
    this.frameSeq++;
    const handGone = (this.frameSeq - this.lastHandSeq) > CAT_NO_HAND_TICKS;

    if (handGone || !this.handPresent || !this.landmarksValid) {
      if (this.movementState !== "IDLE") {
        this.movementState = "IDLE";
        this.particles = []; // clear cats when hand is lost
      }
      this.direction = "STABLE";
      this.stillSince = null;
      this.stillFrames = 0;
      return;
    }

    if (this.smoothedSpeed >= CAT_MOVE_START_THRESHOLD) {
      if (this.movementState !== "MOVING") {
        this.movementState = "MOVING";
        this.becameMoving = true;
      }
      this.stillSince = null;
      this.stillFrames = 0;
      this.lastMoveTime = t;
      this._updateDirection();
    } else if (this.smoothedSpeed < CAT_MOVE_STOP_THRESHOLD) {
      this.stillFrames++;
      if (this.movementState === "MOVING") {
        if (this.stillSince === null) this.stillSince = t;
        if (t - this.stillSince >= CAT_STILL_GRACE_MS) {
          this.movementState = "IDLE";
          this.direction = "STABLE";
          this.stillSince = null;
          this.particles = []; // clear cats when hand stops moving
        }
      }
    }
  }

  /** Screen-space dominant direction from the EMA velocity vector. */
  private _updateDirection(): void {
    const ax = Math.abs(this.velX);
    const ay = Math.abs(this.velY);
    if (this.smoothedSpeed < CAT_MOVE_START_THRESHOLD) {
      this.direction = "STABLE";
    } else if (ax > ay * 1.4) {
      this.direction = this.velX > 0 ? "RIGHT" : "LEFT";
    } else if (ay > ax * 1.4) {
      this.direction = this.velY > 0 ? "DOWN" : "UP";
    } else {
      this.direction = "MIXED";
    }
  }

  // ── main loop ───────────────────────────────────────────────────────────────

  update(ctx: CanvasRenderingContext2D, t: number): void {
    this._updateMovement(t);
    this._updateAudioState(t);
    this._updateParticles(t, ctx);
  }

  // ── audio control ───────────────────────────────────────────────────────────

  private _updateAudioState(t: number): void {
    const audio = this.audioEl;
    const wantPlay = this.movementState === "MOVING";

    if (wantPlay && audio && audio.paused && !this.pendingPlay) {
      this.pendingPlay = true;
      audio.play().then(() => {
        this.pendingPlay = false;
        this.playing = true;
        this.sessionPlayed = true;
      }).catch((err) => {
        this.pendingPlay = false;
        this.lastRejectAt = performance.now();
        this.lastRejectMsg = err?.message || String(err);
      });
    } else if (!wantPlay && audio && !audio.paused && !this.pendingPlay) {
      audio.pause();
      this.playing = false;
    } else if (audio && !audio.paused) {
      this.playing = true;
    }
  }

  // ── particles ───────────────────────────────────────────────────────────────

  private _isCollidingWithUI(x: number, y: number, size: number, w: number, h: number): boolean {
    const half = size * 0.5;

    // 1. Camera Bar at bottom center (PHOTO/VIDEO buttons & shutter)
    const camBarMinX = w * 0.5 - 220;
    const camBarMaxX = w * 0.5 + 220;
    const camBarMinY = h - 190;
    if (x + half > camBarMinX && x - half < camBarMaxX && y + half > camBarMinY) {
      return true;
    }

    // 2. Top Wand toolbar
    const topBarMinX = w * 0.5 - 190;
    const topBarMaxX = w * 0.5 + 190;
    const topBarMaxY = 90;
    if (x + half > topBarMinX && x - half < topBarMaxX && y - half < topBarMaxY) {
      return true;
    }

    return false;
  }

  private _spawnParticle(w: number, h: number, existing: CatParticle[]): CatParticle {
    // Dynamically scale cat size based on screen width (responsive down to mobile)
    const scale = Math.min(1, Math.max(0.4, w / 950));
    const baseMin = 130 * scale;
    const baseMax = 190 * scale;
    const size = baseMin + Math.random() * (baseMax - baseMin);
    const halfSize = size * 0.5;
    const padding = 15 * scale; // scaled clearance between cat bounding boxes
    let bestX = w * 0.5;
    let bestY = h * 0.5;
    let minOverlapScore = Infinity;

    for (let attempt = 0; attempt < 120; attempt++) {
      const cx = halfSize + padding + Math.random() * Math.max(10, w - (size + padding * 2));
      const cy = halfSize + padding + Math.random() * Math.max(10, h - (size + padding * 2));

      let collision = false;
      let totalOverlap = 0;

      // Reject candidates that collide with UI buttons (camera bar / photo & video buttons)
      if (this._isCollidingWithUI(cx, cy, size, w, h)) {
        collision = true;
        totalOverlap += 1000;
      }

      for (const other of existing) {
        const requiredDist = (size + other.size) * 0.5 + padding;
        const dx = Math.abs(cx - other.x);
        const dy = Math.abs(cy - other.y);

        if (dx < requiredDist && dy < requiredDist) {
          collision = true;
          totalOverlap += (requiredDist - dx) + (requiredDist - dy);
        }
      }

      // If no collision at all with 20px padding and clear of UI buttons, pick immediately
      if (!collision) {
        bestX = cx;
        bestY = cy;
        break;
      }

      if (totalOverlap < minOverlapScore) {
        minOverlapScore = totalOverlap;
        bestX = cx;
        bestY = cy;
      }
    }

    return {
      x: bestX,
      y: bestY,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      size,
      rot: (Math.random() - 0.5) * 0.15,
      spin: (Math.random() - 0.5) * 0.003,
      born: performance.now(),
      phase: Math.random() * Math.PI * 2,
    };
  }

  private _updateParticles(t: number, ctx: CanvasRenderingContext2D): void {
    if (!ctx.canvas) return;
    const w = ctx.canvas.clientWidth;
    const h = ctx.canvas.clientHeight;
    const now = t;

    if (w === 0 || h === 0) return;

    // Maintain 10 non-overlapping particles while MOVING
    const canSpawn = this.movementState === "MOVING";
    if (canSpawn && this.particles.length < CAT_MAX_PARTICLES) {
      const slotsNeeded = CAT_MAX_PARTICLES - this.particles.length;
      for (let i = 0; i < slotsNeeded; i++) {
        this.particles.push(this._spawnParticle(w, h, this.particles));
      }
    }

    const img = this.imgEl;
    if (this.particles.length === 0) return;

    const isPlayingNow = this.movementState === "MOVING";

    ctx.save();
    for (const p of this.particles) {
      const breathe = 1 + 0.05 * Math.sin(now / 500 + p.phase);
      const sz = p.size * breathe;

      if (isPlayingNow) {
        // Gentle float and sway
        p.x += Math.sin(now / 600 + p.phase) * 0.3;
        p.y += Math.cos(now / 500 + p.phase) * 0.3;

        // Strict AABB repulsion physics to prevent cat boxes from overlapping
        const padding = 15;
        for (const other of this.particles) {
          if (other === p) continue;
          const minSep = (p.size + other.size) * 0.5 + padding;
          const dx = p.x - other.x;
          const dy = p.y - other.y;
          const absDx = Math.abs(dx);
          const absDy = Math.abs(dy);

          if (absDx < minSep && absDy < minSep) {
            const overlapX = minSep - absDx;
            const overlapY = minSep - absDy;

            // Push along axis of least resistance or both
            if (overlapX < overlapY) {
              p.x += (dx >= 0 ? 1 : -1) * overlapX * 0.1;
            } else {
              p.y += (dy >= 0 ? 1 : -1) * overlapY * 0.1;
            }
          }
        }

        // Avoid UI exclusion zones (Camera bar photo/video buttons)
        const half = sz * 0.5;
        const camBarMinX = w * 0.5 - 220;
        const camBarMaxX = w * 0.5 + 220;
        const camBarMinY = h - 190;

        if (p.x + half > camBarMinX && p.x - half < camBarMaxX && p.y + half > camBarMinY) {
          p.y = camBarMinY - half - 5;
        }

        const topBarMinX = w * 0.5 - 190;
        const topBarMaxX = w * 0.5 + 190;
        const topBarMaxY = 90;
        if (p.x + half > topBarMinX && p.x - half < topBarMaxX && p.y - half < topBarMaxY) {
          p.y = topBarMaxY + half + 5;
        }

        // Clamp inside stage bounds with margin
        const margin = sz * 0.5 + 10;
        p.x = Math.max(margin, Math.min(w - margin, p.x));
        p.y = Math.max(margin, Math.min(h - margin, p.y));
      }
    }
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────

  stop(): void {
    this.playing = false;
    this.pendingPlay = false;
    this.movementState = "IDLE";
    this.direction = "STABLE";
    this.becameMoving = false;
    this.sessionPlayed = false;
    this.history = [];
    this.prevSmoothed = null;
    this.smoothedSpeed = 0;
    this.rawSpeed = 0;
    this.velX = 0;
    this.velY = 0;
    this.stillFrames = 0;
    this.stillSince = null;
    this.lastMoveTime = 0;
    this.frameSeq = 0;
    this.lastHandSeq = -10;
    this.handPresent = false;
    this.landmarksValid = false;
    this.particles = [];
    this.lastSpawnTime = 0;
    this.extendedCount = 0;
    this.fingerStates = { thumb: false, index: false, middle: false, ring: false, pinky: false };
    this.lastRejectAt = 0;
    this.lastRejectMsg = "";
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.currentTime = 0;
    }
  }

  // ── debug snapshot ───────────────────────────────────────────────────────────
  /**
   * Returns a plain object with all state needed for the debug panel.
   * Called once per frame from WandStage — no React state involved.
   * Finger count is debug info only, never an activation gate.
   */
  getDebugSnapshot(handsCount: number, toolActive: boolean): {
    handDetected: boolean;
    landmarksValid: boolean;
    landmarkCount: number;
    extendedCount: number;
    fingerStates: FingerStates;
    movementState: CatMovementState;
    direction: CatDirection;
    isMoving: boolean;
    smoothedSpeed: number;
    rawSpeed: number;
    stillFrames: number;
    stillMs: number;
    lastMoveAgoMs: number;
    isPlaying: boolean;
    activationState: "READY" | "WAITING" | "BLOCKED";
    videoState: "LOADING" | "READY" | "PLAYING" | "PAUSED" | "ERROR" | "MISSING";
    videoReadyState: number;
    videoNetworkState: number;
    videoError: MediaError | null;
    videoSrc: string;
    videoPaused: boolean;
    videoEnded: boolean;
    videoWidth: number;
    videoHeight: number;
    videoCurrentTime: number;
    videoDuration: number;
    particleCount: number;
    audioSource: string;
    audioState: "PLAYING" | "PAUSED" | "BLOCKED";
    activationReason: string;
    playRejected: string;
  } {
    const fs = this.fingerStates;
    const handDetected = handsCount > 0;
    const valid = handDetected && this.landmarksValid;
    const videoMissing = !this.imgEl;
    const videoErr = false;
    const videoReady = !videoMissing;
    const moving = this.movementState === "MOVING";
    const recentlyRejected = performance.now() - this.lastRejectAt < 5000 && this.lastRejectMsg !== "";

    // Video state for the panel (element truth wins).
    let videoState: "LOADING" | "READY" | "PLAYING" | "PAUSED" | "ERROR" | "MISSING";
    if (videoMissing) videoState = "MISSING";
    else if (videoErr) videoState = "ERROR";
    else if (this.videoReadyState < 2) videoState = "LOADING";
    else if (!this.videoPaused) videoState = "PLAYING";
    else videoState = "PAUSED";

    // Audio state: single video element, muted per config — mirrors element playback.
    const audioState: "PLAYING" | "PAUSED" | "BLOCKED" =
      recentlyRejected ? "BLOCKED" : !this.videoPaused ? "PLAYING" : "PAUSED";

    // Activation reason, evaluated in priority order.
    // Finger count never appears here — it is debug info only.
    let reason: string;
    if (!toolActive) reason = "CAT_TOOL_INACTIVE";
    else if (videoMissing) reason = "VIDEO_NOT_READY";
    else if (videoErr) reason = "VIDEO_LOAD_ERROR";
    else if (!handDetected) reason = "NO_HAND_DETECTED";
    else if (!valid) reason = "INVALID_LANDMARKS";
    else if (this.videoReadyState < 2) reason = "VIDEO_LOADING";
    else if (this.playing) reason = "ACTIVATION_SUCCESS";
    else if (recentlyRejected && this.movementState === "MOVING") reason = "PLAY_REJECTED";
    else if (this.movementState === "IDLE") reason = this.sessionPlayed ? "PAUSED_HAND_STILL" : "HAND_NOT_MOVING";
    else reason = "ACTIVATION_SUCCESS";

    const activationState: "READY" | "WAITING" | "BLOCKED" =
      videoErr || recentlyRejected ? "BLOCKED"
      : reason === "ACTIVATION_SUCCESS" ? "READY"
      : "WAITING";

    return {
      handDetected,
      landmarksValid: this.landmarksValid,
      landmarkCount: handDetected && this.landmarksValid ? 21 : 0,
      extendedCount: this.extendedCount,
      fingerStates: { ...fs },
      movementState: this.movementState,
      direction: this.direction,
      isMoving: moving,
      smoothedSpeed: this.smoothedSpeed,
      rawSpeed: this.rawSpeed,
      stillFrames: this.stillFrames,
      stillMs: this.stillSince !== null ? Math.max(0, performance.now() - this.stillSince) : 0,
      lastMoveAgoMs: this.lastMoveTime > 0 ? Math.max(0, performance.now() - this.lastMoveTime) : -1,
      isPlaying: this.playing,
      activationState,
      videoState,
      videoReadyState: this.videoReadyState,
      videoNetworkState: this.videoNetworkState,
      videoError: this.videoError ?? null,
      videoSrc: this.videoSrc,
      videoPaused: this.videoPaused,
      videoEnded: this.videoEnded,
      videoWidth: this.videoWidth,
      videoHeight: this.videoHeight,
      videoCurrentTime: this.videoCurrentTime,
      videoDuration: this.videoDuration,
      particleCount: this.particles.length,
      audioSource: "SINGLE_VIDEO_ELEMENT",
      audioState,
      activationReason: reason,
      playRejected: recentlyRejected ? this.lastRejectMsg : "",
    };
  }

  clear(): void { this.stop(); }
}
