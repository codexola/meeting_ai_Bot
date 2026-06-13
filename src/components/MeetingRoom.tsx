"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BrowserMeetPanel from "@/components/BrowserMeetPanel";
import FacePreviewPair from "@/components/FacePreviewPair";
import MeetingSidebar from "@/components/MeetingSidebar";
import MeetingTranscriptPanel from "@/components/MeetingTranscriptPanel";
import { driveLipSyncFromAudio } from "@/lib/lipSyncClient";
import {
  api,
  apiPath,
  canEmbedMeeting,
  canUseWebSocket,
  meetingWsUrl,
  platformLabel,
  type AppSettings,
  type FaceAsset,
  type LiveSession,
  type Session,
  type VoiceAsset,
  type WsEvent,
} from "@/lib/api";

type Props = { sessionId: number };

function latestAnswerPhonetic(live: LiveSession | null): string {
  if (!live?.responses.length) {
    return "Your AI response (phonetic) appears here after Start Meeting…";
  }
  const latest = live.responses[live.responses.length - 1];
  return latest.phonetic || latest.text;
}

export default function MeetingRoom({ sessionId }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [faces, setFaces] = useState<FaceAsset[]>([]);
  const [voices, setVoices] = useState<VoiceAsset[]>([]);
  const [liveData, setLiveData] = useState<LiveSession | null>(null);
  const [phonetic, setPhonetic] = useState(
    "Your AI response (phonetic) appears here after Start Meeting…"
  );
  const [status, setStatus] = useState("Join the meeting above, then click Start Meeting");
  const [active, setActive] = useState(false);
  const [knowledge, setKnowledge] = useState("");
  const [meetJoined, setMeetJoined] = useState(false);
  const [backendOk, setBackendOk] = useState(true);
  const [openaiOk, setOpenaiOk] = useState(true);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [lipOpenness, setLipOpenness] = useState(0);
  const [tabAudioOn, setTabAudioOn] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const tabRecorderRef = useRef<MediaRecorder | null>(null);
  const lastSpokenRef = useRef("");
  const lipHandleRef = useRef<{ stop: () => void } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const activeFace = appSettings?.active_face_id
    ? faces.find((f) => f.id === appSettings.active_face_id)
    : faces.find((f) => f.is_active);
  const activeVoice = appSettings?.active_voice_id
    ? voices.find((v) => v.id === appSettings.active_voice_id)
    : voices.find((v) => v.is_active);
  const aiFaceOn = Boolean(appSettings?.use_ai_face && activeFace);
  const aiVoiceOn = Boolean(appSettings?.use_ai_voice && activeVoice);

  const loadAssets = useCallback(async () => {
    const [f, v] = await Promise.all([api.listFaces(), api.listVoices()]);
    setFaces(f);
    setVoices(v);
  }, []);

  const handleSettingsChanged = useCallback((settings: AppSettings) => {
    setAppSettings(settings);
  }, []);

  const refreshLive = useCallback(async () => {
    const live = await api.sessionLive(sessionId);
    setLiveData(live);
    setPhonetic(latestAnswerPhonetic(live));
    return live;
  }, [sessionId]);

  const speakResponse = useCallback(
    async (text: string, phoneticText: string, index: number) => {
      const key = `${index}:${text.slice(0, 48)}`;
      if (lastSpokenRef.current === key) return;
      lastSpokenRef.current = key;

      if (!aiVoiceOn) return;

      lipHandleRef.current?.stop();
      audioRef.current?.pause();

      const lang = appSettings?.language || "en";
      try {
        const url = await api.synthesizeSpeech(sessionId, text, lang);
        const audio = new Audio(url);
        audioRef.current = audio;
        lipHandleRef.current = driveLipSyncFromAudio(audio, setLipOpenness);
        audio.onended = () => {
          lipHandleRef.current?.stop();
          lipHandleRef.current = null;
          setLipOpenness(0);
          URL.revokeObjectURL(url);
        };
        await audio.play();
      } catch {
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
          const utter = new SpeechSynthesisUtterance(text);
          utter.lang = lang;
          window.speechSynthesis.speak(utter);
        }
      }
      if (phoneticText) setPhonetic(phoneticText);
    },
    [aiVoiceOn, appSettings?.language, sessionId]
  );

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
        return api.sessionLive(sessionId);
      })
      .then((live) => {
        if (cancelled || !live) return;
        setLiveData(live);
        setPhonetic(latestAnswerPhonetic(live));
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
    const ws = new WebSocket(meetingWsUrl(sessionId));
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as WsEvent;
      if (msg.type === "client_transcript") {
        void refreshLive();
      } else if (msg.type === "response_chunk") {
        setPhonetic(msg.payload.phonetic);
        void refreshLive().then((live) => {
          const latest = live.responses[live.responses.length - 1];
          if (latest) {
            void speakResponse(latest.text, latest.phonetic, latest.index);
          }
        });
      }
    };
    return () => ws.close();
  }, [sessionId, refreshLive, speakResponse]);

  useEffect(() => {
    if (!active) return;
    const poll = window.setInterval(() => {
      void refreshLive().then((live) => {
        const latest = live.responses[live.responses.length - 1];
        if (latest && aiVoiceOn) {
          void speakResponse(latest.text, latest.phonetic, latest.index);
        }
      });
    }, 1200);
    return () => window.clearInterval(poll);
  }, [sessionId, active, aiVoiceOn, refreshLive, speakResponse]);

  function buildActiveStatus(resKnowledge?: string) {
    const parts = ["Assistant: active"];
    if (aiFaceOn) parts.push("AI face");
    if (aiVoiceOn) parts.push("AI voice");
    if (tabAudioOn) parts.push("Meet tab audio");
    let text = parts.join(" · ");
    const kb = resKnowledge || knowledge;
    if (kb) text += ` — ${kb}`;
    return text;
  }

  function startMicRecorder(stream: MediaStream) {
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      const fd = new FormData();
      fd.append("file", e.data, "chunk.webm");
      fetch(apiPath(`/api/sessions/${sessionId}/stt`), { method: "POST", body: fd }).catch(() => {});
    };
    recorder.start(2000);
    return recorder;
  }

  async function startAssistant() {
    const res = await api.startAssistant(sessionId, true);
    setActive(true);
    setStatus(buildActiveStatus(res.knowledge));
    wsRef.current?.send(JSON.stringify({ type: "start" }));
    lastSpokenRef.current = "";

    try {
      const audioConstraints: MediaTrackConstraints = appSettings?.microphone_device
        ? { deviceId: { exact: appSettings.microphone_device } }
        : {};
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      mediaRecorderRef.current = startMicRecorder(stream);
    } catch {
      setStatus((s) => `${s} · no mic detected`);
    }
  }

  async function captureMeetTabAudio() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) {
        stream.getTracks().forEach((t) => t.stop());
        alert("No audio track — share a browser tab with audio enabled.");
        return;
      }
      const audioStream = new MediaStream(audioTracks);
      tabRecorderRef.current = startMicRecorder(audioStream);
      setTabAudioOn(true);
      setStatus(buildActiveStatus());
    } catch {
      /* user cancelled */
    }
  }

  async function stopAssistant() {
    await api.stopAssistant(sessionId);
    setActive(false);
    setTabAudioOn(false);
    setStatus("Stopped — click Start Meeting to resume");
    wsRef.current?.send(JSON.stringify({ type: "stop" }));
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    tabRecorderRef.current?.stop();
    tabRecorderRef.current = null;
    lipHandleRef.current?.stop();
    audioRef.current?.pause();
    setLipOpenness(0);
  }

  async function manualSpeech() {
    const text = prompt("Enter client speech (for testing without mic):");
    if (text?.trim()) await api.sendSpeech(sessionId, text.trim());
    void refreshLive();
  }

  if (!session) {
    return <div className="start-page">Loading session…</div>;
  }

  const embed = canEmbedMeeting(session.platform);
  const isGoogleMeet = session.platform === "google_meet";

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
          {isGoogleMeet ? (
            <BrowserMeetPanel
              meetingUrl={session.meeting_url}
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
          streamToMeet={false}
          lipOpenness={lipOpenness}
        />

        <div className="card">
          <p className="section-title">
            {isGoogleMeet
              ? meetJoined
                ? `In meeting as ${session.participant_name} — click Start Meeting for AI assistant.`
                : `Open Google Meet above (name: ${session.participant_name}), then Start Meeting.`
              : `Join the meeting above, then click Start Meeting on the right.`}
            {aiFaceOn && active && " AI face preview maps your camera to the selected image."}
          </p>
        </div>

        <div>
          <div className="section-title">Client speech &amp; answers</div>
          <MeetingTranscriptPanel
            live={liveData}
            emptyMessage="Client speech with names appears here in real time after Start Meeting…"
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button className="btn btn-secondary" onClick={manualSpeech}>
              Enter client speech manually
            </button>
            {active && isGoogleMeet && (
              <button className="btn btn-secondary" onClick={captureMeetTabAudio}>
                {tabAudioOn ? "Meet tab audio active" : "Capture Meet tab audio"}
              </button>
            )}
          </div>
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
        <div className="section-title">Your response (English IPA)</div>
        <div className="phonetic scroll">{phonetic}</div>
        <p className={active ? "status-active" : "status-idle"}>{status}</p>
      </aside>
    </div>
  );
}
