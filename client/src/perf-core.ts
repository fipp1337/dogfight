import {
  addPlayer,
  asSeq,
  asTick,
  createWorld,
  FIXED_DT,
  stepWorld,
  type InputCommand,
} from "@dogfight/shared";

export interface SimulationBenchmark {
  bots: number;
  steps: number;
  simulatedSeconds: number;
  tickMs: { p50: number; p95: number; p99: number; max: number };
}

export function runSimulationBenchmark(): SimulationBenchmark {
  const world = createWorld({
    id: "browser-perf",
    name: "Browser performance experiment",
    width: 1200,
    height: 760,
    seed: 1701,
    maxPlayers: 8,
  });
  const players = Array.from({ length: 8 }, (_, index) =>
    addPlayer(world, `bot-${index}`, `Bot ${index + 1}`),
  );
  const durations: number[] = [];

  for (let tick = 1; tick <= 900; tick += 1) {
    const commands = new Map<string, InputCommand>();
    for (const [index, player] of players.entries()) {
      const rawTurn = ((Math.floor(tick / (index + 3)) + index) % 3) - 1;
      const turn: -1 | 0 | 1 = rawTurn === -1 ? -1 : rawTurn === 1 ? 1 : 0;
      commands.set(player.playerId, {
        seq: asSeq(tick),
        tick: asTick(world.tick),
        turn,
        thrust: (tick + index * 7) % 5 !== 0,
        fire: (tick + index * 11) % 18 === 0,
      });
    }
    const startedAt = performance.now();
    stepWorld(world, commands, FIXED_DT);
    durations.push(performance.now() - startedAt);
  }

  durations.sort((left, right) => left - right);
  const percentile = (fraction: number): number =>
    durations[
      Math.min(durations.length - 1, Math.floor(durations.length * fraction))
    ] ?? 0;
  return {
    bots: players.length,
    steps: durations.length,
    simulatedSeconds: durations.length / 30,
    tickMs: {
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
      max: durations.at(-1) ?? 0,
    },
  };
}
