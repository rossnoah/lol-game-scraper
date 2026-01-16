import axios, { type AxiosInstance } from 'axios';
import { config, type RegionConfig } from '../config.js';
import { isApiKeyValid, markApiKeyInvalid, markApiKeyValid } from './api-status.js';

export class ApiKeyInvalidError extends Error {
  constructor() {
    super('API key is invalid or expired');
    this.name = 'ApiKeyInvalidError';
  }
}

export class RiotApi {
  private client: AxiosInstance;
  private region: RegionConfig;
  private requestTimestamps: number[] = [];

  constructor(region: RegionConfig) {
    this.region = region;

    this.client = axios.create({
      headers: {
        'X-Riot-Token': config.riotApiKey,
      },
      timeout: 10000,
    });
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const { burstLimit, burstWindowMs, sustainedLimit, sustainedWindowMs } = config.rateLimits;

    // Clean up old timestamps outside the sustained window
    this.requestTimestamps = this.requestTimestamps.filter(
      (ts) => now - ts < sustainedWindowMs
    );

    // Check sustained limit (100 per 2 minutes)
    if (this.requestTimestamps.length >= sustainedLimit) {
      const oldestInWindow = this.requestTimestamps[0];
      const waitTime = sustainedWindowMs - (now - oldestInWindow) + 100;
      if (waitTime > 0) {
        console.log(`[${this.region.name}] Sustained rate limit, waiting ${Math.ceil(waitTime / 1000)}s...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    // Check burst limit (20 per second)
    const recentRequests = this.requestTimestamps.filter((ts) => now - ts < burstWindowMs);
    if (recentRequests.length >= burstLimit) {
      const oldestInBurst = recentRequests[0];
      const waitTime = burstWindowMs - (now - oldestInBurst) + 50;
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    this.requestTimestamps.push(Date.now());
  }

  private async request<T>(url: string, retries = 3): Promise<T | null> {
    // Don't make requests if API key is known to be invalid
    if (!isApiKeyValid()) {
      throw new ApiKeyInvalidError();
    }

    await this.rateLimit();

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await this.client.get<T>(url);
        // Successful request means API key is valid
        markApiKeyValid();
        return response.data;
      } catch (err: unknown) {
        if (axios.isAxiosError(err)) {
          const status = err.response?.status;

          // API key not provided (401 = missing key)
          if (status === 401) {
            markApiKeyInvalid();
            throw new ApiKeyInvalidError();
          }

          // 403 = invalid key OR bad path - log details to debug
          if (status === 403) {
            console.error(`[${this.region.name}] 403 Forbidden: ${url}`);
            return null;
          }

          if (status === 429) {
            const retryAfter = parseInt(err.response?.headers['retry-after'] || '5', 10);
            console.log(`[${this.region.name}] Rate limited, waiting ${retryAfter}s...`);
            await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
            continue;
          }
          if (status === 404) {
            return null;
          }
          console.error(`[${this.region.name}] API error: ${status} - ${err.message}`);
        } else {
          console.error(`[${this.region.name}] Request error:`, err);
        }

        if (attempt < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }
    return null;
  }

  // Test if the API key is valid by making a simple request
  async testApiKey(): Promise<boolean> {
    try {
      await this.rateLimit();
      await this.client.get(
        `https://${this.region.platform}.api.riotgames.com/lol/status/v4/platform-data`
      );
      return true;
    } catch {
      return false;
    }
  }

  async getLeagueEntries(tier: string, division: string, page = 1): Promise<LeagueEntry[]> {
    const url = `https://${this.region.platform}.api.riotgames.com/lol/league/v4/entries/RANKED_SOLO_5x5/${tier}/${division}?page=${page}`;
    const result = await this.request<LeagueEntry[]>(url);
    return result || [];
  }

  async getSummonerByName(summonerId: string): Promise<Summoner | null> {
    const url = `https://${this.region.platform}.api.riotgames.com/lol/summoner/v4/summoners/${summonerId}`;
    return this.request<Summoner>(url);
  }

  async getMatchHistory(
    puuid: string,
    start = 0,
    count = 100,
    startTime?: number,
    endTime?: number
  ): Promise<string[]> {
    let url = `https://${this.region.routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&type=ranked&start=${start}&count=${count}`;
    if (startTime !== undefined) {
      url += `&startTime=${startTime}`;
    }
    if (endTime !== undefined) {
      url += `&endTime=${endTime}`;
    }
    const result = await this.request<string[]>(url);
    return result || [];
  }

  async getMatchDetails(matchId: string): Promise<MatchData | null> {
    const url = `https://${this.region.routing}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
    return this.request<MatchData>(url);
  }
}

export interface LeagueEntry {
  leagueId: string;
  puuid: string;
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
}

export interface Summoner {
  id: string;
  accountId: string;
  puuid: string;
  name: string;
  profileIconId: number;
  revisionDate: number;
  summonerLevel: number;
}

export interface MatchData {
  metadata: {
    matchId: string;
    participants: string[];
  };
  info: {
    gameId: number;
    gameCreation: number;
    gameDuration: number;
    gameVersion: string;
    queueId: number;
    participants: Array<{
      puuid: string;
      summonerName: string;
      championId: number;
      championName: string;
      teamId: number;
      win: boolean;
    }>;
  };
}
