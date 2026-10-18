# 🐍 Cobra Ladrão

Jogo da cobrinha clássico para até **4 jogadores no mesmo teclado**, com uma regra especial:
**quem encosta a cabeça na cabeça de outro jogador ROUBA metade das bolinhas dele!** 😈

## ▶ Como jogar

Basta abrir o `index.html` no navegador (ou servir com qualquer servidor estático):

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

## 🎮 Controles

| Jogador | Teclas |
|---|---|
| Jogador 1 (verde) | `W A S D` |
| Jogador 2 (vermelho) | Setas `↑ ↓ ← →` |
| Jogador 3 (amarelo) | `I J K L` |
| Jogador 4 (roxo) | Numérico `8 4 5 6` |

- `Espaço` pausa/retoma.
- No celular, deslize o dedo sobre o tabuleiro para controlar o Jogador 1.

## 📜 Regras

- 🔘 **Bolinha rosa** = 1 ponto · 🟠 **laranja grande** = 3 pontos · 🔵 **azul** = 2 pontos (solta por quem morreu)
- 😈 **Roubo**: encoste sua cabeça na cabeça (ou logo à frente dela) de outro jogador para roubar **metade das bolinhas** dele (limite de 1 roubo a cada ~2s por par).
- 💥 **Choque frontal de cabeças**: a cobra maior sobrevive e rouba do perdedor; se tiverem o mesmo tamanho, as duas morrem.
- 💀 Bater na parede ou no corpo (próprio ou de outro) mata a cobra — ela renasce em poucos segundos (no modo solo, é fim de jogo). Quem morre **solta bolinhas azuis de bônus** pelo tabuleiro.
- 🏆 Vence quem chegar a **21 bolinhas** primeiro, ou quem for o último sobrevivente.

## 📁 Arquivos

- `index.html` — interface e telas (menu, HUD, fim de jogo)
- `game.js` — toda a lógica do jogo (sem dependências externas)
