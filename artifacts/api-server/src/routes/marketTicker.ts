import { Router } from 'express';
import { requireSession } from '../lib/session';
import { fetchEnergyTicker } from '../lib/market-data/energy-ticker';
const router = Router();
router.get('/market/ticker', requireSession, async (_req,res) => {
  res.setHeader('Cache-Control','private, max-age=30');
  res.json(await fetchEnergyTicker());
});
export default router;
