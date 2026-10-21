"""Leitores de arquivo. Cada um devolve um `Extrato` normalizado, sem tocar no banco."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from pathlib import Path


@dataclass
class Transacao:
    data: date
    descricao: str
    centavos: int
    contraparte_nome: str | None = None
    contraparte_doc: str | None = None
    contraparte_conta: str | None = None
    id_externo: str | None = None     # quando o arquivo tem ID estável (Vindi), a dedup usa ele
    canal: str | None = None
    previsto: bool = False


@dataclass
class Saldo:
    data: date
    centavos: int
    parcial: bool = False             # dia ainda aberto no momento da exportação


@dataclass
class Extrato:
    formato: str
    agencia: str | None = None
    numero: str | None = None
    conta_codigo: str | None = None   # quando o formato já identifica a conta (ex.: Vindi)
    periodo_inicio: date | None = None
    periodo_fim: date | None = None
    gerado_em: str | None = None
    transacoes: list[Transacao] = field(default_factory=list)
    saldos: list[Saldo] = field(default_factory=list)
    avisos: list[str] = field(default_factory=list)


class FormatoNaoSuportado(Exception):
    pass


def ler(caminho: Path) -> Extrato:
    from . import itau_xlsx, ofx, vindi_csv

    ext = caminho.suffix.lower()
    if ext == ".xlsx" and itau_xlsx.reconhece(caminho):
        return itau_xlsx.ler(caminho)
    if ext == ".csv" and vindi_csv.reconhece(caminho):
        return vindi_csv.ler(caminho)
    if ext == ".ofx":
        return ofx.ler(caminho)
    if ext == ".pdf":
        raise FormatoNaoSuportado(
            "PDF ainda não suportado: exporte em OFX/XLSX/CSV. Leitura de PDF (fatura do cartão) virá via API da Claude."
        )
    raise FormatoNaoSuportado(f"formato não reconhecido: {caminho.name}")
