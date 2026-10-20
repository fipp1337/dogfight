import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/assets",
);
await mkdir(directory, { recursive: true });

function wav({ startHz, endHz, duration, volume }) {
  const sampleRate = 22050;
  const sampleCount = Math.floor(sampleRate * duration);
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + sampleCount * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);
  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / sampleRate;
    const progress = i / sampleCount;
    const frequency = startHz + (endHz - startHz) * progress;
    const envelope = Math.min(1, i / 120) * Math.pow(1 - progress, 2);
    buffer.writeInt16LE(
      Math.round(
        Math.sin(2 * Math.PI * frequency * t) * volume * envelope * 32767,
      ),
      44 + i * 2,
    );
  }
  return buffer;
}

await Promise.all([
  writeFile(
    path.join(directory, "fired.wav"),
    wav({ startHz: 700, endHz: 150, duration: 0.11, volume: 0.32 }),
  ),
  writeFile(
    path.join(directory, "hit.wav"),
    wav({ startHz: 280, endHz: 90, duration: 0.16, volume: 0.28 }),
  ),
  writeFile(
    path.join(directory, "exploded.wav"),
    wav({ startHz: 180, endHz: 42, duration: 0.42, volume: 0.38 }),
  ),
]);
