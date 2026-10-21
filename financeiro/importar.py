"""Grava um Extrato no banco: dedup, tipo (DRE x só caixa), canal e lado espelho de transferências."""
from __future__ import annotations

import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from . import db
from .importadores import Extrato, Transacao, ler
from .util import agora, arquivo_sha256, hash_lancamento, normalizar_descricao, sha256, so_digitos


@dataclass
class Resultado:
    arquivo: str
    conta: str | None = None
    importacao_id: int | None = None
    lidos: int = 0
    novos: int = 0
    duplicados: int = 0
    ja_importado: bool = False
    erro: str | None = None
    avisos: list[str] = field(default_factory=list)


def resolver_conta(ext: Extrato, cfg_contas: dict) -> str:
    if ext.conta_codigo:
        return ext.conta_codigo
    alvo = (so_digitos(ext.agencia), so_digitos(ext.numero))
    for c in cfg_contas["contas"]:
        if (so_digitos(c.get("agencia")), so_digitos(c.get("numero"))) == alvo:
            return c["codigo"]
    raise KeyError(f"extrato da agência {ext.agencia} conta {ext.numero} não está em config/contas.yaml")


def conta_por_identificador(cfg_contas: dict, ag_conta: str | None) -> str | None:
    if not ag_conta:
        return None
    for c in cfg_contas["contas"]:
        if ag_conta.strip() in c.get("identificadores", []):
            return c["codigo"]
    return None


def definir_tipo(t: Transacao, desc_norm: str, cfg_contas: dict, cfg_tipos: dict):
    """Devolve (tipo, motivo, conta_contrapartida) — rastreável no campo tipo_motivo."""
    if t.contraparte_doc and t.contraparte_doc in cfg_contas["empresa"]["cnpjs_proprios"]:
        destino = conta_por_identificador(cfg_contas, t.contraparte_conta)
        motivo = f"contraparte é CNPJ próprio ({t.contraparte_conta or 'conta não informada'})"
        if destino is None:
            motivo += " — conta própria NÃO cadastrada"
        return "transferencia_interna", motivo, destino
    for regra in cfg_tipos["tipos"]:
        if re.search(regra["padrao"], desc_norm):
            return regra["tipo"], f"regra de tipo: {regra['nome']}", regra.get("contrapartida")
    return "operacional", None, None


def definir_canal(t: Transacao, desc_norm: str, cfg_tipos: dict) -> str | None:
    if t.canal:
        return t.canal
    if t.centavos <= 0:
        return None
    for regra in cfg_tipos["canais"]:
        if "doc" in regra and t.contraparte_doc == regra["doc"]:
            return regra["canal"]
        if "padrao" in regra and re.search(regra["padrao"], desc_norm):
            return regra["canal"]
    return None


def criar_espelho(con: sqlite3.Connection, lanc_id: int) -> None:
    """Gera, na conta de contrapartida, o lado oposto de uma transferência interna."""
    o = con.execute("SELECT l.*, c.nome AS conta_nome FROM lancamentos l JOIN contas c ON c.id = l.conta_id "
                    "WHERE l.id = ?", (lanc_id,)).fetchone()
    if o["contrapartida_conta_id"] is None:
        return
    con.execute(
        """INSERT OR IGNORE INTO lancamentos
           (conta_id, data, descricao, descricao_norm, valor_centavos, contraparte_nome,
            tipo, tipo_motivo, contrapartida_conta_id, espelho_de, hash, importacao_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (o["contrapartida_conta_id"], o["data"], f"ESPELHO: {o['descricao']}", o["descricao_norm"],
         -o["valor_centavos"], o["conta_nome"], o["tipo"], f"espelho do lançamento {o['id']}",
         o["conta_id"], o["id"], sha256("espelho", o["hash"]), o["importacao_id"], agora()),
    )


def importar_arquivo(con: sqlite3.Connection, caminho: Path, cfg_contas: dict, cfg_tipos: dict) -> Resultado:
    res = Resultado(arquivo=caminho.name)
    sha = arquivo_sha256(caminho)
    if con.execute("SELECT 1 FROM importacoes WHERE arquivo_sha256 = ?", (sha,)).fetchone():
        res.ja_importado = True
        return res
    ext = ler(caminho)
    res.conta = resolver_conta(ext, cfg_contas)
    res.avisos += ext.avisos
    cid = db.conta_id(con, res.conta)
    contas_ids = {c["codigo"]: c["id"] for c in con.execute("SELECT id, codigo FROM contas")}

    cur = con.execute(
        """INSERT INTO importacoes (arquivo, arquivo_sha256, formato, conta_id, periodo_inicio, periodo_fim,
                                    gerado_em, importado_em, linhas_lidas, novos, duplicados)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)""",
        (caminho.name, sha, ext.formato, cid, ext.periodo_inicio and ext.periodo_inicio.isoformat(),
         ext.periodo_fim and ext.periodo_fim.isoformat(), ext.gerado_em, agora()),
    )
    res.importacao_id = cur.lastrowid

    ocorrencias: dict[tuple, int] = defaultdict(int)
    for t in ext.transacoes:
        res.lidos += 1
        desc_norm = normalizar_descricao(t.descricao)
        if t.id_externo:
            h = sha256(res.conta, t.id_externo)
        else:
            chave = (t.data, t.centavos, desc_norm)
            h = hash_lancamento(res.conta, t.data, t.centavos, desc_norm, ocorrencias[chave])
            ocorrencias[chave] += 1
        tipo, motivo, contrapartida = definir_tipo(t, desc_norm, cfg_contas, cfg_tipos)
        if contrapartida is None and tipo == "transferencia_interna":
            res.avisos.append(f"{t.data} {t.descricao} {t.centavos/100:.2f}: transferência de conta própria "
                              f"não cadastrada ({t.contraparte_conta}) — cadastre em config/contas.yaml")
        canal = definir_canal(t, desc_norm, cfg_tipos) if tipo == "operacional" else None
        cur = con.execute(
            """INSERT OR IGNORE INTO lancamentos
               (conta_id, data, descricao, descricao_norm, valor_centavos, contraparte_nome, contraparte_doc,
                contraparte_conta, tipo, tipo_motivo, canal, previsto, id_externo, contrapartida_conta_id,
                hash, importacao_id, criado_em)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (cid, t.data.isoformat(), t.descricao, desc_norm, t.centavos, t.contraparte_nome,
             t.contraparte_doc, t.contraparte_conta, tipo, motivo, canal, t.previsto, t.id_externo,
             contas_ids.get(contrapartida), h, res.importacao_id, agora()),
        )
        if cur.rowcount:
            res.novos += 1
            if tipo != "transferencia_interna":   # internas: espelho decidido em reavaliar_repasses
                criar_espelho(con, cur.lastrowid)
        else:
            res.duplicados += 1
            if t.previsto is False and t.id_externo:  # recebível que já caiu: atualiza a flag
                con.execute("UPDATE lancamentos SET previsto = ? WHERE hash = ?", (False, h))

    for s in ext.saldos:
        con.execute(
            """INSERT INTO saldos_diarios (conta_id, data, fonte, saldo_centavos, importacao_id)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (conta_id, data, fonte) DO UPDATE SET
                 saldo_centavos = excluded.saldo_centavos, importacao_id = excluded.importacao_id""",
            (cid, s.data.isoformat(), "extrato_parcial" if s.parcial else "extrato", s.centavos, res.importacao_id),
        )
    con.execute("UPDATE importacoes SET linhas_lidas = ?, novos = ?, duplicados = ? WHERE id = ?",
                (res.lidos, res.novos, res.duplicados, res.importacao_id))
    return res


def reavaliar_repasses(con: sqlite3.Connection) -> list[str]:
    """Regra anti-dupla contagem das transferências vindas de contas próprias.

    Se a conta de origem tem relatório importado cobrindo a data, é transferência interna (com espelho).
    Se não tem (ex.: CEO não enviou o relatório Vindi do período), vira receita estimada do canal da conta.
    """
    msgs = []
    contas = {r["id"]: r for r in con.execute("SELECT * FROM contas")}
    originais = con.execute(
        "SELECT * FROM lancamentos WHERE contrapartida_conta_id IS NOT NULL AND espelho_de IS NULL "
        "AND contraparte_doc IS NOT NULL AND (tipo = 'transferencia_interna' OR estimado)"
    ).fetchall()
    for l in originais:
        origem = contas[l["contrapartida_conta_id"]]
        cob = con.execute(
            "SELECT MIN(data) AS ini, MAX(data) AS fim FROM lancamentos "
            "WHERE conta_id = ? AND espelho_de IS NULL AND NOT previsto", (origem["id"],)
        ).fetchone()
        coberto = cob["ini"] is not None and cob["ini"] <= l["data"] <= cob["fim"]
        if coberto or origem["tipo"] != "gateway":
            con.execute("UPDATE lancamentos SET tipo = 'transferencia_interna', estimado = FALSE, canal = NULL, "
                        "tipo_motivo = ? WHERE id = ?",
                        (f"transferência de conta própria: {origem['nome']}", l["id"]))
            criar_espelho(con, l["id"])
        else:
            con.execute("DELETE FROM lancamentos WHERE espelho_de = ?", (l["id"],))
            con.execute("UPDATE lancamentos SET tipo = 'operacional', estimado = TRUE, canal = ?, tipo_motivo = ? "
                        "WHERE id = ?",
                        (origem["banco"], f"repasse de {origem['nome']} sem relatório no período: receita estimada",
                         l["id"]))
            msgs.append(f"{l['data']} {l['descricao']}: sem relatório de {origem['nome']} — receita estimada")
    return msgs
