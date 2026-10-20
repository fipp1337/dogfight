import type { SimEvent } from "@dogfight/shared";
import type { LoadedAssets } from "./assets/loader.js";

export class GameEventBus extends EventTarget {
  emit(event: SimEvent): void {
    this.dispatchEvent(new CustomEvent(event.type, { detail: event }));
  }
}

export class GameAudio {
  private context: AudioContext | undefined;
  private readonly buffers = new Map<string, AudioBuffer>();
  private enabled = true;

  constructor(private readonly bus: GameEventBus) {
    const eventNames: Array<SimEvent["type"]> = ["fired", "hit", "exploded"];
    for (const name of eventNames) {
      this.bus.addEventListener(name, () => this.play(name));
    }
  }

  unlockFromGesture(): AudioContext {
    this.context ??= new AudioContext();
    void this.context.resume();
    return this.context;
  }

  setAssets(assets: LoadedAssets): void {
    for (const [name, buffer] of assets.audio) this.buffers.set(name, buffer);
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  private play(name: string): void {
    const context = this.context;
    const buffer = this.buffers.get(name);
    if (!this.enabled || !context || !buffer || context.state !== "running")
      return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = name === "fired" ? 0.28 : 0.4;
    source.connect(gain).connect(context.destination);
    source.start();
  }
}
