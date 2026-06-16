# Server

Express + WebSocket signaling server for LAN peer discovery and WebRTC negotiation.

The server does not store or proxy files. It tracks connected users by random device name and routes opaque signaling payloads between two sockets.
