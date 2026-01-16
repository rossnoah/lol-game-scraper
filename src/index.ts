import { config, regions, validateConfig } from './config.js';
import { getDb, closeDb } from './db/schema.js';
import { startServer } from './api/server.js';
import { ScraperWorker } from './scraper/worker.js';
import { startApiKeyHealthCheck, stopApiKeyHealthCheck } from './scraper/api-status.js';

const workers: ScraperWorker[] = [];

async function main(): Promise<void> {
  console.log('LoL Game Scraper starting...');
  console.log(`Data directory: ${config.dataDir}`);

  // Validate config
  validateConfig();

  // Initialize database
  getDb();
  console.log('Database initialized');

  // Start API server
  startServer();

  // Start scraper workers for each region
  for (const region of regions) {
    const worker = new ScraperWorker(region);
    workers.push(worker);

    // Start each worker in parallel (don't await)
    worker.start().catch((err) => {
      console.error(`[${region.name}] Worker error:`, err);
    });
  }

  // Start periodic API key health check (uses first worker's API instance)
  if (workers.length > 0) {
    startApiKeyHealthCheck(async () => {
      return workers[0].getApi().testApiKey();
    }, 60000); // Check every minute when key is invalid
  }

  console.log(`Started ${workers.length} scraper workers: ${regions.map((r) => r.name).join(', ')}`);
}

// Graceful shutdown
function shutdown(): void {
  console.log('\nShutting down...');

  stopApiKeyHealthCheck();

  for (const worker of workers) {
    worker.stop();
  }

  closeDb();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
