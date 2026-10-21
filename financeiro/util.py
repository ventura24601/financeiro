"""Dinheiro, datas, normalização de texto e hash de deduplicação."""
from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Sao_Paulo")


def agora() -> str:
    return datetime.now(TZ).isoformat(timespec="seconds")


def hoje() -> date:
    return datetime.now(TZ).date()


def para_centavos(valor) -> int:
    """Converte número/texto em centavos sem passar por aritmética float.

    Floats vindos do XLSX são convertidos por str() (menor representação exata),
    textos aceitam formato BR ('R$ 1.234,56') ou ponto decimal ('1234.56').
    """
    if valor is None or valor == "":
        raise ValueError("valor vazio")
    if isinstance(valor, Decimal):
        d = valor
    elif isinstance(valor, (int, float)):
        d = Decimal(str(valor))
    else:
        s = str(valor).replace("R$", "").replace("\xa0", "").strip()
        if "," in s:
            s = s.replace(".", "").replace(",", ".")
        d = Decimal(s)
    return int((d * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def brl(centavos: int) -> str:
    sinal = "-" if centavos < 0 else ""
    inteiro, cent = divmod(abs(centavos), 100)
    return f"{sinal}R$ {inteiro:,}".replace(",", ".") + f",{cent:02d}"


def data_br(s: str) -> date:
    return datetime.strptime(s.strip(), "%d/%m/%Y").date()


def so_digitos(s) -> str | None:
    d = re.sub(r"\D", "", str(s or ""))
    return d or None


def normalizar_descricao(s: str) -> str:
    """Maiúsculas, sem acento, sem datas coladas (ex.: 'BAMBUNO22/04') e espaços únicos."""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    s = s.upper()
    s = re.sub(r"\d{2}/\d{2}(/\d{2,4})?", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def sha256(*partes) -> str:
    return hashlib.sha256("|".join(str(p) for p in partes).encode()).hexdigest()


def hash_lancamento(conta_codigo: str, data: date, centavos: int, desc_norm: str, ocorrencia: int) -> str:
    """Hash de dedup: data + valor + descrição normalizada + conta.

    `ocorrencia` diferencia lançamentos legítimos idênticos no mesmo dia
    (ex.: dois recebimentos de R$ 297,00 iguais): o 1º vira 0, o 2º vira 1...
    Reimportar o mesmo extrato (ou um sobreposto) gera os mesmos índices.
    """
    return sha256(conta_codigo, data.isoformat(), centavos, desc_norm, ocorrencia)


def arquivo_sha256(caminho) -> str:
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        for bloco in iter(lambda: f.read(1 << 16), b""):
            h.update(bloco)
    return h.hexdigest()
