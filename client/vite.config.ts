import { defineConfig } from "vite";
import { readFile } from "node:fs/promises";
import path from "node:path";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: path.resolve("index.html"),
        performance: path.resolve("perf.html"),
      },
    },
  },
  plugins: [
    {
      name: "dogfight-local-api-and-failure-demos",
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          const pathname = new URL(request.url ?? "/", "http://localhost")
            .pathname;
          if (request.method === "GET" && pathname === "/api/rooms") {
            response.setHeader(
              "Content-Type",
              "application/json; charset=utf-8",
            );
            response.end(
              await readFile(path.resolve("public/api/rooms.json"), "utf8"),
            );
            return;
          }
          if (request.method === "GET" && pathname === "/assets/slow.svg") {
            await new Promise((resolve) => setTimeout(resolve, 12_000));
            response.setHeader("Content-Type", "image/svg+xml");
            response.end(
              '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"></svg>',
            );
            return;
          }
          if (request.method === "GET" && pathname === "/assets/slow.json") {
            await new Promise((resolve) => setTimeout(resolve, 12_000));
            response.setHeader("Content-Type", "application/json");
            response.end('{"slow":true}');
            return;
          }
          if (request.method === "GET" && pathname === "/assets/broken.json") {
            response.setHeader("Content-Type", "application/json");
            response.end("{broken json");
            return;
          }
          next();
        });
      },
    },
  ],
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:3000", ws: true },
    },
  },
});
