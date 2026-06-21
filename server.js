'use strict';

const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const PORT = process.env.PORT || 3000;
const BOX_COUNT = 99;

// How long each global cycle lasts before EVERY box is wiped, in milliseconds.
// Defaults to 1 hour. Override with CYCLE_MS (e.g. 60000 for a 1-minute demo).
const CYCLE_MS = Number(process.env.CYCLE_MS) || 60 * 60 * 1000;

const MAX_TEXT_LENGTH = 5000;
const MIN_PASSWORD_LENGTH = 1;
const BCRYPT_ROUNDS = 10;

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS boxes (
    id            INTEGER PRIMARY KEY,
    content       TEXT,
    password_hash TEXT,
    filled_at     INTEGER
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

const getMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
const setMeta = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

const selectBox = db.prepare('SELECT * FROM boxes WHERE id = ?');
const selectFilledIds = db.prepare(
  'SELECT id FROM boxes WHERE content IS NOT NULL ORDER BY id'
);
const fillBox = db.prepare(
  'INSERT INTO boxes (id, content, password_hash, filled_at) VALUES (?, ?, ?, ?)'
);
const wipeAll = db.prepare('DELETE FROM boxes');

// ---------------------------------------------------------------------------
// Global clock cycle
//
// A single timestamp (cycleEndsAt) governs the whole wall. When the clock
// passes that timestamp, every box is wiped and the clock rolls forward to
// the next boundary. The boundary is persisted so restarts pick up where
// they left off.
// ---------------------------------------------------------------------------
function loadCycleEndsAt() {
  const row = getMeta.get('cycleEndsAt');
  if (row) return Number(row.value);
  const endsAt = Date.now() + CYCLE_MS;
  setMeta.run('cycleEndsAt', String(endsAt));
  return endsAt;
}

let cycleEndsAt = loadCycleEndsAt();

// Advance the cycle if it has expired, wiping all boxes. Runs lazily on every
// request and also on a timer, so it stays correct whether or not traffic
// arrives exactly at the boundary.
function tickCycle() {
  const now = Date.now();
  if (now < cycleEndsAt) return false;

  // Jump forward to the next future boundary (handles long idle gaps where
  // several cycles may have elapsed at once).
  const elapsed = now - cycleEndsAt;
  const skipped = Math.floor(elapsed / CYCLE_MS) + 1;
  cycleEndsAt = cycleEndsAt + skipped * CYCLE_MS;

  wipeAll.run();
  setMeta.run('cycleEndsAt', String(cycleEndsAt));
  return true;
}

// Wipe promptly at the boundary even when idle.
setInterval(tickCycle, 1000).unref();

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Keep the cycle fresh before handling any API request.
app.use('/api', (req, res, next) => {
  tickCycle();
  next();
});

// Public state: which boxes are filled, plus the shared countdown. Never
// exposes content or password hashes.
app.get('/api/state', (req, res) => {
  const filled = selectFilledIds.all().map((r) => r.id);
  res.json({
    boxCount: BOX_COUNT,
    filled,
    cycleEndsAt,
    cycleMs: CYCLE_MS,
    serverNow: Date.now(),
  });
});

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1 || id > BOX_COUNT) return null;
  return id;
}

// Fill an empty box with text locked behind a password.
app.post('/api/boxes/:id/fill', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid box number.' });

  const { text, password } = req.body || {};
  if (typeof text !== 'string' || text.trim() === '') {
    return res.status(400).json({ error: 'Text is required.' });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return res
      .status(400)
      .json({ error: `Text must be ${MAX_TEXT_LENGTH} characters or fewer.` });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: 'A password is required.' });
  }

  if (selectBox.get(id)) {
    return res.status(409).json({ error: 'That box is already taken.' });
  }

  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  try {
    fillBox.run(id, text, hash, Date.now());
  } catch (err) {
    // Race: another request grabbed the box between the check and insert.
    return res.status(409).json({ error: 'That box is already taken.' });
  }

  res.status(201).json({ ok: true, id });
});

// Open a filled box by supplying its password.
app.post('/api/boxes/:id/open', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid box number.' });

  const { password } = req.body || {};
  if (typeof password !== 'string') {
    return res.status(400).json({ error: 'A password is required.' });
  }

  const box = selectBox.get(id);
  if (!box || box.content === null) {
    return res.status(404).json({ error: 'That box is empty.' });
  }

  if (!bcrypt.compareSync(password, box.password_hash)) {
    return res.status(401).json({ error: 'Wrong password.' });
  }

  res.json({ ok: true, id, text: box.content });
});

app.listen(PORT, () => {
  console.log(`99-box listening on http://localhost:${PORT}`);
  console.log(`Cycle length: ${CYCLE_MS} ms (${(CYCLE_MS / 1000).toFixed(0)}s)`);
});
