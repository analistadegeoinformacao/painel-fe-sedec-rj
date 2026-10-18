"""Cruzamento ocorrência x unidade de conservação (etl/ucs.py)."""
from etl import build, ucs as U

ARQ = build.RAIZ / "referencia" / "ucs_rj.geojson"


def _ll(geom_m):
    p = geom_m.representative_point()
    return [p.y / U._KY, p.x / U._KX]


def test_dentro_perto_longe_e_coordenada_descartada():
    lista, arvore = U.carregar(ARQ)
    tijuca = next(u for u in lista if "TIJUCA" in u["nome"] and u["esfera"] == "Federal")
    lat, lon = _ll(tijuca["geom"])
    # ponto 300 m ao norte do vértice mais ao norte da UC
    from shapely.geometry import mapping
    import itertools
    def pts(c):
        return [c] if isinstance(c[0], float) else list(itertools.chain.from_iterable(pts(x) for x in c))
    x, y = max(pts(mapping(tijuca["geom"])["coordinates"]), key=lambda c: c[1])
    norte, oeste = (y + 300) / U._KY, x / U._KX
    regs = [{"latlon": [lat, lon]}, {"latlon": [-21.5, -41.9]}, {"latlon": None}]
    cont = U.classificar(regs, lista, arvore)
    assert regs[0]["uc_faixa"] == "dentro" and lista[regs[0]["uc"]]["nome"] == tijuca["nome"]
    assert all("latlon" not in r for r in regs), "coordenada não pode sair do ETL"
    assert cont["sem_coordenada"] == 1
    perto = [{"latlon": [norte, oeste]}]
    U.classificar(perto, lista, arvore)
    assert perto[0].get("uc_faixa") == "500"


def test_sobreposicao_vale_esfera_mais_alta():
    lista, arvore = U.carregar(ARQ)
    # PNM da Prainha fica dentro do PE da Pedra Branca: deve valer o estadual
    prainha = next(u for u in lista if "PRAINHA" in u["nome"])
    pedra = next(u for u in lista if "PEDRA BRANCA" in u["nome"] and u["esfera"] == "Estadual")
    regs = [{"latlon": _ll(prainha["geom"].intersection(pedra["geom"]))}]
    U.classificar(regs, lista, arvore)
    escolhida = lista[regs[0]["uc"]]
    assert escolhida["nome"] == pedra["nome"]
