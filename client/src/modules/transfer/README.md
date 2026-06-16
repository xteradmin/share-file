# Transfer Module

Owns file catalog registration, chunked sending and receiving, sequential transfer queues, disk-streaming file system sinks, auto-accept matching, and automatic cleanup of write handles on link loss.

## Features & UX Flows

- **Decentralized LAN Shared Catalog**: Connected LAN devices sync catalogs of staged files. Clicking "Download" on a file automatically handles the download on-demand from the peer.
- **One-Click Direct Downloads**: Clicking "Download" on the LAN catalog immediately triggers the user save dialog (if supported), saves the resulting stream write sink, and sends the request. When the peer replies with the matching catalog file ID, the receiver auto-accepts and streams the bytes directly, bypassing any secondary "Accept/Save" prompts.
- **Auto-Download Memory Transfers**: For browsers without File System Access API support (which buffer chunks in an in-memory ArrayBuffer), once the transfer finishes, the application programmatically triggers a browser download on the blob URL. The user only clicks "Download" once.
- **Centered Modal Overlay**: When a sender pushes files directly (using the Send button), the receiver is prompted with a centered, backdrop-blurred modal dialog. This eliminates scrolling up to accept or reject pushed transfers.
- **Crash Safety Memory Warnings**: Warns users on mobile/Safari browsers if they attempt to download files larger than 150MB in memory, prompting them to switch to a browser that supports File System Access (e.g., Chrome, Edge).
- **.crswap Swap File Protection**:
  - Monitors the active WebRTC data channel for `close` and `error` events. If the channel drops mid-transfer, it immediately aborts the active stream to delete the temporary `.crswap` file.
  - Automatically aborts and deletes pre-created write streams if a peer goes offline or signaling disconnects.
  - If a file request fails to send over WebRTC, the pre-created sink is immediately aborted and cleaned up.

## Entry Points

- `FileTransferPanel.jsx` renders the single-column Transfer panel, LAN status badges, staging controls, centered overlay modal, network catalog, and completed list.
- `transferProtocol.js` defines WebRTC data channel control messages, sequential queue transmissions, and chunk sending with native backpressure flow control (with 10ms polling fallbacks for throttled background tabs).
- `useIncomingTransfers.js` manages incoming file streams, pre-created writable file sinks, directory pickers for "Save All" queues, auto-accept logic, and event-driven cleanup handles.

## Protocol Messages

- `file-meta` announces file metadata, catalog file ID, as well as `queueIndex` and `queueSize` for sequential transfer queues.
- `file-resume` tells the sender which byte offset the receiver already has.
- `file-done` closes a successful transfer.
- `file-cancel` stops an in-progress transfer.
- `file-request` (sent over data channel) requests a file by its catalog ID.
- `catalog-share` (sent over data channel) synchronizes the array of shared files with the peer.
