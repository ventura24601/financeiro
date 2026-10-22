"""CLI: python -m financeiro {importar,status,conciliar,publicar,baixar,processar-uploads}"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from collections import defaultdict
from datetime import datetime

from . import db, supabase
from .conciliacao import conciliar
from .importadores import FormatoNaoSuportado
from .importar import importar_arquivo, reavaliar_repasses
from .util import TZ, agora, brl

ENTRADA = db.RAIZ / "extratos" / "entrada"
PROCESSADOS = db.RAIZ / "extratos" / "processados"


def importar_arquivos(con, arquivos):
    """Importa, reavalia repasses e concilia. Devolve (resultados, falhas {arquivo: erro}, divergencia)."""
    cfg_contas, cfg_tipos = db.carregar_config("contas.yaml"), db.carregar_config("tipos.yaml")
    db.sincronizar_contas(con, cfg_contas)
    resultados, falhas = [], {}
    for arq in arquivos:
        try:
            r = importar_arquivo(con, arq, cfg_contas, cfg_tipos)
            con.commit()
        except (FormatoNaoSuportado, KeyError, ValueError) as e:
            con.rollback()
            falhas[arq.name] = str(e)
            print(f"✗ {arq.name}: {e}")
            continue
        resultados.append(r)
        if r.ja_importado:
            print(f"= {arq.name}: arquivo idêntico já importado antes")
        else:
            print(f"✓ {arq.name} → {r.conta}: {r.lidos} lidos, {r.novos} novos, {r.duplicados} duplicados ignorados")
        for a in r.avisos:
            print(f"    · {a}")

    for m in reavaliar_repasses(con):
        print(f"    · {m}")
    con.commit()

    print("\nConciliação")
    divergencia = False
    concs = {}
    for c in con.execute("SELECT id, codigo FROM contas WHERE ativa"):
        conc = conciliar(con, c["id"])
        concs[c["codigo"]] = conc
        print("  " + conc.resumo().replace("\n", "\n  "))
        divergencia |= not conc.ok
    for r in resultados:
        if r.importacao_id:
            conc = concs[r.conta]
            con.execute("UPDATE importacoes SET conciliacao_ok = ?, conciliacao_msg = ? WHERE id = ?",
                        (conc.ok, conc.resumo(), r.importacao_id))
    con.execute("INSERT INTO snapshots (criado_em, tipo, referencia, conteudo_json) VALUES (?, 'importacao', ?, ?)",
                (agora(), ",".join(r.arquivo for r in resultados), json.dumps(_fotografia(con))))
    con.commit()
    return resultados, falhas, divergencia


def abrir_banco():
    """Supabase é a fonte da verdade: o SQLite local é recriado a partir dele antes de qualquer escrita."""
    if supabase.configurado():
        db.DB_PADRAO.unlink(missing_ok=True)
        con = db.conectar()
        n = supabase.baixar(con)
        print(f"Base local atualizada a partir do Supabase ({n} lançamentos).")
        return con
    return db.conectar()


def cmd_importar(args) -> int:
    arquivos = sorted(p for p in ENTRADA.iterdir() if p.is_file() and not p.name.startswith("."))
    if not arquivos:
        print("Nada em extratos/entrada.")
        return 0
    con = abrir_banco()
    resultados, falhas, divergencia = importar_arquivos(con, arquivos)
    if divergencia:
        print("\nPARE: há divergência de conciliação. Nada foi enviado ao Supabase e os arquivos ficaram em "
              "extratos/entrada até revisarmos.")
        return 1
    PROCESSADOS.mkdir(parents=True, exist_ok=True)
    carimbo = datetime.now(TZ).strftime("%Y%m%d-%H%M%S")
    movidos = [a for a in arquivos if a.name not in falhas]
    for arq in movidos:
        shutil.move(str(arq), PROCESSADOS / f"{carimbo}_{arq.name}")
    print(f"\n{len(movidos)} arquivo(s) movido(s) para extratos/processados.")
    if supabase.configurado():
        enviados = supabase.sincronizar(con)
        print("Supabase sincronizado: " + ", ".join(f"{t} {n}" for t, n in enviados.items()))
    return 0


def _fotografia(con) -> dict:
    """Totais mensais por conta e tipo — base dos snapshots (Fase 6)."""
    out = defaultdict(dict)
    for r in con.execute(
        "SELECT c.codigo, substr(l.data, 1, 7) AS mes, l.tipo, SUM(l.valor_centavos) AS total "
        "FROM lancamentos l JOIN contas c ON c.id = l.conta_id WHERE NOT l.previsto "
        "GROUP BY 1, 2, 3"
    ):
        out[f"{r['codigo']}:{r['mes']}"][r["tipo"]] = r["total"]
    return out


def cmd_conciliar(args) -> int:
    con = db.conectar()
    ok = True
    for c in con.execute("SELECT id FROM contas WHERE ativa"):
        conc = conciliar(con, c["id"])
        print(conc.resumo())
        ok &= conc.ok
    return 0 if ok else 1


def cmd_status(args) -> int:
    con = db.conectar()
    print("Contas")
    for c in con.execute(
        "SELECT c.nome, COUNT(l.id) n, MIN(l.data) ini, MAX(l.data) fim FROM contas c "
        "LEFT JOIN lancamentos l ON l.conta_id = c.id GROUP BY c.id ORDER BY c.id"
    ):
        print(f"  {c['nome']}: {c['n']} lançamentos de {c['ini'] or '-'} a {c['fim'] or '-'}")

    print("\nO que fica FORA da DRE (só caixa), por tipo")
    for r in con.execute(
        "SELECT tipo, COUNT(*) n, SUM(CASE WHEN valor_centavos > 0 THEN valor_centavos ELSE 0 END) ent, "
        "SUM(CASE WHEN valor_centavos < 0 THEN valor_centavos ELSE 0 END) sai FROM lancamentos "
        "WHERE tipo <> 'operacional' AND espelho_de IS NULL GROUP BY tipo"
    ):
        print(f"  {r['tipo']:<24} {r['n']:>4}x  entradas {brl(r['ent']):>16}  saídas {brl(r['sai']):>16}")

    print("\nEntradas operacionais por canal (regime de caixa; * = inclui receita estimada por repasse)")
    linhas = defaultdict(lambda: defaultdict(int))
    estimado = set()
    for r in con.execute(
        "SELECT substr(data, 1, 7) mes, COALESCE(canal, 'outros') canal, SUM(valor_centavos) v, MAX(estimado) e "
        "FROM lancamentos WHERE tipo = 'operacional' AND valor_centavos > 0 AND NOT previsto GROUP BY 1, 2"
    ):
        linhas[r["mes"]][r["canal"]] = r["v"]
        if r["e"]:
            estimado.add((r["mes"], r["canal"]))
    canais = ["bambuno", "bambuno_cartao", "vindi", "outros_gateways", "outros"]
    print("  mês      " + "".join(f"{c:>17}" for c in canais) + "   % Vindi")
    for mes in sorted(linhas):
        v = linhas[mes]
        cel = "".join(f"{brl(v[c]) + ('*' if (mes, c) in estimado else ' '):>17}" for c in canais)
        gw = v["bambuno"] + v["bambuno_cartao"] + v["vindi"]
        pct = f"{100 * v['vindi'] / gw:6.1f}%" if gw else "     -"
        print(f"  {mes}  {cel}   {pct}")

    prev = con.execute("SELECT COUNT(*), COALESCE(SUM(valor_centavos), 0) FROM lancamentos WHERE previsto").fetchone()
    if prev[0]:
        print(f"\nRecebíveis futuros (Vindi, créditos ainda não caídos): {prev[0]} lançamentos, {brl(prev[1])}")

    print("\nSaídas operacionais por mês")
    for r in con.execute(
        "SELECT substr(data, 1, 7) mes, SUM(valor_centavos) v, COUNT(*) n FROM lancamentos "
        "WHERE tipo = 'operacional' AND valor_centavos < 0 AND NOT previsto GROUP BY 1 ORDER BY 1"
    ):
        print(f"  {r['mes']}  {brl(r['v']):>16}  ({r['n']} lançamentos)")
    return 0


def cmd_baixar(args) -> int:
    abrir_banco()
    return 0


def cmd_processar_uploads(args) -> int:
    from .nuvem import processar_uploads

    return processar_uploads()


def cmd_publicar(args) -> int:
    """Gera os dados do painel e publica no Supabase; o painel no Netlify lê de lá (sem novo deploy)."""
    import subprocess

    from .publicar import salvar_local

    con = abrir_banco()
    dados = salvar_local(con)
    if supabase.configurado():
        print(f"Painel atualizado (publicação {supabase.publicar_painel(dados)} no Supabase).")
    if args.deploy:
        return subprocess.call(["netlify", "deploy", "--prod", "--message", f"código {agora()}"], cwd=db.RAIZ / "web")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="financeiro")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("importar", help="importa extratos/entrada, deduplica, concilia e move para processados")
    sub.add_parser("conciliar", help="refaz a conciliação de todas as contas")
    sub.add_parser("status", help="resumo do que está no banco")
    sub.add_parser("baixar", help="recria a base local a partir do Supabase")
    sub.add_parser("processar-uploads", help="processa extratos enviados pelo painel (usado no GitHub Actions)")
    pub = sub.add_parser("publicar", help="gera os dados do painel e publica no Supabase")
    pub.add_argument("--deploy", action="store_true", help="também republica o código do painel no Netlify")
    args = p.parse_args(argv)
    return {"importar": cmd_importar, "conciliar": cmd_conciliar, "status": cmd_status,
            "baixar": cmd_baixar, "processar-uploads": cmd_processar_uploads,
            "publicar": cmd_publicar}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
