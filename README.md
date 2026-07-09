# 💣 Bomberman

Bomberman 2D multiplayer — local (2 no mesmo teclado) e online (WebSockets),
feito com Canvas + TypeScript puro, sem framework de jogo.

## Como jogar

| Modo | Controles |
| --- | --- |
| Local | P1: WASD + Espaço · P2: setas + Enter |
| Online | WASD **ou** setas + Espaço (cada um no seu navegador) |

Explodiu todo mundo? **R** reinicia a rodada. Blocos destruídos podem soltar
power-ups: 💣 bomba extra · 🔥 mais alcance · ⚡ mais velocidade.

## Rodando em desenvolvimento

Requer Node 18+ (há um `.nvmrc` — use `nvm use`). Dois terminais:

```bash
npm install
npm run dev      # o jogo, em http://localhost:5173
npm run server   # o servidor online, na porta 3001
```

Para jogar com alguém na mesma rede Wi-Fi: `npm run dev -- --host` e passe o
endereço IP que aparecer.

## Arquitetura

- `src/game/` — **lógica pura** do jogo (estado, regras). Não conhece Canvas,
  teclado nem rede — por isso roda igual no navegador e no servidor.
- `src/render/` — desenho 2.5D no Canvas.
- `src/input.ts` — teclado → `PlayerInput` (o formato que viaja pela rede).
- `server/server.ts` — servidor **autoritativo**: roda a simulação com o mesmo
  `src/game/` e transmite o estado 60x/s. Em produção também serve o `dist/`.

## Deploy (produção)

Um único processo serve o jogo e o WebSocket na mesma porta:

```bash
npm run build   # gera dist/
npm run start   # http + ws na porta $PORT (padrão 3001)
```

### Render.com (grátis, sem cartão)

1. Suba o projeto para o GitHub
2. Em [render.com](https://render.com): **New → Web Service**, conecte o repositório
3. Build command: `npm install && npm run build`
4. Start command: `npm run start`
5. Pronto — o jogo fica em `https://seu-app.onrender.com` (no plano grátis o
   servidor "dorme" após 15 min sem uso; a primeira visita o acorda em ~1 min)

### Docker (Fly.io, Railway, VPS...)

O `Dockerfile` incluso funciona em qualquer host que rode containers:

```bash
docker build -t bomberman .
docker run -p 3001:3001 bomberman
```
