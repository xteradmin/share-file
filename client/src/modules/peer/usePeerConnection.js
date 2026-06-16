import { useCallback, useEffect, useRef, useState } from "react";
import { DATA_CHANNEL_LABEL, peerConnectionConfig } from "./peerConfig.js";

export function usePeerConnection({
  socket,
  remotePeerId,
  isInitiator,
  onDataMessage,
  onEvent,
}) {
  const pcRef = useRef(null);
  const channelRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const [channel, setChannel] = useState(null);
  const [channelState, setChannelState] = useState("closed");
  const [connectionState, setConnectionState] = useState("new");
  const [iceConnectionState, setIceConnectionState] = useState("new");

  const cleanup = useCallback(() => {
    channelRef.current?.close();
    pcRef.current?.close();
    channelRef.current = null;
    pcRef.current = null;
    pendingCandidatesRef.current = [];
    setChannel(null);
    setChannelState("closed");
    setConnectionState("new");
    setIceConnectionState("new");
  }, []);

  const sendSignal = useCallback(
    (payload) => {
      if (!socket || !remotePeerId) {
        return;
      }

      socket.emit("signal:send", {
        targetId: remotePeerId,
        payload,
      });
    },
    [remotePeerId, socket],
  );

  useEffect(() => {
    if (!socket || !remotePeerId) {
      cleanup();
      return undefined;
    }

    const pc = new RTCPeerConnection(peerConnectionConfig);
    pcRef.current = pc;
    setConnectionState(pc.connectionState);
    setIceConnectionState(pc.iceConnectionState);

    const configureChannel = (nextChannel) => {
      channelRef.current = nextChannel;
      nextChannel.binaryType = "arraybuffer";
      nextChannel.bufferedAmountLowThreshold = 4 * 1024 * 1024;
      setChannel(nextChannel);
      setChannelState(nextChannel.readyState);

      nextChannel.onopen = () => {
        setChannelState(nextChannel.readyState);
        onEvent?.("Data channel opened.");
      };
      nextChannel.onclose = () => {
        setChannelState(nextChannel.readyState);
        onEvent?.("Data channel closed.");
      };
      nextChannel.onerror = () => onEvent?.("Data channel error.");
      nextChannel.onmessage = (event) => onDataMessage?.(event.data, nextChannel);
    };

    pc.ondatachannel = (event) => configureChannel(event.channel);
    pc.onconnectionstatechange = () => setConnectionState(pc.connectionState);
    pc.oniceconnectionstatechange = () => setIceConnectionState(pc.iceConnectionState);
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({ type: "candidate", candidate: event.candidate });
      }
    };

    const flushPendingCandidates = async () => {
      const candidates = pendingCandidatesRef.current.splice(0);
      for (const candidate of candidates) {
        await pc.addIceCandidate(candidate);
      }
    };

    const handleSignal = async ({ from, payload }) => {
      if (from !== remotePeerId || !payload) {
        return;
      }

      try {
        if (payload.type === "offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.description));
          await flushPendingCandidates();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({ type: "answer", description: pc.localDescription });
          onEvent?.("Answered peer offer.");
          return;
        }

        if (payload.type === "answer") {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.description));
          await flushPendingCandidates();
          onEvent?.("Peer answer received.");
          return;
        }

        if (payload.type === "candidate" && payload.candidate) {
          const candidate = new RTCIceCandidate(payload.candidate);
          if (pc.remoteDescription) {
            await pc.addIceCandidate(candidate);
          } else {
            pendingCandidatesRef.current.push(candidate);
          }
        }
      } catch (error) {
        onEvent?.(`Peer negotiation failed: ${error.message}`);
      }
    };

    socket.on("signal:receive", handleSignal);

    const startOffer = async () => {
      try {
        const nextChannel = pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true });
        configureChannel(nextChannel);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal({ type: "offer", description: pc.localDescription });
        onEvent?.("Offer sent.");
      } catch (error) {
        onEvent?.(`Offer failed: ${error.message}`);
      }
    };

    if (isInitiator) {
      startOffer();
    }

    return () => {
      socket.off("signal:receive", handleSignal);
      pc.close();
      channelRef.current?.close();
      if (pcRef.current === pc) {
        pcRef.current = null;
      }
    };
  }, [cleanup, isInitiator, onDataMessage, onEvent, remotePeerId, sendSignal, socket]);

  return {
    channel,
    channelState,
    connectionState,
    iceConnectionState,
    resetPeer: cleanup,
  };
}
