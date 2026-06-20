export const peerConnectionConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: [
        "turn:168.110.216.181:3478?transport=udp",
        "turn:168.110.216.181:3478?transport=tcp",
      ],
      username: "sharefile",
      credential: "turnpassword123",
    },
  ],
};

export const DATA_CHANNEL_LABEL = "file-transfer";

