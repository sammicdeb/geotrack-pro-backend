import '../config/env';
import bcrypt from 'bcryptjs';
import { db, schema } from './index';

async function main() {
  console.log('Seeding database...');

  const hash = (p: string) => bcrypt.hash(p, 12);

  const [existing] = await db.select().from(schema.organizations)
    .where((t => require('drizzle-orm').eq(t.slug, 'demo-org'))(schema.organizations)).limit(1);

  if (existing) {
    console.log('Demo org already exists, skipping seed.');
    process.exit(0);
  }

  const { eq } = await import('drizzle-orm');

  const [org] = await db.insert(schema.organizations).values({
    name: 'Demo Organization',
    slug: 'demo-org',
    email: 'admin@demo-org.com',
  }).returning();

  await db.insert(schema.users).values({
    organizationId: org.id,
    name: 'David Okonkwo',
    email: 'david@demo-org.com',
    username: 'admin',
    passwordHash: await hash('admin123'),
    role: 'admin',
    status: 'active',
  });

  for (let i = 1; i <= 5; i++) {
    await db.insert(schema.users).values({
      organizationId: org.id,
      name: `Field Agent ${i}`,
      email: `agent0${i}@demo-org.com`,
      username: `agent0${i}`,
      passwordHash: await hash('pass123'),
      role: 'field_agent',
      status: i < 5 ? 'active' : 'inactive',
    });
  }

  await db.insert(schema.zones).values({
    organizationId: org.id,
    name: 'Lagos Island Zone',
    shape: 'polygon',
    coordinates: [
      { latitude: 6.4541, longitude: 3.3947 },
      { latitude: 6.4698, longitude: 3.3947 },
      { latitude: 6.4698, longitude: 3.4214 },
      { latitude: 6.4541, longitude: 3.4214 },
    ],
    color: '#3B82F6',
    fillOpacity: 0.2,
    status: 'active',
    source: 'drawn',
  });

  console.log('\nSeed complete!');
  console.log('  Org slug:     demo-org');
  console.log('  Admin login:  admin / admin123');
  console.log('  Agent login:  agent01-05 / pass123');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
