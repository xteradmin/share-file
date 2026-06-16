const DEFAULT_DEVICE_NAME = "LAN device";

export function handlePeerMessage(context, event, payload = {}) {
  if (event === "peer:announce") {
    context.client.displayName = normalizeDisplayName(payload.displayName);
    context.reply({ ok: true, peer: context.serializePeer(context.client) });
    context.broadcastPeerLists();
    return;
  }

  if (event === "peer:connect") {
    const target = context.clients.get(payload.targetId);
    if (!target || target.id === context.client.id) {
      context.reply({ ok: false, error: "User is no longer available." });
      context.broadcastPeerLists();
      return;
    }

    if (target.connectedPeerId && target.connectedPeerId !== context.client.id) {
      context.reply({ ok: false, error: "User is already connected." });
      context.broadcastPeerLists();
      return;
    }

    context.sendEvent(target.id, "peer:connect-request", {
      peer: context.serializePeer(context.client),
    });
    context.reply({ ok: true });
    return;
  }

  if (event === "peer:accept") {
    const requester = context.clients.get(payload.targetId);
    if (!requester || requester.id === context.client.id) {
      context.reply({ ok: false, error: "User is no longer available." });
      context.broadcastPeerLists();
      return;
    }

    context.connectPeers(context.client.id, requester.id);
    context.sendEvent(requester.id, "peer:connect-accepted", {
      peer: context.serializePeer(context.client),
    });
    context.reply({ ok: true });
    return;
  }

  if (event === "peer:disconnect") {
    context.clearPeerConnection(context.client.id);
    context.broadcastPeerLists();
    context.reply({ ok: true });
  }
}

function normalizeDisplayName(value) {
  const name = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!name) {
    return DEFAULT_DEVICE_NAME;
  }

  return name.slice(0, 40);
}
