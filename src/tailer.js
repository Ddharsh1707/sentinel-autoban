import fs from 'node:fs';
import path from 'node:path';

/**
 * Follows external log files (LOG_FILES). Each file is read from its end at startup, so old lines
 * are never replayed. New complete lines go to the detector; a partial last line waits for its "\n".
 * If a file shrinks (rotated or truncated) it is read again from the start.
 */
export function createTailer({ files, detector, intervalMs, skipPath, logger = console }) {
  const skip = skipPath ? path.resolve(skipPath) : null;
  const states = files
    .map((f) => path.resolve(f))
    .filter((f) => {
      if (f === skip) {
        logger.warn(`[tailer] skipping ${f}: the portal already processes its own auth log`);
        return false;
      }
      return true;
    })
    .map((file) => ({ file, pos: sizeOf(file), rest: '' }));

  function sizeOf(file) {
    try {
      return fs.statSync(file).size;
    } catch {
      return 0;
    }
  }

  function poll() {
    const bansCreated = [];
    for (const s of states) {
      const size = sizeOf(s.file);
      if (size < s.pos) {
        s.pos = 0;
        s.rest = '';
      }
      if (size === s.pos) continue;

      const fd = fs.openSync(s.file, 'r');
      try {
        const buf = Buffer.alloc(size - s.pos);
        fs.readSync(fd, buf, 0, buf.length, s.pos);
        s.pos = size;
        const lines = (s.rest + buf.toString('utf8')).split('\n');
        s.rest = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const result = detector.ingestLine(line, 'file');
          if (result?.ban) {
            bansCreated.push(result.ban);
            logger.log(`[ban] ${result.ban.ip} until ${new Date(result.ban.until).toISOString()} (from ${s.file})`);
          }
        }
      } finally {
        fs.closeSync(fd);
      }
    }
    return bansCreated;
  }

  let timer = null;
  return {
    files: states.map((s) => s.file),
    poll,
    start() {
      if (states.length && !timer) timer = setInterval(poll, intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
