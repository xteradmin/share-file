# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Browser-based local file transfer via WebRTC DataChannels. A lightweight signaling server handles LAN user discovery and WebRTC setup only; file bytes move directly peer-to-peer.

The current UI has two primary panels:
- Users: shows the local random username/device name, visible LAN users, and connect/disconnect actions.
- Transfer: shows file selection (picker, drag-and-drop, clipboard paste), incoming requests, progress, and completed downloads.

Files can be staged before a peer connection is established; once a DataChannel opens, staged files are broadcast as a catalog to all connected peers.

There are no room codes, activity timeline, or device/peer metrics rail.

## Commands

```bash
npm install
npm run dev        # starts both client (Vite :5180) and server (:3000) concurrently
npm run dev:client # client only
npm run dev:server # server only
npm run build      # builds client for production
npm start          # runs signaling server (production)
```

### Production Deployment

```bash
docker build -t share-file .
docker run -p 3000:3000 share-file
```

The server includes:
- **WebSocket heartbeat**: pings every 30s, disconnects clients that miss 2 pongs.
- **Graceful shutdown**: closes WebSocket connections and HTTP server on SIGTERM/SIGINT.
- **Cache headers**: static assets cached 1hr, HTML 30d.
- **CORS**: configurable via `CLIENT_ORIGIN` env var; all origins allowed when unset.

## Architecture

```text
client/                  React + Vite app
  src/
    App.jsx              Root component, LAN peer/signaling orchestration
    modules/
      pairing/           LAN user list and connect UI
      peer/              WebRTC peer connection hook
      signaling/         WebSocket client hook
      status/            Compact connection status badge
      transfer/          File transfer protocol and UI
server/                  Express + ws signaling server
  src/
    socketGateway.js     WebSocket server and message routing
    modules/
      peers/             LAN peer directory and connect requests
      signaling/         ICE/offer/answer relay
      health/            Health check endpoint
    shared/config.js     Port and CORS config
```

## Key Technical Details

### WebRTC File Transfer Protocol (`transferProtocol.js`)

- **Chunk size**: 256KB, kept under common WebRTC SCTP message limits.
- **File ID**: deterministic `${name}-${size}-${lastModified}`.
- **Control messages**: `file-meta`, `file-done`, `file-cancel`, `file-resume`.
- **Data**: raw `ArrayBuffer` chunks over the same ordered DataChannel.
- **Backpressure**: waits only when `bufferedAmount > 64MB`, using `bufferedamountlow` plus a 10ms poll fallback.
- **Resume timeout**: 30s timeout on `waitForResumeOffset`; aborts if receiver never replies.
- **Receiver**: waits for user acceptance, then streams to disk with the File System Access API when available; otherwise it falls back to a single in-memory buffer.

### Resume

The sender saves `{ name, size, mimeType, lastSentOffset }` to `localStorage` every 4MB. On reconnect, the sender sends `file-meta`, the receiver replies with `file-resume` using its current received offset, and the sender continues from that offset. Sender-side resume survives page reloads. Receiver-side resume survives reconnects while the receiver tab stays open.

### Signaling

- Custom WebSocket framing: `{ event, payload, requestId? }`.
- Peer events: `peer:announce`, `peer:list`, `peer:connect`, `peer:connect-request`, `peer:accept`, `peer:connect-accepted`, `peer:disconnect`.
- WebRTC relay events: `signal:send`, `signal:receive`.
- `useSignalingSocket.js` buffers events until listeners are registered, so early offer/ICE messages are not lost during setup.

### Peer Setup

- One active peer per browser client.
- Random display name per browser profile, persisted in `localStorage`.
- No TURN relay; direct/STUN-only connectivity.
- `usePeerConnection.js` exposes `signalingReady` after its `signal:receive` listener is installed.
- The receiver waits for `signalingReady` before sending `peer:accept`; this keeps the initiator from sending an offer before the receiver can process it.
- Transfer controls should stay disabled until the DataChannel state is `open`.

### File Input Methods

- **File picker button**: standard `<input type="file">` in the Transfer panel.
- **Drag-and-drop**: full-screen overlay with bounce animation when files are dragged over the page. Directories are filtered out. `dragend` listener prevents stuck overlay state.
- **Clipboard paste**: Ctrl+V / Cmd+V anywhere on the page (excluding input/textarea). Clipboard images get auto-generated names. Platform detection uses `navigator.userAgent` (not deprecated `navigator.platform`).

### LAN Access

- Server binds `0.0.0.0:3000`.
- Vite binds `0.0.0.0:5180`.
- In development, the client uses the Vite proxy for `/ws` and `/api`.
- `crypto.randomUUID()` has a fallback for non-secure HTTP LAN contexts.

### CORS

Default allows any origin when no `CLIENT_ORIGIN` env is set. Production deployments should set `CLIENT_ORIGIN`.

## Gotchas

- `useIncomingTransfers.js` requires receiver acceptance before sending `file-resume`; `showSaveFilePicker()` must run from the Save button click.
- `usePeerConnection.js` passes `(data, channel)` to `onDataMessage`; the receiver needs `channel` for resume.
- `peerConfig.js` has STUN only, so some networks cannot connect without adding TURN.
- `bufferedAmountLowThreshold` is adjusted around transfer backpressure logic, not in `peerConfig.js`.
- No tests or linting are configured.
- `navigator.platform` is deprecated; use `navigator.userAgent?.includes("Mac")` for macOS detection.
- `FileTransferPanel.jsx` uses stable refs (`onShareFileRef`, `channelReadyRef`, `sendingRef`) to keep the `addFiles` callback identity stable across renders.
