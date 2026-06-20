# Share File

Browser-based local file transfer using WebRTC DataChannels. The signaling server lists users on the same LAN and coordinates peer setup only; file bytes move directly between browsers.

## What It Does

- **Auto-Announce & Auto-Pairing**: Displays nearby LAN devices with random usernames/device names and establishes WebRTC connections automatically without room codes or manual clicking to connect.
- **Drag-and-Drop & Clipboard Paste**: Drop files onto the page (full-screen overlay with bounce animation) or paste via Ctrl+V / Cmd+V anywhere. Directories are filtered; clipboard images are auto-named.
- **Offline File Staging**: Stage files before a peer connection exists. Once connected, staged files are broadcast as a catalog to all peers.
- **Decentralized LAN Shared Catalog**: Broadcasts staged and completed files to a local network library. Users can browse and request files shared by other connected devices.
- **One-Click Direct Downloads**: Clicking "Download" next to any file in the network library opens the browser's save picker (or memory buffer) and begins downloading instantly, bypassing redundant "Accept" prompts.
- **Centered Modal Overlay**: Pushed transfers (files sent directly to all users) appear in a premium centered modal overlay with a blurred background, locking focus and eliminating scrolling.
- **Auto-Retry & Network Recovery**: Automatically schedules and runs WebRTC re-negotiations (up to 3 times) if a channel drops. Purges catalog files and active streams instantly if a peer goes offline or signaling drops.
- **Browser-Safe Streaming**: Writes incoming chunks directly to disk in supported browsers using the File System Access API. Automatically prompts and triggers browser downloads for memory fallbacks, with tab-crash warnings for large files.
- **Sender-Side Resume**: Saves transfer progress offsets every 4MB to support resumption from where a transfer was interrupted. Resume handshake times out after 30s if the receiver never responds.
- **Production Hardening**: WebSocket heartbeat (30s ping), graceful shutdown on SIGTERM/SIGINT, static asset cache headers, and configurable CORS via `CLIENT_ORIGIN`.

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
- `server/` - Express + `ws` signaling server
- `client/src/modules/*/README.md` - frontend module summaries
- `server/src/modules/*/README.md` - backend module summaries

## How It Works

1. Each browser gets a random username/device name and announces itself to the signaling server.
2. Users on the same LAN are automatically paired by the signaling socket using deterministic lexicographical ID sorting to avoid glare/collisions during concurrent WebRTC handshakes.
3. Once WebRTC connects and opens a data channel, peers automatically exchange catalogs of files they are currently sharing.
4. If a user clicks **"Download"** next to a shared file, the downloader pre-creates the file/folder stream (user gesture) and requests the file from the host.
5. The host automatically streams the file. The receiver matches the transfer ID and auto-accepts the stream directly into the pre-created sink.
6. For pushed transfers, the receiver is prompted with a centered backdrop-blurred modal to Accept/Save.
7. File bytes transfer peer-to-peer in 256KB chunks with backpressure and resume support. If a connection closes mid-transfer, active stream locks are automatically aborted and temporary files deleted.

## Environment

- `VITE_SIGNALING_URL` - override signaling URL for production clients.
- `CLIENT_ORIGIN` - comma-separated allowed origins; all origins are allowed when unset.
- Local client uses port `5180`; server uses port `3000`.
- Vite dev server proxies `/ws` and `/api` to the server.
