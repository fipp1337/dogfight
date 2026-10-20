import { z } from "zod";

const fileSchema = z.object({
  id: z.string(),
  url: z.string(),
  required: z.boolean().default(true),
});
const manifestSchema = z.object({
  sprites: z.array(
    fileSchema.extend({
      frameWidth: z.number().positive(),
      frameHeight: z.number().positive(),
    }),
  ),
  sounds: z.array(fileSchema),
  data: z.array(fileSchema),
});
export type AssetManifest = z.infer<typeof manifestSchema>;
export interface AssetProgress {
  id: string;
  completed: number;
  total: number;
  status: "loaded" | "failed";
}
export interface LoadedAssets {
  images: Map<
    string,
    { image: HTMLImageElement; frameWidth: number; frameHeight: number }
  >;
  audio: Map<string, AudioBuffer>;
  json: Map<string, unknown>;
  failures: Array<{ id: string; error: Error }>;
}
type AssetItem =
  | ({ kind: "image" } & AssetManifest["sprites"][number])
  | ({ kind: "audio" } & AssetManifest["sounds"][number])
  | ({ kind: "json" } & AssetManifest["data"][number]);

export class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} while loading ${url}`);
    this.name = "HttpError";
  }
}

export async function fetchJson(
  url: string,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new HttpError(response.status, url);
  const value: unknown = await response.json();
  return value;
}

export async function loadJson(
  url: string,
  signal: AbortSignal,
): Promise<unknown> {
  return fetchJson(url, signal);
}

export async function loadManifest(
  url: string,
  signal: AbortSignal,
): Promise<AssetManifest> {
  const result = manifestSchema.safeParse(await fetchJson(url, signal));
  if (!result.success)
    throw new Error(
      `Invalid asset manifest: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  return result.data;
}

export async function loadImage(
  url: string,
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  if (signal.aborted)
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const response = await fetch(url, { signal });
  if (!response.ok) throw new HttpError(response.status, url);
  const objectUrl = URL.createObjectURL(await response.blob());
  const image = new Image();
  return new Promise((resolve, reject) => {
    const clean = (): void => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", onAbort);
      URL.revokeObjectURL(objectUrl);
    };
    const onAbort = (): void => {
      clean();
      image.src = "";
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    image.onload = () => {
      clean();
      resolve(image);
    };
    image.onerror = () => {
      clean();
      reject(new Error(`Image decoding failed: ${url}`));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    image.src = objectUrl;
  });
}

export async function loadAudio(
  context: AudioContext,
  url: string,
  signal: AbortSignal,
): Promise<AudioBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new HttpError(response.status, url);
  return context.decodeAudioData(await response.arrayBuffer());
}

export async function withRetry<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: { attempts?: number; baseMs?: number; signal: AbortSignal },
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseMs = options.baseMs ?? 180;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.signal.aborted)
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    try {
      return await operation(options.signal);
    } catch (error) {
      lastError = error;
      if (
        options.signal.aborted ||
        isAbort(error) ||
        (error instanceof HttpError &&
          error.status >= 400 &&
          error.status < 500) ||
        attempt === attempts - 1
      )
        throw error;
      await delay(
        baseMs * 2 ** attempt * (0.75 + Math.random() * 0.5),
        options.signal,
      );
    }
  }
  throw lastError;
}

export async function loadAll(
  manifest: AssetManifest,
  options: {
    audioContext: AudioContext;
    signal: AbortSignal;
    onProgress: (progress: AssetProgress) => void;
    attempts?: number;
  },
): Promise<LoadedAssets> {
  const images = new Map<
    string,
    { image: HTMLImageElement; frameWidth: number; frameHeight: number }
  >();
  const audio = new Map<string, AudioBuffer>();
  const json = new Map<string, unknown>();
  const failures: Array<{ id: string; error: Error }> = [];
  const items: AssetItem[] = [
    ...manifest.sprites.map((entry): AssetItem => ({
      ...entry,
      kind: "image",
    })),
    ...manifest.sounds.map((entry): AssetItem => ({ ...entry, kind: "audio" })),
    ...manifest.data.map((entry): AssetItem => ({ ...entry, kind: "json" })),
  ];
  let completed = 0;
  const batchController = new AbortController();
  const promises = items.map(async (item) => {
    try {
      const signal = AbortSignal.any([
        options.signal,
        batchController.signal,
        AbortSignal.timeout(8000),
      ]);
      const value = await withRetry(
        (attemptSignal) => {
          if (item.kind === "image") return loadImage(item.url, attemptSignal);
          if (item.kind === "audio")
            return loadAudio(options.audioContext, item.url, attemptSignal);
          return loadJson(item.url, attemptSignal);
        },
        { attempts: options.attempts ?? 3, signal },
      );
      if (item.kind === "image" && value instanceof HTMLImageElement)
        images.set(item.id, {
          image: value,
          frameWidth: item.frameWidth,
          frameHeight: item.frameHeight,
        });
      else if (item.kind === "audio" && value instanceof AudioBuffer)
        audio.set(item.id, value);
      else if (item.kind === "json") json.set(item.id, value);
      completed += 1;
      options.onProgress({
        id: item.id,
        completed,
        total: items.length,
        status: "loaded",
      });
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      completed += 1;
      options.onProgress({
        id: item.id,
        completed,
        total: items.length,
        status: "failed",
      });
      if (options.signal.aborted || item.required) {
        batchController.abort(error);
        throw error;
      }
      failures.push({ id: item.id, error });
    }
  });
  await Promise.all(promises);
  return { images, audio, json, failures };
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      window.clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
