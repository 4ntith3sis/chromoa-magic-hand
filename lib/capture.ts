/**
 * Photo + video capture.
 */

type Sources = {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  fit?: "cover" | "contain";
};

/** Draw one composited frame into ctx at the given CSS size. */
function composite(
  ctx: CanvasRenderingContext2D,
  { video, canvas, fit = "cover" }: Sources,
  w: number,
  h: number
) {
  const vw = video.videoWidth || w;
  const vh = video.videoHeight || h;
  const scale =
    fit === "contain" ? Math.min(w / vw, h / vh) : Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;

  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1); // mirror, to match what's on screen
  ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.restore();

  ctx.drawImage(canvas, 0, 0, w, h);
}

export async function capturePhoto(src: Sources): Promise<Blob | null> {
  const w = src.canvas.clientWidth;
  const h = src.canvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const out = document.createElement("canvas");
  out.width = w * dpr;
  out.height = h * dpr;
  const ctx = out.getContext("2d")!;
  ctx.scale(dpr, dpr);

  composite(ctx, src, w, h);

  return new Promise((r) => out.toBlob(r, "image/png"));
}

/** Pick a container the browser will actually record in. */
function pickMimeType(): string {
  const candidates = [
    "video/mp4;codecs=avc1", // Safari / iOS
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return "";
}

export class Recorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private raf = 0;
  private out: HTMLCanvasElement | null = null;
  private mime = "";

  get active() {
    return this.recorder?.state === "recording";
  }

  start(src: Sources) {
    if (this.active) return;

    const w = src.canvas.clientWidth;
    const h = src.canvas.clientHeight;

    // Even dimensions — some encoders reject odd ones.
    const out = document.createElement("canvas");
    out.width = Math.floor(w / 2) * 2;
    out.height = Math.floor(h / 2) * 2;
    const ctx = out.getContext("2d")!;
    this.out = out;

    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, out.width, out.height);
      const sx = out.width / w;
      const sy = out.height / h;
      ctx.save();
      ctx.scale(sx, sy);
      composite(ctx, src, w, h);
      ctx.restore();
    };
    draw();

    this.mime = pickMimeType();
    const stream = out.captureStream(30);
    this.chunks = [];
    this.recorder = new MediaRecorder(
      stream,
      this.mime ? { mimeType: this.mime, videoBitsPerSecond: 4_000_000 } : undefined
    );
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
  }

  stop(): Promise<{ blob: Blob; ext: string } | null> {
    return new Promise((resolve) => {
      const rec = this.recorder;
      if (!rec || rec.state !== "recording") return resolve(null);

      rec.onstop = () => {
        cancelAnimationFrame(this.raf);
        this.out = null;
        this.recorder = null;
        const type = this.mime || "video/webm";
        const blob = new Blob(this.chunks, { type });
        this.chunks = [];
        resolve({ blob, ext: type.includes("mp4") ? "mp4" : "webm" });
      };
      rec.stop();
    });
  }
}

/** Share sheet on mobile, download on desktop. */
export async function saveOrShare(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: blob.type });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch {
      // User dismissed the sheet, or share failed — fall through to download.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
