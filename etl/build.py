"""Extrai -> normaliza -> valida -> publica os JSON do painel.

Uso:
  python -m etl.build --fonte appsscript            (usa APPS_SCRIPT_URL / APPS_SCRIPT_TOKEN)
  python -m etl.build --fonte google --origem <ID_DA_PLANILHA>
  python -m etl.build --fonte texto  --origem caminho/NOVA_BASE_ANALISTAS
  python -m etl.build --fonte xlsx   --origem caminho/planilha.xlsx
  (planilhas secundárias em modo local: --origem-fogo e --origem-historico)

Saída: site/data/*.json + site/data/meta.json
Código de saída 1 = ERRO de contrato -> nada é gravado e o GitHub Actions
interrompe a publicação (o site no ar continua com a última versão boa).
"""
from __future__ import annotations

import argparse
import json
import os
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
    # texto longo com quebras de linha preservadas (mensagens de alerta)
    "multilinha": lambda v: None if N.vazio(v) else "\n".join(l.rstrip() for l in str(v).strip().split("\n")),
}


class Relatorio:
    def __init__(self):
        self.erros: list[str] = []
        self.avisos: dict[str, list[str]] = defaultdict(list)
        self.excluidos: dict[str, int] = {}
        self.depuracao: dict[str, dict] = {}
        self.clima_com_alerta: dict[str, int] = {}

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


def nomes_aba(spec) -> list[str]:
    """'aba' pode ser um nome ou uma lista de nomes aceitos (o primeiro que existir na planilha vale)."""
    a = spec["aba"]
    return list(a) if isinstance(a, (list, tuple)) else [a]


def linhas_txt(linhas, maximo=60) -> str:
    """'linhas 12, 15, 40' (com teto, para o aviso não ficar enorme)."""
    ls = sorted(set(int(x) for x in linhas if x))
    if not ls:
        return ""
    txt = ", ".join(str(x) for x in ls[:maximo])
    return ("linha " if len(ls) == 1 else "linhas ") + txt + (f" … e mais {len(ls) - maximo}" if len(ls) > maximo else "")


def cruzar_ucs(nome, cfg_uc, dados, rel, ucs_meta):
    """Marca cada ocorrência com a UC mais próxima (até raio_m) e descarta a coordenada.
    Se o arquivo de UCs faltar ou falhar, segue sem o cruzamento (aviso), nunca publica coordenada."""
    from etl import ucs as U
    try:
        lista, arvore = U.carregar(RAIZ / cfg_uc["arquivo"])
        cont = U.classificar(dados, lista, arvore, cfg_uc.get("raio_m", 1000))
        ucs_meta[:] = U.tabela_meta(lista)
        if cont["sem_coordenada"]:
            sem = [r.get("_linha") for r in dados if r.get("_sem_coord")]
            rel.aviso(nome, f"{cont['sem_coordenada']} ocorrência(s) sem coordenada válida: fora do cruzamento com UCs — {linhas_txt(sem)}")
    except Exception as e:  # noqa: BLE001 — o cruzamento é complementar
        rel.aviso(nome, f"cruzamento com unidades de conservação não feito: {e}")
    for r in dados:
        r.pop("latlon", None)
        r.pop("_sem_coord", None)
    return dados


def higienizar_motivo(texto) -> str:
    """Motivo da exclusão é texto livre: tira o que pode identificar alguém (telefone, CPF,
    matrícula, e-mail) e limita o tamanho."""
    import re
    t = re.sub(r"\s+", " ", str(texto)).strip()
    t = re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", "[e-mail]", t)
    t = re.sub(r"\d[\d .\-/]{4,}\d", "[nº]", t)  # 6+ dígitos seguidos (com ou sem separadores)
    return t if len(t) <= 120 else t[:117].rstrip() + "…"


def depurar(nome, dep, saida, cols, rel):
    """Depuração do SisGeO: só é válida a ocorrência com situação na lista de válidas,
    sem nada escrito em "Motivo da Exclusão" e — quando o contrato pede (SisGeO · Chuvas) —
    com condição climática na lista de válidas (ex.: "Tempo Chuvoso"; vazia não exclui).
    As demais continuam publicadas (para a aba Depuração) com "depuracao" = critérios que
    excluíram, unidos por "+" (situacao | motivo | clima | situacao+clima …). O texto do
    motivo sai em "motivo", higienizado (sem sequências longas de números nem e-mails,
    no máximo 120 caracteres)."""
    validas = {N.chave(s) for s in dep["situacoes_validas"]}
    climas = {N.chave(s) for s in dep.get("condicoes_validas", [])}
    usa_sit = "situacao" in cols
    usa_clima = bool(climas) and "condicao_climatica" in cols
    tipos_livres = {N.chave(t) for t in dep.get("clima_nao_se_aplica_aos_tipos", [])}
    # subtipos sem relação com chuva (ex.: retirada de anel): saem sempre, com qualquer clima ou alerta
    subtipos_fora = {N.chave(t) for t in dep.get("subtipos_sem_relacao", [])}
    if not usa_sit:
        rel.aviso(nome, "coluna de situação ausente: depuração por situação não aplicada")
    if climas and not usa_clima:
        rel.aviso(nome, "coluna de condição climática ausente: depuração por condição climática não aplicada")
    # motivo começando com o prefixo de revisão (ex.: "REVISAR: fogo no lixo?") NÃO exclui:
    # a ocorrência segue válida e a linha aparece na Qualidade dos dados até alguém decidir
    revisar = N.chave(dep.get("prefixo_revisar") or "")
    a_revisar = []
    for reg in saida:
        motivo = reg.pop("motivo_exclusao", None)
        if revisar and not N.vazio(motivo) and N.chave(motivo).startswith(revisar):
            a_revisar.append(reg.get("_linha"))
            motivo = None
        criterios = []
        if usa_sit and N.chave(reg.get("situacao") or "") not in validas:
            criterios.append("situacao")
        if not N.vazio(motivo):
            criterios.append("motivo")
            reg["motivo"] = higienizar_motivo(motivo)
        if (usa_clima and not N.vazio(reg.get("condicao_climatica")) and N.chave(reg["condicao_climatica"]) not in climas
                and N.chave(reg.get("tipo") or "") not in tipos_livres):
            criterios.append("clima")
        if subtipos_fora and N.chave(reg.get("subtipo") or "") in subtipos_fora:
            criterios.append("subtipo")
        if criterios:
            reg["depuracao"] = "+".join(criterios)
    if a_revisar:
        rel.aviso(nome, f"{len(a_revisar)} ocorrência(s) marcadas para revisar no Motivo da Exclusão "
                        f"(\"{dep['prefixo_revisar']}…\"; ainda contam como válidas) — {linhas_txt(a_revisar, 200)}")
    chaves = ("validas", "situacao", "motivo") + (("clima",) if climas else ()) + (("subtipo",) if subtipos_fora else ()) + ("ambos",)
    rel.depuracao[nome] = contar_depuracao(saida, chaves)


def contar_depuracao(regs, chaves) -> dict:
    cont = Counter()
    for reg in regs:
        crit = [c for c in (reg.get("depuracao") or "").split("+") if c]
        cont["validas" if not crit else (crit[0] if len(crit) == 1 else "ambos")] += 1
    return {k: cont.get(k, 0) for k in chaves}


def clima_com_alerta(nome, regra, resultados, ref, rel):
    """Condição climática diferente da válida (ex.: Tempo seco) volta a contar quando houve alerta
    (os tipos do contrato: IDAP / Cell Broadcast / acionamento de sirene) para o município ou para a região dele no dia da ocorrência ou na véspera:
    cobre ventania/vendaval e solo encharcado depois da chuva. Alerta que cita municípios vale para
    eles; alerta só por região (REDEC) vale para a região; IDAP "todos, exceto…" vale para o estado."""
    import re
    from datetime import date, timedelta
    tipos = set(regra.get("tipos", ["idap", "cb"]))
    dias = int(regra.get("dias_antes", 1))
    por_mun, por_redec, estado = set(), set(), set()
    for a in resultados.get(regra["conjunto"], []):
        if a.get("tipo") not in tipos or not a.get("data") or not a.get("envios"):
            continue
        if a.get("municipios"):
            por_mun.update((a["data"], c) for c in a["municipios"])
        elif a.get("redecs"):
            por_redec.update((a["data"], r) for r in a["redecs"])
        elif a["tipo"] == "idap" and re.search(r"(?i)\bexceto\b", a.get("texto") or ""):
            estado.add(a["data"])
    regs = resultados.get(nome, [])
    revistas = 0
    for reg in regs:
        crit = (reg.get("depuracao") or "").split("+")
        if "clima" not in crit or not reg.get("data_ocorrencia"):
            continue
        cod = reg.get("cod_ibge")
        redec = ref.redec_do_municipio(cod) if cod else reg.get("redec")
        d0 = date.fromisoformat(reg["data_ocorrencia"][:10])
        for k in range(dias + 1):
            d = (d0 - timedelta(days=k)).isoformat()
            if (d, cod) in por_mun or (d, redec) in por_redec or d in estado:
                crit.remove("clima")
                if crit:
                    reg["depuracao"] = "+".join(crit)
                else:
                    reg.pop("depuracao")
                revistas += 1
                break
    if nome in rel.depuracao:
        rel.depuracao[nome] = contar_depuracao(regs, tuple(rel.depuracao[nome]))
    rel.clima_com_alerta[nome] = revistas


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
    linhas_inv = defaultdict(list)
    linhas_redec = []
    redec_preenchida = 0
    excluidos = 0
    saida, sem_mun = [], []
    fora_rj = []  # ocorrências atendidas fora do estado (necessidade pontual): aviso próprio na Qualidade

    for i, bruta in enumerate(linhas_brutas[h + 1:]):
        linha_planilha = h + 2 + i
        if all(N.vazio(c) for c in bruta):
            continue
        reg = {"_linha": linha_planilha}  # nº da linha na planilha: só para os avisos, não é publicado
        erros_linha = {}
        for campo, j in cols.items():
            v = bruta[j] if j < len(bruta) else ""
            t = tipos.get(campo, "texto")
            try:
                if t == "municipio":
                    reg[campo], reg["cod_ibge"] = ref.municipio(v)
                elif t == "nome_municipio":
                    # só exibição (ex.: estação de temperatura): distrito vira o município; desconhecido fica como veio
                    try:
                        reg[campo] = ref.municipio(v)[0]
                    except ValueError:
                        reg[campo] = CONVERSORES["texto"](v)
                elif t == "redec":
                    reg[campo] = ref.redec(v)
                elif t == "latlon":
                    reg[campo] = N.latlon(v, spec.get("casas_decimais_coord", 3))
                else:
                    reg[campo] = CONVERSORES[t](v)
                    if t in ("data", "datahora") and reg[campo] and campo not in spec.get("datas_livres", []):
                        dia = reg[campo][:10]
                        minima = spec.get("data_minima", limites["data_minima"])
                        if dia < minima or dia > hoje:
                            raise ValueError(f"data fora do período ({minima} a hoje): {v!r}")
            except ValueError as e:
                reg[campo] = None
                if t == "municipio":
                    reg["cod_ibge"] = None
                erros_linha[campo] = str(e)

        # município de fora do RJ + coordenada fora do RJ = atendimento fora do estado (não é erro de digitação)
        c_mun = next((c for c in erros_linha if tipos.get(c) == "municipio"), None)
        c_ll = next((c for c in erros_linha if tipos.get(c) == "latlon"), None)
        if c_mun and c_ll and "desconhecido" in erros_linha[c_mun] and "fora do RJ" in erros_linha[c_ll]:
            mun_txt = bruta[cols[c_mun]] if cols[c_mun] < len(bruta) else ""
            fora_rj.append(f"linha {linha_planilha}: {str(mun_txt).strip()}")
            del erros_linha[c_mun], erros_linha[c_ll]
        for campo, msg in erros_linha.items():
            invalidos[campo] += 1
            linhas_inv[campo].append(linha_planilha)
            if len(exemplos[campo]) < 3:
                exemplos[campo].append(f"linha {linha_planilha}: {msg}")

        # REDEC vazia ou inválida, mas município conhecido -> completa pela referência
        if "redec" in spec["colunas"] and reg.get("cod_ibge"):
            oficial = ref.redec_do_municipio(reg["cod_ibge"])
            if reg.get("redec") is None:
                reg["redec"] = oficial
                redec_preenchida += 1
                linhas_redec.append(linha_planilha)
            elif reg["redec"] != oficial:
                rel.aviso(nome, f"linha {linha_planilha}: {reg['municipio']} marcado como "
                                f"{reg['redec']}, referência diz {oficial}")

        # exclusão declarada no contrato (ex.: fogo em vegetação sai do SisGeO de chuvas)
        if any(N.chave(reg.get(c) or "") in {N.chave(v) for v in vals} for c, vals in spec.get("excluir", {}).items()):
            excluidos += 1
            continue
        mun_bruto = bruta[cols["municipio"]] if "municipio" in cols and cols["municipio"] < len(bruta) else ""
        if spec.get("separar_sem_municipio") and N.vazio(mun_bruto) and reg.get("redec") is None:
            sem_mun.append({k: reg.get(k) for k in ("data", "hora", "descricao")})
            continue
        saida.append(reg)

    if fora_rj:
        rel.aviso(nome, f"{len(fora_rj)} ocorrência(s) FORA DO RJ (atendimento fora do estado; entram nos totais sem município) — "
                        + "; ".join(fora_rj[:10]) + (" …" if len(fora_rj) > 10 else ""))
    total = len(saida) or 1
    for campo, n in invalidos.items():
        t = tipos.get(campo, "texto")
        pct = 100 * n / total
        msg = (f"{n} valor(es) inválido(s) em '{campo}' ({pct:.1f}%) — " + "; ".join(exemplos[campo])
               + (f" — todas: {linhas_txt(linhas_inv[campo])}" if n > len(exemplos[campo]) else ""))
        limite = {"data": limites["pct_max_datas_invalidas"], "datahora": limites["pct_max_datas_invalidas"],
                  "municipio": limites["pct_max_municipios_desconhecidos"]}.get(t)
        if limite is not None and pct > limite:
            rel.erro(nome, msg + f" — acima do limite de {limite}%")
        else:
            rel.aviso(nome, msg)
    if redec_preenchida:
        rel.aviso(nome, f"{redec_preenchida} linha(s) sem REDEC: completadas pela tabela de referência — {linhas_txt(linhas_redec)}")
    # mesma ocorrência colada duas vezes: identidade = campos de "chave_unica"
    # (no SisGeO: número do evento + número da ocorrência)
    chave = spec.get("chave_unica")
    if chave:
        vistos, unicos, pares = {}, [], []
        for reg in saida:
            k = tuple(reg.get(c) for c in chave)
            if all(x is None for x in k) or k not in vistos:
                vistos[k] = reg["_linha"]
                unicos.append(reg)
            else:
                pares.append(f"linha {reg['_linha']} repete a linha {vistos[k]}")
        if len(unicos) < len(saida):
            rel.aviso(nome, f"{len(saida) - len(unicos)} linha(s) repetida(s) (mesmo {' + '.join(chave)}) removida(s) — "
                            + "; ".join(pares[:30]) + (" …" if len(pares) > 30 else ""))
        saida = unicos
    rel.excluidos[nome] = excluidos
    if spec.get("depuracao"):
        depurar(nome, spec["depuracao"], saida, cols, rel)
    if len(saida) < spec.get("min_linhas", 0):
        rel.erro(nome, f"apenas {len(saida)} linha(s); mínimo exigido {spec['min_linhas']}")
    return saida, sem_mun


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--fonte", choices=["appsscript", "google", "xlsx", "texto"], required=True)
    ap.add_argument("--origem", default="", help="URL do Apps Script, ID da planilha ou caminho do arquivo (planilha principal)")
    ap.add_argument("--origem-fogo", default="", help="caminho do arquivo da planilha de fogo (modos texto/xlsx)")
    ap.add_argument("--origem-historico", default="", help="caminho do arquivo da planilha de histórico de danos humanos (modos texto/xlsx)")
    ap.add_argument("--saida", default=str(RAIZ / "site" / "data"))
    ap.add_argument("--config", default=str(RAIZ / "config" / "fontes.yml"))
    a = ap.parse_args(argv)

    cfg = yaml.safe_load(Path(a.config).read_text(encoding="utf-8"))
    conjuntos = cfg["conjuntos"]
    ref = N.Referencia()
    rel = Relatorio()

    # Cada conjunto diz de qual planilha vem ("planilha:", padrão "principal").
    # Abas de planilhas diferentes nunca se misturam, mesmo com nomes iguais.
    planilhas = cfg.get("planilhas", {"principal": {}})
    origens_locais = {"principal": a.origem, "fogo": a.origem_fogo, "historico": a.origem_historico}
    abas_por_planilha = {}
    for pid, pcfg in planilhas.items():
        pedidas = [n for c in conjuntos.values() if c.get("planilha", "principal") == pid for n in nomes_aba(c)]
        if not pedidas:
            continue
        if a.fonte in ("texto", "xlsx"):
            origem = origens_locais.get(pid, "")
            if not origem:
                rel.aviso(pid, f"planilha '{pid}' não informada nesta execução local; conjuntos dela ficam vazios")
                abas_por_planilha[pid] = {}
                continue
        else:
            origem = a.origem
        try:
            abas_por_planilha[pid] = fonte.ler(a.fonte, origem, pedidas, pcfg.get("id"),
                                               exigir_confirmacao=(pid != "principal"))
        except SystemExit as e:
            if pid == "principal":
                raise
            # planilha secundária fora do ar: os painéis dela avisam, o resto publica
            rel.aviso(pid, f"planilha '{pcfg.get('titulo', pid)}' não pôde ser lida: {e}")
            abas_por_planilha[pid] = {}

    resultados, meta_conj = {}, {}
    ucs_meta = []
    for nome, spec in conjuntos.items():
        abas = abas_por_planilha.get(spec.get("planilha", "principal"), {})
        spec["aba"] = next((n for n in nomes_aba(spec) if n in abas), nomes_aba(spec)[0])
        if spec["aba"] not in abas:
            (rel.erro if spec.get("min_linhas", 0) > 0 else rel.aviso)(nome, f"aba '{spec['aba']}' não encontrada")
            dados, extra = [], []
        else:
            dados, extra = processar(nome, spec, abas[spec["aba"]], ref, rel, cfg["limites"])
        if spec.get("interpretar") == "alertas":
            from etl import alertas as A
            dados = A.estruturar(dados, ref, lambda m, n=nome: rel.aviso(n, m))
        if spec.get("proximidade_uc"):
            dados = cruzar_ucs(nome, spec["proximidade_uc"], dados, rel, ucs_meta)
        if spec.get("compactar"):
            # município e REDEC são recompostos no navegador a partir do código IBGE
            dados = [{k: v for k, v in r.items() if k not in ("municipio", "redec") or not r.get("cod_ibge")} for r in dados]
        for r in dados:
            r.pop("_linha", None)
        if spec.get("publicar", True):
            resultados[nome] = dados
            meta_conj[nome] = {"titulo": spec.get("titulo", nome), "aba": spec["aba"], "linhas": len(dados),
                               "planilha": planilhas.get(spec.get("planilha", "principal"), {}).get("titulo", ""),
                               "excluidos": rel.excluidos.get(nome, 0)}
            if nome in rel.depuracao:
                meta_conj[nome]["depuracao"] = rel.depuracao[nome]
        if spec.get("separar_sem_municipio"):
            alvo = spec["separar_sem_municipio"]
            resultados[alvo] = extra
            meta_conj[alvo] = {"titulo": "Boletins sem município (sirenes, Cell Broadcast)",
                               "aba": spec["aba"], "linhas": len(extra)}

    # depuração por condição climática x alertas (depois do laço: precisa das mensagens de alerta já interpretadas)
    for nome, spec in conjuntos.items():
        regra = (spec.get("depuracao") or {}).get("clima_com_alerta")
        if regra and nome in resultados:
            clima_com_alerta(nome, regra, resultados, ref, rel)
            if nome in meta_conj and nome in rel.depuracao:
                meta_conj[nome]["depuracao"] = rel.depuracao[nome]
                meta_conj[nome]["clima_com_alerta"] = rel.clima_com_alerta[nome]

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
    if ucs_meta:
        meta["ucs"] = ucs_meta

    # grava num diretório temporário e só troca no fim (escrita atômica)
    destino = Path(a.saida)
    tmp = Path(tempfile.mkdtemp(prefix="dados_", dir=destino.parent))
    for nome, dados in resultados.items():
        (tmp / f"{nome}.json").write_text(json.dumps(dados, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # impressão digital só dos dados (sem a hora): muda apenas se a planilha mudou
    import hashlib
    h = hashlib.sha256()
    for nome in sorted(resultados):
        h.update(nome.encode()); h.update((tmp / f"{nome}.json").read_bytes())
    (tmp / "versao.txt").write_text(h.hexdigest() + "\n", encoding="utf-8")
    meta["versao_dados"] = h.hexdigest()  # o navegador só recarrega os dados quando ela muda
    (tmp / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    if destino.exists():
        shutil.rmtree(destino)
    tmp.rename(destino)
    print(f"\nOK — {sum(len(v) for v in resultados.values())} registros em {len(resultados)} conjuntos -> {destino}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
