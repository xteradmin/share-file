# Share File

Browser-based local file transfer using WebRTC DataChannels. The signaling server shows LAN users and coordinates peer setup only; file bytes move peer-to-peer.

## Commands

```bash
npm install
npm run dev        # starts client (:5180) and server (:3000) concurrently
npm run dev:client # client only
npm run dev:server # server only
npm run build      # builds client for production
npm start          # runs signaling server (production)
```

## Workspace Layout

- `client/` - React + Vite browser app
- `server/` - Express + ws signaling server
- `client/src/modules/*/README.md` - AI-facing summaries for frontend modules
- `server/src/modules/*/README.md` - AI-facing summaries for backend modules

## How It Works

1. Each browser gets a random device name and announces itself to the signaling server
2. Users on the same LAN appear in the user list
3. Clicking a user starts WebRTC negotiation and opens a DataChannel
4. File bytes transfer peer-to-peer; transfers support background tabs and resume

## Environment

- `VITE_SIGNALING_URL` - override signaling URL for production clients
- `CLIENT_ORIGIN` - comma-separated allowed origins (allows all if unset)
- Local client uses port `5180`, server uses port `3000`
- Vite dev server proxies `/ws` and `/api` to server
