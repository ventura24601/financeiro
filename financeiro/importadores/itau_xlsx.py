"""Extrato Itaú Empresas exportado em XLSX ('Extrato_lancamentos_agencia_origem_...')."""
from __future__ import annotations

from pathlib import Path

import openpyxl

from ..util import data_br, para_centavos, so_digitos
from . import Extrato, Saldo, Transacao

SALDO_ANTERIOR = "SALDO ANTERIOR"
# "SALDO TOTAL DISPONÍVEL DIA" = conta + aplicação automática; é o saldo usado na conciliação.
SALDO_FECHAMENTO = "SALDO TOTAL DISPONÍVEL DIA"
SALDO_PARCIAL = "SALDO EM CONTA CORRENTE"   # aparece no dia da exportação, dia ainda aberto


def _linhas(caminho: Path):
    wb = openpyxl.load_workbook(caminho, data_only=True)
    return list(wb.worksheets[0].iter_rows(values_only=True))


def reconhece(caminho: Path) -> bool:
    try:
        return any(r and r[0] == "Agência:" for r in _linhas(caminho)[:12])
    except Exception:
        return False


def ler(caminho: Path) -> Extrato:
    linhas = _linhas(caminho)
    ext = Extrato(formato="itau_xlsx")
    cab = None
    for i, r in enumerate(linhas):
        rotulo = r[0] if r else None
        if rotulo == "Agência:":
            ext.agencia = str(r[1]).strip()
        elif rotulo == "Conta:":
            ext.numero = str(r[1]).strip()
        elif rotulo == "Atualização:":
            ext.gerado_em = str(r[1]).strip()
        elif rotulo == "Periodo:":
            ini, fim = str(r[1]).split("até")
            ext.periodo_inicio, ext.periodo_fim = data_br(ini), data_br(fim)
        elif rotulo == "Data":
            cab = i
            break
    if cab is None:
        raise ValueError("cabeçalho 'Data' não encontrado no extrato Itaú")

    data_exportacao = data_br(ext.gerado_em.split()[0]) if ext.gerado_em else None
    for r in linhas[cab + 1:]:
        if not r or not r[0]:
            continue
        data = data_br(r[0])
        desc = str(r[1] or "").strip()
        valor, saldo = r[5], r[6]
        if valor not in (None, ""):
            ext.transacoes.append(Transacao(
                data=data,
                descricao=desc,
                centavos=para_centavos(valor),
                contraparte_nome=(str(r[3]).strip() or None) if r[3] else None,
                contraparte_doc=so_digitos(r[4]),
                contraparte_conta=(str(r[2]).strip() or None) if r[2] else None,
            ))
        elif saldo not in (None, ""):
            if desc in (SALDO_ANTERIOR, SALDO_FECHAMENTO):
                ext.saldos.append(Saldo(data, para_centavos(saldo)))
            elif desc == SALDO_PARCIAL:
                ext.saldos.append(Saldo(data, para_centavos(saldo), parcial=(data == data_exportacao)))
    return ext
