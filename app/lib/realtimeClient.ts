type SessionBootstrap = {
  model: string;
  client_secret?: {
    value?: string;
    expires_at?: number;
  };
};

export class RealtimeClient {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private micStream: MediaStream | null = null;
  private remoteAudioEl: HTMLAudioElement;

  constructor(remoteAudioEl: HTMLAudioElement) {
    this.remoteAudioEl = remoteAudioEl;
  }

  private waitForDataChannelOpen(timeoutMs = 10_000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.dataChannel) {
        reject(new Error("Realtime data channel is not initialized"));
        return;
      }

      if (this.dataChannel.readyState === "open") {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Realtime data channel open timed out"));
      }, timeoutMs);

      const onOpen = () => {
        cleanup();
        resolve();
      };

      const onCloseOrError = () => {
        cleanup();
        reject(new Error("Realtime data channel failed to open"));
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.dataChannel?.removeEventListener("open", onOpen);
        this.dataChannel?.removeEventListener("close", onCloseOrError);
        this.dataChannel?.removeEventListener("error", onCloseOrError);
      };

      this.dataChannel.addEventListener("open", onOpen);
      this.dataChannel.addEventListener("close", onCloseOrError);
      this.dataChannel.addEventListener("error", onCloseOrError);
    });
  }

  private sendInitialGreeting(userName: string | null): void {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") return;

    const normalizedName =
      typeof userName === "string" && userName.trim() ? userName.trim() : "Guest";
    const kickoffText =
      normalizedName === "Guest"
        ? "Give me a short warm greeting and invite me to start the conversation."
        : `Greet ${normalizedName} warmly in one short line and invite the conversation to begin.`;

    this.dataChannel.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: kickoffText }],
        },
      })
    );

    this.dataChannel.send(
      JSON.stringify({
        type: "response.create",
        response: { modalities: ["audio", "text"] },
      })
    );
  }

  async connect(
    userName: string | null,
    options?: { warmGreeting?: boolean }
  ): Promise<void> {
    const warmGreeting = options?.warmGreeting ?? true;

    const bootstrapResp = await fetch("/api/realtime/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userName }),
    });

    if (!bootstrapResp.ok) {
      const err = await bootstrapResp.json().catch(() => ({}));
      const detail =
        typeof err?.detail === "object" ? JSON.stringify(err.detail) : "";
      throw new Error(
        err?.error ||
          (detail
            ? `Failed to create realtime session: ${detail}`
            : "Failed to create realtime session")
      );
    }

    const bootstrap: SessionBootstrap = await bootstrapResp.json();
    const ephemeralKey = bootstrap.client_secret?.value;
    if (!ephemeralKey) {
      throw new Error("Realtime session missing client secret");
    }

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });

    this.peerConnection = new RTCPeerConnection();
    this.micStream.getTracks().forEach((track) => {
      this.peerConnection?.addTrack(track, this.micStream as MediaStream);
    });

    this.peerConnection.ontrack = async (event) => {
      this.remoteAudioEl.srcObject = event.streams[0];
      this.remoteAudioEl.autoplay = true;
      this.remoteAudioEl.playsInline = true;
      await this.remoteAudioEl.play().catch(() => undefined);
    };

    this.dataChannel = this.peerConnection.createDataChannel("oai-events");

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    const sdpResp = await fetch(
      `https://api.openai.com/v1/realtime?model=${encodeURIComponent(
        bootstrap.model
      )}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      }
    );

    if (!sdpResp.ok) {
      const errorText = await sdpResp.text();
      throw new Error(errorText || "Failed to establish realtime connection");
    }

    const answerSdp = await sdpResp.text();
    await this.peerConnection.setRemoteDescription({
      type: "answer",
      sdp: answerSdp,
    });

    await this.waitForDataChannelOpen();

    const instructions = userName
      ? `You are Romaji, an AI robot assistant. The current user is ${userName}. Keep responses concise and natural.`
      : "You are Romaji, an AI robot assistant. Keep responses concise and natural.";

    this.dataChannel.send(
      JSON.stringify({
        type: "session.update",
        session: {
          modalities: ["audio", "text"],
          instructions,
          turn_detection: { type: "server_vad" },
        },
      })
    );

    if (warmGreeting) {
      this.sendInitialGreeting(userName);
    }
  }

  disconnect(): void {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }

    this.remoteAudioEl.srcObject = null;
  }
}
