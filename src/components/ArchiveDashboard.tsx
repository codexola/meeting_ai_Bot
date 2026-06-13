"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type FaceAsset, type MeetingSummary, type VoiceAsset } from "@/lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
};

export default function ArchiveDashboard({ open, onClose, onChanged }: Props) {
  const [tab, setTab] = useState<"faces" | "voices" | "meetings">("faces");
  const [faces, setFaces] = useState<FaceAsset[]>([]);
  const [voices, setVoices] = useState<VoiceAsset[]>([]);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [selectedFace, setSelectedFace] = useState<number | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<number | null>(null);
  const [selectedMeeting, setSelectedMeeting] = useState<number | null>(null);
  const [meetingText, setMeetingText] = useState("");

  const refresh = useCallback(async () => {
    const [f, v, m] = await Promise.all([api.listFaces(), api.listVoices(), api.listSessions()]);
    setFaces(f);
    setVoices(v);
    setMeetings(m);
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  async function loadMeetingText(id: number) {
    setSelectedMeeting(id);
    try {
      const { text } = await api.getSessionArchive(id);
      setMeetingText(text);
    } catch {
      setMeetingText("No .txt archive file found for this meeting.");
    }
  }

  async function deleteFace() {
    if (selectedFace == null || !confirm("Permanently delete this face image?")) return;
    await api.deleteFace(selectedFace);
    setSelectedFace(null);
    await refresh();
    onChanged();
  }

  async function deleteVoice() {
    if (selectedVoice == null || !confirm("Permanently delete this voice sample?")) return;
    await api.deleteVoice(selectedVoice);
    setSelectedVoice(null);
    await refresh();
    onChanged();
  }

  async function deleteMeeting() {
    if (selectedMeeting == null || !confirm("Permanently delete this meeting log?")) return;
    await api.deleteSession(selectedMeeting);
    setSelectedMeeting(null);
    setMeetingText("");
    await refresh();
    onChanged();
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal archive-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Archive Dashboard</h2>
        <p className="muted">Stored assets and meetings remain until you delete them here.</p>

        <div className="tab-row">
          {(["faces", "voices", "meetings"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`tab-btn ${tab === t ? "active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "faces" ? "Face images" : t === "voices" ? "Voice samples" : "Meeting logs (.txt)"}
            </button>
          ))}
        </div>

        {tab === "faces" && (
          <div className="archive-grid">
            {faces.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`archive-face ${selectedFace === f.id ? "selected" : ""}`}
                onClick={() => setSelectedFace(f.id)}
              >
                <img src={f.url} alt={f.name} />
                <span>{f.name}</span>
              </button>
            ))}
          </div>
        )}

        {tab === "voices" && (
          <ul className="archive-list">
            {voices.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  className={selectedVoice === v.id ? "selected" : ""}
                  onClick={() => setSelectedVoice(v.id)}
                >
                  {v.name}
                </button>
              </li>
            ))}
          </ul>
        )}

        {tab === "meetings" && (
          <div className="archive-meetings">
            <ul className="archive-list">
              {meetings.map((m) => {
                const started = new Date(m.started_at).toLocaleString();
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      className={selectedMeeting === m.id ? "selected" : ""}
                      onClick={() => loadMeetingText(m.id)}
                    >
                      {started} · {m.platform} · id {m.id}
                    </button>
                  </li>
                );
              })}
            </ul>
            <pre className="archive-preview scroll">{meetingText || "Select a meeting to view the .txt archive…"}</pre>
          </div>
        )}

        <div className="modal-actions">
          {tab === "faces" && (
            <button type="button" className="btn btn-danger" disabled={selectedFace == null} onClick={deleteFace}>
              Delete selected face
            </button>
          )}
          {tab === "voices" && (
            <button type="button" className="btn btn-danger" disabled={selectedVoice == null} onClick={deleteVoice}>
              Delete selected voice
            </button>
          )}
          {tab === "meetings" && (
            <button type="button" className="btn btn-danger" disabled={selectedMeeting == null} onClick={deleteMeeting}>
              Delete selected meeting log
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
