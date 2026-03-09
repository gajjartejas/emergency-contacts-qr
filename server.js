'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

const APP_VERSION = '1.0.0';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 2 * 1024 * 1024);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 4 * 1024 * 1024);
const API_TOKEN = process.env.API_TOKEN || '';
const REQUIRE_TOKEN = String(process.env.REQUIRE_TOKEN || '').toLowerCase() === 'true';

const IMAGE_MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg'
};

const IMAGE_MIME_ALLOWED_EXT = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'image/svg+xml': ['.svg']
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function nowIso() {
  return new Date().toISOString();
}

function randomId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function defaultData() {
  return {
    meta: {
      version: '1.0',
      schema_version: 1,
      updated_at: nowIso()
    },
    contacts: [],
    qrcodes: []
  };
}

async function ensureStore() {
  await fsp.mkdir(PUBLIC_DIR, { recursive: true });
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });

  try {
    await fsp.access(DATA_FILE, fs.constants.F_OK);
  } catch {
    const initial = JSON.stringify(defaultData(), null, 2);
    await fsp.writeFile(DATA_FILE, initial, 'utf8');
  }
}

function normalizeText(value, maxLen) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length > maxLen) return trimmed.slice(0, maxLen);
  return trimmed;
}

function normalizePhone(value) {
  const raw = normalizeText(value, 32);
  const cleaned = raw.replace(/[^0-9+()\-\s]/g, '');
  return cleaned;
}

function normalizeUrl(value) {
  const raw = normalizeText(value, 4096);
  if (!raw) return '';
  return raw;
}

function normalizeContact(contact) {
  const name = normalizeText(contact?.name, 80);
  const phone = normalizePhone(contact?.phone);
  if (!name || !phone) return null;
  return {
    id: normalizeText(contact?.id, 64) || randomId(),
    name,
    phone,
    created_at: normalizeText(contact?.created_at, 64) || nowIso(),
    deleted_at: normalizeText(contact?.deleted_at || '', 64)
  };
}

function normalizeQr(qr) {
  const label = normalizeText(qr?.label, 100);
  const data = normalizeUrl(qr?.data);
  const upiId = normalizeText(qr?.upi_id || '', 120);
  if (!label || !data) return null;
  return {
    id: normalizeText(qr?.id, 64) || randomId(),
    label,
    upi_id: upiId,
    data,
    created_at: normalizeText(qr?.created_at, 64) || nowIso()
  };
}

function sanitizeData(payload) {
  const base = defaultData();
  const contacts = Array.isArray(payload?.contacts) ? payload.contacts : [];
  const qrcodes = Array.isArray(payload?.qrcodes) ? payload.qrcodes : [];

  base.contacts = contacts.map(normalizeContact).filter(Boolean);
  base.qrcodes = qrcodes.map(normalizeQr).filter(Boolean);

  if (payload?.meta && typeof payload.meta === 'object') {
    const version = normalizeText(payload.meta.version, 20);
    base.meta.version = version || base.meta.version;
  }

  base.meta.updated_at = nowIso();
  return base;
}

function mergeData(existing, incoming) {
  const existingContacts = new Map(existing.contacts.map((item) => [item.id, item]));
  for (const item of incoming.contacts) {
    existingContacts.set(item.id, item);
  }

  const existingQr = new Map(existing.qrcodes.map((item) => [item.id, item]));
  for (const item of incoming.qrcodes) {
    existingQr.set(item.id, item);
  }

  return {
    meta: {
      version: incoming.meta.version || existing.meta.version || '1.0',
      schema_version: 1,
      updated_at: nowIso()
    },
    contacts: [...existingContacts.values()],
    qrcodes: [...existingQr.values()]
  };
}

async function readStore() {
  const raw = await fsp.readFile(DATA_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  return sanitizeData(parsed);
}

async function writeStore(data) {
  const sanitized = sanitizeData(data);
  const tempFile = `${DATA_FILE}.tmp`;
  await fsp.writeFile(tempFile, JSON.stringify(sanitized, null, 2), 'utf8');
  await fsp.rename(tempFile, DATA_FILE);
  return sanitized;
}

function send(res, status, payload, headers = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const baseHeaders = {
    'Content-Type': typeof payload === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  };
  res.writeHead(status, baseHeaders);
  res.end(body);
}

function isAuthorized(req) {
  if (!REQUIRE_TOKEN || !API_TOKEN) {
    return true;
  }

  const provided = req.headers['x-api-token'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  return provided === API_TOKEN;
}

function parseBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) {
          resolve({});
          return;
        }
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', (error) => reject(error));
  });
}

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl || '');
  if (!match) {
    throw new Error('Invalid data URL format');
  }

  const mime = match[1].toLowerCase();
  if (!IMAGE_MIME_EXT[mime]) {
    throw new Error('Unsupported image MIME type');
  }

  const base64 = match[2].replace(/\s/g, '');
  const buffer = Buffer.from(base64, 'base64');

  if (!buffer.length) {
    throw new Error('Empty image data');
  }

  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`Image exceeds max size of ${MAX_UPLOAD_BYTES} bytes`);
  }

  return { mime, buffer };
}

function getFileExt(fileName) {
  const cleaned = normalizeText(fileName, 120);
  if (!cleaned) return '';
  return path.extname(cleaned).toLowerCase();
}

async function handleApi(req, res, pathname) {
  if (!isAuthorized(req)) {
    send(res, 401, { error: 'Unauthorized' });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/v1/health') {
    send(res, 200, { ok: true, version: APP_VERSION, time: nowIso() });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/v1/data') {
    const data = await readStore();
    send(res, 200, data);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/v1/data') {
    let payload;
    try {
      payload = await parseBody(req, MAX_BODY_BYTES);
    } catch (error) {
      send(res, 400, { error: error.message });
      return true;
    }

    const mode = payload?.mode === 'merge' ? 'merge' : 'overwrite';
    const incoming = sanitizeData(payload);
    let toWrite = incoming;

    if (mode === 'merge') {
      const current = await readStore();
      toWrite = mergeData(current, incoming);
    }

    const saved = await writeStore(toWrite);
    send(res, 200, { ok: true, mode, data: saved });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/v1/upload') {
    let payload;
    try {
      payload = await parseBody(req, MAX_BODY_BYTES);
    } catch (error) {
      send(res, 400, { error: error.message });
      return true;
    }

    const dataUrl = normalizeUrl(payload?.dataUrl);
    const fileName = normalizeText(payload?.fileName, 120);
    if (!dataUrl) {
      send(res, 400, { error: 'dataUrl is required' });
      return true;
    }

    let parsed;
    try {
      parsed = parseDataUrl(dataUrl);
    } catch (error) {
      send(res, 400, { error: error.message });
      return true;
    }

    if (fileName) {
      const suppliedExt = getFileExt(fileName);
      if (!suppliedExt) {
        send(res, 400, { error: 'Uploaded filename extension is required' });
        return true;
      }
      const allowed = IMAGE_MIME_ALLOWED_EXT[parsed.mime] || [];
      if (!allowed.includes(suppliedExt)) {
        send(res, 400, { error: 'Filename extension does not match MIME type' });
        return true;
      }
    }

    const id = randomId();
    const storedFileName = `${id}${IMAGE_MIME_EXT[parsed.mime]}`;
    const filePath = path.join(UPLOADS_DIR, storedFileName);
    await fsp.writeFile(filePath, parsed.buffer);

    send(res, 201, {
      ok: true,
      id,
      url: `/uploads/${storedFileName}`,
      mime: parsed.mime,
      size: parsed.buffer.length,
      created_at: nowIso()
    });
    return true;
  }

  return false;
}

function safeJoin(base, target) {
  const targetPath = path.normalize(path.join(base, target));
  if (!targetPath.startsWith(base)) {
    return null;
  }
  return targetPath;
}

async function serveFile(req, res, filePath) {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      send(res, 404, 'Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const dynamicAssets = new Set(['.html', '.js', '.css', '.webmanifest']);
    const cacheControl = dynamicAssets.has(ext) ? 'no-cache' : 'public, max-age=604800';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff'
    });

    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    send(res, 404, 'Not Found');
  }
}

async function handler(req, res) {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    if (pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, pathname);
      if (!handled) {
        send(res, 404, { error: 'API route not found' });
      }
      return;
    }

    if (pathname.startsWith('/uploads/')) {
      const relative = pathname.slice('/uploads/'.length);
      const filePath = safeJoin(UPLOADS_DIR, relative);
      if (!filePath) {
        send(res, 400, 'Invalid path');
        return;
      }
      await serveFile(req, res, filePath);
      return;
    }

    let requestedPath = pathname === '/' ? '/index.html' : pathname;
    requestedPath = requestedPath.replace(/^\/+/, '');

    const filePath = safeJoin(PUBLIC_DIR, requestedPath);
    if (!filePath) {
      send(res, 400, 'Invalid path');
      return;
    }

    await serveFile(req, res, filePath);
  } catch (error) {
    send(res, 500, { error: 'Server error', detail: error.message });
  }
}

async function start() {
  await ensureStore();

  const server = http.createServer((req, res) => {
    handler(req, res);
  });

  server.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`Emergency contacts app running at http://${HOST}:${PORT}`);
    // eslint-disable-next-line no-console
    console.log(`Data file: ${DATA_FILE}`);
    if (REQUIRE_TOKEN && API_TOKEN) {
      // eslint-disable-next-line no-console
      console.log('API token auth is enabled.');
    } else {
      // eslint-disable-next-line no-console
      console.log('API token auth is disabled. Set REQUIRE_TOKEN=true and API_TOKEN to enable.');
    }
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', error);
  process.exit(1);
});
