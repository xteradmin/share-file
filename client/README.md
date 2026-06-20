# Client

React + Vite app for automatic multi-peer LAN auto-pairing, decentralized file catalog sharing, and peer-to-peer file transfers using WebRTC DataChannels.

The interface is streamlined into a single-column Transfer panel that displays:
- Active LAN device status badges and their live WebRTC states.
- Interrupted transfers with options to Resume or Dismiss.
- **Drag-and-drop zone** with full-screen overlay and bounce animation when files are dragged over the page.
- **Clipboard paste** support (Ctrl+V / Cmd+V) with shortcut badges for discoverability.
- Standard file picker to stage files and broadcast them to the LAN.
- **Offline staging** — files can be staged before a peer connection exists and are broadcast once connected.
- Centered, backdrop-blurred modal prompts for accepting incoming pushed transfers.
- **Files Available on LAN** catalog list with one-click direct download actions.
- **Completed Downloads** list with status indicators.

Feature modules live in `src/modules/`. Each module owns its UI, hooks, and local summaries.

## Runtime Flow

1. `useSignalingSocket()` connects to the server and buffers early socket events.
2. `App.jsx` announces the local random username/device name.
3. `usePeerConnections()` (plural) establishes automatic WebRTC handshakes with all discovered LAN users. It resolves offer collisions (glare) deterministically using lexicographical client ID sorting.
4. Once connected, peers synchronize their shared file catalogs via data channel control messages.
5. `FileTransferPanel.jsx` allows users to select files to stage/share, and request files from the LAN catalog.
6. The transfer module handles sequential chunk transmission, backpressure flow controls, disk-streaming file system sinks, and automatic cleanup of write handles on peer disconnection.
