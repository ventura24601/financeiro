from datetime import date
from decimal import Decimal

import openpyxl
import pytest

from financeiro import db
from financeiro.conciliacao import conciliar
from financeiro.importar import importar_arquivo, reavaliar_repasses
from financeiro.util import brl, normalizar_descricao, para_centavos

CFG_CONTAS = {
    "empresa": {"cnpjs_proprios": ["21571448000135"]},
    "contas": [
        {"codigo": "itau_0384", "nome": "Itaú", "banco": "itau", "tipo": "corrente",
         "agencia": "0384", "numero": "0011020-1"},
        {"codigo": "vindi_digital", "nome": "Vindi", "banco": "vindi", "tipo": "gateway",
         "identificadores": ["0001/000008392-8"]},
        {"codigo": "fundos_itau", "nome": "Fundos", "banco": "itau", "tipo": "investimento"},
    ],
}
CFG_TIPOS = {
    "tipos": [
        {"nome": "varredura", "padrao": "^(APL|RES) APLIC AUT", "tipo": "varredura_aplicacao"},
        {"nome": "aplicacao", "padrao": "^APLICACAO ", "tipo": "aplicacao_resgate", "contrapartida": "fundos_itau"},
    ],
    "canais": [{"canal": "bambuno", "doc": "27012243000104"}],
}


def extrato_itau(caminho, linhas, saldo_ini, saldos, periodo="01/10/2026 até 03/10/2026"):
    wb = openpyxl.Workbook()
    ws = wb.active
    for r in [("Atualização:", "05/10/2026 10:00:00"), ("Agência:", "0384"), ("Conta:", "0011020-1"),
              ("Periodo:", periodo),
              ("Data", "Lançamento", "Ag/origem", "Razão Social", "CPF/CNPJ", "Valor (R$)", "Saldo (R$)"),
              ("30/09/2026", "SALDO ANTERIOR", "", "", "", None, saldo_ini)]:
        ws.append(r)
    for r in linhas:
        ws.append(r)
    for d, s in saldos:
        ws.append((d, "SALDO TOTAL DISPONÍVEL DIA", "", "", "", None, s))
    wb.save(caminho)
    return caminho


@pytest.fixture
def con(tmp_path):
    c = db.conectar(tmp_path / "t.db")
    db.sincronizar_contas(c, CFG_CONTAS)
    return c


def test_centavos_sem_float():
    assert para_centavos(0.1 + 0.2) == 30
    assert para_centavos("R$ 1.234,56") == 123456
    assert para_centavos(-1694.9) == -169490
    assert para_centavos(Decimal("10.005")) == 1001
    assert brl(-123456) == "-R$ 1.234,56"


def test_normaliza_descricao():
    assert normalizar_descricao("PIX RECEBIDO BAMBUNO22/04") == "PIX RECEBIDO BAMBUNO"
    assert normalizar_descricao("Saldo  disponível") == "SALDO DISPONIVEL"


def test_lancamentos_identicos_no_mesmo_dia_e_reimportacao(con, tmp_path):
    linhas = [("01/10/2026", "RECEBIMENTOS YAPAY", "", "", "", 297.0, None),
              ("01/10/2026", "RECEBIMENTOS YAPAY", "", "", "", 297.0, None)]
    a = extrato_itau(tmp_path / "a.xlsx", linhas, 1000.0, [("01/10/2026", 1594.0)])
    r = importar_arquivo(con, a, CFG_CONTAS, CFG_TIPOS)
    assert (r.novos, r.duplicados) == (2, 0)          # os dois legítimos entram

    # extrato sobreposto (arquivo diferente) com um lançamento a mais
    b = extrato_itau(tmp_path / "b.xlsx", linhas + [("02/10/2026", "TARIFA", "", "", "", -10.0, None)],
                     1000.0, [("01/10/2026", 1594.0), ("02/10/2026", 1584.0)])
    r = importar_arquivo(con, b, CFG_CONTAS, CFG_TIPOS)
    assert (r.novos, r.duplicados) == (1, 2)
    assert conciliar(con, db.conta_id(con, "itau_0384")).ok

    # mesmo arquivo de novo: reconhecido pelo sha256
    assert importar_arquivo(con, b, CFG_CONTAS, CFG_TIPOS).ja_importado


def test_conciliacao_aponta_diferenca(con, tmp_path):
    a = extrato_itau(tmp_path / "a.xlsx", [("01/10/2026", "TARIFA", "", "", "", -10.0, None)],
                     1000.0, [("01/10/2026", 980.0)])
    importar_arquivo(con, a, CFG_CONTAS, CFG_TIPOS)
    c = conciliar(con, db.conta_id(con, "itau_0384"))
    assert not c.ok and c.erros[0].diferenca == -1000


def test_tipos_fora_da_dre_e_espelho(con, tmp_path):
    linhas = [("01/10/2026", "APL APLIC AUT MAIS", "", "", "", -500.0, None),
              ("01/10/2026", "APLICACAO TRUST DI INT", "", "", "", -100.0, None),
              ("01/10/2026", "PIX RECEBIDO BAMBUNO01/10", "0024/1", "BAMBUNO", "27.012.243/0001-04", 50.0, None),
              ("01/10/2026", "PIX RECEBIDO ICOM TV01/10", "0001/000008392-8", "ICOM TV",
               "21.571.448/0001-35", 70.0, None)]
    a = extrato_itau(tmp_path / "a.xlsx", linhas, 1000.0, [("01/10/2026", 1020.0)])
    importar_arquivo(con, a, CFG_CONTAS, CFG_TIPOS)
    reavaliar_repasses(con)
    tipos = {r["descricao_norm"]: (r["tipo"], r["canal"], r["estimado"]) for r in con.execute(
        "SELECT * FROM lancamentos WHERE espelho_de IS NULL")}
    assert tipos["APL APLIC AUT MAIS"][0] == "varredura_aplicacao"
    assert tipos["APLICACAO TRUST DI INT"][0] == "aplicacao_resgate"
    assert tipos["PIX RECEBIDO BAMBUNO"] == ("operacional", "bambuno", 0)
    # sem relatório Vindi no período: receita estimada, sem espelho
    assert tipos["PIX RECEBIDO ICOM TV"] == ("operacional", "vindi", 1)
    espelhos = con.execute("SELECT c.codigo, l.valor_centavos FROM lancamentos l JOIN contas c "
                           "ON c.id = l.conta_id WHERE espelho_de IS NOT NULL").fetchall()
    assert [tuple(e) for e in espelhos] == [("fundos_itau", 10000)]
    assert conciliar(con, db.conta_id(con, "itau_0384")).ok


def test_repasse_vira_transferencia_quando_ha_relatorio_vindi(con, tmp_path):
    a = extrato_itau(tmp_path / "a.xlsx", [("02/10/2026", "PIX RECEBIDO ICOM TV02/10", "0001/000008392-8",
                                             "ICOM TV", "21.571.448/0001-35", 70.0, None)],
                     1000.0, [("02/10/2026", 1070.0)])
    importar_arquivo(con, a, CFG_CONTAS, CFG_TIPOS)
    csv = tmp_path / "vindi.csv"
    csv.write_text(
        "Id;Data da Transação;Horário;Número pedido;Vendedor;E-mail - Loja;Cliente;E-mail do cliente;"
        "Telefone Vendedor;Sub Loja;Meio de Pagamento;Parcelas;Valor Pago;Valor;Valor Frete;Valor loja;Taxa;"
        "Data Credito;Data confirmação;Status\n"
        "1;01/10/2026;08:00;9;ICOM;x;Clinica A;a@a;1;-;Pix;1;R$ 70,99;R$ 70,99;R$ 0,00;R$ 70,00;R$ 0,99;"
        "2026-10-01;-;Aprovada\n"
        "2;03/10/2026;08:00;10;ICOM;x;Clinica B;b@b;1;-;Boleto Bancario;1;R$ 10,00;R$ 10,00;R$ 0,00;"
        "R$ 9,01;R$ 0,99;2026-10-03;-;Aprovada\n",
        encoding="latin-1")
    r = importar_arquivo(con, csv, CFG_CONTAS, CFG_TIPOS)
    assert r.novos == 4                     # 2 receitas + 2 taxas
    reavaliar_repasses(con)
    orig = con.execute("SELECT tipo, estimado FROM lancamentos WHERE descricao_norm = 'PIX RECEBIDO ICOM TV'").fetchone()
    assert tuple(orig) == ("transferencia_interna", 0)
    saldo_vindi = con.execute("SELECT SUM(valor_centavos) FROM lancamentos WHERE conta_id = ?",
                              (db.conta_id(con, "vindi_digital"),)).fetchone()[0]
    assert saldo_vindi == 7099 - 99 + 1000 - 99 - 7000   # recebeu, pagou taxas, repassou ao Itaú
