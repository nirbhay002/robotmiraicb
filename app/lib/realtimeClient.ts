type SessionBootstrap = {
  model: string;
  client_secret?: {
    value?: string;
    expires_at?: number;
  };
};

const DEFAULT_VAD_THRESHOLD = 0.72;
const DEFAULT_VAD_PREFIX_PADDING_MS = 300;
const DEFAULT_VAD_SILENCE_DURATION_MS = 900;

function getNumberEnv(
  key: string,
  fallback: number,
  { min, max }: { min?: number; max?: number } = {}
): number {
  const raw = process.env[key];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  if (typeof min === "number" && parsed < min) return fallback;
  if (typeof max === "number" && parsed > max) return fallback;
  return parsed;
}

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
    // Keep the opener generic/enthusiastic; force English for first greeting.
    const kickoffText =
      normalizedName === "Guest"
        ? "In English, give one short, enthusiastic welcome and ask: How can I help you today?"
        : `In English, give ${normalizedName} one short, enthusiastic welcome and ask: How can I help you today?`;

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
      const rawError = await bootstrapResp.text();
      let err: {
        error?: string;
        detail?: unknown;
      } = {};
      try {
        err = JSON.parse(rawError || "{}") as {
          error?: string;
          detail?: unknown;
        };
      } catch {
        err = {};
      }
      const detail =
        typeof err?.detail === "object" ? JSON.stringify(err.detail) : "";
      throw new Error(
        err?.error ||
          (rawError.trim().length > 0 ? rawError : "") ||
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
      audio: {
        // Bias capture toward foreground voice in noisy environments.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    });

    this.peerConnection = new RTCPeerConnection();
    this.micStream.getTracks().forEach((track) => {
      this.peerConnection?.addTrack(track, this.micStream as MediaStream);
    });

    this.peerConnection.ontrack = async (event) => {
      this.remoteAudioEl.srcObject = event.streams[0];
      this.remoteAudioEl.autoplay = true;
      this.remoteAudioEl.setAttribute("playsinline", "true");
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

    const vadThreshold = getNumberEnv(
      "NEXT_PUBLIC_REALTIME_VAD_THRESHOLD",
      DEFAULT_VAD_THRESHOLD,
      { min: 0.1, max: 0.95 }
    );
    const vadPrefixPaddingMs = getNumberEnv(
      "NEXT_PUBLIC_REALTIME_VAD_PREFIX_PADDING_MS",
      DEFAULT_VAD_PREFIX_PADDING_MS,
      { min: 100, max: 1000 }
    );
    const vadSilenceDurationMs = getNumberEnv(
      "NEXT_PUBLIC_REALTIME_VAD_SILENCE_DURATION_MS",
      DEFAULT_VAD_SILENCE_DURATION_MS,
      { min: 300, max: 2000 }
    );

    this.dataChannel.send(
      JSON.stringify({
        type: "session.update",
        session: {
          modalities: ["audio", "text"],
          instructions:
            "Language lock rule: after the English greeting, infer language from the first substantive user message and keep responding in that same language for the session. Switch only if the user explicitly asks to change language. If unsure between English and Hindi, ask one short clarification in English.",
          turn_detection: {
            type: "server_vad",
            threshold: vadThreshold,
            prefix_padding_ms: vadPrefixPaddingMs,
            silence_duration_ms: vadSilenceDurationMs,
          },
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
