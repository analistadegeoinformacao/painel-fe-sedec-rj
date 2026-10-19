"""Interpreta as mensagens de alerta coladas na aba ALERTAS-MENSAGENS (DATA | MENSAGEM).

Cada mensagem vira um registro:
  tipo      idap | cb | sirene
  envios    IDAP: nº de alertas na mensagem ("1-Tipo", "2-Tipo"… ou blocos "Tipo:"/"Região:")
            Cell Broadcast: soma de "Município: N Alerta(s)", ou nº de "DCA … enviado", ou 1
            Sirenes: nº de acionamentos (município + horário) — "desligadas" não contam
  sirenes   (só sirene) total de sirenes/estações acionadas
  municipios / redecs   para os filtros do painel
  resumo    1 linha para a tabela; texto = mensagem completa
O que não for reconhecido continua publicado (tipo "outro") e vira aviso na Qualidade.
"""
from __future__ import annotations

import re

from etl import normaliza as N

_CAB = [("idap", r"^(📱\s*)?ALERTAS?\s+(VIA\s+)?IDAP"),
        ("cb", r"^(ENVIO\s+DE\s+)?DEFESA\s+CIVIL\s+ALERTA|^DCA\b|CELL\s*BROADCAST"),
        ("sirene", r"^SIRENES\s+MOBILIZADAS|^TOQUE\s+DE\s+AVISO")]
_REGIOES = [("Baixada Fluminense", 2), ("Baixada Litorânea", 9), ("Costa Verde", 4), ("Metropolitana", 3),
            ("Serrana II", 8), ("Serrana I", 7), ("Sul II", 6), ("Sul I", 5), ("Noroeste", 11), ("Norte", 10), ("Capital", 1)]


def _cabecalho(texto: str) -> str:
    for linha in texto.split("\n"):
        s = re.sub(r"[_*\s\xa0\"]+", " ", linha).strip()
        if not s or re.match(r"^(\[Encaminhada\] )?SEDEC-?R?J?$|^CEMADEN-RJ$", s, re.I):
            continue
        return s.upper()
    return ""


def tipo_da_mensagem(texto: str) -> str:
    c = _cabecalho(texto)
    for t, rx in _CAB:
        if re.search(rx, c):
            return t
    return "outro"


_NOMES = None


def _achar_municipios(trecho, ref):
    """Códigos IBGE dos municípios do RJ citados no trecho (comparação sem acento/maiúscula)."""
    global _NOMES
    if _NOMES is None:
        pares = [(N.chave(re.sub(r"\s*-\s*RJ$", "", l["municipio"])), l["cod_ibge"]) for l in ref.linhas]
        # distritos que aparecem no lugar do município (ex.: Itaipava -> Petrópolis)
        for distrito, mun in N.DISTRITOS.items():
            try:
                pares.append((N.chave(distrito), ref.municipio(mun)[1]))
            except ValueError:
                pass
        _NOMES = sorted(pares, key=lambda t: -len(t[0]))
    k = " " + re.sub(r"[^A-Z0-9]+", " ", N.chave(trecho)) + " "
    achados = []
    for nome, cod in _NOMES:
        alvo = " " + re.sub(r"[^A-Z0-9]+", " ", nome) + " "
        if alvo in k and cod not in achados:
            achados.append(cod)
            k = k.replace(alvo, " ")  # "Rio de Janeiro" não conta de novo dentro de outro nome
    return achados


def _redecs_dos(cods, ref):
    return list(dict.fromkeys(r for c in cods if (r := ref.redec_do_municipio(c))))


def _municipios(nomes, ref):
    cods = []
    for n in nomes:
        try:
            _, cod = ref.municipio(n)
        except ValueError:
            cod = None
        if cod and cod not in cods:
            cods.append(cod)
    return cods


def _redecs_citadas(texto, ref):
    achadas = []
    for nome, num in _REGIOES:
        if re.search(rf"\b{re.escape(nome)}\b(?!\s*I)", texto, re.I):
            r = ref.redec(f"REDEC {num}")
            if r and r not in achadas:
                achadas.append(r)
    return achadas


def _idap(texto, ref):
    itens = re.findall(r"(?im)^\s*(?:\d+\s*[-–.)]\s*)?-?\s*Tipo\s*:\s*(.+)$", texto)
    if not itens:
        itens = re.findall(r"(?im)^\s*-?\s*Regi[aã]o\s*:\s*(.+)$", texto)
    if not itens:
        m = re.search(r"(?i)alerta\s+via\s+idap\s+(para .+)", texto)
        itens = [m.group(1)] if m else []
    envios = max(1, len(itens))
    alvo = " ".join(itens)
    if re.search(r"(?i)\bexceto\b", alvo):  # "todos, exceto …": vale para o estado inteiro
        cods, redecs = [], []
    else:
        redecs = _redecs_citadas(alvo, ref)
        cods = _achar_municipios(alvo, ref)
        for r in _redecs_dos(cods, ref):
            if r not in redecs:
                redecs.append(r)
    resumo = " | ".join(" ".join(i.split())[:160] for i in itens) or _cabecalho(texto).title()
    return {"envios": envios, "municipios": cods, "redecs": redecs, "resumo": resumo}


def _cb(texto, ref):
    pares = re.findall(r"(?im)^\s*([A-ZÀ-Ú][\wÀ-ú' ]+?)\s*:\s*0*(\d+)\s+Alertas?\b", texto)
    nomes = [n for n, _ in pares]
    if pares:
        envios = sum(int(q) for _, q in pares)
    else:
        enviados = re.findall(r"(?i)\bDCA\s+\w+\s+enviado\s+para\s+[^(\n]*\(([^)]+)\)", texto)
        if enviados:
            envios, nomes = len(enviados), enviados
        else:
            envios = 1
            m = re.search(r"(?is)Munic[ií]pios?\s*:\s*\n?\s*([^\n]+)", texto)
            nomes = [m.group(1).strip()] if m else []
    tipo = re.search(r"(?i)\b(severo|extremo)\b", texto)
    cat = re.search(r"(?im)^\s*Categoria\s*:\s*(.+)$", texto)
    sec = re.search(r"(?is)Munic[ií]pios?\s*:(.*?)(?:\n\s*(?:Pol[ií]gono|Descri[çc][aã]o|Mensagem|FONTE|Fonte)\b|$)", texto)
    cods = _achar_municipios(sec.group(1) if sec else " ".join(nomes), ref) or _municipios(nomes, ref)
    regioes = [] if cods else _redecs_citadas(sec.group(1) if sec else texto, ref)
    if not nomes and sec:
        nomes = [" ".join(sec.group(1).split()).rstrip(".")]
    resumo = ", ".join(dict.fromkeys(n.strip() for n in nomes)) or "—"
    if cat:
        resumo += f" · {cat.group(1).strip()}"
    if tipo:
        resumo += f" · {tipo.group(1).capitalize()}"
    return {"envios": envios, "municipios": cods, "redecs": _redecs_dos(cods, ref) or regioes, "resumo": resumo}


def _sirene(texto, ref):
    """Acionamentos = municípios citados nas seções de acionamento (toque de aviso / mobilização).
    Seções de "sirenes DESLIGADAS" não contam. Sirenes = soma de "N sirenes/estações" quando informado."""
    secoes, atual, modos, desligou = [], None, set(), False
    for linha in texto.split("\n"):
        L = linha.upper()
        if "TOQUE DE AVISO" in L or "MOBILIZ" in L:
            if "DESLIGAD" in L:
                atual, desligou = None, True
            else:
                modos.add("Mobilização" if "MOBILIZ" in L else "Toque de aviso de chuva")
                atual = []
                secoes.append(atual)
            continue
        if "DESLIGAD" in L:
            atual, desligou = None, True
            continue
        if re.match(r"\s*(FONTE|Fonte)\b", linha):
            atual = None
            continue
        if atual is not None:
            atual.append(linha)
    trecho = "\n".join("\n".join(x) for x in secoes)
    cods = _achar_municipios(trecho, ref)
    total = sum(int(n) for n in re.findall(r"(?i)\b0*(\d+)\s+(?:sirenes?|esta[çc](?:ões|ão|oes))", trecho))
    acion = len(cods) or (len(secoes) and 1)
    if not secoes and desligou:  # só desligamento: guarda os municípios para os filtros, sem contar acionamento
        cods = _achar_municipios(texto, ref)
    nomes = [] if acion == 0 else [titulo for c in cods for l in ref.linhas if l["cod_ibge"] == c for titulo in [re.sub(r"\s*-\s*RJ$", "", l["municipio"]).title()]]
    if modos:
        resumo = " / ".join(sorted(modos)) + ": " + (", ".join(nomes) or "—")
    else:
        locais = ", ".join(re.sub(r"\s*-\s*RJ$", "", l["municipio"]).title() for c in cods for l in ref.linhas if l["cod_ibge"] == c)
        resumo = ("Sirenes desligadas" + (f": {locais}" if locais else "")) if desligou else "—"
    return {"envios": acion, "sirenes": total, "municipios": cods, "redecs": _redecs_dos(cods, ref), "resumo": resumo}


def estruturar(registros: list[dict], ref, aviso) -> list[dict]:
    saida = []
    for r in registros:
        texto = (r.get("mensagem") or "").strip()
        if not texto:
            continue
        t = tipo_da_mensagem(texto)
        info = {"idap": _idap, "cb": _cb, "sirene": _sirene}.get(t, lambda *_: {"envios": 0, "municipios": [], "redecs": [], "resumo": "mensagem não reconhecida"})(texto, ref)
        if t == "outro":
            onde = f"linha {r['_linha']}: " if r.get("_linha") else ""
            aviso(f"{onde}mensagem de {r.get('data') or 'data ?'} não reconhecida como IDAP, Cell Broadcast ou sirene: \"{_cabecalho(texto)[:60]}\"")
        saida.append({"data": (r.get("data") or "")[:10] or None, "hora": (r.get("data") or "")[11:16] or None,
                      "tipo": t, **info, "texto": texto})
    return saida
