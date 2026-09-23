/**
 * Recognizes shapes traced with the fingertip.
 * Deliberately loose — this should feel forgiving, not like handwriting exams.
 */

export type Point = { x: number; y: number };
export type Shape = "circle" | "zigzag" | null;

const MAX_TRAIL = 44;
const MIN_POINTS = 18;

export class ShapeTracer {
  private pts: Point[] = [];
  private lastMatch = 0;

  push(p: Point) {
    const last = this.pts[this.pts.length - 1];
    // Ignore micro-jitter so the path stays meaningful.
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 6) return;
    this.pts.push(p);
    if (this.pts.length > MAX_TRAIL) this.pts.shift();
  }

  clear() {
    this.pts = [];
  }

  /** Center of the current trail — where a cast should originate. */
  center(): Point | null {
    if (this.pts.length === 0) return null;
    let x = 0;
    let y = 0;
    for (const p of this.pts) {
      x += p.x;
      y += p.y;
    }
    return { x: x / this.pts.length, y: y / this.pts.length };
  }

  radius(): number {
    const c = this.center();
    if (!c) return 0;
    let sum = 0;
    for (const p of this.pts) sum += Math.hypot(p.x - c.x, p.y - c.y);
    return sum / this.pts.length;
  }

  /**
   * Returns a shape if the trail matches one, then resets so a single
   * gesture can't fire repeatedly. Cooldown prevents machine-gun casting.
   */
  detect(now: number, cooldownMs = 1100): Shape {
    if (this.pts.length < MIN_POINTS) return null;
    if (now - this.lastMatch < cooldownMs) return null;

    const shape = this.match();
    if (shape) {
      this.lastMatch = now;
      this.pts = [];
    }
    return shape;
  }

  private match(): Shape {
    const c = this.center()!;
    const r = this.radius();
    if (r < 40) return null; // too small to be intentional

    // --- circle: consistent radius + the angle sweeps most of the way round
    let radiusVariance = 0;
    for (const p of this.pts) {
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      radiusVariance += Math.abs(d - r);
    }
    radiusVariance /= this.pts.length * r; // normalized 0–1

    let sweep = 0;
    for (let i = 1; i < this.pts.length; i++) {
      const a1 = Math.atan2(this.pts[i - 1].y - c.y, this.pts[i - 1].x - c.x);
      const a2 = Math.atan2(this.pts[i].y - c.y, this.pts[i].x - c.x);
      let d = a2 - a1;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      sweep += d;
    }

    if (radiusVariance < 0.32 && Math.abs(sweep) > Math.PI * 1.5) {
      return "circle";
    }

    // --- zigzag: several sharp direction reversals along x
    let reversals = 0;
    let dir = 0;
    for (let i = 1; i < this.pts.length; i++) {
      const dx = this.pts[i].x - this.pts[i - 1].x;
      if (Math.abs(dx) < 8) continue;
      const nd = Math.sign(dx);
      if (dir !== 0 && nd !== dir) reversals++;
      dir = nd;
    }

    if (reversals >= 3) return "zigzag";

    return null;
  }
}
