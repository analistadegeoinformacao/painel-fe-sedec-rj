"""Detecta site travado: o GitHub diz que publicou, mas o que está no ar não envelhece/renova.

O vigia publica a cada ~5 min. Se mesmo assim o "gerado_em" do site publicado fica mais velho que
LIMITE_MIN, algo prende o Pages (ex.: deploys repetidos do mesmo commit que dão "success" sem trocar
o conteúdo — visto em 05/11/2026, 06:13 → 18:50). Aí o vigia força um deployment de outro commit.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone

from etl.precisa_publicar import baixar

LIMITE_MIN = 30


def travado(gerado_publicado: str | None, agora: datetime | None = None, limite_min: int = LIMITE_MIN) -> tuple[bool, str]:
    """(travado?, motivo). Sem leitura do site não dá para afirmar nada: não considera travado."""
    if not gerado_publicado:
        return False, "não foi possível ler o site publicado"
    try:
        gerado = datetime.fromisoformat(gerado_publicado)
    except ValueError:
        return False, "data publicada ilegível"
    idade = ((agora or datetime.now(timezone.utc)) - gerado).total_seconds() / 60
    if idade >= limite_min:
        return True, f"site publicado há {idade:.0f} min"
    return False, f"site publicado há {idade:.0f} min"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="URL do site publicado")
    ap.add_argument("--limite-min", type=int, default=LIMITE_MIN)
    a = ap.parse_args(argv)
    t = int(datetime.now().timestamp())
    meta = baixar(f"{a.base.rstrip('/')}/data/meta.json?t={t}")
    try:
        gerado = json.loads(meta).get("gerado_em") if meta else None
    except ValueError:
        gerado = None
    esta, motivo = travado(gerado, limite_min=a.limite_min)
    print(f"travado={str(esta).lower()} — {motivo}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
