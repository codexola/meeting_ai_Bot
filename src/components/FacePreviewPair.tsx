"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiPath } from "@/lib/api";
import {
  canvasToJpegBlob,
  detectImageLandmarks,
  getFaceLandmarker,
  renderFaceSwap,
} from "@/lib/faceSwap";
import { drawMouthOverlay } from "@/lib/lipSyncClient";

type Pt = { x: number; y: number };

type Props = {
  sessionId: number;
  faceImageUrl: string | null;
  enabled: boolean;
  streamToMeet: boolean;
  lipOpenness?: number;
};

export default function FacePreviewPair({
  sessionId,
  faceImageUrl,
  enabled,
  streamToMeet,
  lipOpenness = 0,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const aiImgRef = useRef<HTMLImageElement | null>(null);
  const aiPtsRef = useRef<Pt[] | null>(null);
  const rafRef = useRef<number>(0);
  const frameCountRef = useRef(0);
  const [cameraOk, setCameraOk] = useState(true);
  const [faceDetected, setFaceDetected] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [aiFaceReady, setAiFaceReady] = useState(false);
  const [aiFaceError, setAiFaceError] = useState("");

  const loadAiFace = useCallback(async (url: string) => {
    setAiFaceReady(false);
    setAiFaceError("");
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();
    aiImgRef.current = img;
    const pts = await detectImageLandmarks(img);
    aiPtsRef.current = pts;
    if (pts) {
      setAiFaceReady(true);
    } else {
      setAiFaceError("No face detected in selected image — use a clear front-facing photo");
    }
  }, []);

  useEffect(() => {
    getFaceLandmarker()
      .then(() => setModelReady(true))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!faceImageUrl) {
      aiImgRef.current = null;
      aiPtsRef.current = null;
      setAiFaceReady(false);
      setAiFaceError("");
      return;
    }
    loadAiFace(faceImageUrl).catch(console.error);
  }, [faceImageUrl, loadAiFace]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user", width: 1280, height: 720 }, audio: false })
      .then((s) => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
        setCameraOk(true);
      })
      .catch(() => setCameraOk(false));
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!enabled || !modelReady || !faceImageUrl) {
      cancelAnimationFrame(rafRef.current);
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let lastTs = -1;

    const tick = async () => {
      rafRef.current = requestAnimationFrame(tick);
      if (video.readyState < 2) return;

      const w = video.videoWidth || 640;
      const h = video.videoHeight || 480;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;

      const aiImg = aiImgRef.current;
      const aiPts = aiPtsRef.current;

      if (!aiImg || !aiPts) {
        ctx.drawImage(video, 0, 0, w, h);
        setFaceDetected(false);
        return;
      }

      try {
        const fl = await getFaceLandmarker();
        const ts = performance.now();
        const result = fl.detectForVideo(video, ts);
        const swapped = renderFaceSwap(ctx, video, aiImg, aiPts, result, w, h);
        if (swapped && lipOpenness > 0) {
          drawMouthOverlay(ctx, w, h, lipOpenness);
        }
        setFaceDetected(swapped);

        if (streamToMeet && swapped) {
          frameCountRef.current += 1;
          if (frameCountRef.current % 2 === 0) {
            const blob = await canvasToJpegBlob(canvas);
            if (blob) {
              const fd = new FormData();
              fd.append("file", blob, "face.jpg");
              fetch(`${apiPath(`/api/sessions/${sessionId}/face-cam/frame`)}?swapped=true`, {
                method: "POST",
                body: fd,
              }).catch(() => {});
            }
          }
        }
        lastTs = ts;
      } catch {
        ctx.drawImage(video, 0, 0, w, h);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, modelReady, faceImageUrl, sessionId, streamToMeet, lipOpenness]);

  return (
    <div className="preview-row">
      <div className="preview-box">
        <video ref={videoRef} autoPlay muted playsInline className="preview-media" />
        <span className="preview-label">Your camera</span>
        {!cameraOk && <span className="preview-warn">No camera detected</span>}
      </div>
      <div className="preview-box ai-face-preview">
        <canvas ref={canvasRef} className="preview-media" />
        {!enabled && (
          <span className="preview-label">Transmitted to customer (AI face)</span>
        )}
        {enabled && aiFaceError && (
          <span className="preview-warn">{aiFaceError}</span>
        )}
        {enabled && !aiFaceError && !aiFaceReady && (
          <span className="preview-warn">Loading face model…</span>
        )}
        {enabled && aiFaceReady && !faceDetected && cameraOk && (
          <span className="preview-warn">Face not detected — center yourself in camera</span>
        )}
        {enabled && aiFaceReady && faceDetected && !streamToMeet && (
          <span className="preview-label preview-ok">AI face mapped to your camera</span>
        )}
        {enabled && faceDetected && streamToMeet && (
          <span className="preview-label preview-ok">AI face mapped · streaming to Meet</span>
        )}
      </div>
    </div>
  );
}
