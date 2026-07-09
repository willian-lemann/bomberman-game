import "./env"; // PRIMEIRO import: carrega o .env antes de qualquer leitura
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { createGame, update } from "../src/game/game";
import type { GameState, Grid, PlayerInput } from "../src/game/types";
import {
  clearRooms,
  deleteRoom,
  listMatches,
  listRooms,
  recordMatch,
  upsertRoom,
} from "./db";

const PORT = Number(process.env.PORT) || 3001;
const TICK_MS = 1000 / 60;
// simula a 60Hz, transmite a 30Hz — a interpolação do cliente preenche o resto
const BROADCAST_EVERY = 2;

/** Estado transmitido por tick: a grade viaja à parte, só quando muda */
type Snapshot = Omit<GameState, "grid">;

type ServerMessage =
  | {
      type: "lobby";
      players: number;
      max: number;
      countdown: number | null;
      name: string | null;
      /** o primeiro da sala é o dono: só ele pode dar o "começar" */
      host: boolean;
    }
  | { type: "roomCreated"; code: string }
  | { type: "error"; message: string }
  | { type: "start"; playerId: number }
  | { type: "grid"; grid: Grid }
  | { type: "state"; state: Snapshot; acks: number[] }
  | { type: "playerLeft"; playerId: number };

interface Client {
  socket: WebSocket;
  connected: boolean;
  /** pacotes de input numerados aguardando processamento (1 por tick) */
  queue: { seq: number; input: PlayerInput }[];
  /** último input aplicado — mantido quando a fila está vazia */
  input: PlayerInput;
  /** seq do último pacote processado, ecoado no broadcast (ack) */
  lastSeq: number;
  /** apertou bomba desde o último tick (não pode se perder entre frames) */
  pendingBomb: boolean;
}

const idleInput = (): PlayerInput => ({
  up: false,
  down: false,
  left: false,
  right: false,
  bomb: false,
});

/** Salas com partida em andamento — sala vazia é removida daqui e morre */
const activeRooms = new Set<Room>();

/**
 * Uma partida de 2 a 4 jogadores. O servidor é a autoridade: roda a simulação
 * (o MESMO src/game/ do navegador) e transmite o estado a cada tick.
 */
class Room {
  private state: GameState;
  private clients: Client[];
  private interval: ReturnType<typeof setInterval>;
  private tickCount = 0;

  constructor(
    sockets: WebSocket[],
    public readonly name: string,
    public readonly code: string,
  ) {
    this.state = createGame(sockets.length);
    this.clients = sockets.map((socket) => ({
      socket,
      connected: true,
      queue: [],
      input: idleInput(),
      lastSeq: 0,
      pendingBomb: false,
    }));
    activeRooms.add(this);
    upsertRoom({
      code: this.code,
      name: this.name,
      players: sockets.length,
      max: sockets.length,
      status: "playing",
    });
    console.log(
      `Sala "${this.name}" iniciada com ${sockets.length} jogadores (ativas: ${activeRooms.size})`,
    );

    this.clients.forEach((client, i) => {
      // remove os handlers do lobby: daqui em diante a sala cuida do socket
      client.socket.removeAllListeners("message");
      client.socket.removeAllListeners("close");
      send(client.socket, { type: "start", playerId: i + 1 });
      client.socket.on("message", (raw) => this.onMessage(i, raw.toString()));
      client.socket.on("close", () => this.onLeave(i));
    });

    this.broadcast({ type: "grid", grid: this.state.grid });

    this.interval = setInterval(() => this.tick(), TICK_MS);
  }

  private onMessage(index: number, raw: string): void {
    let msg: { type?: string; seq?: number; input?: Partial<PlayerInput> };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "input" && msg.input) {
      const client = this.clients[index];
      client.queue.push({
        seq: Number(msg.seq) || 0,
        input: {
          up: !!msg.input.up,
          down: !!msg.input.down,
          left: !!msg.input.left,
          right: !!msg.input.right,
          bomb: false, // bomba é evento, tratada via pendingBomb
        },
      });
      if (msg.input.bomb) client.pendingBomb = true;
      // cliente travado/malicioso não acumula passos extras de movimento
      if (client.queue.length > 120) client.queue.shift();
    } else if (msg.type === "restart" && this.state.phase === "over") {
      this.state = createGame(this.clients.length);
      // quem desconectou não volta na revanche
      this.clients.forEach((c, i) => {
        if (!c.connected) this.state.players[i].alive = false;
      });
      this.broadcast({ type: "grid", grid: this.state.grid }); // mapa novo
    }
  }

  private tick(): void {
    // 1 pacote de input por tick: o ritmo do jogo é do servidor, não do cliente
    const inputs = this.clients.map((client) => {
      const packet = client.queue.shift();
      if (packet) {
        client.input = packet.input;
        client.lastSeq = packet.seq;
      }
      const input = { ...client.input, bomb: client.pendingBomb };
      client.pendingBomb = false;
      return input;
    });

    const wasPlaying = this.state.phase === "playing";
    update(this.state, TICK_MS / 1000, inputs);

    // rodada terminou neste tick: grava no histórico
    if (wasPlaying && this.state.phase === "over") {
      recordMatch({
        roomCode: this.code,
        roomName: this.name,
        players: this.clients.length,
        winnerId: this.state.winnerId,
        durationSeconds: Math.round(this.state.elapsed * 10) / 10,
      });
    }

    this.tickCount++;
    if (this.tickCount % BROADCAST_EVERY !== 0) return;

    // a grade fica de fora: o cliente deriva destruições das explosões
    const { grid: _grid, ...snapshot } = this.state;
    this.broadcast({
      type: "state",
      state: snapshot,
      acks: this.clients.map((c) => c.lastSeq),
    });
  }

  private broadcast(msg: ServerMessage): void {
    for (const client of this.clients) {
      send(client.socket, msg);
    }
  }

  private onLeave(index: number): void {
    this.clients[index].connected = false;
    // quem saiu morre em jogo — se sobrar um vivo, a vitória sai no próximo tick
    const player = this.state.players[index];
    if (player) player.alive = false;
    this.broadcast({ type: "playerLeft", playerId: index + 1 });

    // ninguém mais na sala: ela é destruída e sai do banco
    const remaining = this.clients.filter((c) => c.connected).length;
    if (remaining === 0) {
      clearInterval(this.interval);
      activeRooms.delete(this);
      deleteRoom(this.code);
      console.log(
        `Sala "${this.name}" vazia: encerrada e deletada (ativas: ${activeRooms.size})`,
      );
    } else {
      upsertRoom({
        code: this.code,
        name: this.name,
        players: remaining,
        max: this.clients.length,
        status: "playing",
      });
    }
  }
}

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

// ---------------------------------------------------------------- lobby

const MAX_PLAYERS = 4;
// com 2+ jogadores a partida começa após a contagem; cada entrada reinicia
const COUNTDOWN_MS = 5000;

/** Sala em formação: jogadores esperando a partida começar */
interface PendingRoom {
  sockets: WebSocket[];
  timer: ReturnType<typeof setTimeout> | null;
  code: string;
  /** null = partida rápida (sem dono, começa por countdown) */
  name: string | null;
}

/** Registra/atualiza a sala em formação no banco */
function persistPending(pending: PendingRoom): void {
  upsertRoom({
    code: pending.code,
    name: pending.name ?? "Partida rápida",
    players: pending.sockets.length,
    max: MAX_PLAYERS,
    status: "waiting",
  });
}

// Partida rápida: uma sala pública em formação por vez — ao encher (ou o
// countdown estourar) ela vira partida e a próxima pessoa abre uma nova
let quickRoom: PendingRoom | null = null;
// Salas privadas em formação, por código
const openRooms = new Map<string, PendingRoom>();

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sem I e O (confundem com 1 e 0)

function generateCode(): string {
  let code: string;
  do {
    code = Array.from(
      { length: 4 },
      () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)],
    ).join("");
  } while (openRooms.has(code) || quickRoom?.code === code);
  return code;
}

function broadcastLobby(pending: PendingRoom): void {
  pending.sockets.forEach((socket, i) => {
    send(socket, {
      type: "lobby",
      players: pending.sockets.length,
      max: MAX_PLAYERS,
      countdown: pending.timer !== null ? COUNTDOWN_MS / 1000 : null,
      name: pending.name,
      host: i === 0,
    });
  });
}

/** Tira a sala em formação dos registros (vai virar partida ou morreu vazia) */
function unregisterPending(pending: PendingRoom): void {
  if (pending.timer !== null) clearTimeout(pending.timer);
  pending.timer = null;
  openRooms.delete(pending.code);
  if (quickRoom === pending) quickRoom = null;
}

function startPending(pending: PendingRoom): void {
  unregisterPending(pending);
  const sockets = pending.sockets.filter(
    (s) => s.readyState === WebSocket.OPEN,
  );
  if (sockets.length >= 2) {
    // o Room assume a linha da sala no banco (status vira 'playing')
    new Room(sockets, pending.name ?? "Partida rápida", pending.code);
  } else {
    deleteRoom(pending.code); // esvaziou antes de começar
  }
}

function joinPending(pending: PendingRoom, socket: WebSocket): void {
  pending.sockets.push(socket);
  if (pending.sockets.length >= MAX_PLAYERS) {
    startPending(pending); // sala cheia: começa já; o próximo abre outra
    return;
  }
  // partida rápida começa sozinha (countdown); sala nomeada espera o dono
  if (pending.name === null && pending.sockets.length >= 2) {
    if (pending.timer !== null) clearTimeout(pending.timer);
    pending.timer = setTimeout(() => startPending(pending), COUNTDOWN_MS);
  }
  persistPending(pending);
  broadcastLobby(pending);
}

function leavePending(socket: WebSocket): void {
  const pendings =
    quickRoom !== null
      ? [quickRoom, ...openRooms.values()]
      : [...openRooms.values()];
  const pending = pendings.find((p) => p.sockets.includes(socket));
  if (pending === undefined) return;

  pending.sockets = pending.sockets.filter((s) => s !== socket);
  if (pending.sockets.length === 0) {
    unregisterPending(pending); // sala em formação vazia: deletada
    deleteRoom(pending.code);
    return;
  }
  if (pending.sockets.length < 2 && pending.timer !== null) {
    clearTimeout(pending.timer);
    pending.timer = null; // sozinho de novo: cancela a contagem
  }
  persistPending(pending);
  broadcastLobby(pending);
}

/** Acha a sala em formação em que o socket está (se estiver em alguma) */
function findPending(socket: WebSocket): PendingRoom | undefined {
  if (quickRoom?.sockets.includes(socket)) return quickRoom;
  return [...openRooms.values()].find((p) => p.sockets.includes(socket));
}

function onLobbyMessage(socket: WebSocket, raw: string): void {
  let msg: { type?: string; code?: string; name?: string };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  switch (msg.type) {
    case "quick":
      if (findPending(socket) !== undefined) return; // já está numa sala
      if (quickRoom === null) {
        quickRoom = {
          sockets: [],
          timer: null,
          code: generateCode(),
          name: null,
        };
      }
      joinPending(quickRoom, socket);
      break;

    case "create": {
      if (findPending(socket) !== undefined) return;
      const code = generateCode();
      const name =
        (typeof msg.name === "string" ? msg.name.trim().slice(0, 24) : "") ||
        `Sala ${code}`;
      const pending: PendingRoom = { sockets: [], timer: null, code, name };
      openRooms.set(code, pending);
      send(socket, { type: "roomCreated", code });
      joinPending(pending, socket);
      break;
    }

    case "join": {
      if (findPending(socket) !== undefined) return;
      const code = (msg.code ?? "").trim().toUpperCase();
      // a partida rápida em formação também aparece na lista e aceita entrada
      const pending =
        openRooms.get(code) ??
        (quickRoom?.code === code ? quickRoom : undefined);
      if (pending === undefined) {
        send(socket, { type: "error", message: `Sala ${code} não encontrada` });
        return;
      }
      joinPending(pending, socket);
      break;
    }

    case "startGame": {
      // só o dono (primeiro da sala) pode dar o começar, e com 2+ presentes
      const pending = findPending(socket);
      if (
        pending !== undefined &&
        pending.sockets[0] === socket &&
        pending.sockets.length >= 2
      ) {
        startPending(pending);
      }
      break;
    }
  }
}

// -------------------------------------------------- HTTP (produção) + WS

// Em produção o mesmo servidor entrega o jogo compilado (dist/) e o WebSocket;
// em desenvolvimento o Vite serve o front e aqui fica só o WebSocket
const DIST = join(import.meta.dirname, "..", "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const httpServer = createServer(async (req, res) => {
  // em dev o front roda em outra porta (Vite); em produção é same-origin
  const cors = { "Access-Control-Allow-Origin": "*" };
  const path = req.url?.split("?")[0] ?? "/";

  // lista pública de salas (lida do SQLite) para o navegador de salas do menu
  if (path === "/rooms") {
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ rooms: listRooms() }));
    return;
  }

  // histórico das últimas partidas (persistido — sobrevive a restarts)
  if (path === "/matches") {
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ matches: listMatches() }));
    return;
  }

  if (!existsSync(DIST)) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Servidor Bomberman no ar (modo dev: o jogo é servido pelo Vite)");
    return;
  }

  const file = normalize(join(DIST, path === "/" ? "index.html" : path));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }

  try {
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Não encontrado");
  }
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (socket) => {
  socket.on("message", (raw) => onLobbyMessage(socket, raw.toString()));
  socket.on("close", () => leavePending(socket));
});

// reinício do servidor: as conexões morreram, então as salas registradas
// são da execução anterior — limpa; o histórico de partidas permanece
clearRooms();

httpServer.listen(PORT, () => {
  console.log(
    `Servidor Bomberman ouvindo em ${PORT} (modo ${process.env.NODE_ENV ?? "desconhecido"})`,
  );
});
