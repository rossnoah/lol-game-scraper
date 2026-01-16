import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  // Riot API
  riotApiKey: process.env.RIOT_API_KEY || "",

  // Dataset API
  datasetApiKey: process.env.DATASET_API_KEY || "change-me-in-production",
  port: parseInt(process.env.PORT || "3000", 10),

  // Data storage
  dataDir: process.env.DATA_DIR || path.join(__dirname, "..", "data"),
  maxDbSizeGb: parseFloat(process.env.MAX_DB_SIZE_GB || "16"),

  // Scraping settings
  targetTier: "DIAMOND" as const,
  targetDivisions: ["I", "II", "III", "IV"] as const,
  queueType: "RANKED_SOLO_5x5" as const,
  validQueueIds: [420] as number[], // Ranked Solo/Duo
  minGameDurationSeconds: 480, // 8 minutes
  matchesPerBatch: 100,

  // Rate limits per region (americas, asia, europe each have separate limits)
  // 20 requests per 1 second (burst)
  // 100 requests per 2 minutes (sustained) = ~0.83 req/sec
  rateLimits: {
    burstLimit: 20,
    burstWindowMs: 1000,
    sustainedLimit: 100,
    sustainedWindowMs: 120000, // 2 minutes
  },

  // Scraper behavior
  matchHistoryCount: 100, // Matches to fetch per player per round
  playerPagesPerDivision: 1000, // Pages of players to fetch per division

  // Patch targeting - automatically targets the latest patch detected from matches
  // Set TARGET_PATCH to override (e.g., "15.1"), or leave unset to auto-detect
  targetPatch: process.env.TARGET_PATCH || 'auto',
} as const;

export interface RegionConfig {
  platform: string; // e.g., 'na1', 'euw1', 'kr'
  routing: string; // e.g., 'americas', 'europe', 'asia'
  name: string; // Human readable name
}

export const regions: RegionConfig[] = [
  { platform: "na1", routing: "americas", name: "North America" },
  { platform: "euw1", routing: "europe", name: "Europe West" },
  { platform: "kr", routing: "asia", name: "Korea" },
];

export function validateConfig(): void {
  if (!config.riotApiKey) {
    console.error("ERROR: RIOT_API_KEY environment variable is required");
    console.error("Get your key from: https://developer.riotgames.com/");
    process.exit(1);
  }
}
