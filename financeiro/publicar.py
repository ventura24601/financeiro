"""Gera web/dados/dados.json (o que o painel e a IA enxergam) a partir do banco local.

Privacidade: só agregados + lançamentos operacionais do Itaú dos últimos 120 dias.
Sem CPF/CNPJ; pessoas físicas aparecem só com iniciais; clientes Vindi só agregados por dia.
"""
from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from datetime import date, timedelta

from . import db
from .projecao import _mes, backtest, carregar, meses_completos, projetar, recorrentes, resumo_mensal
from .util import agora

SAIDA = db.RAIZ / "web" / "dados" / "dados.json"
HORIZONTE = 90


def _iniciais(nome: str) -> str:
    return "PF " + ".".join(p[0] for p in nome.split() if p[:1].isalpha()) + "."


def _rotulo(r) -> str | None:
    nome = r["contraparte_nome"]
    if not nome:
        return None
    if r["contraparte_doc"] and len(r["contraparte_doc"]) == 11:
        return _iniciais(nome)
    return nome


def gerar(con: sqlite3.Connection, cfg_contas: dict) -> dict:
    itau = db.conta_id(con, "itau_0384")
    base = con.execute("SELECT data, saldo_centavos, fonte FROM saldos_diarios WHERE conta_id = ? "
                       "ORDER BY data DESC, fonte LIMIT 1", (itau,)).fetchone()
    data_base = date.fromisoformat(base["data"])
    serie, premissas, _ = projetar(con, data_base + timedelta(days=1), HORIZONTE, base["saldo_centavos"])

    reais, previstos = carregar(con)
    meses_rec, meses_desp = meses_completos(con, reais, None)
    pf = {r["contraparte_nome"].upper().strip() for _, r in reais
          if r["contraparte_nome"] and r["contraparte_doc"] and len(r["contraparte_doc"]) == 11}
    itens = [dict(i, nome=_iniciais(i["nome"]) if i["nome"] in pf else i["nome"])
             for i in recorrentes(reais, meses_desp)]
    mensal = resumo_mensal(reais)
    meses = []
    for m in sorted(mensal):
        v = mensal[m]
        gw = v["vindi"] + v["bambuno"]
        meses.append(dict(v, mes=m, entradas=v["vindi"] + v["bambuno"] + v["outros"],
                          liquido=v["vindi"] + v["bambuno"] + v["outros"] + v["saidas"] + v["taxa_vindi"],
                          fatia_vindi=round(v["vindi"] / gw, 4) if gw else None,
                          completo_receita=m in meses_rec, completo_despesa=m in meses_desp))

    hist_saldo = [{"data": r["data"], "saldo": r["saldo_centavos"]} for r in con.execute(
        "SELECT data, saldo_centavos FROM saldos_diarios WHERE conta_id = ? AND fonte LIKE 'extrato%' "
        "GROUP BY data ORDER BY data", (itau,))]

    corte = data_base - timedelta(days=120)
    dia = defaultdict(lambda: {"vindi": 0, "bambuno": 0, "outros": 0, "saidas": 0})
    lanc = []
    vindi_dia = defaultdict(lambda: defaultdict(int))
    for d, r in reais:
        if d <= corte:
            continue
        g = {"vindi": "vindi", "bambuno": "bambuno", "bambuno_cartao": "bambuno"}.get(r["canal"], "outros")
        if r["valor_centavos"] > 0:
            dia[d][g] += r["valor_centavos"]
        else:
            dia[d]["saidas"] += r["valor_centavos"]
        if r["conta"] == "vindi_digital":
            meio = r["descricao"].split(" PEDIDO")[0]
            vindi_dia[d][meio] += r["valor_centavos"]
        else:
            lanc.append({"data": d.isoformat(), "descricao": r["descricao_norm"], "contraparte": _rotulo(r),
                         "valor": r["valor_centavos"], "canal": r["canal"], "estimado": bool(r["estimado"])})
    for d, meios in vindi_dia.items():
        for meio, v in meios.items():
            lanc.append({"data": d.isoformat(), "descricao": f"{meio} (soma do dia)", "contraparte": None,
                         "valor": v, "canal": "vindi", "estimado": False})
    lanc.sort(key=lambda x: (x["data"], x["valor"]))

    receb = defaultdict(int)
    for d, r in previstos:
        receb[d.isoformat()] += r["valor_centavos"]

    contas = {r["codigo"]: r for r in con.execute("SELECT * FROM contas")}
    avisos = []
    for cod in ("vindi_digital", "fundos_itau"):
        if contas[cod]["saldo_inicial_centavos"] is None:
            avisos.append(f"Saldo inicial de '{contas[cod]['nome']}' não informado: fica fora do saldo e da "
                          "projeção (assumido R$ 0).")
    avisos += [
        "Receita Vindi de jun–jul/2026 subestimada: falta o relatório Vindi de 01/06 a 21/07 (conta digital).",
        "DRE por categoria ainda não disponível (Fase 2: classificação). Saídas aparecem por contraparte.",
        "Caixa mínimo seguro ainda não definido.",
    ]
    ult_completos = [x for x in meses if x["completo_receita"]][-3:]
    return {
        "gerado_em": agora(),
        "regime": "DRE gerencial de caixa (base: extratos bancários)",
        "base": {"data": base["data"], "saldo_itau": base["saldo_centavos"], "parcial": base["fonte"] != "extrato",
                 "saldo_vindi": contas["vindi_digital"]["saldo_inicial_centavos"],
                 "saldo_fundos": contas["fundos_itau"]["saldo_inicial_centavos"],
                 "aplicado_fundos": con.execute(
                     "SELECT COALESCE(SUM(valor_centavos), 0) FROM lancamentos WHERE conta_id = ?",
                     (contas["fundos_itau"]["id"],)).fetchone()[0]},
        "caixa_minimo": None,
        "geracao_media_mensal": int(sum(x["liquido"] for x in ult_completos) / len(ult_completos)),
        "meses_geracao": [x["mes"] for x in ult_completos],
        "mensal": meses,
        "historico_saldo": hist_saldo,
        "historico_diario": [dict(v, data=d.isoformat()) for d, v in sorted(dia.items())],
        "recebiveis_vindi": [{"data": k, "valor": v} for k, v in sorted(receb.items())],
        "projecao": serie,
        "premissas": premissas,
        "recorrentes": itens,
        "backtests": [backtest(con, m) for m in meses_rec[-2:]],
        "lancamentos_recentes": lanc,
        "avisos": avisos,
    }


def main() -> dict:
    """Gera os dados do painel e guarda uma cópia local em web/dados/dados.json (para conferência)."""
    con = db.conectar()
    dados = gerar(con, db.carregar_config("contas.yaml"))
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps(dados, ensure_ascii=False, separators=(",", ":")))
    print(f"{SAIDA.relative_to(db.RAIZ)}: {SAIDA.stat().st_size // 1024} KB, "
          f"{len(dados['lancamentos_recentes'])} lançamentos, projeção até {dados['projecao'][-1]['data']}")
    return dados
