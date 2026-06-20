import { useCallback, useEffect, useRef, useState } from "react";
import { DATA_CHANNEL_LABEL, peerConnectionConfig } from "./peerConfig.js";
import { sendFile } from "../transfer/transferProtocol.js";
import { RelayChannel } from "./RelayChannel.js";

export function usePeerConnections({
  socket,
  selfPeer,
  availablePeers,
  sharedFiles,
  onDataMessage,
  onEvent,
  onPeerDisconnect,
}) {
  const connectionsRef = useRef(new Map());
  const retryCountsRef = useRef(new Map());
  const retryingRef = useRef(new Set());
  const setupPeerConnectionRef = useRef(null);
  const sharedFilesRef = useRef(sharedFiles);
  sharedFilesRef.current = sharedFiles;
  const availablePeersRef = useRef(availablePeers);
  availablePeersRef.current = availablePeers;
  const [channelStates, setChannelStates] = useState({});
  const [networkFiles, setNetworkFiles] = useState(new Map());

  const removePeerFiles = useCallback((peerId) => {
    setNetworkFiles((prev) => {
      const next = new Map(prev);
      const keysToDelete = [];
      for (const [fileId, file] of next.entries()) {
        if (file.ownerId === peerId) {
          keysToDelete.push(fileId);
        }
      }
      keysToDelete.forEach((key) => next.delete(key));
      return next;
    });
  }, []);

  const configureChannel = useCallback(
    (peerId, displayName, nextChannel) => {
      nextChannel.binaryType = "arraybuffer";
      nextChannel.bufferedAmountLowThreshold = 4 * 1024 * 1024;

      const record = connectionsRef.current.get(peerId);
      if (record) {
        record.channel = nextChannel;
      }

      setChannelStates((prev) => ({ ...prev, [peerId]: nextChannel.readyState }));

      nextChannel.onopen = () => {
        setChannelStates((prev) => ({ ...prev, [peerId]: nextChannel.readyState }));
        retryCountsRef.current.set(peerId, 0); // Reset retry count on successful open
        onEvent?.(`Data channel opened with ${displayName}.`);

        // Send catalog immediately upon opening (use ref to get latest sharedFiles)
        try {
          const catalogMsg = JSON.stringify({
            type: "catalog-share",
            files: Array.from(sharedFilesRef.current.values()).map((f) => ({
              id: f.id,
              name: f.name,
              size: f.size,
              mimeType: f.mimeType,
            })),
          });
          nextChannel.send(catalogMsg);
        } catch (err) {
          onEvent?.(`Failed to send catalog to ${displayName}: ${err.message}`);
        }
      };

      nextChannel.onclose = () => {
        setChannelStates((prev) => ({ ...prev, [peerId]: nextChannel.readyState }));
        onEvent?.(`Data channel closed with ${displayName}.`);
        removePeerFiles(peerId);
      };

      nextChannel.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const message = JSON.parse(event.data);
            if (message.type === "catalog-share") {
              setNetworkFiles((prev) => {
                const next = new Map(prev);
                // Clear old files from this peer safely without mutating during iteration
                const keysToDelete = [];
                for (const [fileId, file] of next.entries()) {
                  if (file.ownerId === peerId) {
                    keysToDelete.push(fileId);
                  }
                }
                keysToDelete.forEach((key) => next.delete(key));
                // Add new shared files
                (message.files || []).forEach((f) => {
                  next.set(f.id, {
                    id: f.id,
                    name: f.name,
                    size: f.size,
                    mimeType: f.mimeType,
                    ownerId: peerId,
                    ownerName: displayName,
                  });
                });
                return next;
              });
              return;
            }

            if (message.type === "file-request") {
              const fileRecord = sharedFilesRef.current.get(message.id);
              if (fileRecord) {
                onEvent?.(`Auto-sending requested file "${fileRecord.name}" to ${displayName}...`);
                sendFile({
                  channel: nextChannel,
                  file: fileRecord.fileOrBlob,
                  id: fileRecord.id,
                  onProgress: () => {}, // Silent background updates
                }).catch((err) => {
                  onEvent?.(`Background send failed for ${fileRecord.name}: ${err.message}`);
                });
              } else {
                onEvent?.(`Requested file ID ${message.id} not found in sharing catalog.`);
              }
              return;
            }
          } catch (e) {
            // Ignore JSON parse errors, relay message normally
          }
        }
        onDataMessage?.(event.data, nextChannel, peerId);
      };
    },
    [onDataMessage, onEvent, removePeerFiles]
  );

  const negotiateInitiator = useCallback(
    async (record, peerId, displayName) => {
      try {
        const nextChannel = record.pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true });
        configureChannel(peerId, displayName, nextChannel);

        const offer = await record.pc.createOffer();
        await record.pc.setLocalDescription(offer);

        socket.emit("signal:send", {
          targetId: peerId,
          payload: { type: "offer", description: record.pc.localDescription },
        });
        onEvent?.(`Offer sent to ${displayName}.`);
      } catch (err) {
        onEvent?.(`Failed to create offer for ${displayName}: ${err.message}`);
      }
    },
    [socket, configureChannel, onEvent]
  );

  const triggerRetry = useCallback(
    (peerId, displayName, isInitiator) => {
      if (retryingRef.current.has(peerId)) {
        return;
      }
      retryingRef.current.add(peerId);

      // Clean up failed connection
      const record = connectionsRef.current.get(peerId);
      if (record) {
        clearTimeout(record._connectTimer);
        record.channel?.close();
        record.pc.close();
        record.closed = true; // Prevent duplicate retry from simultaneous state changes
        connectionsRef.current.delete(peerId);
        removePeerFiles(peerId);
        onPeerDisconnect?.(peerId);
      }

      setChannelStates((prev) => ({ ...prev, [peerId]: "connecting" }));

      const count = retryCountsRef.current.get(peerId) || 0;
      if (count < 1) {
        retryCountsRef.current.set(peerId, count + 1);
        onEvent?.(`Retrying connection with ${displayName} (attempt ${count + 1}/2)...`);
        setTimeout(() => {
          retryingRef.current.delete(peerId);
          // Check if peer is still online before retrying (use ref for latest list)
          const isPeerOnline = availablePeersRef.current.some((p) => p.id === peerId);
          if (isPeerOnline && setupPeerConnectionRef.current) {
            const newRecord = setupPeerConnectionRef.current(peerId, displayName, isInitiator);
            if (isInitiator) {
              negotiateInitiator(newRecord, peerId, displayName);
            }
          }
        }, 1000);
      } else {
        retryingRef.current.delete(peerId);
        onEvent?.(`WebRTC failed. Switching to server relay for ${displayName}...`);
        // Fall back to relay mode through the signaling server
        if (socket) {
          const relay = new RelayChannel(socket, peerId);
          const relayRecord = {
            pc: { close() {}, connectionState: "connected", iceConnectionState: "connected" },
            channel: relay,
            pendingCandidates: [],
            isInitiator: isInitiator,
            displayName,
            isRelay: true,
          };
          connectionsRef.current.set(peerId, relayRecord);
          configureChannel(peerId, displayName, relay);
          if (isInitiator) {
            socket.emit("relay:open", { targetId: peerId });
          }
        } else {
          setChannelStates((prev) => ({ ...prev, [peerId]: "failed" }));
        }
      }
    },
    [removePeerFiles, onEvent, negotiateInitiator, socket, configureChannel]
  );

  const setupPeerConnection = useCallback(
    (peerId, displayName, isInitiator) => {
      const pc = new RTCPeerConnection(peerConnectionConfig);
      const record = {
        pc,
        channel: null,
        pendingCandidates: [],
        isInitiator,
        displayName,
      };

      connectionsRef.current.set(peerId, record);
      setChannelStates((prev) => ({ ...prev, [peerId]: "connecting" }));

      // Connection timeout: if WebRTC hasn't connected within 20s, skip to relay fallback.
      // This is critical for VPS deployments where ICE may hang in "checking" forever
      // (e.g. symmetric NATs) without ever reaching "failed".
      const connectTimer = setTimeout(() => {
        if (record.closed) return;
        const state = pc.connectionState;
        if (state !== "connected" && state !== "completed") {
          record.closed = true;
          pc.close();
          triggerRetry(peerId, displayName, isInitiator);
        }
      }, 8_000);
      record._connectTimer = connectTimer;

      pc.onconnectionstatechange = () => {
        // Sync states to UI
        const state = pc.connectionState;
        setChannelStates((prev) => ({
          ...prev,
          [peerId]: state === "connected" && record.channel?.readyState === "open" ? "open" : state,
        }));

        // Connection established or permanently failed — cancel the timeout
        if (state === "connected" || state === "completed" || state === "failed") {
          clearTimeout(connectTimer);
        }

        if ((state === "failed" || state === "disconnected") && !record.closed) {
          record.closed = true;
          triggerRetry(peerId, displayName, isInitiator);
        }
      };

      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        if (state === "connected" || state === "completed" || state === "failed") {
          clearTimeout(connectTimer);
        }
        if (state === "failed" && !record.closed) {
          record.closed = true;
          triggerRetry(peerId, displayName, isInitiator);
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const candidateJson = typeof event.candidate.toJSON === "function"
            ? event.candidate.toJSON()
            : {
                candidate: event.candidate.candidate,
                sdpMid: event.candidate.sdpMid,
                sdpMLineIndex: event.candidate.sdpMLineIndex,
                usernameFragment: event.candidate.usernameFragment,
              };

          socket.emit("signal:send", {
            targetId: peerId,
            payload: { type: "candidate", candidate: candidateJson },
          });
        }
      };

      pc.ondatachannel = (event) => {
        configureChannel(peerId, displayName, event.channel);
      };

      return record;
    },
    [socket, configureChannel, triggerRetry]
  );

  setupPeerConnectionRef.current = setupPeerConnection;

  // Broadcast catalog changes dynamically to all open peers
  useEffect(() => {
    if (!socket || !selfPeer) {
      return;
    }

    const catalogMsg = JSON.stringify({
      type: "catalog-share",
      files: Array.from(sharedFiles.values()).map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        mimeType: f.mimeType,
      })),
    });

    for (const [peerId, record] of connectionsRef.current.entries()) {
      if (record.channel && record.channel.readyState === "open") {
        try {
          record.channel.send(catalogMsg);
        } catch {}
      }
    }
  }, [sharedFiles, selfPeer, socket]);

  // Auto-connect and negotiate WebRTC for all available LAN peers
  useEffect(() => {
    if (!socket || !selfPeer) {
      // Clean up all active connections if signaling drops offline
      for (const [peerId, record] of connectionsRef.current.entries()) {
        clearTimeout(record._connectTimer);
        record.channel?.close();
        record.pc.close();
        onPeerDisconnect?.(peerId);
      }
      connectionsRef.current.clear();
      setChannelStates({});
      setNetworkFiles(new Map());
      retryCountsRef.current.clear();
      retryingRef.current.clear();
      return;
    }

    const currentPeerIds = new Set(availablePeers.map((p) => p.id));

    // 1. Cleanup old connections that are no longer online
    for (const [peerId, record] of connectionsRef.current.entries()) {
      if (!currentPeerIds.has(peerId)) {
        clearTimeout(record._connectTimer);
        record.channel?.close();
        record.pc.close();
        connectionsRef.current.delete(peerId);
        removePeerFiles(peerId);
        retryCountsRef.current.delete(peerId);
        setChannelStates((prev) => {
          const next = { ...prev };
          delete next[peerId];
          return next;
        });
        onPeerDisconnect?.(peerId);
      }
    }

    // 2. Setup connections for newly discovered peers
    availablePeers.forEach((peer) => {
      if (connectionsRef.current.has(peer.id)) {
        return;
      }

      // Deterministic initiator role assignment based on lexicographical ID sorting to avoid glare/collisions
      const isInitiator = selfPeer.id < peer.id;
      const record = setupPeerConnection(peer.id, peer.displayName, isInitiator);

      if (isInitiator) {
        negotiateInitiator(record, peer.id, peer.displayName);
      }
    });
  }, [
    socket,
    selfPeer,
    availablePeers,
    setupPeerConnection,
    negotiateInitiator,
    removePeerFiles,
  ]);

  // Handle incoming signaling messages
  useEffect(() => {
    if (!socket || !selfPeer) {
      return;
    }

    const handleSignal = async ({ from, payload, senderIp }) => {
      let record = connectionsRef.current.get(from);
      if (!record) {
        const peerInfo = availablePeers.find((p) => p.id === from);
        const displayName = peerInfo?.displayName || "LAN device";
        record = setupPeerConnection(from, displayName, false);
      }

      // Skip signaling for relay connections (no real RTCPeerConnection)
      if (record.isRelay) return;

      const pc = record.pc;

      // Rewrite .local hostnames in SDP and candidates if senderIp is available
      if (senderIp && senderIp !== "127.0.0.1" && senderIp !== "::1") {
        const localHostnameRegex = /[a-zA-Z0-9-]+\.local/g;

        if (payload.description?.sdp) {
          const originalSdp = payload.description.sdp;
          payload.description.sdp = originalSdp.replace(localHostnameRegex, senderIp);
        }

        if (payload.candidate?.candidate) {
          const originalCand = payload.candidate.candidate;
          payload.candidate.candidate = originalCand.replace(localHostnameRegex, senderIp);
        }
      }

      try {
        if (payload.type === "offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.description));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          socket.emit("signal:send", {
            targetId: from,
            payload: { type: "answer", description: pc.localDescription },
          });

          // Flush pending candidates
          const candidates = record.pendingCandidates.splice(0);
          for (const candidate of candidates) {
            try {
              await pc.addIceCandidate(candidate);
            } catch {}
          }
        } else if (payload.type === "answer") {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.description));

          // Flush pending candidates
          const candidates = record.pendingCandidates.splice(0);
          for (const candidate of candidates) {
            try {
              await pc.addIceCandidate(candidate);
            } catch {}
          }
        } else if (payload.type === "candidate") {
          const candidate = new RTCIceCandidate(payload.candidate);
          if (pc.remoteDescription) {
            await pc.addIceCandidate(candidate);
          } else {
            record.pendingCandidates.push(candidate);
          }
        }
      } catch (err) {
        onEvent?.(`Signaling error with peer ${record.displayName}: ${err.message}`);
      }
    };

    socket.on("signal:receive", handleSignal);
    return () => {
      socket.off("signal:receive", handleSignal);
    };
  }, [socket, selfPeer, availablePeers, setupPeerConnection, onEvent]);

  // Handle incoming relay requests from peers whose WebRTC also failed
  useEffect(() => {
    if (!socket || !selfPeer) return;

    const handleRelayOpen = ({ from }) => {
      // Skip if we already have a working connection to this peer
      const existing = connectionsRef.current.get(from);
      if (existing?.channel?.readyState === "open") return;

      const peerInfo = availablePeers.find((p) => p.id === from);
      const displayName = peerInfo?.displayName || "LAN device";

      onEvent?.(`Accepting relay connection from ${displayName}...`);
      socket.emit("relay:accept", { targetId: from });

      // Create relay channel if we don't have one yet
      if (!existing || existing.closed || !existing.isRelay) {
        const relay = new RelayChannel(socket, from);
        const relayRecord = {
          pc: { close() {}, connectionState: "connected", iceConnectionState: "connected" },
          channel: relay,
          pendingCandidates: [],
          isInitiator: false,
          displayName,
          isRelay: true,
        };
        connectionsRef.current.set(from, relayRecord);
        configureChannel(from, displayName, relay);
      }
    };

    socket.on("relay:open", handleRelayOpen);
    return () => {
      socket.off("relay:open", handleRelayOpen);
    };
  }, [socket, selfPeer, availablePeers, configureChannel, onEvent]);

  // Clean up all connections on unmount
  useEffect(() => {
    return () => {
      for (const record of connectionsRef.current.values()) {
        clearTimeout(record._connectTimer);
        record.channel?.close();
        record.pc.close();
      }
      connectionsRef.current.clear();
      setChannelStates({});
      setNetworkFiles(new Map());
      retryCountsRef.current.clear();
      retryingRef.current.clear();
    };
  }, []);

  const getOpenChannels = useCallback(() => {
    const open = [];
    for (const [peerId, record] of connectionsRef.current.entries()) {
      if (record.channel && record.channel.readyState === "open") {
        open.push({ peerId, record });
      }
    }
    return open;
  }, []);

  const requestFile = useCallback((fileId, ownerId) => {
    const record = connectionsRef.current.get(ownerId);
    if (!record || !record.channel || record.channel.readyState !== "open") {
      throw new Error("Target device is not connected.");
    }
    record.channel.send(
      JSON.stringify({
        type: "file-request",
        id: fileId,
      })
    );
  }, []);

  return {
    channelStates,
    getOpenChannels,
    networkFiles,
    requestFile,
  };
}
