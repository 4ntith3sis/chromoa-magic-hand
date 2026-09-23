/** One evolution line: its base filename and its stages in order. */
export type Family = {
  name: string;
  images: HTMLImageElement[];
};

export type ArtSet = {
  /** Flat list — what most wands draw from. */
  images: HTMLImageElement[];
  /**
   * Grouped by base filename, for wands with evolution stages.
   * `emberling1.webp`, `emberling2.webp`, `emberling3.webp` become one
   * family of three. A file with no trailing digit is a family of one.
   */
  families: Family[];
};

const cache = new Map<string, ArtSet>();

/** "ember2.webp" -> { base: "ember", stage: 2 } */
function parseName(name: string): { base: string; stage: number } {
  const stem = name.replace(/\.[^.]+$/, "");
  const m = stem.match(/^(.*?)(\d+)$/);
  if (!m) return { base: stem, stage: 1 };
  return { base: m[1], stage: parseInt(m[2], 10) };
}

export async function loadImages(manifestPath: string): Promise<ArtSet> {
  const cached = cache.get(manifestPath);
  if (cached) return cached;

  const res = await fetch(manifestPath);
  if (!res.ok) throw new Error(`Could not read ${manifestPath}`);

  const files: string[] = await res.json();
  const base = manifestPath.replace(/manifest\.json$/, "");

  const loaded = await Promise.all(
    files.map(
      (name) =>
        new Promise<{ name: string; img: HTMLImageElement } | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ name, img });
          img.onerror = () => {
            console.warn(`Skipping missing art: ${name}`);
            resolve(null);
          };
          img.src = base + name;
        })
    )
  );

  const ok = loaded.filter(
    (v): v is { name: string; img: HTMLImageElement } => v !== null
  );

  const byBase = new Map<string, { stage: number; img: HTMLImageElement }[]>();
  for (const { name, img } of ok) {
    const { base: b, stage } = parseName(name);
    const list = byBase.get(b) ?? [];
    list.push({ stage, img });
    byBase.set(b, list);
  }

  const families: Family[] = [];
  for (const [name, list] of byBase.entries()) {
    list.sort((a, b) => a.stage - b.stage);
    families.push({ name, images: list.map((v) => v.img) });
  }

  const set: ArtSet = { images: ok.map((v) => v.img), families };
  cache.set(manifestPath, set);
  return set;
}

/** Single image outside the manifest system — e.g. the catch orb. */
export function loadOne(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}