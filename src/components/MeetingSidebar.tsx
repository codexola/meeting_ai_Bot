"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ArchiveDashboard from "@/components/ArchiveDashboard";
import {
  api,
  blurDescription,
  BLUR_PRESETS,
  type AppSettings,
  type FaceAsset,
  type VoiceAsset,
} from "@/lib/api";

type Props = {
  assistantActive: boolean;
  onAssetsChanged: () => void;
  onSettingsChanged: (settings: AppSettings) => void;
};

const LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "ja", label: "Japanese" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "zh", label: "Chinese" },
  { code: "vi", label: "Vietnamese" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
];

function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
}

function selectedFace(faces: FaceAsset[], settings: AppSettings | null): FaceAsset | undefined {
  if (!settings) return undefined;
  if (settings.active_face_id != null) {
    return faces.find((f) => f.id === settings.active_face_id);
  }
  return faces.find((f) => f.is_active);
}

function selectedVoice(voices: VoiceAsset[], settings: AppSettings | null): VoiceAsset | undefined {
  if (!settings) return undefined;
  if (settings.active_voice_id != null) {
    return voices.find((v) => v.id === settings.active_voice_id);
  }
  return voices.find((v) => v.is_active);
}

export default function MeetingSidebar({ assistantActive, onAssetsChanged, onSettingsChanged }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [faces, setFaces] = useState<FaceAsset[]>([]);
  const [voices, setVoices] = useState<VoiceAsset[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [micDevices, setMicDevices] = useState<{ id: string; label: string }[]>([]);
  const saveTimer = useRef<number | undefined>();

  const face = selectedFace(faces, settings);
  const voice = selectedVoice(voices, settings);
  const aiFaceOn = Boolean(settings?.use_ai_face && face);
  const aiVoiceOn = Boolean(settings?.use_ai_voice && voice);

  const loadAll = useCallback(async () => {
    const [s, f, v] = await Promise.all([api.getSettings(), api.listFaces(), api.listVoices()]);
    setSettings(s);
    setFaces(f);
    setVoices(v);
    applyTheme(s.theme);
    onSettingsChanged(s);
  }, [onSettingsChanged]);

  useEffect(() => {
    loadAll();
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => {
        const mics = devices
          .filter((d) => d.kind === "audioinput")
          .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
        setMicDevices(mics);
      })
      .catch(() => {});
  }, [loadAll]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code === "Semicolon" && e.altKey && !e.ctrlKey && !e.metaKey) {
        if (!settings) return;
        const current = settings.blur_enabled ? settings.blur_percent : 0;
        let idx = BLUR_PRESETS.indexOf(current);
        if (idx < 0) idx = 0;
        const next = BLUR_PRESETS[(idx + 1) % BLUR_PRESETS.length];
        patchSettings({ blur_enabled: next > 0, blur_percent: next });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings]);

  function patchSettings(patch: Partial<AppSettings>, debounceMs = 0) {
    if (!settings) return;
    const merged = { ...settings, ...patch };
    setSettings(merged);
    applyTheme(merged.theme);
    onSettingsChanged(merged);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const save = () => {
      api.updateSettings(patch).then((s) => {
        setSettings(s);
        onSettingsChanged(s);
      });
    };
    if (debounceMs > 0) saveTimer.current = window.setTimeout(save, debounceMs);
    else save();
  }

  function assistantStatus() {
    if (!assistantActive) return "Idle — join meeting, then Start Meeting";
    const parts = ["Assistant: active"];
    if (aiFaceOn) parts.push("AI face");
    if (aiVoiceOn) parts.push("AI voice");
    return parts.join(" · ");
  }

  async function onFaceSelect(id: string) {
    if (!id) {
      patchSettings({ active_face_id: null, use_ai_face: false });
    } else {
      await api.activateFace(Number(id));
      const s = await api.getSettings();
      setSettings(s);
      onSettingsChanged(s);
    }
    await loadAll();
    onAssetsChanged();
  }

  async function onVoiceSelect(id: string) {
    if (!id) {
      patchSettings({ active_voice_id: null, use_ai_voice: false });
    } else {
      await api.activateVoice(Number(id));
      const s = await api.getSettings();
      setSettings(s);
      onSettingsChanged(s);
    }
    await loadAll();
    onAssetsChanged();
  }

  async function onFaceUpload(file: File | null) {
    if (!file) return;
    await api.uploadFace(file);
    await loadAll();
    onAssetsChanged();
  }

  async function onVoiceUpload(file: File | null) {
    if (!file) return;
    await api.uploadVoice(file);
    await loadAll();
    onAssetsChanged();
  }

  async function turnAiFaceOn() {
    const faceId = settings?.active_face_id ?? face?.id ?? faces[0]?.id;
    if (!faceId) return;
    if (settings?.active_face_id !== faceId) {
      await api.activateFace(faceId);
    }
    patchSettings({ use_ai_face: true, active_face_id: faceId });
    await loadAll();
    onAssetsChanged();
  }

  async function turnAiFaceOff() {
    await api.deactivateFace();
    const s = await api.getSettings();
    setSettings(s);
    onSettingsChanged(s);
    await loadAll();
    onAssetsChanged();
  }

  async function turnAiVoiceOn() {
    const voiceId = settings?.active_voice_id ?? voice?.id ?? voices[0]?.id;
    if (!voiceId) return;
    if (settings?.active_voice_id !== voiceId) {
      await api.activateVoice(voiceId);
    }
    patchSettings({ use_ai_voice: true, active_voice_id: voiceId });
    await loadAll();
    onAssetsChanged();
  }

  async function turnAiVoiceOff() {
    await api.deactivateVoice();
    const s = await api.getSettings();
    setSettings(s);
    onSettingsChanged(s);
    await loadAll();
    onAssetsChanged();
  }

  if (!settings) {
    return <aside className="sidebar scroll"><div className="card">Loading settings…</div></aside>;
  }

  return (
    <>
      <aside className="sidebar scroll">
        <div className="card">
          <div className="section-title">Assistant</div>
          <p className={assistantActive ? "status-active" : "status-idle"}>{assistantStatus()}</p>
        </div>

        <div className="card">
          <div className="section-title">Face (AI)</div>
          <label className="field-label">Image:</label>
          <select value={face?.id ?? ""} onChange={(e) => onFaceSelect(e.target.value)}>
            <option value="">— Select face —</option>
            {faces.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {face && (
            <img src={face.url} alt={face.name} className="face-thumb" style={{ marginTop: 8 }} />
          )}
          <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 8 }}>
            <label style={{ cursor: "pointer", display: "block" }}>
              Upload image
              <input type="file" accept="image/*" hidden onChange={(e) => onFaceUpload(e.target.files?.[0] ?? null)} />
            </label>
          </button>
          <div className="btn-row">
            <button
              type="button"
              className={`btn ${aiFaceOn ? "btn-primary" : "btn-secondary"}`}
              onClick={turnAiFaceOn}
              disabled={aiFaceOn || faces.length === 0}
              title="Enable AI face replacement until Stop is pressed"
            >
              AI Face {aiFaceOn ? "ON" : "OFF"}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={turnAiFaceOff}
              disabled={!aiFaceOn}
              title="Stop AI face replacement (keeps selected image)"
            >
              Stop
            </button>
          </div>
        </div>

        <div className="card">
          <div className="section-title">Voice (AI)</div>
          <label className="field-label">Audio:</label>
          <select value={voice?.id ?? ""} onChange={(e) => onVoiceSelect(e.target.value)}>
            <option value="">— Select voice —</option>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 8 }}>
            <label style={{ cursor: "pointer", display: "block" }}>
              Upload voice
              <input type="file" accept="audio/*" hidden onChange={(e) => onVoiceUpload(e.target.files?.[0] ?? null)} />
            </label>
          </button>
          <div className="btn-row">
            <button
              type="button"
              className={`btn ${aiVoiceOn ? "btn-primary" : "btn-secondary"}`}
              onClick={turnAiVoiceOn}
              disabled={aiVoiceOn || voices.length === 0}
              title="Enable AI voice until Stop is pressed"
            >
              AI Voice {aiVoiceOn ? "ON" : "OFF"}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={turnAiVoiceOff}
              disabled={!aiVoiceOn}
              title="Stop AI voice (keeps selected audio)"
            >
              Stop
            </button>
          </div>
        </div>

        <button type="button" className="btn btn-secondary btn-block" onClick={() => setArchiveOpen(true)}>
          Archive Dashboard…
        </button>

        <div className="card">
          <div className="section-title">Settings</div>
          <label className="field-label">Theme:</label>
          <select value={settings.theme} onChange={(e) => patchSettings({ theme: e.target.value })}>
            <option value="dark">Dark mode</option>
            <option value="light">Light mode</option>
          </select>

          <label className="field-label">Mic:</label>
          <select
            value={settings.microphone_device ?? ""}
            onChange={(e) => patchSettings({ microphone_device: e.target.value || null })}
          >
            <option value="">Default</option>
            {micDevices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>

          <label className="field-label">Language:</label>
          <select value={settings.language} onChange={(e) => patchSettings({ language: e.target.value })}>
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </select>

          <label className="field-label">Clients:</label>
          <input
            placeholder="Client names"
            value={settings.participant_names}
            onChange={(e) => patchSettings({ participant_names: e.target.value }, 400)}
          />

          <label className="field-label">Chunks:</label>
          <input
            type="number"
            min={1}
            max={5}
            value={settings.sentences_per_chunk}
            onChange={(e) => patchSettings({ sentences_per_chunk: Number(e.target.value) }, 300)}
          />
        </div>

        <div className="card">
          <div className="section-title">Privacy blur</div>
          <label className="blur-check">
            <input
              type="checkbox"
              checked={settings.blur_enabled}
              onChange={(e) =>
                patchSettings({
                  blur_enabled: e.target.checked,
                  blur_percent: e.target.checked ? Math.max(settings.blur_percent, 10) : 0,
                })
              }
            />
            <span title="Blurs other participants in the top meeting window — your tile stays clear">
              Blur customers in Meet
            </span>
          </label>
          <div className="blur-row">
            <input
              type="range"
              min={0}
              max={100}
              value={settings.blur_percent}
              disabled={!settings.blur_enabled}
              title={`Blur: ${settings.blur_percent}% — ${blurDescription(settings.blur_percent)}`}
              onChange={(e) => patchSettings({ blur_percent: Number(e.target.value), blur_enabled: true }, 150)}
            />
            <span className="blur-pct">{settings.blur_percent}%</span>
          </div>
          <p className="muted tiny">Shortcut: Right Alt + ; cycles blur presets</p>
        </div>
      </aside>

      <ArchiveDashboard open={archiveOpen} onClose={() => setArchiveOpen(false)} onChanged={loadAll} />
    </>
  );
}
