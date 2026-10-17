"""Decide se a execução agendada precisa republicar o site.

Publica quando: (a) não é execução agendada (push ou botão "Run workflow"),
(b) os dados mudaram desde a última publicação, ou (c) a última publicação tem
mais de LIMITE_MIN minutos (sinal de vida: o selo "atualizado às" não envelhece).
Assim o robô pode olhar a planilha a cada 10 min sem esbarrar no limite de
publicações do GitHub Pages.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

LIMITE_MIN = 60


def baixar(url: str) -> str | None:
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            return r.read().decode("utf-8").strip()
    except Exception:
        return None


def decidir(evento: str, versao_nova: str, versao_publicada: str | None, gerado_publicado: str | None,
            agora: datetime | None = None) -> tuple[bool, str]:
    if evento != "schedule":
        return True, f"execução por {evento}"
    if not versao_publicada:
        return True, "site sem versão publicada"
    if versao_nova != versao_publicada:
        return True, "dados mudaram na planilha"
    try:
        idade = ((agora or datetime.now(timezone.utc)) - datetime.fromisoformat(gerado_publicado)).total_seconds() / 60
    except (TypeError, ValueError):
        return True, "data da última publicação ilegível"
    if idade >= LIMITE_MIN:
        return True, f"última publicação há {idade:.0f} min (sinal de vida)"
    return False, f"dados iguais aos publicados há {idade:.0f} min"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="URL do site publicado")
    ap.add_argument("--evento", required=True)
    ap.add_argument("--dados", default="site/data")
    a = ap.parse_args(argv)
    nova = Path(a.dados, "versao.txt").read_text(encoding="utf-8").strip()
    base = a.base.rstrip("/")
    t = int(datetime.now().timestamp())
    publicada = baixar(f"{base}/data/versao.txt?t={t}")
    meta = baixar(f"{base}/data/meta.json?t={t}")
    gerado = json.loads(meta).get("gerado_em") if meta else None
    publicar, motivo = decidir(a.evento, nova, publicada, gerado)
    print(f"publicar={str(publicar).lower()} — {motivo}")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"publicar={str(publicar).lower()}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
