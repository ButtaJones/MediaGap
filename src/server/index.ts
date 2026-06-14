import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { config } from "./config.js";
import { api } from "./routes/api.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/api", api);
app.use("/api", (req, res) => {
  res.status(404).json({
    ok: false,
    message: `Unknown API route: ${req.method} ${req.originalUrl}. Restart the app server if the UI was just updated.`
  });
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(__dirname, "..", "client");
app.use(express.static(clientDir));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message =
    error instanceof ZodError
      ? error.issues.map((issue) => issue.message).join(", ")
      : error instanceof Error
        ? error.message
        : "Something went wrong.";
  res.status(400).json({ ok: false, message });
});

const server = app.listen(config.port, () => {
  console.log(`MediaGap listening on http://localhost:${config.port}`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
