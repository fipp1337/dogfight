import { z } from "zod";

const roomListSchema = z.object({
  rooms: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      width: z.number(),
      height: z.number(),
      seed: z.number(),
      maxPlayers: z.number(),
      players: z.number(),
      running: z.boolean(),
    }),
  ),
});
export type LobbyRoom = z.infer<typeof roomListSchema>["rooms"][number];
export class RoomsUpdatedEvent extends Event {
  constructor(readonly rooms: readonly LobbyRoom[]) {
    super("rooms");
  }
}
export class LobbyStatusEvent extends Event {
  constructor(readonly message: string) {
    super("status");
  }
}
export class LobbyJoinedEvent extends Event {
  constructor(
    readonly room: LobbyRoom,
    readonly name: string,
  ) {
    super("joined");
  }
}

export class Lobby extends EventTarget {
  private controller: AbortController | undefined;
  private visible = false;
  private timer: number | undefined;
  private roomsValue: LobbyRoom[] = [];
  private readonly intervalMs = 3000;

  get rooms(): readonly LobbyRoom[] {
    return this.roomsValue;
  }
  get isVisible(): boolean {
    return this.visible;
  }

  async show(): Promise<void> {
    this.leave();
    this.controller = new AbortController();
    this.visible = true;
    await this.refresh();
    this.scheduleRefresh();
  }

  async refresh(): Promise<void> {
    const controller = this.controller;
    if (!this.visible || !controller) return;
    try {
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(5000),
      ]);
      const response = await fetch("/api/rooms", {
        signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok)
        throw new Error(`Список кімнат: HTTP ${response.status}`);
      const body: unknown = await response.json();
      const parsed = roomListSchema.safeParse(body);
      if (!parsed.success)
        throw new Error("Сервер надіслав некоректний список кімнат.");
      this.roomsValue = parsed.data.rooms;
      this.dispatchEvent(new RoomsUpdatedEvent(this.roomsValue));
    } catch (cause) {
      if (controller.signal.aborted) return;
      const message =
        cause instanceof Error ? cause.message : "Не вдалося оновити кімнати.";
      this.dispatchEvent(new LobbyStatusEvent(message));
    }
  }

  join(roomId: string, name: string): void {
    const room = this.roomsValue.find((candidate) => candidate.id === roomId);
    if (!room) {
      this.dispatchEvent(
        new LobbyStatusEvent("Спочатку оновіть список кімнат."),
      );
      return;
    }
    this.leave();
    this.dispatchEvent(new LobbyJoinedEvent(room, name.trim() || "Pilot"));
  }

  leave(): void {
    this.visible = false;
    this.controller?.abort(new DOMException("Lobby closed", "AbortError"));
    this.controller = undefined;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private scheduleRefresh(): void {
    if (!this.visible || !this.controller) return;
    this.timer = window.setTimeout(async () => {
      await this.refresh();
      this.scheduleRefresh();
    }, this.intervalMs);
  }
}
