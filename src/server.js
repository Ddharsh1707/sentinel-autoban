import { loadConfig } from './config.js';
import { systemClock } from './clock.js';
import { createApp } from './app.js';
import { createTailer } from './tailer.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const clock = systemClock();
const { app, detector, authLog } = createApp({ config, clock });

const tailer = createTailer({
  files: config.logFiles,
  detector,
  intervalMs: config.tailIntervalMs,
  skipPath: authLog.path,
});
tailer.start();

app.listen(config.port, () => {
  console.log(`Sentinel running on http://localhost:${config.port}`);
  console.log(`  Portal login : http://localhost:${config.port}/`);
  console.log(`  Dashboard    : http://localhost:${config.port}/dashboard`);
  console.log(
    `  Rule         : ${config.threshold} failures in ${config.windowSeconds}s -> ban ${config.banDurationSeconds}s` +
      (config.escalation ? ' (escalating)' : ''),
  );
  console.log(`  Trust proxy  : ${config.trustProxy}`);
  if (tailer.files.length) console.log(`  Following    : ${tailer.files.join(', ')}`);
  if (config.adminTokenGenerated) {
    console.log(`  Admin token  : ${config.adminToken}  (generated; set ADMIN_TOKEN in .env to fix it)`);
  }
});
