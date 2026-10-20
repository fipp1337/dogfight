import {
  Lobby,
  LobbyStatusEvent,
  RoomsUpdatedEvent,
  type LobbyRoom,
} from "./lobby.js";

export interface LobbyView {
  destroy(): void;
}

function requireChild<T extends Element>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Lobby markup is missing ${selector}.`);
  return element;
}

export function mountLobby(
  lobby: Lobby,
  root: HTMLElement,
  onJoin: (room: LobbyRoom, name: string) => void,
): LobbyView {
  root.replaceChildren();
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.innerHTML = `<h1>Dogfight</h1><p>Оберіть кімнату та ім’я пілота. Гра працює на авторитетному сервері.</p><label for="pilot-name">Ім’я</label><input id="pilot-name" maxlength="20" value="Pilot" autocomplete="nickname"><label for="room-select">Кімната</label><select id="room-select"></select><p class="room-meta" id="room-meta">Оновлення списку кожні 3 с</p><p class="status" id="lobby-status"></p><button id="join-button">Приєднатися</button><button class="secondary" id="refresh-button">Оновити кімнати</button>`;
  root.append(panel);
  const roomSelect = requireChild<HTMLSelectElement>(panel, "#room-select");
  const nameInput = requireChild<HTMLInputElement>(panel, "#pilot-name");
  const status = panel.querySelector<HTMLElement>("#lobby-status");
  const meta = panel.querySelector<HTMLElement>("#room-meta");
  const joinButton = panel.querySelector<HTMLButtonElement>("#join-button");
  const renderRooms = (rooms: readonly LobbyRoom[]): void => {
    const selected = roomSelect.value;
    roomSelect.replaceChildren();
    for (const room of rooms) {
      const option = document.createElement("option");
      option.value = room.id;
      option.textContent = `${room.name} · ${room.players}/${room.maxPlayers}${room.running ? " · у грі" : ""}`;
      option.disabled = room.players >= room.maxPlayers;
      roomSelect.append(option);
    }
    if (rooms.some((room) => room.id === selected)) roomSelect.value = selected;
    const current = rooms.find((room) => room.id === roomSelect.value);
    if (meta)
      meta.textContent = current
        ? `${current.width} × ${current.height} · ${current.players} пілотів у кімнаті`
        : "Немає доступних кімнат";
    if (joinButton)
      joinButton.disabled = !rooms.some(
        (room) =>
          room.id === roomSelect.value && room.players < room.maxPlayers,
      );
  };
  const onRooms = (event: Event): void => {
    if (event instanceof RoomsUpdatedEvent) renderRooms(event.rooms);
  };
  const onStatus = (event: Event): void => {
    if (event instanceof LobbyStatusEvent && status)
      status.textContent = event.message;
  };
  lobby.addEventListener("rooms", onRooms);
  lobby.addEventListener("status", onStatus);
  panel
    .querySelector<HTMLButtonElement>("#refresh-button")
    ?.addEventListener("click", () => {
      void lobby.refresh();
    });
  joinButton?.addEventListener("click", () => {
    const room = lobby.rooms.find(
      (candidate) => candidate.id === roomSelect.value,
    );
    if (!room) return;
    const name = (nameInput.value || "Pilot").trim().slice(0, 20);
    lobby.join(room.id, name);
    onJoin(room, name);
  });
  void lobby.show();
  return {
    destroy() {
      lobby.removeEventListener("rooms", onRooms);
      lobby.removeEventListener("status", onStatus);
      root.replaceChildren();
    },
  };
}

export interface GamePanel {
  showStatus(message: string): void;
  addChat(name: string, text: string): void;
  getInterpolationDelay(): number;
  destroy(): void;
}
export function mountGamePanel(
  root: HTMLElement,
  onChat: (text: string) => void,
  onLeave: () => void,
): GamePanel {
  root.replaceChildren();
  root.classList.add("overlay", "overlay-transparent");
  const panel = document.createElement("section");
  panel.className = "panel game-panel";
  panel.innerHTML = `<h2>Пілот готовий</h2><p class="status" id="game-status">Підключення…</p><label for="interp-delay">Інтерполяція чужих кораблів <span id="interp-value">100</span> мс</label><input id="interp-delay" type="range" min="50" max="250" step="10" value="100"><button id="leave-button" class="secondary">До лобі</button><div class="chat" id="chat-list" aria-live="polite"></div><form id="chat-form"><input id="chat-input" maxlength="240" placeholder="Повідомлення"><button type="submit">Надіслати</button></form>`;
  root.append(panel);
  const form = panel.querySelector<HTMLFormElement>("#chat-form");
  const input = panel.querySelector<HTMLInputElement>("#chat-input");
  const list = panel.querySelector<HTMLElement>("#chat-list");
  const delayInput = panel.querySelector<HTMLInputElement>("#interp-delay");
  const delayLabel = panel.querySelector<HTMLElement>("#interp-value");
  delayInput?.addEventListener("input", () => {
    if (delayLabel && delayInput) delayLabel.textContent = delayInput.value;
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input?.value.trim();
    if (text) onChat(text);
    if (input) input.value = "";
  });
  panel
    .querySelector<HTMLButtonElement>("#leave-button")
    ?.addEventListener("click", onLeave);
  return {
    showStatus(message) {
      const element = panel.querySelector<HTMLElement>("#game-status");
      if (element) element.textContent = message;
    },
    addChat(name, text) {
      if (!list) return;
      const row = document.createElement("p");
      row.textContent = `${name}: ${text}`;
      list.append(row);
      while (list.childElementCount > 20) list.firstElementChild?.remove();
      list.scrollTop = list.scrollHeight;
    },
    getInterpolationDelay() {
      return Number(delayInput?.value ?? 100);
    },
    destroy() {
      root.classList.remove("overlay", "overlay-transparent");
      root.replaceChildren();
    },
  };
}
