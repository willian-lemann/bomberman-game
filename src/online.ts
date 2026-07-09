import type { GameState, PlayerInput } from './game/types';
import { createKeyboard } from './input';
import { render } from './render/renderer';

export type LobbyRequest =
  | { type: 'quick' }
  | { type: 'create' }
  | { type: 'join'; code: string };

/**
 * Modo online: o servidor roda o jogo; aqui só enviamos inputs e desenhamos
 * o estado recebido. WASD ou setas funcionam; bomba é Espaço (ou Enter).
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

  let state: GameState | null = null;
  let myId = 0;
  let lastSent = '';

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
        state = msg.state;
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
    if (e.code === 'KeyR' && state?.phase === 'over') {
      ws.send(JSON.stringify({ type: 'restart' }));
    }
  });

  function frame(): void {
    // WASD e setas valem igual: só existe "o meu jogador" neste teclado
    const [a, b] = keyboard.getInputs();
    const input: PlayerInput = {
      up: a.up || b.up,
      down: a.down || b.down,
      left: a.left || b.left,
      right: a.right || b.right,
      bomb: a.bomb || b.bomb,
    };

    // só envia quando o input muda (bomba sempre envia: é um evento)
    const encoded = JSON.stringify(input);
    if (ws.readyState === WebSocket.OPEN && (encoded !== lastSent || input.bomb)) {
      ws.send(JSON.stringify({ type: 'input', input }));
      lastSent = encoded;
    }

    if (state) render(ctx, state);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
