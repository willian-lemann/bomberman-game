import { createGame, update } from './game/game';
import { createKeyboard } from './input';
import { startOnline, type LobbyRequest } from './online';
import { render, setupCanvas } from './render/renderer';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Canvas #game não encontrado');

const ctx = setupCanvas(canvas);
const menu = document.querySelector<HTMLElement>('#menu')!;
const statusEl = document.querySelector<HTMLElement>('#status')!;
const joinCode = document.querySelector<HTMLInputElement>('#join-code')!;

document.querySelector('#btn-local')?.addEventListener('click', () => {
  menu.hidden = true;
  startLocal();
});

function beginOnline(request: LobbyRequest): void {
  menu.hidden = true;
  // se der erro (sala inexistente, servidor fora do ar), volta ao menu
  startOnline(ctx, statusEl, request, () => (menu.hidden = false));
}

document.querySelector('#btn-quick')?.addEventListener('click', () => {
  beginOnline({ type: 'quick' });
});

document.querySelector('#btn-create')?.addEventListener('click', () => {
  beginOnline({ type: 'create' });
});

function joinRoom(): void {
  const code = joinCode.value.trim().toUpperCase();
  if (code.length !== 4) {
    statusEl.textContent = 'O código da sala tem 4 letras';
    return;
  }
  beginOnline({ type: 'join', code });
}

document.querySelector('#btn-join')?.addEventListener('click', joinRoom);
joinCode.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
  e.stopPropagation(); // digitar no campo não pode controlar o jogo
});

/** Modo local: simulação e desenho no mesmo lugar, 2 jogadores no teclado */
function startLocal(): void {
  let state = createGame();
  const keyboard = createKeyboard();

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR' && state.phase === 'over') {
      state = createGame();
    }
  });

  let lastTime = performance.now();

  function loop(now: number): void {
    // dt em segundos, limitado para evitar saltos quando a aba fica em segundo plano
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    update(state, dt, keyboard.getInputs());
    render(ctx, state);

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}
