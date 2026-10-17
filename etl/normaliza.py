"""Funções puras de limpeza. Nenhuma delas acessa rede ou disco — por isso são
fáceis de testar (ver tests/test_normaliza.py)."""
from __future__ import annotations

import csv
import re
import unicodedata
from datetime import date, datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def sem_acento(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def chave(s: str) -> str:
    """Chave de comparação de cabeçalhos/nomes: sem acento, maiúscula, espaços
    simples, sem quebra de linha. 'DESABRIGADOS\\n(Nº)' == 'Desabrigados (nº)'."""
    s = sem_acento(str(s)).upper().replace("º", "O").replace("°", "O")
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"\s*/\s*", "/", s)
    return s.strip()


VAZIOS = {"", "-", "--", "NULL", "NONE", "#N/A", "#REF!", "#VALUE!", "N/A", "NA"}


def vazio(v) -> bool:
    return v is None or chave(v) in VAZIOS


# ----------------------------------------------------------------- números
def inteiro(v):
    if vazio(v):
        return None
    s = str(v).strip().replace(".", "").replace(" ", "")
    s = s.split(",")[0]
    m = re.fullmatch(r"-?\d+", s)
    if not m:
        raise ValueError(f"não é inteiro: {v!r}")
    return int(s)


def decimal(v):
    """Aceita '1.234,56', 'R$ 2.625.000,00', '12,5', '12.5'."""
    if vazio(v):
        return None
    s = str(v).replace("R$", "").replace("mm", "").strip().replace(" ", "")
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError as e:
        raise ValueError(f"não é número: {v!r}") from e


def sim_nao(v):
    if vazio(v):
        return None
    k = chave(v)
    if k in {"SIM", "S", "TRUE", "1", "X"}:
        return True
    if k in {"NAO", "N", "FALSE", "0"}:
        return False
    raise ValueError(f"esperado Sim/Não: {v!r}")


# ------------------------------------------------------------------- datas
_RE_DATA = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?")


def _limpa_data(v: str) -> str:
    s = re.sub(r"[^\d/: ]", "", str(v)).strip()          # remove ´, letras etc.
    # '06/032026' -> '06/03/2026'
    m = re.fullmatch(r"(\d{1,2})/(\d{2})(\d{4})(.*)", s)
    if m:
        s = f"{m.group(1)}/{m.group(2)}/{m.group(3)}{m.group(4)}"
    return s


def _parse(v) -> datetime | None:
    if vazio(v):
        return None
    if isinstance(v, datetime):
        return v
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day)
    m = _RE_DATA.search(_limpa_data(v))
    if not m:
        raise ValueError(f"data ilegível: {v!r}")
    d, mo, a, h, mi, se = m.groups()
    a = int(a)
    if a < 100:
        a += 2000
    return datetime(a, int(mo), int(d), int(h or 0), int(mi or 0), int(se or 0))


def data(v):
    dt = _parse(v)
    return dt.date().isoformat() if dt else None


def datahora(v):
    dt = _parse(v)
    return dt.isoformat(timespec="minutes") if dt else None


def hora(v):
    if vazio(v):
        return None
    m = re.search(r"(\d{1,2})\s*[:hH;.]\s*(\d{2})?", str(v))
    if not m or int(m.group(1)) > 23:
        raise ValueError(f"hora ilegível: {v!r}")
    return f"{int(m.group(1)):02d}:{m.group(2) or '00'}"


def latlon(v, casas: int = 3):
    if vazio(v):
        return None
    nums = re.findall(r"-?\d+(?:\.\d+)?", str(v))
    if len(nums) != 2:
        raise ValueError(f"coordenada ilegível: {v!r}")
    lat, lon = float(nums[0]), float(nums[1])
    if not (-23.5 <= lat <= -20.7 and -45.0 <= lon <= -40.8):
        raise ValueError(f"coordenada fora do RJ: {v!r}")
    return [round(lat, casas), round(lon, casas)]


# ------------------------------------------------------- referência RJ/REDEC
# Distritos/localidades que aparecem no lugar do município em algumas fontes.
# Acrescente aqui quando o ETL avisar "município desconhecido".
DISTRITOS = {
    "ITAIPAVA": "PETRÓPOLIS",
    "PEDRO DO RIO": "PETRÓPOLIS",
    "CORREAS": "PETRÓPOLIS",
    "LUMIAR": "NOVA FRIBURGO",
    "VISCONDE DE MAUA": "RESENDE",
    "CUNHAMBEBE": "ANGRA DOS REIS",
}


class Referencia:
    """Tabela oficial município -> código IBGE -> REDEC (referencia/municipios_rj.csv)."""

    def __init__(self, caminho: Path = RAIZ / "referencia" / "municipios_rj.csv"):
        with open(caminho, encoding="utf-8") as f:
            self.linhas = list(csv.DictReader(f))
        self._mun = {}
        for r in self.linhas:
            self._mun[self._k_mun(r["municipio"])] = r
        self.redecs = sorted({r["redec"] for r in self.linhas}, key=lambda s: int(re.search(r"\d+", s).group()))
        self._redec_por_num = {int(re.search(r"\d+", r).group()): r for r in self.redecs}

    @staticmethod
    def _k_mun(s: str) -> str:
        k = chave(s)
        k = re.sub(r"\s*-?\s*RJ$", "", k)
        return k.replace("-", " ").replace("  ", " ").strip()

    def municipio(self, v):
        """Devolve (nome_canônico, cod_ibge) ou levanta ValueError."""
        if vazio(v):
            return None, None
        k = self._k_mun(v)
        r = self._mun.get(self._k_mun(DISTRITOS.get(k, k)))
        if not r:
            raise ValueError(f"município desconhecido: {v!r}")
        return r["municipio"], r["cod_ibge"]

    def redec_do_municipio(self, cod_ibge):
        for r in self.linhas:
            if r["cod_ibge"] == cod_ibge:
                return r["redec"]
        return None

    def redec(self, v):
        """'REDEC 6 – Sul II', 'redec 6 - SUL II', '6' -> 'REDEC 6 - SUL II'."""
        if vazio(v):
            return None
        m = re.search(r"\d+", str(v))
        if not m or int(m.group()) not in self._redec_por_num:
            raise ValueError(f"REDEC desconhecida: {v!r}")
        return self._redec_por_num[int(m.group())]
