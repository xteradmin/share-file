# Signaling Module

Routes opaque WebRTC signaling payloads between connected clients.

## Entry Points

- `signalingHandlers.js` handles `signal:send` messages from the WebSocket gateway.

## Socket Events

- Client sends `signal:send` with `{ targetId, payload }`.
- Server forwards `{ from, payload }` to `targetId`.

## AI Context

The server must not parse SDP, ICE candidates, or file metadata. Treat payloads as opaque envelopes and keep validation limited to routing fields.
