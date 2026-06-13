"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import FacePreviewPair from "@/components/FacePreviewPair";
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
  const [faceCamHint, setFaceCamHint] = useState("");
  const [chromeStatus, setChromeStatus] = useState("");
  const [meetLoginStatus, setMeetLoginStatus] = useState<"unknown" | "prejoin" | "joining" | "in_call">("unknown");
  const [backendOk, setBackendOk] = useState(true);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const meetingImgRef = useRef<HTMLImageElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsOkRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

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
    const check = () => {
      api.health()
        .then(() => setBackendOk(true))
        .catch(() => setBackendOk(false));
    };
    check();
    const id = window.setInterval(check, 15000);
    return () => window.clearInterval(id);
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
    const id = window.setInterval(() => setFrameTick((t) => t + 1), 800);
    return () => window.clearInterval(id);
  }, [session, viewReady]);

  useEffect(() => {
    if (!session || !usesMeetingStream(session.platform) || !viewReady) return;
    let cancelled = false;

    const pollStatus = async () => {
      try {
        const st = await api.meetingViewStatus(sessionId);
        if (cancelled) return;
        if (st.in_call) {
          setMeetLoginStatus("in_call");
          setChromeStatus(`In meeting as ${session.participant_name}`);
          setViewError("");
        } else if (st.pending_join) {
          setMeetLoginStatus("joining");
          setChromeStatus("Joining Google Meet on server…");
        } else if (st.launch_in_progress) {
          setMeetLoginStatus("joining");
          setChromeStatus("Starting Chrome on server…");
        } else if (st.on_prejoin) {
          setMeetLoginStatus("prejoin");
          setChromeStatus("On pre-join screen — click Join Meeting");
          setViewError("");
        } else if (st.chrome_ready && st.has_frame) {
          setMeetLoginStatus("prejoin");
          setChromeStatus("Meeting view ready — click Join Meeting");
          setViewError("");
        } else if (st.chrome_ready) {
          setChromeStatus("Chrome ready — loading Meet…");
        } else if (st.error && st.error !== "not_started") {
          setViewError(st.error);
        }
        if (st.pending_join && st.chrome_ready) {
          api.joinMeetingView(sessionId).catch(() => {});
        }
      } catch {
        /* status poll failed — do not mark backend down */
      }
    };

    pollStatus();
    const id = window.setInterval(pollStatus, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [session, sessionId, viewReady]);

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
    if (aiFaceOn) {
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
    if (aiFaceOn) {
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
    if (text?.trim()) {
      await api.sendSpeech(sessionId, text.trim());
    }
  }

  async function joinMeeting() {
    setJoining(true);
    setViewError("");
    try {
      for (let attempt = 0; attempt < 20; attempt++) {
        const res = await api.joinMeetingView(sessionId);
        if (res.joined) {
          setMeetLoginStatus("joining");
          setChromeStatus("Joining Google Meet…");
          setFrameTick((t) => t + 1);
          return;
        }
        if (!res.pending) {
          throw new Error(res.error || "Could not join meeting");
        }
        setChromeStatus(res.error || "Waiting for server Chrome…");
        await new Promise((r) => window.setTimeout(r, 2000));
      }
      setViewError("Server Chrome did not start in time — retry Join Meeting");
    } catch (e) {
      setViewError(e instanceof Error ? e.message : "Join failed");
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
        {!backendOk && (
          <div className="card" style={{ marginBottom: 12, borderColor: "#e5383b" }}>
            <p style={{ color: "#e5383b", margin: 0 }}>
              Cannot reach the meeting server. Use{" "}
              <a href="https://meeting-ai-bot.vercel.app" target="_blank" rel="noreferrer">
                meeting-ai-bot.vercel.app
              </a>{" "}
              or ensure the VPS API is running on port 8000 and reachable from the internet.
            </p>
          </div>
        )}
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
                  onError={() => setViewError("Meeting stream temporarily unavailable — retrying…")}
                  title="Click to interact with the meeting"
                />
                <div className="meeting-overlay">
                  <div className="meet-status-row">
                    <span
                      className={
                        meetLoginStatus === "in_call"
                          ? "meet-status meet-status-ok"
                          : meetLoginStatus === "joining"
                            ? "meet-status meet-status-pending"
                            : "meet-status"
                      }
                    >
                      {meetLoginStatus === "in_call"
                        ? "● In meeting"
                        : meetLoginStatus === "joining"
                          ? "● Joining…"
                          : meetLoginStatus === "prejoin"
                            ? "● Pre-join"
                            : "● Connecting…"}
                    </span>
                  </div>
                  <button type="button" className="btn btn-primary" onClick={joinMeeting} disabled={joining || meetLoginStatus === "in_call"}>
                    {joining ? "Joining…" : meetLoginStatus === "in_call" ? "Joined" : "Join Meeting"}
                  </button>
                  <span className="muted tiny">
                    {chromeStatus || `Click the screen or use this button to join (name: ${session.participant_name})`}
                  </span>
                  {viewError && <span className="preview-warn" style={{ display: "block", marginTop: 6 }}>{viewError}</span>}
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

        <FacePreviewPair
          sessionId={sessionId}
          faceImageUrl={activeFace?.url ?? null}
          enabled={aiFaceOn}
          streamToMeet={aiFaceOn && active}
        />

        <div className="card">
          <p className="section-title">
            Join the meeting above (name: {session.participant_name}), then click Start Meeting on the right.
            {aiFaceOn && active && " Select OBS Virtual Camera in Meet for AI face."}
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
