// Contrato universal de engine + normalizador de config: tudo que uma engine precisa do núcleo.
module.exports = { ...require('./game.contract'), ...require('./game.config') };
