import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

// SQLite nativo do Node 22+ (node:sqlite) — sem dependência externa.
// Um banco por ambiente: produção (NODE_ENV=production) e dev/local usam
// arquivos separados, para testes locais nunca sujarem os dados de prod.
// DB_PATH sobrescreve qualquer um (ex.: volume persistente no deploy).
const ENV = process.env.NODE_ENV === "production" ? "production" : "dev";
const isProd = ENV === "production";

const DEFAULT_FILE = isProd ? "bomberman.prod.db" : "bomberman.dev.db";

const DB_PATH =
  process.env.DB_PATH ?? join(import.meta.dirname, "..", DEFAULT_FILE);

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    code        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('waiting', 'playing')),
    players     INTEGER NOT NULL,
    max_players INTEGER NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS matches (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code        TEXT NOT NULL,
    room_name        TEXT NOT NULL,
    players          INTEGER NOT NULL,
    winner_id        INTEGER,            -- NULL = empate
    duration_seconds REAL NOT NULL,
    finished_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export interface RoomRow {
  code: string;
  name: string;
  players: number;
  max: number;
  status: "waiting" | "playing";
}

/**
 * Servidor (re)iniciou: nenhuma conexão sobreviveu, então toda sala
 * registrada é lixo da execução anterior. O histórico de partidas fica.
 */
export function clearRooms(): void {
  db.prepare("DELETE FROM rooms").run();
}

export function upsertRoom(room: RoomRow): void {
  db.prepare(
    `INSERT INTO rooms (code, name, status, players, max_players)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET
       status = excluded.status,
       players = excluded.players,
       updated_at = datetime('now')`,
  ).run(room.code, room.name, room.status, room.players, room.max);
}

export function deleteRoom(code: string): void {
  db.prepare("DELETE FROM rooms WHERE code = ?").run(code);
}

export function listRooms(): RoomRow[] {
  return db
    .prepare(
      `SELECT code, name, players, max_players AS max, status
       FROM rooms ORDER BY created_at`,
    )
    .all() as unknown as RoomRow[];
}

export function recordMatch(match: {
  roomCode: string;
  roomName: string;
  players: number;
  winnerId: number | null;
  durationSeconds: number;
}): void {
  db.prepare(
    `INSERT INTO matches (room_code, room_name, players, winner_id, duration_seconds)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    match.roomCode,
    match.roomName,
    match.players,
    match.winnerId,
    match.durationSeconds,
  );
}

export function listMatches(limit = 20): unknown[] {
  return db
    .prepare("SELECT * FROM matches ORDER BY id DESC LIMIT ?")
    .all(limit);
}

console.log(`SQLite [${ENV}] pronto em ${DB_PATH}`);
