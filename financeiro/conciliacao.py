"""Confere o saldo calculado (lançamentos) contra os saldos informados no extrato, dia a dia."""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field

from .util import brl


@dataclass
class Divergencia:
    data: str
    calculado: int
    extrato: int
    parcial: bool

    @property
    def diferenca(self) -> int:
        return self.extrato - self.calculado


@dataclass
class Conciliacao:
    conta: str
    dias_conferidos: int = 0
    divergencias: list[Divergencia] = field(default_factory=list)
    saldo_final: int | None = None
    data_final: str | None = None
    observacao: str | None = None

    @property
    def erros(self) -> list[Divergencia]:
        return [d for d in self.divergencias if not d.parcial]

    @property
    def ok(self) -> bool:
        return not self.erros

    def resumo(self) -> str:
        if self.observacao:
            return f"{self.conta}: {self.observacao}"
        txt = f"{self.conta}: {self.dias_conferidos} dias conferidos, saldo {brl(self.saldo_final)} em {self.data_final}"
        if self.ok:
            txt += " — OK"
        for d in self.divergencias:
            rot = "AVISO (dia ainda aberto na exportação)" if d.parcial else "DIVERGÊNCIA"
            txt += (f"\n    {rot} {d.data}: calculado {brl(d.calculado)} x extrato {brl(d.extrato)}"
                    f" (diferença {brl(d.diferenca)})")
        return txt


# Varredura da aplicação automática não muda o "saldo total disponível" (conta + aplicação),
# e recebíveis ainda não creditados não estão no saldo.
SOMA = """SELECT COALESCE(SUM(valor_centavos), 0) FROM lancamentos
          WHERE conta_id = ? AND data > ? AND data <= ? AND tipo <> 'varredura_aplicacao' AND NOT previsto"""


def conciliar(con: sqlite3.Connection, conta_id: int) -> Conciliacao:
    conta = con.execute("SELECT * FROM contas WHERE id = ?", (conta_id,)).fetchone()
    res = Conciliacao(conta=conta["nome"])
    saldos = con.execute(
        "SELECT data, fonte, saldo_centavos FROM saldos_diarios WHERE conta_id = ? AND fonte LIKE 'extrato%' "
        "ORDER BY data, fonte", (conta_id,)
    ).fetchall()
    # Se o mesmo dia tem saldo fechado e parcial, vale o fechado.
    por_dia = {}
    for s in saldos:
        if s["data"] not in por_dia or s["fonte"] == "extrato":
            por_dia[s["data"]] = s
    saldos = [por_dia[d] for d in sorted(por_dia)]

    if not saldos:
        ult = con.execute("SELECT MAX(data) FROM lancamentos WHERE conta_id = ? AND NOT previsto",
                          (conta_id,)).fetchone()[0]
        if ult is None:
            res.observacao = "sem lançamentos"
        elif conta["saldo_inicial_centavos"] is None:
            res.observacao = "saldo inicial NÃO informado — não é possível conciliar nem calcular saldo"
        else:
            soma = con.execute(SOMA, (conta_id, conta["saldo_inicial_data"], ult)).fetchone()[0]
            res.saldo_final, res.data_final = conta["saldo_inicial_centavos"] + soma, ult
            res.observacao = (f"extrato sem saldo para conferir; saldo calculado {brl(res.saldo_final)} em {ult} "
                              f"(a partir do saldo inicial de {conta['saldo_inicial_data']})")
        return res

    ant = saldos[0]
    for s in saldos[1:]:
        soma = con.execute(SOMA, (conta_id, ant["data"], s["data"])).fetchone()[0]
        calculado = ant["saldo_centavos"] + soma
        res.dias_conferidos += 1
        if calculado != s["saldo_centavos"]:
            res.divergencias.append(Divergencia(s["data"], calculado, s["saldo_centavos"],
                                                s["fonte"] == "extrato_parcial"))
        ant = s
    res.saldo_final, res.data_final = saldos[-1]["saldo_centavos"], saldos[-1]["data"]
    return res
