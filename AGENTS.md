# Repository Guidelines

## Project Structure

This is a WebRTC file transfer app with a monorepo layout:
- `client/` - React + Vite browser app
- `server/` - Express + `ws` signaling server
- Both packages use ES modules (`"type": "module"`)

## Current Product Flow

The app is designed for devices on the same LAN. Each browser receives a random username/device name, announces itself to the signaling server, and appears in the Users panel. There are no room codes. Clicking a user starts pairing, then WebRTC negotiation opens a direct DataChannel. The UI intentionally focuses on two panels only: Users and Transfer.

**File input methods**: the drop zone is clickable (opens file picker), supports drag-and-drop (full-screen overlay with bounce animation), and paste via Ctrl+V / Cmd+V anywhere on the page (excluding input/textarea fields). Directories are filtered out on drop. Clipboard images are auto-named. **Files are auto-sent immediately** when added if a DataChannel is open — there is no Send button.

**Offline staging**: files added before a peer connection is established are staged in the sender's shared files catalog. Once a DataChannel opens, the catalog is broadcast to all connected peers. The sender sees their files in a "Your Shared Files" section.

## File Transfer Protocol (`transferProtocol.js`)

The sender sends 256KB `ArrayBuffer` chunks over a reliable WebRTC DataChannel. Control messages are JSON strings: `file-meta`, `file-done`, `file-cancel`, and `file-resume`.

**File ID** is `${name}-${size}-${lastModified}`. It is stable across reloads and supports resume.

**Resume**: the sender persists `{ name, size, mimeType, lastSentOffset }` to `localStorage` every 4MB. On reconnect, the receiver replies with `file-resume` using its current received offset, and the sender continues from there. Receiver-side resume survives reconnects while the receiver tab stays open.

**Backpressure**: the sender waits only when `channel.bufferedAmount > 64MB`, using `bufferedamountlow` plus a 10ms polling fallback for throttled/background tabs.

**Resume timeout**: `waitForResumeOffset` has a 30-second timeout. If the receiver never replies with `file-resume`, the send is aborted instead of hanging indefinitely.

## Receiver (`useIncomingTransfers.js`)

`handleDataMessage(data, channel)` receives the channel as its second argument for the resume handshake. On `file-meta`, it creates a pending incoming request and waits for `acceptIncoming()`. When the File System Access API is available, accepted transfers stream chunks directly to the selected file via `FileSystemWritableFileStream.write()`. Unsupported browsers fall back to one in-memory `ArrayBuffer`, allocated only after acceptance. React state updates are throttled to every 150ms.

On `file-cancel`, the receiver calls `cleanupChannelEvents()` and aborts the active sink to prevent event listener leaks and orphaned `.crswap` files. The auto-accept path (pre-created sinks, catalog downloads) wraps `performAccept` in `.catch()` to surface errors as failed status instead of unhandled rejections.

## Signaling Socket (`useSignalingSocket.js`)

The client uses a small custom WebSocket wrapper, not socket.io. Message format is `{ event, payload, requestId? }`. `generateId()` falls back when `crypto.randomUUID()` is unavailable on plain HTTP LAN origins.

`defaultSignalingUrl()` returns `window.location.origin`, so the browser connects through the Vite proxy in development. Incoming socket events are buffered until a listener is registered, which prevents early `signal:receive` messages from being dropped during React remounts or peer setup.

## WebRTC Peer Setup (`usePeerConnection.js`)

The peer hook owns `RTCPeerConnection`, offer/answer exchange, ICE candidate relay, and DataChannel setup. It exposes `signalingReady` after the `signal:receive` listener is registered. The receiving side should send `peer:accept` only after `signalingReady` is true, otherwise the initiator can send an offer before the receiver is listening. The hook also guards stale StrictMode cleanup paths so closed effects do not keep sending signals or updating state.

## WebSocket Relay Fallback (`RelayChannel.js`)

When WebRTC P2P connection fails after 3 retries (common on VPS deployments where devices are on different networks), the system automatically falls back to relaying data through the signaling WebSocket server. `RelayChannel` is a drop-in replacement for `RTCDataChannel` — it implements the same API (`.send()`, `.close()`, `.readyState`, `.onmessage`, `.addEventListener()`/`.removeEventListener()`, etc.) so the transfer protocol works unchanged. Binary data is base64-encoded for JSON transport through the WebSocket relay, which adds ~33% overhead but ensures connectivity when P2P is impossible.

**Server relay protocol** (`relay:open` → `relay:accept` → `relay:ready` → `relay:data` → `relay:close`) is handled by `relayHandlers.js`. The server maintains a `relayPairs` map and forwards data between matched peers. Cleanup happens automatically on WebSocket disconnect.

**Initiator role** for relay follows the same deterministic assignment as WebRTC: `selfPeer.id < peerId`. The signal handler skips relay records (`record.isRelay`) to avoid calling WebRTC methods on the fake PC stub.

## Gotchas

- `onDataMessage` in `usePeerConnection.js` passes `(event.data, nextChannel)`; both args are required.
- Transfers are enabled only when the DataChannel `readyState` is `open`; a paired peer can still show `Connecting` until WebRTC finishes.
- `crypto.randomUUID()` does not work over plain HTTP on non-localhost; use `generateId()`.
- Server CORS allows all origins when no `CLIENT_ORIGIN` env is set.
- No tests or linting are configured.
- `CHUNK_SIZE` must stay at or below 256KB; larger messages can exceed WebRTC SCTP message limits.
- `navigator.platform` is deprecated; use `navigator.userAgent?.includes("Mac")` for macOS detection.
- The `addFiles` callback in `FileTransferPanel.jsx` uses refs (`onShareFileRef`, `channelReadyRef`, `sendingRef`, `sendFilesNowRef`) to stay stable across renders and avoid unnecessary re-renders of parent components.
- `isDragging` state is reset by a document-level `dragend` listener so dragging files outside the browser window does not leave the overlay stuck.
- `peerConfig.js` reads TURN server config from `VITE_TURN_URL`, `VITE_TURN_USER`, `VITE_TURN_PASS` env vars (baked at build time by Vite). The Dockerfile accepts these as build args. See `.env.example`.
- Relay records use a fake PC stub (`{ close() {} }`) with `isRelay: true`. The signaling handler skips these records. All cleanup code is compatible because the stub has a no-op `close()`.
