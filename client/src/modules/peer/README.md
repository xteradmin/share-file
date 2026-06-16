# Peer Module

Owns multi-peer WebRTC connections setup, auto-announce pairing, and dynamic LAN discovery.

## Entry Points

- `usePeerConnections.js` (plural) automatically establishes and manages concurrent peer connections with all active users on the LAN. It negotiates the WebRTC handshake, synchronizes catalogs, and forwards received channel messages.
- `peerConfig.js` stores ICE server configuration.

## Glare Resolution & Auto-Pairing

When multiple users on the same LAN discover each other, they announce their presence to the signaling server.
- The `usePeerConnections` hook automatically triggers WebRTC handshakes with all discovered peers.
- To avoid connection collisions (glare) when both devices create offers simultaneously, the hook deterministically assigns the initiator role by performing a lexicographical ID comparison between the local user's ID and the peer's ID (`selfPeer.id < peer.id`).

## Catalog Syncing & File Handling

- Once a DataChannel state transitions to `"open"`, the hook automatically broadcasts the local list of shared files to the peer.
- The hook listens for catalog updates (`{ type: "catalog-share" }`) and updates `networkFiles` state to compile a local directory of all files available on the LAN.
- The hook handles `{ type: "file-request" }` messages by automatically triggering `sendFile` to stream the requested file to the peer.
- Received channel messages are forwarded to the transfer module via the `onDataMessage` callback, which accepts the message payload, active data channel, and the sender's `peerId`.

## Peer Disconnect & Link Cleanup

- If a peer goes offline or the connection fails, the hook triggers the `onPeerDisconnect(peerId)` callback.
- This allows the parent component to clean up dynamic assets, purge the peer's shared files, abort pending transfer sinks, and delete temporary swap files (`.crswap`) instantly.

## LAN Support Candidate & SDP Rewriting

In non-secure HTTP contexts on a LAN, browsers hide local IPv4 candidates behind randomly generated `.local` mDNS hostnames. Since local routers and client devices cannot resolve these hostnames directly, WebRTC connections fail.
- When receiving a signal message, the hook extracts the `senderIp` sent by the signaling server.
- It scans the SDP and candidate descriptions for `*.local` hostnames and replaces them with the sender's actual IP address.
- In `onicecandidate`, the candidate is standardized using `.toJSON()` to prevent serialization issues across different browser versions.
