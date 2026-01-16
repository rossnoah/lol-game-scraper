import { getDb } from './schema.js';

export interface MatchRecord {
  id: number;
  match_id: string;
  patch: string;
  data: string;
}

export interface PlayerRecord {
  id: number;
  puuid: string;
  region: string;
  match_offset: number;
}

export function saveMatch(matchId: string, patch: string, data: object): boolean {
  const db = getDb();
  try {
    db.prepare(`
      INSERT OR IGNORE INTO matches (match_id, patch, data)
      VALUES (?, ?, ?)
    `).run(matchId, patch, JSON.stringify(data));
    return true;
  } catch (err) {
    console.error(`Error saving match ${matchId}:`, err);
    return false;
  }
}

export function matchExists(matchId: string): boolean {
  const db = getDb();
  const result = db.prepare('SELECT 1 FROM matches WHERE match_id = ?').get(matchId);
  return !!result;
}

export function* streamMatchesByPatch(patch: string): Generator<MatchRecord> {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM matches WHERE patch = ?');
  for (const row of stmt.iterate(patch)) {
    yield row as MatchRecord;
  }
}

export function getMatchesByPatchBatch(patch: string, limit: number, offset: number): MatchRecord[] {
  const db = getDb();
  return db.prepare('SELECT * FROM matches WHERE patch = ? LIMIT ? OFFSET ?').all(patch, limit, offset) as MatchRecord[];
}

export function getMatchCount(patch?: string): number {
  const db = getDb();
  if (patch) {
    const result = db.prepare('SELECT COUNT(*) as count FROM matches WHERE patch = ?').get(patch) as { count: number };
    return result.count;
  }
  const result = db.prepare('SELECT COUNT(*) as count FROM matches').get() as { count: number };
  return result.count;
}

export function getPatches(): { patch: string; count: number }[] {
  const db = getDb();
  return db.prepare(`
    SELECT patch, COUNT(*) as count FROM matches GROUP BY patch ORDER BY patch DESC
  `).all() as { patch: string; count: number }[];
}

/**
 * Get the oldest match timestamp (in seconds) for a given patch from the DB.
 * Returns null if no matches found for that patch.
 */
export function getOldestMatchTimestamp(patch: string): number | null {
  const db = getDb();
  const result = db.prepare(`
    SELECT json_extract(data, '$.info.gameCreation') as gameCreation
    FROM matches
    WHERE patch = ?
    ORDER BY json_extract(data, '$.info.gameCreation') ASC
    LIMIT 1
  `).get(patch) as { gameCreation: number } | undefined;

  if (!result || !result.gameCreation) return null;
  return Math.floor(result.gameCreation / 1000); // Convert ms to seconds
}

export function savePlayer(puuid: string, region: string): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO players (puuid, region) VALUES (?, ?)
  `).run(puuid, region);
}

export function getPlayersByRegion(region: string): PlayerRecord[] {
  const db = getDb();
  return db.prepare('SELECT * FROM players WHERE region = ?').all(region) as PlayerRecord[];
}

export function updatePlayerOffset(puuid: string, region: string, offset: number): void {
  const db = getDb();
  db.prepare('UPDATE players SET match_offset = ? WHERE puuid = ? AND region = ?').run(offset, puuid, region);
}

export function getPlayerCount(region?: string): number {
  const db = getDb();
  if (region) {
    const result = db.prepare('SELECT COUNT(*) as count FROM players WHERE region = ?').get(region) as { count: number };
    return result.count;
  }
  const result = db.prepare('SELECT COUNT(*) as count FROM players').get() as { count: number };
  return result.count;
}

export function updateScrapeState(region: string, totalMatches: number): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO scrape_state (region, total_matches, last_updated)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(region) DO UPDATE SET
      total_matches = excluded.total_matches,
      last_updated = datetime('now')
  `).run(region, totalMatches);
}

export function getStats(): {
  totalMatches: number;
  totalPlayers: number;
  matchesByPatch: { patch: string; count: number }[];
} {
  const db = getDb();
  const totalMatches = (db.prepare('SELECT COUNT(*) as count FROM matches').get() as { count: number }).count;
  const totalPlayers = (db.prepare('SELECT COUNT(*) as count FROM players').get() as { count: number }).count;
  const matchesByPatch = getPatches();
  return { totalMatches, totalPlayers, matchesByPatch };
}
