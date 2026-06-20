const relayPairs = new Map();

export function handleRelayMessage(context, event, payload) {
  const { client, clients, sendEvent } = context;

  switch (event) {
    case "relay:open": {
      const target = clients.get(payload.targetId);
      if (!target || target.ws.readyState !== 1) return;
      sendEvent(payload.targetId, "relay:open", { from: client.id });
      break;
    }

    case "relay:accept": {
      const target = clients.get(payload.targetId);
      if (!target || target.ws.readyState !== 1) return;
      relayPairs.set(`${client.id}:${payload.targetId}`, true);
      relayPairs.set(`${payload.targetId}:${client.id}`, true);
      sendEvent(payload.targetId, "relay:ready", { peerId: client.id });
      sendEvent(client.id, "relay:ready", { peerId: payload.targetId });
      break;
    }

    case "relay:data": {
      const key = `${client.id}:${payload.targetId}`;
      if (!relayPairs.has(key)) return;
      const target = clients.get(payload.targetId);
      if (!target || target.ws.readyState !== 1) return;
      sendEvent(payload.targetId, "relay:data", {
        from: client.id,
        data: payload.data,
        binary: payload.binary || false,
      });
      break;
    }

    case "relay:close": {
      const targetId = payload.targetId;
      relayPairs.delete(`${client.id}:${targetId}`);
      relayPairs.delete(`${targetId}:${client.id}`);
      const target = clients.get(targetId);
      if (target && target.ws.readyState === 1) {
        sendEvent(targetId, "relay:closed", { peerId: client.id });
      }
      break;
    }
  }
}

export function cleanupRelayForClient(clientId, clients, sendEvent) {
  const toRemove = [];
  for (const key of relayPairs.keys()) {
    if (key.startsWith(clientId + ":") || key.endsWith(":" + clientId)) {
      toRemove.push(key);
    }
  }
  for (const key of toRemove) {
    relayPairs.delete(key);
    const [a, b] = key.split(":");
    const partnerId = a === clientId ? b : a;
    const partner = clients.get(partnerId);
    if (partner && partner.ws.readyState === 1) {
      sendEvent(partnerId, "relay:closed", { peerId: clientId });
    }
  }
}
