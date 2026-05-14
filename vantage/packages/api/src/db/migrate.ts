import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://vantage:vantage@localhost:5432/vantage';

async function main() {
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);
  console.log('Running migrations from infra/migrations...');
  await migrate(db, { migrationsFolder: '../../infra/migrations' });
  console.log('Migrations complete.');
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
