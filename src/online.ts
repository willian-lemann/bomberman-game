import { solidFor } from './game/game';
import { movePlayer } from './game/movement';
import type { GameState, Player, PlayerInput } from './game/types';
import { createKeyboard } from './input';
import { render } from './render/renderer';

/** Mesmo passo fixo do servidor: predição e simulação andam em sincronia */
const FIXED_DT = 1 / 60;
/** Oponente é desenhado este tanto no passado, interpolando entre estados */
const INTERP_DELAY_MS = 100;

export type LobbyRequest =
  | { type: 'quick' }
  | { type: 'create' }
  | { type: 'join'; code: string };

/**
 * Modo online: o servidor é a autoridade, mas o SEU jogador responde na hora.
 *
 * - Predição: cada input é aplicado localmente no mesmo instante em que é
 *   enviado (numerado com `seq`), usando a mesma física de src/game/.
 * - Reconciliação: quando o estado oficial chega, partimos da posição do
 *   servidor e reaplicamos só os inputs que ele ainda não viu (seq > ack).
 *   Como a simulação é determinística, o resultado bate — sem "borracha".
 * - Interpolação: o oponente é desenhado ~100ms no passado, deslizando entre
 *   os dois últimos estados conhecidos em vez de teleportar a cada pacote.
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

  let myId = 0;
  let seq = 0;
  /** inputs enviados que o servidor ainda não confirmou (para reconciliar) */
  let pendingInputs: { seq: number; input: PlayerInput }[] = [];
  /** meu jogador previsto localmente */
  let predicted: Player | null = null;
  /** últimos estados do servidor com o momento em que chegaram */
  const snapshots: { t: number; state: GameState }[] = [];
  /** bomba apertada aguardando o próximo passo fixo (não pode se perder) */
  let bombLatch = false;

  statusEl.textContent = 'Conectando ao servidor...';

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify(request));
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case 'waiting':
        statusEl.textContent = 'Aguardando outro jogador entrar...';
        break;
      case 'roomCreated':
        statusEl.textContent = `Sala criada! Código: ${msg.code} — passe para o seu amigo e aguarde`;
        break;
      case 'error':
        statusEl.textContent = `⚠️ ${msg.message}`;
        ws.close();
        onError();
        break;
      case 'start':
        myId = msg.playerId;
        statusEl.textContent = `Você é o Jogador ${myId} — boa sorte! 💣`;
        break;
      case 'state':
        snapshots.push({ t: performance.now(), state: msg.state });
        if (snapshots.length > 30) snapshots.shift();
        if (myId > 0) reconcile(msg.state, msg.acks?.[myId - 1] ?? 0);
        break;
      case 'opponentLeft':
        statusEl.textContent = 'O oponente saiu da partida. Recarregue para jogar de novo.';
        break;
    }
  });

  ws.addEventListener('close', () => {
    if (myId === 0 && statusEl.textContent?.startsWith('Conectando')) {
      statusEl.textContent =
        'Não conectou. O servidor está rodando? (npm run server)';
      onError();
    }
  });

  window.addEventListener('keydown', (e) => {
    const latest = snapshots[snapshots.length - 1];
    if (e.code === 'KeyR' && latest?.state.phase === 'over') {
      ws.send(JSON.stringify({ type: 'restart' }));
    }
  });

  /** Volta para a verdade do servidor e reaplica o que ele ainda não processou */
  function reconcile(state: GameState, ack: number): void {
    pendingInputs = pendingInputs.filter((p) => p.seq > ack);

    const serverMe = state.players[myId - 1];
    if (!serverMe) return;

    predicted = { ...serverMe };
    if (!serverMe.alive || state.phase !== 'playing') return;

    const solid = solidFor(state, predicted);
    for (const p of pendingInputs) {
      movePlayer(solid, predicted, p.input, FIXED_DT);
    }
  }

  /** Estado para desenhar: eu previsto, oponente interpolado, resto do último snapshot */
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
      if (i === myId - 1 && predicted) return predicted;
      const p0 = s0.state.players[i];
      const p1 = s1.state.players[i];
      if (!p0 || !p1) return p;
      return { ...p1, x: p0.x + (p1.x - p0.x) * alpha, y: p0.y + (p1.y - p0.y) * alpha };
    });

    return { ...latest.state, players };
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

        // predição: mesmo movimento que o servidor fará com este input
        if (predicted!.alive) {
          movePlayer(solidFor(latest.state, predicted!), predicted!, input, FIXED_DT);
        }
      }
    } else {
      accumulator = 0;
    }

    const display = displayState(now);
    if (display) render(ctx, display);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
