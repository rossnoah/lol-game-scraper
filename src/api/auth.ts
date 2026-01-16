import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== config.datasetApiKey) {
    res.status(401).json({ error: 'Invalid or missing API key' });
    return;
  }

  next();
}
