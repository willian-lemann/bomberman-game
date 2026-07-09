import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { createGame, update } from '../src/game/game';
import type { GameState, PlayerInput } from '../src/game/types';

const PORT = Number(process.env.PORT) || 3001;
const TICK_MS = 1000 / 60;

type ServerMessage =
  | { type: 'waiting' }
  | { type: 'roomCreated'; code: string }
  | { type: 'error'; message: string }
  | { type: 'start'; playerId: number }
  | { type: 'state'; state: GameState }
  | { type: 'opponentLeft' };

interface Client {
  socket: WebSocket;
  input: PlayerInput;
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

/**
 * Uma partida de 2 jogadores. O servidor é a autoridade: roda a simulação
 * (o MESMO src/game/ do navegador) e transmite o estado a cada tick.
 */
class Room {
  private state = createGame();
  private clients: Client[];
  private interval: ReturnType<typeof setInterval>;

  constructor(sockets: [WebSocket, WebSocket]) {
    this.clients = sockets.map((socket) => ({
      socket,
      input: idleInput(),
      pendingBomb: false,
    }));

    this.clients.forEach((client, i) => {
      // remove os handlers do lobby: daqui em diante a sala cuida do socket
      client.socket.removeAllListeners('message');
      client.socket.removeAllListeners('close');
      send(client.socket, { type: 'start', playerId: i + 1 });
      client.socket.on('message', (raw) => this.onMessage(i, raw.toString()));
      client.socket.on('close', () => this.onLeave(i));
    });

    this.interval = setInterval(() => this.tick(), TICK_MS);
  }

  private onMessage(index: number, raw: string): void {
    let msg: { type?: string; input?: Partial<PlayerInput> };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'input' && msg.input) {
      const client = this.clients[index];
      client.input = {
        up: !!msg.input.up,
        down: !!msg.input.down,
        left: !!msg.input.left,
        right: !!msg.input.right,
        bomb: false, // bomba é evento, tratada via pendingBomb
      };
      if (msg.input.bomb) client.pendingBomb = true;
    } else if (msg.type === 'restart' && this.state.phase === 'over') {
      this.state = createGame();
    }
  }

  private tick(): void {
    const inputs = this.clients.map((c) => ({
      ...c.input,
      bomb: c.pendingBomb,
    }));
    this.clients.forEach((c) => (c.pendingBomb = false));

    update(this.state, TICK_MS / 1000, inputs);

    const msg: ServerMessage = { type: 'state', state: this.state };
    for (const client of this.clients) {
      send(client.socket, msg);
    }
  }

  private onLeave(index: number): void {
    clearInterval(this.interval);
    const other = this.clients[1 - index];
    if (other.socket.readyState === WebSocket.OPEN) {
      send(other.socket, { type: 'opponentLeft' });
      other.socket.close();
    }
  }
}

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

// ---------------------------------------------------------------- lobby

// Partida rápida: o primeiro a chegar espera; o segundo fecha a dupla
let quickWaiting: WebSocket | null = null;
// Salas privadas aguardando o segundo jogador, por código
const openRooms = new Map<string, WebSocket>();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem I e O (confundem com 1 e 0)

function generateCode(): string {
  let code: string;
  do {
    code = Array.from(
      { length: 4 },
      () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)],
    ).join('');
  } while (openRooms.has(code));
  return code;
}

function onLobbyMessage(socket: WebSocket, raw: string): void {
  let msg: { type?: string; code?: string };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  switch (msg.type) {
    case 'quick':
      if (quickWaiting !== null && quickWaiting.readyState === WebSocket.OPEN) {
        const pair: [WebSocket, WebSocket] = [quickWaiting, socket];
        quickWaiting = null;
        new Room(pair);
      } else {
        quickWaiting = socket;
        send(socket, { type: 'waiting' });
      }
      break;

    case 'create': {
      const code = generateCode();
      openRooms.set(code, socket);
      send(socket, { type: 'roomCreated', code });
      break;
    }

    case 'join': {
      const code = (msg.code ?? '').trim().toUpperCase();
      const host = openRooms.get(code);
      if (host === undefined || host.readyState !== WebSocket.OPEN) {
        send(socket, { type: 'error', message: `Sala ${code} não encontrada` });
        return;
      }
      openRooms.delete(code);
      new Room([host, socket]);
      break;
    }
  }
}

// -------------------------------------------------- HTTP (produção) + WS

// Em produção o mesmo servidor entrega o jogo compilado (dist/) e o WebSocket;
// em desenvolvimento o Vite serve o front e aqui fica só o WebSocket
const DIST = join(import.meta.dirname, '..', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const httpServer = createServer(async (req, res) => {
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Servidor Bomberman no ar (modo dev: o jogo é servido pelo Vite)');
    return;
  }

  const path = req.url?.split('?')[0] ?? '/';
  const file = normalize(join(DIST, path === '/' ? 'index.html' : path));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }

  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
  }
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (socket) => {
  socket.on('message', (raw) => onLobbyMessage(socket, raw.toString()));
  socket.on('close', () => {
    if (quickWaiting === socket) quickWaiting = null;
    for (const [code, host] of openRooms) {
      if (host === socket) openRooms.delete(code);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Servidor Bomberman ouvindo em http://localhost:${PORT}`);
});
