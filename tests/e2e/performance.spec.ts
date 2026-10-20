import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";

const simulationSchema = z.object({
  bots: z.number().int().positive(),
  steps: z.number().int().positive(),
  simulatedSeconds: z.number().positive(),
  tickMs: z.object({
    p50: z.number().nonnegative(),
    p95: z.number().nonnegative(),
    p99: z.number().nonnegative(),
    max: z.number().nonnegative(),
  }),
  wallMs: z.number().nonnegative(),
  maxFrameGapMs: z.number().nonnegative(),
  workerExecutionMs: z.number().nonnegative().optional(),
});

const reportSchema = z.object({
  mainThread: simulationSchema,
  worker: simulationSchema,
  conclusion: z.string(),
});

test("compare eight-bot simulation on main thread and Web Worker", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await page.goto("/perf.html");
  await page.getByRole("button", { name: "Run benchmark" }).click();
  await expect(page.locator("#result")).not.toContainText(
    "Benchmark running…",
    {
      timeout: 20_000,
    },
  );
  const report = reportSchema.parse(
    JSON.parse(await page.locator("#result").innerText()),
  );
  expect(report.mainThread.maxFrameGapMs).toBeGreaterThan(0);
  expect(report.worker.maxFrameGapMs).toBeGreaterThan(0);
  await mkdir("reports", { recursive: true });
  await writeFile(
    "reports/browser-performance.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await page.screenshot({ path: "reports/browser-performance.png" });
});
