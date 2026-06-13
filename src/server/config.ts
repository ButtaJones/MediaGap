import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 4174),
  databasePath: process.env.DATABASE_PATH ?? path.resolve("data", "app.db"),
  isProduction: process.env.NODE_ENV === "production"
};
