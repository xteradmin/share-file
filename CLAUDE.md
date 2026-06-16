# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Browser-based local file transfer via WebRTC DataChannels. Signaling server coordinates LAN peer discovery and WebRTC setup; file bytes move peer-to-peer.

## Commands

```bash
npm install
npm run dev        # starts both client (Vite :5180) and server (:3000) concurrently
npm run dev:client # client only
npm run dev:server # server only
npm run build      # builds client for production
npm start          # runs signaling server (production)
```

## Architecture

```
client/                  React + Vite app
  src/
    App.jsx              Root component, LAN peer/signaling orchestration
    modules/
      pairing/           LAN user list and connect UI
      peer/              WebRTC peer connection (usePeerConnection hook)
      signaling/         WebSocket client (useSignalingSocket hook)
      status/            Connection status display
      transfer/          File transfer protocol + UI
server/                  Express + ws signaling server
  src/
    socketGateway.js     WebSocket server, message routing
    modules/
      peers/             LAN peer directory and connect requests
      signaling/         ICE/offer/answer relay
      health/            Health check endpoint
    shared/config.js     Port, CORS config
```

## Key Technical Details

### WebRTC File Transfer Protocol (transferProtocol.js)

- **Chunk size**: 256KB (SCTP max safe size across browsers)
- **File ID**: stable — `${name}-${size}-${lastModified}` (not Date.now())
- **Control messages** (JSON over DataChannel): `file-meta`, `file-done`, `file-cancel`, `file-resume`
- **Data**: ArrayBuffer chunks, no encoding
- **Backpressure**: waits only when `bufferedAmount > 64MB`, uses `bufferedamountlow` event + 10ms poll fallback for background tabs
- **Receiver**: waits for user acceptance, then streams chunks to a selected file with the File System Access API when available; unsupported browsers fall back to an in-memory buffer

### Resume

Sender saves `{ name, size, mimeType, lastSentOffset }` to `localStorage` every 4MB. On reconnect, sender sends `file-meta`, receiver replies `file-resume` with its current received offset, sender resumes from that offset. File ID is deterministic so sender-side state survives page reloads; receiver-side resume survives reconnects while the receiver tab stays open.

### Background Sending

`waitForDrain()` uses both `bufferedamountlow` event and `setInterval(10)` poll. Background tabs throttle to ~1Hz but transfers continue at reduced speed. No forced stop on tab switch.

### Signaling (WebSocket)

- Message format: `{ event, payload, requestId? }`
- `peer:announce` / `peer:list` / `peer:connect` / `peer:accept` / `peer:disconnect` - LAN user discovery and pairing
- `signal:send` / `signal:receive` — WebRTC offer/answer/ICE relay

### Peer Constraints

- Random device name per browser, one active peer per client, no TURN (direct connections only)

### LAN Access

- Server binds `0.0.0.0:3000`, Vite binds `0.0.0.0:5180`
- In dev, client connects WebSocket through Vite proxy (same origin) — avoids firewall issues
- `crypto.randomUUID()` has a fallback for non-secure contexts (HTTP LAN)

### CORS

Default allows any origin when no `CLIENT_ORIGIN` env is set. Production: set `CLIENT_ORIGIN` to restrict.

## Gotchas

- `useIncomingTransfers.js` requires receiver acceptance before sending `file-resume`; `showSaveFilePicker()` must be called from the Save button click
- `usePeerConnection.js` passes `(data, channel)` to `onDataMessage` — receiver needs `channel` for resume handshake
- `peerConfig.js` has STUN only (no TURN) — won't work across symmetric NATs
- `bufferedAmountLowThreshold` is set dynamically in `waitForDrain()`, not in `peerConfig.js`
- No tests, no linting configured
