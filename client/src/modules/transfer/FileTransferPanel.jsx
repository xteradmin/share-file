import { useEffect, useRef, useState } from "react";
import { Download, FileCheck, Send, Square, RotateCcw } from "lucide-react";
import {
  sendFile,
  createFileId,
  getPendingTransferStates,
  clearTransferState,
} from "./transferProtocol.js";

export function FileTransferPanel({
  getOpenChannels,
  channelStates,
  incoming,
  downloads,
  networkFiles,
  onRequestFile,
  onShareFile,
  onAcceptIncoming,
  onRejectIncoming,
  onClearDownload,
  onClearAllDownloads,
  availablePeers,
}) {
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [sending, setSending] = useState(null);
  const [error, setError] = useState("");
  const [acceptingIncoming, setAcceptingIncoming] = useState(false);
  const [pendingTransfers, setPendingTransfers] = useState([]);
  const [resumeId, setResumeId] = useState(null);

  const openChannels = getOpenChannels();
  const channelReady = openChannels.length > 0;

  // Derive a collective channel state for the status badge
  const hasConnecting = Object.values(channelStates).some((s) => s === "connecting");
  const channelState = channelReady ? "open" : hasConnecting ? "connecting" : "closed";

  // Load pending (interrupted) transfers from localStorage on mount.
  useEffect(() => {
    setPendingTransfers(getPendingTransferStates());
  }, []);

  // When the user picks a file and we were waiting for resume, start sending.
  useEffect(() => {
    if (selectedFiles.length > 0 && resumeId) {
      startSendWithFile(selectedFiles[0], resumeId);
      setResumeId(null);
    }
  }, [selectedFiles, resumeId]);

  const startSendWithFile = async (file, pendingId) => {
    if (!file) {
      return;
    }

    if (pendingId && createFileId(file) !== pendingId) {
      setError("Select the same file to resume this transfer.");
      setSelectedFiles([]);
      setPendingTransfers(getPendingTransferStates());
      return;
    }

    const currentOpenChannels = getOpenChannels();
    if (currentOpenChannels.length === 0) {
      setError("No connected devices.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    setSending({
      name: file.name,
      sentBytes: 0,
      totalBytes: file.size,
      speedBytesPerSecond: 0,
    });

    try {
      const progresses = {};
      const speeds = {};

      const sendPromises = currentOpenChannels.map(({ peerId, record }) => {
        return sendFile({
          channel: record.channel,
          file,
          signal: controller.signal,
          onProgress: (progress) => {
            progresses[peerId] = progress.sentBytes;
            speeds[peerId] = progress.speedBytesPerSecond;

            const activeIds = currentOpenChannels.map((c) => c.peerId);
            const sumSent = activeIds.reduce((sum, id) => sum + (progresses[id] || 0), 0);
            const sumSpeed = activeIds.reduce((sum, id) => sum + (speeds[id] || 0), 0);
            const avgSent = Math.min(file.size, Math.round(sumSent / activeIds.length));

            setSending({
              name: file.name,
              sentBytes: avgSent,
              totalBytes: file.size,
              speedBytesPerSecond: sumSpeed,
            });
          },
        });
      });

      const results = await Promise.all(sendPromises.map((p) => p.catch((err) => err)));
      const failures = results.filter((r) => r instanceof Error && r.message !== "Transfer cancelled.");
      if (failures.length > 0) {
        setError(`Transfer failed for some devices: ${failures.map((f) => f.message).join(", ")}`);
      }

      setSelectedFiles([]);
      setPendingTransfers(getPendingTransferStates());
    } catch (sendError) {
      if (sendError.message !== "Transfer cancelled.") {
        setError(sendError.message);
      }
      setPendingTransfers(getPendingTransferStates());
    } finally {
      abortRef.current = null;
      window.setTimeout(() => setSending(null), 900);
    }
  };

  const startSend = async () => {
    if (selectedFiles.length === 0) {
      return;
    }

    setError("");
    const files = [...selectedFiles];
    setSelectedFiles([]);

    const currentOpenChannels = getOpenChannels();
    if (currentOpenChannels.length === 0) {
      setError("No connected devices to send files to.");
      return;
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const controller = new AbortController();
      abortRef.current = controller;

      const progressName = files.length > 1 ? `[${i + 1}/${files.length}] ${file.name}` : file.name;

      setSending({
        name: progressName,
        sentBytes: 0,
        totalBytes: file.size,
        speedBytesPerSecond: 0,
      });

      try {
        const progresses = {};
        const speeds = {};

        const sendPromises = currentOpenChannels.map(({ peerId, record }) => {
          return sendFile({
            channel: record.channel,
            file,
            signal: controller.signal,
            queueIndex: i,
            queueSize: files.length,
            onProgress: (progress) => {
              progresses[peerId] = progress.sentBytes;
              speeds[peerId] = progress.speedBytesPerSecond;

              const activeIds = currentOpenChannels.map((c) => c.peerId);
              const sumSent = activeIds.reduce((sum, id) => sum + (progresses[id] || 0), 0);
              const sumSpeed = activeIds.reduce((sum, id) => sum + (speeds[id] || 0), 0);
              const avgSent = Math.min(file.size, Math.round(sumSent / activeIds.length));

              setSending({
                name: progressName,
                sentBytes: avgSent,
                totalBytes: file.size,
                speedBytesPerSecond: sumSpeed,
              });
            },
          });
        });

        const results = await Promise.all(sendPromises.map((p) => p.catch((err) => err)));
        const failures = results.filter((r) => r instanceof Error && r.message !== "Transfer cancelled.");
        if (failures.length > 0) {
          setError(`Transfer failed for some devices: ${failures.map((f) => f.message).join(", ")}`);
          break;
        }
      } catch (sendError) {
        if (sendError.message !== "Transfer cancelled.") {
          setError(sendError.message);
        }
        break;
      } finally {
        abortRef.current = null;
      }
    }

    setPendingTransfers(getPendingTransferStates());
    window.setTimeout(() => setSending(null), 900);
  };

  const cancelSend = () => {
    abortRef.current?.abort();
  };

  const handleResumeClick = (pt) => {
    setResumeId(pt.id);
    // Trigger the hidden file input.
    fileInputRef.current?.click();
  };

  const handleFileChange = (event) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length === 0) {
      // User cancelled the file picker — clear resume state.
      setResumeId(null);
      return;
    }
    setSelectedFiles(files);
    // Register files into sharing catalog immediately so others can discover them
    files.forEach((f) => onShareFile?.(f));
    // Reset so the same file can be picked again.
    event.target.value = "";
  };

  const dismissPending = (id) => {
    clearTransferState(id);
    setPendingTransfers(getPendingTransferStates());
  };

  const acceptIncoming = async (autoAccept = false) => {
    setAcceptingIncoming(true);
    setError("");

    try {
      await onAcceptIncoming?.(autoAccept);
    } catch (acceptError) {
      if (acceptError.name !== "AbortError") {
        setError(acceptError.message || "Could not accept incoming transfer.");
      }
    } finally {
      setAcceptingIncoming(false);
    }
  };

  const rejectIncoming = () => {
    onRejectIncoming?.();
  };

  const downloadAll = () => {
    downloads.forEach((download) => {
      if (download.url) {
        const a = document.createElement("a");
        a.href = download.url;
        a.download = download.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    });
  };

  return (
    <section className="panel" aria-label="File transfer">
      <div className="panel-header">
        <div className="panel-title">
          <Send size={19} aria-hidden="true" />
          <h2>Transfer</h2>
        </div>
        <span className={`status-pill ${channelReady ? "ready" : "warning"}`}>
          <span className="status-dot" />
          {channelState}
        </span>
      </div>

      {/* Inline List of LAN Devices & Connection States */}
      {availablePeers && availablePeers.length > 0 && (
        <div className="devices-list-inline">
          {availablePeers.map((p) => {
            const state = channelStates[p.id] || "closed";
            return (
              <span key={p.id} className={`device-badge ${state}`} title={`Connection State: ${state}`}>
                <span className="device-badge-dot" />
                {p.displayName}
              </span>
            );
          })}
        </div>
      )}

      {/* Pending (interrupted) transfers */}
      {pendingTransfers.length > 0 && !sending ? (
        <div className="pending-stack">
          {pendingTransfers.map((pt) => (
            <div className="pending-card" key={pt.id}>
              <div className="download-row">
                <strong>{pt.name}</strong>
                <span>{formatBytes(pt.lastSentOffset)} / {formatBytes(pt.size)}</span>
              </div>
              <p className="pending-hint">Select the same file to resume from where it stopped.</p>
              <div className="button-row">
                <button
                  className="button"
                  type="button"
                  disabled={!channelReady}
                  onClick={() => handleResumeClick(pt)}
                >
                  <RotateCcw size={17} aria-hidden="true" />
                  Resume
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => dismissPending(pt.id)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="file-picker">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          disabled={!channelReady || Boolean(sending)}
          onChange={handleFileChange}
        />
        <div className="button-row">
          <button
            className="button"
            type="button"
            disabled={!channelReady || selectedFiles.length === 0 || Boolean(sending)}
            onClick={startSend}
          >
            <Send size={17} aria-hidden="true" />
            Send
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={!sending}
            onClick={cancelSend}
          >
            <Square size={16} aria-hidden="true" />
            Cancel
          </button>
        </div>

        {selectedFiles.length > 0 && !sending && (
          <div className="selected-files-list">
            <div className="selected-files-header">
              <h3>Files to send ({selectedFiles.length})</h3>
              <button
                type="button"
                className="button-link"
                onClick={() => setSelectedFiles([])}
              >
                Clear all
              </button>
            </div>
            <ul>
              {selectedFiles.map((file, idx) => (
                <li key={idx} className="selected-file-item">
                  <span className="file-name">{file.name}</span>
                  <span className="file-size">{formatBytes(file.size)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {sending ? (
        <TransferProgress
          label={sending.name}
          bytes={sending.sentBytes}
          total={sending.totalBytes}
          speed={sending.speedBytesPerSecond}
        />
      ) : null}

      {incoming?.status === "waiting" ? (
        <div className="modal-overlay">
          <IncomingRequest
            incoming={incoming}
            accepting={acceptingIncoming}
            onAccept={acceptIncoming}
            onReject={rejectIncoming}
          />
        </div>
      ) : null}

      {incoming && incoming.status !== "waiting" ? (
        <TransferProgress
          label={incoming.meta.name}
          bytes={incoming.receivedBytes}
          total={incoming.meta.size}
          speed={0}
          status={incoming.status}
          incoming
        />
      ) : null}

      {incoming?.error ? <p className="error">{incoming.error}</p> : null}

      {/* Decentralized LAN Shared Files Catalog */}
      {networkFiles && networkFiles.size > 0 && (
        <div className="network-files-stack">
          <div className="download-stack-header">
            <h3>Files Available on LAN</h3>
          </div>
          {Array.from(networkFiles.values()).map((file) => (
            <div className="network-file-card" key={file.id}>
              <div className="download-row">
                <div className="network-file-info">
                  <strong>{file.name}</strong>
                  <span className="network-file-owner">
                    {formatBytes(file.size)} • shared by {file.ownerName}
                  </span>
                </div>
                <button
                  className="button"
                  type="button"
                  onClick={() => onRequestFile?.(file.id, file.ownerId, file)}
                >
                  <Download size={17} aria-hidden="true" />
                  Download
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {downloads.length > 0 ? (
        <div className="download-stack">
          <div className="download-stack-header">
            <h3>Completed Downloads</h3>
            <div className="button-row">
              {downloads.some((d) => d.url) && (
                <button
                  className="button secondary"
                  type="button"
                  onClick={downloadAll}
                >
                  <Download size={17} aria-hidden="true" />
                  Download All
                </button>
              )}
              <button
                className="button secondary"
                type="button"
                onClick={onClearAllDownloads}
              >
                Clear All
              </button>
            </div>
          </div>
          {downloads.map((download) => (
            <div className="download-card" key={download.id}>
              <div className="download-row">
                <strong>{download.name}</strong>
                <span>{formatBytes(download.size)}</span>
              </div>
              <div className="button-row">
                {download.url ? (
                  <a className="button" href={download.url} download={download.name}>
                    <Download size={17} aria-hidden="true" />
                    Download
                  </a>
                ) : (
                  <span className="download-saved">
                    <FileCheck size={17} aria-hidden="true" />
                    Saved
                  </span>
                )}
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => onClearDownload(download.id)}
                >
                  <FileCheck size={17} aria-hidden="true" />
                  Clear
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

function IncomingRequest({ incoming, accepting, onAccept, onReject }) {
  const hasMultiple = incoming.meta.queueSize > 1;
  const isDisk = incoming.storageMode === "disk";
  const showMemoryWarning = !isDisk && incoming.meta.size > 150 * 1024 * 1024;

  return (
    <div className="transfer-card">
      {showMemoryWarning && (
        <div className="memory-warning-banner" role="alert">
          <strong>Memory Warning:</strong> This browser does not support saving files directly to disk. 
          Downloading this large file ({formatBytes(incoming.meta.size)}) in memory may exhaust system memory and crash the browser tab. 
          For large files, please use a browser that supports File System Access (e.g. Chrome, Edge, Opera).
        </div>
      )}
      <div className="transfer-row">
        <strong>
          {hasMultiple ? `[${(incoming.meta.queueIndex || 0) + 1}/${incoming.meta.queueSize}] ` : ""}
          {incoming.meta.name}
        </strong>
        <span>{formatBytes(incoming.meta.size)}</span>
      </div>
      <div className="button-row">
        <button
          className="button"
          type="button"
          disabled={accepting}
          onClick={() => onAccept(false)}
        >
          <Download size={17} aria-hidden="true" />
          {isDisk ? "Save" : "Accept"}
        </button>
        {hasMultiple && (
          <button
            className="button"
            type="button"
            disabled={accepting}
            onClick={() => onAccept(true)}
          >
            <Download size={17} aria-hidden="true" />
            {isDisk ? "Save All" : "Accept All"}
          </button>
        )}
        <button
          className="button secondary"
          type="button"
          disabled={accepting}
          onClick={onReject}
        >
          <Square size={16} aria-hidden="true" />
          Reject
        </button>
      </div>
    </div>
  );
}

function TransferProgress({ label, bytes, total, speed, status, incoming = false }) {
  const percent = total ? Math.min(100, Math.round((bytes / total) * 100)) : 0;
  const statusText = incoming
    ? incomingStatusText(status)
    : `${formatBytes(speed)}/s`;

  return (
    <div className="transfer-card">
      <div className="transfer-row">
        <strong>{label}</strong>
        <span>{statusText}</span>
      </div>
      <div className="progress-shell" aria-label={`${percent}% complete`}>
        <div className="progress-bar" style={{ "--progress": `${percent}%` }} />
      </div>
      <div className="transfer-row">
        <span>{formatBytes(bytes)}</span>
        <span>{formatBytes(total)}</span>
      </div>
    </div>
  );
}

function incomingStatusText(status) {
  if (status === "finalizing") {
    return "Saving";
  }
  if (status === "failed") {
    return "Failed";
  }
  return "Receiving";
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** index;
  return `${amount.toFixed(amount >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}
