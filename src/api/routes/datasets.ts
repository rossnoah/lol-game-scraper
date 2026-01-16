import { Router, type Request, type Response } from 'express';
import { apiKeyAuth } from '../auth.js';
import { getMatchesByPatchBatch, getPatches, getMatchCount } from '../../db/queries.js';

const router = Router();

// List available patches
router.get('/patches', apiKeyAuth, (_req: Request, res: Response) => {
  const patches = getPatches();
  res.json({ patches });
});

// Download matches by patch as NDJSON
router.get('/download', apiKeyAuth, async (req: Request, res: Response) => {
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
  res.setHeader('Transfer-Encoding', 'chunked');

  const BATCH_SIZE = 1000;
  let offset = 0;

  // Helper to wait for drain when buffer is full
  const waitForDrain = (): Promise<void> => {
    return new Promise((resolve) => res.once('drain', resolve));
  };

  while (true) {
    const batch = getMatchesByPatchBatch(patch, BATCH_SIZE, offset);
    if (batch.length === 0) break;

    for (const match of batch) {
      const data = JSON.parse(match.data);
      const canContinue = res.write(`${JSON.stringify(data)}\n`);

      // Handle backpressure - wait for drain if buffer is full
      if (!canContinue) {
        await waitForDrain();
      }
    }

    offset += batch.length;

    // Small delay between batches to prevent overwhelming the connection
    await new Promise((resolve) => setImmediate(resolve));
  }

  res.end();
});

export default router;
