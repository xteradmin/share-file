export const CHUNK_SIZE = 256 * 1024;
const BACKPRESSURE_HIGH = 64 * 1024 * 1024;

// ── File ID ──────────────────────────────────────────────────────────
export function createFileId(file) {
  return `${file.name}-${file.size}-${file.lastModified || 0}`;
}

// ── Send a file (with background + resume) ──────────────────────────
export async function sendFile({ channel, file, id: customId, signal, onProgress, queueIndex, queueSize }) {
  if (!channel || channel.readyState !== "open") {
    throw new Error("Data channel is not open.");
  }

  const id = customId || createFileId(file);
  const resumeOffsetPromise = waitForResumeOffset(channel, id, file.size, signal);

  channel.send(JSON.stringify({
    type: "file-meta",
    id,
    name: file.name,
    size: file.size,
    mimeType: file.type || "application/octet-stream",
    lastModified: file.lastModified || 0,
    chunkSize: CHUNK_SIZE,
    queueIndex,
    queueSize,
  }));

  let resumeOffset = 0;
  try {
    resumeOffset = await resumeOffsetPromise;
  } catch (error) {
    if (error.message === "Transfer cancelled." && channel.readyState === "open") {
      channel.send(JSON.stringify({ type: "file-cancel", id }));
    }
    throw error;
  }

  saveTransferState(id, {
    name: file.name,
    size: file.size,
    mimeType: file.type || "application/octet-stream",
    lastSentOffset: resumeOffset,
  });

  const startedAt = performance.now();
  let sentBytes = resumeOffset;
  let lastReport = 0;

  for (let offset = resumeOffset; offset < file.size; offset += CHUNK_SIZE) {
    if (signal?.aborted) {
      channel.send(JSON.stringify({ type: "file-cancel", id }));
      clearTransferState(id);
      throw new Error("Transfer cancelled.");
    }

    if (channel.readyState !== "open") {
      throw new Error("Data channel closed during transfer.");
    }

    // Only wait when buffer is truly saturated.
    // The browser's SCTP handles the rest of the flow control.
    if (channel.bufferedAmount > BACKPRESSURE_HIGH) {
      await waitForDrain(channel);
    }

    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const buffer = await file.slice(offset, end).arrayBuffer();
    channel.send(buffer);
    sentBytes += buffer.byteLength;

    // Throttle UI updates to every 300ms.
    const now = performance.now();
    if (now - lastReport > 300 || sentBytes >= file.size) {
      lastReport = now;
      const elapsed = Math.max((now - startedAt) / 1000, 0.001);
      onProgress?.({
        id,
        sentBytes,
        totalBytes: file.size,
        speedBytesPerSecond: (sentBytes - resumeOffset) / elapsed,
      });
    }

    if (sentBytes - resumeOffset > 0 && sentBytes % (4 * 1024 * 1024) < CHUNK_SIZE) {
      updateTransferOffset(id, sentBytes);
    }
  }

  updateTransferOffset(id, file.size);
  channel.send(JSON.stringify({ type: "file-done", id }));
  clearTransferState(id);

  const elapsed = Math.max((performance.now() - startedAt) / 1000, 0.001);
  onProgress?.({
    id,
    sentBytes,
    totalBytes: file.size,
    speedBytesPerSecond: (sentBytes - resumeOffset) / elapsed,
  });

  return { id, sentBytes };
}

// ── Wait for buffer to drain ─────────────────────────────────────────
// Uses the native bufferedamountlow event. Falls back to a fast poll
// for background tabs where browsers throttle the event.
function waitForDrain(channel) {
  return new Promise((resolve) => {
    const threshold = 32 * 1024 * 1024;
    channel.bufferedAmountLowThreshold = threshold;

    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      channel.removeEventListener("bufferedamountlow", done);
      clearInterval(poll);
      resolve();
    };

    channel.addEventListener("bufferedamountlow", done);

    // Fast poll fallback — check every 10ms, not 50ms.
    const poll = setInterval(() => {
      if (channel.bufferedAmount <= threshold || channel.readyState !== "open") {
        done();
      }
    }, 10);
  });
}

// ── Resume offset handshake ──────────────────────────────────────────
function waitForResumeOffset(channel, id, fileSize, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      channel.removeEventListener("message", handler);
      channel.removeEventListener("close", handleClose);
      channel.removeEventListener("error", handleError);
      signal?.removeEventListener("abort", handleAbort);
    };

    const finish = (offset = 0) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(normalizeResumeOffset(offset, fileSize));
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    function handleAbort() {
      fail(new Error("Transfer cancelled."));
    }

    function handleClose() {
      fail(new Error("Data channel closed during transfer."));
    }

    function handleError() {
      fail(new Error("Data channel error during transfer."));
    }

    function handler(event) {
      if (typeof event.data !== "string") return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === "file-resume" && message.id === id) {
          finish(message.offset);
        }
        if (message.type === "file-cancel" && message.id === id) {
          fail(new Error("Receiver cancelled transfer."));
        }
      } catch {}
    }

    if (signal?.aborted) {
      fail(new Error("Transfer cancelled."));
      return;
    }

    channel.addEventListener("message", handler);
    channel.addEventListener("close", handleClose);
    channel.addEventListener("error", handleError);
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

function normalizeResumeOffset(offset, fileSize) {
  const value = Number(offset);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value >= fileSize) {
    return fileSize;
  }
  return Math.floor(value / CHUNK_SIZE) * CHUNK_SIZE;
}

// ── Transfer state persistence (localStorage) ────────────────────────
const STATE_KEY_PREFIX = "sharefile:transfer:";

function saveTransferState(id, state) {
  try { localStorage.setItem(STATE_KEY_PREFIX + id, JSON.stringify(state)); } catch {}
}

function updateTransferOffset(id, offset) {
  try {
    const raw = localStorage.getItem(STATE_KEY_PREFIX + id);
    if (raw) {
      const state = JSON.parse(raw);
      state.lastSentOffset = offset;
      localStorage.setItem(STATE_KEY_PREFIX + id, JSON.stringify(state));
    }
  } catch {}
}

export function clearTransferState(id) {
  try { localStorage.removeItem(STATE_KEY_PREFIX + id); } catch {}
}

export function getPendingTransferStates() {
  const states = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STATE_KEY_PREFIX)) {
        const id = key.slice(STATE_KEY_PREFIX.length);
        const state = JSON.parse(localStorage.getItem(key));
        states.push({ id, ...state });
      }
    }
  } catch {}
  return states;
}
