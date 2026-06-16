# Transfer Module

Owns file selection, chunked sending, incoming assembly, progress, and download links.

## Entry Points

- `FileTransferPanel.jsx` renders transfer controls and progress.
- `transferProtocol.js` defines DataChannel control messages and chunk sending.
- `useIncomingTransfers.js` accepts incoming files and writes received chunks to disk when supported, with an in-memory fallback.

## Protocol

Control messages are JSON strings with a `type` field. File bytes are sent as ordered binary chunks over the same reliable `RTCDataChannel`.

## AI Context

Keep this module independent from the signaling transport. Folder queues, checksums, and stronger persistent receiver-side resume should be added here without changing peer discovery or signaling modules.
