/**
 * ============================================================================
 * ARQUIVO: engine-contract.suite.js
 * LOCAL: server/tests/helpers/engine-contract.suite.js
 * ============================================================================
 *
 * DESCRIÇÃO:
 * Suíte reutilizável de testes de contrato: roda contra QUALQUER engine.
 *
 * RESPONSABILIDADES:
 * - Verificar registro, metadados, configuração e validação de participantes.
 * - Verificar criação, início, ação válida/inválida, visões, fim e resultado.
 * - Verificar que um erro de ação não altera o estado.
 * - Ser chamada por cada engine (Uno na 4.4; Piff e Dominó na Etapa 5).
 *
 * DATA DE CRIAÇÃO: 07/11/2026 (subetapa 4.1).
 *
 * ATUALIZAÇÕES:
 * - 07/11/2026: Criação da suíte de contrato.
 *
 * AUTOR: Viana-78
 *
 * ============================================================================
 *
 * USO:
 *   runEngineContractSuite('counter', engine, {
 *       players: [{ id: 'a', nick: 'Ana' }, { id: 'b', nick: 'Beto' }],
 *       invalidPlayers: [{ id: 'a', nick: 'Ana' }],
 *       config: {},                        // opcional
 *       validCommand: (context) => command // uma ação válida para o estado atual
 *       invalidCommand: (context) => command // uma ação inválida para o estado atual
 *       finish: (context) => context       // leva a partida até o fim (opcional)
 *   });
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const contract = require('./game.contract');

function runEngineContractSuite(label, engine, scenario) {
    const { players, invalidPlayers, config = {}, validCommand, invalidCommand, finish } = scenario;
    const clone = (value) => JSON.parse(JSON.stringify(value));

    function build() {
        const normalized = engine.normalizeConfig(config);
        const context = { matchId: 'm1', config: normalized.config, players, state: null };
        const created = engine.createMatch(context);
        const started = engine.startMatch({ ...context, state: created.state });

        return { context: { ...context, state: started.state }, normalized, created, started };
    }

    test(`[contrato:${label}] engine cumpre o contrato`, () => {
        assert.doesNotThrow(() => contract.assertValidEngine(engine));
    });

    test(`[contrato:${label}] metadados e esquema de configuração`, () => {
        const meta = engine.getMetadata();

        assert.equal(meta.id, engine.id);
        assert.ok(meta.minPlayers <= meta.maxPlayers);
        assert.equal(typeof engine.getConfigSchema(), 'object');
    });

    test(`[contrato:${label}] normalizeConfig devolve configuração válida e é idempotente`, () => {
        const first = engine.normalizeConfig(config);

        assert.deepEqual(contract.validateResult(first), []);
        assert.equal(first.ok, true);
        assert.deepEqual(engine.normalizeConfig(first.config).config, first.config);
    });

    test(`[contrato:${label}] validatePlayers aceita o válido e rejeita o inválido com erro padrão`, () => {
        const { config: normalized } = engine.normalizeConfig(config);

        assert.equal(engine.validatePlayers(players, normalized).ok, true);

        const rejected = engine.validatePlayers(invalidPlayers, normalized);

        assert.equal(rejected.ok, false);
        assert.deepEqual(contract.validateResult(rejected), []);
    });

    test(`[contrato:${label}] criação e início devolvem transições válidas`, () => {
        const { created, started } = build();

        assert.deepEqual(contract.validateResult(created, { transition: true }), []);
        assert.deepEqual(contract.validateResult(started, { transition: true }), []);
    });

    test(`[contrato:${label}] ação válida gera transição válida`, () => {
        const { context } = build();
        const result = engine.handleAction(context, validCommand(context));

        assert.deepEqual(contract.validateResult(result, { transition: true }), []);
        assert.equal(result.ok, true);
    });

    test(`[contrato:${label}] ação inválida e ação desconhecida: erro padrão e estado intacto`, () => {
        const { context } = build();
        const before = clone(context.state);

        const invalid = engine.handleAction(context, invalidCommand(context));
        const unknown = engine.handleAction(context, { playerId: players[0].id, type: '__nao-existe__', payload: {} });

        for (const result of [invalid, unknown]) {
            assert.equal(result.ok, false);
            assert.deepEqual(contract.validateResult(result), []);
        }

        assert.deepEqual(clone(context.state), before);
    });

    test(`[contrato:${label}] visão individual e estado público são objetos`, () => {
        const { context } = build();

        assert.equal(typeof engine.getPlayerView(context, players[0].id), 'object');

        if (typeof engine.getPublicState === 'function') {
            assert.equal(typeof engine.getPublicState(context), 'object');
        }
    });

    test(`[contrato:${label}] getResult é null enquanto a partida não termina`, () => {
        const { context } = build();

        assert.equal(engine.isFinished(context), false);
        assert.equal(engine.getResult(context), null);
    });

    if (finish) {
        test(`[contrato:${label}] ao terminar: isFinished, Result válido e novas ações rejeitadas`, () => {
            const { context } = build();
            const ended = finish(context);

            assert.equal(engine.isFinished(ended), true);
            assert.deepEqual(contract.validateMatchResult(engine.getResult(ended)), []);

            const late = engine.handleAction(ended, validCommand(ended));

            assert.equal(late.ok, false);
            assert.deepEqual(contract.validateResult(late), []);
        });
    }
}

module.exports = { runEngineContractSuite };
