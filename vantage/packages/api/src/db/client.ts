import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://vantage:vantage@localhost:5432/vantage';

const queryClient = postgres(connectionString, { max: 10 });
export const db = drizzle(queryClient, { schema });
export type DB = typeof db;
export { schema };
