import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { openDb } from './db.js';
import { createBanStore } from './bans.js';
import { createDetector } from './detector.js';
import { createAuthLog } from './authLog.js';
import { portalRouter } from './routes/portal.js';
import { adminRouter, publicApiRouter } from './routes/admin.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** Builds the whole app. Tests pass a fake clock and an in-memory database. */
export function createApp({ config, clock }) {
  const db = openDb(config.dbPath, clock);
  const bans = createBanStore(db, config);
  const detector = createDetector({ db, bans, config, clock });
  const authLog = createAuthLog(config.authLogPath);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (req, res) => res.json({ ok: true, now: clock.now() }));
  app.get('/dashboard', (req, res) => res.sendFile(path.join(publicDir, 'dashboard.html')));

  app.use(publicApiRouter({ bans, clock }));
  app.use('/api/admin', adminRouter({ db, bans, detector, clock, config }));
  app.use(portalRouter({ db, bans, detector, authLog, clock, config, publicDir }));

  app.use((req, res) => res.status(404).json({ error: 'not_found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    if (err.type === 'entity.too.large') return res.status(400).json({ error: 'invalid_input' });
    console.error(err);
    return res.status(500).json({ error: 'internal' });
  });

  return { app, db, bans, detector, authLog };
}
