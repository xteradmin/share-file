# Peer Module

Owns browser-to-browser WebRTC setup.

## Entry Points

- `usePeerConnection.js` creates `RTCPeerConnection`, exchanges offers, answers, and ICE candidates through the signaling socket, and exposes the active `RTCDataChannel`.
- `peerConfig.js` stores ICE server configuration.

## Protocol Boundary

This module moves signaling envelopes only. It does not know peer-directory internals or file-transfer message schemas beyond forwarding received DataChannel messages to the transfer module.

## AI Context

For TURN relay, update `peerConfig.js`. For connection diagnostics, add `getStats()` polling here and expose selected candidate-pair type to the status module.
