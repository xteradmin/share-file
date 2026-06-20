import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { config } from "./shared/config.js";
import { registerHealthRoutes } from "./modules/health/health.routes.js";

export function createApp() {
  const app = express();
  const clientDist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../client/dist",
  );

  const corsOptions = config.allowAllOrigins
    ? { origin: true }
    : { origin: config.clientOrigins };

  app.use(cors(corsOptions));
  app.use(express.json());

  registerHealthRoutes(app);

  if (fs.existsSync(clientDist)) {
    // Vite's hashed assets (JS/CSS with content hashes) can be cached long-term.
    app.use(
      "/assets",
      express.static(path.join(clientDist, "assets"), {
        maxAge: "1y",
        immutable: true,
      }),
    );

    // index.html and other root files should never be cached.
    app.use(
      express.static(clientDist, {
        maxAge: 0,
        etag: true,
        setHeaders(res, filePath) {
          if (filePath.endsWith("index.html")) {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      }),
    );
    app.get("*", (_request, response, next) => {
      if (_request.path.startsWith("/api") || _request.path.startsWith("/ws")) {
        next();
        return;
      }

      response.sendFile(path.join(clientDist, "index.html"));
    });
  }

  return app;
}
