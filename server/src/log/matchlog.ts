import { on } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import type { Logger } from "pino";
import type { Room } from "../rooms.js";

export interface RoomLogHandle {
  id: string;
  path: string;
  close(): Promise<void>;
}

export async function startRoomLog(
  room: Room,
  directory: string,
  logger: Logger,
): Promise<RoomLogHandle> {
  await mkdir(directory, { recursive: true });
  const id = `${room.id}-${Date.now()}`;
  const filePath = path.join(directory, `${id}.ndjson`);
  const abort = new AbortController();
  const events = on(room, "event", { signal: abort.signal });
  const source = Readable.from(events, { objectMode: true, highWaterMark: 16 });
  const ndjson = new Transform({
    writableObjectMode: true,
    transform(chunk: unknown, _encoding, callback) {
      const event = Array.isArray(chunk) ? chunk[0] : chunk;
      callback(null, `${JSON.stringify(event)}\n`);
    },
  });
  const sink = createWriteStream(filePath, { flags: "a" });
  const completion = pipeline(source, ndjson, sink, {
    signal: abort.signal,
  }).catch((error: unknown) => {
    if (!(error instanceof Error && error.name === "AbortError"))
      logger.error(
        { err: error, roomId: room.id },
        "match log pipeline failed",
      );
  });
  return {
    id,
    path: filePath,
    async close() {
      abort.abort();
      await completion;
    },
  };
}

export async function* readNdjson(filePath: string): AsyncGenerator<unknown> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  let carry = "";
  for await (const chunk of stream) {
    carry += chunk;
    let newline = carry.indexOf("\n");
    while (newline >= 0) {
      const line = carry.slice(0, newline);
      carry = carry.slice(newline + 1);
      if (line) {
        const event: unknown = JSON.parse(line);
        yield event;
      }
      newline = carry.indexOf("\n");
    }
  }
  if (carry.trim()) {
    const event: unknown = JSON.parse(carry);
    yield event;
  }
}
