/**
 * Every wand is the same engine with different numbers.
 * Tune a wand here; you shouldn't need to touch garden.ts.
 */

export type ThemeKey = "flowers" | "stars" | "spells" | "creatures";

export type Theme = {
  key: ThemeKey;
  label: string;
  /** Swap these for your own drawings — see public/icons/. */
  icon: string;
  path: string;
  hint: string;
  accent: string;

  manifest: string;

  /** How particles appear as you move. */
  plantMode: "trail" | "dwell";
  /** 1 = spawns exactly at the fingertip. Lower = trail lags behind. */
  follow: number;
  spacing: number;
  dwellMs: number;

  sizeMin: number;
  sizeMax: number;

  /** Idle behaviour once placed. */
  breatheAmount: number;
  wander: number;
  twinkle: number;
  link: boolean;
  glow: boolean;
  /** Newest particles chase the fingertip after placement. 0 = stay put. */
  chase: number;
  /** Stretch along direction of travel. Sells "alive". */
  squash: number;
  /** Art has numbered evolution stages; 1/2/3 fingers switches between them. */
  evolves: boolean;
  /** A closed fist catches nearby creatures in an orb. */
  catchable: boolean;
  /**
   * "draw"   — trail follows the fingertip (flowers, stars, spells)
   * "summon" — N fingers spawns one at stage N somewhere on screen, and it
   *            drifts around until the player catches it.
   */
  summonMode: "draw" | "summon";
  /** Free-roaming speed in summon mode. 0 = stays put. */
  drift: number;
  /** A closed fist lights the scene: halos fade in and twinkling begins. */
  litByFist: boolean;
  /** Soft halo behind each particle once lit. */
  glowHalo: boolean;
  glowColor: string;
  /** Halo diameter as a multiple of the particle size. */
  glowSize: number;

  /** What an open palm does. */
  burstStyle: "explode" | "driftUp" | "levitate" | "shoot";
  gravity: number;
  drag: number;
  fade: number;

  maxParticles: number;
};

export const THEMES: Partial<Record<ThemeKey, Theme>> = {
  flowers: {
    key: "flowers",
    label: "Flowers",
    icon: "/icons/flowers.webp",
    path: "/",
    hint: "Point to plant · Open your hand to scatter",
    accent: "#f0b4c4",
    manifest: "/art/flowers/manifest.json",
    plantMode: "trail",
    follow: 1,
    spacing: 14,
    dwellMs: 0,
    sizeMin: 22,
    sizeMax: 54,
    breatheAmount: 0.09,
    wander: 0,
    twinkle: 0,
    link: false,
    glow: false,
    chase: 0,
    squash: 0,
    evolves: false,
    catchable: false,
    summonMode: "draw",
    drift: 0,
    burstStyle: "explode",
    gravity: 0.12,
    drag: 0.985,
    fade: 0.012,
    maxParticles: 500,
    litByFist: false,
    glowHalo: false,
    glowColor: "#ffffff",
    glowSize: 2.4,
  },

  stars: {
    key: "stars",
    label: "Constellations",
    icon: "/icons/stars.webp",
    path: "/stars",
    hint: "Point to place a star · Close your fist to light them · Open your hand and make a wish!",
    accent: "#cfe0ff",
    manifest: "/art/stars/manifest.json",
    plantMode: "dwell",
    follow: 1,
    spacing: 40,
    dwellMs: 300,
    sizeMin: 18,
    sizeMax: 46,
    breatheAmount: 0.04,
    wander: 0,
    twinkle: 0.45,
    link: true,
    glow: true,
    chase: 0,
    squash: 0,
    evolves: false,
    catchable: false,
    summonMode: "draw",
    drift: 0,
    burstStyle: "shoot",
    gravity: 0.045, // gentler arc for a slower star
    drag: 1,
    fade: 0.003,
    maxParticles: 220,
    litByFist: true,
    glowHalo: true,
    glowColor: "#fff3c4", // soft warm white-yellow
    glowSize: 3.1,
  },

    /* Hidden until the art is ready — uncomment to bring back.
  spells: {
    key: "spells",
    label: "Spells",
    icon: "/icons/spells.svg",
    path: "/spells",
    hint: "Point to cast · Trace a circle or zigzag · Open your hand to lift",
    accent: "#c9a8ff",
    manifest: "/art/spells/manifest.json",
    plantMode: "trail",
    follow: 0.3, // sparks chase the fingertip — fast moves stretch the trail
    spacing: 9,
    dwellMs: 0,
    sizeMin: 20,
    sizeMax: 54,
    breatheAmount: 0.16,
    wander: 0.25,
    twinkle: 0.3,
    link: false,
    glow: true,
    chase: 0,
    squash: 0,
    evolves: false,
    catchable: false,
    summonMode: "draw",
    drift: 0,
    burstStyle: "levitate",
    gravity: 0.04,
    drag: 0.97,
    fade: 0.02,
    maxParticles: 400,
  },
*/
  creatures: {
    key: "creatures",
    label: "Creatures",
    icon: "/icons/creatures.webp",
    path: "/creatures",
    hint: "Hold up 1, 2 or 3 fingers to summon · Open your hand for a ball · Close it over one to catch",
    accent: "#f6c98a",
    manifest: "/art/creatures/manifest.json",
    plantMode: "trail",
    follow: 0.55,
    spacing: 90, // sparse — these are characters, not confetti
    dwellMs: 0,
    sizeMin: 70,
    sizeMax: 130,
    breatheAmount: 0.13,
    wander: 1.6, // they drift on their own when you stop
    twinkle: 0,
    link: false,
    glow: false,
    chase: 0.035,
    squash: 0.5,
    evolves: true,
    catchable: true,
    summonMode: "summon",
    drift: 2.3,
    burstStyle: "explode",
    gravity: 0.05,
    drag: 0.98,
    fade: 0.009,
    maxParticles: 8,
    litByFist: false,
    glowHalo: false,
    glowColor: "#ffffff",
    glowSize: 2.4,
  },
};

export const THEME_LIST = Object.values(THEMES).filter(
  (t): t is Theme => t !== undefined
);

export function themeFromPath(pathname: string): Theme {
  return THEME_LIST.find((t) => t.path === pathname) ?? THEME_LIST[0];
}

export function getTheme(key: string): Theme | null {
  return THEME_LIST.find((t) => t.key === key) ?? null;
}

export type ToolKey = "flowers" | "stars" | "creatures" | "pen" | "cat";
