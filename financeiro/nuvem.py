"""Processa os extratos enviados pelo painel (rodado pelo GitHub Actions, ou localmente).

Fluxo: pendentes em `processamentos` → baixa os arquivos do bucket `extratos` → recria a base a partir
do Supabase → importa/concilia → se tudo fechar, sincroniza e publica o painel. Se a conciliação não
fechar, nada é enviado (regra do projeto: parar e avisar) e o status fica `divergencia` com o log.
O log fica só no Supabase (visível no painel): o repositório é público e o log do Actions não pode ter valores.
"""
from __future__ import annotations

import io
import re
import tempfile
import traceback
from contextlib import redirect_stdout
from pathlib import Path

from . import db, supabase
from .util import agora


def processar_uploads() -> int:
    if not supabase.configurado():
        print("Supabase não configurado.")
        return 1
    fila = supabase.pendentes()
    if not fila:
        print("Nenhum upload pendente.")
        return 0
    ids = [p["id"] for p in fila]
    for pid in ids:
        supabase.atualizar_processamento(pid, status="processando", iniciado_em=agora())

    log = io.StringIO()
    status, resumo = {}, {}
    try:
        from .__main__ import abrir_banco, importar_arquivos
        from .publicar import salvar_local

        with tempfile.TemporaryDirectory() as tmp, redirect_stdout(log):
            arquivos, por_nome = [], {}
            for p in fila:
                nome = f"{p['id']:06d}_{re.sub(r'[^A-Za-z0-9._-]', '_', p['arquivo'])}"
                destino = Path(tmp) / nome
                destino.write_bytes(supabase.baixar_objeto(p["caminho"]))
                arquivos.append(destino)
                por_nome[nome] = p["id"]

            con = abrir_banco()
            resultados, falhas, divergencia = importar_arquivos(con, arquivos)
            for r in resultados:
                resumo[por_nome[r.arquivo]] = {"conta": r.conta, "lidos": r.lidos, "novos": r.novos,
                                               "duplicados": r.duplicados, "ja_importado": r.ja_importado}
            for nome, erro in falhas.items():
                status[por_nome[nome]] = "erro"
                resumo[por_nome[nome]] = {"erro": erro}

            if divergencia:
                print("\nPARE: divergência de conciliação. Nada foi enviado; os dados do painel não mudaram.")
                for pid in ids:
                    status.setdefault(pid, "divergencia")
            else:
                enviados = supabase.sincronizar(con)
                print("Supabase sincronizado: " + ", ".join(f"{t} {n}" for t, n in enviados.items()))
                pub = supabase.publicar_painel(salvar_local(con))
                print(f"Painel atualizado (publicação {pub}).")
                for pid in ids:
                    status.setdefault(pid, "ok")
    except Exception:
        log.write("\n" + traceback.format_exc())
        for pid in ids:
            status.setdefault(pid, "erro")

    for pid in ids:
        supabase.atualizar_processamento(pid, status=status[pid], log=log.getvalue()[-20000:],
                                         resumo=resumo.get(pid), concluido_em=agora())
    contagem = {s: list(status.values()).count(s) for s in set(status.values())}
    print(f"Processados {len(ids)} upload(s): {contagem}")   # sem valores: o log do Actions é público
    return 0 if set(status.values()) == {"ok"} else 1
