/**
 * MediaPipe-based face alignment: maps AI face image onto live camera landmarks.
 */

import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";

const WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/** Stable alignment points: left eye, right eye, nose tip, mouth left, mouth right, chin */
const ALIGN = [33, 263, 1, 61, 291, 152];

type Pt = { x: number; y: number };

let landmarker: FaceLandmarker | null = null;
let landmarkerPromise: Promise<FaceLandmarker> | null = null;

export async function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (landmarker) return landmarker;
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM);
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
      });
      return landmarker;
    })();
  }
  return landmarkerPromise;
}

function lmToPt(
  landmarks: { x: number; y: number }[],
  idx: number,
  w: number,
  h: number
): Pt {
  const p = landmarks[idx];
  return { x: p.x * w, y: p.y * h };
}

function pickPoints(landmarks: { x: number; y: number }[], w: number, h: number): Pt[] {
  return ALIGN.map((i) => lmToPt(landmarks, i, w, h));
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function drawFeatheredFace(
  ctx: CanvasRenderingContext2D,
  aiImg: HTMLImageElement,
  srcPts: Pt[],
  dstPts: Pt[],
  w: number,
  h: number
) {
  const srcLE = srcPts[0];
  const srcRE = srcPts[1];
  const dstLE = dstPts[0];
  const dstRE = dstPts[1];
  const srcDist = Math.max(1, dist(srcLE, srcRE));
  const dstDist = dist(dstLE, dstRE);
  const scale = dstDist / srcDist;
  const srcAngle = Math.atan2(srcRE.y - srcLE.y, srcRE.x - srcLE.x);
  const dstAngle = Math.atan2(dstRE.y - dstLE.y, dstRE.x - dstLE.x);
  const angle = dstAngle - srcAngle;
  const srcCenter = { x: (srcLE.x + srcRE.x) / 2, y: (srcLE.y + srcRE.y) / 2 };
  const dstCenter = { x: (dstLE.x + dstRE.x) / 2, y: (dstLE.y + dstRE.y) / 2 };

  const chin = dstPts[5];
  const nose = dstPts[2];
  const faceH = Math.max(40, dist(nose, chin) * 2.2);
  const faceW = faceH * 0.85;

  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const octx = off.getContext("2d");
  if (!octx) return;

  octx.save();
  octx.translate(dstCenter.x, dstCenter.y);
  octx.rotate(angle);
  octx.scale(scale, scale);
  octx.translate(-srcCenter.x, -srcCenter.y);
  octx.drawImage(aiImg, 0, 0, aiImg.naturalWidth, aiImg.naturalHeight);
  octx.restore();

  const mask = document.createElement("canvas");
  mask.width = w;
  mask.height = h;
  const mctx = mask.getContext("2d");
  if (!mctx) return;

  const cx = (dstLE.x + dstRE.x) / 2;
  const cy = (dstLE.y + dstRE.y) / 2 + faceH * 0.12;
  const grad = mctx.createRadialGradient(cx, cy, faceW * 0.15, cx, cy, faceW * 0.55);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.85, "rgba(255,255,255,0.95)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  mctx.fillStyle = grad;
  mctx.beginPath();
  mctx.ellipse(cx, cy, faceW * 0.52, faceH * 0.58, 0, 0, Math.PI * 2);
  mctx.fill();

  octx.globalCompositeOperation = "destination-in";
  octx.drawImage(mask, 0, 0);
  octx.globalCompositeOperation = "source-over";

  ctx.drawImage(off, 0, 0);
}

export async function detectImageLandmarks(
  img: HTMLImageElement
): Promise<Pt[] | null> {
  const fl = await getFaceLandmarker();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const c = canvas.getContext("2d");
  if (!c) return null;
  c.drawImage(img, 0, 0);
  fl.setOptions({ runningMode: "IMAGE" });
  const res = fl.detect(canvas);
  fl.setOptions({ runningMode: "VIDEO" });
  if (!res.faceLandmarks?.[0]) return null;
  return pickPoints(res.faceLandmarks[0], canvas.width, canvas.height);
}

export function renderFaceSwap(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  aiImg: HTMLImageElement,
  aiSrcPts: Pt[],
  result: FaceLandmarkerResult,
  w: number,
  h: number
): boolean {
  ctx.drawImage(video, 0, 0, w, h);
  const lm = result.faceLandmarks?.[0];
  if (!lm) return false;
  const dstPts = pickPoints(lm, w, h);
  drawFeatheredFace(ctx, aiImg, aiSrcPts, dstPts, w, h);
  return true;
}

export function canvasToJpegBlob(canvas: HTMLCanvasElement, quality = 0.82): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });
}
