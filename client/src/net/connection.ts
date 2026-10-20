import {
  asSeq,
  asTick,
  decodeSnapshot,
  encodeInput,
  parseServerMessage,
  parseSnapshot,
  type ClientMessage,
  type GameSnapshot,
  type ParsedServerMessage,
} from "@dogfight/shared";

export type ConnectionState = "connecting" | "open" | "reconnecting" | "closed";

export class GameConnection extends EventTarget {
  private socket: WebSocket | undefined;
  private joinRequest: Extract<ClientMessage, { type: "join" }> | undefined;
  private readonly queue: ClientMessage[] = [];
  private reconnectTimer: number | undefined;
  private reconnectAttempt = 0;
  private shouldReconnect = true;
  private joined = false;
  private stateValue: ConnectionState = "closed";
  private sentBytes = 0;
  private receivedBytes = 0;
  private lastMessageAt = 0;
  onServerMessage: ((message: ParsedServerMessage) => void) | undefined;
  onSnapshot: ((snapshot: GameSnapshot) => void) | undefined;
  onConnectionState: ((state: ConnectionState) => void) | undefined;
  onStatus: ((message: string) => void) | undefined;

  constructor(private readonly codec: "binary" | "json" = "binary") {
    super();
  }

  get state(): ConnectionState {
    return this.stateValue;
  }
  get bytesSent(): number {
    return this.sentBytes;
  }
  get bytesReceived(): number {
    return this.receivedBytes;
  }
  get snapshotAgeMs(): number {
    return this.lastMessageAt ? performance.now() - this.lastMessageAt : 0;
  }

  join(roomId: string, name: string): void {
    this.joinRequest = { type: "join", version: 1, roomId, name };
    this.shouldReconnect = true;
    this.joined = false;
    this.open();
  }

  send(message: Exclude<ClientMessage, { type: "join" }>): void {
    if (message.type === "input" && this.queue.length > 60) this.queue.shift();
    if (this.joined && this.socket?.readyState === WebSocket.OPEN)
      this.sendRaw(message);
    else if (this.queue.length < 120) this.queue.push(message);
  }

  stop(): void {
    this.shouldReconnect = false;
    this.joined = false;
    this.joinRequest = undefined;
    if (this.reconnectTimer !== undefined)
      window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.queue.length = 0;
    this.socket?.close(1000, "player left");
    this.socket = undefined;
    this.setState("closed");
  }

  private open(): void {
    if (
      !this.shouldReconnect ||
      this.socket?.readyState === WebSocket.CONNECTING ||
      this.socket?.readyState === WebSocket.OPEN
    )
      return;
    const url = new URL("/ws", window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    this.setState(this.reconnectAttempt ? "reconnecting" : "connecting");
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (socket !== this.socket) return;
      this.setState("open");
      if (this.joinRequest) this.sendRaw(this.joinRequest);
    });
    socket.addEventListener("message", (event: MessageEvent<unknown>) => {
      void this.receive(event.data);
    });
    socket.addEventListener("error", () =>
      this.onStatus?.("З’єднання перервано. Повторне підключення…"),
    );
    socket.addEventListener("close", () => {
      if (socket !== this.socket) return;
      this.socket = undefined;
      this.joined = false;
      this.setState("closed");
      if (this.shouldReconnect) this.scheduleReconnect();
    });
  }

  private async receive(data: unknown): Promise<void> {
    if (typeof data === "string") {
      this.receivedBytes += new TextEncoder().encode(data).byteLength;
      let value: unknown;
      try {
        value = JSON.parse(data);
      } catch {
        this.onStatus?.("Сервер надіслав некоректний JSON.");
        return;
      }
      const parsed = parseServerMessage(value);
      if (!parsed.success) {
        this.onStatus?.("Сервер надіслав невідоме повідомлення.");
        return;
      }
      this.lastMessageAt = performance.now();
      if (parsed.data.type === "joined") {
        this.reconnectAttempt = 0;
        this.joined = true;
        for (const message of this.queue.splice(0)) this.sendRaw(message);
      }
      if (parsed.data.type === "snapshot") {
        try {
          this.onSnapshot?.(parseSnapshot(parsed.data.snapshot));
        } catch (cause) {
          this.onStatus?.(
            cause instanceof Error ? cause.message : "Некоректний JSON-знімок.",
          );
        }
        return;
      }
      this.onServerMessage?.(parsed.data);
      return;
    }
    if (data instanceof ArrayBuffer) {
      this.receivedBytes += data.byteLength;
      try {
        const snapshot: GameSnapshot = decodeSnapshot(data);
        this.lastMessageAt = performance.now();
        this.onSnapshot?.(snapshot);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "bad snapshot";
        this.onStatus?.(`Знімок стану пошкоджений: ${message}`);
      }
      return;
    }
    if (data instanceof Blob) await this.receive(await data.arrayBuffer());
  }

  private sendRaw(message: ClientMessage): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (message.type === "input" && this.codec === "binary") {
      const payload = encodeInput({
        seq: asSeq(message.seq),
        tick: asTick(message.tick),
        turn: message.turn,
        thrust: message.thrust,
        fire: message.fire,
      });
      this.sentBytes += payload.byteLength;
      socket.send(payload);
      return;
    }
    const payload = JSON.stringify(message);
    this.sentBytes += new TextEncoder().encode(payload).byteLength;
    socket.send(payload);
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer !== undefined) return;
    this.reconnectAttempt += 1;
    const waitMs =
      Math.min(8000, 250 * 2 ** Math.min(this.reconnectAttempt, 5)) *
      (0.8 + Math.random() * 0.4);
    this.setState("reconnecting");
    this.onStatus?.("Сервер недоступний; повторне підключення…");
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.open();
    }, waitMs);
  }

  private setState(state: ConnectionState): void {
    if (this.stateValue === state) return;
    this.stateValue = state;
    this.onConnectionState?.(state);
  }
}
