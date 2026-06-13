"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type MeetPhase = "ready" | "opened" | "joined";

type Props = {
  sessionId: number;
  meetingUrl: string;
  participantName: string;
  onJoinedChange?: (joined: boolean) => void;
};

export default function BrowserMeetJoin({
  sessionId,
  meetingUrl,
  participantName,
  onJoinedChange,
}: Props) {
  const [phase, setPhase] = useState<MeetPhase>("ready");
  const [popupBlocked, setPopupBlocked] = useState(false);
  const meetWindowRef = useRef<Window | null>(null);

  const markJoined = useCallback(() => {
    setPhase("joined");
    onJoinedChange?.(true);
  }, [onJoinedChange]);

  useEffect(() => {
    onJoinedChange?.(phase === "joined");
  }, [phase, onJoinedChange]);

  useEffect(() => {
    if (phase !== "opened") return;
    const id = window.setInterval(() => {
      if (meetWindowRef.current?.closed) {
        meetWindowRef.current = null;
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [phase]);

  function openMeet() {
    setPopupBlocked(false);
    const features = "width=1280,height=800,menubar=no,toolbar=no,location=yes,status=no";
    const w = window.open(meetingUrl, `meetingbot-meet-${sessionId}`, features);
    if (!w) {
      setPopupBlocked(true);
      return;
    }
    meetWindowRef.current = w;
    setPhase("opened");
  }

  return (
    <div className="browser-meet-panel">
      <div className="browser-meet-header">
        <span
          className={
            phase === "joined"
              ? "meet-status meet-status-ok"
              : phase === "opened"
                ? "meet-status meet-status-pending"
                : "meet-status"
          }
        >
          {phase === "joined"
            ? "● In meeting (your browser)"
            : phase === "opened"
              ? "● Meet tab open — join there"
              : "● Ready to join"}
        </span>
      </div>

      <div className="browser-meet-body">
        <p className="browser-meet-title">Google Meet runs in <strong>your browser</strong></p>
        <p className="muted browser-meet-hint">
          Join as <strong>{participantName}</strong>. Camera and microphone use this device — not the server.
        </p>

        <div className="browser-meet-actions">
          {phase !== "joined" && (
            <button type="button" className="btn btn-primary" onClick={openMeet}>
              {phase === "opened" ? "Re-open Google Meet" : "Join Meeting"}
            </button>
          )}
          {phase === "opened" && (
            <button type="button" className="btn btn-secondary" onClick={markJoined}>
              I&apos;ve joined the meeting
            </button>
          )}
          {phase === "joined" && (
            <button type="button" className="btn btn-secondary" onClick={openMeet}>
              Focus Meet tab
            </button>
          )}
        </div>

        {popupBlocked && (
          <p className="preview-warn" style={{ marginTop: 12 }}>
            Pop-up blocked.{" "}
            <a href={meetingUrl} target="_blank" rel="noreferrer">
              Open Google Meet in a new tab
            </a>
          </p>
        )}

        <ol className="browser-meet-steps muted">
          <li>Click <strong>Join Meeting</strong> — Google Meet opens on this device</li>
          <li>Allow camera and microphone when Meet asks</li>
          <li>Enter name <strong>{participantName}</strong> if prompted, then join the call</li>
          <li>Return here and click <strong>Start Meeting</strong> for AI assistant</li>
        </ol>
      </div>
    </div>
  );
}
