"""Carimba a versão do código nos endereços do CSS e dos módulos JS (?v=<hash>) antes de publicar.

Sem isso, depois de uma atualização o navegador pode juntar arquivos novos com antigos guardados
em cache (ex.: index.html novo + app.js antigo) e a página quebra até um Ctrl+Shift+R.
O hash vem do conteúdo dos arquivos: só muda quando o código muda. Roda só na cópia do
GitHub Actions (o repositório continua sem o carimbo).
"""
from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

SITE = Path(sys.argv[1] if len(sys.argv) > 1 else "site")


def main():
    arquivos = sorted((SITE / "assets" / "js").glob("*.js")) + sorted((SITE / "assets" / "css").glob("*.css")) + [SITE / "index.html"]
    h = hashlib.sha256()
    for a in arquivos:
        h.update(a.read_bytes())
    v = h.hexdigest()[:10]
    idx = SITE / "index.html"
    html = idx.read_text(encoding="utf-8")
    html = re.sub(r'((?:href|src)="assets/(?:css|js)/[\w-]+\.(?:css|js))"', rf'\1?v={v}"', html)
    idx.write_text(html, encoding="utf-8")
    for js in (SITE / "assets" / "js").glob("*.js"):
        t = js.read_text(encoding="utf-8")
        t2 = re.sub(r'(from\s+"\./[\w-]+\.js)"', rf'\1?v={v}"', t)
        t2 = re.sub(r'(import\(\s*"\./[\w-]+\.js)"', rf'\1?v={v}"', t2)
        if t2 != t:
            js.write_text(t2, encoding="utf-8")
    print(f"versão do código: {v}")


if __name__ == "__main__":
    main()
