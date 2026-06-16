# Signaling Module

Owns the WebSocket client connection to the cloud signaling server.

## Entry Points

- `useSignalingSocket.js` creates a small event-emitter wrapper around the browser `WebSocket`.

## Protocol Boundary

This module should only manage transport connectivity. Peer discovery events belong in `pairing`, WebRTC offer/answer handling belongs in `peer`, and file metadata belongs in `transfer`.

## AI Context

If changing server URLs or authentication, start here. The wrapper intentionally exposes `emit`, `on`, and `off` so feature modules do not depend on raw WebSocket framing.
