import { RiotApi, type MatchData, ApiKeyInvalidError } from './riot-api.js';
import { isApiKeyValid } from './api-status.js';
import { config, type RegionConfig } from '../config.js';
import {
  saveMatch,
  matchExists,
  savePlayer,
  getPlayersByRegion,
  updatePlayerOffset,
  getMatchCount,
  updateScrapeState,
  getOldestMatchTimestamp,
} from '../db/queries.js';

const API_KEY_CHECK_INTERVAL = 30000; // Check every 30s when paused

export class ScraperWorker {
  private api: RiotApi;
  private region: RegionConfig;
  private running = false;
  private currentPatch: string | null = null;
  // The patch we're targeting (auto-detected or from config)
  private targetPatch: string | null = null;
  // Timestamp (in seconds) when the target patch started - discovered via binary search
  private patchStartTimestamp: number | null = null;
  private patchBoundarySearched = false;

  constructor(region: RegionConfig) {
    this.region = region;
    this.api = new RiotApi(region);
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[${this.region.name}] Starting scraper worker`);

    while (this.running) {
      try {
        // Wait if API key is invalid
        if (!isApiKeyValid()) {
          await new Promise((resolve) => setTimeout(resolve, API_KEY_CHECK_INTERVAL));
          continue;
        }

        await this.scrapeRound();
        // Brief pause between rounds
        await new Promise((resolve) => setTimeout(resolve, 5000));
      } catch (err) {
        if (err instanceof ApiKeyInvalidError) {
          // API key became invalid, pause and wait
          console.log(`[${this.region.name}] Paused - API key invalid`);
          await new Promise((resolve) => setTimeout(resolve, API_KEY_CHECK_INTERVAL));
        } else {
          console.error(`[${this.region.name}] Error in scrape round:`, err);
          await new Promise((resolve) => setTimeout(resolve, 10000));
        }
      }
    }
  }

  stop(): void {
    this.running = false;
    console.log(`[${this.region.name}] Stopping scraper worker`);
  }

  getApi(): RiotApi {
    return this.api;
  }

  private async scrapeRound(): Promise<void> {
    // Fetch players if we don't have any
    let players = getPlayersByRegion(this.region.platform);

    if (players.length === 0) {
      console.log(`[${this.region.name}] Fetching Diamond+ players...`);
      await this.fetchPlayers();
      players = getPlayersByRegion(this.region.platform);
    }

    if (players.length === 0) {
      console.log(`[${this.region.name}] No players found, waiting...`);
      return;
    }

    // Detect target patch and find boundary if we haven't yet
    if (!this.patchBoundarySearched) {
      // Determine target patch - either from config or auto-detect
      if (config.targetPatch && config.targetPatch !== 'auto') {
        this.targetPatch = config.targetPatch;
      } else {
        // Auto-detect latest patch from recent matches
        this.targetPatch = await this.detectLatestPatch(players);
      }

      if (this.targetPatch) {
        console.log(`[${this.region.name}] Target patch: ${this.targetPatch}`);
        // Try to find the patch boundary using the first player with match history
        for (const player of players) {
          const boundary = await this.findPatchBoundary(player.puuid);
          if (boundary !== null) {
            this.patchStartTimestamp = boundary;
            console.log(
              `[${this.region.name}] Using patch start time: ${new Date(boundary * 1000).toISOString()}`
            );
            break;
          }
        }

        if (this.patchStartTimestamp === null) {
          console.log(
            `[${this.region.name}] Could not determine patch boundary, will filter by patch version instead`
          );
        }
      }
      this.patchBoundarySearched = true;
    }

    console.log(`[${this.region.name}] Processing ${players.length} players...`);

    let matchesThisRound = 0;
    let skippedOldPatch = 0;

    for (const player of players) {
      if (!this.running) break;

      // Use patch boundary timestamp if available to avoid fetching old patch games
      const matchIds = await this.api.getMatchHistory(
        player.puuid,
        player.match_offset,
        config.matchHistoryCount,
        this.patchStartTimestamp ?? undefined
      );

      if (matchIds.length === 0) {
        continue;
      }

      for (const matchId of matchIds) {
        if (!this.running) break;

        if (matchExists(matchId)) {
          continue;
        }

        const matchData = await this.api.getMatchDetails(matchId);
        if (!matchData) continue;

        if (!this.isValidMatch(matchData)) {
          continue;
        }

        const patch = this.extractPatch(matchData.info.gameVersion);

        // Skip if targeting a specific patch and this isn't it
        if (this.targetPatch && patch !== this.targetPatch) {
          skippedOldPatch++;
          continue;
        }

        // Update current patch if this is newer
        if (!this.currentPatch || patch > this.currentPatch) {
          this.currentPatch = patch;
        }

        saveMatch(matchId, patch, matchData);
        matchesThisRound++;

        if (matchesThisRound % 10 === 0) {
          const total = getMatchCount();
          console.log(`[${this.region.name}] +${matchesThisRound} matches (total: ${total})`);
        }
      }

      // Update player offset
      updatePlayerOffset(player.puuid, this.region.platform, player.match_offset + matchIds.length);
    }

    const total = getMatchCount();
    updateScrapeState(this.region.platform, total);
    const skipMsg = skippedOldPatch > 0 ? ` (skipped ${skippedOldPatch} old patch)` : '';
    console.log(`[${this.region.name}] Round complete: +${matchesThisRound} matches${skipMsg} (total: ${total})`);
  }

  private async fetchPlayers(): Promise<void> {
    for (const division of config.targetDivisions) {
      console.log(`[${this.region.name}] Fetching ${config.targetTier} ${division}...`);

      for (let page = 1; page <= config.playerPagesPerDivision; page++) {
        const entries = await this.api.getLeagueEntries(config.targetTier, division, page);

        if (entries.length === 0) {
          break;
        }

        for (const entry of entries) {
          // puuid is now included directly in league entries
          savePlayer(entry.puuid, this.region.platform);
        }

        console.log(`[${this.region.name}] Page ${page}: ${entries.length} players`);
      }
    }
  }

  private isValidMatch(match: MatchData): boolean {
    const info = match.info;

    // Check queue type (420 = Ranked Solo/Duo)
    if (!config.validQueueIds.includes(info.queueId)) {
      return false;
    }

    // Check duration (in seconds)
    if (info.gameDuration < config.minGameDurationSeconds) {
      return false;
    }

    return true;
  }

  private extractPatch(gameVersion: string): string {
    // gameVersion is like "14.24.123.456" - we want "14.24"
    const parts = gameVersion.split('.');
    return `${parts[0]}.${parts[1]}`;
  }

  /**
   * Compare two patch versions numerically.
   * Returns negative if a < b, positive if a > b, 0 if equal.
   */
  private comparePatch(a: string, b: string): number {
    const [aMajor, aMinor] = a.split('.').map(Number);
    const [bMajor, bMinor] = b.split('.').map(Number);
    if (aMajor !== bMajor) return aMajor - bMajor;
    return aMinor - bMinor;
  }

  /**
   * Auto-detect the latest patch by sampling recent matches from players.
   */
  private async detectLatestPatch(players: { puuid: string }[]): Promise<string | null> {
    console.log(`[${this.region.name}] Auto-detecting latest patch...`);

    const patchCounts = new Map<string, number>();

    // Sample a few players' recent matches to find the latest patch
    for (const player of players.slice(0, 5)) {
      const matchIds = await this.api.getMatchHistory(player.puuid, 0, 10);
      if (matchIds.length === 0) continue;

      // Check the most recent match
      const matchData = await this.api.getMatchDetails(matchIds[0]);
      if (!matchData) continue;

      const patch = this.extractPatch(matchData.info.gameVersion);
      patchCounts.set(patch, (patchCounts.get(patch) || 0) + 1);
    }

    if (patchCounts.size === 0) {
      console.log(`[${this.region.name}] Could not detect patch from matches`);
      return null;
    }

    // Find the highest patch version (most recent)
    const patches = Array.from(patchCounts.keys()).sort((a, b) => {
      const [aMajor, aMinor] = a.split('.').map(Number);
      const [bMajor, bMinor] = b.split('.').map(Number);
      if (aMajor !== bMajor) return bMajor - aMajor;
      return bMinor - aMinor;
    });

    const latestPatch = patches[0];
    console.log(`[${this.region.name}] Detected latest patch: ${latestPatch}`);
    return latestPatch;
  }

  /**
   * Find approximate patch boundary timestamp.
   * First checks DB, then falls back to a quick API sample (no binary search).
   */
  private async findPatchBoundary(puuid: string): Promise<number | null> {
    if (!this.targetPatch) return null;

    // First, check if we have matches in the DB for this patch
    const dbTimestamp = getOldestMatchTimestamp(this.targetPatch);
    if (dbTimestamp) {
      console.log(
        `[${this.region.name}] Found patch boundary from DB: ${new Date(dbTimestamp * 1000).toISOString()}`
      );
      return dbTimestamp;
    }

    // No DB data - do a quick API sample to find approximate boundary
    console.log(`[${this.region.name}] No DB data, sampling API for patch boundary...`);

    const matchIds = await this.api.getMatchHistory(puuid, 0, 20);
    if (matchIds.length === 0) return null;

    // Find the oldest match on target patch in this sample
    let oldestOnTargetPatch: number | null = null;

    for (const matchId of matchIds) {
      const matchData = await this.api.getMatchDetails(matchId);
      if (!matchData) continue;

      const patch = this.extractPatch(matchData.info.gameVersion);
      const timestamp = Math.floor(matchData.info.gameCreation / 1000);

      // Skip invalid timestamps
      if (timestamp < 1623801600) continue;

      if (patch === this.targetPatch) {
        oldestOnTargetPatch = timestamp;
      } else if (this.comparePatch(patch, this.targetPatch) < 0) {
        // Hit an older patch - use the last target patch timestamp we found
        break;
      }
    }

    if (oldestOnTargetPatch) {
      console.log(
        `[${this.region.name}] Approximate patch boundary: ${new Date(oldestOnTargetPatch * 1000).toISOString()}`
      );
    }

    return oldestOnTargetPatch;
  }
}
