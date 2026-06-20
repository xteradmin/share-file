// TURN server configuration via environment variables (set at build time with Vite).
// Example: VITE_TURN_URL=turn:1.2.3.4:3478 VITE_TURN_USER=sharefile VITE_TURN_PASS=secret
const turnUrl = import.meta.env.VITE_TURN_URL;
const turnUser = import.meta.env.VITE_TURN_USER;
const turnPass = import.meta.env.VITE_TURN_PASS;

const iceServers = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
];

if (turnUrl) {
  iceServers.push({
    urls: [
      turnUrl.replace(/^turn:/, "turn:") + "?transport=udp",
      turnUrl.replace(/^turn:/, "turn:") + "?transport=tcp",
    ],
    username: turnUser || "",
    credential: turnPass || "",
  });
}

export const peerConnectionConfig = { iceServers };

export const DATA_CHANNEL_LABEL = "file-transfer";
