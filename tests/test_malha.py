"""A malha do mapa precisa casar com a tabela oficial (92 municípios, código IBGE)."""
import json
from pathlib import Path

from etl.normaliza import Referencia

GEO = Path(__file__).resolve().parent.parent / "site" / "assets" / "geo"


def test_malha_tem_os_92_municipios_da_referencia():
    feats = json.loads((GEO / "rj-municipios.geojson").read_text(encoding="utf-8"))["features"]
    ids = {f["properties"]["id"] for f in feats}
    assert len(feats) == 92
    assert ids == {r["cod_ibge"] for r in Referencia().linhas}
    assert all(f["geometry"]["type"] in ("Polygon", "MultiPolygon") for f in feats)


def test_contorno_do_estado_existe_e_e_poligonal():
    g = json.loads((GEO / "rj-contorno.geojson").read_text(encoding="utf-8"))
    assert g["features"][0]["geometry"]["type"] in ("Polygon", "MultiPolygon")
