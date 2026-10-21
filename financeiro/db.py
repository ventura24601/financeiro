"""Conexão SQLite e sincronização das contas declaradas em config/contas.yaml."""
from __future__ import annotations

import sqlite3
from pathlib import Path

import yaml

from .util import para_centavos

RAIZ = Path(__file__).resolve().parent.parent
DB_PADRAO = RAIZ / "data" / "financeiro.db"
CONFIG = RAIZ / "config"


def conectar(caminho: Path = DB_PADRAO) -> sqlite3.Connection:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(caminho)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.executescript((Path(__file__).parent / "schema.sql").read_text())
    return con


def carregar_config(nome: str) -> dict:
    return yaml.safe_load((CONFIG / nome).read_text(encoding="utf-8"))


def sincronizar_contas(con: sqlite3.Connection, cfg: dict) -> None:
    for c in cfg["contas"]:
        saldo = c.get("saldo_inicial")
        con.execute(
            """INSERT INTO contas (codigo, nome, banco, tipo, agencia, numero,
                                   saldo_inicial_centavos, saldo_inicial_data)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (codigo) DO UPDATE SET
                 nome = excluded.nome, banco = excluded.banco, tipo = excluded.tipo,
                 agencia = excluded.agencia, numero = excluded.numero,
                 saldo_inicial_centavos = excluded.saldo_inicial_centavos,
                 saldo_inicial_data = excluded.saldo_inicial_data""",
            (
                c["codigo"], c["nome"], c.get("banco"), c["tipo"], c.get("agencia"), c.get("numero"),
                None if saldo is None else para_centavos(str(saldo)),
                c.get("saldo_inicial_data"),
            ),
        )
    con.commit()


def conta_id(con: sqlite3.Connection, codigo: str) -> int:
    row = con.execute("SELECT id FROM contas WHERE codigo = ?", (codigo,)).fetchone()
    if row is None:
        raise KeyError(f"conta '{codigo}' não cadastrada em config/contas.yaml")
    return row["id"]
