import { useCallback, useEffect, useState } from "react";
import { FileUp, Link2, PlugZap, AlertCircle } from "lucide-react";
import { PairingCard } from "./modules/pairing/PairingCard.jsx";
import { usePeerConnection } from "./modules/peer/usePeerConnection.js";
import { useSignalingSocket } from "./modules/signaling/useSignalingSocket.js";
import { ConnectionStatus } from "./modules/status/ConnectionStatus.jsx";
import { FileTransferPanel } from "./modules/transfer/FileTransferPanel.jsx";
import { useIncomingTransfers } from "./modules/transfer/useIncomingTransfers.js";

let eventCounter = 0;

function generateId() {
  return `${Date.now()}-${++eventCounter}-${Math.floor(Math.random() * 100000)}`;
}

export function App() {
  const { socket, connected: signalingConnected, connectionError } = useSignalingSocket();
  const [deviceName] = useState(() => getOrCreateDeviceName());
  const [selfPeer, setSelfPeer] = useState(null);
  const [availablePeers, setAvailablePeers] = useState([]);
  const [remotePeer, setRemotePeer] = useState(null);
  const [isInitiator, setIsInitiator] = useState(false);
  const [peerError, setPeerError] = useState("");
  const [connectingPeerId, setConnectingPeerId] = useState("");
  const [pendingAcceptPeer, setPendingAcceptPeer] = useState(null);
  const [events, setEvents] = useState([]);
  const {
    incoming,
    downloads,
    handleDataMessage,
    acceptIncoming,
    rejectIncoming,
    clearDownload,
  } = useIncomingTransfers();
  const remotePeerId = remotePeer?.id || "";

  const addEvent = useCallback((message) => {
    setEvents((current) => [
      { id: generateId(), message, at: new Date().toLocaleTimeString() },
      ...current.slice(0, 5),
    ]);
  }, []);

  const {
    channel,
    channelState,
    connectionState,
    iceConnectionState,
    resetPeer,
  } = usePeerConnection({
    socket,
    remotePeerId,
    isInitiator,
    onDataMessage: handleDataMessage,
    onEvent: addEvent,
  });

  useEffect(() => {
    if (!socket || !signalingConnected) {
      return undefined;
    }

    socket.emit("peer:announce", { displayName: deviceName }, (response) => {
      if (!response?.ok) {
        setPeerError(response?.error || "Could not join LAN user list.");
        return;
      }

      setSelfPeer(response.peer);
    });
  }, [deviceName, signalingConnected, socket]);

  useEffect(() => {
    if (!socket) {
      return undefined;
    }

    const handlePeerList = ({ self, peers = [] }) => {
      setSelfPeer(self || null);
      setAvailablePeers(peers);
    };

    const handleConnectRequest = ({ peer }) => {
      if (!peer?.id) return;
      setPeerError("");
      setConnectingPeerId("");
      setRemotePeer(peer);
      setIsInitiator(false);
      setPendingAcceptPeer(peer);
      addEvent(`${peer.displayName} connected.`);
    };

    const handleConnectAccepted = ({ peer }) => {
      if (!peer?.id) return;
      setPeerError("");
      setConnectingPeerId("");
      setPendingAcceptPeer(null);
      setRemotePeer(peer);
      setIsInitiator(true);
      addEvent(`Connected to ${peer.displayName}.`);
    };

    const handlePeerDisconnect = ({ peerId } = {}) => {
      if (peerId && remotePeerId && peerId !== remotePeerId) {
        return;
      }

      resetPeer();
      setRemotePeer(null);
      setIsInitiator(false);
      setPendingAcceptPeer(null);
      setConnectingPeerId("");
      addEvent("Peer disconnected.");
    };

    socket.on("peer:list", handlePeerList);
    socket.on("peer:connect-request", handleConnectRequest);
    socket.on("peer:connect-accepted", handleConnectAccepted);
    socket.on("peer:disconnect", handlePeerDisconnect);

    return () => {
      socket.off("peer:list", handlePeerList);
      socket.off("peer:connect-request", handleConnectRequest);
      socket.off("peer:connect-accepted", handleConnectAccepted);
      socket.off("peer:disconnect", handlePeerDisconnect);
    };
  }, [addEvent, remotePeerId, resetPeer, socket]);

  useEffect(() => {
    if (!socket || !pendingAcceptPeer || remotePeerId !== pendingAcceptPeer.id || isInitiator) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      socket.emit("peer:accept", { targetId: pendingAcceptPeer.id }, (response) => {
        if (!response?.ok) {
          setPeerError(response?.error || "Could not accept connection.");
          resetPeer();
          setRemotePeer(null);
          setPendingAcceptPeer(null);
          return;
        }

        setPendingAcceptPeer(null);
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [isInitiator, pendingAcceptPeer, remotePeerId, resetPeer, socket]);

  const connectPeer = useCallback((peer) => {
    if (!socket || !peer?.id) {
      return;
    }

    if (remotePeerId && remotePeerId !== peer.id) {
      resetPeer();
      setRemotePeer(null);
      setIsInitiator(false);
    }

    setPeerError("");
    setConnectingPeerId(peer.id);
    socket.emit("peer:connect", { targetId: peer.id }, (response) => {
      if (!response?.ok) {
        setConnectingPeerId("");
        setPeerError(response?.error || "Could not connect to user.");
        return;
      }

      addEvent(`Connecting to ${peer.displayName}.`);
    });
  }, [addEvent, remotePeerId, resetPeer, socket]);

  const disconnectPeer = useCallback(() => {
    socket?.emit("peer:disconnect");
    resetPeer();
    setRemotePeer(null);
    setIsInitiator(false);
    setPendingAcceptPeer(null);
    setConnectingPeerId("");
    addEvent("Peer disconnected.");
  }, [addEvent, resetPeer, socket]);

  return (
    <main className="shell">
      <section className="workspace" aria-label="Share File workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Share File</p>
            <h1>Local browser transfer</h1>
          </div>
          <ConnectionStatus
            signalingConnected={signalingConnected}
            connectionState={connectionState}
            iceConnectionState={iceConnectionState}
            channelState={channelState}
          />
        </header>

        {connectionError && (
          <div className="connection-error-banner" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>Signaling connection error: {connectionError}</span>
            <small>Check that the server is running and accessible from this device.</small>
          </div>
        )}

        <div className="grid">
          <PairingCard
            selfPeer={selfPeer}
            deviceName={deviceName}
            peers={availablePeers}
            connectedPeer={remotePeer}
            connectingPeerId={connectingPeerId}
            error={peerError}
            disabled={!signalingConnected}
            onConnectPeer={connectPeer}
            onDisconnectPeer={disconnectPeer}
          />

          <FileTransferPanel
            channel={channel}
            channelState={channelState}
            incoming={incoming}
            downloads={downloads}
            onAcceptIncoming={acceptIncoming}
            onRejectIncoming={rejectIncoming}
            onClearDownload={clearDownload}
          />
        </div>

        <section className="activity" aria-label="Connection activity">
          <div className="activity-header">
            <h2>Activity</h2>
            <span>{events.length} recent</span>
          </div>
          {events.length === 0 ? (
            <div className="empty-state">
              <PlugZap size={18} aria-hidden="true" />
              <span>No events yet.</span>
            </div>
          ) : (
            <ul>
              {events.map((event) => (
                <li key={event.id}>
                  <span>{event.message}</span>
                  <time>{event.at}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>

      <aside className="rail" aria-label="Runtime details">
        <div className="metric">
          <Link2 size={18} aria-hidden="true" />
          <span>Device</span>
          <strong>{selfPeer?.displayName || deviceName}</strong>
        </div>
        <div className="metric">
          <FileUp size={18} aria-hidden="true" />
          <span>Peer</span>
          <strong>{remotePeer?.displayName || "None"}</strong>
        </div>
      </aside>
    </main>
  );
}

const DEVICE_NAME_KEY = "sharefile:device-name";

function getOrCreateDeviceName() {
  try {
    const existing = localStorage.getItem(DEVICE_NAME_KEY);
    if (existing) {
      return existing;
    }

    const next = createDeviceName();
    localStorage.setItem(DEVICE_NAME_KEY, next);
    return next;
  } catch {
    return createDeviceName();
  }
}

function createDeviceName() {
  const number = Math.floor(1000 + Math.random() * 9000);
  return `Device ${number}`;
}
