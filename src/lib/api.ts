import { backendApiUrl } from "@/lib/backendUrl";

/** Backend URL for Next.js server-side proxy. Browser uses same-origin /api. */
export { backendApiUrl } from "@/lib/backendUrl";

export const API_BASE =
  typeof window !== "undefined"
    ? "" // same-origin — proxied by Next.js API route on Vercel / VPS
    : backendApiUrl();

export type AppSettings = {
  language: string;
  use_ai_voice: boolean;
  use_ai_face: boolean;
  active_face_id: number | null;
  active_voice_id: number | null;
  blur_enabled: boolean;
  blur_percent: number;
  participant_names: string;
  sentences_per_chunk: number;
  theme: string;
  microphone_device: string | null;
};

export const BLUR_PRESETS: number[] = [0, 10, 50, 100];

const BLUR_DESCRIPTIONS: Record<number, string> = {
  0: "fully visible",
  10: "face visible, body hidden",
  50: "face barely visible",
  100: "face fully obscured",
};

export function blurDescription(percent: number): string {
  const keys = Object.keys(BLUR_DESCRIPTIONS)
    .map(Number)
    .sort((a, b) => a - b);
  let best = keys[0];
  for (const k of keys) {
    if (percent >= k) best = k;
  }
  return BLUR_DESCRIPTIONS[best] ?? "custom blur";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string; database: boolean; openai_configured: boolean }>("/api/health"),
  knowledge: () => request<{ materials_count: number; meetings_count: number; summary: string }>("/api/knowledge"),
  getSettings: () => request<AppSettings>("/api/settings"),
  updateSettings: (patch: Partial<AppSettings>) =>
    request<AppSettings>("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  createSession: (participant_name: string, meeting_url: string) =>
    request<Session>("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant_name, meeting_url }),
    }),
  getSession: (id: number) => request<Session>(`/api/sessions/${id}`),
  bootstrapSession: (id: number) =>
    request<SessionBootstrap>(`/api/sessions/${id}/bootstrap`),
  sessionLive: (id: number) => request<LiveSession>(`/api/sessions/${id}/live`),
  listSessions: () => request<MeetingSummary[]>("/api/sessions"),
  deleteSession: (id: number) => request<{ deleted: number }>(`/api/sessions/${id}`, { method: "DELETE" }),
  getSessionArchive: (id: number) => request<{ text: string }>(`/api/sessions/${id}/archive`),
  listUtterances: (id: number) => request<Utterance[]>(`/api/sessions/${id}/utterances`),
  listResponses: (id: number) => request<ResponseChunk[]>(`/api/sessions/${id}/responses`),
  startAssistant: (id: number) => request<{ active: boolean; knowledge?: string }>(`/api/sessions/${id}/start`, { method: "POST" }),
  stopAssistant: (id: number) => request<{ active: boolean }>(`/api/sessions/${id}/stop`, { method: "POST" }),
  sendSpeech: (id: number, text: string, speaker_name?: string) =>
    request<{ accepted: boolean }>(`/api/sessions/${id}/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, speaker_name }),
    }),
  listFaces: () => request<FaceAsset[]>("/api/assets/faces"),
  listVoices: () => request<VoiceAsset[]>("/api/assets/voices"),
  uploadFace: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<FaceAsset>("/api/assets/faces", { method: "POST", body: fd });
  },
  uploadVoice: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<VoiceAsset>("/api/assets/voices", { method: "POST", body: fd });
  },
  activateFace: (id: number) => request(`/api/assets/faces/${id}/activate`, { method: "PUT" }),
  deactivateFace: () => request<{ active_face_id: null }>("/api/assets/faces/deactivate", { method: "POST" }),
  activateVoice: (id: number) => request(`/api/assets/voices/${id}/activate`, { method: "PUT" }),
  deactivateVoice: () => request<{ active_voice_id: null }>("/api/assets/voices/deactivate", { method: "POST" }),
  deleteFace: (id: number) => request<{ deleted: number }>(`/api/assets/faces/${id}`, { method: "DELETE" }),
  deleteVoice: (id: number) => request<{ deleted: number }>(`/api/assets/voices/${id}`, { method: "DELETE" }),
  ingestMaterials: () => request("/api/materials/ingest", { method: "POST" }),
  startMeetingView: (id: number) =>
    request<{ mode: string; started: boolean; pending?: boolean; error?: string }>(
      `/api/sessions/${id}/meeting-view/start`,
      { method: "POST" }
    ),
  clickMeetingView: (id: number, x: number, y: number) =>
    request(`/api/sessions/${id}/meeting-view/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y }),
    }),
  joinMeetingView: (id: number) =>
    request<{ joined: boolean; pending?: boolean; error?: string }>(
      `/api/sessions/${id}/meeting-view/join`,
      { method: "POST" }
    ),
  meetingViewStatus: (id: number) =>
    request<{
      chrome_ready: boolean;
      started: boolean;
      launch_in_progress: boolean;
      pending_join: boolean;
      has_frame: boolean;
      in_call: boolean;
      on_prejoin: boolean;
      error?: string | null;
    }>(`/api/sessions/${id}/meeting-view/status`),
  startFaceCam: (id: number) =>
    request<{ active: boolean; virtual_cam: boolean; hint?: string }>(
      `/api/sessions/${id}/face-cam/start`,
      { method: "POST" }
    ),
  stopFaceCam: (id: number) =>
    request(`/api/sessions/${id}/face-cam/stop`, { method: "POST" }),
};

export type SessionBootstrap = {
  session: Session;
  openai_configured: boolean;
  database: boolean;
  knowledge_summary: string;
  materials_count: number;
  meetings_count: number;
};

export type LiveSession = {
  assistant_active: boolean;
  utterances: Utterance[];
  responses: ResponseChunk[];
};

export type Session = {
  id: number;
  participant_name: string;
  meeting_url: string;
  platform: string;
  started_at: string;
  ended_at?: string | null;
  archive_path?: string | null;
  assistant_active?: boolean;
};

export type MeetingSummary = {
  id: number;
  participant_name: string;
  meeting_url: string;
  platform: string;
  started_at: string;
  ended_at?: string | null;
};

export type Utterance = {
  id: number;
  speaker: string;
  text: string;
  timestamp: string;
};

export type ResponseChunk = {
  index: number;
  text: string;
  phonetic: string;
  estimated_seconds: number;
};

export type FaceAsset = {
  id: number;
  name: string;
  file_path: string;
  is_active: boolean;
  url: string;
};

export type VoiceAsset = {
  id: number;
  name: string;
  sample_path: string;
  is_active: boolean;
  url: string;
};

export type WsEvent =
  | { type: "client_transcript"; payload: { speaker_name: string; text: string } }
  | { type: "response_chunk"; payload: { index: number; text: string; phonetic: string; estimated_seconds: number } };

/** WebSocket URL — must be reachable from the browser (use wss:// when frontend is on HTTPS/Vercel). */
export function canUseWebSocket(): boolean {
  if (typeof window === "undefined") return false;
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "";
  // Browsers block ws:// from https:// pages (mixed content)
  if (window.location.protocol === "https:" && wsUrl.startsWith("ws://")) {
    return false;
  }
  return Boolean(wsUrl);
}

export function meetingWsUrl(meetingId: number): string {
  const configured = process.env.NEXT_PUBLIC_WS_URL?.replace(/\/$/, "");
  if (configured) {
    return `${configured}/api/ws/sessions/${meetingId}`;
  }
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.hostname}:8000/api/ws/sessions/${meetingId}`;
  }
  return `ws://127.0.0.1:8000/api/ws/sessions/${meetingId}`;
}

/** Production Vercel + HTTP backend: live updates use HTTP polling instead of WebSocket. */
export function usesHttpPolling(): boolean {
  return !canUseWebSocket();
}

export function platformLabel(platform: string): string {
  const map: Record<string, string> = {
    google_meet: "Google Meet",
    zoom: "Zoom",
    teams: "Microsoft Teams",
  };
  return map[platform] || platform;
}

export function canEmbedMeeting(platform: string): boolean {
  return platform === "zoom" || platform === "teams";
}

/** Google Meet is shown embedded in the panel via server Chrome stream (Meet blocks iframe). */
export function usesMeetingStream(platform: string): boolean {
  return platform === "google_meet";
}

export function meetingFrameUrl(meetingId: number, t?: number): string {
  const q = t ?? Date.now();
  return `/api/sessions/${meetingId}/meeting-view/frame.jpg?t=${q}`;
}

export function apiPath(path: string): string {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}
