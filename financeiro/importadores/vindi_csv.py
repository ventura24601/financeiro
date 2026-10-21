"""Relatório de transações da Vindi (CSV ';', latin-1).

Só transações 'Aprovada' viram lançamento, na Data Credito:
  - entrada do Valor Pago (receita bruta, canal vindi);
  - saída da Taxa (taxa do gateway, vai para o CSP).
Crédito com data futura = recebível (`previsto`), usado na projeção de caixa.
O relatório não traz saldo nem as transferências da conta digital para o Itaú.
"""
from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

from ..util import data_br, hoje, para_centavos
from . import Extrato, Transacao

CABECALHO = "Id;Data da Transa"


def reconhece(caminho: Path) -> bool:
    with open(caminho, encoding="latin-1") as f:
        return f.readline().startswith(CABECALHO)


def ler(caminho: Path) -> Extrato:
    ext = Extrato(formato="vindi_csv", conta_codigo="vindi_digital")
    with open(caminho, encoding="latin-1", newline="") as f:
        linhas = list(csv.DictReader(f, delimiter=";"))
    dia = hoje()
    datas_transacao = []
    ignoradas = 0
    for r in linhas:
        datas_transacao.append(data_br(r["Data da Transação"]))
        if r["Status"] != "Aprovada":
            ignoradas += 1
            continue
        if r["Data Credito"] in ("", "-"):
            ext.avisos.append(f"Vindi Id {r['Id']}: aprovada sem Data Credito, ignorada")
            continue
        credito = date.fromisoformat(r["Data Credito"])
        meio = r["Meio de Pagamento"]
        cliente = r["Cliente"].strip()
        bruto = para_centavos(r["Valor Pago"])
        taxa = para_centavos(r["Taxa"]) if r["Taxa"] not in ("", "-") else 0
        comum = dict(data=credito, contraparte_nome=cliente, canal="vindi", previsto=credito > dia)
        ext.transacoes.append(Transacao(
            descricao=f"VINDI {meio.upper()} PEDIDO {r['Número pedido']}",
            centavos=bruto, id_externo=f"vindi:{r['Id']}", **comum,
        ))
        if taxa:
            ext.transacoes.append(Transacao(
                descricao=f"TAXA VINDI {meio.upper()} PEDIDO {r['Número pedido']}",
                centavos=-taxa, id_externo=f"vindi:{r['Id']}:taxa", **comum,
            ))
    if datas_transacao:
        ext.periodo_inicio, ext.periodo_fim = min(datas_transacao), max(datas_transacao)
    ext.avisos.append(f"{ignoradas} transações não aprovadas (canceladas/aguardando) ignoradas")
    return ext
