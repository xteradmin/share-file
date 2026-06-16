import { PlugZap, Unplug, UserRound, UsersRound } from "lucide-react";

export function PairingCard({
  selfPeer,
  deviceName,
  peers,
  connectedPeer,
  connectingPeerId,
  error,
  disabled,
  onConnectPeer,
  onDisconnectPeer,
}) {
  return (
    <section className="panel" aria-label="LAN users">
      <div className="panel-header">
        <div className="panel-title">
          <UsersRound size={19} aria-hidden="true" />
          <h2>LAN users</h2>
        </div>
        <span className={`status-pill ${disabled ? "warning" : "ready"}`}>
          <span className="status-dot" />
          {disabled ? "offline" : "online"}
        </span>
      </div>

      <div className="device-card">
        <div className="device-avatar" aria-hidden="true">
          <UserRound size={18} />
        </div>
        <div>
          <strong>{selfPeer?.displayName || deviceName}</strong>
          <span>This device</span>
        </div>
      </div>

      {connectedPeer ? (
        <div className="connected-peer">
          <div className="download-row">
            <strong>{connectedPeer.displayName}</strong>
            <span>Connected</span>
          </div>
          <button className="button secondary" type="button" onClick={onDisconnectPeer}>
            <Unplug size={17} aria-hidden="true" />
            Disconnect
          </button>
        </div>
      ) : null}

      <div className="peer-list" aria-label="Available users">
        {peers.length === 0 ? (
          <div className="empty-state">
            <UsersRound size={18} aria-hidden="true" />
            <span>No other users online.</span>
          </div>
        ) : (
          peers.map((peer) => (
            <PeerRow
              key={peer.id}
              peer={peer}
              disabled={disabled || Boolean(connectedPeer && connectedPeer.id !== peer.id)}
              connecting={connectingPeerId === peer.id}
              connected={connectedPeer?.id === peer.id || peer.connectedToSelf}
              onConnect={() => onConnectPeer(peer)}
            />
          ))
        )}
      </div>

      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

function PeerRow({ peer, disabled, connecting, connected, onConnect }) {
  const busy = peer.connected && !connected;
  const actionLabel = connected ? "Connected" : connecting ? "Connecting" : "Connect";

  return (
    <div className="peer-row">
      <div className="peer-main">
        <div className="device-avatar" aria-hidden="true">
          <UserRound size={18} />
        </div>
        <div>
          <strong>{peer.displayName}</strong>
          <span>{busy ? "Busy" : connected ? "Connected" : "Available"}</span>
        </div>
      </div>
      <button
        className="button"
        type="button"
        disabled={disabled || busy || connected || connecting}
        onClick={onConnect}
      >
        <PlugZap size={17} aria-hidden="true" />
        {actionLabel}
      </button>
    </div>
  );
}
