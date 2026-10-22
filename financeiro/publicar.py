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
from .projecao import (CARTOES, _chave_saida, _mes, _perfil, backtest, carregar, meses_completos, projetar,
                       recorrentes, resumo_mensal)
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
        g = {"vindi": "vindi", "bambuno": "bambuno", "bambuno_cartao": "bambuno"}.get(r["canal"], "outros")
        if r["valor_centavos"] > 0:
            dia[d][g] += r["valor_centavos"]
        else:
            dia[d]["saidas"] += r["valor_centavos"]
        if d <= corte:
            continue
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
        "estrategico": estrategico(reais, meses_rec, meses_desp, pf),
        "avisos": avisos,
    }


def estrategico(reais, meses_rec: list[str], meses_desp: list[str], pf: set) -> dict:
    """Indicadores para as abas Receitas, Despesas e Estratégico."""
    nome = lambda k: _iniciais(k) if k in pf else k

    # Vindi: clientes pagantes, ticket médio e mix de meios de pagamento (por mês de crédito).
    vindi = defaultdict(lambda: {"clientes": set(), "bruto": 0, "taxa": 0, "meios": defaultdict(int)})
    for d, r in reais:
        if r["conta"] != "vindi_digital":
            continue
        m = vindi[_mes(d)]
        if (r["id_externo"] or "").endswith(":taxa"):
            m["taxa"] += r["valor_centavos"]
            continue
        m["clientes"].add(r["contraparte_nome"])
        m["bruto"] += r["valor_centavos"]
        meio = r["descricao"].split(" PEDIDO")[0].replace("VINDI ", "")
        meio = "Cartão" if any(c in meio for c in CARTOES) else meio.title().replace("Bancario", "")
        m["meios"][meio.strip()] += r["valor_centavos"]
    vindi_mensal = [{"mes": k, "clientes": len(v["clientes"]), "bruto": v["bruto"], "taxa": v["taxa"],
                     "ticket": v["bruto"] // max(1, len(v["clientes"])), "meios": dict(v["meios"])}
                    for k, v in sorted(vindi.items())]

    # Saídas fixas (recorrentes) x variáveis por mês, e maiores contrapartes dos últimos 3 meses.
    chaves_fixas = {i["nome"] for i in recorrentes(reais, meses_desp)}
    fix_var = defaultdict(lambda: {"fixas": 0, "variaveis": 0})
    por_chave = defaultdict(lambda: defaultdict(int))
    ult = meses_desp[-3:]
    for d, r in reais:
        if r["valor_centavos"] >= 0 or (r["id_externo"] or "").endswith(":taxa"):
            continue
        k = _chave_saida(r)
        fix_var[_mes(d)]["fixas" if k in chaves_fixas else "variaveis"] += r["valor_centavos"]
        if _mes(d) in ult:
            por_chave[k][_mes(d)] += r["valor_centavos"]
    top = sorted(por_chave.items(), key=lambda kv: sum(kv[1].values()))[:15]
    top_saidas = [{"nome": nome(k), "total": sum(v.values()), "media_mensal": sum(v.values()) // len(ult),
                   "fixa": k in chaves_fixas, "meses": dict(v)} for k, v in top]

    # Em que dia do mês o dinheiro entra (média dos meses completos, gateways).
    diario = defaultdict(int)
    for d, r in reais:
        if r["valor_centavos"] > 0 and r["canal"] in ("vindi", "bambuno", "bambuno_cartao"):
            diario[d] += r["valor_centavos"]
    perfil = _perfil(diario, meses_rec)
    return {
        "vindi_mensal": vindi_mensal,
        "saidas_fixas_variaveis": [dict(v, mes=k) for k, v in sorted(fix_var.items())],
        "top_saidas": top_saidas,
        "meses_top_saidas": ult,
        "perfil_entradas_dia_mes": [round(float(perfil.get(i, 0)), 4) for i in range(1, 32)],
    }


def salvar_local(con: sqlite3.Connection) -> dict:
    """Gera os dados do painel e guarda uma cópia local em web/dados/dados.json (para conferência)."""
    dados = gerar(con, db.carregar_config("contas.yaml"))
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps(dados, ensure_ascii=False, separators=(",", ":")))
    print(f"Dados do painel: {len(dados['lancamentos_recentes'])} lançamentos recentes, "
          f"projeção até {dados['projecao'][-1]['data']}")
    return dados
