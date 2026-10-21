// Monta o contexto que a IA recebe: instruções + dados compactos (valores em reais).
const r = (c) => (c == null ? null : Math.round(c) / 100);

export function instrucoes(hoje) {
  return `Você é o analista financeiro (CFO virtual) da ICOM TV Corporativa LTDA, SaaS brasileiro de TV de sala de espera
para 2.000+ clínicas odontológicas e de saúde. Receita recorrente cobrada por gateways: Bambuno (canal antigo, inclui cartão via
Pagar.me) e Vindi (canal novo, conta digital própria). A empresa está migrando a carteira do Bambuno para a Vindi.
Hardware em comodato. Lucro Real. Hoje é ${hoje}. Quem pergunta é o CEO.

Regras:
- Responda em português do Brasil, direto, em formato executivo: comece pela resposta em 1-2 frases, depois detalhe.
- Use SOMENTE os dados fornecidos. Nunca invente valores, contrapartes ou datas. Se faltar dado, diga qual falta.
- Os dados são de REGIME DE CAIXA (extratos), uma "DRE gerencial de caixa". Deixe isso claro quando falar de resultado.
- A projeção é estatística (premissas abaixo). Ao estimar um dia específico, mostre: entradas esperadas por canal,
  saídas recorrentes previstas (nomes), saídas variáveis médias e saldo projetado com a faixa (saldo_min/saldo_max).
  Explique de onde vem o número e o grau de confiança (cite o backtest quando relevante).
- Considere os avisos (saldos não informados, meses subestimados) antes de concluir.
- Valores em R$ no formato brasileiro (R$ 1.234,56). Use tabelas Markdown curtas quando ajudarem.
- Sugira ações concretas quando houver risco (ex.: antecipar recebíveis, adiar pagamento, cobrar inadimplentes).`;
}

export function dadosCompactos(d) {
  return JSON.stringify({
    regime: d.regime,
    gerado_em: d.gerado_em,
    base: { ...d.base, saldo_itau: r(d.base.saldo_itau), saldo_vindi: r(d.base.saldo_vindi), saldo_fundos: r(d.base.saldo_fundos) },
    avisos: d.avisos,
    geracao_media_mensal: r(d.geracao_media_mensal),
    mensal: d.mensal.map((m) => ({
      mes: m.mes, vindi: r(m.vindi), bambuno: r(m.bambuno), outros: r(m.outros), saidas: r(m.saidas),
      taxa_vindi: r(m.taxa_vindi), liquido: r(m.liquido), fatia_vindi: m.fatia_vindi,
      mes_completo: m.completo_receita, inclui_estimado: m.estimado,
    })),
    premissas_projecao: {
      ...d.premissas,
      nivel_mensal_gateways: r(d.premissas.nivel_mensal_gateways),
      nivel_mensal_outros: r(d.premissas.nivel_mensal_outros),
      nivel_mensal_saidas: r(d.premissas.nivel_mensal_saidas),
      saidas_recorrentes_mes: r(d.premissas.saidas_recorrentes_mes),
      saidas_variaveis_mes: r(d.premissas.saidas_variaveis_mes),
      desvio_liquido_mensal: r(d.premissas.desvio_liquido_mensal),
    },
    saidas_recorrentes: d.recorrentes.map((i) => ({ nome: i.nome, valor_mensal: r(i.valor), dia_tipico: i.dia, meses_vistos: i.meses })),
    backtests: d.backtests.map((b) => ({
      mes: b.mes, entradas_previstas: r(b.entradas_previstas), entradas_reais: r(b.entradas_reais),
      saidas_previstas: r(b.saidas_previstas), saidas_reais: r(b.saidas_reais),
    })),
    projecao_diaria: d.projecao.map((p) => ({
      data: p.data, util: p.util, vindi: r(p.entradas.vindi), bambuno: r(p.entradas.bambuno), outros: r(p.entradas.outros),
      recorrentes: p.saidas_recorrentes.map((i) => `${i.nome} ${r(i.valor)}`), variaveis: r(p.saidas_variaveis),
      taxa_vindi: r(p.taxa_vindi), saldo: r(p.saldo), saldo_min: r(p.saldo_min), saldo_max: r(p.saldo_max),
    })),
    recebiveis_vindi_conhecidos: d.recebiveis_vindi.map((x) => [x.data, r(x.valor)]),
    historico_saldo_itau: d.historico_saldo.slice(-120).map((x) => [x.data, r(x.saldo)]),
    historico_diario: d.historico_diario.map((x) => [x.data, r(x.vindi), r(x.bambuno), r(x.outros), r(x.saidas)]),
    historico_diario_colunas: ["data", "vindi", "bambuno", "outros", "saidas"],
    lancamentos_ultimos_120_dias: d.lancamentos_recentes.map((l) =>
      [l.data, l.descricao, l.contraparte, r(l.valor), l.canal].filter((x) => x !== null)),
  });
}
