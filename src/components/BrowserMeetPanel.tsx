"use client";

import { useCallback, useEffect, useState } from "react";

type Props = {
  meetingUrl: string;
  participantName: string;
  onJoinedChange?: (joined: boolean) => void;
};

/** Google Meet runs in the user's browser — no server Chrome. */
export default function BrowserMeetPanel({ meetingUrl, participantName, onJoinedChange }: Props) {
  const [joined, setJoined] = useState(false);

  const markJoined = useCallback(() => {
    setJoined(true);
    onJoinedChange?.(true);
  }, [onJoinedChange]);

  useEffect(() => {
    onJoinedChange?.(joined);
  }, [joined, onJoinedChange]);

  function openMeetNewTab() {
    window.open(meetingUrl, "_blank", "noopener,noreferrer");
    markJoined();
  }

  return (
    <div className="browser-meet-panel">
      <div className="browser-meet-header">
        <span className={joined ? "meet-status meet-status-ok" : "meet-status meet-status-pending"}>
          {joined ? "● Meet open in your browser" : "● Join Google Meet on this device"}
        </span>
      </div>
      <div className="browser-meet-body">
        <p className="browser-meet-title">
          Meeting runs in <strong>your browser</strong> (not on the server)
        </p>
        <p className="muted browser-meet-hint">
          Join as <strong>{participantName}</strong>. Allow camera and microphone in Google Meet.
          Return here for AI assistant, client speech, and face preview.
        </p>
        <div className="browser-meet-actions">
          <button type="button" className="btn btn-primary" onClick={openMeetNewTab}>
            Open Google Meet
          </button>
          <button type="button" className="btn btn-secondary" onClick={markJoined}>
            I&apos;ve joined the meeting
          </button>
        </div>
        <ol className="browser-meet-steps muted">
          <li>Open Google Meet and join the call</li>
          <li>Come back to this tab and click <strong>Start Meeting</strong></li>
          <li>Client speech is captured from your microphone / shared Meet tab audio</li>
        </ol>
      </div>
    </div>
  );
}
