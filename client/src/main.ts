import {
  asSeq,
  asTick,
  cloneWorld,
  createWorld,
  FIXED_DT,
  stepWorld,
  type ArenaConfig,
  type GameSnapshot,
  type InputCommand,
  type WorldState,
} from "@dogfight/shared";
import { GameAudio, GameEventBus } from "./audio.js";
import { loadAll, loadManifest, type LoadedAssets } from "./assets/loader.js";
import { mountGamePanel, mountLobby } from "./lobby-view.js";
import { Lobby, type LobbyRoom } from "./lobby.js";
import { GameConnection, type ConnectionState } from "./net/connection.js";
import {
  applySnapshot,
  sampleRemote,
  type Pose,
  type TimedSnapshot,
} from "./net/netcode.js";
import { createLoop, type Loop, type LoopStats } from "./loop.js";
import { createInput } from "./input.js";
import { drawLoading, drawWorld } from "./render/draw.js";
import { setupCanvas } from "./render/canvas.js";
import { z } from "zod";
import "./style.css";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Game shell is missing ${selector}.`);
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#game");
const overlay = requireElement<HTMLElement>("#overlay");
const arenaPresentationSchema = z.object({
  background: z.string().startsWith("#"),
  gridSize: z.number().int().positive(),
  fixedStep: z.number().positive(),
});
const screen = setupCanvas(canvas);
const input = createInput(window);
const eventBus = new GameEventBus();
const audio = new GameAudio(eventBus);
const lobby = new Lobby();
const params = new URLSearchParams(window.location.search);
const failureDemo = params.get("failure");
const connection = new GameConnection(
  params.get("codec") === "json" ? "json" : "binary",
);

let assets: LoadedAssets | undefined;
let arena: ArenaConfig | undefined;
let world: WorldState | undefined;
let loop: Loop | undefined;
let gamePanel: ReturnType<typeof mountGamePanel> | undefined;
let lobbyView: ReturnType<typeof mountLobby> | undefined;
let localPlayerId = "";
let localPlayerName = "Pilot";
let localEntityId = 0;
let inputSequence = 0;
let pendingInputs: InputCommand[] = [];
let snapshotBuffer: TimedSnapshot[] = [];
let roster: Array<{ id: string; name: string; entityId: number }> = [];
let correctionOffset: Pose = { x: 0, y: 0, angle: 0 };
const localPreviousPose: Pose = { x: 0, y: 0, angle: 0 };
let lastRenderAt = performance.now();
let latestCorrection = 0;
let lastRtt = 0;
let pingAt = 0;
let lastPingSentAt = 0;
let bytesAt = performance.now();
let sentBytesAt = 0;
let receivedBytesAt = 0;
let trafficRate = 0;
let stats: LoopStats = { stepsPerSecond: 30, framesPerSecond: 0, frameMs: 0 };
let audioContext: AudioContext | undefined;
let loadController: AbortController | undefined;

function showLoading(message: string, percent = 0): void {
  drawLoading(screen.context, screen.width, screen.height, {
    percent,
    label: message,
  });
}

function showLoadError(message: string): void {
  overlay.classList.remove("overlay-transparent");
  overlay.innerHTML = "";
  const panel = document.createElement("section");
  panel.className = "panel";
  const title = document.createElement("h1");
  title.textContent = "Не вдалося підготувати гру";
  const detail = document.createElement("p");
  detail.textContent = message;
  const retry = document.createElement("button");
  retry.textContent = "Спробувати ще раз";
  retry.addEventListener("click", () => {
    history.replaceState(null, "", location.pathname);
    location.reload();
  });
  panel.append(title, detail, retry);
  overlay.append(panel);
}

async function startLoading(): Promise<void> {
  overlay.replaceChildren();
  overlay.classList.add("overlay-transparent");
  const status = document.createElement("p");
  status.className = "status";
  status.textContent = "Завантажуємо спрайти, звук і конфігурацію арени…";
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.append(status);
  overlay.append(panel);
  loadController = new AbortController();
  const controller = loadController;
  try {
    audioContext ??= audio.unlockFromGesture();
    const manifest = await loadManifest(
      "/assets/manifest.json",
      controller.signal,
    );
    if (failureDemo === "404") {
      const ship = manifest.sprites.find((asset) => asset.id === "ship");
      if (ship) ship.url = "/assets/missing-ship-sheet.svg";
    } else if (failureDemo === "timeout") {
      const arenaJson = manifest.data.find((asset) => asset.id === "arena");
      if (arenaJson) arenaJson.url = "/assets/slow.json";
    } else if (failureDemo === "json") {
      const arenaJson = manifest.data.find((asset) => asset.id === "arena");
      if (arenaJson) arenaJson.url = "/assets/broken.json";
    } else if (failureDemo === "abort") {
      const arenaJson = manifest.data.find((asset) => asset.id === "arena");
      if (arenaJson) arenaJson.url = "/assets/slow.json";
      window.setTimeout(
        () =>
          controller.abort(
            new DOMException(
              "Failure demo aborted the asset load",
              "AbortError",
            ),
          ),
        180,
      );
    }
    const loaded = await loadAll(manifest, {
      audioContext: audioContext,
      signal: controller.signal,
      onProgress: (progress) => {
        showLoading(
          `${progress.id}: ${progress.status} (${progress.completed}/${progress.total})`,
          progress.completed / progress.total,
        );
      },
    });
    assets = loaded;
    audio.setAssets(loaded);
    const parsedArena = arenaPresentationSchema.safeParse(
      loaded.json.get("arena"),
    );
    if (!parsedArena.success)
      throw new Error("The arena configuration is invalid.");
    if (Math.abs(parsedArena.data.fixedStep - FIXED_DT) > 1e-9)
      throw new Error("Arena and simulation fixed steps do not match.");
    canvas.style.backgroundColor = parsedArena.data.background;
    canvas.dataset.gridSize = String(parsedArena.data.gridSize);
    showLobby();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    showLoadError(
      `${message}${failureDemo ? ` (демо збою: ${failureDemo})` : ""}`,
    );
  }
}

function showLobby(): void {
  overlay.classList.remove("overlay-transparent");
  lobbyView?.destroy();
  lobbyView = mountLobby(lobby, overlay, (room, name) => joinGame(room, name));
  void navigator.serviceWorker?.register("/sw.js").catch(() => undefined);
}

function joinGame(room: LobbyRoom, name: string): void {
  lobbyView?.destroy();
  lobbyView = undefined;
  localPlayerName = name;
  arena = {
    id: room.id,
    name: room.name,
    width: room.width,
    height: room.height,
    seed: room.seed,
    maxPlayers: room.maxPlayers,
  };
  gamePanel = mountGamePanel(
    overlay,
    (text) => connection.send({ type: "chat", text }),
    returnToLobby,
  );
  gamePanel.showStatus("Приєднуємося до кімнати…");
  connection.onStatus = (message) => gamePanel?.showStatus(message);
  connection.onConnectionState = (state: ConnectionState) => {
    if (state === "reconnecting") {
      gamePanel?.showStatus("Зв’язок відновлюється; чекаємо новий знімок…");
      world = undefined;
      localPlayerId = "";
      localEntityId = 0;
      pendingInputs = [];
      snapshotBuffer = [];
      roster = [];
      inputSequence = 0;
      pingAt = 0;
      lastPingSentAt = 0;
    } else if (state === "open" && world)
      gamePanel?.showStatus(
        "З’єднано · стрілки рухають корабель, Space стріляє",
      );
  };
  connection.onServerMessage = (message) => {
    if (message.type === "joined") {
      localPlayerId = message.playerId;
      localEntityId = message.entityId;
      gamePanel?.showStatus("Отримуємо авторитетний знімок стану…");
    } else if (message.type === "roster") {
      roster = message.players;
      gamePanel?.showStatus(
        `У кімнаті: ${roster.map((player) => player.name).join(", ")}`,
      );
    } else if (message.type === "chat")
      gamePanel?.addChat(message.name, message.text);
    else if (message.type === "pong") {
      lastRtt = performance.now() - message.at;
      pingAt = 0;
    } else if (message.type === "error") gamePanel?.showStatus(message.message);
    else if (message.type === "shutdown")
      gamePanel?.showStatus(
        "Сервер перезапускається; буде повторне з’єднання.",
      );
  };
  connection.onSnapshot = receiveSnapshot;
  connection.join(room.id, name);
}

function receiveSnapshot(snapshot: GameSnapshot): void {
  if (!arena || !localPlayerId) return;
  const prior = world ? cloneWorld(world) : createWorld(arena);
  const reconciled = applySnapshot(
    snapshot,
    arena,
    localPlayerId,
    localPlayerName,
    roster,
    pendingInputs,
    prior,
  );
  world = reconciled.world;
  pendingInputs = reconciled.pending;
  localEntityId = snapshot.localEntityId;
  const oldLocal = prior.entities.find(
    (entity) => entity.id === localEntityId && entity.kind === "ship",
  );
  const correctedLocal = world.entities.find(
    (entity) => entity.id === localEntityId && entity.kind === "ship",
  );
  if (oldLocal?.kind === "ship" && correctedLocal?.kind === "ship") {
    correctionOffset = {
      x: oldLocal.x - correctedLocal.x,
      y: oldLocal.y - correctedLocal.y,
      angle: 0,
    };
  }
  latestCorrection = reconciled.correction;
  snapshotBuffer.push({ receivedAt: performance.now(), snapshot });
  if (snapshotBuffer.length > 12)
    snapshotBuffer.splice(0, snapshotBuffer.length - 12);
  if (!loop && assets) {
    if (correctedLocal?.kind === "ship") {
      localPreviousPose.x = correctedLocal.x;
      localPreviousPose.y = correctedLocal.y;
      localPreviousPose.angle = correctedLocal.angle;
    }
    gamePanel?.showStatus("З’єднано · стрілки рухають корабель, Space стріляє");
    loop = createLoop({ step: FIXED_DT, simulate: simulate, render: render });
    loop.start();
  }
}

function simulate(dt: number): void {
  const current = world;
  if (!current || !localPlayerId) return;
  const localBeforeStep = current.entities.find(
    (entity) => entity.id === localEntityId && entity.kind === "ship",
  );
  if (localBeforeStep?.kind === "ship") {
    localPreviousPose.x = localBeforeStep.x;
    localPreviousPose.y = localBeforeStep.y;
    localPreviousPose.angle = localBeforeStep.angle;
  }
  const turn: -1 | 0 | 1 = input.isDown("ArrowRight")
    ? 1
    : input.isDown("ArrowLeft")
      ? -1
      : 0;
  const command: InputCommand = {
    seq: asSeq(++inputSequence),
    tick: asTick(current.tick),
    turn,
    thrust: input.isDown("ArrowUp"),
    fire: input.isDown("Space"),
  };
  pendingInputs.push(command);
  if (pendingInputs.length > 120) pendingInputs.shift();
  connection.send({
    type: "input",
    seq: command.seq,
    tick: command.tick,
    turn: command.turn,
    thrust: command.thrust,
    fire: command.fire,
  });
  for (const event of stepWorld(
    current,
    new Map([[localPlayerId, command]]),
    dt,
  ))
    eventBus.emit(event);
  if (input.justPressed("KeyR")) returnToLobby();
  input.endStep();
  const pingNow = performance.now();
  if (pingAt > 0 && pingNow - pingAt > 2000) pingAt = 0;
  if (pingAt === 0 && pingNow - lastPingSentAt >= 1000) {
    pingAt = pingNow;
    lastPingSentAt = pingNow;
    connection.send({ type: "ping", at: pingAt });
  }
}

function render(alpha: number, currentStats: LoopStats): void {
  stats = currentStats;
  const now = performance.now();
  const elapsed = now - lastRenderAt;
  lastRenderAt = now;
  const decay = Math.exp(-elapsed / 100);
  correctionOffset = {
    ...correctionOffset,
    x: correctionOffset.x * decay,
    y: correctionOffset.y * decay,
  };
  const elapsedForTraffic = now - bytesAt;
  if (elapsedForTraffic >= 1000) {
    trafficRate =
      ((connection.bytesSent -
        sentBytesAt +
        (connection.bytesReceived - receivedBytesAt)) *
        1000) /
      elapsedForTraffic;
    sentBytesAt = connection.bytesSent;
    receivedBytesAt = connection.bytesReceived;
    bytesAt = now;
  }
  const current = world;
  const loaded = assets;
  if (!current || !loaded) {
    showLoading("Очікуємо перший знімок…", 1);
    return;
  }
  const context = screen.context;
  context.save();
  const scale = Math.min(
    screen.width / current.width,
    screen.height / current.height,
  );
  context.translate(
    (screen.width - current.width * scale) / 2,
    (screen.height - current.height * scale) / 2,
  );
  context.scale(scale, scale);
  const poses = sampleRemote(
    snapshotBuffer,
    now,
    gamePanel?.getInterpolationDelay() ?? 100,
  );
  const local = current.entities.find((entity) => entity.id === localEntityId);
  if (local?.kind === "ship")
    poses.set(local.id, {
      x:
        localPreviousPose.x +
        (local.x - localPreviousPose.x) * alpha +
        correctionOffset.x,
      y:
        localPreviousPose.y +
        (local.y - localPreviousPose.y) * alpha +
        correctionOffset.y,
      angle: interpolateAngle(localPreviousPose.angle, local.angle, alpha),
    });
  drawWorld(
    context,
    current,
    alpha,
    stats,
    loaded,
    localEntityId,
    poses,
    {
      rttMs: lastRtt,
      correction: latestCorrection,
      interpolationDelayMs: gamePanel?.getInterpolationDelay() ?? 100,
      pendingInputs: pendingInputs.length,
      snapshotAgeMs: connection.snapshotAgeMs,
      bytesPerSecond: trafficRate,
    },
    "lab-08",
    Number(canvas.dataset.gridSize ?? 40),
  );
  context.restore();
}

function interpolateAngle(start: number, end: number, alpha: number): number {
  const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  return start + delta * alpha;
}

function returnToLobby(): void {
  loop?.stop();
  loop = undefined;
  connection.stop();
  gamePanel?.destroy();
  gamePanel = undefined;
  world = undefined;
  arena = undefined;
  localPlayerId = "";
  localEntityId = 0;
  pendingInputs = [];
  snapshotBuffer = [];
  roster = [];
  inputSequence = 0;
  pingAt = 0;
  lastPingSentAt = 0;
  lobbyView?.destroy();
  lobbyView = undefined;
  showLobby();
}

window.addEventListener("resize", () => {
  if (world && assets) render(0, stats);
});
overlay.innerHTML = `<section class="panel"><h1>Dogfight</h1><p>Спочатку підготуємо спрайти та звук. Аудіо активується вашим натисканням.</p><button id="start-button">Увійти до лобі</button></section>`;
overlay.querySelector<HTMLButtonElement>("#start-button")?.addEventListener(
  "click",
  () => {
    void startLoading();
  },
  { once: true },
);
showLoading("Натисніть кнопку, щоб почати", 0);
