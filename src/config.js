import crypto from 'node:crypto';

const DEFAULTS = {
  PORT: '3000',
  THRESHOLD: '10',
  WINDOW_SECONDS: '60',
  BAN_DURATION_SECONDS: '60',
  ESCALATION: 'true',
  MAX_BAN_SECONDS: '86400',
  TRUST_PROXY: 'false',
  LOG_FILES: '',
  TAIL_INTERVAL_MS: '500',
  DB_PATH: 'data/sentinel.db',
  AUTH_LOG_PATH: 'logs/auth.log',
};

function positiveInt(name, raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Config error: ${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

function bool(name, raw) {
  const v = String(raw).trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  throw new Error(`Config error: ${name} must be true or false, got "${raw}"`);
}

export function loadConfig(env = process.env) {
  const get = (name) => (env[name] !== undefined && env[name] !== '' ? env[name] : DEFAULTS[name]);

  const adminTokenFromEnv = env.ADMIN_TOKEN && env.ADMIN_TOKEN.trim();

  return {
    port: positiveInt('PORT', get('PORT')),
    threshold: positiveInt('THRESHOLD', get('THRESHOLD')),
    windowSeconds: positiveInt('WINDOW_SECONDS', get('WINDOW_SECONDS')),
    banDurationSeconds: positiveInt('BAN_DURATION_SECONDS', get('BAN_DURATION_SECONDS')),
    escalation: bool('ESCALATION', get('ESCALATION')),
    maxBanSeconds: positiveInt('MAX_BAN_SECONDS', get('MAX_BAN_SECONDS')),
    trustProxy: bool('TRUST_PROXY', get('TRUST_PROXY')),
    logFiles: String(get('LOG_FILES') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    tailIntervalMs: positiveInt('TAIL_INTERVAL_MS', get('TAIL_INTERVAL_MS')),
    dbPath: get('DB_PATH'),
    authLogPath: get('AUTH_LOG_PATH'),
    adminToken: adminTokenFromEnv || crypto.randomBytes(18).toString('base64url'),
    adminTokenGenerated: !adminTokenFromEnv,
  };
}
