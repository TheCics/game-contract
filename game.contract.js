/**
 * ============================================================================
 * ARQUIVO: game.contract.js
 * LOCAL: packages/game-contract/game.contract.js
 * ============================================================================
 *
 * DESCRIÇÃO:
 * Contrato universal de engine de jogo da plataforma Bar do Tião.
 *
 * RESPONSABILIDADES:
 * - Definir quais métodos uma engine deve (e pode) implementar.
 * - Padronizar o formato de retorno de sucesso, transição e erro.
 * - Validar uma engine (validateEngine / assertValidEngine) antes do registro.
 * - Validar o formato dos resultados que uma engine devolve (validateResult).
 * - NÃO conhecer regras, cartas, turnos nem ações de nenhum jogo específico.
 *
 * DATA DE CRIAÇÃO: 07/11/2026 (subetapa 4.1).
 *
 * ATUALIZAÇÕES:
 * - 07/11/2026: Criação do contrato, dos helpers de resultado e do validador.
 *
 * AUTOR: Viana-78
 *
 * ============================================================================
 *
 * CONVENÇÕES DO CONTRATO
 * ----------------------------------------------------------------------------
 * 1. Todos os métodos são SÍNCRONOS. Uma engine é lógica pura de transição de
 *    estado: não abre socket, não acessa Firestore, não lê manager global nem
 *    estado de outra partida. Métodos `async` são rejeitados pelo validador.
 *
 * 2. O estado vive FORA da engine. O núcleo guarda o estado e o entrega pelo
 *    `context`; a engine devolve o próximo estado em uma transição explícita.
 *    Nenhuma engine deve manter estado de partida em variáveis do módulo.
 *
 * 3. Formato do context (somente o necessário, nunca o servidor inteiro):
 *      {
 *          matchId: string,
 *          config:  object,                 // já normalizada por normalizeConfig
 *          players: [{ id, nick, bot }],    // participantes da partida
 *          state:   object | null           // estado atual (null antes de createMatch)
 *      }
 *
 * 4. Formato do command (o núcleo transporta; só a engine interpreta `type`):
 *      { playerId: string, type: string, payload: object }
 *
 * 5. Formato de resultado:
 *      transição:  { ok: true, state, events: [{ type, payload? }], result: null | Result }
 *      sucesso:    { ok: true, ...campos }          (validatePlayers, normalizeConfig)
 *      erro:       { ok: false, error: { code, message } }
 *    O erro nunca expõe stack trace nem dados privados do jogo.
 *
 * 6. Formato de Result da partida (devolvido por getResult quando termina):
 *      { winners: [playerId, ...], scores?: { [playerId]: number } }
 *    `winners` pode ser vazio (empate). Rodadas e placar acumulado (série de
 *    rodadas) são do núcleo: ele soma o getResult de cada rodada. A engine
 *    descreve apenas UMA partida/rodada.
 *
 * 7. Capacidades são declaradas em `capabilities` (lista de nomes). Uma
 *    capacidade nunca é obrigatória por padrão. Nesta subetapa o contrato só
 *    conhece 'bots' (ver regra 8); a existência das demais é verificada pelo
 *    registro (subetapa 4.3).
 *
 * 8. Bots: a engine que declara 'bots' DEVE implementar createBotAction. Quem
 *    implementa createBotAction sem declarar 'bots' é rejeitado. O núcleo
 *    decide quando pedir a ação; QUAL ação tomar é sempre da engine/adaptador.
 *
 * 9. Operação não suportada: uma engine que não implementa um método opcional
 *    não simula comportamento. O núcleo responde com unsupported(operation).
 *
 * CICLO DE VIDA
 * ----------------------------------------------------------------------------
 *   normalizeConfig → validatePlayers → createMatch → startMatch
 *     → handleAction (repetido) → isFinished → getResult
 *   Em paralelo, quando suportados: handlePlayerJoin / handlePlayerLeave /
 *   handleReconnect e createBotAction. Pausa e recuperação ainda não fazem
 *   parte do contrato (entram como capacidade quando houver necessidade).
 */

// ----- Métodos do contrato -----

// Obrigatórios: toda engine implementa.
const REQUIRED_METHODS = Object.freeze([
    'getMetadata',      // () => { id, name, minPlayers, maxPlayers, description?, icon?, botNames? }
    'getConfigSchema',  // () => object (formato detalhado na subetapa 4.3)
    'normalizeConfig',  // (config) => { ok: true, config } | erro
    'validatePlayers',  // (players, config) => { ok: true } | erro
    'createMatch',      // (context) => transição (estado inicial, ainda não iniciada)
    'startMatch',       // (context) => transição (partida em andamento)
    'handleAction',     // (context, command) => transição | erro
    'getPlayerView',    // (context, playerId) => object (só o que esse jogador pode ver)
    'isFinished',       // (context) => boolean
    'getResult',        // (context) => Result | null (null enquanto não terminar)
]);

// Opcionais: o núcleo trata a ausência (nunca assume que existem).
const OPTIONAL_METHODS = Object.freeze([
    'getPublicState',   // (context) => object (visão sem dados privados, ex.: espectadores)
    'handlePlayerJoin', // (context, player) => transição | erro
    'handlePlayerLeave',// (context, playerId) => transição | erro
    'handleReconnect',  // (context, playerId) => transição | erro
    'createBotAction',  // (context, playerId) => command | null   [capacidade 'bots']
    'createBotReaction',// (context, playerId) => command | null   reação fora da vez (ex.: intromissão), tentada durante a janela
    'getPaceMs',        // (context) => ms extras que o bot espera antes de jogar (tempo das animações do cliente)
    'getReactionDelayMs', // (context) => ms até a janela de reação abrir (a janela pode começar depois da animação)
]);

// Capacidade que o próprio contrato conhece (liga a regra 8).
const CAPABILITY_BOTS = 'bots';

// ----- Erros padronizados -----

// Códigos comuns. Uma engine pode definir códigos próprios (MAIÚSCULAS_COM_UNDERLINE).
const ERROR_CODES = Object.freeze({
    INVALID_ACTION: 'INVALID_ACTION',
    UNKNOWN_ACTION: 'UNKNOWN_ACTION',
    INVALID_CONFIG: 'INVALID_CONFIG',
    INVALID_PLAYERS: 'INVALID_PLAYERS',
    MATCH_FINISHED: 'MATCH_FINISHED',
    UNSUPPORTED_OPERATION: 'UNSUPPORTED_OPERATION',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
});

const ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9-]*$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

class ContractError extends Error {
    constructor(message, errors = []) {
        super(message);
        this.name = 'ContractError';
        this.errors = errors;
    }
}

// ----- Construtores de resultado -----

// Sucesso simples, com campos livres: ok({ config }).
function ok(fields = {}) {
    return { ok: true, ...fields };
}

// Transição de estado: o único formato aceito de handleAction/createMatch/startMatch.
function transition({ state, events = [], result = null }) {
    return { ok: true, state, events, result };
}

function fail(code, message) {
    return { ok: false, error: { code, message } };
}

function unsupported(operation) {
    return fail(
        ERROR_CODES.UNSUPPORTED_OPERATION,
        `Operação não suportada por este jogo: ${operation}`
    );
}

// ----- Validação de resultados -----

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateErrorShape(error) {
    const problems = [];

    if (!isPlainObject(error)) {
        return ['error deve ser um objeto { code, message }'];
    }

    if (typeof error.code !== 'string' || !ERROR_CODE_PATTERN.test(error.code)) {
        problems.push('error.code deve ser texto MAIÚSCULO_COM_UNDERLINE');
    }

    if (typeof error.message !== 'string' || !error.message.trim()) {
        problems.push('error.message deve ser um texto não vazio');
    }

    return problems;
}

function validateMatchResult(result) {
    const problems = [];

    if (!isPlainObject(result)) {
        return ['result deve ser um objeto { winners, scores? }'];
    }

    if (!Array.isArray(result.winners) || result.winners.some((id) => typeof id !== 'string')) {
        problems.push('result.winners deve ser uma lista de ids (texto)');
    }

    if (result.scores !== undefined) {
        const valid = isPlainObject(result.scores)
            && Object.values(result.scores).every((value) => Number.isFinite(value));

        if (!valid) {
            problems.push('result.scores deve mapear id → número');
        }
    }

    return problems;
}

/**
 * Confere se um valor retornado por uma engine respeita o formato padrão.
 * options.transition: true exige o formato de transição completo.
 * Retorna a lista de problemas (vazia quando está correto).
 */
function validateResult(value, { transition: expectTransition = false } = {}) {
    if (!isPlainObject(value) || typeof value.ok !== 'boolean') {
        return ['o retorno deve ser um objeto com o campo booleano "ok"'];
    }

    if (!value.ok) {
        return validateErrorShape(value.error);
    }

    if (!expectTransition) {
        return [];
    }

    const problems = [];

    if (value.state === undefined) {
        problems.push('transição sem "state"');
    }

    if (!Array.isArray(value.events)) {
        problems.push('transição com "events" que não é lista');
    }
    else if (value.events.some((event) => !isPlainObject(event) || typeof event.type !== 'string' || !event.type)) {
        problems.push('cada evento deve ser um objeto com "type" (texto)');
    }

    if (value.result !== null && value.result !== undefined) {
        problems.push(...validateMatchResult(value.result));
    }

    return problems;
}

// ----- Validação da engine -----

function isAsync(fn) {
    return fn.constructor && fn.constructor.name === 'AsyncFunction';
}

function checkMethod(engine, name, required, errors) {
    const method = engine[name];

    if (method === undefined) {
        if (required) {
            errors.push(`método obrigatório ausente: ${name}`);
        }

        return;
    }

    if (typeof method !== 'function') {
        errors.push(`${name} deve ser uma função`);
    }
    else if (isAsync(method)) {
        errors.push(`${name} deve ser síncrono (async não é permitido)`);
    }
}

function checkCapabilities(engine, errors) {
    const { capabilities } = engine;

    if (capabilities === undefined) {
        return [];
    }

    if (!Array.isArray(capabilities)) {
        errors.push('capabilities deve ser uma lista de nomes');

        return [];
    }

    const seen = new Set();

    for (const name of capabilities) {
        if (typeof name !== 'string' || !CAPABILITY_PATTERN.test(name)) {
            errors.push(`capacidade inválida: ${String(name)}`);
        }
        else if (seen.has(name)) {
            errors.push(`capacidade repetida: ${name}`);
        }

        seen.add(name);
    }

    return [...seen];
}

function checkMetadata(engine, errors) {
    if (typeof engine.getMetadata !== 'function' || isAsync(engine.getMetadata)) {
        return;
    }

    let meta;

    try {
        meta = engine.getMetadata();
    }
    catch {
        errors.push('getMetadata lançou erro');

        return;
    }

    if (!isPlainObject(meta)) {
        errors.push('getMetadata deve devolver um objeto');

        return;
    }

    if (meta.id !== engine.id) {
        errors.push('getMetadata().id deve ser igual a engine.id');
    }

    if (typeof meta.name !== 'string' || !meta.name.trim()) {
        errors.push('getMetadata().name deve ser um texto não vazio');
    }

    const isCount = (n) => Number.isInteger(n) && n >= 1;

    if (!isCount(meta.minPlayers) || !isCount(meta.maxPlayers)) {
        errors.push('getMetadata() deve informar minPlayers e maxPlayers (inteiros ≥ 1)');
    }
    else if (meta.maxPlayers < meta.minPlayers) {
        errors.push('getMetadata(): maxPlayers não pode ser menor que minPlayers');
    }
}

function checkConfigSchema(engine, errors) {
    if (typeof engine.getConfigSchema !== 'function' || isAsync(engine.getConfigSchema)) {
        return;
    }

    try {
        if (!isPlainObject(engine.getConfigSchema())) {
            errors.push('getConfigSchema deve devolver um objeto');
        }
    }
    catch {
        errors.push('getConfigSchema lançou erro');
    }
}

/**
 * Valida o objeto de engine contra o contrato.
 * Retorna { valid, errors } — não lança. Reúne todos os problemas de uma vez.
 */
function validateEngine(engine) {
    const errors = [];

    if (!isPlainObject(engine)) {
        return { valid: false, errors: ['a engine deve ser um objeto'] };
    }

    if (typeof engine.id !== 'string' || !ID_PATTERN.test(engine.id)) {
        errors.push('id deve ser texto minúsculo (letras, números e hífen), ex.: "uno"');
    }

    if (!Number.isInteger(engine.version) || engine.version < 1) {
        errors.push('version deve ser um inteiro ≥ 1');
    }

    REQUIRED_METHODS.forEach((name) => checkMethod(engine, name, true, errors));
    OPTIONAL_METHODS.forEach((name) => checkMethod(engine, name, false, errors));

    const capabilities = checkCapabilities(engine, errors);
    const declaresBots = capabilities.includes(CAPABILITY_BOTS);
    const hasBotAction = engine.createBotAction !== undefined;

    if (declaresBots && !hasBotAction) {
        errors.push("a capacidade 'bots' exige createBotAction");
    }

    if (hasBotAction && !declaresBots) {
        errors.push("createBotAction exige declarar a capacidade 'bots'");
    }

    checkMetadata(engine, errors);
    checkConfigSchema(engine, errors);

    return { valid: errors.length === 0, errors };
}

// Igual a validateEngine, mas lança ContractError (usado pelo registro).
function assertValidEngine(engine) {
    const { valid, errors } = validateEngine(engine);

    if (!valid) {
        const name = engine && typeof engine.id === 'string' ? engine.id : 'desconhecida';

        throw new ContractError(
            `Engine "${name}" não cumpre o contrato: ${errors.join('; ')}`,
            errors
        );
    }

    return engine;
}

module.exports = {
    REQUIRED_METHODS,
    OPTIONAL_METHODS,
    CAPABILITY_BOTS,
    ERROR_CODES,
    ContractError,
    ok,
    transition,
    fail,
    unsupported,
    validateResult,
    validateMatchResult,
    validateEngine,
    assertValidEngine,
};
