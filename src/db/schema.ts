import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(config.dataDir, { recursive: true });

    const dbPath = path.join(config.dataDir, 'lol-matches.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    initializeSchema(db);
  }
  return db;
}

function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT UNIQUE NOT NULL,
      patch TEXT NOT NULL,
      data TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_matches_patch ON matches(patch);

    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      puuid TEXT NOT NULL,
      region TEXT NOT NULL,
      match_offset INTEGER DEFAULT 0,
      UNIQUE(puuid, region)
    );

    CREATE TABLE IF NOT EXISTS scrape_state (
      region TEXT PRIMARY KEY,
      total_matches INTEGER DEFAULT 0,
      last_updated TEXT
    );
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
