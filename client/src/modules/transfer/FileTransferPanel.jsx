import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileCheck, Send, Square, RotateCcw, Keyboard } from "lucide-react";
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
  const dropZoneRef = useRef(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [sending, setSending] = useState(null);
  const [error, setError] = useState("");
  const [acceptingIncoming, setAcceptingIncoming] = useState(false);
  const [pendingTransfers, setPendingTransfers] = useState([]);
  const [resumeId, setResumeId] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const openChannels = getOpenChannels();
  const channelReady = openChannels.length > 0;

  const onShareFileRef = useRef(onShareFile);
  onShareFileRef.current = onShareFile;
  const channelReadyRef = useRef(channelReady);
  channelReadyRef.current = channelReady;
  const sendingRef = useRef(sending);
  sendingRef.current = sending;

  // Derive a collective channel state for the status badge
  const hasConnecting = Object.values(channelStates).some((s) => s === "connecting");
  const channelState = channelReady ? "open" : hasConnecting ? "connecting" : "closed";

  // Load pending (interrupted) transfers from localStorage on mount.
  useEffect(() => {
    setPendingTransfers(getPendingTransferStates());
  }, []);

  const startSendWithFile = useCallback(async (file, pendingId) => {
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
  }, [getOpenChannels]);

  // When the user picks a file and we were waiting for resume, start sending.
  useEffect(() => {
    if (selectedFiles.length > 0 && resumeId) {
      startSendWithFile(selectedFiles[0], resumeId);
      setResumeId(null);
    }
  }, [selectedFiles, resumeId, startSendWithFile]);

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

  // Shared logic for adding files from any source (picker, drag-drop, paste)
  // Uses refs so the callback is stable — avoids re-registering drop/paste handlers on every peer change.
  const addFiles = useCallback(
    (files) => {
      if (files.length === 0) return;
      files.forEach((f) => onShareFileRef.current?.(f));
      if (channelReadyRef.current) {
        setSelectedFiles((prev) => [...prev, ...files]);
      }
    },
    [],
  );

  const handleFileChange = (event) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length === 0) {
      setResumeId(null);
      return;
    }
    addFiles(files);
    event.target.value = "";
  };

  // ── Drag and drop ──────────────────────────────────────────────
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer?.types?.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);

      if (sendingRef.current) return;
      const dropped = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
      // Filter out directories (they appear with empty type and zero size)
      const files = dropped.filter((f) => f.size > 0 || f.type !== "");
      addFiles(files);
    },
    [addFiles],
  );

  // Reset drag state if the user drags outside the browser window (dragend fires on the source element)
  useEffect(() => {
    const handleDragEnd = () => {
      dragCounterRef.current = 0;
      setIsDragging(false);
    };
    document.addEventListener("dragend", handleDragEnd);
    return () => document.removeEventListener("dragend", handleDragEnd);
  }, []);

  // ── Clipboard paste (Ctrl+V / Cmd+V) ───────────────────────────
  useEffect(() => {
    const handlePaste = (e) => {
      if (sendingRef.current) return;
      // Ignore if user is typing in an input/textarea
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      const files = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            // Pasted images often have no name; give them a default
            if (!file.name || file.name === "image.png" || file.name === "image.jpg") {
              const ext = file.type.split("/")[1] || "png";
              const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
              const named = new File([file], `pasted-${timestamp}.${ext}`, { type: file.type });
              files.push(named);
            } else {
              files.push(file);
            }
          }
        }
      }

      if (files.length > 0) {
        e.preventDefault();
        addFiles(files);
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [addFiles]);

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

      <div
        ref={dropZoneRef}
        className={`drop-zone${isDragging ? " drag-active" : ""}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {!isDragging && (
          <>
            <div className="shortcut-badges">
              <span className="shortcut-badge">
                <Download size={13} aria-hidden="true" />
                Drag & drop files here
              </span>
              <span className="shortcut-badge">
                <Keyboard size={13} aria-hidden="true" />
                <kbd>{(navigator.userAgent?.includes("Mac") || navigator.platform?.includes("Mac")) ? "\u2318" : "Ctrl"}</kbd>+<kbd>V</kbd> Paste
              </span>
            </div>

            {!channelReady && (
              <p className="file-picker-hint">
                Files will be shared once other devices connect to the same network.
              </p>
            )}
            {channelReady && (
              <p className="file-picker-hint">
                Files added here will be sent instantly to connected devices.
              </p>
            )}
          </>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        disabled={Boolean(sending)}
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

      {/* Full-screen drop overlay — rendered here so it covers the viewport */}
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-icon">
            <Download size={36} aria-hidden="true" />
          </div>
          <span className="drop-overlay-text">Drop files to share</span>
          <span className="drop-overlay-hint">Release to add files to your sharing catalog</span>
        </div>
      )}
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
