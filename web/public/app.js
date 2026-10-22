"use strict";

// ---------- utilidades ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = (c) => moeda.format((c || 0) / 100);
const brlK = (c) => {
  const v = (c || 0) / 100;
  return Math.abs(v) >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil` : moeda.format(v);
};
const pctFmt = (v, casas = 0) => (v == null || !isFinite(v) ? "-" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(casas)}%`);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cor = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// Datas sempre como 'YYYY-MM-DD' (sem fuso) para evitar deslocamento.
const toD = (iso) => new Date(iso + "T12:00:00");
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDias = (s, n) => { const d = toD(s); d.setDate(d.getDate() + n); return iso(d); };
const segunda = (s) => { const d = toD(s); return addDias(s, -((d.getDay() + 6) % 7)); };
const mesDe = (s) => s.slice(0, 7);
const diasNoMes = (m) => new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
const mesAnterior = (m) => { const d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 2, 1); return iso(d).slice(0, 7); };
const dataBR = (s, opts = {}) => toD(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", ...opts });
const mesBR = (m) => new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
const mesLongo = (m) => new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

// Feriados nacionais (bancários) para os comparativos por dia útil.
const feriadosCache = {};
function feriados(ano) {
  if (feriadosCache[ano]) return feriadosCache[ano];
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const pascoa = iso(new Date(ano, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1));
  const fixos = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"].map((x) => `${ano}-${x}`);
  return (feriadosCache[ano] = new Set([...fixos, addDias(pascoa, -48), addDias(pascoa, -47), addDias(pascoa, -2), addDias(pascoa, 60)]));
}
const diaUtil = (s) => { const w = toD(s).getDay(); return w !== 0 && w !== 6 && !feriados(+s.slice(0, 4)).has(s); };

let D = null;
const historicoChat = [];
const graficos = {};
const desenhadas = new Set();
const estado = { granularidade: "dia", periodo: 6, projecao: true, escala: "dia" };

// ---------- login ----------
async function iniciar() {
  const r = await fetch("/api/dados", { credentials: "same-origin" });
  if (r.status === 401) return mostrarLogin();
  if (!r.ok) return mostrarLogin(`Erro ao carregar dados (${r.status}).`);
  D = await r.json();
  prepararSerie();
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
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ senha: $("#senha").value }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      $("#erro-login").textContent = j.erro || "Não foi possível entrar.";
      $("#senha").select();
      return;
    }
    $("#senha").value = "";
    await // =====================================================================
// ATUALIZAR DADOS
// =====================================================================
const ROTULO_STATUS = { pendente: "na fila", processando: "processando", ok: "concluído", divergencia: "divergência", erro: "erro" };
let pollTimer = null;
let ultimaPublicacaoOk = null;

function renderAtualizar() {
  const zona = $("#zona-upload");
  const input = $("#arquivos");
  input.addEventListener("change", () => enviarArquivos([...input.files]));
  ["dragenter", "dragover"].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add("arrastando"); }));
  ["dragleave", "drop"].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.remove("arrastando"); }));
  zona.addEventListener("drop", (e) => enviarArquivos([...e.dataTransfer.files]));
  carregarProcessamentos();
}

async function enviarArquivos(arquivos) {
  const msg = $("#upload-msg");
  for (const f of arquivos) {
    msg.innerHTML = `<p class="muted">Enviando ${esc(f.name)}…</p>`;
    const r = await fetch("/api/upload", { method: "POST", headers: { "x-arquivo": encodeURIComponent(f.name), "content-type": "application/octet-stream" }, body: f });
    if (r.status === 401) return mostrarLogin("Sessão expirada. Entre de novo.");
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { msg.innerHTML = `<p class="erro">${esc(f.name)}: ${esc(j.erro || "falha no envio")}</p>`; return; }
  }
  $("#arquivos").value = "";
  msg.innerHTML = `<p class="pos">${arquivos.length} arquivo(s) enviado(s). O processamento começa em instantes.</p>`;
  carregarProcessamentos();
}

async function carregarProcessamentos() {
  clearTimeout(pollTimer);
  const r = await fetch("/api/upload");
  if (r.status === 401) return mostrarLogin("Sessão expirada. Entre de novo.");
  const { processamentos, disparo_automatico } = await r.json();
  $("#proc-nota").textContent = disparo_automatico
    ? "O processamento começa logo após o envio e leva cerca de 1 a 2 minutos."
    : "O processamento roda automaticamente a cada 15 minutos (seg–sáb, 8h–21h). Para processar na hora, configure o GITHUB_DISPATCH_TOKEN.";
  $("#processamentos").innerHTML = processamentos.length ? processamentos.map((p) => {
    const rs = p.resumo || {};
    const detalhe = rs.erro ? `Erro: ${esc(rs.erro)}`
      : rs.ja_importado ? "Arquivo idêntico já importado antes — nada mudou."
      : rs.conta ? `${esc(rs.conta)}: ${rs.lidos} lançamentos lidos, <strong>${rs.novos} novos</strong>, ${rs.duplicados} já existiam.` : "";
    return `<div class="proc">
      <div class="proc-topo"><strong>${esc(p.arquivo)}</strong><span class="proc-status ${p.status}">${ROTULO_STATUS[p.status] || p.status}</span></div>
      <div class="muted" style="font-size:12.5px">enviado ${new Date(p.criado_em).toLocaleString("pt-BR")}${p.concluido_em ? ` · concluído ${new Date(p.concluido_em).toLocaleString("pt-BR")}` : ""}</div>
      ${detalhe ? `<div style="font-size:13.5px;margin-top:6px">${detalhe}</div>` : ""}
      ${p.status === "divergencia" ? '<div class="erro" style="font-size:13px;margin-top:6px">A conciliação não fechou: nada foi alterado no painel. Veja o detalhe abaixo.</div>' : ""}
      ${p.log ? `<details><summary>Ver log do processamento</summary><pre>${esc(p.log)}</pre></details>` : ""}
    </div>`;
  }).join("") : '<p class="muted centro">Nenhum envio ainda.</p>';

  const ultimoOk = processamentos.find((p) => p.status === "ok");
  if (ultimaPublicacaoOk !== null && ultimoOk && ultimoOk.id !== ultimaPublicacaoOk) {
    $("#upload-msg").innerHTML = '<p class="pos">Dados atualizados.</p><button type="button" id="recarregar">Recarregar o painel</button>';
    $("#recarregar").addEventListener("click", () => location.reload());
  }
  ultimaPublicacaoOk = ultimoOk ? ultimoOk.id : 0;
  if (processamentos.some((p) => p.status === "pendente" || p.status === "processando")) {
    pollTimer = setTimeout(carregarProcessamentos, 5000);
  }
}

iniciar();
  } finally {
    btn.disabled = false;
  }
});

$("#sair").addEventListener("click", async () => {
  await fetch("/api/login", { method: "DELETE" });
  location.reload();
});

// ---------- série diária unificada (realizado + projetado) ----------
let SERIE = [];          // [{data, tipo, entradas{vindi,bambuno,outros}, saidas, recorrentes[], variaveis, taxa, saldo, saldo_min, saldo_max}]
let IDX = {};            // data -> índice

function prepararSerie() {
  const saldos = Object.fromEntries(D.historico_saldo.map((h) => [h.data, h.saldo]));
  const fluxo = Object.fromEntries(D.historico_diario.map((h) => [h.data, h]));
  const ini = D.historico_saldo[0].data;
  SERIE = [];
  let saldo = D.historico_saldo[0].saldo;
  for (let d = ini; d <= D.base.data; d = addDias(d, 1)) {
    const f = fluxo[d] || { vindi: 0, bambuno: 0, outros: 0, saidas: 0 };
    if (saldos[d] != null) saldo = saldos[d];
    SERIE.push({
      data: d, tipo: "real", entradas: { vindi: f.vindi, bambuno: f.bambuno, outros: f.outros }, saidas: f.saidas,
      recorrentes: [], variaveis: 0, taxa: 0, saldo, saldo_min: saldo, saldo_max: saldo,
    });
  }
  for (const p of D.projecao) {
    SERIE.push({
      data: p.data, tipo: "proj", entradas: p.entradas, saidas: p.saidas, recorrentes: p.saidas_recorrentes,
      variaveis: p.saidas_variaveis, taxa: p.taxa_vindi, saldo: p.saldo, saldo_min: p.saldo_min, saldo_max: p.saldo_max,
    });
  }
  IDX = Object.fromEntries(SERIE.map((s, i) => [s.data, i]));
}

const totEnt = (s) => s.entradas.vindi + s.entradas.bambuno + s.entradas.outros;

function somar(dias) {
  const t = { vindi: 0, bambuno: 0, outros: 0, saidas: 0 };
  for (const s of dias) {
    t.vindi += s.entradas.vindi; t.bambuno += s.entradas.bambuno; t.outros += s.entradas.outros; t.saidas += s.saidas;
  }
  t.entradas = t.vindi + t.bambuno + t.outros;
  t.liquido = t.entradas + t.saidas;
  return t;
}

// ---------- abas ----------
$$(".abas button").forEach((b) => b.addEventListener("click", () => abrirAba(b.dataset.aba)));

function abrirAba(nome) {
  $$(".abas button").forEach((b) => b.setAttribute("aria-selected", b.dataset.aba === nome ? "true" : "false"));
  $$(".aba").forEach((s) => (s.hidden = s.dataset.aba !== nome));
  if (!desenhadas.has(nome)) {
    desenhadas.add(nome);
    ({ geral: renderGeral, comparativos: renderComparativos, receitas: renderReceitas,
       despesas: renderDespesas, estrategico: renderEstrategico, ia: renderIA, atualizar: renderAtualizar })[nome]();
  }
}

function render() {
  const b = D.base;
  $("#subtitulo").textContent = `${D.regime} · data-base ${dataBR(b.data, { year: "numeric" })}${b.parcial ? " (dia ainda aberto)" : ""}`;
  $("#rodape").textContent = `Dados gerados em ${new Date(D.gerado_em).toLocaleString("pt-BR")} · projeção estatística, não é garantia.`;
  desenhadas.clear();
  abrirAba("geral");
}

// ---------- gráficos ----------
Chart.defaults.font.family = "Inter, system-ui, sans-serif";
Chart.defaults.font.size = 12;

function desenhar(id, config) {
  graficos[id]?.destroy();
  graficos[id] = new Chart(document.getElementById(id), config);
}

function opcoes({ moedaY = true, legenda = true } = {}) {
  Chart.defaults.color = cor("--text-secondary");
  Chart.defaults.borderColor = cor("--border");
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: legenda, position: "top", align: "center", labels: { usePointStyle: true, pointStyle: "rectRounded", boxWidth: 10 } },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${moedaY ? brl(c.raw * 100) : c.formattedValue}` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
      y: { grid: { color: cor("--border") }, ticks: moedaY ? { callback: (v) => `R$ ${(v / 1000).toLocaleString("pt-BR")} mil` } : {} },
    },
  };
}

const barra = (label, data, v, extra = {}) => ({
  label, data, backgroundColor: cor(v), borderRadius: 4, borderSkipped: "bottom",
  borderColor: cor("--surface-1"), borderWidth: { top: 2 }, ...extra,
});

// =====================================================================
// VISÃO GERAL
// =====================================================================
function renderGeral() {
  renderKpis();
  configurarFiltrosSaldo();
  graficoSaldo();
  configurarEstimativa();
  tabelaDias();
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
    ["Projetado em 90 dias", brlK(em(90).saldo), `${dataBR(em(90).data)} · faixa ${brlK(em(90).saldo_min)} a ${brlK(em(90).saldo_max)}`],
    ["Menor saldo previsto", brlK(minimo.saldo), `em ${dataBR(minimo.data, { weekday: "short" })} · pior caso ${brlK(minimo.saldo_min)}`,
      D.caixa_minimo != null && minimo.saldo_min < D.caixa_minimo],
    ["Recebíveis Vindi", brlK(receb), "cartão já vendido, a creditar"],
    ["Vindi no mês", mesAtual.fatia_vindi != null ? `${(mesAtual.fatia_vindi * 100).toFixed(0)}%` : "-", "das entradas dos gateways"],
    ["Geração de caixa/mês", brlK(D.geracao_media_mensal), `média de ${D.meses_geracao.map(mesBR).join(", ")}`],
    ["Aplicado em fundos", brlK(D.base.aplicado_fundos),
      D.base.saldo_fundos == null ? "desde fev · saldo dos fundos não informado" : `saldo ${brlK(D.base.saldo_fundos)}`],
    ["Entradas no mês", brlK(mesAtual.entradas), `${mesLongo(mesAtual.mes)} até ${dataBR(D.base.data)}`],
  ];
  $("#kpis").innerHTML = kpis
    .map(([r, v, n, alerta]) => `<div class="kpi${alerta ? " alerta" : ""}"><div class="rotulo">${r}</div><div class="valor">${v}</div><div class="nota">${n}</div></div>`)
    .join("");
}

function segmento(id, chave, aoMudar) {
  $$(`#${id} button`).forEach((b) => b.addEventListener("click", () => {
    $$(`#${id} button`).forEach((x) => x.classList.toggle("ativo", x === b));
    estado[chave] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v;
    aoMudar();
  }));
}

function configurarFiltrosSaldo() {
  if (configurarFiltrosSaldo.feito) return;
  configurarFiltrosSaldo.feito = true;
  segmento("f-granularidade", "granularidade", graficoSaldo);
  segmento("f-periodo", "periodo", graficoSaldo);
  $("#f-projecao").addEventListener("change", (e) => { estado.projecao = e.target.checked; graficoSaldo(); });
}

const chaveGrupo = { dia: (d) => d, semana: segunda, mes: mesDe };
const rotuloGrupo = {
  dia: (k) => dataBR(k),
  semana: (k) => `${dataBR(k)}–${dataBR(addDias(k, 6))}`,
  mes: (k) => mesBR(k),
};

function agrupar(granularidade) {
  const corte = estado.periodo ? addDias(D.base.data, -30 * estado.periodo) : "0000-00-00";
  const grupos = [];
  const porChave = {};
  for (const s of SERIE) {
    if (s.data < corte || (!estado.projecao && s.tipo === "proj")) continue;
    const k = chaveGrupo[granularidade](s.data);
    if (!porChave[k]) grupos.push((porChave[k] = { chave: k, dias: [] }));
    porChave[k].dias.push(s);
  }
  return grupos.map((g) => {
    const reais = g.dias.filter((d) => d.tipo === "real");
    const proj = g.dias.filter((d) => d.tipo === "proj");
    const ult = g.dias[g.dias.length - 1];
    return {
      ...g, ...somar(g.dias),
      tipo: reais.length && proj.length ? "misto" : reais.length ? "realizado" : "projetado",
      saldoReal: reais.length ? reais[reais.length - 1].saldo : null,
      saldoProj: proj.length ? ult.saldo : null,
      min: proj.length ? ult.saldo_min : null,
      max: proj.length ? ult.saldo_max : null,
      menor: g.dias.reduce((a, x) => (x.saldo < a.saldo ? x : a), g.dias[0]),
    };
  });
}

function graficoSaldo() {
  const gr = estado.granularidade;
  const grupos = agrupar(gr);
  const real = grupos.map((g) => (g.saldoReal == null ? null : g.saldoReal / 100));
  const proj = grupos.map((g) => (g.saldoProj == null ? null : g.saldoProj / 100));
  const min = grupos.map((g) => (g.min == null ? null : g.min / 100));
  const max = grupos.map((g) => (g.max == null ? null : g.max / 100));
  const i0 = proj.findIndex((v) => v != null);
  if (i0 > 0 && real[i0 - 1] != null && grupos[i0].saldoReal == null) {
    proj[i0 - 1] = min[i0 - 1] = max[i0 - 1] = real[i0 - 1];
  } else if (i0 >= 0 && real[i0] != null) {
    min[i0] = Math.min(min[i0], real[i0]); max[i0] = Math.max(max[i0], real[i0]);
  }
  const s1 = cor("--series-1");
  const opc = opcoes();
  opc.plugins.legend.labels.filter = (l) => !l.text.startsWith("_");
  opc.plugins.tooltip.filter = (c) => c.raw != null && !c.dataset.label.startsWith("_");
  opc.plugins.tooltip.callbacks.title = (it) => {
    const g = grupos[it[0].dataIndex];
    return gr === "dia" ? dataBR(g.chave, { weekday: "short", year: "numeric" }) : `${gr === "mes" ? mesLongo(g.chave) : "Semana " + rotuloGrupo.semana(g.chave)} (${g.tipo})`;
  };
  opc.plugins.tooltip.callbacks.footer = (it) => {
    if (gr === "dia") return [];
    const g = grupos[it[0].dataIndex];
    return [`Entradas: ${brl(g.entradas)}`, `Saídas: ${brl(g.saidas)}`, `Menor saldo: ${brl(g.menor.saldo)} em ${dataBR(g.menor.data)}`];
  };
  const tipoGrafico = gr === "dia" ? "line" : "line";
  desenhar("g-saldo", {
    type: tipoGrafico,
    data: {
      labels: grupos.map((g) => (gr === "semana" ? dataBR(g.chave) : rotuloGrupo[gr](g.chave))),
      datasets: [
        { label: "_max", data: max, borderWidth: 0, pointRadius: 0, fill: "+1", backgroundColor: cor("--band") },
        { label: "_min", data: min, borderWidth: 0, pointRadius: 0, fill: false },
        { label: "Realizado", data: real, borderColor: s1, backgroundColor: s1, borderWidth: 2, pointRadius: gr === "dia" ? 0 : 3, tension: 0.2 },
        { label: "Projetado", data: proj, borderColor: s1, backgroundColor: cor("--band"), borderWidth: 2, borderDash: [6, 4], pointRadius: gr === "dia" ? 0 : 3, tension: 0.2 },
      ],
    },
    options: opc,
  });
  const nomes = { dia: "fim de cada dia", semana: "fim de cada semana (seg–dom)", mes: "fim de cada mês" };
  $("#nota-saldo").textContent = `Saldo no ${nomes[gr]}. Realizado = Itaú (conta + aplicação automática). Faixa sombreada = incerteza da projeção.`;
  $("#t-saldo").innerHTML = `<thead><tr><th>Período</th><th>Situação</th><th>Entradas</th><th>Saídas</th><th>Líquido</th><th>Menor saldo</th><th>Saldo final</th></tr></thead><tbody>${
    grupos.slice().reverse().map((g) => `<tr><td>${gr === "mes" ? mesLongo(g.chave) : rotuloGrupo[gr](g.chave)}</td><td class="txt">${g.tipo}</td>
      <td class="pos">${brl(g.entradas)}</td><td class="neg">${brl(g.saidas)}</td><td>${brl(g.liquido)}</td>
      <td>${brl(g.menor.saldo)}</td><td><strong>${brl(g.saldoProj ?? g.saldoReal)}</strong></td></tr>`).join("")
  }</tbody>`;
}

// ---------- estimativa dia / semana / mês ----------
function configurarEstimativa() {
  const inp = $("#est-data");
  inp.min = SERIE[0].data;
  inp.max = SERIE[SERIE.length - 1].data;
  inp.value = D.projecao[0].data;
  if (configurarEstimativa.feito) return detalheEstimativa();
  configurarEstimativa.feito = true;
  segmento("f-escala", "escala", detalheEstimativa);
  inp.addEventListener("change", detalheEstimativa);
  const mover = (dir) => {
    const v = inp.value;
    const novo = estado.escala === "dia" ? addDias(v, dir) : estado.escala === "semana" ? addDias(v, 7 * dir)
      : iso(new Date(+v.slice(0, 4), +v.slice(5, 7) - 1 + dir, 1));
    if (novo >= inp.min && novo <= inp.max) { inp.value = novo; detalheEstimativa(); }
  };
  $("#est-ant").addEventListener("click", () => mover(-1));
  $("#est-prox").addEventListener("click", () => mover(1));
  detalheEstimativa();
}

function periodoEstimativa(ref) {
  if (estado.escala === "dia") return [ref, ref];
  if (estado.escala === "semana") return [segunda(ref), addDias(segunda(ref), 6)];
  const m = mesDe(ref);
  return [`${m}-01`, `${m}-${String(diasNoMes(m)).padStart(2, "0")}`];
}

function detalheEstimativa() {
  const [ini, fim] = periodoEstimativa($("#est-data").value);
  const dias = SERIE.filter((s) => s.data >= ini && s.data <= fim);
  if (!dias.length) { $("#est-detalhe").innerHTML = '<p class="muted centro">Sem dados para o período.</p>'; return; }
  const t = somar(dias);
  const nReal = dias.filter((d) => d.tipo === "real").length;
  const situacao = nReal === dias.length ? "realizado" : nReal ? `${nReal} dia(s) realizados + ${dias.length - nReal} projetados` : "projetado";
  const anterior = SERIE[IDX[dias[0].data] - 1];
  const ultimo = dias[dias.length - 1];
  const menor = dias.reduce((a, x) => (x.saldo < a.saldo ? x : a), dias[0]);
  const titulo = estado.escala === "dia" ? dataBR(ini, { weekday: "long", year: "numeric" })
    : estado.escala === "semana" ? `Semana de ${dataBR(ini)} a ${dataBR(fim)}` : mesLongo(mesDe(ini));

  // Saídas previstas agregadas por contraparte no período.
  const porNome = {};
  for (const d of dias) for (const r of d.recorrentes) porNome[r.nome] = (porNome[r.nome] || 0) + r.valor;
  const recorr = Object.entries(porNome).sort((a, b) => a[1] - b[1]);
  const variaveis = dias.reduce((s, d) => s + d.variaveis, 0);
  const taxa = dias.reduce((s, d) => s + d.taxa, 0);
  const saidasReais = dias.filter((d) => d.tipo === "real").reduce((s, d) => s + d.saidas, 0);
  const receb = D.recebiveis_vindi.filter((r) => r.data >= ini && r.data <= fim).reduce((s, r) => s + r.valor, 0);
  const linha = (a, b, cls = "") => `<div class="linha"><span>${a}</span><span class="${cls}">${b}</span></div>`;
  const foraDre = anterior ? Math.round(ultimo.saldo - anterior.saldo - t.liquido) : 0;
  const foraDreTxt = Math.abs(foraDre) >= 100;

  // Movimentos realizados relevantes (dias já ocorridos).
  const movReais = D.lancamentos_recentes.filter((l) => l.data >= ini && l.data <= fim && l.data <= D.base.data)
    .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)).slice(0, 8);

  const tabelaDiaria = estado.escala === "dia" ? "" : `<div class="tabela-wrap"><table>
    <thead><tr><th>Dia</th><th></th><th>Entradas</th><th>Saídas</th><th>Saldo</th></tr></thead><tbody>${
      dias.map((d) => `<tr class="${diaUtil(d.data) ? "" : "fds"}"><td>${dataBR(d.data, { weekday: "short" })}</td>
        <td class="txt">${d.tipo === "real" ? "realizado" : "projetado"}</td><td class="pos">${brl(totEnt(d))}</td>
        <td class="neg">${brl(d.saidas)}</td><td><strong>${brl(d.saldo)}</strong></td></tr>`).join("")}</tbody></table></div>`;

  $("#est-detalhe").innerHTML = `
    <div class="centro"><strong>${titulo}</strong><span class="selo">${situacao}</span></div>
    <div class="est-topo">
      <div><div class="rot">Saldo inicial</div><div class="grande">${anterior ? brlK(anterior.saldo) : "-"}</div></div>
      <div><div class="rot">Saldo final</div><div class="grande">${brlK(ultimo.saldo)}</div>
        <div class="rot">${ultimo.tipo === "proj" ? `faixa ${brlK(ultimo.saldo_min)} a ${brlK(ultimo.saldo_max)}` : "realizado"}</div></div>
      <div><div class="rot">Menor saldo no período</div><div class="grande">${brlK(menor.saldo)}</div><div class="rot">em ${dataBR(menor.data, { weekday: "short" })}</div></div>
    </div>
    <div class="dia-colunas">
      <div><h3>Entradas · ${brl(t.entradas)}</h3>
        ${linha('<span class="sw" style="background:var(--series-1)"></span>Vindi', brl(t.vindi))}
        ${receb ? linha("· dos quais recebíveis de cartão já vendidos", brl(receb)) : ""}
        ${linha('<span class="sw" style="background:var(--series-2)"></span>Bambuno', brl(t.bambuno))}
        ${linha('<span class="sw" style="background:var(--series-3)"></span>Outros', brl(t.outros))}
      </div>
      <div><h3>Saídas · ${brl(t.saidas)}</h3>
        ${saidasReais ? linha("Saídas realizadas", brl(saidasReais), "neg") : ""}
        ${recorr.map(([n, v]) => linha(esc(n), brl(v), "neg")).join("")}
        ${variaveis ? linha("Despesas variáveis (média por dia útil)", brl(variaveis), "neg") : ""}
        ${taxa ? linha("Taxas Vindi", brl(taxa), "neg") : ""}
      </div>
    </div>
    ${foraDreTxt ? `<p class="muted centro" style="margin:0;font-size:12.5px">Além disso, ${brl(foraDre)} de movimentos que mexem no saldo mas não são receita/despesa
      (aplicações e resgates em fundos, repasses da conta digital Vindi). Por isso saldo inicial + entradas + saídas ≠ saldo final.</p>` : ""}
    ${movReais.length ? `<div><h3 class="centro">Maiores movimentos realizados</h3>${
      movReais.map((l) => linha(`${dataBR(l.data)} · ${esc(l.contraparte || l.descricao)}`, brl(l.valor), l.valor < 0 ? "neg" : "pos")).join("")}</div>` : ""}
    ${tabelaDiaria}`;
}

function tabelaDias() {
  const linhas = D.projecao.slice(0, 14).map((p) => {
    const itens = p.saidas_recorrentes.map((i) => `${esc(i.nome)} (${brlK(-i.valor)})`).join(", ");
    return `<tr class="${p.util ? "" : "fds"}">
      <td>${dataBR(p.data, { weekday: "short" })}</td>
      <td>${brl(p.entradas.vindi)}</td><td>${brl(p.entradas.bambuno)}</td>
      <td class="pos">${brl(p.entradas.vindi + p.entradas.bambuno + p.entradas.outros)}</td><td class="neg">${brl(p.saidas)}</td>
      <td><strong>${brl(p.saldo)}</strong></td>
      <td class="txt">${itens || (p.util ? "despesas variáveis médias" : "fim de semana/feriado")}</td>
    </tr>`;
  });
  $("#t-dias").innerHTML = `<thead><tr><th>Dia</th><th><span class="sw" style="background:var(--series-1)"></span>Vindi</th>
    <th><span class="sw" style="background:var(--series-2)"></span>Bambuno</th><th>Entradas</th><th>Saídas</th><th>Saldo</th>
    <th>Pagamentos previstos</th></tr></thead><tbody>${linhas.join("")}</tbody>`;
}

// =====================================================================
// COMPARATIVOS
// =====================================================================
function realEntre(ini, fim) {
  return somar(SERIE.filter((s) => s.tipo === "real" && s.data >= ini && s.data <= fim));
}

function causas(a, b) {
  // Contrapartes que mais explicam a diferença entre o período atual (a) e o anterior (b).
  const g = {};
  const add = ([i, f], lado) => {
    for (const l of D.lancamentos_recentes) {
      if (l.data < i || l.data > f) continue;
      const k = l.contraparte || l.descricao.replace(/\s*\(soma do dia\)/, "");
      g[k] = g[k] || { atual: 0, anterior: 0 };
      g[k][lado] += l.valor;
    }
  };
  add(a, "atual");
  add(b, "anterior");
  return Object.entries(g).map(([k, v]) => ({ nome: k, ...v, dif: v.atual - v.anterior }))
    .sort((x, y) => Math.abs(y.dif) - Math.abs(x.dif)).slice(0, 4);
}

function cartaoComparativo(titulo, a, b, aviso = "") {
  const ta = realEntre(...a), tb = realEntre(...b);
  const linha = (rot, k, inverso = false) => {
    const dif = ta[k] - tb[k];
    const pct = tb[k] ? dif / Math.abs(tb[k]) : null;
    const bom = inverso ? dif > 0 : dif > 0;
    return `<tr><td>${rot}</td><td>${brl(ta[k])}</td><td>${brl(tb[k])}</td>
      <td class="${dif === 0 ? "" : bom ? "pos" : "neg"}">${brl(dif)}</td><td>${pctFmt(pct)}</td></tr>`;
  };
  const cs = causas(a, b).map((c) => {
    const verbo = c.dif > 0 ? (c.atual >= 0 ? "entrou mais" : "saiu menos") : (c.atual > 0 || c.anterior > 0 ? "entrou menos" : "saiu mais");
    return `<li><strong>${esc(c.nome)}</strong>: ${verbo} (${brl(c.atual)} agora × ${brl(c.anterior)} antes)</li>`;
  }).join("");
  return `<div class="comp">
    <h3>${titulo}</h3>
    <div class="periodos">${dataBR(a[0])}–${dataBR(a[1])} × ${dataBR(b[0])}–${dataBR(b[1])}</div>
    ${aviso ? `<div class="alerta-comp">${aviso}</div>` : ""}
    <div class="tabela-wrap"><table><thead><tr><th></th><th>Atual</th><th>Anterior</th><th>Variação</th><th>%</th></tr></thead><tbody>
      ${linha('<span class="sw" style="background:var(--series-1)"></span>Vindi', "vindi")}
      ${linha('<span class="sw" style="background:var(--series-2)"></span>Bambuno', "bambuno")}
      ${linha('<span class="sw" style="background:var(--series-3)"></span>Outros', "outros")}
      ${linha("<strong>Entradas</strong>", "entradas")}
      ${linha("<strong>Saídas</strong>", "saidas")}
      ${linha("<strong>Líquido</strong>", "liquido")}
    </tbody></table></div>
    <p class="muted" style="margin:10px 0 0;font-size:12.5px">O que mais explica a diferença:</p>
    <ul class="causas">${cs}</ul>
  </div>`;
}

function renderComparativos() {
  const base = D.base.data;
  const m = mesDe(base), mAnt = mesAnterior(m);
  const dia = +base.slice(8, 10);
  $("#comp-intro").textContent = `Data-base ${dataBR(base, { weekday: "long", year: "numeric" })}. Valores realizados em regime de caixa. ` +
    "O comparativo com o mesmo mês do ano anterior aparece quando houver 12+ meses de histórico.";

  // A) semana ordinal do mês: semana (seg–dom) que contém a data-base vs a mesma semana ordinal do mês anterior.
  const seg = segunda(base);
  const offset = (dt) => (toD(dt).getDay() + 6) % 7;
  const ordinal = Math.ceil((dia + offset(`${m}-01`)) / 7);
  const iniAnt = addDias(segunda(`${mAnt}-01`), 7 * (ordinal - 1));
  let aviso = "";
  let segAnt = iniAnt;
  if (mesDe(iniAnt) > mAnt) { segAnt = segunda(`${mAnt}-${diasNoMes(mAnt)}`); aviso = `O mês anterior não tem a ${ordinal}ª semana: usada a última.`; }
  const decorridos = Math.round((toD(base) - toD(seg)) / 864e5);
  const a1 = [seg, base], b1 = [segAnt, addDias(segAnt, decorridos)];
  const ini2 = mesDe(seg) === m ? seg : `${m}-01`;
  const d2i = Math.min(+ini2.slice(8, 10), diasNoMes(mAnt)), d2f = Math.min(dia, diasNoMes(mAnt));
  const a2 = [ini2, base], b2 = [`${mAnt}-${String(d2i).padStart(2, "0")}`, `${mAnt}-${String(d2f).padStart(2, "0")}`];
  $("#comp-semana").innerHTML =
    cartaoComparativo(`A · ${ordinal}ª semana do mês × ${ordinal}ª semana do mês anterior (até o mesmo dia da semana)`, a1, b1, aviso) +
    cartaoComparativo("A · Mesmo intervalo de dias do mês", a2, b2);

  // B) MTD por dias corridos e por dias úteis.
  const a3 = [`${m}-01`, base], b3 = [`${mAnt}-01`, `${mAnt}-${String(Math.min(dia, diasNoMes(mAnt))).padStart(2, "0")}`];
  let uteis = 0;
  for (let d = `${m}-01`; d <= base; d = addDias(d, 1)) if (diaUtil(d)) uteis++;
  let fimUteis = `${mAnt}-01`, cont = 0;
  for (let d = `${mAnt}-01`; mesDe(d) === mAnt; d = addDias(d, 1)) {
    if (diaUtil(d)) cont++;
    fimUteis = d;
    if (cont === uteis) break;
  }
  $("#comp-mes").innerHTML =
    cartaoComparativo("B · Mês até a data (dias corridos)", a3, b3) +
    cartaoComparativo(`B · Mês até a data (${uteis} dias úteis)`, a3, [`${mAnt}-01`, fimUteis]);

  // Semanas realizadas.
  const semanas = [];
  const porSem = {};
  for (const s of SERIE) {
    if (s.tipo !== "real") continue;
    const k = segunda(s.data);
    if (!porSem[k]) semanas.push((porSem[k] = { k, dias: [] }));
    porSem[k].dias.push(s);
  }
  const ult = semanas.slice(-16).map((w) => ({ k: w.k, ...somar(w.dias) }));
  const opc = opcoes();
  opc.plugins.tooltip.callbacks.title = (it) => `Semana ${rotuloGrupo.semana(ult[it[0].dataIndex].k)}`;
  desenhar("g-semanas", {
    type: "bar",
    data: {
      labels: ult.map((w) => dataBR(w.k)),
      datasets: [
        barra("Entradas", ult.map((w) => w.entradas / 100), "--series-1"),
        barra("Saídas", ult.map((w) => -w.saidas / 100), "--series-2"),
      ],
    },
    options: opc,
  });
}

// =====================================================================
// RECEITAS
// =====================================================================
function renderReceitas() {
  const E = D.estrategico;
  const vm = E.vindi_mensal;
  const completos = D.mensal.filter((m) => m.completo_receita);
  const ult = completos[completos.length - 1], ant3 = completos.slice(-4, -1);
  const media3 = ant3.reduce((s, m) => s + m.entradas, 0) / Math.max(1, ant3.length);
  const vUlt = vm[vm.length - 1], vPen = vm[vm.length - 2];
  const kpis = [
    ["Entradas último mês completo", brlK(ult.entradas), `${mesLongo(ult.mes)} · ${pctFmt(ult.entradas / media3 - 1)} vs média dos 3 anteriores`],
    ["Clientes pagantes Vindi", vUlt.clientes, `${mesLongo(vUlt.mes)}${vPen ? ` · ${vPen.clientes} em ${mesBR(vPen.mes)}` : ""}`],
    ["Ticket médio Vindi", brl(vUlt.ticket), "receita bruta ÷ clientes pagantes no mês"],
    ["Recebimento em cartão (Vindi)", `${Math.round(((vUlt.meios["Cartão"] || 0) / vUlt.bruto) * 100)}%`, `boleto ${Math.round(((vUlt.meios["Boleto"] || 0) / vUlt.bruto) * 100)}% · pix ${Math.round(((vUlt.meios["Pix"] || 0) / vUlt.bruto) * 100)}%`],
    ["Taxa média Vindi", `${((-vUlt.taxa / vUlt.bruto) * 100).toFixed(2).replace(".", ",")}%`, "do valor recebido"],
    ["Tendência da migração", `${D.premissas.tendencia_vindi_pp_mes > 0 ? "+" : ""}${D.premissas.tendencia_vindi_pp_mes} p.p./mês`, "ganho mensal de participação da Vindi"],
  ];
  $("#kpis-receitas").innerHTML = kpis.map(([r, v, n]) => `<div class="kpi"><div class="rotulo">${r}</div><div class="valor">${v}</div><div class="nota">${n}</div></div>`).join("");

  // Entradas por canal
  const meses = D.mensal;
  const opc = opcoes();
  opc.scales.x.stacked = opc.scales.y.stacked = true;
  opc.plugins.tooltip.callbacks.footer = (it) => {
    const m = meses[it[0].dataIndex];
    const notas = [`Total: ${brl(m.entradas)}`];
    if (!m.completo_receita) notas.push("Mês incompleto ou com receita Vindi parcial");
    if (m.estimado) notas.push("Inclui receita Vindi estimada por repasse");
    return notas;
  };
  desenhar("g-canais", {
    type: "bar",
    data: {
      labels: meses.map((m) => mesBR(m.mes) + (m.completo_receita ? "" : "*")),
      datasets: [barra("Vindi", meses.map((m) => m.vindi / 100), "--series-1"), barra("Bambuno", meses.map((m) => m.bambuno / 100), "--series-2"),
        barra("Outros", meses.map((m) => m.outros / 100), "--series-3")],
    },
    options: opc,
  });

  // Migração
  const mf = D.mensal.filter((m) => m.fatia_vindi != null);
  const futuros = Object.entries(D.premissas.fatia_vindi_por_mes).filter(([k]) => !mf.some((x) => x.mes === k));
  const labels = [...mf.map((m) => m.mes), ...futuros.map(([k]) => k)];
  const o2 = opcoes({ moedaY: false });
  o2.scales.y.min = 0; o2.scales.y.max = 100;
  o2.scales.y.ticks = { callback: (v) => `${v}%` };
  o2.plugins.tooltip.callbacks.label = (c) => `${c.dataset.label}: ${c.raw.toFixed(1)}%`;
  o2.plugins.tooltip.filter = (c) => c.raw != null;
  const s1 = cor("--series-1");
  desenhar("g-fatia", {
    type: "line",
    data: {
      labels: labels.map(mesBR),
      datasets: [
        { label: "Vindi (realizado)", data: [...mf.map((m) => m.fatia_vindi * 100), ...futuros.map(() => null)], borderColor: s1, backgroundColor: s1, borderWidth: 2, pointRadius: 4 },
        { label: "Tendência", data: [...mf.map((m, i) => (i === mf.length - 1 ? m.fatia_vindi * 100 : null)), ...futuros.map(([, v]) => v * 100)], borderColor: s1, backgroundColor: cor("--band"), borderDash: [6, 4], borderWidth: 2, pointRadius: 0 },
      ],
    },
    options: o2,
  });

  // Clientes e ticket (um gráfico cada: escalas diferentes)
  const o3 = opcoes({ moedaY: false, legenda: false });
  o3.plugins.tooltip.callbacks.label = (c) => `${c.raw} clientes`;
  desenhar("g-clientes", {
    type: "bar",
    data: { labels: vm.map((v) => mesBR(v.mes)), datasets: [barra("Clientes", vm.map((v) => v.clientes), "--series-1")] },
    options: o3,
  });
  const o4 = opcoes({ legenda: false });
  o4.scales.y.ticks = { callback: (v) => moeda.format(v) };
  o4.scales.y.beginAtZero = true;
  desenhar("g-ticket", {
    type: "line",
    data: { labels: vm.map((v) => mesBR(v.mes)), datasets: [{ label: "Ticket médio", data: vm.map((v) => v.ticket / 100), borderColor: s1, backgroundColor: s1, borderWidth: 2, pointRadius: 4 }] },
    options: o4,
  });

  // Mix de meios (100%)
  const meios = [["Boleto", "--series-1"], ["Cartão", "--series-2"], ["Pix", "--series-3"], ["Bolepix", "--series-4"]];
  const o5 = opcoes({ moedaY: false });
  o5.scales.x.stacked = o5.scales.y.stacked = true;
  o5.scales.y.max = 100;
  o5.scales.y.ticks = { callback: (v) => `${v}%` };
  o5.plugins.tooltip.callbacks.label = (c) => `${c.dataset.label}: ${c.raw.toFixed(1)}%`;
  desenhar("g-meios", {
    type: "bar",
    data: {
      labels: vm.map((v) => mesBR(v.mes)),
      datasets: meios.map(([n, c]) => barra(n, vm.map((v) => ((v.meios[n] || 0) / v.bruto) * 100), c)),
    },
    options: o5,
  });

  // Perfil por dia do mês
  const perfil = E.perfil_entradas_dia_mes;
  const top = perfil.map((v, i) => [i + 1, v]).sort((a, b) => b[1] - a[1]);
  let acum = 0, dias = [];
  for (const [d, v] of top) { if (acum >= 0.5) break; acum += v; dias.push(d); }
  $("#nota-perfil").textContent = `${Math.round(acum * 100)}% das entradas dos gateways caem em só ${dias.length} dias do mês: ${dias.sort((a, b) => a - b).join(", ")}.`;
  const o6 = opcoes({ moedaY: false, legenda: false });
  o6.scales.y.ticks = { callback: (v) => `${v}%` };
  o6.plugins.tooltip.callbacks.title = (it) => `Dia ${it[0].label}`;
  o6.plugins.tooltip.callbacks.label = (c) => `${c.raw.toFixed(1)}% das entradas do mês`;
  desenhar("g-perfil", {
    type: "bar",
    data: { labels: perfil.map((_, i) => i + 1), datasets: [barra("Participação", perfil.map((v) => v * 100), "--series-1")] },
    options: o6,
  });
}

// =====================================================================
// DESPESAS
// =====================================================================
function renderDespesas() {
  const E = D.estrategico;
  const fv = E.saidas_fixas_variaveis.filter((x) => D.mensal.find((m) => m.mes === x.mes)?.completo_despesa);
  const u3 = fv.slice(-3);
  const med = (k) => u3.reduce((s, x) => s + x[k], 0) / Math.max(1, u3.length);
  const ent3 = D.mensal.filter((m) => u3.some((x) => x.mes === m.mes)).reduce((s, m) => s + m.entradas, 0) / Math.max(1, u3.length);
  const fixas = med("fixas"), variaveis = med("variaveis");
  const kpis = [
    ["Saídas médias/mês", brlK(-(fixas + variaveis)), `últimos 3 meses completos (${u3.map((x) => mesBR(x.mes)).join(", ")})`],
    ["Custos fixos/mês", brlK(-fixas), `${Math.round((fixas / (fixas + variaveis)) * 100)}% das saídas`],
    ["Custos fixos ÷ entradas", `${Math.round((-fixas / ent3) * 100)}%`, "quanto da receita já nasce comprometida"],
    ["Variáveis/mês", brlK(-variaveis), "pagamentos sem padrão mensal"],
  ];
  $("#kpis-despesas").innerHTML = kpis.map(([r, v, n]) => `<div class="kpi"><div class="rotulo">${r}</div><div class="valor">${v}</div><div class="nota">${n}</div></div>`).join("");

  const todas = E.saidas_fixas_variaveis;
  const opc = opcoes();
  opc.scales.x.stacked = opc.scales.y.stacked = true;
  desenhar("g-fixvar", {
    type: "bar",
    data: {
      labels: todas.map((x) => mesBR(x.mes) + (D.mensal.find((m) => m.mes === x.mes)?.completo_despesa ? "" : "*")),
      datasets: [barra("Fixas", todas.map((x) => -x.fixas / 100), "--series-1"), barra("Variáveis", todas.map((x) => -x.variaveis / 100), "--series-2")],
    },
    options: opc,
  });

  const top = E.top_saidas;
  $("#nota-top").textContent = `${E.meses_top_saidas.map(mesBR).join(", ")} · azul = recorrente (fixa), laranja = variável`;
  const o2 = opcoes({ legenda: false });
  o2.indexAxis = "y";
  o2.interaction = { mode: "nearest", intersect: true, axis: "y" };
  o2.scales.x = { grid: { color: cor("--border") }, ticks: { callback: (v) => `R$ ${(v / 1000).toLocaleString("pt-BR")} mil` } };
  o2.scales.y = { grid: { display: false }, ticks: { autoSkip: false, callback: function (v) { const t = this.getLabelForValue(v); return t.length > 28 ? t.slice(0, 27) + "…" : t; } } };
  o2.plugins.tooltip.callbacks.label = (c) => `${top[c.dataIndex].fixa ? "Fixa" : "Variável"} · média ${brl(c.raw * 100)}/mês`;
  desenhar("g-top", {
    type: "bar",
    data: {
      labels: top.map((t) => t.nome),
      datasets: [{
        label: "Média mensal", data: top.map((t) => -t.media_mensal / 100),
        backgroundColor: top.map((t) => cor(t.fixa ? "--series-1" : "--series-2")), borderRadius: 4, borderSkipped: "left",
      }],
    },
    options: o2,
  });

  $("#t-recorrentes").innerHTML = `<thead><tr><th>Contraparte</th><th>Dia típico</th><th>Meses</th><th>Valor/mês</th></tr></thead><tbody>${
    D.recorrentes.map((i) => `<tr><td>${esc(i.nome)}</td><td>${i.perfil ? "vários" : i.dia}</td><td>${i.meses}/3</td><td class="neg">${brl(i.valor)}</td></tr>`).join("")
  }</tbody>`;
}

// =====================================================================
// ESTRATÉGICO
// =====================================================================
function renderEstrategico() {
  const comp = D.mensal.filter((m) => m.completo_receita).slice(-3);
  const ent = comp.reduce((s, m) => s + m.entradas, 0) / comp.length;
  const sai = comp.reduce((s, m) => s + m.saidas + m.taxa_vindi, 0) / comp.length;
  const fv = D.estrategico.saidas_fixas_variaveis.filter((x) => D.mensal.find((m) => m.mes === x.mes)?.completo_despesa).slice(-3);
  const fixos = fv.reduce((s, x) => s + x.fixas, 0) / Math.max(1, fv.length);
  const caixa = D.base.saldo_itau + (D.base.saldo_fundos || 0);
  const comFundos = D.base.saldo_itau + (D.base.saldo_fundos ?? D.base.aplicado_fundos);
  const num = (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const margem = (ent + sai) / ent;
  const p30 = D.projecao.slice(0, 30);
  const receb30 = D.recebiveis_vindi.filter((r) => r.data <= p30[29].data).reduce((s, r) => s + r.valor, 0);
  const ent30 = p30.reduce((s, p) => s + p.entradas.vindi + p.entradas.bambuno + p.entradas.outros, 0);
  const fixos30 = p30.reduce((s, p) => s + p.saidas_recorrentes.reduce((a, i) => a + i.valor, 0), 0);
  const sai30 = p30.reduce((s, p) => s + p.saidas, 0);
  const tend = D.premissas.tendencia_vindi_pp_mes;
  const fat = Object.entries(D.premissas.fatia_vindi_por_mes);
  const [ultMes, ultFat] = fat[fat.length - 1];
  const mesesPara = (alvo) => (tend > 0 ? Math.max(0, Math.ceil((alvo - ultFat * 100) / tend)) : null);
  const mesAlvo = (n) => { const d = new Date(+ultMes.slice(0, 4), +ultMes.slice(5, 7) - 1 + n, 1); return mesLongo(iso(d).slice(0, 7)); };
  const semanas = {};
  for (const p of D.projecao) { const k = segunda(p.data); semanas[k] = (semanas[k] || 0) + p.entradas.vindi + p.entradas.bambuno + p.entradas.outros + p.saidas; }
  const pior = Object.entries(semanas).sort((a, b) => a[1] - b[1])[0];
  const bambuno = D.mensal[D.mensal.length - 1];
  const ind = [
    ["Cobertura de custos fixos", `${num(caixa / -fixos)} meses`, `O caixa em conta (${brlK(caixa)}) paga ${num(caixa / -fixos)} mês(es) dos custos fixos (${brlK(-fixos)}/mês) sem receita nova. Somando os ${brlK(comFundos - D.base.saldo_itau)} ${D.base.saldo_fundos == null ? "aplicados em fundos (valor aplicado; saldo não informado)" : "dos fundos"}: ${num(comFundos / -fixos)} meses.`, comFundos / -fixos >= 3],
    ["Margem de caixa operacional", `${num(margem * 100)}%`, `De cada R$ 100 que entram, sobram R$ ${(margem * 100).toFixed(0)} depois de todas as saídas operacionais (média de ${comp.map((m) => mesBR(m.mes)).join(", ")}).`, margem > 0.1],
    ["Ponto de equilíbrio de caixa", brlK(-sai), `Entradas mínimas por mês para não queimar caixa. Hoje a média é ${brlK(ent)}: folga de ${pctFmt(ent / -sai - 1)}.`, ent > -sai],
    ["Previsibilidade dos próximos 30 dias", `${Math.round((receb30 / ent30) * 100)}% / ${Math.round((fixos30 / sai30) * 100)}%`, `Das entradas previstas, ${Math.round((receb30 / ent30) * 100)}% já estão vendidas (recebíveis de cartão). Das saídas, ${Math.round((fixos30 / sai30) * 100)}% são compromissos recorrentes.`, null],
    ["Dependência do canal antigo", `${Math.round((1 - (bambuno.fatia_vindi ?? 0)) * 100)}%`, `Parcela das entradas dos gateways ainda no Bambuno em ${mesLongo(bambuno.mes)}. No ritmo atual (${tend > 0 ? "+" : ""}${tend} p.p./mês), a Vindi passa de 80% em ${mesesPara(80) != null ? mesAlvo(mesesPara(80)) : "-"}.`, null],
    ["Semana mais apertada", brlK(pior[1]), `Resultado líquido previsto da semana de ${dataBR(pior[0])}: é a que mais consome caixa nos próximos 90 dias.`, pior[1] >= 0],
  ];
  $("#indicadores").innerHTML = ind.map(([r, v, e, ok]) =>
    `<div class="ind${ok === true ? " bom" : ok === false ? " ruim" : ""}"><div class="rotulo">${r}</div><div class="valor">${v}</div><div class="explica">${e}</div></div>`).join("");

  // Simulador
  ["s-ent", "s-sai", "s-pag-valor", "s-pag-data", "s-rec-valor", "s-rec-data"].forEach((id) => $(`#${id}`).addEventListener("input", simular));
  ["s-pag-data", "s-rec-data"].forEach((id) => { $(`#${id}`).min = D.projecao[0].data; $(`#${id}`).max = D.projecao[D.projecao.length - 1].data; });
  simular();

  // Precisão e avisos
  const pct = (prev, real) => (real ? pctFmt(Math.abs(prev) / Math.abs(real) - 1) : "-");
  $("#backtest").innerHTML = `<p class="muted centro">O modelo projetou cada mês usando só os dados anteriores a ele:</p>` +
    D.backtests.map((b) => `<div class="backtest-item"><strong>${mesBR(b.mes)}</strong><br>
      Entradas: previsto ${brlK(b.entradas_previstas)} × real ${brlK(b.entradas_reais)} (${pct(b.entradas_previstas, b.entradas_reais)})<br>
      Saídas: previsto ${brlK(-b.saidas_previstas)} × real ${brlK(-b.saidas_reais)} (${pct(b.saidas_previstas, b.saidas_reais)})</div>`).join("");
  $("#avisos").innerHTML = D.avisos.map((a) => `<li>${esc(a)}</li>`).join("");
}

function simular() {
  const fe = +$("#s-ent").value / 100, fs = +$("#s-sai").value / 100;
  $("#o-ent").textContent = pctFmt(fe); $("#o-sai").textContent = pctFmt(fs);
  const pagV = Math.round((+$("#s-pag-valor").value || 0) * 100), pagD = $("#s-pag-data").value;
  const recV = Math.round((+$("#s-rec-valor").value || 0) * 100), recD = $("#s-rec-data").value;
  let saldo = D.base.saldo_itau;
  const cen = D.projecao.map((p) => {
    const e = p.entradas.vindi + p.entradas.bambuno + p.entradas.outros;
    saldo += e * (1 + fe) + p.saidas * (1 + fs) - (p.data === pagD ? pagV : 0) + (p.data === recD ? recV : 0);
    return Math.round(saldo);
  });
  const minI = cen.indexOf(Math.min(...cen));
  const at = (n) => cen[Math.min(n, cen.length) - 1];
  const base = D.projecao.map((p) => p.saldo);
  const kp = [
    ["Em 30 dias", brlK(at(30)), `base ${brlK(base[29])}`],
    ["Em 60 dias", brlK(at(60)), `base ${brlK(base[59])}`],
    ["Em 90 dias", brlK(at(90)), `base ${brlK(base[89])}`],
    ["Menor saldo", brlK(cen[minI]), `em ${dataBR(D.projecao[minI].data)}`, cen[minI] < 0 || (D.caixa_minimo != null && cen[minI] < D.caixa_minimo)],
  ];
  $("#sim-kpis").innerHTML = kp.map(([r, v, n, al]) => `<div class="kpi${al ? " alerta" : ""}"><div class="rotulo">${r}</div><div class="valor">${v}</div><div class="nota">${n}</div></div>`).join("");
  const opc = opcoes();
  opc.plugins.tooltip.callbacks.title = (it) => dataBR(D.projecao[it[0].dataIndex].data, { weekday: "short", year: "numeric" });
  const s1 = cor("--series-1"), s2 = cor("--series-2");
  const dados = {
    labels: D.projecao.map((p) => dataBR(p.data)),
    datasets: [
      { label: "Cenário", data: cen.map((v) => v / 100), borderColor: s2, backgroundColor: s2, borderWidth: 2, pointRadius: 0, tension: 0.2 },
      { label: "Projeção base", data: base.map((v) => v / 100), borderColor: s1, backgroundColor: s1, borderWidth: 2, borderDash: [6, 4], pointRadius: 0, tension: 0.2 },
    ],
  };
  if (graficos["g-cenario"]) { graficos["g-cenario"].data = dados; graficos["g-cenario"].update("none"); }
  else desenhar("g-cenario", { type: "line", data: dados, options: opc });
}

// =====================================================================
// IA
// =====================================================================
function renderIA() {
  const prox = D.projecao.find((p) => p.saidas_recorrentes.length > 2) || D.projecao[7];
  const sugestoes = [
    "Como fica meu caixa dia a dia nesta semana?",
    `Explique a estimativa do dia ${dataBR(prox.data)}.`,
    "Quais os maiores riscos de caixa nos próximos 30 dias?",
    "Analise a migração Bambuno → Vindi e o impacto no caixa.",
    "Onde estão as maiores saídas e o que dá para cortar?",
    "Quais 3 decisões financeiras você recomenda para este trimestre?",
  ];
  $("#sugestoes").innerHTML = sugestoes.map((s) => `<button type="button">${esc(s)}</button>`).join("");
  $$("#sugestoes button").forEach((b) => b.addEventListener("click", () => perguntar(b.textContent)));
}

$("#form-ia").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#pergunta").value.trim();
  if (q) perguntar(q);
});
$("#pergunta").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#form-ia").requestSubmit(); }
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
    if (item) { (lista = lista || []).push(`<li>${inline(item[1])}</li>`); continue; }
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
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mensagens: historicoChat }),
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

// =====================================================================
// ATUALIZAR DADOS
// =====================================================================
const ROTULO_STATUS = { pendente: "na fila", processando: "processando", ok: "concluído", divergencia: "divergência", erro: "erro" };
let pollTimer = null;
let ultimaPublicacaoOk = null;

function renderAtualizar() {
  const zona = $("#zona-upload");
  const input = $("#arquivos");
  input.addEventListener("change", () => enviarArquivos([...input.files]));
  ["dragenter", "dragover"].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add("arrastando"); }));
  ["dragleave", "drop"].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.remove("arrastando"); }));
  zona.addEventListener("drop", (e) => enviarArquivos([...e.dataTransfer.files]));
  carregarProcessamentos();
}

async function enviarArquivos(arquivos) {
  const msg = $("#upload-msg");
  for (const f of arquivos) {
    msg.innerHTML = `<p class="muted">Enviando ${esc(f.name)}…</p>`;
    const r = await fetch("/api/upload", { method: "POST", headers: { "x-arquivo": encodeURIComponent(f.name), "content-type": "application/octet-stream" }, body: f });
    if (r.status === 401) return mostrarLogin("Sessão expirada. Entre de novo.");
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { msg.innerHTML = `<p class="erro">${esc(f.name)}: ${esc(j.erro || "falha no envio")}</p>`; return; }
  }
  $("#arquivos").value = "";
  msg.innerHTML = `<p class="pos">${arquivos.length} arquivo(s) enviado(s). O processamento começa em instantes.</p>`;
  carregarProcessamentos();
}

async function carregarProcessamentos() {
  clearTimeout(pollTimer);
  const r = await fetch("/api/upload");
  if (r.status === 401) return mostrarLogin("Sessão expirada. Entre de novo.");
  const { processamentos, disparo_automatico } = await r.json();
  $("#proc-nota").textContent = disparo_automatico
    ? "O processamento começa logo após o envio e leva cerca de 1 a 2 minutos."
    : "O processamento roda automaticamente a cada 15 minutos (seg–sáb, 8h–21h). Para processar na hora, configure o GITHUB_DISPATCH_TOKEN.";
  $("#processamentos").innerHTML = processamentos.length ? processamentos.map((p) => {
    const rs = p.resumo || {};
    const detalhe = rs.erro ? `Erro: ${esc(rs.erro)}`
      : rs.ja_importado ? "Arquivo idêntico já importado antes — nada mudou."
      : rs.conta ? `${esc(rs.conta)}: ${rs.lidos} lançamentos lidos, <strong>${rs.novos} novos</strong>, ${rs.duplicados} já existiam.` : "";
    return `<div class="proc">
      <div class="proc-topo"><strong>${esc(p.arquivo)}</strong><span class="proc-status ${p.status}">${ROTULO_STATUS[p.status] || p.status}</span></div>
      <div class="muted" style="font-size:12.5px">enviado ${new Date(p.criado_em).toLocaleString("pt-BR")}${p.concluido_em ? ` · concluído ${new Date(p.concluido_em).toLocaleString("pt-BR")}` : ""}</div>
      ${detalhe ? `<div style="font-size:13.5px;margin-top:6px">${detalhe}</div>` : ""}
      ${p.status === "divergencia" ? '<div class="erro" style="font-size:13px;margin-top:6px">A conciliação não fechou: nada foi alterado no painel. Veja o detalhe abaixo.</div>' : ""}
      ${p.log ? `<details><summary>Ver log do processamento</summary><pre>${esc(p.log)}</pre></details>` : ""}
    </div>`;
  }).join("") : '<p class="muted centro">Nenhum envio ainda.</p>';

  const ultimoOk = processamentos.find((p) => p.status === "ok");
  if (ultimaPublicacaoOk !== null && ultimoOk && ultimoOk.id !== ultimaPublicacaoOk) {
    $("#upload-msg").innerHTML = '<p class="pos">Dados atualizados.</p><button type="button" id="recarregar">Recarregar o painel</button>';
    $("#recarregar").addEventListener("click", () => location.reload());
  }
  ultimaPublicacaoOk = ultimoOk ? ultimoOk.id : 0;
  if (processamentos.some((p) => p.status === "pendente" || p.status === "processando")) {
    pollTimer = setTimeout(carregarProcessamentos, 5000);
  }
}

iniciar();
