import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 4174),
  // Bind to localhost by default — MediaGap has no authentication, so it must not be reachable
  // from the LAN/internet unless the user knowingly opts in with HOST=0.0.0.0 (behind a proxy/VPN).
  host: process.env.HOST?.trim() || "127.0.0.1",
  databasePath: process.env.DATABASE_PATH ?? path.resolve("data", "app.db"),
  isProduction: process.env.NODE_ENV === "production",
  // Trakt uses ONE shared registered app; credentials come from env and stay server-side.
  // Unset → the Trakt feature is simply unavailable (graceful).
  traktClientId: process.env.TRAKT_CLIENT_ID ?? "",
  traktClientSecret: process.env.TRAKT_CLIENT_SECRET ?? ""
};

export function isTraktConfigured(): boolean {
  return Boolean(config.traktClientId && config.traktClientSecret);
}
