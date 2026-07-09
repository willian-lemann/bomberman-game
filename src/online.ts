import { BOMB_FUSE } from './game/constants';
import { solidFor } from './game/game';
import { movePlayer } from './game/movement';
import {
  Cell,
  type Bomb,
  type GameState,
  type Grid,
  type Player,
  type PlayerInput,
} from './game/types';
import { createKeyboard } from './input';
import { render } from './render/renderer';

/** Mesmo passo fixo do servidor: predição e simulação andam em sincronia */
const FIXED_DT = 1 / 60;
/** Oponente é desenhado este tanto no passado, interpolando entre estados
 *  (~3 intervalos do broadcast de 30Hz do servidor) */
const INTERP_DELAY_MS = 100;
/** Divergência de predição acima disso vira snap; abaixo, correção suave */
const MAX_SMOOTH_ERROR = 0.5;

export type LobbyRequest =
  | { type: 'quick' }
  | { type: 'create'; name: string }
  | { type: 'join'; code: string };

/** Base HTTP do servidor do jogo (para o endpoint /rooms) */
export function serverHttpBase(): string {
  return import.meta.env.DEV ? `http://${location.hostname}:3001` : '';
}

/**
 * Modo online: o servidor é a autoridade, mas o SEU jogador responde na hora.
 *
 * - Predição: cada input é aplicado localmente no mesmo instante em que é
 *   enviado (numerado com `seq`), usando a mesma física de src/game/.
 * - Reconciliação: quando o estado oficial chega, partimos da posição do
 *   servidor e reaplicamos só os inputs que ele ainda não viu (seq > ack).
 *   Divergências raras (ex.: power-up que não sabíamos) são corrigidas
 *   suavemente ao longo de alguns frames, não com um "pulo".
 * - Interpolação: o oponente é desenhado ~100ms no passado, deslizando entre
 *   os dois últimos estados conhecidos em vez de teleportar a cada pacote.
 * - Grade local: o servidor manda o mapa uma vez por rodada; as destruições
 *   são derivadas das explosões (a chama sempre inclui o bloco que destruiu).
 * - Bomba fantasma: a sua bomba aparece na hora; o servidor confirma depois.
 */
export function startOnline(
  ctx: CanvasRenderingContext2D,
  statusEl: HTMLElement,
  request: LobbyRequest,
  onError: () => void,
): void {
  // Em desenvolvimento o servidor é um processo separado na 3001;
  // em produção HTTP e WebSocket dividem a mesma porta/origem
  const url = import.meta.env.DEV
    ? `ws://${location.hostname}:3001`
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  const ws = new WebSocket(url);
  const keyboard = createKeyboard();
  const spinner = document.querySelector<HTMLElement>('#spinner');
  const startBtn = document.querySelector<HTMLButtonElement>('#btn-start');

  /** loader girando enquanto se espera algo (conexão, jogadores) */
  function setWaiting(waiting: boolean): void {
    if (spinner) spinner.hidden = !waiting;
  }

  if (startBtn) {
    startBtn.onclick = () => {
      ws.send(JSON.stringify({ type: 'startGame' }));
      startBtn.hidden = true;
    };
  }

  let myId = 0;
  let roomCode: string | null = null;
  let seq = 0;
  /** inputs enviados que o servidor ainda não confirmou (para reconciliar) */
  let pendingInputs: { seq: number; input: PlayerInput }[] = [];
  /** meu jogador previsto localmente */
  let predicted: Player | null = null;
  /** grade mantida localmente (chega uma vez por rodada) */
  let grid: Grid | null = null;
  /** últimos estados do servidor com o momento em que chegaram */
  let snapshots: { t: number; state: GameState }[] = [];
  /** minhas bombas previstas, aguardando confirmação do servidor */
  let ghostBombs: { seq: number; bomb: Bomb }[] = [];
  /** resto de divergência da predição, drenado suavemente a cada frame */
  const correction = { x: 0, y: 0 };
  /** bomba apertada aguardando o próximo passo fixo (não pode se perder) */
  let bombLatch = false;

  statusEl.textContent = 'Conectando ao servidor...';
  setWaiting(true);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify(request));
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case 'lobby': {
        const room =
          msg.name !== null
            ? `${msg.name}${roomCode !== null ? ` (código ${roomCode})` : ''} — `
            : '';
        let detail: string;
        if (msg.countdown !== null) {
          detail = ` · começa em ~${msg.countdown}s (cada entrada reinicia a contagem)`;
        } else if (msg.name !== null && msg.players >= 2) {
          detail = msg.host
            ? ' · você decide quando começar!'
            : ' · aguardando o dono da sala começar...';
        } else {
          detail = ' · aguardando mais jogadores...';
        }
        statusEl.textContent = `${room}${msg.players}/${msg.max} jogadores${detail}`;
        // o dono pode começar a partida com 2+ na sala nomeada
        if (startBtn) startBtn.hidden = !(msg.host && msg.players >= 2);
        setWaiting(true);
        break;
      }
      case 'roomCreated':
        roomCode = msg.code;
        statusEl.textContent = `Sala criada! Código: ${msg.code} — ela já aparece na lista para todo mundo`;
        break;
      case 'error':
        statusEl.textContent = `⚠️ ${msg.message}`;
        setWaiting(false);
        if (startBtn) startBtn.hidden = true;
        ws.close();
        onError();
        break;
      case 'start':
        myId = msg.playerId;
        statusEl.textContent = `Você é o Jogador ${myId} — boa sorte! 💣`;
        setWaiting(false);
        if (startBtn) startBtn.hidden = true;
        break;
      case 'grid':
        // mapa novo (início de rodada): zera tudo que era da rodada anterior
        grid = msg.grid;
        snapshots = [];
        ghostBombs = [];
        correction.x = 0;
        correction.y = 0;
        break;
      case 'state':
        onSnapshot(msg.state, msg.acks?.[myId - 1] ?? 0);
        break;
      case 'playerLeft':
        statusEl.textContent = `Jogador ${msg.playerId} saiu da partida`;
        break;
    }
  });

  ws.addEventListener('close', () => {
    if (myId === 0 && statusEl.textContent?.startsWith('Conectando')) {
      statusEl.textContent =
        'Não conectou. O servidor está rodando? (npm run server)';
      onError();
    }
    setWaiting(false);
    if (startBtn) startBtn.hidden = true;
  });

  window.addEventListener('keydown', (e) => {
    const latest = snapshots[snapshots.length - 1];
    if (e.code === 'KeyR' && latest?.state.phase === 'over') {
      ws.send(JSON.stringify({ type: 'restart' }));
    }
  });

  function onSnapshot(snapshot: Omit<GameState, 'grid'>, ack: number): void {
    if (grid === null) return; // a grade sempre chega antes do primeiro estado

    // #1: deriva destruições — chama em cima de bloco = bloco destruído
    // (idempotente: Block→Floor só acontece uma vez por célula)
    for (const explosion of snapshot.explosions) {
      for (const { row, col } of explosion.cells) {
        if (grid[row]?.[col] === Cell.Block) grid[row][col] = Cell.Floor;
      }
    }

    const state: GameState = { ...snapshot, grid };
    snapshots.push({ t: performance.now(), state });
    if (snapshots.length > 30) snapshots.shift();

    // #2: bomba confirmada pelo servidor (ou rejeitada) deixa de ser fantasma
    ghostBombs = ghostBombs.filter((g) => {
      const confirmed = state.bombs.some(
        (b) => b.row === g.bomb.row && b.col === g.bomb.col,
      );
      return !confirmed && ack < g.seq;
    });

    if (myId > 0) reconcile(state, ack);
  }

  /** Volta para a verdade do servidor e reaplica o que ele ainda não processou */
  function reconcile(state: GameState, ack: number): void {
    pendingInputs = pendingInputs.filter((p) => p.seq > ack);

    const serverMe = state.players[myId - 1];
    if (!serverMe) return;

    const before = predicted;
    predicted = { ...serverMe };
    if (serverMe.alive && state.phase === 'playing') {
      const solid = solidFor(state, predicted);
      for (const p of pendingInputs) {
        movePlayer(solid, predicted, p.input, FIXED_DT);
      }
    }

    // #3: divergência pequena vira offset visual drenado aos poucos;
    // grande (morte, teleporte) corrige na hora
    if (before !== null) {
      const errX = before.x + correction.x - predicted.x;
      const errY = before.y + correction.y - predicted.y;
      if (Math.hypot(errX, errY) < MAX_SMOOTH_ERROR) {
        correction.x = errX;
        correction.y = errY;
      } else {
        correction.x = 0;
        correction.y = 0;
      }
    }
  }

  /** Prevê a colocação da própria bomba com as mesmas regras do servidor */
  function tryGhostBomb(atSeq: number): void {
    const latest = snapshots[snapshots.length - 1];
    if (!latest || !predicted) return;

    const row = Math.floor(predicted.y);
    const col = Math.floor(predicted.x);
    const allBombs = [...latest.state.bombs, ...ghostBombs.map((g) => g.bomb)];

    const occupied = allBombs.some((b) => b.row === row && b.col === col);
    const mine =
      latest.state.bombs.filter((b) => b.ownerId === myId).length +
      ghostBombs.length;
    if (occupied || mine >= predicted.maxBombs) return;

    ghostBombs.push({
      seq: atSeq,
      bomb: {
        row,
        col,
        ownerId: myId,
        timer: BOMB_FUSE,
        range: predicted.bombRange,
        passThrough: [myId],
      },
    });
  }

  /** Estado para desenhar: eu previsto (+correção), oponente interpolado,
   *  bombas do servidor + fantasmas, resto do último snapshot */
  function displayState(now: number): GameState | null {
    if (snapshots.length === 0) return null;
    const latest = snapshots[snapshots.length - 1];

    const renderTime = now - INTERP_DELAY_MS;
    let s0 = latest;
    let s1 = latest;
    for (let i = snapshots.length - 1; i > 0; i--) {
      if (snapshots[i - 1].t <= renderTime) {
        s0 = snapshots[i - 1];
        s1 = snapshots[i];
        break;
      }
    }
    const span = s1.t - s0.t;
    const alpha = span > 0 ? Math.min(Math.max((renderTime - s0.t) / span, 0), 1) : 1;

    const players = latest.state.players.map((p, i) => {
      if (i === myId - 1 && predicted) {
        return { ...predicted, x: predicted.x + correction.x, y: predicted.y + correction.y };
      }
      const p0 = s0.state.players[i];
      const p1 = s1.state.players[i];
      if (!p0 || !p1) return p;
      return { ...p1, x: p0.x + (p1.x - p0.x) * alpha, y: p0.y + (p1.y - p0.y) * alpha };
    });

    return {
      ...latest.state,
      players,
      bombs: [...latest.state.bombs, ...ghostBombs.map((g) => g.bomb)],
    };
  }

  let lastTime = performance.now();
  let accumulator = 0;

  function frame(now: number): void {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    // WASD e setas valem igual: só existe "o meu jogador" neste teclado
    const [a, b] = keyboard.getInputs();
    const held = {
      up: a.up || b.up,
      down: a.down || b.down,
      left: a.left || b.left,
      right: a.right || b.right,
    };
    if (a.bomb || b.bomb) bombLatch = true;

    const latest = snapshots[snapshots.length - 1];
    const playing =
      myId > 0 &&
      ws.readyState === WebSocket.OPEN &&
      predicted !== null &&
      latest !== undefined &&
      latest.state.phase === 'playing';

    if (playing) {
      accumulator += dt;
      while (accumulator >= FIXED_DT) {
        accumulator -= FIXED_DT;
        const input: PlayerInput = { ...held, bomb: bombLatch };
        bombLatch = false;

        seq++;
        ws.send(JSON.stringify({ type: 'input', seq, input }));
        pendingInputs.push({ seq, input });
        if (pendingInputs.length > 120) pendingInputs.shift();

        if (predicted!.alive) {
          if (input.bomb) tryGhostBomb(seq);
          // predição: mesmo movimento que o servidor fará com este input
          movePlayer(solidFor(latest.state, predicted!), predicted!, input, FIXED_DT);
        }
      }
    } else {
      accumulator = 0;
    }

    // #3: drena a correção suavemente (~80ms para sumir)
    const decay = Math.exp(-12 * dt);
    correction.x = Math.abs(correction.x) < 0.001 ? 0 : correction.x * decay;
    correction.y = Math.abs(correction.y) < 0.001 ? 0 : correction.y * decay;

    // fantasmas pulsam como bombas de verdade enquanto esperam confirmação
    for (const g of ghostBombs) g.bomb.timer -= dt;

    const display = displayState(now);
    if (display) render(ctx, display);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
