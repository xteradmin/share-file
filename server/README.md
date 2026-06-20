# Server

Express + WebSocket signaling server for LAN peer discovery and WebRTC negotiation.

The server does not store, proxy, or inspect files. It tracks connected browsers by random username/device name and routes opaque signaling payloads between two sockets.

## Responsibilities

- Serve health checks from `/api/health`.
- Accept WebSocket clients on `/ws`.
- Maintain the in-memory LAN user directory.
- Route connect requests and disconnect notices.
- Relay opaque WebRTC offer, answer, and ICE candidate payloads.
- Serve built client static assets with production cache headers (1hr for assets, 30d for HTML).

## Production Hardening

- **WebSocket heartbeat**: Pings each client every 30s. Clients that miss 2 consecutive pongs are forcibly disconnected.
- **Graceful shutdown**: On SIGTERM/SIGINT, closes all active WebSocket connections, then shuts down the HTTP server.
- **CORS**: Configurable via `CLIENT_ORIGIN` env var (comma-separated origins). All origins allowed when unset.
- **WebSocket message parsing**: All incoming JSON messages are wrapped in try-catch to prevent server crashes from malformed payloads.
- **Open listener cleanup**: WebSocket `open` event listeners are cleaned up on `close` to prevent memory leaks.

## Non-Responsibilities

- No file storage.
- No file metadata parsing.
- No room-code state.
- No TURN relay.
