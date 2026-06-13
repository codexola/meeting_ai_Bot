/** Backend URL used by the Next.js server-side API proxy (Vercel + local dev). */
export function backendApiUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
}
