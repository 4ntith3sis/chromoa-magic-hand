/**
 * What each creature is *called* at each stage, and the running tally.
 *
 * The key is the base filename of the family (Jolteon1.webp -> "Jolteon").
 * The array is the display name at stage 1, 2, 3.
 *
 * This is also how the Eevee line dedupes: all four eeveelution families
 * name their stage 1 "Eevee", so the dex counts them as one creature.
 */
export const SPECIES: Record<string, string[]> = {
  Bulbasaur: ["Bulbasaur", "Ivysaur", "Venusaur"],
  Charmander: ["Charmander", "Charmeleon", "Charizard"],
  Squirtle: ["Squirtle", "Wartortle", "Blastoise"],
  Pikachu: ["Pichu", "Pikachu", "Raichu"],
  Jigglypuff: ["Igglybuff", "Jigglypuff", "Wigglytuff"],
  Diglett: ["Diglett", "Dugtrio"],
  Jolteon: ["Eevee", "Jolteon"],
  Vaporeon: ["Eevee", "Vaporeon"],
  Umbreon: ["Eevee", "Umbreon"],
  Sylveon: ["Eevee", "Sylveon"],
};

/** Display name for a family at a given stage index. */
export function speciesName(familyName: string, stage: number): string {
  const line = SPECIES[familyName];
  if (line && line[stage]) return line[stage];
  return stage > 0 ? `${familyName} ${stage + 1}` : familyName;
}

/** How many distinct creatures exist to be found. */
export function totalSpecies(): number {
  const all = new Set<string>();
  for (const line of Object.values(SPECIES)) {
    for (const n of line) all.add(n);
  }
  return all.size;
}

/** One row in the collection grid. */
export type Entry = {
  name: string;
  /** Art to display — shown in silhouette until it's been caught. */
  src: string;
};

/**
 * Every catchable species, in SPECIES order, paired with its artwork.
 *
 * Deduped by display name, so the four eeveelution families contribute a
 * single "Eevee" entry rather than four identical ones.
 */
export function buildCatalog(
  families: { name: string; images: { src: string }[] }[]
): Entry[] {
  const byFamily = new Map(families.map((f) => [f.name, f.images]));
  const seen = new Set<string>();
  const out: Entry[] = [];

  const order = [
    ...Object.keys(SPECIES).filter((k) => byFamily.has(k)),
    ...families.map((f) => f.name).filter((n) => !(n in SPECIES)),
  ];

  for (const familyName of order) {
    const images = byFamily.get(familyName);
    if (!images) continue;
    images.forEach((img, stage) => {
      const name = speciesName(familyName, stage);
      if (seen.has(name)) return;
      seen.add(name);
      out.push({ name, src: img.src });
    });
  }

  return out;
}

export type Dex = Record<string, number>;

export function addToDex(dex: Dex, name: string): Dex {
  return { ...dex, [name]: (dex[name] ?? 0) + 1 };
}

/** Total creatures caught, counting duplicates. */
export function dexTotal(dex: Dex): number {
  return Object.values(dex).reduce((a, b) => a + b, 0);
}

/** How many distinct creatures have been found. */
export function dexUnique(dex: Dex): number {
  return Object.keys(dex).length;
}

/** Pad a dex number the way the games do: 1 -> "001". */
export function dexNumber(i: number): string {
  return String(i + 1).padStart(3, "0");
}