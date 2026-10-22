"""Envia o banco local para o Supabase (PostgREST + service_role) e publica os dados do painel.

O SQLite local é a área de trabalho do importador; o Supabase recebe as mesmas linhas, com os mesmos
ids, para BI e para o painel web. Credenciais em financeiro/.env (fora do git):
SUPABASE_URL, SUPABASE_SERVICE_KEY.
"""
from __future__ import annotations

import json
import os
import sqlite3
import urllib.error
import urllib.request

from . import db

LOTE = 500
# (tabela, chave de conflito, colunas booleanas, colunas JSON)
TABELAS = [
    ("contas", "id", {"ativa"}, set()),
    ("categorias", "id", {"ativa"}, set()),
    ("regras_classificacao", "id", {"ativa"}, set()),
    ("importacoes", "id", {"conciliacao_ok"}, set()),
    ("lancamentos", "id", {"estimado", "previsto"}, set()),
    ("saldos_diarios", "conta_id,data,fonte", set(), set()),
    ("custos_fixos", "id", {"ativo"}, set()),
    ("snapshots", "id", set(), {"conteudo_json"}),
]


def _env() -> dict:
    vals = dict(os.environ)
    arq = db.RAIZ / ".env"
    if arq.exists():
        for linha in arq.read_text().splitlines():
            if "=" in linha and not linha.startswith("#"):
                k, v = linha.split("=", 1)
                vals.setdefault(k.strip(), v.strip())
    return vals


def configurado() -> bool:
    e = _env()
    return bool(e.get("SUPABASE_URL") and e.get("SUPABASE_SERVICE_KEY"))


def _req(metodo: str, caminho: str, corpo=None, prefer: str | None = None):
    e = _env()
    chave = e["SUPABASE_SERVICE_KEY"]
    headers = {"apikey": chave, "Authorization": f"Bearer {chave}", "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    dados = None if corpo is None else json.dumps(corpo, ensure_ascii=False).encode()
    req = urllib.request.Request(f"{e['SUPABASE_URL']}/rest/v1/{caminho}", data=dados, method=metodo, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt else None
    except urllib.error.HTTPError as err:
        raise RuntimeError(f"Supabase {metodo} {caminho.split('?')[0]}: {err.code} {err.read().decode()[:300]}") from None


def _linhas(con: sqlite3.Connection, tabela: str, booleanas: set, jsons: set) -> list[dict]:
    ordem = " ORDER BY espelho_de IS NOT NULL, id" if tabela == "lancamentos" else ""
    out = []
    for r in con.execute(f"SELECT * FROM {tabela}{ordem}"):
        d = dict(r)
        for c in booleanas:
            if d.get(c) is not None:
                d[c] = bool(d[c])
        for c in jsons:
            d[c] = json.loads(d[c])
        out.append(d)
    return out


def _ids_remotos(tabela: str) -> set[int]:
    ids, pagina = set(), 0
    while True:
        lote = _req("GET", f"{tabela}?select=id&order=id&limit=1000&offset={pagina * 1000}")
        ids |= {x["id"] for x in lote}
        if len(lote) < 1000:
            return ids
        pagina += 1


def sincronizar(con: sqlite3.Connection) -> dict[str, int]:
    enviados = {}
    for tabela, chave, booleanas, jsons in TABELAS:
        linhas = _linhas(con, tabela, booleanas, jsons)
        for i in range(0, len(linhas), LOTE):
            _req("POST", f"{tabela}?on_conflict={chave}", linhas[i:i + LOTE],
                 prefer="resolution=merge-duplicates,return=minimal")
        if chave == "id":
            # Linhas apagadas no local (ex.: espelho desfeito pela regra Vindi) saem do Supabase também.
            sobrando = sorted(_ids_remotos(tabela) - {l["id"] for l in linhas})
            for i in range(0, len(sobrando), 200):
                _req("DELETE", f"{tabela}?id=in.({','.join(map(str, sobrando[i:i + 200]))})")
        enviados[tabela] = len(linhas)
    return enviados


def publicar_painel(dados: dict, manter: int = 30) -> int:
    novo = _req("POST", "painel_publicacoes?select=id", {"dados": dados}, prefer="return=representation")[0]["id"]
    _req("DELETE", f"painel_publicacoes?id=lte.{novo - manter}")
    return novo


def baixar(con: sqlite3.Connection) -> int:
    """Recria o conteúdo do SQLite local a partir do Supabase (mesmos ids). Devolve nº de lançamentos."""
    con.execute("PRAGMA foreign_keys = OFF")
    total = 0
    for tabela, chave, _booleanas, jsons in TABELAS:
        ordem = "espelho_de.nullsfirst,id" if tabela == "lancamentos" else chave.split(",")[0]
        con.execute(f"DELETE FROM {tabela}")
        pagina = 0
        while True:
            lote = _req("GET", f"{tabela}?select=*&order={ordem}&limit=1000&offset={pagina * 1000}")
            for linha in lote:
                for c in jsons:
                    linha[c] = json.dumps(linha[c], ensure_ascii=False)
                cols = list(linha)
                con.execute(f"INSERT INTO {tabela} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                            [linha[c] for c in cols])
            if tabela == "lancamentos":
                total += len(lote)
            if len(lote) < 1000:
                break
            pagina += 1
    con.commit()
    con.execute("PRAGMA foreign_keys = ON")
    return total


def baixar_objeto(caminho: str) -> bytes:
    e = _env()
    chave = e["SUPABASE_SERVICE_KEY"]
    req = urllib.request.Request(f"{e['SUPABASE_URL']}/storage/v1/object/extratos/{caminho}",
                                 headers={"apikey": chave, "Authorization": f"Bearer {chave}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def atualizar_processamento(pid: int, **campos) -> None:
    _req("PATCH", f"processamentos?id=eq.{pid}", campos, prefer="return=minimal")


def pendentes() -> list[dict]:
    return _req("GET", "processamentos?status=eq.pendente&order=id&select=*")
