/**
 * MediaPipe face mesh warping: maps AI face image onto live camera landmarks
 * using piecewise-affine (Delaunay) triangulation for accurate surface fit.
 */

import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import Delaunator from "delaunator";

const WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/** Face oval + eyes, nose, mouth — stable mesh for warping */
const MESH_INDICES = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
  1, 4, 5, 6, 168, 33, 133, 159, 263, 362, 386,
  61, 291, 78, 308, 13, 14, 17, 199, 175,
];

/** Legacy 6-point set for compatibility */
const ALIGN = [33, 263, 1, 61, 291, 152];

export type Pt = { x: number; y: number };

let landmarker: FaceLandmarker | null = null;
let landmarkerPromise: Promise<FaceLandmarker> | null = null;
let meshTriangles: [number, number, number][] | null = null;

export async function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (landmarker) return landmarker;
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM);
      const opts = {
        baseOptions: { modelAssetPath: MODEL },
        runningMode: "VIDEO" as const,
        numFaces: 1,
      };
      try {
        landmarker = await FaceLandmarker.createFromOptions(vision, {
          ...opts,
          baseOptions: { ...opts.baseOptions, delegate: "GPU" },
        });
      } catch {
        landmarker = await FaceLandmarker.createFromOptions(vision, {
          ...opts,
          baseOptions: { ...opts.baseOptions, delegate: "CPU" },
        });
      }
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

function pickMeshPoints(
  landmarks: { x: number; y: number }[],
  w: number,
  h: number
): Pt[] {
  return MESH_INDICES.map((i) => lmToPt(landmarks, i, w, h));
}

function pickPoints(landmarks: { x: number; y: number }[], w: number, h: number): Pt[] {
  return ALIGN.map((i) => lmToPt(landmarks, i, w, h));
}

function buildMeshTriangles(srcPts: Pt[]): [number, number, number][] {
  const flat = srcPts.flatMap((p) => [p.x, p.y]);
  const delaunay = Delaunator.from(flat);
  const tris: [number, number, number][] = [];
  for (let i = 0; i < delaunay.triangles.length; i += 3) {
    tris.push([
      delaunay.triangles[i],
      delaunay.triangles[i + 1],
      delaunay.triangles[i + 2],
    ]);
  }
  return tris.filter(([a, b, c]) => {
    const cx = (srcPts[a].x + srcPts[b].x + srcPts[c].x) / 3;
    const cy = (srcPts[a].y + srcPts[b].y + srcPts[c].y) / 3;
    return pointInPolygon({ x: cx, y: cy }, srcPts.slice(0, 36));
  });
}

function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function warpTriangle(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  s0: Pt,
  s1: Pt,
  s2: Pt,
  d0: Pt,
  d1: Pt,
  d2: Pt
) {
  const denom = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (Math.abs(denom) < 1e-6) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y);
  ctx.lineTo(d1.x, d1.y);
  ctx.lineTo(d2.x, d2.y);
  ctx.closePath();
  ctx.clip();

  const m11 = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / denom;
  const m12 = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / denom;
  const m21 = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / denom;
  const m22 = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / denom;
  const dx = d0.x - m11 * s0.x - m12 * s0.y;
  const dy = d0.y - m21 * s0.x - m22 * s0.y;

  ctx.transform(m11, m21, m12, m22, dx, dy);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function drawFaceMask(ctx: CanvasRenderingContext2D, oval: Pt[], w: number, h: number) {
  if (oval.length < 3) return;
  const cx = oval.reduce((s, p) => s + p.x, 0) / oval.length;
  const cy = oval.reduce((s, p) => s + p.y, 0) / oval.length;
  const rx = Math.max(...oval.map((p) => Math.abs(p.x - cx))) * 1.05;
  const ry = Math.max(...oval.map((p) => Math.abs(p.y - cy))) * 1.08;

  const mask = document.createElement("canvas");
  mask.width = w;
  mask.height = h;
  const mctx = mask.getContext("2d");
  if (!mctx) return;

  mctx.beginPath();
  mctx.moveTo(oval[0].x, oval[0].y);
  for (let i = 1; i < oval.length; i++) mctx.lineTo(oval[i].x, oval[i].y);
  mctx.closePath();
  mctx.fillStyle = "#fff";
  mctx.fill();

  mctx.globalCompositeOperation = "destination-in";
  const grad = mctx.createRadialGradient(cx, cy, rx * 0.2, cx, cy, Math.max(rx, ry));
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.75, "rgba(255,255,255,0.98)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  mctx.fillStyle = grad;
  mctx.fillRect(0, 0, w, h);

  ctx.drawImage(mask, 0, 0);
}

function drawWarpedFace(
  ctx: CanvasRenderingContext2D,
  aiImg: HTMLImageElement,
  srcPts: Pt[],
  dstPts: Pt[],
  w: number,
  h: number
) {
  if (!meshTriangles) {
    meshTriangles = buildMeshTriangles(srcPts);
  }

  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const octx = off.getContext("2d");
  if (!octx) return;

  for (const [i, j, k] of meshTriangles) {
    warpTriangle(
      octx,
      aiImg,
      srcPts[i],
      srcPts[j],
      srcPts[k],
      dstPts[i],
      dstPts[j],
      dstPts[k]
    );
  }

  octx.globalCompositeOperation = "destination-in";
  drawFaceMask(octx, dstPts.slice(0, 36), w, h);
  octx.globalCompositeOperation = "source-over";

  ctx.drawImage(off, 0, 0);
}

export function resetFaceMeshCache(): void {
  meshTriangles = null;
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
  resetFaceMeshCache();
  return pickMeshPoints(res.faceLandmarks[0], canvas.width, canvas.height);
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
  const dstPts = pickMeshPoints(lm, w, h);
  drawWarpedFace(ctx, aiImg, aiSrcPts, dstPts, w, h);
  return true;
}

export function canvasToJpegBlob(canvas: HTMLCanvasElement, quality = 0.82): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });
}
