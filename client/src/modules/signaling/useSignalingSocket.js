import { useEffect, useState } from "react";

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL;

// crypto.randomUUID() requires a secure context (HTTPS or localhost).
// LAN access over plain HTTP (e.g. http://192.168.1.x:5180) does not
// have it, so we need a fallback.
function generateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch {
      // non-secure context — fall through
    }
  }

  const hex = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0"),
  ).join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function useSignalingSocket() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);

  useEffect(() => {
    const client = createSignalingClient(SIGNALING_URL || defaultSignalingUrl());

    const handleConnect = () => {
      setConnected(true);
      setConnectionError(null);
    };
    const handleDisconnect = () => setConnected(false);
    const handleError = (error) => {
      setConnectionError(error?.message || "Connection failed");
      console.error("[Signaling] Connection error:", error);
    };

    client.on("connect", handleConnect);
    client.on("disconnect", handleDisconnect);
    client.on("error", handleError);
    setSocket(client);

    return () => {
      client.off("connect", handleConnect);
      client.off("disconnect", handleDisconnect);
      client.off("error", handleError);
      client.close();
    };
  }, []);

  return { socket, connected, connectionError };
}

function createSignalingClient(baseUrl) {
  const listeners = new Map();
  const pendingReplies = new Map();
  const pendingEvents = new Map();
  const wsUrl = toWebSocketUrl(baseUrl);
  const ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => emitLocal("connect"));
  ws.addEventListener("close", () => emitLocal("disconnect"));
  ws.addEventListener("error", () => {
    emitLocal("error", { message: `Could not connect to ${wsUrl}` });
    emitLocal("disconnect");
  });
  ws.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return; // Ignore malformed messages from the server
    }

    if (message.requestId && pendingReplies.has(message.requestId)) {
      pendingReplies.get(message.requestId)(message.payload);
      pendingReplies.delete(message.requestId);
      return;
    }

    if (message.event) {
      emitLocal(message.event, message.payload);
    }
  });

  function emitLocal(event, payload) {
    const eventListeners = listeners.get(event);
    if (!eventListeners?.size) {
      const queued = pendingEvents.get(event) || [];
      queued.push(payload);
      pendingEvents.set(event, queued.slice(-20));
      return;
    }

    for (const listener of eventListeners) {
      listener(payload);
    }
  }

  function send(event, payload = {}, reply) {
    const requestId = typeof reply === "function" ? generateId() : undefined;
    if (requestId) {
      pendingReplies.set(requestId, reply);
    }

    const write = () => {
      ws.removeEventListener("close", cancelWrite);
      ws.send(JSON.stringify({ event, payload, requestId }));
    };

    const cancelWrite = () => {
      ws.removeEventListener("open", write);
      if (requestId) {
        pendingReplies.delete(requestId);
      }
    };

    if (ws.readyState === WebSocket.OPEN) {
      write();
      return;
    }

    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      cancelWrite();
      return;
    }

    ws.addEventListener("open", write, { once: true });
    ws.addEventListener("close", cancelWrite, { once: true });
  }

  return {
    emit: send,
    on(event, listener) {
      const eventListeners = listeners.get(event) || new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);

      const queued = pendingEvents.get(event);
      if (queued?.length) {
        pendingEvents.delete(event);
        for (const payload of queued) {
          queueMicrotask(() => listener(payload));
        }
      }
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener);
    },
    close() {
      ws.close();
      pendingReplies.clear();
      pendingEvents.clear();
      listeners.clear();
    },
  };
}

function toWebSocketUrl(baseUrl) {
  const url = new URL(baseUrl, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  return url.toString();
}

function defaultSignalingUrl() {
  // Route through Vite's proxy on the same port. This avoids Windows
  // Firewall blocking direct access to port 3000 from other devices.
  return window.location.origin;
}
