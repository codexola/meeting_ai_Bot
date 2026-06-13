"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function StartPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);

  useEffect(() => {
    api.health().then(() => setBackendOk(true)).catch(() => setBackendOk(false));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim() || !url.trim()) {
      setError("Name and meeting URL are required.");
      return;
    }
    setLoading(true);
    try {
      api.ingestMaterials().catch(() => {});
      const session = await api.createSession(name.trim(), url.trim());
      router.push(`/meeting/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="start-page card">
      <h1>MeetingBot</h1>
      <p>Google Meet · Zoom · Microsoft Teams — shared database &amp; AI knowledge</p>
      {backendOk === false && (
        <p style={{ color: "#e5383b", marginBottom: 12 }}>
          Backend unreachable. Ensure the VPS API is running and Vercel env{" "}
          <code>NEXT_PUBLIC_API_URL=http://103.179.45.111:8000</code> is set, then redeploy.
        </p>
      )}
      {backendOk === true && (
        <p className="muted" style={{ marginBottom: 12, fontSize: 12 }}>
          Backend connected
        </p>
      )}
      <form onSubmit={onSubmit}>
        <div className="form-row">
          <label htmlFor="name">Your name</label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name in meeting"
          />
        </div>
        <div className="form-row">
          <label htmlFor="url">Meeting URL</label>
          <input
            id="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Google Meet, Zoom, or Teams link"
          />
        </div>
        {error && <p style={{ color: "#e5383b", marginBottom: 12 }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: "100%" }}>
          {loading ? "Starting…" : "Start Meeting"}
        </button>
      </form>
    </div>
  );
}
