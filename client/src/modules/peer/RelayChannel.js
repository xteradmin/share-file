/**
 * RelayChannel — A DataChannel-compatible wrapper that relays data through
 * the signaling WebSocket when direct WebRTC P2P is not possible (e.g. VPS
 * deployment where peers are on different networks without a TURN server).
 */
export class RelayChannel {
  constructor(socket, peerId) {
    this._socket = socket;
    this._peerId = peerId;
    this._readyState = "connecting";
    this._binaryType = "arraybuffer";
    this._bufferedAmountLowThreshold = 0;
    this._listeners = new Map();

    // Event handler properties (DataChannel compat)
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this.onerror = null;

    this._handleRelayReady = (payload) => {
      if (payload.peerId === this._peerId) {
        this._readyState = "open";
        this._emit("open", {});
      }
    };

    this._handleRelayData = (payload) => {
      if (payload.from !== this._peerId) return;
      let data = payload.data;
      if (payload.binary) {
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        data = bytes.buffer;
      }
      this._emit("message", { data });
    };

    this._handleRelayClosed = (payload) => {
      if (payload.peerId === this._peerId) {
        this._readyState = "closed";
        this._emit("close", {});
      }
    };

    socket.on("relay:ready", this._handleRelayReady);
    socket.on("relay:data", this._handleRelayData);
    socket.on("relay:closed", this._handleRelayClosed);
  }

  get readyState() {
    return this._readyState;
  }

  get binaryType() {
    return this._binaryType;
  }

  set binaryType(value) {
    this._binaryType = value;
  }

  get bufferedAmount() {
    return 0;
  }

  get bufferedAmountLowThreshold() {
    return this._bufferedAmountLowThreshold;
  }

  set bufferedAmountLowThreshold(value) {
    this._bufferedAmountLowThreshold = value;
  }

  send(data) {
    if (this._readyState !== "open") {
      throw new Error("RelayChannel is not open.");
    }

    let sendData;
    let binary = false;

    if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data);
      let binaryStr = "";
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binaryStr += String.fromCharCode.apply(null, slice);
      }
      sendData = btoa(binaryStr);
      binary = true;
    } else {
      sendData = data;
    }

    this._socket.emit("relay:data", {
      targetId: this._peerId,
      data: sendData,
      binary,
    });
  }

  close() {
    if (this._readyState === "closed") return;
    this._readyState = "closed";

    this._socket.emit("relay:close", { targetId: this._peerId });
    this._cleanup();
    this._emit("close", {});
  }

  addEventListener(type, handler) {
    const handlers = this._listeners.get(type) || new Set();
    handlers.add(handler);
    this._listeners.set(type, handlers);
  }

  removeEventListener(type, handler) {
    this._listeners.get(type)?.delete(handler);
  }

  _emit(type, event) {
    const prop = `on${type}`;
    if (typeof this[prop] === "function") {
      this[prop](event);
    }
    const handlers = this._listeners.get(type);
    if (handlers) {
      for (const handler of handlers) {
        handler(event);
      }
    }
  }

  _cleanup() {
    this._socket.off("relay:ready", this._handleRelayReady);
    this._socket.off("relay:data", this._handleRelayData);
    this._socket.off("relay:closed", this._handleRelayClosed);
  }
}
