# Otimizações de rede — feito e por fazer

## ✅ Já implementado

- **Predição local** (`src/online.ts`): seu jogador responde em 0ms. Cada input
  é numerado (`seq`), enviado ao servidor e aplicado localmente na hora, com a
  mesma física de `src/game/movement.ts`.
- **Reconciliação**: o servidor ecoa o último `seq` processado (`acks` no
  broadcast). Ao receber o estado oficial, o cliente parte da posição do
  servidor e reaplica só os inputs ainda não confirmados. Como a simulação é
  determinística (passo fixo de 1/60s nos dois lados), o resultado é exato —
  verificado em teste com erro 0.0.
- **Interpolação do oponente**: desenhado ~100ms no passado
  (`INTERP_DELAY_MS`), deslizando entre os dois últimos estados em vez de
  teleportar a cada pacote.
- **Fila de inputs no servidor**: 1 input por tick, fila limitada — cliente
  não consegue acelerar o próprio jogador (anti speed-hack).
- **Servidor na região dos jogadores**: ao publicar, escolher datacenter no
  Brasil (ex.: Fly.io região `gru`). É a otimização de maior impacto/esforço.
- **Menos dados no fio**: a grade viaja uma vez por rodada (mensagem `grid`);
  o cliente deriva as destruições das explosões (a chama sempre inclui o
  bloco destruído — regra idempotente Block→Floor). Broadcast caiu de 60Hz
  para 30Hz (`BROADCAST_EVERY`), com a interpolação preenchendo os frames.
  Medido: ~342 bytes × 30/s ≈ 10 KB/s por cliente (~5x menos que antes).
- **Bomba fantasma**: ao apertar Espaço a bomba aparece na hora, validada
  localmente com as mesmas regras do servidor (célula livre, limite de
  bombas); some quando a oficial chega no estado — ou é descartada se o
  servidor rejeitar (ack passou e a bomba não veio).
- **Correções suaves**: divergência pequena da predição (< 0.5 célula, ex.:
  power-up de velocidade ainda não conhecido) vira offset visual drenado
  exponencialmente em ~80ms; divergência grande (morte, teleporte) é snap.

## 🔜 Próximos passos (em ordem sugerida)

### 1. Medir para decidir
Antes de otimizar mais: overlay de debug com ping (RTT), tamanho médio dos
pacotes e erro de predição por segundo. Só otimizar o que o número mostrar.

### 2. Encoding binário (ArrayBuffer) em vez de JSON
Só vale com 4 jogadores ou muito tráfego — hoje são ~10 KB/s por cliente.

### Fora do escopo por enquanto
- WebRTC/WebTransport (canal não-confiável evita head-of-line blocking do
  TCP): ganho real, complexidade alta — só se o jogo virar competitivo.
- Lag compensation de hits: pouco relevante aqui, as bombas têm timer de 3s.
