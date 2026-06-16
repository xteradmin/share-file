import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { handlePeerMessage } from "./modules/peers/peerHandlers.js";
import { handleSignalMessage } from "./modules/signaling/signalingHandlers.js";

const clients = new Map();

export function registerSocketGateway(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    const client = {
      id: randomUUID(),
      ws,
      displayName: "LAN device",
      connectedPeerId: "",
    };
    clients.set(client.id, client);

    ws.on("message", (rawMessage) => {
      const message = parseMessage(rawMessage);
      if (!message) {
        return;
      }

      const context = {
        client,
        clients,
        reply: (payload) => reply(client, message.requestId, payload),
        sendEvent,
        serializePeer: (peer) => serializePeer(peer, client.id),
        broadcastPeerLists,
        connectPeers,
        clearPeerConnection,
      };

      if (message.event.startsWith("peer:")) {
        handlePeerMessage(context, message.event, message.payload);
        return;
      }

      if (message.event.startsWith("signal:")) {
        handleSignalMessage(context, message.event, message.payload);
      }
    });

    ws.on("close", () => {
      clearPeerConnection(client.id);
      clients.delete(client.id);
      broadcastPeerLists();
    });
  });
}

function parseMessage(rawMessage) {
  try {
    const message = JSON.parse(rawMessage.toString());
    if (!message?.event) {
      return null;
    }
    return message;
  } catch {
    return null;
  }
}

function reply(client, requestId, payload) {
  if (!requestId || client.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  client.ws.send(JSON.stringify({ requestId, payload }));
}

function sendEvent(clientId, event, payload) {
  const target = clients.get(clientId);
  if (!target || target.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  target.ws.send(JSON.stringify({ event, payload }));
}

function connectPeers(firstId, secondId) {
  const first = clients.get(firstId);
  const second = clients.get(secondId);
  if (!first || !second) {
    return;
  }

  clearPeerConnection(first.id);
  clearPeerConnection(second.id);

  first.connectedPeerId = second.id;
  second.connectedPeerId = first.id;
  broadcastPeerLists();
}

function clearPeerConnection(clientId) {
  const client = clients.get(clientId);
  const peerId = client?.connectedPeerId;
  if (!client || !peerId) {
    return;
  }

  client.connectedPeerId = "";
  const peer = clients.get(peerId);
  if (peer?.connectedPeerId === clientId) {
    peer.connectedPeerId = "";
    sendEvent(peer.id, "peer:disconnect", { peerId: clientId });
  }
}

function broadcastPeerLists() {
  for (const client of clients.values()) {
    sendEvent(client.id, "peer:list", {
      self: serializePeer(client, client.id),
      peers: [...clients.values()]
        .filter((peer) => peer.id !== client.id)
        .map((peer) => serializePeer(peer, client.id)),
    });
  }
}

function serializePeer(peer, viewerId = "") {
  return {
    id: peer.id,
    displayName: peer.displayName || "LAN device",
    connected: Boolean(peer.connectedPeerId),
    connectedToSelf: Boolean(viewerId && peer.connectedPeerId === viewerId),
  };
}
