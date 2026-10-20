import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  FIXED_DT,
  addPlayer,
  createWorld,
  removePlayer,
  stepWorld,
} from "@dogfight/shared";
import type {
  ArenaConfig,
  GameSnapshot,
  InputCommand,
  WorldState,
} from "@dogfight/shared";
import { encodeSnapshot } from "@dogfight/shared";
import type WebSocket from "ws";
import type { Logger } from "pino";
import type { ServerConfig } from "./config.js";

export interface PlayerSession {
  id: string;
  name: string;
  shipId: number;
  socket: WebSocket;
  lastProcessedSeq: number;
  latestInput: InputCommand | undefined;
  pendingInputs: InputCommand[];
}

interface RoomEvents {
  event: [Record<string, unknown>];
  changed: [];
  empty: [];
  error: [Error];
  traffic: [number];
}

const ARENAS: ArenaConfig[] = [
  {
    id: "alpha",
    name: "Blue Nebula",
    width: 1000,
    height: 700,
    seed: 42810,
    maxPlayers: 8,
  },
  {
    id: "beta",
    name: "Red Dwarf",
    width: 900,
    height: 640,
    seed: 99231,
    maxPlayers: 8,
  },
  {
    id: "gamma",
    name: "Deep Space",
    width: 1200,
    height: 760,
    seed: 17301,
    maxPlayers: 8,
  },
];

export class Room extends EventEmitter<RoomEvents> {
  readonly players = new Map<string, PlayerSession>();
  readonly world: WorldState;
  tickDurationMs = 0;
  private timer: NodeJS.Timeout | undefined;
  private targetAt = 0;
  private readonly tickDurations: number[] = [];

  constructor(
    readonly config: ArenaConfig,
    private readonly maxPlayers: number,
    private readonly logger: Logger,
    private readonly network: Pick<
      ServerConfig,
      | "networkLatencyMs"
      | "networkJitterMs"
      | "networkDropRate"
      | "snapshotFormat"
    >,
  ) {
    super();
    this.on("error", (error) =>
      this.logger.error({ err: error, roomId: this.config.id }, "room error"),
    );
    this.world = createWorld(config);
  }

  get id(): string {
    return this.config.id;
  }
  get running(): boolean {
    return this.timer !== undefined;
  }
  get p99TickMs(): number {
    if (!this.tickDurations.length) return 0;
    const sorted = [...this.tickDurations].sort((a, b) => a - b);
    return (
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0
    );
  }

  join(id: string, name: string, socket: WebSocket): PlayerSession {
    if (this.players.size >= Math.min(this.maxPlayers, this.config.maxPlayers))
      throw new Error("room is full");
    if (this.players.has(id)) throw new Error("player already joined");
    const playerState = addPlayer(this.world, id, name);
    const player: PlayerSession = {
      id,
      name,
      shipId: playerState.entityId,
      socket,
      lastProcessedSeq: 0,
      latestInput: undefined,
      pendingInputs: [],
    };
    this.players.set(id, player);
    this.emit("event", {
      t: this.world.tick,
      type: "player.joined",
      roomId: this.id,
      playerId: id,
      name,
    });
    this.emit("changed");
    if (!this.running) this.start();
    this.broadcastJson({
      type: "roster",
      players: [...this.players.values()].map(
        ({ id: playerId, name: playerName, shipId }) => ({
          id: playerId,
          name: playerName,
          entityId: shipId,
        }),
      ),
    });
    return player;
  }

  leave(id: string): void {
    const player = this.players.get(id);
    if (!player) return;
    this.players.delete(id);
    removePlayer(this.world, id);
    this.emit("event", {
      t: this.world.tick,
      type: "player.left",
      roomId: this.id,
      playerId: id,
    });
    this.emit("changed");
    this.broadcastJson({
      type: "roster",
      players: [...this.players.values()].map(
        ({ id: playerId, name, shipId }) => ({
          id: playerId,
          name,
          entityId: shipId,
        }),
      ),
    });
    if (!this.players.size) {
      this.stop();
      this.emit("empty");
    }
  }

  acceptInput(playerId: string, input: InputCommand): boolean {
    const player = this.players.get(playerId);
    const lastQueuedSeq =
      player?.pendingInputs.at(-1)?.seq ?? player?.lastProcessedSeq ?? 0;
    if (
      !player ||
      input.seq <= lastQueuedSeq ||
      input.seq > lastQueuedSeq + 100
    )
      return false;
    player.pendingInputs.push(input);
    if (player.pendingInputs.length > 32)
      player.pendingInputs.splice(0, player.pendingInputs.length - 32);
    return true;
  }

  chat(playerId: string, text: string): void {
    const sender = this.players.get(playerId);
    if (!sender) return;
    const message: Extract<
      import("@dogfight/shared").ServerMessage,
      { type: "chat" }
    > = {
      type: "chat",
      id: randomUUID(),
      name: sender.name,
      text: text.replace(/[<>]/g, ""),
      at: Date.now(),
    };
    this.emit("event", {
      t: this.world.tick,
      type: "chat",
      roomId: this.id,
      playerId,
      textLength: message.text.length,
    });
    this.broadcastJson(message);
  }

  broadcastJson(message: unknown): void {
    const serialized = JSON.stringify(message);
    for (const player of this.players.values()) {
      if (player.socket.readyState !== player.socket.OPEN) continue;
      if (player.socket.bufferedAmount > 64 * 1024) {
        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "roster"
        )
          continue;
        player.socket.close(1013, "slow client");
        continue;
      }
      player.socket.send(serialized, (error) => {
        if (error) this.emit("error", error);
      });
      this.emit("traffic", Buffer.byteLength(serialized));
    }
  }

  private broadcastSnapshots(): void {
    for (const player of this.players.values()) {
      if (player.socket.readyState !== player.socket.OPEN) continue;
      if (player.socket.bufferedAmount > 64 * 1024) {
        player.socket.close(1013, "slow client");
        continue;
      }
      const snapshot: GameSnapshot = {
        tick: this.world.tick,
        score: this.world.score,
        localEntityId: player.shipId,
        lastProcessedSeq: player.lastProcessedSeq,
        randomState: this.world.randomState,
        nextEntityId: this.world.nextEntityId,
        entities: this.world.entities,
      };
      if (Math.random() < this.network.networkDropRate) continue;
      const data =
        this.network.snapshotFormat === "binary"
          ? encodeSnapshot(snapshot)
          : JSON.stringify({ type: "snapshot", snapshot });
      const delay = Math.max(
        0,
        this.network.networkLatencyMs +
          (Math.random() * 2 - 1) * this.network.networkJitterMs,
      );
      const send = (): void => {
        if (
          player.socket.readyState !== player.socket.OPEN ||
          player.socket.bufferedAmount > 64 * 1024
        )
          return;
        if (typeof data === "string") {
          player.socket.send(data, { binary: false }, (error) => {
            if (error) this.emit("error", error);
          });
          this.emit("traffic", Buffer.byteLength(data));
        } else {
          player.socket.send(data, { binary: true }, (error) => {
            if (error) this.emit("error", error);
          });
          this.emit("traffic", data.byteLength);
        }
      };
      if (delay > 0) setTimeout(send, delay);
      else send();
    }
  }

  private start(): void {
    this.targetAt = performance.now() + 1000 / 30;
    const schedule = (): void => {
      if (!this.players.size) {
        this.timer = undefined;
        return;
      }
      const delay = Math.max(0, this.targetAt - performance.now());
      this.timer = setTimeout(() => {
        const startedAt = performance.now();
        this.targetAt += 1000 / 30;
        const commands = new Map<string, InputCommand>();
        for (const player of this.players.values()) {
          const next = player.pendingInputs.shift();
          if (next) {
            player.latestInput = next;
            player.lastProcessedSeq = next.seq;
          }
          if (player.latestInput) commands.set(player.id, player.latestInput);
        }
        const events = stepWorld(this.world, commands, FIXED_DT);
        for (const event of events)
          this.emit("event", { t: this.world.tick, ...event });
        this.tickDurationMs = performance.now() - startedAt;
        this.tickDurations.push(this.tickDurationMs);
        if (this.tickDurations.length > 1200) this.tickDurations.shift();
        this.broadcastSnapshots();
        if (this.targetAt < performance.now() - 1000 / 30)
          this.targetAt = performance.now() + 1000 / 30;
        schedule();
      }, delay);
    };
    schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

export class RoomManager extends EventEmitter {
  private readonly rooms = new Map<string, Room>();
  private readonly definitions = new Map(
    ARENAS.map((arena) => [arena.id, arena]),
  );

  constructor(
    private readonly config: ServerConfig,
    private readonly logger: Logger,
  ) {
    super();
  }

  list(): Array<ArenaConfig & { players: number; running: boolean }> {
    return [...this.definitions.values()].map((arena) => {
      const room = this.rooms.get(arena.id);
      return {
        ...arena,
        maxPlayers: Math.min(arena.maxPlayers, this.config.maxPlayersPerRoom),
        players: room?.players.size ?? 0,
        running: room?.running ?? false,
      };
    });
  }

  getOrCreate(id: string): Room {
    const existing = this.rooms.get(id);
    if (existing) return existing;
    const arena = this.definitions.get(id);
    if (!arena) throw new Error("unknown room");
    if (this.rooms.size >= this.config.maxRooms)
      throw new Error("room limit reached");
    const room = new Room(
      arena,
      this.config.maxPlayersPerRoom,
      this.logger,
      this.config,
    );
    room.once("empty", () => {
      this.rooms.delete(id);
      this.emit("changed");
    });
    room.on("changed", () => this.emit("changed"));
    this.rooms.set(id, room);
    this.emit("changed");
    return room;
  }

  create(arena: ArenaConfig): ArenaConfig {
    if (this.definitions.has(arena.id))
      throw new Error("room id already exists");
    if (this.definitions.size >= this.config.maxRooms)
      throw new Error("room limit reached");
    this.definitions.set(arena.id, arena);
    this.emit("changed");
    return arena;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }
  get roomCount(): number {
    return this.rooms.size;
  }
  get playerCount(): number {
    let count = 0;
    for (const room of this.rooms.values()) count += room.players.size;
    return count;
  }
  closeAll(): void {
    for (const room of this.rooms.values()) room.stop();
  }
  allRooms(): IterableIterator<Room> {
    return this.rooms.values();
  }
}
