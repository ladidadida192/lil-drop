import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config({ override: true });

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});