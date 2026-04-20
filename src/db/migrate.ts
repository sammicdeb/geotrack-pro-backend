import '../config/env';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const db = drizzle(pool);

migrate(db, { migrationsFolder: './drizzle' })
  .then(() => { console.log('Migrations complete'); process.exit(0); })
  .catch(e => { console.error('Migration failed', e); process.exit(1); });
