"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import EmbeddedMeetView from "@/components/EmbeddedMeetView";
import FacePreviewPair from "@/components/FacePreviewPair";
import MeetingSidebar from "@/components/MeetingSidebar";
import {
  api,
  apiPath,
  canEmbedMeeting,
  canUseWebSocket,
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
  const [status, setStatus] = useState("Join the meeting above, then click Start Meeting");
  const [active, setActive] = useState(false);
  const [knowledge, setKnowledge] = useState("");
  const [meetJoined, setMeetJoined] = useState(false);
  const [faceCamHint, setFaceCamHint] = useState("");
  const [backendOk, setBackendOk] = useState(true);
  const [openaiOk, setOpenaiOk] = useState(true);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsOkRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const activeFace = appSettings?.active_face_id
    ? faces.find((f) => f.id === appSettings.active_face_id)
    : faces.find((f) => f.is_active);
  const activeVoice = appSettings?.active_voice_id
    ? voices.find((v) => v.id === appSettings.active_voice_id)
    : voices.find((v) => v.is_active);
  const aiFaceOn = Boolean(appSettings?.use_ai_face && activeFace);
  const aiVoiceOn = Boolean(appSettings?.use_ai_voice && activeVoice);
  const streamMeet = session ? usesMeetingStream(session.platform) : false;

  const loadAssets = useCallback(async () => {
    const [f, v] = await Promise.all([api.listFaces(), api.listVoices()]);
    setFaces(f);
    setVoices(v);
  }, []);

  const handleSettingsChanged = useCallback((settings: AppSettings) => {
    setAppSettings(settings);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.bootstrapSession(sessionId), api.getSettings(), loadAssets()])
      .then(([boot, s]) => {
        if (cancelled) return;
        setSession(boot.session);
        setActive(Boolean(boot.session.assistant_active));
        setKnowledge(boot.knowledge_summary);
        setBackendOk(boot.database);
        setOpenaiOk(boot.openai_configured);
        setAppSettings(s);
      })
      .catch(() => {
        if (!cancelled) setBackendOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, loadAssets]);

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
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(msg.payload.text));
        }
      }
    };
    ws.onerror = () => {
      wsOkRef.current = false;
    };
    return () => ws.close();
  }, [sessionId, aiVoiceOn]);

  useEffect(() => {
    if (!active) return;
    const poll = window.setInterval(async () => {
      if (canUseWebSocket() && wsOkRef.current) return;
      try {
        const live = await api.sessionLive(sessionId);
        if (live.utterances.length) {
          setTranscript(live.utterances.map((u) => `${u.speaker}: ${u.text}`).join("\n"));
        }
        const latest = live.responses[live.responses.length - 1];
        if (latest?.phonetic) setPhonetic(latest.phonetic);
      } catch {
        /* ignore */
      }
    }, 1500);
    return () => window.clearInterval(poll);
  }, [sessionId, active]);

  function buildActiveStatus(resKnowledge?: string) {
    const parts = ["Assistant: active"];
    if (aiFaceOn) parts.push("AI face");
    if (aiVoiceOn) parts.push("AI voice");
    let text = parts.join(" · ");
    const kb = resKnowledge || knowledge;
    if (kb) text += ` — ${kb}`;
    if (faceCamHint) text += ` · ${faceCamHint}`;
    return text;
  }

  async function startAssistant() {
    const res = await api.startAssistant(sessionId);
    setActive(true);
    if (aiFaceOn && streamMeet) {
      try {
        const fc = await api.startFaceCam(sessionId);
        setFaceCamHint(fc.hint || (fc.virtual_cam ? "OBS Virtual Camera ready" : "Virtual camera unavailable"));
      } catch {
        setFaceCamHint("Face cam start failed");
      }
    }
    setStatus(buildActiveStatus(res.knowledge));
    wsRef.current?.send(JSON.stringify({ type: "start" }));

    try {
      const audioConstraints: MediaTrackConstraints = appSettings?.microphone_device
        ? { deviceId: { exact: appSettings.microphone_device } }
        : {};
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = async (e) => {
        if (e.data.size === 0) return;
        const fd = new FormData();
        fd.append("file", e.data, "chunk.webm");
        fetch(apiPath(`/api/sessions/${sessionId}/stt`), { method: "POST", body: fd }).catch(() => {});
      };
      recorder.start(2000);
    } catch {
      setStatus((s) => `${s} · no mic detected`);
    }
  }

  async function stopAssistant() {
    await api.stopAssistant(sessionId);
    if (aiFaceOn && streamMeet) {
      api.stopFaceCam(sessionId).catch(() => {});
    }
    setActive(false);
    setFaceCamHint("");
    setStatus("Stopped — click Start Meeting to resume");
    wsRef.current?.send(JSON.stringify({ type: "stop" }));
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  }

  async function manualSpeech() {
    const text = prompt("Enter client speech (for testing without mic):");
    if (text?.trim()) await api.sendSpeech(sessionId, text.trim());
  }

  if (!session) {
    return <div className="start-page">Loading session…</div>;
  }

  const embed = canEmbedMeeting(session.platform);

  return (
    <div className="layout">
      <MeetingSidebar
        assistantActive={active}
        onAssetsChanged={loadAssets}
        onSettingsChanged={handleSettingsChanged}
      />

      <main className="center">
        {(!backendOk || !openaiOk) && (
          <div className="card" style={{ marginBottom: 12, borderColor: "#e5383b" }}>
            {!backendOk && (
              <p style={{ color: "#e5383b", margin: 0 }}>
                Cannot reach the meeting server — check VPS API on port 8000.
              </p>
            )}
            {!openaiOk && (
              <p style={{ color: "#e5383b", margin: backendOk ? 0 : "8px 0 0" }}>
                OpenAI API key not configured on the server.
              </p>
            )}
          </div>
        )}

        <div className="meeting-frame">
          {streamMeet ? (
            <EmbeddedMeetView
              sessionId={sessionId}
              participantName={session.participant_name}
              onJoinedChange={setMeetJoined}
            />
          ) : embed ? (
            <iframe
              src={session.meeting_url}
              title="Meeting"
              allow="camera; microphone; display-capture; fullscreen"
              className="meeting-iframe"
            />
          ) : (
            <div style={{ padding: 24, textAlign: "center" }}>
              <p>{platformLabel(session.platform)} — open in your browser</p>
              <a
                href={session.meeting_url}
                target="_blank"
                rel="noreferrer"
                className="btn btn-primary"
                style={{ display: "inline-block", marginTop: 12 }}
              >
                Open meeting
              </a>
            </div>
          )}
        </div>

        <FacePreviewPair
          sessionId={sessionId}
          faceImageUrl={activeFace?.url ?? null}
          enabled={aiFaceOn}
          streamToMeet={aiFaceOn && active && streamMeet}
        />

        <div className="card">
          <p className="section-title">
            {streamMeet
              ? meetJoined
                ? `In meeting as ${session.participant_name} — click Start Meeting for AI assistant.`
                : `Join the meeting in the panel above (name: ${session.participant_name}), then Start Meeting.`
              : `Join the meeting above, then click Start Meeting on the right.`}
            {aiFaceOn && active && streamMeet && " Select OBS Virtual Camera in Meet for AI face."}
          </p>
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
