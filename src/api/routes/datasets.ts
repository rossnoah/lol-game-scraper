import { Router, type Request, type Response } from 'express';
import { apiKeyAuth } from '../auth.js';
import { streamMatchesByPatch, getPatches, getMatchCount } from '../../db/queries.js';

const router = Router();

// List available patches
router.get('/patches', apiKeyAuth, (_req: Request, res: Response) => {
  const patches = getPatches();
  res.json({ patches });
});

// Download matches by patch as NDJSON
router.get('/download', apiKeyAuth, (req: Request, res: Response) => {
  const { patch } = req.query;

  if (!patch || typeof patch !== 'string') {
    res.status(400).json({ error: 'patch query parameter is required' });
    return;
  }

  const count = getMatchCount(patch);
  if (count === 0) {
    res.status(404).json({ error: `No matches found for patch ${patch}` });
    return;
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Content-Disposition', `attachment; filename="matches-${patch}.ndjson"`);

  for (const match of streamMatchesByPatch(patch)) {
    // Stream each match as a JSON line
    const data = JSON.parse(match.data);
    res.write(`${JSON.stringify(data)}\n`);
  }

  res.end();
});

export default router;
