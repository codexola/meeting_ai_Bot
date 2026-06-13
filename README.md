# meeting_ai_Bot

Next.js frontend for MeetingBot — Google Meet, Zoom, and Microsoft Teams AI meeting assistant.

The **Python backend must run on your VPS** (Chrome for Google Meet, STT, LLM). This frontend connects to it via API proxy and WebSocket.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000

## Deploy to Vercel

1. Import the GitHub repo `codexola/meeting_ai_Bot` in [Vercel](https://vercel.com).
2. **Environment variables** (Project → Settings → Environment Variables):

| Variable | Example | Purpose |
|----------|---------|---------|
| `NEXT_PUBLIC_API_URL` | `http://103.179.45.111:8000` | VPS backend for `/api` rewrites |
| `NEXT_PUBLIC_WS_URL` | `wss://103.179.45.111:8000` | Live updates (use **wss://** on HTTPS Vercel) |

3. Deploy. Redeploy after changing env vars.

### VPS backend checklist

- Backend running: `uvicorn backend.app.main:app --host 0.0.0.0 --port 8000`
- Firewall allows **8000** (and **443** if using WSS)
- `.env` on VPS: `CORS_ORIGINS=https://your-app.vercel.app`
- For **WebSocket on Vercel (HTTPS)**: put nginx/Caddy in front of the backend with TLS → set `NEXT_PUBLIC_WS_URL=wss://your-api-domain`

Without WSS, REST still works via Vercel proxy; live transcript uses **HTTP polling fallback**.

## Architecture on Vercel

```
Browser (HTTPS) → Vercel Next.js → rewrite /api/* → VPS backend (HTTP)
Browser (HTTPS) → WebSocket directly → VPS backend (needs wss://)
Google Meet video → VPS Chrome → frame.jpg → /api proxy → browser
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Run production build |
