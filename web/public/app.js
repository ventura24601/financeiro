"use strict";

const $ = (s) => document.querySelector(s);
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = (c) => moeda.format((c || 0) / 100);
const brlK = (c) => {
  const v = (c || 0) / 100;
  return Math.abs(v) >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil` : moeda.format(v);
};
const dataBR = (iso, opts = {}) =>
  new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", ...opts });
const mesBR = (m) => {
  const [a, mm] = m.split("-");
  return new Date(+a, +mm - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cor = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

let D = null;
const historicoChat = [];

async function iniciar() {
  const r = await fetch("/api/dados", { credentials: "same-origin" });
  if (r.status === 401) return mostrarLogin();
  if (!r.ok) return mostrarLogin(`Erro ao carregar dados (${r.status}).`);
  D = await r.json();
  $("#login").hidden = true;
  $("#app").hidden = false;
  render();
}

function mostrarLogin(msg = "") {
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#erro-login").textContent = msg;
  $("#senha").focus();
}

$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter;
  btn.disabled = true;
  try {
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ senha: $("#senha").value }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      $("#erro-login").textContent = j.erro || "Não foi possível entrar.";
      $("#senha").select();
      return;
    }
    $("#senha").value = "";
    await iniciar();
  } finally {
    btn.disabled = false;
  }
});

$("#sair").addEventListener("click", async () => {
  await fetch("/api/login", { method: "DELETE" });
  location.reload();
});

function render() {
  const b = D.base;
  $("#subtitulo").textContent =
    `${D.regime} · data-base ${dataBR(b.data, { year: "numeric" })}${b.parcial ? " (dia ainda aberto)" : ""}`;
  $("#rodape").textContent = `Dados gerados em ${new Date(D.gerado_em).toLocaleString("pt-BR")} · projeção estatística, não é garantia.`;
  renderKpis();
  graficoSaldo();
  graficoCanais();
  graficoFatia();
  tabelaDias();
  configurarDia();
  tabelaRecorrentes();
  renderBacktest();
  $("#avisos").innerHTML = D.avisos.map((a) => `<li>${esc(a)}</li>`).join("");
  renderSugestoes();
}

function renderKpis() {
  const p = D.projecao;
  const em = (n) => p[Math.min(n, p.length) - 1];
  const minimo = p.reduce((a, x) => (x.saldo < a.saldo ? x : a), p[0]);
  const receb = D.recebiveis_vindi.reduce((s, x) => s + x.valor, 0);
  const mesAtual = D.mensal[D.mensal.length - 1];
  const kpis = [
    ["Saldo Itaú hoje", brl(D.base.saldo_itau), `em ${dataBR(D.base.data)}`],
    ["Projetado em 30 dias", brlK(em(30).saldo), `${dataBR(em(30).data)} · faixa ${brlK(em(30).saldo_min)} a ${brlK(em(30).saldo_max)}`],
    ["Projetado em 60 dias", brlK(em(60).saldo), dataBR(em(60).data)],
    ["Projetado em 90 dias", brlK(em(90).saldo), dataBR(em(90).data)],
    ["Menor saldo previsto", brlK(minimo.saldo), `em ${dataBR(minimo.data, { weekday: "short" })} · pior caso ${brlK(minimo.saldo_min)}`,
      D.caixa_minimo != null && minimo.saldo_min < D.caixa_minimo],
    ["Recebíveis Vindi", brlK(receb), "cartão já vendido, a creditar"],
    ["Vindi no mês", mesAtual.fatia_vindi != null ? `${(mesAtual.fatia_vindi * 100).toFixed(0)}%` : "-", "das entradas dos gateways"],
    ["Geração de caixa/mês", brlK(D.geracao_media_mensal), `média de ${D.meses_geracao.map(mesBR).join(", ")}`],
    ["Aplicado em fundos", brlK(D.base.aplicado_fundos),
      D.base.saldo_fundos == null ? "líquido desde fev · saldo dos fundos não informado, fora do gráfico" : `saldo ${brlK(D.base.saldo_fundos)}`],
  ];
  $("#kpis").innerHTML = kpis
    .map(([r, v, n, alerta]) => `<div class="kpi${alerta ? " alerta" : ""}"><div class="rotulo">${r}</div><div class="valor">${v}</div><div class="nota">${n}</div></div>`)
    .join("");
}

Chart.defaults.font.family = "Inter, system-ui, sans-serif";
Chart.defaults.font.size = 12;

function baseOpcoes() {
  Chart.defaults.color = cor("--text-secondary");
  Chart.defaults.borderColor = cor("--border");
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "top", align: "center", labels: { usePointStyle: true, pointStyle: "rectRounded", boxWidth: 10 } },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${brl(c.raw * 100)}` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
      y: { grid: { color: cor("--border") }, ticks: { callback: (v) => `R$ ${(v / 1000).toLocaleString("pt-BR")} mil` } },
    },
  };
}

function graficoSaldo() {
  const hist = D.historico_saldo.slice(-120);
  const proj = D.projecao;
  const labels = [...hist.map((h) => h.data), ...proj.map((p) => p.data)];
  const n = hist.length;
  const ultimo = hist[n - 1].saldo / 100;
  const realizado = [...hist.map((h) => h.saldo / 100), ...proj.map(() => null)];
  const projetado = [...hist.map((_, i) => (i === n - 1 ? ultimo : null)), ...proj.map((p) => p.saldo / 100)];
  const min = [...hist.map((_, i) => (i === n - 1 ? ultimo : null)), ...proj.map((p) => p.saldo_min / 100)];
  const max = [...hist.map((_, i) => (i === n - 1 ? ultimo : null)), ...proj.map((p) => p.saldo_max / 100)];
  const s1 = cor("--series-1");
  const opc = baseOpcoes();
  opc.scales.x.ticks.callback = function (v) { return dataBR(this.getLabelForValue(v)); };
  opc.plugins.tooltip.callbacks.title = (it) => dataBR(it[0].label, { weekday: "short", year: "numeric" });
  opc.plugins.legend.labels.filter = (l) => !l.text.startsWith("_");
  opc.plugins.tooltip.filter = (c) => c.raw != null && !c.dataset.label.startsWith("_");
  new Chart($("#g-saldo"), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "_max", data: max, borderWidth: 0, pointRadius: 0, fill: "+1", backgroundColor: cor("--band") },
        { label: "_min", data: min, borderWidth: 0, pointRadius: 0, fill: false },
        { label: "Realizado", data: realizado, borderColor: s1, backgroundColor: s1, borderWidth: 2, pointRadius: 0, tension: 0.2 },
        { label: "Projetado", data: projetado, borderColor: s1, backgroundColor: cor("--band"), borderWidth: 2, borderDash: [6, 4], pointRadius: 0, tension: 0.2 },
      ],
    },
    options: opc,
  });
}

function graficoCanais() {
  const meses = D.mensal;
  const serie = (k, label, v) => ({
    label, data: meses.map((m) => m[k] / 100), backgroundColor: cor(v),
    borderRadius: 4, borderSkipped: "bottom", borderColor: cor("--surface-1"), borderWidth: { top: 2 },
  });
  const opc = baseOpcoes();
  opc.scales.x.stacked = opc.scales.y.stacked = true;
  opc.plugins.tooltip.callbacks.footer = (it) => {
    const m = meses[it[0].dataIndex];
    const notas = [`Total: ${brl(m.entradas)}`];
    if (!m.completo_receita) notas.push("Mês incompleto ou com receita Vindi parcial");
    if (m.estimado) notas.push("Inclui receita Vindi estimada por repasse");
    return notas;
  };
  new Chart($("#g-canais"), {
    type: "bar",
    data: {
      labels: meses.map((m) => mesBR(m.mes) + (m.completo_receita ? "" : "*")),
      datasets: [serie("vindi", "Vindi", "--series-1"), serie("bambuno", "Bambuno", "--series-2"), serie("outros", "Outros", "--series-3")],
    },
    options: opc,
  });
}

function graficoFatia() {
  const meses = D.mensal.filter((m) => m.fatia_vindi != null);
  const futuros = Object.entries(D.premissas.fatia_vindi_por_mes).filter(([m]) => !meses.some((x) => x.mes === m));
  const labels = [...meses.map((m) => m.mes), ...futuros.map(([m]) => m)];
  const real = [...meses.map((m) => m.fatia_vindi * 100), ...futuros.map(() => null)];
  const tend = [...meses.map((m, i) => (i === meses.length - 1 ? m.fatia_vindi * 100 : null)), ...futuros.map(([, v]) => v * 100)];
  const opc = baseOpcoes();
  opc.scales.y.ticks.callback = (v) => `${v}%`;
  opc.scales.y.min = 0;
  opc.scales.y.max = 100;
  opc.scales.x.ticks.callback = function (v) { return mesBR(this.getLabelForValue(v)); };
  opc.plugins.tooltip.callbacks.label = (c) => `${c.dataset.label}: ${c.raw.toFixed(1)}%`;
  opc.plugins.tooltip.callbacks.title = (it) => mesBR(it[0].label);
  opc.plugins.tooltip.filter = (c) => c.raw != null;
  const s1 = cor("--series-1");
  new Chart($("#g-fatia"), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Vindi (realizado)", data: real, borderColor: s1, backgroundColor: s1, borderWidth: 2, pointRadius: 4 },
        { label: "Tendência", data: tend, borderColor: s1, borderDash: [6, 4], borderWidth: 2, pointRadius: 0 },
      ],
    },
    options: opc,
  });
}

function totalEntradas(p) {
  return p.entradas.vindi + p.entradas.bambuno + p.entradas.outros;
}

function tabelaDias() {
  const linhas = D.projecao.slice(0, 14).map((p) => {
    const itens = p.saidas_recorrentes.map((i) => `${esc(i.nome)} (${brlK(-i.valor)})`).join(", ");
    return `<tr class="${p.util ? "" : "fds"}">
      <td>${dataBR(p.data, { weekday: "short" })}</td>
      <td>${brl(p.entradas.vindi)}</td><td>${brl(p.entradas.bambuno)}</td>
      <td class="pos">${brl(totalEntradas(p))}</td><td class="neg">${brl(p.saidas)}</td>
      <td><strong>${brl(p.saldo)}</strong></td>
      <td class="txt">${itens || (p.util ? "despesas variáveis médias" : "fim de semana/feriado")}</td>
    </tr>`;
  });
  $("#t-dias").innerHTML = `<thead><tr><th>Dia</th><th><span class="sw" style="background:var(--series-1)"></span>Vindi</th>
    <th><span class="sw" style="background:var(--series-2)"></span>Bambuno</th><th>Entradas</th><th>Saídas</th><th>Saldo</th>
    <th>Pagamentos previstos</th></tr></thead><tbody>${linhas.join("")}</tbody>`;
}

function configurarDia() {
  const inp = $("#dia-escolhido");
  inp.min = D.projecao[0].data;
  inp.max = D.projecao[D.projecao.length - 1].data;
  inp.value = D.projecao[0].data;
  const mudar = (delta) => {
    const i = D.projecao.findIndex((p) => p.data === inp.value) + delta;
    if (i >= 0 && i < D.projecao.length) {
      inp.value = D.projecao[i].data;
      detalheDia();
    }
  };
  inp.addEventListener("change", detalheDia);
  $("#dia-ant").addEventListener("click", () => mudar(-1));
  $("#dia-prox").addEventListener("click", () => mudar(1));
  detalheDia();
}

function detalheDia() {
  const p = D.projecao.find((x) => x.data === $("#dia-escolhido").value);
  if (!p) return;
  const recebivel = D.recebiveis_vindi.find((r) => r.data === p.data);
  const linha = (a, b, cls = "") => `<div class="linha"><span>${a}</span><span class="${cls}">${b}</span></div>`;
  $("#dia-detalhe").innerHTML = `
    <div class="dia-destaque">
      <div class="muted">${dataBR(p.data, { weekday: "long", year: "numeric" })}${p.util ? "" : " · não é dia útil"}</div>
      <div class="grande">${brl(p.saldo)}</div>
      <div class="muted">saldo projetado ao fim do dia · faixa ${brl(p.saldo_min)} a ${brl(p.saldo_max)}</div>
    </div>
    <div class="dia-colunas">
      <div><h3>Entradas esperadas · ${brl(totalEntradas(p))}</h3>
        ${linha('<span class="sw" style="background:var(--series-1)"></span>Vindi', brl(p.entradas.vindi))}
        ${recebivel ? linha("· dos quais recebíveis de cartão já vendidos", brl(recebivel.valor)) : ""}
        ${linha('<span class="sw" style="background:var(--series-2)"></span>Bambuno', brl(p.entradas.bambuno))}
        ${linha('<span class="sw" style="background:var(--series-3)"></span>Outros', brl(p.entradas.outros))}
      </div>
      <div><h3>Saídas esperadas · ${brl(p.saidas)}</h3>
        ${p.saidas_recorrentes.map((i) => linha(esc(i.nome), brl(i.valor), "neg")).join("")}
        ${linha("Despesas variáveis (média por dia útil)", brl(p.saidas_variaveis), "neg")}
        ${linha("Taxas Vindi", brl(p.taxa_vindi), "neg")}
      </div>
    </div>`;
}

function tabelaRecorrentes() {
  $("#t-recorrentes").innerHTML = `<thead><tr><th>Contraparte</th><th>Dia típico</th><th>Valor/mês</th></tr></thead><tbody>${
    D.recorrentes.map((i) => `<tr><td>${esc(i.nome)}</td><td>${i.dia}</td><td class="neg">${brl(i.valor)}</td></tr>`).join("")
  }</tbody>`;
}

function renderBacktest() {
  const pct = (prev, real) => {
    if (!real) return "-";
    const v = ((Math.abs(prev) - Math.abs(real)) / Math.abs(real)) * 100;
    return `${v > 0 ? "+" : ""}${v.toFixed(0)}%`;
  };
  $("#backtest").innerHTML =
    `<p class="muted centro">O modelo projetou cada mês usando só os dados anteriores a ele:</p>` +
    D.backtests.map((b) => `<div class="backtest-item"><strong>${mesBR(b.mes)}</strong><br>
      Entradas: previsto ${brlK(b.entradas_previstas)} × real ${brlK(b.entradas_reais)} (${pct(b.entradas_previstas, b.entradas_reais)})<br>
      Saídas: previsto ${brlK(-b.saidas_previstas)} × real ${brlK(-b.saidas_reais)} (${pct(b.saidas_previstas, b.saidas_reais)})</div>`).join("");
}

// ---------- IA ----------
function renderSugestoes() {
  const prox = D.projecao.find((p) => p.saidas_recorrentes.length > 2) || D.projecao[7];
  const sugestoes = [
    `Como fica meu caixa dia a dia nesta semana?`,
    `Explique a estimativa do dia ${dataBR(prox.data)}.`,
    "Quais os maiores riscos de caixa nos próximos 30 dias?",
    "Analise a migração Bambuno → Vindi e o impacto no caixa.",
    "Onde estão as maiores saídas e o que dá para cortar?",
  ];
  $("#sugestoes").innerHTML = sugestoes.map((s) => `<button type="button">${esc(s)}</button>`).join("");
  $("#sugestoes").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => perguntar(b.textContent)));
}

$("#form-ia").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#pergunta").value.trim();
  if (q) perguntar(q);
});
$("#pergunta").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#form-ia").requestSubmit();
  }
});

function md(texto) {
  const linhas = esc(texto).split("\n");
  const out = [];
  let lista = null;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < linhas.length && /^\s*\|[\s:|-]+\|\s*$/.test(linhas[i + 1])) {
      const cel = (x) => x.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      const cab = cel(l);
      i += 2;
      const corpo = [];
      while (i < linhas.length && /^\s*\|.*\|\s*$/.test(linhas[i])) corpo.push(cel(linhas[i++]));
      i--;
      out.push(`<div class="tabela-wrap"><table><thead><tr>${cab.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${
        corpo.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    const item = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(l);
    if (item) {
      if (!lista) { lista = []; }
      lista.push(`<li>${inline(item[1])}</li>`);
      continue;
    }
    if (lista) { out.push(`<ul>${lista.join("")}</ul>`); lista = null; }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) out.push(`<h4>${inline(h[2])}</h4>`);
    else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  if (lista) out.push(`<ul>${lista.join("")}</ul>`);
  return out.join("");
}

async function perguntar(q) {
  const chat = $("#chat");
  const btn = $("#enviar");
  btn.disabled = true;
  $("#pergunta").value = "";
  historicoChat.push({ role: "user", content: q });
  chat.insertAdjacentHTML("beforeend", `<div class="msg user">${esc(q)}</div>`);
  const caixa = document.createElement("div");
  caixa.className = "msg assistant";
  caixa.innerHTML = '<p class="muted">Analisando os dados…</p>';
  chat.appendChild(caixa);
  caixa.scrollIntoView({ behavior: "smooth", block: "nearest" });
  let texto = "";
  try {
    const r = await fetch("/api/analise", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mensagens: historicoChat }),
    });
    if (r.status === 401) return mostrarLogin("Sessão expirada. Entre de novo.");
    if (!r.ok) throw new Error(await r.text());
    const leitor = r.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) break;
      texto += dec.decode(value, { stream: true });
      caixa.innerHTML = md(texto);
    }
    historicoChat.push({ role: "assistant", content: texto });
  } catch (err) {
    historicoChat.pop();
    caixa.innerHTML = `<p class="erro">${esc(err.message || "Falha ao consultar a IA.")}</p>`;
  } finally {
    btn.disabled = false;
  }
}

iniciar();
