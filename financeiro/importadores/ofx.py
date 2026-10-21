"""OFX genérico (SGML 1.x ou XML 2.x), sem dependências externas."""
from __future__ import annotations

import re
from datetime import date
from pathlib import Path

from ..util import para_centavos
from . import Extrato, Saldo, Transacao


def _tag(bloco: str, nome: str) -> str | None:
    m = re.search(rf"<{nome}>([^<\r\n]*)", bloco, re.IGNORECASE)
    return m.group(1).strip() if m else None


def _data(s: str) -> date:
    return date(int(s[0:4]), int(s[4:6]), int(s[6:8]))


def ler(caminho: Path) -> Extrato:
    bruto = caminho.read_bytes()
    texto = bruto.decode("utf-8") if b"UTF-8" in bruto[:400].upper() else bruto.decode("latin-1")
    ext = Extrato(formato="ofx", agencia=_tag(texto, "BRANCHID"), numero=_tag(texto, "ACCTID"))
    ini, fim = _tag(texto, "DTSTART"), _tag(texto, "DTEND")
    ext.periodo_inicio = _data(ini) if ini else None
    ext.periodo_fim = _data(fim) if fim else None
    for bloco in re.findall(r"<STMTTRN>(.*?)(?:</STMTTRN>|(?=<STMTTRN>)|</BANKTRANLIST>)", texto, re.S | re.I):
        desc = " ".join(filter(None, [_tag(bloco, "NAME"), _tag(bloco, "MEMO")]))
        ext.transacoes.append(Transacao(
            data=_data(_tag(bloco, "DTPOSTED")),
            descricao=desc or "(sem descrição)",
            centavos=para_centavos(_tag(bloco, "TRNAMT").replace(",", ".")),
        ))
    bal = re.search(r"<LEDGERBAL>(.*?)(?:</LEDGERBAL>|<AVAILBAL>|$)", texto, re.S | re.I)
    if bal and _tag(bal.group(1), "BALAMT"):
        ext.saldos.append(Saldo(_data(_tag(bal.group(1), "DTASOF")),
                                para_centavos(_tag(bal.group(1), "BALAMT").replace(",", "."))))
    return ext
