import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

export async function createHandLandmarker(): Promise<HandLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);

  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      // Served from Google's CDN, not your own hosting. This file is 7.8MB —
      // self-hosting it was ~65% of all bandwidth used.
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

/** MediaPipe landmark indices. */
export const INDEX_TIP = 8;
export const WRIST = 0;

type Landmark = { x: number; y: number; z: number };

// [tip, pip] pairs for index, middle, ring, pinky.
const FINGERS: [number, number][] = [
  [8, 6],
  [12, 10],
  [16, 14],
  [20, 18],
];

/** Open palm: all four non-thumb fingers clearly extended above their joints. */
export function isOpenHand(lm: Landmark[]): boolean {
  return FINGERS.every(([tip, pip]) => lm[tip].y < lm[pip].y - 0.04);
}

/** Pointing: index up, the other three curled. This is the drawing pose. */
export function isPointing(lm: Landmark[]): boolean {
  const indexUp = lm[8].y < lm[6].y - 0.03;
  const othersDown =
    lm[12].y > lm[10].y && lm[16].y > lm[14].y && lm[20].y > lm[18].y;
  return indexUp && othersDown;
}

/** Pen Tool gesture: index finger extended, regardless of other fingers. */
/** Uses distance from wrist as robust check that works for any hand orientation. */
export function isIndexUp(lm: Landmark[]): boolean {
  // Primary: simple Y-comparison (works when hand is upright)
  const yCheck = lm[8].y < lm[6].y - 0.015;
  // Fallback: distance-based check — tip farther from wrist than MCP
  const wr = lm[0];
  const tipDist = Math.hypot(lm[8].x - wr.x, lm[8].y - wr.y);
  const mcpDist = Math.hypot(lm[6].x - wr.x, lm[6].y - wr.y);
  const distCheck = tipDist > mcpDist * 1.05;
  return yCheck || distCheck;
}

/** Bone pairs for drawing the hand skeleton. */
export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/**
 * Rough apparent size of the hand (wrist to middle-finger MCP).
 * Grows as the hand moves toward the camera — used to detect a throw.
 */
export function handSpan(lm: { x: number; y: number }[]): number {
  return Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y);
}

/**
 * How many non-thumb fingers are extended (0–4).
 *
 * Counts *any* N fingers rather than requiring specific ones: extending
 * ring-without-pinky is physically hard for many people, since those tendons
 * are linked. Requiring an exact set would lock people out.
 */
export function extendedCount(lm: Landmark[]): number {
  let n = 0;
  for (const [tip, pip] of FINGERS) {
    if (lm[tip].y < lm[pip].y - 0.03) n++;
  }
  return n;
}

/** Closed fist: every finger curled, tips gathered near the palm. */
export function isFist(lm: Landmark[]): boolean {
  if (extendedCount(lm) > 0) return false;
  const palmX = lm[9].x;
  const palmY = lm[9].y;
  const span = handSpan(lm) || 0.001;
  return FINGERS.every(([tip]) => {
    const d = Math.hypot(lm[tip].x - palmX, lm[tip].y - palmY);
    return d < span * 1.5;
  });
}

// ── robust five-finger detection (rotation/position invariant) ───────────────

/** Squared Euclidean distance between two landmarks — avoids sqrt for perf. */
function dist2(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Count how many non-thumb fingers are extended by comparing
 * tip-wrist distance vs. PIP-wrist distance.
 * A finger is extended when its tip is noticeably farther from the wrist
 * than its intermediate joint — works regardless of hand rotation/orientation.
 */
function countFingerExtensions(lm: Landmark[]): number {
  let n = 0;
  // Wrist landmark (index 0) as reference point.
  const w = lm[WRIST];
  for (const [tip, pip] of FINGERS) {
    const tipDist = Math.sqrt(dist2(lm[tip], w));
    const pipDist = Math.sqrt(dist2(lm[pip], w));
    // Tip must be > 8% farther from wrist than the PIP joint.
    if (tipDist > pipDist * 1.08) n++;
  }
  return n;
}

/**
 * Detect whether the thumb is extended.
 * Uses angle at MCP joint (index 2): an open thumb has angle > 45° between
 * IP→MCP and MCP→Wrist directions. Curled thumb angle approaches 0°.
 */
function isThumbExtended(lm: Landmark[]): boolean {
  const tip  = lm[4];   // thumb tip
  const ip   = lm[3];   // thumb IP
  const mcp  = lm[2];   // thumb MCP
  const wr   = lm[0];   // wrist

  // Vector from MCP toward IP (up the thumb).
  const v1x = ip.x - mcp.x;
  const v1y = ip.y - mcp.y;
  // Vector from MCP toward wrist (down the arm).
  const v2x = wr.x - mcp.x;
  const v2y = wr.y - mcp.y;

  const dot  = v1x * v2x + v1y * v2y;
  const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
  if (len1 < 0.001 || len2 < 0.001) return false;

  // cos(angle) < 0.707 → angle > 45° → thumb extended.
  return dot / (len1 * len2) < 0.72;
}

/**
 * Returns the number of fingers currently extended (0–5).
 * Robust to hand rotation, tilt, left/right hand, and distance from camera.
 */
export function countExtendedFingers(lm: Landmark[]): number {
  if (!lm || lm.length < 21) return 0;
  return countFingerExtensions(lm) + (isThumbExtended(lm) ? 1 : 0);
}

/**
 * True when all five fingers are clearly extended.
 * Uses relative-distance checks so it works in any hand orientation.
 */
export function isOpenFiveFingers(lm: Landmark[]): boolean {
  return countExtendedFingers(lm) === 5;
}