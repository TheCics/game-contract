/**
 * ============================================================================
 * ARQUIVO: game.config.js
 * LOCAL: packages/game-contract/game.config.js
 * ============================================================================
 *
 * DESCRIÇÃO:
 * Normalizador genérico de configuração a partir do esquema da engine.
 *
 * RESPONSABILIDADES:
 * - Aplicar defaults, limites e tipos de um esquema { campo: { type, ... } }.
 * - Descartar campos que o esquema não declara.
 * - Tipos: integer (min, max), boolean, enum (values). Sem regras de jogo.
 *
 * DATA DE CRIAÇÃO: 07/11/2026 (subetapa 4.3).
 *
 * AUTOR: Viana-78
 *
 * ============================================================================
 */

function normalizeField(spec, value) {
    if (value === undefined) {
        return spec.default;
    }

    if (spec.type === 'boolean') {
        return Boolean(value);
    }

    if (spec.type === 'enum') {
        return spec.values.includes(value) ? value : spec.default;
    }

    const n = Math.round(Number(value));

    if (!Number.isFinite(n)) {
        return spec.default;
    }

    return Math.min(Math.max(n, spec.min), spec.max);
}

function normalizeBySchema(schema, input) {
    const source = input !== null && typeof input === 'object' ? input : {};
    const config = {};

    for (const [name, spec] of Object.entries(schema)) {
        config[name] = normalizeField(spec, source[name]);
    }

    return config;
}

module.exports = { normalizeBySchema };
