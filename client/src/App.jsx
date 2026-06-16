import { useCallback, useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { usePeerConnections } from "./modules/peer/usePeerConnections.js";
import { useSignalingSocket } from "./modules/signaling/useSignalingSocket.js";
import { ConnectionStatus } from "./modules/status/ConnectionStatus.jsx";
import { FileTransferPanel } from "./modules/transfer/FileTransferPanel.jsx";
import { useIncomingTransfers } from "./modules/transfer/useIncomingTransfers.js";

export function App() {
  const { socket, connected: signalingConnected, connectionError } = useSignalingSocket();
  const [deviceName] = useState(() => getOrCreateDeviceName());
  const [selfPeer, setSelfPeer] = useState(null);
  const [availablePeers, setAvailablePeers] = useState([]);
  const [peerError, setPeerError] = useState("");
  const [sharedFiles, setSharedFiles] = useState(new Map());

  const shareFile = useCallback((fileOrBlob, metadata = {}) => {
    const name = fileOrBlob.name || metadata.name || "file";
    const size = fileOrBlob.size;
    const mimeType = fileOrBlob.type || metadata.mimeType || "application/octet-stream";
    const lastModified = fileOrBlob.lastModified || metadata.lastModified || 0;

    const id = `${name}-${size}-${lastModified}`;
    setSharedFiles((prev) => {
      const next = new Map(prev);
      next.set(id, {
        id,
        name,
        size,
        mimeType,
        fileOrBlob,
      });
      return next;
    });
  }, []);

  const {
    incoming,
    downloads,
    handleDataMessage,
    preCreateSink,
    cancelPreCreatedSink,
    cancelTransfersForPeer,
    acceptIncoming,
    rejectIncoming,
    clearDownload,
    clearAllDownloads,
  } = useIncomingTransfers(shareFile);

  const handlePeerEvent = useCallback((message) => {
    if (/failed|error/i.test(message)) {
      if (/failed/i.test(message)) {
        setPeerError(
          "Connection failed. If you are using a mobile hotspot, direct peer-to-peer connections are often blocked by the mobile OS. Please connect both devices to the same Wi-Fi router."
        );
      } else {
        setPeerError(message);
      }
    }
  }, []);

  const handlePeerDisconnect = useCallback((peerId) => {
    cancelTransfersForPeer(peerId);
  }, [cancelTransfersForPeer]);

  const { channelStates, getOpenChannels, networkFiles, requestFile } = usePeerConnections({
    socket,
    selfPeer,
    availablePeers,
    sharedFiles,
    onDataMessage: handleDataMessage,
    onEvent: handlePeerEvent,
    onPeerDisconnect: handlePeerDisconnect,
  });

  const handleRequestFile = useCallback(
    async (fileId, ownerId, meta) => {
      setPeerError("");
      const ok = await preCreateSink(fileId, meta, ownerId);
      if (ok) {
        try {
          requestFile(fileId, ownerId);
        } catch (err) {
          setPeerError(err.message);
          cancelPreCreatedSink(fileId);
        }
      }
    },
    [preCreateSink, requestFile, cancelPreCreatedSink]
  );

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

    socket.on("peer:list", handlePeerList);

    return () => {
      socket.off("peer:list", handlePeerList);
    };
  }, [socket]);

  const activePeers = availablePeers.filter((p) => channelStates[p.id] === "open");
  const connectedCount = activePeers.length;
  const peerCount = availablePeers.length;

  return (
    <main className="shell">
      <section className="workspace" aria-label="Share File workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Share File</p>
            <h1>Local browser transfer</h1>
            <p className="active-devices-subtitle">
              {selfPeer ? `Logged in as ${selfPeer.displayName}` : `Registering as ${deviceName}...`}
              {connectedCount > 0
                ? ` • Connected to: ${activePeers.map((p) => p.displayName).join(", ")}`
                : peerCount > 0
                ? " • Connecting to devices..."
                : " • Waiting for other devices on the same Wi-Fi..."}
            </p>
          </div>
          <ConnectionStatus
            signalingConnected={signalingConnected}
            peerCount={peerCount}
            connectedCount={connectedCount}
          />
        </header>

        {connectionError && (
          <div className="connection-error-banner" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>Signaling connection error: {connectionError}</span>
            <small>Check that the server is running and accessible from this device.</small>
          </div>
        )}

        {peerError && (
          <div className="connection-error-banner" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>Network warning: {peerError}</span>
          </div>
        )}

        <div className="single-column-layout">
          <FileTransferPanel
            getOpenChannels={getOpenChannels}
            channelStates={channelStates}
            incoming={incoming}
            downloads={downloads}
            networkFiles={networkFiles}
            onRequestFile={handleRequestFile}
            onShareFile={shareFile}
            onAcceptIncoming={acceptIncoming}
            onRejectIncoming={rejectIncoming}
            onClearDownload={clearDownload}
            onClearAllDownloads={clearAllDownloads}
            availablePeers={availablePeers}
          />
        </div>
      </section>
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
