/** Browser lip-sync driven by audio playback amplitude. */

export type LipSyncHandle = {
  stop: () => void;
};

export function driveLipSyncFromAudio(
  audio: HTMLAudioElement,
  onOpenness: (openness: number) => void
): LipSyncHandle {
  let raf = 0;
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaElementAudioSourceNode | null = null;
  const data = new Uint8Array(256);

  try {
    ctx = new AudioContext();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source = ctx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(ctx.destination);
  } catch {
    /* fallback: no analyser */
  }

  const tick = () => {
    if (analyser) {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length / 255;
      onOpenness(Math.min(1, avg * 2.2 + 0.08));
    } else {
      onOpenness(audio.paused ? 0 : 0.35);
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    stop: () => {
      cancelAnimationFrame(raf);
      source?.disconnect();
      analyser?.disconnect();
      void ctx?.close();
      onOpenness(0);
    },
  };
}

/** Apply mouth openness to a face canvas region (lower third). */
export function drawMouthOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  openness: number
) {
  if (openness < 0.05) return;
  const cx = width * 0.5;
  const cy = height * 0.72;
  const rx = width * 0.08;
  const ry = height * 0.02 + openness * height * 0.04;
  ctx.save();
  ctx.fillStyle = `rgba(40, 20, 20, ${0.25 + openness * 0.35})`;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
