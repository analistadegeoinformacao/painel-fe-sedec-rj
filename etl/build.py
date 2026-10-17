"""Extrai -> normaliza -> valida -> publica os JSON do painel.

Uso:
  python -m etl.build --fonte appsscript            (usa APPS_SCRIPT_URL / APPS_SCRIPT_TOKEN)
  python -m etl.build --fonte google --origem <ID_DA_PLANILHA>
  python -m etl.build --fonte texto  --origem caminho/NOVA_BASE_ANALISTAS
  python -m etl.build --fonte xlsx   --origem caminho/planilha.xlsx

Saída: site/data/*.json + site/data/meta.json
Código de saída 1 = ERRO de contrato -> nada é gravado e o GitHub Actions
interrompe a publicação (o site no ar continua com a última versão boa).
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml

from . import fonte, normaliza as N

RAIZ = Path(__file__).resolve().parent.parent
BRT = timezone(timedelta(hours=-3))
CONVERSORES = {
    "texto": lambda v: None if N.vazio(v) else " ".join(str(v).split()),
    "inteiro": N.inteiro,
    "decimal": N.decimal,
    "data": N.data,
    "datahora": N.datahora,
    "hora": N.hora,
    "sim_nao": N.sim_nao,
}


class Relatorio:
    def __init__(self):
        self.erros: list[str] = []
        self.avisos: dict[str, list[str]] = defaultdict(list)

    def erro(self, conj, msg):
        self.erros.append(f"[{conj}] {msg}")

    def aviso(self, conj, msg):
        self.avisos[conj].append(msg)


def mapear_colunas(cabecalho, spec_colunas):
    idx = {N.chave(h): i for i, h in enumerate(cabecalho) if not N.vazio(h)}
    achadas = {}
    for campo, nomes in spec_colunas.items():
        for nome in nomes:
            if N.chave(nome) in idx:
                achadas[campo] = idx[N.chave(nome)]
                break
    return achadas


def processar(nome, spec, linhas_brutas, ref: N.Referencia, rel: Relatorio, limites):
    h = spec.get("linha_cabecalho", 0)
    if len(linhas_brutas) <= h:
        rel.erro(nome, f"aba '{spec['aba']}' está vazia")
        return [], []
    cab = linhas_brutas[h]
    cols = mapear_colunas(cab, spec["colunas"])

    for campo in spec.get("obrigatorias", []):
        if campo not in cols:
            rel.erro(nome, f"coluna obrigatória ausente: {spec['colunas'][campo][0]!r} "
                           f"(cabeçalho atual: {[c for c in cab if not N.vazio(c)]})")
    faltando = [c for c in spec["colunas"] if c not in cols and c not in spec.get("obrigatorias", [])]
    if faltando:
        rel.aviso(nome, f"colunas opcionais não encontradas: {', '.join(faltando)}")

    tipos = spec.get("tipos", {})
    hoje = (datetime.now(BRT) + timedelta(days=1)).date().isoformat()  # 1 dia de folga
    invalidos = Counter()
    exemplos = defaultdict(list)
    redec_preenchida = 0
    saida, sem_mun = [], []

    for i, bruta in enumerate(linhas_brutas[h + 1:]):
        linha_planilha = h + 2 + i
        if all(N.vazio(c) for c in bruta):
            continue
        reg = {}
        for campo, j in cols.items():
            v = bruta[j] if j < len(bruta) else ""
            t = tipos.get(campo, "texto")
            try:
                if t == "municipio":
                    reg[campo], reg["cod_ibge"] = ref.municipio(v)
                elif t == "redec":
                    reg[campo] = ref.redec(v)
                elif t == "latlon":
                    reg[campo] = N.latlon(v, spec.get("casas_decimais_coord", 3))
                else:
                    reg[campo] = CONVERSORES[t](v)
                    if t in ("data", "datahora") and reg[campo] and campo not in spec.get("datas_livres", []):
                        dia = reg[campo][:10]
                        if dia < limites["data_minima"] or dia > hoje:
                            raise ValueError(f"data fora do período ({limites['data_minima']} a hoje): {v!r}")
            except ValueError as e:
                reg[campo] = None
                if t == "municipio":
                    reg["cod_ibge"] = None
                invalidos[campo] += 1
                if len(exemplos[campo]) < 3:
                    exemplos[campo].append(f"linha {linha_planilha}: {e}")

        # REDEC vazia ou inválida, mas município conhecido -> completa pela referência
        if "redec" in spec["colunas"] and reg.get("cod_ibge"):
            oficial = ref.redec_do_municipio(reg["cod_ibge"])
            if reg.get("redec") is None:
                reg["redec"] = oficial
                redec_preenchida += 1
            elif reg["redec"] != oficial:
                rel.aviso(nome, f"linha {linha_planilha}: {reg['municipio']} marcado como "
                                f"{reg['redec']}, referência diz {oficial}")

        mun_bruto = bruta[cols["municipio"]] if "municipio" in cols and cols["municipio"] < len(bruta) else ""
        if spec.get("separar_sem_municipio") and N.vazio(mun_bruto) and reg.get("redec") is None:
            sem_mun.append({k: reg.get(k) for k in ("data", "hora", "descricao")})
            continue
        saida.append(reg)

    total = len(saida) or 1
    for campo, n in invalidos.items():
        t = tipos.get(campo, "texto")
        pct = 100 * n / total
        msg = f"{n} valor(es) inválido(s) em '{campo}' ({pct:.1f}%) — " + "; ".join(exemplos[campo])
        limite = {"data": limites["pct_max_datas_invalidas"], "datahora": limites["pct_max_datas_invalidas"],
                  "municipio": limites["pct_max_municipios_desconhecidos"]}.get(t)
        if limite is not None and pct > limite:
            rel.erro(nome, msg + f" — acima do limite de {limite}%")
        else:
            rel.aviso(nome, msg)
    if redec_preenchida:
        rel.aviso(nome, f"{redec_preenchida} linha(s) sem REDEC: completadas pela tabela de referência")
    if len(saida) < spec.get("min_linhas", 0):
        rel.erro(nome, f"apenas {len(saida)} linha(s); mínimo exigido {spec['min_linhas']}")
    return saida, sem_mun


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--fonte", choices=["appsscript", "google", "xlsx", "texto"], required=True)
    ap.add_argument("--origem", default="", help="URL do Apps Script, ID da planilha ou caminho do arquivo")
    ap.add_argument("--saida", default=str(RAIZ / "site" / "data"))
    ap.add_argument("--config", default=str(RAIZ / "config" / "fontes.yml"))
    a = ap.parse_args(argv)

    cfg = yaml.safe_load(Path(a.config).read_text(encoding="utf-8"))
    conjuntos = cfg["conjuntos"]
    ref = N.Referencia()
    rel = Relatorio()

    abas = fonte.ler(a.fonte, a.origem, [c["aba"] for c in conjuntos.values()])

    resultados, meta_conj = {}, {}
    for nome, spec in conjuntos.items():
        if spec["aba"] not in abas:
            (rel.erro if spec.get("min_linhas", 0) > 0 else rel.aviso)(nome, f"aba '{spec['aba']}' não encontrada")
            dados, extra = [], []
        else:
            dados, extra = processar(nome, spec, abas[spec["aba"]], ref, rel, cfg["limites"])
        if spec.get("publicar", True):
            resultados[nome] = dados
            meta_conj[nome] = {"titulo": spec.get("titulo", nome), "aba": spec["aba"], "linhas": len(dados)}
        if spec.get("separar_sem_municipio"):
            alvo = spec["separar_sem_municipio"]
            resultados[alvo] = extra
            meta_conj[alvo] = {"titulo": "Boletins sem município (sirenes, Cell Broadcast)",
                               "aba": spec["aba"], "linhas": len(extra)}

    for msg in rel.erros:
        print("ERRO  ", msg, file=sys.stderr)
    for conj, msgs in rel.avisos.items():
        for m in msgs[:20]:
            print("aviso ", f"[{conj}]", m)

    if rel.erros:
        print(f"\n{len(rel.erros)} erro(s) de contrato. NADA foi publicado.", file=sys.stderr)
        return 1

    meta = {
        "versao_contrato": 1,
        "gerado_em": datetime.now(BRT).isoformat(timespec="seconds"),
        "fonte": a.fonte,
        "conjuntos": meta_conj,
        "avisos": {k: v[:50] for k, v in rel.avisos.items()},
        "redecs": ref.redecs,
        "municipios": ref.linhas,
    }

    # grava num diretório temporário e só troca no fim (escrita atômica)
    destino = Path(a.saida)
    tmp = Path(tempfile.mkdtemp(prefix="dados_", dir=destino.parent))
    for nome, dados in resultados.items():
        (tmp / f"{nome}.json").write_text(json.dumps(dados, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (tmp / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    if destino.exists():
        shutil.rmtree(destino)
    tmp.rename(destino)
    print(f"\nOK — {sum(len(v) for v in resultados.values())} registros em {len(resultados)} conjuntos -> {destino}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
