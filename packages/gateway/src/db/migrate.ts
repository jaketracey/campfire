#!/usr/bin/env tsx
/**
 * Database Migration Runner for Project Campfire
 *
 * Usage:
 *   pnpm db:migrate          - Run all pending migrations (alias for 'up')
 *   pnpm db:migrate:up       - Run all pending migrations
 *   pnpm db:migrate:down     - Rollback the last migration
 *   pnpm db:migrate:status   - Show migration status
 *   pnpm db:migrate:create   - Create a new migration file
 */

import { createHash } from 'crypto';
import { readdir, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createPool, closePool } from './pool.js';
import type postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = join(__dirname, 'migrations');

interface MigrationFile {
  id: number;
  name: string;
  filename: string;
  path: string;
}

interface MigrationRecord {
  id: number;
  name: string;
  executed_at: Date;
  checksum: string;
}

interface MigrationModule {
  up: (sql: postgres.Sql) => Promise<void>;
  down: (sql: postgres.Sql) => Promise<void>;
}

async function ensureMigrationsTable(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum VARCHAR(64) NOT NULL
    )
  `;
}

async function getExecutedMigrations(sql: postgres.Sql): Promise<MigrationRecord[]> {
  const rows = await sql<MigrationRecord[]>`
    SELECT id, name, executed_at, checksum
    FROM migrations
    ORDER BY id ASC
  `;
  return rows;
}

async function getMigrationFiles(): Promise<MigrationFile[]> {
  const files = await readdir(MIGRATIONS_DIR);

  const migrations: MigrationFile[] = [];

  for (const filename of files) {
    // Match pattern: 001_create_events_table.ts
    const match = filename.match(/^(\d+)_(.+)\.(ts|js)$/);
    if (match) {
      const [, idStr, name] = match;
      const id = parseInt(idStr!, 10);
      migrations.push({
        id,
        name: name!,
        filename,
        path: join(MIGRATIONS_DIR, filename),
      });
    }
  }

  return migrations.sort((a, b) => a.id - b.id);
}

async function computeChecksum(filepath: string): Promise<string> {
  const content = await readFile(filepath, 'utf-8');
  return createHash('sha256').update(content).digest('hex').substring(0, 64);
}

async function loadMigration(filepath: string): Promise<MigrationModule> {
  const module = await import(filepath) as MigrationModule;

  if (typeof module.up !== 'function') {
    throw new Error(`Migration ${filepath} must export an 'up' function`);
  }
  if (typeof module.down !== 'function') {
    throw new Error(`Migration ${filepath} must export a 'down' function`);
  }

  return module;
}

export async function migrate(direction: 'up' | 'down' = 'up'): Promise<void> {
  const sql = createPool();

  try {
    await ensureMigrationsTable(sql);

    const executed = await getExecutedMigrations(sql);
    const files = await getMigrationFiles();

    if (direction === 'up') {
      await runUp(sql, executed, files);
    } else {
      await runDown(sql, executed, files);
    }
  } finally {
    await closePool();
  }
}

async function runUp(
  sql: postgres.Sql,
  executed: MigrationRecord[],
  files: MigrationFile[]
): Promise<void> {
  const executedIds = new Set(executed.map(m => m.id));
  const pending = files.filter(f => !executedIds.has(f.id));

  if (pending.length === 0) {
    console.log('[Migrate] No pending migrations');
    return;
  }

  console.log(`[Migrate] Running ${pending.length} pending migration(s)...`);

  for (const migration of pending) {
    console.log(`[Migrate] Running: ${migration.filename}`);

    const module = await loadMigration(migration.path);
    const checksum = await computeChecksum(migration.path);

    await sql.begin(async (tx) => {
      await module.up(tx as unknown as postgres.Sql);

      await tx`
        INSERT INTO migrations (id, name, checksum)
        VALUES (${migration.id}, ${migration.name}, ${checksum})
      `;
    });

    console.log(`[Migrate] Completed: ${migration.filename}`);
  }

  console.log('[Migrate] All migrations completed');
}

async function runDown(
  sql: postgres.Sql,
  executed: MigrationRecord[],
  files: MigrationFile[]
): Promise<void> {
  if (executed.length === 0) {
    console.log('[Migrate] No migrations to rollback');
    return;
  }

  const lastExecuted = executed[executed.length - 1]!;
  const migrationFile = files.find(f => f.id === lastExecuted.id);

  if (!migrationFile) {
    throw new Error(`Cannot find migration file for ID ${lastExecuted.id}`);
  }

  console.log(`[Migrate] Rolling back: ${migrationFile.filename}`);

  const module = await loadMigration(migrationFile.path);

  await sql.begin(async (tx) => {
    await module.down(tx as unknown as postgres.Sql);

    await tx`
      DELETE FROM migrations WHERE id = ${lastExecuted.id}
    `;
  });

  console.log(`[Migrate] Rolled back: ${migrationFile.filename}`);
}

export async function getMigrationStatus(): Promise<{
  executed: MigrationRecord[];
  pending: MigrationFile[];
}> {
  const sql = createPool();

  try {
    await ensureMigrationsTable(sql);

    const executed = await getExecutedMigrations(sql);
    const files = await getMigrationFiles();

    const executedIds = new Set(executed.map(m => m.id));
    const pending = files.filter(f => !executedIds.has(f.id));

    return { executed, pending };
  } finally {
    await closePool();
  }
}

async function showStatus(): Promise<void> {
  const { executed, pending } = await getMigrationStatus();

  console.log('\n=== Migration Status ===\n');

  if (executed.length === 0) {
    console.log('No migrations have been executed yet.\n');
  } else {
    console.log('Executed migrations:');
    for (const m of executed) {
      console.log(`  [x] ${String(m.id).padStart(3, '0')}_${m.name} (${m.executed_at.toISOString()})`);
    }
    console.log();
  }

  if (pending.length === 0) {
    console.log('No pending migrations.\n');
  } else {
    console.log('Pending migrations:');
    for (const m of pending) {
      console.log(`  [ ] ${m.filename}`);
    }
    console.log();
  }
}

async function createMigration(name: string): Promise<void> {
  const files = await getMigrationFiles();
  const nextId = files.length > 0 ? Math.max(...files.map(f => f.id)) + 1 : 1;

  const paddedId = String(nextId).padStart(3, '0');
  const sanitizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const filename = `${paddedId}_${sanitizedName}.ts`;
  const filepath = join(MIGRATIONS_DIR, filename);

  const template = `/**
 * Migration: ${name}
 * Created: ${new Date().toISOString()}
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // TODO: Implement migration
  await sql\`
    -- Add your SQL here
  \`;
}

export async function down(sql: postgres.Sql): Promise<void> {
  // TODO: Implement rollback
  await sql\`
    -- Add your rollback SQL here
  \`;
}
`;

  await writeFile(filepath, template, 'utf-8');
  console.log(`[Migrate] Created: ${filename}`);
}

// CLI handler
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'up';

  try {
    switch (command) {
      case 'up':
        await migrate('up');
        break;

      case 'down':
        await migrate('down');
        break;

      case 'status':
        await showStatus();
        break;

      case 'create': {
        const name = args[1];
        if (!name) {
          console.error('Usage: pnpm db:migrate:create <migration_name>');
          process.exit(1);
        }
        await createMigration(name);
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Available commands: up, down, status, create');
        process.exit(1);
    }
  } catch (error) {
    console.error('[Migrate] Error:', error);
    process.exit(1);
  }
}

// Run if called directly
main();
