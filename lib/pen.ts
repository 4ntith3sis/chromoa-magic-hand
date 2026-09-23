import type { Point } from "./shapes";

/** Delay after movement stops before stroke starts fading (ms). */
const FADE_DELAY_MS = 300;
/** Duration of smooth fade out once movement stops (ms). */
const FADE_DURATION_MS = 1500;
/** Minimum distance between recorded points to avoid redundant sampling. */
const MIN_DIST = 3;
/** Max acceptable gap between consecutive points — larger gaps trigger interpolation. */
const MAX_GAP_PX = 80;
/** Speed threshold (px per frame) that triggers spark particles. */
const SPARK_THRESHOLD = 6;
/** Max spark particles spawned per frame. */
const MAX_SPARKS_PER_FRAME = 3;
/** Max concurrent spark particles on screen. */
const MAX_TOTAL_SPARKS = 120;
/** Max interpolated points to insert for a single gap. */
const MAX_INTERP_POINTS = 20;

type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 0-1
  size: number;
};

type StrokeSegment = {
  points: Point[];
  born: number;
  color: string;
  finishedAt?: number;
};

export class PenEngine {
  private strokes: StrokeSegment[] = [];
  private sparks: Spark[] = [];
  private lastPoint: Point | null = null;
  private lastSpeed = 0;
  private prevPos: Point | null = null;
  private frameCount = 0;
  /** Index of the stroke currently being drawn (stays open while pointing). */
  private currentStrokeIdx = -1;
  /** Timestamp when index was last detected as up. */
  private lastDetectedAt = 0;
  /** Timestamp when finger actually moved and added a new point. */
  private lastMoveTime = 0;

  get active() {
    return this.strokes.length > 0 || this.sparks.length > 0;
  }

  addPoint(x: number, y: number, t: number, color: string) {
    // Validate coordinates
    if (isNaN(x) || isNaN(y) || x < -1000 || x > 5000 || y < -1000 || y > 5000) {
      return;
    }
    const pt: Point = { x, y };
    this.lastDetectedAt = t;

    if (this.lastPoint) {
      const dist = Math.hypot(pt.x - this.lastPoint.x, pt.y - this.lastPoint.y);
      // Only skip if point is very close (sub-pixel jitter).
      if (dist < MIN_DIST) {
        return;
      }
      // Interpolate if the gap is too large (hand tracking frame drop).
      if (dist > MAX_GAP_PX) {
        const steps = Math.min(Math.floor(dist / MIN_DIST), MAX_INTERP_POINTS);
        for (let i = 1; i <= steps; i++) {
          const f = i / steps;
          const ix = this.lastPoint.x + (pt.x - this.lastPoint.x) * f;
          const iy = this.lastPoint.y + (pt.y - this.lastPoint.y) * f;
          this._pushToCurrentStroke({ x: ix, y: iy }, color, t);
        }
      }
    }

    // Track speed for spark effects.
    let dx = 0;
    let dy = 0;
    if (this.prevPos) {
      dx = pt.x - this.prevPos.x;
      dy = pt.y - this.prevPos.y;
      this.lastSpeed = Math.hypot(dx, dy);
    }
    this.prevPos = pt;

    this.lastMoveTime = t;
    this._pushToCurrentStroke(pt, color, t);
    this.lastPoint = pt;

    // Spawn sparks on fast movement.
    this.frameCount++;
    if (this.lastSpeed >= SPARK_THRESHOLD && this.frameCount % 2 === 0) {
      const n = Math.min(MAX_SPARKS_PER_FRAME, MAX_TOTAL_SPARKS - this.sparks.length);
      for (let i = 0; i < n; i++) {
        const angle = Math.atan2(dy || 0, dx || 1) + (Math.random() - 0.5) * 1.2;
        const speed = this.lastSpeed * (0.3 + Math.random() * 0.5);
        this.sparks.push({
          x: pt.x,
          y: pt.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          size: 1.5 + Math.random() * 2.5,
        });
      }
    }
  }

  /** Append a point to the current active stroke, or start a new one. */
  private _pushToCurrentStroke(pt: Point, color: string, t: number) {
    if (this.currentStrokeIdx >= 0 && this.currentStrokeIdx < this.strokes.length) {
      const seg = this.strokes[this.currentStrokeIdx];
      // Reset finishedAt if previously marked finish
      delete seg.finishedAt;
      seg.points.push(pt);
      seg.color = color;
      if (seg.points.length > 800) seg.points.shift();
    } else {
      const born = t > 0 ? t : performance.now();
      this.strokes.push({ points: [pt], born, color });
      this.currentStrokeIdx = this.strokes.length - 1;
    }
  }

  finishStroke(t: number) {
    // Mark current active stroke as finished so it starts fading out
    if (this.currentStrokeIdx >= 0 && this.currentStrokeIdx < this.strokes.length) {
      const seg = this.strokes[this.currentStrokeIdx];
      if (!seg.finishedAt) {
        seg.finishedAt = t;
      }
    }
    this.lastPoint = null;
    this.prevPos = null;
    this.lastSpeed = 0;
    this.currentStrokeIdx = -1;
  }

  clear() {
    this.strokes = [];
    this.sparks = [];
    this.lastPoint = null;
    this.prevPos = null;
    this.lastSpeed = 0;
    this.frameCount = 0;
    this.currentStrokeIdx = -1;
    this.lastDetectedAt = 0;
    this.lastMoveTime = 0;
  }

  draw(ctx: CanvasRenderingContext2D, t: number) {
    // --- Update & cull sparks ---
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.x += s.vx;
      s.y += s.vy;
      s.vx *= 0.92;
      s.vy *= 0.92;
      s.vy += 0.06; // slight gravity
      s.life -= 0.035;
      if (s.life <= 0) {
        this.sparks.splice(i, 1);
      }
    }

    // Auto-finish active stroke if movement has stopped for FADE_DELAY_MS
    if (this.currentStrokeIdx >= 0 && this.currentStrokeIdx < this.strokes.length) {
      if (t - this.lastMoveTime > FADE_DELAY_MS) {
        const seg = this.strokes[this.currentStrokeIdx];
        if (!seg.finishedAt) {
          seg.finishedAt = t;
        }
        this.currentStrokeIdx = -1;
        // Keep lastPoint recorded so stationary finger doesn't re-trigger a new stroke
      }
    }

    // Fail-safe: ensure any non-active stroke has a finishedAt timestamp set
    for (let i = 0; i < this.strokes.length; i++) {
      if (i !== this.currentStrokeIdx && !this.strokes[i].finishedAt) {
        this.strokes[i].finishedAt = t;
      }
    }

    // --- Cull old finished strokes ---
    this.strokes = this.strokes.filter((seg) => {
      if (!seg.finishedAt) return true; // keep active drawing stroke
      return (t - seg.finishedAt) < FADE_DURATION_MS;
    });

    if (this.strokes.length === 0 && this.sparks.length === 0) {
      return;
    }

    // --- Draw strokes ---
    for (const seg of this.strokes) {
      const pts = seg.points;
      if (pts.length < 2) continue;

      let alpha = 1.0;
      if (seg.finishedAt) {
        const elapsed = t - seg.finishedAt;
        alpha = Math.max(0, 1 - elapsed / FADE_DURATION_MS);
      }

      if (alpha <= 0) continue;

      ctx.save();
      ctx.globalAlpha = alpha;

      // Glow layer — thicker for magical brush feel
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = seg.color;
      ctx.lineWidth = 16;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = alpha * 0.25;
      this._drawPath(ctx, pts);
      ctx.stroke();

      // Core line
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "#fff8e7";
      ctx.lineWidth = 4;
      ctx.globalAlpha = alpha * 0.85;
      this._drawPath(ctx, pts);
      ctx.stroke();

      ctx.restore();
    }

    // --- Cursor dot at last tracked point ---
    if (this.lastPoint) {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ff0";
      ctx.beginPath();
      ctx.arc(this.lastPoint.x, this.lastPoint.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private _drawPath(ctx: CanvasRenderingContext2D, pts: Point[]) {
    if (pts.length === 2) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  }
}
