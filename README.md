# meeting_ai_Bot

Next.js frontend for MeetingBot — Google Meet, Zoom, and Microsoft Teams AI meeting assistant.

## Setup

```bash
npm install
cp .env.example .env.local
# Edit .env.local: NEXT_PUBLIC_API_URL and NEXT_PUBLIC_WS_PORT
npm run dev
```

Open http://localhost:3000

## Environment

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Backend API (e.g. `http://127.0.0.1:8000`) |
| `NEXT_PUBLIC_WS_PORT` | WebSocket port (default `8000`) |

## Production

```bash
npm run build
npm start
```

Requires the MeetingBot Python backend on port 8000.
