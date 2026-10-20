import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";
import gifenc from "gifenc";

async function enterLobby(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Увійти до лобі" }).click();
  await expect(page.locator("#room-select option").first()).toBeAttached({
    timeout: 10_000,
  });
}

test("two browser clients join, receive a server snapshot, and exchange chat", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const firstContext = await browser.newContext({
    viewport: { width: 800, height: 450 },
  });
  const secondContext = await browser.newContext({
    viewport: { width: 800, height: 450 },
  });
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  await enterLobby(first);
  await first.locator("#pilot-name").fill("Nova");
  await first.getByRole("button", { name: "Приєднатися" }).click();
  await expect(first.locator("#chat-input")).toBeVisible();

  await enterLobby(second);
  await second.locator("#pilot-name").fill("Comet");
  await second.getByRole("button", { name: "Приєднатися" }).click();
  await expect(second.locator("#chat-input")).toBeVisible();

  await first.locator("#chat-input").fill("hello from Nova");
  await first.locator("#chat-input").press("Enter");
  await expect(second.getByText("Nova: hello from Nova")).toBeVisible({
    timeout: 5_000,
  });
  await first.keyboard.down("ArrowUp");
  await first.keyboard.down("ArrowLeft");
  await first.keyboard.down("Space");
  await second.keyboard.down("ArrowUp");
  await second.keyboard.down("ArrowRight");
  await second.keyboard.down("Space");
  const { GIFEncoder, quantize, applyPalette } = gifenc;
  const gif = GIFEncoder();
  const width = 1600;
  const height = 450;
  let palette: Uint8Array | undefined;
  for (let frame = 0; frame < 50; frame += 1) {
    const [leftShot, rightShot] = await Promise.all([
      first.screenshot({ animations: "disabled" }),
      second.screenshot({ animations: "disabled" }),
    ]);
    const left = PNG.sync.read(leftShot);
    const right = PNG.sync.read(rightShot);
    const combined = new Uint8Array(width * height * 4);
    combined.set(left.data, 0);
    for (let row = 0; row < height; row += 1) {
      combined.set(
        right.data.subarray(
          ((row * width) / 2) * 4,
          (((row + 1) * width) / 2) * 4,
        ),
        (row * width + width / 2) * 4,
      );
    }
    // Reuse one palette for the whole recording instead of running the costly
    // color quantizer for every frame.
    palette ??= quantize(combined, 256);
    const indexed = applyPalette(combined, palette);
    if (frame === 0)
      gif.writeFrame(indexed, width, height, {
        palette,
        delay: 400,
        repeat: 0,
      });
    else gif.writeFrame(indexed, width, height, { palette, delay: 400 });
    await first.waitForTimeout(300);
  }
  gif.finish();
  await mkdir("reports", { recursive: true });
  await writeFile("reports/multiplayer.gif", gif.bytes());
  await firstContext.close();
  await secondContext.close();
});

test("a 404 asset is not retried and shows a recoverable screen", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/assets/missing-ship-sheet.svg", async (route) => {
    attempts += 1;
    await route.fulfill({ status: 404, body: "not found" });
  });
  await page.goto("/?failure=404");
  await page.getByRole("button", { name: "Увійти до лобі" }).click();
  await expect(
    page.getByRole("heading", { name: "Не вдалося підготувати гру" }),
  ).toBeVisible({ timeout: 5_000 });
  await expect(
    page.getByRole("button", { name: "Спробувати ще раз" }),
  ).toBeVisible();
  expect(attempts).toBe(1);
  await mkdir("reports/failures", { recursive: true });
  await page.screenshot({ path: "reports/failures/404-retry.png" });
});

test("an asset request timeout is cancellable and recoverable", async ({
  page,
}) => {
  test.setTimeout(15_000);
  await page.route("**/assets/slow.json", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 12_000));
    try {
      await route.fulfill({ contentType: "application/json", body: "{}" });
    } catch {
      /* the asset signal already aborted */
    }
  });
  await page.goto("/?failure=timeout");
  await page.getByRole("button", { name: "Увійти до лобі" }).click();
  await expect(
    page.getByRole("heading", { name: "Не вдалося підготувати гру" }),
  ).toBeVisible({ timeout: 10_000 });
  await mkdir("reports/failures", { recursive: true });
  await page.screenshot({ path: "reports/failures/timeout-retry.png" });
});

test("an abort during asset loading returns to a retry screen", async ({
  page,
}) => {
  await page.route("**/assets/slow.json", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      await route.fulfill({ contentType: "application/json", body: "{}" });
    } catch {
      /* abort is the intended test result */
    }
  });
  await page.goto("/?failure=abort");
  await page.getByRole("button", { name: "Увійти до лобі" }).click();
  await expect(
    page.getByRole("heading", { name: "Не вдалося підготувати гру" }),
  ).toBeVisible({ timeout: 5_000 });
  await mkdir("reports/failures", { recursive: true });
  await page.screenshot({ path: "reports/failures/abort-retry.png" });
});

test("corrupt asset JSON shows a recoverable retry screen", async ({
  page,
}) => {
  await page.route("**/assets/broken.json", (route) =>
    route.fulfill({ contentType: "application/json", body: "{broken json" }),
  );
  await page.goto("/?failure=json");
  await page.getByRole("button", { name: "Увійти до лобі" }).click();
  await expect(
    page.getByRole("heading", { name: "Не вдалося підготувати гру" }),
  ).toBeVisible({ timeout: 5_000 });
  await expect(
    page.getByRole("button", { name: "Спробувати ще раз" }),
  ).toBeVisible();
  await mkdir("reports/failures", { recursive: true });
  await page.screenshot({ path: "reports/failures/json-retry.png" });
});
