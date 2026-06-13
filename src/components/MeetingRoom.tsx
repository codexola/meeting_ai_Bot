"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MeetingSidebar from "@/components/MeetingSidebar";
import {
  api,
  apiPath,
  canEmbedMeeting,
  canUseWebSocket,
  meetingFrameUrl,
  meetingWsUrl,
  platformLabel,
  usesMeetingStream,
  type AppSettings,
  type FaceAsset,
  type Session,
  type VoiceAsset,
  type WsEvent,
} from "@/lib/api";

type Props = { sessionId: number };

export default function MeetingRoom({ sessionId }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [faces, setFaces] = useState<FaceAsset[]>([]);
  const [voices, setVoices] = useState<VoiceAsset[]>([]);
  const [transcript, setTranscript] = useState("");
  const [phonetic, setPhonetic] = useState("Your AI response (phonetic) appears here after Start Meeting…");
  const [status, setStatus] = useState("Waiting — join meeting, then click Start Meeting");
  const [active, setActive] = useState(false);
  const [knowledge, setKnowledge] = useState("");
  const [viewReady, setViewReady] = useState(false);
  const [viewError, setViewError] = useState("");
  const [frameTick, setFrameTick] = useState(0);
  const [joining, setJoining] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const meetingImgRef = useRef<HTMLImageElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsOkRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  const activeFace = faces.find((f) => f.is_active);
  const activeVoice = voices.find((v) => v.is_active);
  const aiFaceOn = Boolean(activeFace);
  const aiVoiceOn = Boolean(activeVoice);

  const loadAssets = useCallback(async () => {
    const [f, v, k] = await Promise.all([api.listFaces(), api.listVoices(), api.knowledge()]);
    setFaces(f);
    setVoices(v);
    setKnowledge(k.summary);
  }, []);

  const handleSettingsChanged = useCallback((settings: AppSettings) => {
    setAppSettings(settings);
  }, []);

  useEffect(() => {
    api.getSession(sessionId).then((s) => {
      setSession(s);
      setActive(Boolean(s.assistant_active));
    }).catch(console.error);
    loadAssets();
  }, [sessionId, loadAssets]);

  useEffect(() => {
    if (!session || !usesMeetingStream(session.platform)) return;

    let cancelled = false;
    let retryTimer: number | undefined;

    const boot = () => {
      api
        .startMeetingView(sessionId)
        .then((res) => {
          if (cancelled) return;
          if (res.started || res.pending) {
            setViewReady(true);
            setViewError(res.error || "");
          } else {
            setViewError(res.error || "Could not start meeting view");
            retryTimer = window.setTimeout(boot, 5000);
          }
        })
        .catch((e) => {
          if (cancelled) return;
          // Vercel proxy may timeout while Chrome launches — still poll for frames
          setViewReady(true);
          setViewError(e instanceof Error ? e.message : "Meeting view starting…");
          retryTimer = window.setTimeout(boot, 8000);
        });
    };

    boot();
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [session, sessionId]);

  useEffect(() => {
    if (!session || !usesMeetingStream(session.platform) || !viewReady) return;
    const id = window.setInterval(() => setFrameTick((t) => t + 1), 400);
    return () => window.clearInterval(id);
  }, [session, viewReady]);

  useEffect(() => {
    if (!canUseWebSocket()) return;
    wsOkRef.current = false;
    const ws = new WebSocket(meetingWsUrl(sessionId));
    wsRef.current = ws;
    ws.onopen = () => {
      wsOkRef.current = true;
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as WsEvent;
      if (msg.type === "client_transcript") {
        setTranscript((t) => `${t}\n${msg.payload.speaker_name}: ${msg.payload.text}`.trim());
      } else if (msg.type === "response_chunk") {
        setPhonetic(msg.payload.phonetic);
        if (typeof window !== "undefined" && "speechSynthesis" in window && aiVoiceOn) {
          const u = new SpeechSynthesisUtterance(msg.payload.text);
          window.speechSynthesis.speak(u);
        }
      }
    };
    ws.onerror = () => {
      wsOkRef.current = false;
    };
    return () => ws.close();
  }, [sessionId, aiVoiceOn]);

  // HTTP polling when WebSocket unavailable (HTTPS Vercel → ws:// VPS)
  useEffect(() => {
    if (!active) return;
    const poll = window.setInterval(async () => {
      if (canUseWebSocket() && wsOkRef.current) return;
      try {
        const [utterances, responses] = await Promise.all([
          api.listUtterances(sessionId),
          api.listResponses(sessionId),
        ]);
        if (utterances.length) {
          setTranscript(
            utterances.map((u) => `${u.speaker}: ${u.text}`).join("\n")
          );
        }
        const latest = responses[responses.length - 1];
        if (latest?.phonetic) {
          setPhonetic(latest.phonetic);
        }
      } catch {
        /* backend unreachable */
      }
    }, 2500);
    return () => window.clearInterval(poll);
  }, [sessionId, active]);

  useEffect(() => {
    const constraints: MediaStreamConstraints = {
      video: true,
      audio: false,
    };
    navigator.mediaDevices
      ?.getUserMedia(constraints)
      .then((stream) => {
        cameraStreamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => {});
    return () => {
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function buildActiveStatus(resKnowledge?: string) {
    const parts = ["Assistant: active"];
    if (aiFaceOn) parts.push("AI face");
    if (aiVoiceOn) parts.push("AI voice");
    let text = parts.join(" · ");
    const kb = resKnowledge || knowledge;
    if (kb) text += ` — ${kb}`;
    return text;
  }

  async function startAssistant() {
    const res = await api.startAssistant(sessionId);
    setActive(true);
    setStatus(buildActiveStatus(res.knowledge));
    wsRef.current?.send(JSON.stringify({ type: "start" }));

    try {
      const audioConstraints: MediaTrackConstraints = appSettings?.microphone_device
        ? { deviceId: { exact: appSettings.microphone_device } }
        : {};
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = async (e) => {
        if (e.data.size === 0) return;
        const fd = new FormData();
        fd.append("file", e.data, "chunk.webm");
        await fetch(apiPath(`/api/sessions/${sessionId}/stt`), { method: "POST", body: fd });
      };
      recorder.start(3000);
    } catch {
      setStatus((s) => `${s} · no mic detected`);
    }
  }

  async function stopAssistant() {
    await api.stopAssistant(sessionId);
    setActive(false);
    setStatus("Stopped — click Start Meeting to resume");
    wsRef.current?.send(JSON.stringify({ type: "stop" }));
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  }

  async function manualSpeech() {
    const text = prompt("Enter client speech (for testing without mic):");
    if (text?.trim()) {
      await api.sendSpeech(sessionId, text.trim());
    }
  }

  async function joinMeeting() {
    setJoining(true);
    try {
      await api.joinMeetingView(sessionId);
      setFrameTick((t) => t + 1);
    } catch (e) {
      console.error(e);
    } finally {
      setJoining(false);
    }
  }

  async function onMeetingClick(e: React.MouseEvent<HTMLImageElement>) {
    const img = meetingImgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    try {
      await api.clickMeetingView(sessionId, x, y);
      setFrameTick((t) => t + 1);
    } catch {
      /* ignore */
    }
  }

  if (!session) {
    return <div className="start-page">Loading session…</div>;
  }

  const embed = canEmbedMeeting(session.platform);
  const stream = usesMeetingStream(session.platform);

  return (
    <div className="layout">
      <MeetingSidebar
        assistantActive={active}
        onAssetsChanged={loadAssets}
        onSettingsChanged={handleSettingsChanged}
      />

      <main className="center">
        <div className="meeting-frame">
          {stream ? (
            viewReady ? (
              <>
                <img
                  ref={meetingImgRef}
                  className="meeting-stream"
                  src={meetingFrameUrl(sessionId, frameTick)}
                  alt="Google Meet"
                  onClick={onMeetingClick}
                  title="Click to interact with the meeting"
                />
                <div className="meeting-overlay">
                  <button type="button" className="btn btn-primary" onClick={joinMeeting} disabled={joining}>
                    {joining ? "Joining…" : "Join Meeting"}
                  </button>
                  <span className="muted tiny">Click the screen or use this button to join (name: {session.participant_name})</span>
                </div>
              </>
            ) : (
              <div style={{ padding: 24, textAlign: "center" }}>
                <p>{viewError || "Loading meeting view…"}</p>
                <p className="section-title" style={{ marginTop: 8 }}>
                  Starting Chrome on the server for Google Meet
                </p>
              </div>
            )
          ) : embed ? (
            <iframe src={session.meeting_url} title="Meeting" allow="camera; microphone; display-capture; fullscreen" />
          ) : (
            <div style={{ padding: 24, textAlign: "center" }}>
              <p>{platformLabel(session.platform)} — open in a new tab</p>
              <a href={session.meeting_url} target="_blank" rel="noreferrer" className="btn btn-primary" style={{ display: "inline-block", marginTop: 12 }}>
                Open meeting
              </a>
            </div>
          )}
        </div>

        <div className="preview-row">
          <div className="preview-box">
            <video ref={videoRef} autoPlay muted playsInline />
            <span className="preview-label">Your camera</span>
          </div>
          <div className="preview-box ai-face-preview">
            {aiFaceOn && activeFace ? (
              <img src={activeFace.url} alt={activeFace.name} className="ai-face-img" />
            ) : (
              <span className="preview-label">Transmitted to customer (AI face)</span>
            )}
          </div>
        </div>

        <div className="card">
          <p className="section-title">Join the meeting above (name: {session.participant_name}), then click Start Meeting on the right</p>
        </div>

        <div>
          <div className="section-title">Client speech</div>
          <div className="transcript">{transcript || "Client speech appears here after you click Start Meeting…"}</div>
          <button className="btn btn-secondary" onClick={manualSpeech} style={{ marginTop: 8 }}>
            Enter client speech manually
          </button>
        </div>
      </main>

      <aside className="right">
        {!active ? (
          <button className="btn btn-primary" onClick={startAssistant} style={{ width: "100%", minHeight: 48 }}>
            Start Meeting
          </button>
        ) : (
          <button className="btn btn-danger" onClick={stopAssistant} style={{ width: "100%", minHeight: 48 }}>
            Stop
          </button>
        )}
        <div className="section-title">Your response (phonetic)</div>
        <div className="phonetic scroll">{phonetic}</div>
        <p className={active ? "status-active" : "status-idle"}>{status}</p>
      </aside>
    </div>
  );
}
