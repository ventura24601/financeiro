"""Dias úteis bancários: fins de semana + feriados nacionais (inclui Carnaval, Sexta Santa e Corpus Christi)."""
from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache


def _pascoa(ano: int) -> date:
    a, b, c = ano % 19, ano // 100, ano % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes = (h + l - 7 * m + 114) // 31
    dia = (h + l - 7 * m + 114) % 31 + 1
    return date(ano, mes, dia)


@lru_cache(maxsize=None)
def feriados(ano: int) -> frozenset:
    p = _pascoa(ano)
    fixos = [(1, 1), (4, 21), (5, 1), (9, 7), (10, 12), (11, 2), (11, 15), (11, 20), (12, 25)]
    moveis = [p - timedelta(days=48), p - timedelta(days=47), p - timedelta(days=2), p + timedelta(days=60)]
    return frozenset([date(ano, m, d) for m, d in fixos] + moveis)


def dia_util(d: date) -> bool:
    return d.weekday() < 5 and d not in feriados(d.year)


def proximo_dia_util(d: date) -> date:
    while not dia_util(d):
        d += timedelta(days=1)
    return d
