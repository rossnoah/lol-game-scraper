import express from 'express';
import cors from 'cors';
import { config } from '../config.js';
import { getStats } from '../db/queries.js';
import { getApiKeyStatus } from '../scraper/api-status.js';
import datasetsRouter from './routes/datasets.js';

export function createServer(): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    const apiKeyStatus = getApiKeyStatus();
    res.json({
      status: apiKeyStatus.valid ? 'ok' : 'degraded',
      apiKeyValid: apiKeyStatus.valid,
      apiKeyInvalidSince: apiKeyStatus.invalidSince,
    });
  });

  // Public stats endpoint
  app.get('/api/stats', (_req, res) => {
    const stats = getStats();
    const apiKeyStatus = getApiKeyStatus();
    res.json({
      ...stats,
      scraping: {
        active: apiKeyStatus.valid,
        apiKeyValid: apiKeyStatus.valid,
        apiKeyInvalidSince: apiKeyStatus.invalidSince,
      },
    });
  });

  // Protected dataset routes
  app.use('/api/datasets', datasetsRouter);

  return app;
}

export function startServer(): void {
  const app = createServer();

  app.listen(config.port, () => {
    console.log(`API server running on port ${config.port}`);
    console.log(`  Health: http://localhost:${config.port}/health`);
    console.log(`  Stats:  http://localhost:${config.port}/api/stats`);
    console.log(`  Datasets: http://localhost:${config.port}/api/datasets/patches (requires X-API-Key)`);
  });
}
