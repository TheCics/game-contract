# @bardotiao/game-contract

Contrato de engine de jogo do servidor: o que toda engine precisa implementar, o formato de resultados e erros, validação e normalização de config.

## Uso
```bash
npm i github:TheCics/game-contract#v1.0.0
```
```js
const { ok, fail, transition, ERROR_CODES, assertValidEngine, normalizeBySchema } = require('@bardotiao/game-contract');
const { runEngineContractSuite } = require('@bardotiao/game-contract/engine-contract.suite'); // nos testes do jogo
```

## Arquivos
- `game.contract.js`: métodos obrigatórios/opcionais, helpers, validadores. As convenções estão no comentário do topo.
- `game.config.js`: normalização de config por schema.
- `engine-contract.suite.js`: suíte de testes que todo jogo roda.

## Mudanças
Uma mudança no contrato afeta todos os jogos: rode os testes do `uno` e do `domino` com a nova versão antes de publicar a tag.
