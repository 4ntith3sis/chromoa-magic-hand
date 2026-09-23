import type { Theme } from "./themes";
import type { Family } from "./loadImages";

/**
 * One particle engine, four wands. All behaviour differences come from the
 * Theme passed in — see lib/themes.ts.
 */

export type Particle = {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  img: HTMLImageElement;
  size: number;
  rot: number;
  spin: number;
  born: number;
  phase: number;
  vx: number;
  vy: number;
  alpha: number;
  state: "planted" | "burst";
  prev: Particle | null; // for constellation lines
  pop: number; // 0–1 extra scale, used by the throw gesture
  /** Evolution line this particle belongs to, if the wand has stages. */
  family: HTMLImageElement[] | null;
  /** Base filename of that line, e.g. "Jolteon". Used to name the catch. */
  familyName: string;
  stage: number; // 0-indexed into family
  caught: boolean; // hidden while being sucked into an orb
  /** Per-particle multiplier on the twinkle period, so no two pulse alike. */
  rate: number;
  /** Recent positions, for drawing a streak behind a shooting star. */
  trail: { x: number; y: number }[];
  /** ms to wait before launching, so they leave in a stream. */
  delay: number;
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

const easeOutBack = (x: number) =>
  1 + 1.5 * Math.pow(x - 1, 3) + 0.9 * Math.pow(x - 1, 2);

const GROW_MS = 260;
const BREATHE_MS = 620;
/** How many past positions make up a shooting star's streak. */
const TRAIL_LEN = 26;

/**
 * A soft radial halo, rendered once to an offscreen canvas and then stamped
 * per particle. Building a gradient per star per frame would be far too slow
 * with a few hundred on screen.
 */
let glowSprite: HTMLCanvasElement | null = null;
let glowSpriteColor = "";

function getGlowSprite(color: string): HTMLCanvasElement {
  if (glowSprite && glowSpriteColor === color) return glowSprite;

  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;

  const grad = g.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2
  );
  // Hot core fading to nothing — the falloff is what reads as "glow".
  grad.addColorStop(0, color);
  grad.addColorStop(0.22, color);
  grad.addColorStop(0.55, hexToRgba(color, 0.28));
  grad.addColorStop(1, hexToRgba(color, 0));

  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);

  glowSprite = c;
  glowSpriteColor = color;
  return c;
}

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Shuffled bag: every image appears once before any repeats. */
let bag: number[] = [];
let lastDrawn = -1;

export function resetBag() {
  bag = [];
  lastDrawn = -1;
}

function nextImageIndex(count: number): number {
  if (bag.length === 0) {
    bag = Array.from({ length: count }, (_, i) => i);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    if (bag.length > 1 && bag[bag.length - 1] === lastDrawn) {
      [bag[bag.length - 1], bag[0]] = [bag[0], bag[bag.length - 1]];
    }
  }
  lastDrawn = bag.pop()!;
  return lastDrawn;
}

function spawn(
  garden: Particle[],
  x: number,
  y: number,
  images: HTMLImageElement[],
  theme: Theme,
  pop = 0,
  families?: Family[]
) {
  const prev =
    theme.link && garden.length > 0 ? garden[garden.length - 1] : null;

  // Evolution wands pick a whole family and start at stage 1.
  let family: HTMLImageElement[] | null = null;
  let familyName = "";
  let img: HTMLImageElement;
  if (theme.evolves && families && families.length > 0) {
    const f = families[(Math.random() * families.length) | 0];
    family = f.images;
    familyName = f.name;
    img = family[0];
  } else {
    img = images[nextImageIndex(images.length)];
  }

  garden.push({
    x,
    y,
    homeX: x,
    homeY: y,
    img,
    size: rand(theme.sizeMin, theme.sizeMax),
    rot: theme.link || theme.chase > 0 ? 0 : rand(0, Math.PI * 2),
    spin: rand(-0.04, 0.04),
    born: performance.now(),
    phase: rand(0, Math.PI * 2),
    vx: 0,
    vy: 0,
    alpha: 1,
    state: "planted",
    prev: prev && prev.state === "planted" ? prev : null,
    pop,
    family,
    familyName,
    stage: 0,
    caught: false,
    rate: rand(0.55, 1.7),
    trail: [],
    delay: 0,
  });

  if (garden.length > theme.maxParticles) garden.shift();
}

/**
 * Plant along the path from lastPoint to (x, y). Hand detection only runs at
 * camera frame rate, so a fast stroke would otherwise leave visible gaps.
 */
export function plant(
  garden: Particle[],
  x: number,
  y: number,
  images: HTMLImageElement[],
  lastPoint: { x: number; y: number } | null,
  theme: Theme,
  families?: Family[]
): { x: number; y: number } | null {
  if (images.length === 0) return lastPoint;

  if (!lastPoint) {
    spawn(garden, x, y, images, theme, 0, families);
    return { x, y };
  }

  const dx = x - lastPoint.x;
  const dy = y - lastPoint.y;
  const dist = Math.hypot(dx, dy);
  if (dist < theme.spacing) return lastPoint;

  const steps = Math.min(Math.floor(dist / theme.spacing), 10);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    spawn(garden, lastPoint.x + dx * t, lastPoint.y + dy * t, images, theme, 0, families);
  }

  return { x, y };
}

/** Place one particle regardless of spacing — dwell mode and the throw gesture. */
export function place(
  garden: Particle[],
  x: number,
  y: number,
  images: HTMLImageElement[],
  theme: Theme,
  pop = 0,
  families?: Family[]
) {
  if (images.length === 0) return;
  spawn(garden, x, y, images, theme, pop, families);
}

/**
 * Open palm.
 *   explode  — firework outward from the wrist
 *   driftUp  — the whole composition lifts away and shrinks
 *   levitate — freeze, then rise slowly and wink out
 */
export function burst(
  garden: Particle[],
  originX: number,
  originY: number,
  theme: Theme
) {
  for (const p of garden) {
    if (p.state === "burst") continue;
    p.state = "burst";

    if (theme.burstStyle === "shoot") {
      // Fast to the right and slightly upward; gravity bends it into an arc.
      p.vx = rand(7, 11);
      p.vy = rand(-5.5, -3.4);
      p.spin = 0;
      p.trail = [];
      p.delay = 0; // all at once
      p.born = performance.now();
    } else if (theme.burstStyle === "driftUp") {
      p.vx = rand(-0.5, 0.5);
      p.vy = rand(-1.6, -0.6);
      p.spin = rand(-0.01, 0.01);
    } else if (theme.burstStyle === "levitate") {
      p.vx = rand(-0.25, 0.25);
      p.vy = rand(-0.9, -0.3);
      p.spin = rand(-0.03, 0.03);
    } else {
      const angle = Math.atan2(p.y - originY, p.x - originX) + rand(-0.3, 0.3);
      const power = rand(6, 15);
      p.vx = Math.cos(angle) * power;
      p.vy = Math.sin(angle) * power - 3;
      p.spin = rand(-0.12, 0.12);
    }
  }
}

/** Cast a traced shape: a ring of particles around a center. */
export function castRing(
  garden: Particle[],
  cx: number,
  cy: number,
  radius: number,
  images: HTMLImageElement[],
  theme: Theme,
  count = 26
) {
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count;
    spawn(
      garden,
      cx + Math.cos(a) * radius,
      cy + Math.sin(a) * radius,
      images,
      theme,
      0.6
    );
  }
}

/** Cast a bolt: particles along a jagged vertical path. */
export function castBolt(
  garden: Particle[],
  x: number,
  y: number,
  images: HTMLImageElement[],
  theme: Theme,
  height = 260
) {
  const steps = 22;
  let px = x;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    px += rand(-26, 26);
    spawn(garden, px, y - height * t, images, theme, 0.5);
  }
}

/**
 * Summon one creature at a given stage, at a random spot on screen, drifting.
 * Used by the "hold up N fingers" gesture — the player has to chase it down.
 */
export function summon(
  garden: Particle[],
  stage: number,
  w: number,
  h: number,
  images: HTMLImageElement[],
  theme: Theme,
  families: Family[]
): Particle | null {
  if (families.length === 0) return null;

  // Keep clear of the UI: wand switcher on top, camera bar below.
  const pad = 90;
  const x = rand(pad, Math.max(pad + 1, w - pad));
  const y = rand(140, Math.max(141, h - 220));

  spawn(garden, x, y, images, theme, 0.7, families);
  const p = garden[garden.length - 1];

  const target = Math.min(stage, (p.family?.length ?? 1) - 1);
  p.stage = target;
  if (p.family) p.img = p.family[target];

  // Later evolutions move faster — a stage 3 is meaningfully harder to catch.
  const speed = theme.drift * (1 + target * 0.55);
  const a = rand(0, Math.PI * 2);
  p.vx = Math.cos(a) * speed;
  p.vy = Math.sin(a) * speed;

  return p;
}

/**
 * Move every planted particle to a given evolution stage.
 * Returns true if anything changed, so the caller can show a label.
 */
export function setStage(garden: Particle[], stage: number): boolean {
  let changed = false;
  for (const p of garden) {
    if (p.state !== "planted" || !p.family || p.caught) continue;
    const target = Math.min(stage, p.family.length - 1);
    if (target === p.stage) continue;
    p.stage = target;
    p.img = p.family[target];
    p.pop = 0.55; // squash-and-settle on the swap
    changed = true;
  }
  return changed;
}

/** Extra size multiplier per stage — later forms read as bigger. */
export function stageScale(stage: number): number {
  return 1 + stage * 0.3;
}

/* ---------------------------------------------------------------- catching */

/** How close the ball must be to a creature's centre, as a fraction of its size. */
const CATCH_REACH = 0.85;

const BALL_SIZE = 96;

const SHUT_MS = 160;    // open ball snaps closed
const SHAKE_MS = 720;   // two quick wobbles
const BURST_MS = 440;   // stars spring out and the ball vanishes
export const CATCH_TOTAL = SHUT_MS + SHAKE_MS + BURST_MS;

type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  size: number;
  img: HTMLImageElement;
};

export type Catch = {
  x: number;
  y: number;
  born: number;
  sparks: Spark[];
  burstFired: boolean;
};

/**
 * Try to catch. Returns the caught creature, or null on a miss.
 * The ball has to actually be over one — that's the whole game.
 */
export function tryCatch(
  garden: Particle[],
  x: number,
  y: number
): Particle | null {
  let best: Particle | null = null;
  let bestD = Infinity;

  for (const p of garden) {
    if (p.state !== "planted" || p.caught) continue;
    const reach = Math.max(BALL_SIZE, p.size) * CATCH_REACH;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < reach && d < bestD) {
      best = p;
      bestD = d;
    }
  }

  if (best) best.caught = true;
  return best;
}

export function newCatch(x: number, y: number): Catch {
  return { x, y, born: performance.now(), sparks: [], burstFired: false };
}

/** The open ball resting in an open hand, before any catch. */
export function drawHeldBall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ballOpen: HTMLImageElement | null,
  accent: string,
  appear: number // 0-1 pop-in
) {
  const s = BALL_SIZE * easeOutBack(Math.min(1, appear));
  if (s <= 0) return;
  drawBall(ctx, x, y, s, ballOpen, accent, 1, 0, 0, true);
}

/**
 * A successful catch:
 *   1. the open ball snaps shut
 *   2. three wobbles while it glows
 *   3. stars spring out firework-style and the ball vanishes
 *
 * Returns false once the sequence is done and can be dropped.
 */
export function stepCatch(
  c: Catch,
  garden: Particle[],
  ctx: CanvasRenderingContext2D,
  t: number,
  ball: HTMLImageElement | null,
  accent: string,
  starImages: HTMLImageElement[],
  dt = 1
): boolean {
  const age = t - c.born;

  if (age > CATCH_TOTAL) {
    for (let i = garden.length - 1; i >= 0; i--) {
      if (garden[i].caught) garden.splice(i, 1);
    }
    return false;
  }

  let scale = 1;
  let tilt = 0;
  let glow = 0;

  if (age < SHUT_MS) {
    // Snap shut with a small squash.
    const k = age / SHUT_MS;
    scale = 1 + Math.sin(k * Math.PI) * 0.18;
    glow = k * 0.4;
  } else if (age < SHUT_MS + SHAKE_MS) {
    // Three decaying wobbles — the tense bit.
    const k = (age - SHUT_MS) / SHAKE_MS;
    const shake = Math.sin(k * Math.PI * 4); // two wobbles instead of three
    tilt = shake * 0.44 * (1 - k * 0.6);
    scale = 1 + Math.abs(shake) * 0.05 * (1 - k);
    glow = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(age / 110));
  } else {
    const k = (age - SHUT_MS - SHAKE_MS) / BURST_MS;

    // Fire the stars once, at the moment of confirmation.
    if (!c.burstFired) {
      c.burstFired = true;
      const n = 16;
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + rand(-0.2, 0.2);
        const speed = rand(5, 11);
        c.sparks.push({
          x: c.x,
          y: c.y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          rot: rand(0, Math.PI * 2),
          spin: rand(-0.18, 0.18),
          size: rand(16, 34),
          img: starImages.length
            ? starImages[(Math.random() * starImages.length) | 0]
            : (null as unknown as HTMLImageElement),
        });
      }
    }

    scale = 1 - k;
    glow = (1 - k) * 1.1;
  }

  // Stars fly outward, slow down, tumble, and fade.
  if (c.sparks.length) {
    const k = Math.min(1, (age - SHUT_MS - SHAKE_MS) / BURST_MS);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const sp of c.sparks) {
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.vy += 0.12 * dt; // a little gravity so it arcs
      sp.vx *= Math.pow(0.94, dt);
      sp.vy *= Math.pow(0.94, dt);
      sp.rot += sp.spin * dt;

      const a = 1 - k;
      if (a <= 0) continue;
      const ss = sp.size * (0.6 + 0.4 * (1 - k));
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(sp.x, sp.y);
      ctx.rotate(sp.rot);
      if (sp.img) {
        ctx.drawImage(sp.img, -ss / 2, -ss / 2, ss, ss);
      } else {
        ctx.fillStyle = "#fff3c4";
        ctx.beginPath();
        ctx.arc(0, 0, ss / 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  if (scale > 0) {
    drawBall(ctx, c.x, c.y, BALL_SIZE * scale, ball, accent, scale, tilt, glow);
  }
  return true;
}

function drawBall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  ball: HTMLImageElement | null,
  accent: string,
  alpha: number,
  tilt: number,
  glow = 0,
  open = false
) {
  if (glow > 0.01) {
    const sprite = getGlowSprite("#fff6d0");
    const gs = s * 2.6;
    ctx.save();
    ctx.globalAlpha = Math.min(1, glow) * alpha;
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(sprite, x - gs / 2, y - gs / 2, gs, gs);
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.translate(x, y);
  ctx.rotate(tilt);

  if (ball) {
    ctx.drawImage(ball, -s / 2, -s / 2, s, s);
  } else {
    // Fallback if no ball art is present.
    ctx.beginPath();
    ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(11,15,12,0.85)";
    if (open) {
      // Split halves so the fallback still reads as "open".
      ctx.beginPath();
      ctx.moveTo(-s / 2, -s * 0.12);
      ctx.lineTo(s / 2, -s * 0.12);
      ctx.moveTo(-s / 2, s * 0.12);
      ctx.lineTo(s / 2, s * 0.12);
    } else {
      ctx.beginPath();
      ctx.moveTo(-s / 2, 0);
      ctx.lineTo(s / 2, 0);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(11,15,12,0.85)";
    ctx.fill();
  }
  ctx.restore();
}

let lastStepT = 0;

export function frameDelta(): number {
  return lastDt;
}
let lastDt = 1;

export function step(
  garden: Particle[],
  ctx: CanvasRenderingContext2D,
  t: number,
  theme: Theme,
  tip: { x: number; y: number } | null,
  /**
   * 0–1. Stars are placed unlit; closing a fist ramps this to 1 and the
   * constellation lights up. Nothing glows while this is 0.
   */
  lit = 0
) {
  // Constellation lines first, so they sit behind the art.
  if (theme.link) {
    ctx.save();
    ctx.strokeStyle = "rgba(207, 224, 255, 0.32)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const p of garden) {
      if (!p.prev || p.state === "burst" || p.prev.state === "burst") continue;
      ctx.moveTo(p.prev.x, p.prev.y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (theme.glow) ctx.globalCompositeOperation = "lighter";

  // Screen size, for creatures that bounce off the edges.
  const w = ctx.canvas.clientWidth || ctx.canvas.width;
  const h = ctx.canvas.clientHeight || ctx.canvas.height;

  const dt = lastStepT
    ? Math.max(0, Math.min(3, (t - lastStepT) / 16.667))
    : 1;
  lastStepT = t;
  lastDt = dt;

  // Only the few most recent creatures chase the finger; the rest settle.
  const chaseFrom = garden.length - 3;

  for (let i = garden.length - 1; i >= 0; i--) {
    const p = garden[i];
    if (p.caught) continue; // the catch orb draws these itself
    let scale = 1;
    let alpha = p.alpha;
    let sx = 1;
    let sy = 1;
    let glowK = 0; // 0–1 halo brightness for this frame

    if (p.state === "planted") {
      const grow = Math.min(1, (t - p.born) / GROW_MS);
      const breathe = 1 + Math.sin(t / BREATHE_MS + p.phase) * theme.breatheAmount;
      scale = easeOutBack(grow) * breathe;

      if (p.pop > 0) {
        scale *= 1 + p.pop;
        p.pop *= 0.86; // decays back to normal
      }

      p.rot += p.spin * 0.15;

      // Chase the fingertip with lag, then squash along the direction of travel.
      if (theme.chase > 0 && tip && i >= chaseFrom) {
        const dx = tip.x - p.x;
        const dy = tip.y - p.y;
        p.vx += dx * theme.chase;
        p.vy += dy * theme.chase;
        p.vx *= 0.82;
        p.vy *= 0.82;
        p.x += p.vx;
        p.y += p.vy;
        p.homeX = p.x;
        p.homeY = p.y;

        const speed = Math.hypot(p.vx, p.vy);
        const stretch = Math.min(speed / 26, 1) * theme.squash;
        sx = 1 + stretch;
        sy = 1 - stretch * 0.6;
        p.rot = speed > 0.6 ? Math.atan2(p.vy, p.vx) : p.rot;
      } else if (theme.drift > 0) {
        // Free-roaming: drift across the screen, bouncing off the edges, with
        // a slow bob so it reads as alive rather than as a sliding sticker.
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        const m = p.size * 0.5;
        if (p.x < m) { p.x = m; p.vx = Math.abs(p.vx); }
        if (p.x > w - m) { p.x = w - m; p.vx = -Math.abs(p.vx); }
        if (p.y < 130) { p.y = 130; p.vy = Math.abs(p.vy); }
        if (p.y > h - 200) { p.y = h - 200; p.vy = -Math.abs(p.vy); }

        // Face the direction of travel.
        sx = p.vx < 0 ? -1 : 1;
        p.y += Math.sin(t / 620 + p.phase) * 0.5;
      } else if (theme.wander > 0) {
        // Slow self-directed drift — what makes creatures feel alive.
        p.x = p.homeX + Math.sin(t / 1400 + p.phase) * theme.wander * 6;
        p.y = p.homeY + Math.cos(t / 1900 + p.phase * 1.7) * theme.wander * 4;
      }

      // Unlit stars sit steady. Once lit, each pulses at its own rate.
      if (theme.twinkle > 0 && lit > 0.01) {
        const wave = 0.5 + 0.5 * Math.sin((t / 380) * p.rate + p.phase);
        alpha = 1 - theme.twinkle * wave * lit;
        glowK = (0.35 + 0.65 * (1 - wave)) * lit;
      }
    } else if (theme.burstStyle === "shoot") {
      // Hold position until this star's turn, so they leave in a stream.
      const waited = t - p.born;
      if (waited < p.delay) {
        glowK = lit;
      } else {
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > TRAIL_LEN) p.trail.shift();

        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += theme.gravity * dt; // positive gravity bends the arc back down
        p.rot = Math.atan2(p.vy, p.vx);
        p.alpha -= theme.fade * dt;
        alpha = p.alpha;
        glowK = p.alpha;

        // Gone once it clears the right edge or fades out.
        if (p.alpha <= 0 || p.x - p.size > ctx.canvas.width) {
          garden.splice(i, 1);
          continue;
        }
      }
    } else {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += theme.gravity * dt;
      p.vx *= Math.pow(theme.drag, dt);
      p.vy *= Math.pow(theme.drag, dt);
      p.rot += p.spin * dt;
      p.alpha -= theme.fade * dt;
      alpha = p.alpha;
      scale =
        theme.burstStyle === "explode"
          ? 1 + (1 - p.alpha) * 0.5 // blooms outward
          : 1 - (1 - p.alpha) * 0.4; // shrinks into the sky
          if (theme.twinkle > 0) glowK = p.alpha * 0.6 * lit; // halo fades out with it
      if (p.alpha <= 0) {
        garden.splice(i, 1);
        continue;
      }
    }

    const s = p.size * scale * (p.family ? stageScale(p.stage) : 1);

    // Streak behind a shooting star: tapered, brightest nearest the head.
    if (p.trail.length > 1) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      for (let k = 1; k < p.trail.length; k++) {
        const f = k / p.trail.length; // 0 at the tail, 1 at the head
        ctx.globalAlpha = f * 0.55 * alpha;
        ctx.strokeStyle = theme.glowColor;
        ctx.lineWidth = s * 0.22 * f;
        ctx.beginPath();
        ctx.moveTo(p.trail[k - 1].x, p.trail[k - 1].y);
        ctx.lineTo(p.trail[k].x, p.trail[k].y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Halo first, so the art sits on top of its own light.
    if (theme.glowHalo && glowK > 0.01) {
      const sprite = getGlowSprite(theme.glowColor);
      const gs = s * theme.glowSize;
      ctx.save();
      ctx.globalAlpha = Math.min(1, glowK * 0.9) * Math.max(0, Math.min(1, alpha));
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(sprite, p.x - gs / 2, p.y - gs / 2, gs, gs);
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.drawImage(p.img, (-s * sx) / 2, (-s * sy) / 2, s * sx, s * sy);
    ctx.restore();
  }

  ctx.globalCompositeOperation = "source-over";
}
