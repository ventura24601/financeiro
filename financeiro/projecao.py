"""Projeção de caixa dia a dia (regime de caixa, operacional consolidado Itaú + conta digital Vindi).

Modelo, deliberadamente simples e explicável:
- Entradas dos gateways: nível mensal = média dos 3 últimos meses completos (Vindi + Bambuno juntos,
  porque a migração só troca o canal). A fatia Vindi segue a tendência linear da migração.
  Cada canal é distribuído nos dias do mês pelo seu perfil histórico (dia do mês), e o que cair em
  fim de semana/feriado vai para o próximo dia útil.
- Recebíveis Vindi já conhecidos (cartão com crédito futuro) substituem a parte de cartão do modelo.
- Saídas: itens recorrentes (mesma contraparte em 2 de 3 meses, até 3x/mês) no dia típico;
  o restante da média mensal é espalhado pelos dias úteis. Taxa Vindi = % histórico da receita Vindi.
- Faixa de incerteza: desvio-padrão do resultado líquido mensal, escalado por raiz(dias/30).
"""
from __future__ import annotations

import calendar
import re
import sqlite3
import statistics
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from .calendario import dia_util, proximo_dia_util

MESES_NIVEL = 3
CARTOES = ("VISA", "MASTERCARD", "ELO", "AMERICAN EXPRESS", "HIPERCARD", "DINERS")


def _mes(d: date) -> str:
    return d.strftime("%Y-%m")


def _dias_do_mes(m: str) -> list[date]:
    a, mm = int(m[:4]), int(m[5:])
    return [date(a, mm, d) for d in range(1, calendar.monthrange(a, mm)[1] + 1)]


def _grupo(canal: str | None) -> str:
    if canal == "vindi":
        return "vindi"
    if canal in ("bambuno", "bambuno_cartao"):
        return "bambuno"
    return "outros"


def _chave_saida(r) -> str:
    if r["contraparte_nome"]:
        return r["contraparte_nome"].upper().strip()
    return re.sub(r"[\d.\-/]+", " ", r["descricao_norm"]).split("  ")[0].strip() or r["descricao_norm"]


def carregar(con: sqlite3.Connection, ate: date | None = None):
    """Lançamentos operacionais (sem espelhos) antes de `ate`; recebíveis só quando ate=None."""
    rows = con.execute(
        "SELECT l.*, c.codigo AS conta FROM lancamentos l JOIN contas c ON c.id = l.conta_id "
        "WHERE l.tipo = 'operacional' AND l.espelho_de IS NULL ORDER BY l.data"
    ).fetchall()
    reais, previstos = [], []
    for r in rows:
        d = date.fromisoformat(r["data"])
        if r["previsto"]:
            if ate is None:
                previstos.append((d, r))
        elif ate is None or d < ate:
            reais.append((d, r))
    return reais, previstos


def meses_completos(con: sqlite3.Connection, reais, ate: date | None):
    """(meses completos para RECEITA, meses completos para DESPESA)."""
    itau = [d for d, r in reais if r["conta"] == "itau_0384"]
    ini, fim = min(itau), max(itau)
    if ate:
        fim = min(fim, ate - timedelta(days=1))
    desp = [m for m in sorted({_mes(d) for d in itau})
            if _dias_do_mes(m)[0] >= ini and _dias_do_mes(m)[-1] <= fim]
    rel = [d for d, r in reais if r["conta"] == "vindi_digital"]
    inicio_digital = con.execute(
        "SELECT MIN(data) FROM lancamentos WHERE contrapartida_conta_id = "
        "(SELECT id FROM contas WHERE codigo = 'vindi_digital') AND espelho_de IS NULL"
    ).fetchone()[0]
    inicio_digital = _mes(date.fromisoformat(inicio_digital)) if inicio_digital else "9999-99"
    rec = []
    for m in desp:
        if m < inicio_digital:
            rec.append(m)
        elif rel and min(rel) <= _dias_do_mes(m)[0] and max(rel) >= _dias_do_mes(m)[-1]:
            rec.append(m)
    return rec, desp


def resumo_mensal(reais):
    out = defaultdict(lambda: {"vindi": 0, "bambuno": 0, "outros": 0, "saidas": 0, "taxa_vindi": 0,
                               "estimado": False})
    for d, r in reais:
        m = out[_mes(d)]
        v = r["valor_centavos"]
        if v > 0:
            m[_grupo(r["canal"])] += v
            m["estimado"] |= bool(r["estimado"])
        elif (r["id_externo"] or "").endswith(":taxa"):
            m["taxa_vindi"] += v
        else:
            m["saidas"] += v
    return out


def _perfil(diario: dict, meses: list[str]) -> dict[int, Decimal]:
    """Fração média do mês recebida em cada dia do mês (1..31)."""
    acum = defaultdict(Decimal)
    n = 0
    for m in meses:
        tot = sum(diario.get(d, 0) for d in _dias_do_mes(m))
        if tot <= 0:
            continue
        n += 1
        for d in _dias_do_mes(m):
            acum[d.day] += Decimal(diario.get(d, 0)) / tot
    return {k: v / n for k, v in acum.items()} if n else {}


def _distribuir(perfil: dict[int, Decimal], nivel: int, m: str) -> dict[date, int]:
    dias = _dias_do_mes(m)
    ultimo = dias[-1].day
    bruto = defaultdict(Decimal)
    for dom, frac in perfil.items():
        bruto[min(dom, ultimo)] += frac
    tot = sum(bruto.values()) or Decimal(1)
    out = defaultdict(int)
    for dom, frac in bruto.items():
        out[proximo_dia_util(date(dias[0].year, dias[0].month, dom))] += int(nivel * frac / tot)
    return out


def _tendencia(pontos: list[tuple[int, float]]):
    if len(pontos) < 2:
        return (pontos[0][1] if pontos else 0.0), 0.0
    xs, ys = [p[0] for p in pontos], [p[1] for p in pontos]
    mx, my = statistics.mean(xs), statistics.mean(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx if sxx else 0.0
    return my - b * mx, b


def _ordinal(m: str) -> int:
    return int(m[:4]) * 12 + int(m[5:]) - 1


def recorrentes(reais, meses_desp: list[str]):
    ult = meses_desp[-MESES_NIVEL:]
    por = defaultdict(lambda: defaultdict(list))
    for d, r in reais:
        if r["valor_centavos"] < 0 and _mes(d) in ult and not (r["id_externo"] or "").endswith(":taxa"):
            por[_chave_saida(r)][_mes(d)].append((d, r["valor_centavos"]))
    itens = []
    for nome, meses in por.items():
        if len(meses) < 2 or max(len(v) for v in meses.values()) > 3:
            continue
        somas = [sum(v for _, v in lst) for lst in meses.values()]
        dias = [min(lst)[0].day for lst in meses.values()]
        itens.append({"nome": nome, "valor": int(statistics.median(somas)), "dia": int(statistics.median(dias)),
                      "meses": len(meses)})
    return sorted(itens, key=lambda i: i["valor"])


def projetar(con: sqlite3.Connection, inicio: date, dias: int, saldo_inicial: int, ate: date | None = None):
    reais, previstos = carregar(con, ate)
    meses_rec, meses_desp = meses_completos(con, reais, ate)
    mensal = resumo_mensal(reais)

    diario = {g: defaultdict(int) for g in ("vindi", "bambuno", "outros")}
    for d, r in reais:
        if r["valor_centavos"] > 0:
            diario[_grupo(r["canal"])][d] += r["valor_centavos"]

    ult_rec = meses_rec[-MESES_NIVEL:]
    nivel_gw = int(statistics.mean(mensal[m]["vindi"] + mensal[m]["bambuno"] for m in ult_rec))
    pontos = [(_ordinal(m), mensal[m]["vindi"] / (mensal[m]["vindi"] + mensal[m]["bambuno"]))
              for m in meses_rec[-6:] if mensal[m]["vindi"] + mensal[m]["bambuno"]]
    a, b = _tendencia(pontos)
    perfis = {g: _perfil(diario[g], [m for m in meses_rec if mensal[m][g] > 0]) for g in ("vindi", "bambuno")}
    ult_desp = meses_desp[-MESES_NIVEL:]
    nivel_outros = int(statistics.mean(mensal[m]["outros"] for m in ult_desp))
    nivel_saidas = int(statistics.mean(mensal[m]["saidas"] for m in ult_desp))

    rel_bruto = sum(r["valor_centavos"] for _, r in reais
                    if r["conta"] == "vindi_digital" and r["valor_centavos"] > 0)
    rel_taxa = sum(r["valor_centavos"] for _, r in reais if (r["id_externo"] or "").endswith(":taxa"))
    taxa_pct = Decimal(-rel_taxa) / rel_bruto if rel_bruto else Decimal(0)
    rel_cartao = sum(r["valor_centavos"] for _, r in reais if r["conta"] == "vindi_digital"
                     and r["valor_centavos"] > 0 and any(c in r["descricao"] for c in CARTOES))
    cartao_pct = Decimal(rel_cartao) / rel_bruto if rel_bruto else Decimal(0)
    conhecidos = defaultdict(int)
    for d, r in previstos:
        if r["valor_centavos"] > 0:
            conhecidos[d] += r["valor_centavos"]
    horizonte_rec = max(conhecidos) if conhecidos else None

    itens_rec = recorrentes(reais, meses_desp)
    soma_rec = sum(i["valor"] for i in itens_rec)
    variavel_mes = min(0, nivel_saidas - soma_rec)

    fim = inicio + timedelta(days=dias - 1)
    entradas = {g: defaultdict(int) for g in ("vindi", "bambuno", "outros")}
    saidas_rec = defaultdict(list)
    saidas_var = defaultdict(int)
    shares = {}
    m = _mes(inicio)
    while m <= _mes(fim + timedelta(days=5)):
        share = max(0.0, min(1.0, a + b * _ordinal(m)))
        shares[m] = round(share, 4)
        for g, nivel in (("vindi", int(nivel_gw * share)), ("bambuno", int(nivel_gw * (1 - share)))):
            for d, v in _distribuir(perfis[g], nivel, m).items():
                entradas[g][d] += v
        uteis = [d for d in _dias_do_mes(m) if dia_util(d)]
        for d in uteis:
            entradas["outros"][d] += nivel_outros // len(uteis)
            saidas_var[d] += variavel_mes // len(uteis)
        for it in itens_rec:
            dd = proximo_dia_util(_dias_do_mes(m)[min(it["dia"], len(_dias_do_mes(m))) - 1])
            saidas_rec[dd].append({"nome": it["nome"], "valor": it["valor"]})
        m = _mes(_dias_do_mes(m)[-1] + timedelta(days=1))

    netos = [mensal[m]["vindi"] + mensal[m]["bambuno"] + mensal[m]["outros"] + mensal[m]["saidas"]
             + mensal[m]["taxa_vindi"] for m in meses_rec[-6:]]
    desvio = statistics.pstdev(netos) if len(netos) > 1 else 0

    serie, saldo = [], saldo_inicial
    for k in range((fim - inicio).days + 1):
        d = inicio + timedelta(days=k)
        vindi = entradas["vindi"][d]
        if horizonte_rec and d <= horizonte_rec:
            vindi = int(vindi * (1 - cartao_pct)) + conhecidos.get(d, 0)
        ent = {"vindi": vindi, "bambuno": entradas["bambuno"][d], "outros": entradas["outros"][d]}
        taxa = -int(vindi * taxa_pct)
        rec = saidas_rec.get(d, [])
        sai = sum(i["valor"] for i in rec) + saidas_var[d] + taxa
        saldo += sum(ent.values()) + sai
        faixa = int(desvio * ((k + 1) / 30) ** 0.5)
        serie.append({"data": d.isoformat(), "util": dia_util(d), "entradas": ent, "saidas_recorrentes": rec,
                      "saidas_variaveis": saidas_var[d], "taxa_vindi": taxa, "saidas": sai,
                      "saldo": saldo, "saldo_min": saldo - faixa, "saldo_max": saldo + faixa})

    premissas = {
        "meses_completos_receita": meses_rec, "meses_completos_despesa": meses_desp,
        "nivel_mensal_gateways": nivel_gw, "fatia_vindi_por_mes": shares,
        "tendencia_vindi_pp_mes": round(b * 100, 2), "nivel_mensal_outros": nivel_outros,
        "nivel_mensal_saidas": nivel_saidas, "saidas_recorrentes_mes": soma_rec,
        "saidas_variaveis_mes": variavel_mes, "taxa_vindi_pct": float(round(taxa_pct * 100, 3)),
        "fatia_cartao_vindi_pct": float(round(cartao_pct * 100, 1)),
        "recebiveis_conhecidos_ate": horizonte_rec.isoformat() if horizonte_rec else None,
        "desvio_liquido_mensal": int(desvio),
    }
    return serie, premissas, itens_rec


def backtest(con: sqlite3.Connection, mes: str):
    """Projeta `mes` só com dados anteriores a ele e compara com o realizado."""
    ini = _dias_do_mes(mes)[0]
    serie, _, _ = projetar(con, ini, len(_dias_do_mes(mes)), 0, ate=ini)
    reais, _ = carregar(con)
    real = resumo_mensal([(d, r) for d, r in reais if _mes(d) == mes])[mes]
    prev_ent = sum(sum(s["entradas"].values()) for s in serie)
    prev_sai = sum(s["saidas"] for s in serie)
    real_ent = real["vindi"] + real["bambuno"] + real["outros"]
    real_sai = real["saidas"] + real["taxa_vindi"]
    semanas = []
    for s0 in range(0, len(serie), 7):
        bloco = serie[s0:s0 + 7]
        d0, d1 = date.fromisoformat(bloco[0]["data"]), date.fromisoformat(bloco[-1]["data"])
        r_ent = sum(r["valor_centavos"] for d, r in reais if d0 <= d <= d1 and r["valor_centavos"] > 0)
        semanas.append({"de": d0.isoformat(), "ate": d1.isoformat(),
                        "previsto": sum(sum(s["entradas"].values()) for s in bloco), "real": r_ent})
    return {"mes": mes, "entradas_previstas": prev_ent, "entradas_reais": real_ent,
            "saidas_previstas": prev_sai, "saidas_reais": real_sai, "semanas": semanas}
