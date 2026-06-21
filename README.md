# 99 Box

A wall of **99 boxes**. Anyone can lock a short secret (text) into an empty box
behind a password. A single global clock counts down for the whole wall — when
it hits zero, **every box is wiped** and a fresh cycle begins.

## How it works

- Click an **empty** box → write some text + choose a password → it's locked.
- Click a **filled** box (🔒) → enter the box's password → the text is revealed.
- The countdown at the top is shared by everyone. At zero, all 99 boxes clear.

Passwords are never stored in plain text — they're hashed with bcrypt. The
`/api/state` endpoint only reports which boxes are filled, never their contents
or hashes.

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3000.

### Configuration

| Env var    | Default          | Description                                  |
| ---------- | ---------------- | -------------------------------------------- |
| `PORT`     | `3000`           | HTTP port.                                   |
| `CYCLE_MS` | `3600000` (1 hr) | Length of each global cycle in milliseconds. |

For a quick demo of the auto-wipe, run with a short cycle:

```bash
CYCLE_MS=30000 npm start   # wipes every 30 seconds
```

## Tech

- **Backend:** Node + Express, SQLite (`better-sqlite3`), bcrypt hashing.
- **Frontend:** plain HTML/CSS/JS, no build step.
- State (boxes + the cycle deadline) is persisted in `data.db`, so restarts
  resume mid-cycle.

## Notes / future

- Currently boxes hold **text only**. The schema and UI leave room to extend to
  other content types later.
