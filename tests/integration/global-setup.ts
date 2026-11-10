// Runs once before the integration suite: makes sure the test database exists,
// wipes it, and applies every migration from scratch (plan §8, Phase 0).
import postgres from "postgres";
import { runMigrations } from "@/db/migrator";
import { getTestDatabaseUrl } from "./test-db-url";

async function ensureDatabaseExists(url: string) {
  const target = new URL(url);
  const dbName = decodeURIComponent(target.pathname.slice(1));
  const admin = new URL(url);
  admin.pathname = "/postgres";

  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    const rows = await sql`select 1 from pg_database where datname = ${dbName}`;
    if (rows.length === 0) {
      await sql.unsafe(`create database "${dbName.replace(/"/g, '""')}"`);
    }
  } finally {
    await sql.end();
  }
}

async function wipe(url: string) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`
      drop schema if exists drizzle cascade;
      drop schema if exists public cascade;
      create schema public;
    `);
  } finally {
    await sql.end();
  }
}

export default async function setup() {
  const url = getTestDatabaseUrl();
  await ensureDatabaseExists(url);
  await wipe(url);
  await runMigrations(url);
}
