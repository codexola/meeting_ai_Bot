"use client";

import { useEffect, useRef, useState } from "react";
import { api, meetingFrameUrl } from "@/lib/api";

type MeetLoginStatus = "unknown" | "prejoin" | "joining" | "in_call";

type Props = {
  sessionId: number;
  participantName: string;
  onJoinedChange?: (joined: boolean) => void;
};

/** Google Meet embedded in the center panel via server Chrome screenshot stream. */
export default function EmbeddedMeetView({ sessionId, participantName, onJoinedChange }: Props) {
  const [viewReady, setViewReady] = useState(false);
  const [viewError, setViewError] = useState("");
  const [frameTick, setFrameTick] = useState(0);
  const [joining, setJoining] = useState(false);
  const [chromeStatus, setChromeStatus] = useState("");
  const [meetLoginStatus, setMeetLoginStatus] = useState<MeetLoginStatus>("unknown");
  const meetingImgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
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
  }, [sessionId]);

  useEffect(() => {
    if (!viewReady) return;
    const id = window.setInterval(() => setFrameTick((t) => t + 1), 800);
    return () => window.clearInterval(id);
  }, [viewReady]);

  useEffect(() => {
    if (!viewReady) return;
    let cancelled = false;

    const pollStatus = async () => {
      try {
        const st = await api.meetingViewStatus(sessionId);
        if (cancelled) return;
        if (st.in_call) {
          setMeetLoginStatus("in_call");
          setChromeStatus(`In meeting as ${participantName}`);
          setViewError("");
          onJoinedChange?.(true);
        } else if (st.pending_join || st.launch_in_progress) {
          setMeetLoginStatus("joining");
          setChromeStatus("Joining Google Meet…");
          onJoinedChange?.(false);
        } else if (st.on_prejoin) {
          setMeetLoginStatus("prejoin");
          setChromeStatus("Pre-join screen — click Join Meeting");
          onJoinedChange?.(false);
        } else if (st.chrome_ready && st.has_frame) {
          setMeetLoginStatus("prejoin");
          setChromeStatus("Meeting ready — click Join Meeting");
          onJoinedChange?.(false);
        } else if (st.chrome_ready) {
          setChromeStatus("Loading Google Meet…");
        } else if (st.error && st.error !== "not_started") {
          setViewError(st.error);
        }
        if (st.pending_join && st.chrome_ready) {
          api.joinMeetingView(sessionId).catch(() => {});
        }
      } catch {
        /* ignore */
      }
    };

    pollStatus();
    const id = window.setInterval(pollStatus, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [sessionId, viewReady, participantName, onJoinedChange]);

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
        if (!res.pending) throw new Error(res.error || "Could not join meeting");
        setChromeStatus(res.error || "Starting meeting view…");
        await new Promise((r) => window.setTimeout(r, 2000));
      }
      setViewError("Meeting view did not start in time — retry Join Meeting");
    } catch (e) {
      setViewError(e instanceof Error ? e.message : "Join failed");
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

  if (!viewReady) {
    return (
      <div className="embedded-meet-loading">
        <p>{viewError || "Loading meeting view…"}</p>
        <p className="section-title" style={{ marginTop: 8 }}>
          Starting Google Meet in the panel
        </p>
      </div>
    );
  }

  return (
    <>
      <img
        ref={meetingImgRef}
        className="meeting-stream"
        src={meetingFrameUrl(sessionId, frameTick)}
        alt="Google Meet"
        onClick={onMeetingClick}
        onError={() => setViewError("Stream loading — retrying…")}
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
        <button
          type="button"
          className="btn btn-primary"
          onClick={joinMeeting}
          disabled={joining || meetLoginStatus === "in_call"}
        >
          {joining ? "Joining…" : meetLoginStatus === "in_call" ? "Joined" : "Join Meeting"}
        </button>
        <span className="muted tiny">
          {chromeStatus || `Click the screen or Join (name: ${participantName})`}
        </span>
        {viewError && (
          <span className="preview-warn" style={{ display: "block", marginTop: 6 }}>
            {viewError}
          </span>
        )}
      </div>
    </>
  );
}
