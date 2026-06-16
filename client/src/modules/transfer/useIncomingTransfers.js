import { useCallback, useRef, useState } from "react";

export function useIncomingTransfers(onShareFile) {
  const activeRef = useRef(null);
  const pendingRef = useRef(null);
  const partialTransfersRef = useRef(new Map());
  const preCreatedSinksRef = useRef(new Map());
  const [incoming, setIncoming] = useState(null);
  const [downloads, setDownloads] = useState([]);
  const lastUpdateRef = useRef(0);
  const autoAcceptRef = useRef(false);
  const directoryHandleRef = useRef(null);

  const failActiveTransfer = useCallback((active, message) => {
    autoAcceptRef.current = false;
    directoryHandleRef.current = null;
    if (!active || active.failed) {
      return;
    }

    active.failed = true;
    active.cleanupChannelEvents?.();
    active.sink.abort?.();
    partialTransfersRef.current.delete(active.id);

    if (active.channel?.readyState === "open") {
      active.channel.send(JSON.stringify({ type: "file-cancel", id: active.id }));
    }

    if (activeRef.current?.id === active.id) {
      activeRef.current = null;
    }

    setIncoming({
      meta: active.meta,
      receivedBytes: active.receivedBytes,
      status: "failed",
      storageMode: active.storageMode,
      error: message,
    });
  }, []);

  const finishActiveTransfer = useCallback(
    async (id) => {
      const active = activeRef.current;
      if (!active || active.id !== id) {
        return;
      }

      setIncoming(toIncomingState(active, "finalizing"));

      try {
        await active.writeChain;
        if (active.receivedBytes !== active.meta.size) {
          throw new Error("Transfer ended before all bytes were received.");
        }

        active.cleanupChannelEvents?.();
        const result = await active.sink.close();

        // Automatically trigger browser download for in-memory transfers
        if (result?.url) {
          const a = document.createElement("a");
          a.href = result.url;
          a.download = active.meta.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }

        setDownloads((current) => [
          {
            id: active.meta.id,
            name: active.meta.name,
            size: active.meta.size,
            url: result?.url || "",
            savedToDisk: Boolean(result?.savedToDisk),
            createdAt: Date.now(),
          },
          ...current,
        ]);

        if (result?.blob) {
          onShareFile?.(result.blob, {
            name: active.meta.name,
            mimeType: active.meta.mimeType,
            lastModified: active.meta.lastModified || 0,
          });
        }

        setIncoming(null);
        activeRef.current = null;
        partialTransfersRef.current.delete(active.id);

        if (active.meta.queueSize && (active.meta.queueIndex === active.meta.queueSize - 1)) {
          autoAcceptRef.current = false;
          directoryHandleRef.current = null;
        }
      } catch (error) {
        failActiveTransfer(active, error.message || "Could not save received file.");
      }
    },
    [failActiveTransfer, onShareFile],
  );

  const performAccept = useCallback(async (pending) => {
    if (!pending?.meta || !pending.channel || pending.channel.readyState !== "open") {
      return;
    }

    const existing = partialTransfersRef.current.get(pending.meta.id);
    let active;

    if (existing?.meta.size === pending.meta.size) {
      active = existing;
    } else {
      let sink;
      if (preCreatedSinksRef.current.has(pending.meta.id)) {
        const entry = preCreatedSinksRef.current.get(pending.meta.id);
        sink = entry.sink;
        preCreatedSinksRef.current.delete(pending.meta.id);
      } else if (directoryHandleRef.current) {
        sink = await createDirectorySink(directoryHandleRef.current, pending.meta);
      } else if (canStreamToDisk()) {
        sink = await createDiskSink(pending.meta);
      } else {
        sink = createMemorySink(pending.meta);
      }

      active = {
        id: pending.meta.id,
        meta: pending.meta,
        sink,
        storageMode: sink.storageMode,
        receivedBytes: 0,
        writeChain: Promise.resolve(),
        failed: false,
      };
    }

    // Clean up any existing listeners on the channel before assigning new ones
    active.cleanupChannelEvents?.();

    active.meta = pending.meta;
    active.channel = pending.channel;
    active.peerId = pending.peerId;
    active.failed = false;

    const handleChannelCloseOrError = () => {
      if (activeRef.current?.id === active.id) {
        failActiveTransfer(active, "Data channel closed unexpectedly.");
      }
    };
    active.channel.addEventListener("close", handleChannelCloseOrError);
    active.channel.addEventListener("error", handleChannelCloseOrError);

    active.cleanupChannelEvents = () => {
      try {
        active.channel.removeEventListener("close", handleChannelCloseOrError);
        active.channel.removeEventListener("error", handleChannelCloseOrError);
      } catch {}
    };

    activeRef.current = active;
    partialTransfersRef.current.set(active.id, active);
    pendingRef.current = null;
    lastUpdateRef.current = performance.now();
    setIncoming(toIncomingState(active, "receiving"));
    sendResumeOffset(active.channel, active.id, active.receivedBytes);
  }, [failActiveTransfer]);

  const handleDataMessage = useCallback(
    (data, channel, peerId) => {
      if (typeof data === "string") {
        const message = parseControlMessage(data);
        if (!message) {
          return;
        }

        if (message.type === "file-meta") {
          const existing = partialTransfersRef.current.get(message.id);
          const pending = { meta: message, channel, peerId };
          pendingRef.current = pending;

          if (existing?.meta.size === message.size) {
            existing.meta = message;
            existing.channel = channel;
            existing.peerId = peerId;
            activeRef.current = existing;
            setIncoming(toIncomingState(existing, "receiving"));
            sendResumeOffset(channel, message.id, existing.receivedBytes);
            return;
          }

          if (message.queueIndex === 0) {
            autoAcceptRef.current = false;
          }

          // Auto-accept if we have pre-created a sink for this requested file or are in Save All directory mode
          if (autoAcceptRef.current || preCreatedSinksRef.current.has(message.id)) {
            performAccept(pending);
            return;
          }

          setIncoming({
            meta: message,
            receivedBytes: 0,
            status: "waiting",
            storageMode: canStreamToDisk() ? "disk" : "memory",
          });
          return;
        }

        if (message.type === "file-done") {
          finishActiveTransfer(message.id);
          return;
        }

        if (message.type === "file-cancel") {
          const active = activeRef.current;
          if (active?.id === message.id) {
            active.sink.abort?.();
            activeRef.current = null;
          }

          partialTransfersRef.current.delete(message.id);
          if (pendingRef.current?.meta.id === message.id) {
            pendingRef.current = null;
          }
          if (preCreatedSinksRef.current.has(message.id)) {
            preCreatedSinksRef.current.get(message.id).abort?.();
            preCreatedSinksRef.current.delete(message.id);
          }
          setIncoming(null);
        }

        return;
      }

      const active = activeRef.current;
      if (!active || active.failed) {
        return;
      }

      const chunk = new Uint8Array(data);
      const position = active.receivedBytes;
      if (position + chunk.byteLength > active.meta.size) {
        failActiveTransfer(active, "Received more data than expected.");
        return;
      }

      active.receivedBytes += chunk.byteLength;
      active.writeChain = active.writeChain.then(() => active.sink.write(chunk, position));
      active.writeChain.catch(() => {
        failActiveTransfer(active, "Could not write received data.");
      });
      partialTransfersRef.current.set(active.id, active);

      const now = performance.now();
      if (now - lastUpdateRef.current >= 150 || active.receivedBytes >= active.meta.size) {
        lastUpdateRef.current = now;
        setIncoming(toIncomingState(active, "receiving"));
      }
    },
    [failActiveTransfer, finishActiveTransfer, performAccept],
  );

  const preCreateSink = useCallback(async (fileId, meta, ownerId) => {
    let sink;
    if (canStreamToDisk()) {
      try {
        const handle = await window.showSaveFilePicker({
          id: "share-file-downloads",
          suggestedName: meta.name,
          startIn: "downloads",
        });
        const writable = await handle.createWritable();
        sink = {
          storageMode: "disk",
          async write(chunk, position) {
            await writable.write({ type: "write", position, data: chunk });
          },
          async close() {
            await writable.close();
            return { savedToDisk: true };
          },
          async abort() {
            if (typeof writable.abort === "function") {
              await writable.abort();
            }
          },
        };
      } catch (err) {
        // User cancelled or aborted the file save dialog
        return false;
      }
    } else {
      sink = createMemorySink(meta);
    }

    preCreatedSinksRef.current.set(fileId, { sink, ownerId });
    return true;
  }, []);

  const acceptIncoming = useCallback(async (autoAccept = false) => {
    if (autoAccept) {
      autoAcceptRef.current = true;
      if (!directoryHandleRef.current && canUseDirectoryPicker()) {
        try {
          directoryHandleRef.current = await window.showDirectoryPicker({
            id: "share-file-downloads-dir",
            mode: "readwrite",
            startIn: "downloads",
          });
        } catch (err) {
          autoAcceptRef.current = false;
          throw new Error("Directory selection is required to accept all files.");
        }
      }
    }
    await performAccept(pendingRef.current);
  }, [performAccept]);

  const rejectIncoming = useCallback(() => {
    autoAcceptRef.current = false;
    directoryHandleRef.current = null;
    const pending = pendingRef.current;
    const active = activeRef.current;
    const id = pending?.meta.id || active?.id;
    const channel = pending?.channel || active?.channel;

    if (channel?.readyState === "open" && id) {
      channel.send(JSON.stringify({ type: "file-cancel", id }));
    }

    if (active) {
      active.cleanupChannelEvents?.();
      active.sink.abort?.();
      partialTransfersRef.current.delete(active.id);
    }

    if (id && preCreatedSinksRef.current.has(id)) {
      const entry = preCreatedSinksRef.current.get(id);
      entry.sink.abort?.();
      preCreatedSinksRef.current.delete(id);
    }

    pendingRef.current = null;
    activeRef.current = null;
    setIncoming(null);
  }, []);

  const cancelPreCreatedSink = useCallback((fileId) => {
    if (preCreatedSinksRef.current.has(fileId)) {
      const entry = preCreatedSinksRef.current.get(fileId);
      entry.sink.abort?.();
      preCreatedSinksRef.current.delete(fileId);
    }
  }, []);

  const cancelTransfersForPeer = useCallback((peerId) => {
    // 1. Clean up active transfer if it belongs to this peer
    const active = activeRef.current;
    if (active && active.peerId === peerId) {
      failActiveTransfer(active, "Peer disconnected.");
    }

    // 2. Clean up pre-created sinks belonging to this peer safely without mutating during iteration
    const keysToDelete = [];
    for (const [fileId, entry] of preCreatedSinksRef.current.entries()) {
      if (entry.ownerId === peerId) {
        entry.sink.abort?.();
        keysToDelete.push(fileId);
      }
    }
    keysToDelete.forEach((fileId) => {
      preCreatedSinksRef.current.delete(fileId);
    });
  }, [failActiveTransfer]);

  const clearDownload = useCallback((id) => {
    setDownloads((current) => {
      const download = current.find((item) => item.id === id);
      if (download?.url) URL.revokeObjectURL(download.url);
      return current.filter((item) => item.id !== id);
    });
  }, []);

  const clearAllDownloads = useCallback(() => {
    setDownloads((current) => {
      current.forEach((download) => {
        if (download.url) URL.revokeObjectURL(download.url);
      });
      return [];
    });
  }, []);

  return {
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
  };
}

async function createDiskSink(meta) {
  const handle = await window.showSaveFilePicker({
    id: "share-file-downloads",
    suggestedName: meta.name,
    startIn: "downloads",
  });
  const writable = await handle.createWritable();

  return {
    storageMode: "disk",
    async write(chunk, position) {
      await writable.write({ type: "write", position, data: chunk });
    },
    async close() {
      await writable.close();
      return { savedToDisk: true };
    },
    async abort() {
      if (typeof writable.abort === "function") {
        await writable.abort();
      }
    },
  };
}

function createMemorySink(meta) {
  let buffer;
  try {
    buffer = new ArrayBuffer(meta.size);
  } catch {
    throw new Error("This browser cannot stream directly to disk and does not have enough memory for this file.");
  }

  const view = new Uint8Array(buffer);
  return {
    storageMode: "memory",
    async write(chunk, position) {
      view.set(chunk, position);
    },
    async close() {
      const blob = new Blob([buffer], { type: meta.mimeType });
      return { url: URL.createObjectURL(blob), savedToDisk: false, blob };
    },
    async abort() {},
  };
}

function canStreamToDisk() {
  return Boolean(window.isSecureContext && window.showSaveFilePicker);
}

async function createDirectorySink(directoryHandle, meta) {
  const fileHandle = await directoryHandle.getFileHandle(meta.name, { create: true });
  const writable = await fileHandle.createWritable();

  return {
    storageMode: "disk",
    async write(chunk, position) {
      await writable.write({ type: "write", position, data: chunk });
    },
    async close() {
      await writable.close();
      return { savedToDisk: true };
    },
    async abort() {
      if (typeof writable.abort === "function") {
        await writable.abort();
      }
    },
  };
}

function canUseDirectoryPicker() {
  return Boolean(window.isSecureContext && window.showDirectoryPicker);
}

function parseControlMessage(data) {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function sendResumeOffset(channel, id, offset) {
  if (channel?.readyState !== "open") {
    return;
  }

  channel.send(JSON.stringify({
    type: "file-resume",
    id,
    offset,
  }));
}

function toIncomingState(active, status) {
  return {
    meta: active.meta,
    receivedBytes: active.receivedBytes,
    status,
    storageMode: active.storageMode,
  };
}
