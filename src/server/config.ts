import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 4174),
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
