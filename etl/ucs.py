"""Proximidade de unidades de conservação (UCs) para as ocorrências de fogo.

Cada ocorrência com coordenada recebe:
  uc        -> índice da UC (nomes em meta.json -> "ucs")
  uc_faixa  -> "dentro" | "500" (até 500 m do limite) | "1000" (de 500 m a 1 km)
Ocorrências mais longe que 1 km ficam sem esses campos. A coordenada em si
NUNCA é publicada: é usada aqui e descartada.

Regras:
  - dentro de mais de uma UC (sobreposição): vale a de esfera mais alta
    (Federal > Estadual > Municipal);
  - fora de todas: vale a UC mais próxima, se estiver a até 1 km.
Distâncias numa projeção local em metros (erro < 2% no RJ, ~20 m a 1 km).
"""
from __future__ import annotations

import json
import math
from pathlib import Path

ORDEM_ESFERA = {"Federal": 0, "Estadual": 1, "Municipal": 2}
_KX = 111320 * math.cos(math.radians(22.3))
_KY = 110540


def _proj(x, y, z=None):
    return x * _KX, y * _KY


def carregar(caminho: Path):
    from shapely import make_valid, transform
    from shapely.geometry import shape
    from shapely.strtree import STRtree

    fc = json.loads(Path(caminho).read_text(encoding="utf-8"))
    ucs = []
    for i, f in enumerate(fc["features"]):
        g = make_valid(shape(f["geometry"]))
        gm = transform(g, lambda c: c * [_KX, _KY])
        ucs.append({"id": i, **f["properties"], "geom": gm})
    arvore = STRtree([u["geom"] for u in ucs])
    return ucs, arvore


def classificar(registros: list[dict], ucs, arvore, raio_m: int = 1000) -> dict:
    """Marca os registros (in place) e devolve a contagem por faixa."""
    from shapely.geometry import Point

    cont = {"dentro": 0, "500": 0, "1000": 0, "longe": 0, "sem_coordenada": 0}
    for r in registros:
        ll = r.pop("latlon", None)
        if not ll:
            cont["sem_coordenada"] += 1
            r["_sem_coord"] = True
            continue
        p = Point(ll[1] * _KX, ll[0] * _KY)
        cand = [ucs[i] for i in arvore.query(p.buffer(raio_m))]
        dentro = [u for u in cand if u["geom"].covers(p)]
        if dentro:
            u = min(dentro, key=lambda u: ORDEM_ESFERA.get(u["esfera"], 9))
            r["uc"], r["uc_faixa"] = u["id"], "dentro"
            cont["dentro"] += 1
            continue
        perto = [(u["geom"].distance(p), u) for u in cand]
        perto = [(d, u) for d, u in perto if d <= raio_m]
        if not perto:
            cont["longe"] += 1
            continue
        d, u = min(perto, key=lambda t: t[0])
        r["uc"], r["uc_faixa"] = u["id"], ("500" if d <= 500 else "1000")
        cont["500" if d <= 500 else "1000"] += 1
    return cont


def tabela_meta(ucs) -> list[dict]:
    """Nomes das UCs para o navegador (o índice é a posição na lista)."""
    return [{"nome": u["nome"], "esfera": u["esfera"], "categoria": u["categoria"]} for u in ucs]
