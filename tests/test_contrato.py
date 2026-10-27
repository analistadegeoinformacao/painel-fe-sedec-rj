"""Testes de contrato: garantem que o ETL bloqueia publicação quando a
planilha muda de forma perigosa, e que dados pessoais nunca saem."""
import json
import re
from pathlib import Path

from etl import build
from etl import normaliza as N

AMOSTRA = Path(__file__).parent / "fixtures" / "amostra.txt"


def rodar(tmp_path, origem=AMOSTRA):
    saida = tmp_path / "data"
    rc = build.main(["--fonte", "texto", "--origem", str(origem), "--saida", str(saida)])
    return rc, saida


def test_amostra_publica(tmp_path):
    rc, saida = rodar(tmp_path)
    assert rc == 0
    meta = json.loads((saida / "meta.json").read_text(encoding="utf-8"))
    assert meta["conjuntos"]["sisgeo"]["linhas"] > 0
    assert meta["conjuntos"]["eventos"]["linhas"] > 0
    assert len(meta["redecs"]) == 11


def test_sem_dados_pessoais(tmp_path):
    rc, saida = rodar(tmp_path)
    sis = json.loads((saida / "sisgeo.json").read_text(encoding="utf-8"))
    proibidos = {"efetivo", "endereco", "avaliacao_cenario", "atualizacao_cenario", "viatura"}
    assert not proibidos & set(sis[0])
    texto = (saida / "sisgeo.json").read_text(encoding="utf-8")
    assert not re.search(r"\(#?\d{5,7}\)", texto), "matrícula de militar vazou para o JSON"


def test_coluna_obrigatoria_renomeada_bloqueia(tmp_path):
    quebrada = tmp_path / "quebrada.txt"
    quebrada.write_text(AMOSTRA.read_text(encoding="utf-8").replace("Data Ocorrência", "Dt Ocorr"), encoding="utf-8")
    # existe uma versão boa publicada antes
    rc, saida = rodar(tmp_path)
    assert rc == 0
    antes = (saida / "sisgeo.json").read_text(encoding="utf-8")
    rc, _ = rodar(tmp_path, quebrada)
    assert rc == 1
    assert (saida / "sisgeo.json").read_text(encoding="utf-8") == antes, "versão boa foi sobrescrita"


def test_cabecalho_com_outra_grafia_nao_quebra(tmp_path):
    variante = tmp_path / "variante.txt"
    variante.write_text(AMOSTRA.read_text(encoding="utf-8").replace('"DESABRIGADOS\n(Nº)"', "Desabrigados (nº)"),
                        encoding="utf-8")
    rc, saida = rodar(tmp_path, variante)
    assert rc == 0
    ev = json.loads((saida / "eventos.json").read_text(encoding="utf-8"))
    assert "desabrigados" in ev[0]


def test_aba_apagada_bloqueia(tmp_path):
    sem_sisgeo = tmp_path / "sem.txt"
    txt = AMOSTRA.read_text(encoding="utf-8").replace("## Sheet name: SISGEO\n", "## Sheet name: SISGEO_velha\n")
    sem_sisgeo.write_text(txt, encoding="utf-8")
    rc, _ = rodar(tmp_path, sem_sisgeo)
    assert rc == 1


def test_data_fora_do_periodo_vira_aviso(tmp_path):
    txt = AMOSTRA.read_text(encoding="utf-8")
    linhas = txt.split("\n")
    i = next(n for n, l in enumerate(linhas) if l.startswith("## Sheet name: EVENTOS REDECS"))
    # troca o ano da primeira linha de dados com data por um ano errado
    for j in range(i + 2, len(linhas)):
        if "/2026" in linhas[j][:12]:
            linhas[j] = linhas[j].replace("/2026", "/2025", 1)
            break
    arq = tmp_path / "ano_errado.txt"
    arq.write_text("\n".join(linhas), encoding="utf-8")
    rc, saida = rodar(tmp_path, arq)
    assert rc == 0
    ev = json.loads((saida / "eventos.json").read_text(encoding="utf-8"))
    assert all(e["data"] is None or e["data"] >= "2025-10-01" for e in ev)
    meta = json.loads((saida / "meta.json").read_text(encoding="utf-8"))
    assert any("fora do período" in a for a in meta["avisos"]["eventos"])


def test_impressao_digital_so_muda_com_os_dados(tmp_path):
    rc, saida = rodar(tmp_path)
    v1 = (saida / "versao.txt").read_text()
    rc, saida = rodar(tmp_path)                       # mesma planilha, outra hora
    assert (saida / "versao.txt").read_text() == v1
    outra = tmp_path / "outra.txt"
    outra.write_text(AMOSTRA.read_text(encoding="utf-8").replace("Corte de Árvore", "Corte de Arvore", 1), encoding="utf-8")
    rc, saida = rodar(tmp_path, outra)
    assert (saida / "versao.txt").read_text() != v1


AMOSTRA_FOGO = Path(__file__).parent / "fixtures" / "amostra_fogo.txt"


def rodar_duas(tmp_path, fogo=AMOSTRA_FOGO):
    saida = tmp_path / "data"
    rc = build.main(["--fonte", "texto", "--origem", str(AMOSTRA), "--origem-fogo", str(fogo), "--saida", str(saida)])
    return rc, saida


def test_planilha_de_fogo_entra_no_seu_proprio_conjunto(tmp_path):
    rc, saida = rodar_duas(tmp_path)
    assert rc == 0
    meta = json.loads((saida / "meta.json").read_text(encoding="utf-8"))
    assert meta["conjuntos"]["fogo_sisgeo"]["planilha"] == "PLANILHA FOGO EM VEGETAÇÃO"
    assert meta["conjuntos"]["sisgeo"]["planilha"] == "NOVA BASE ANALISTAS (chuvas)"
    fv = json.loads((saida / "fogo_sisgeo.json").read_text(encoding="utf-8"))
    sis = json.loads((saida / "sisgeo.json").read_text(encoding="utf-8"))
    # nada da planilha de fogo vaza para o SisGeO de chuvas (amostra de fogo usa ocorrências C2099…)
    assert not any(str(r.get("ocorrencia", "")).startswith("C2099") for r in sis)
    assert all(str(r["ocorrencia"]).startswith("C2099") for r in fv)


def test_identidade_evento_mais_ocorrencia(tmp_path):
    rc, saida = rodar_duas(tmp_path)
    fv = json.loads((saida / "fogo_sisgeo.json").read_text(encoding="utf-8"))
    pares = [(r["id_evento"], r["ocorrencia"]) for r in fv]
    assert len(pares) == len(set(pares)), "linha repetida não foi removida"
    from collections import Counter
    por_evento = Counter(r["id_evento"] for r in fv)
    assert max(por_evento.values()) >= 2, "evento com apoio (duas ocorrências) foi perdido"
    meta = json.loads((saida / "meta.json").read_text(encoding="utf-8"))
    assert any("repetida" in a for a in meta["avisos"]["fogo_sisgeo"])


def test_fogo_compacto_sem_dados_pessoais(tmp_path):
    rc, saida = rodar_duas(tmp_path)
    fv = json.loads((saida / "fogo_sisgeo.json").read_text(encoding="utf-8"))
    assert "municipio" not in fv[0] and fv[0]["cod_ibge"]          # recomposto no navegador
    assert not {"efetivo", "endereco", "viatura"} & set(fv[0])


def test_sem_planilha_de_fogo_o_resto_publica(tmp_path):
    saida = tmp_path / "data"
    rc = build.main(["--fonte", "texto", "--origem", str(AMOSTRA), "--saida", str(saida)])
    assert rc == 0
    assert json.loads((saida / "fogo_sisgeo.json").read_text(encoding="utf-8")) == []
    assert json.loads((saida / "sisgeo.json").read_text(encoding="utf-8"))


def test_fogo_fica_fora_do_sisgeo_de_chuvas(tmp_path):
    txt = AMOSTRA.read_text(encoding="utf-8")
    # força uma linha de fogo dentro da aba SISGEO da planilha de chuvas
    linhas = txt.split("\n")
    i = next(n for n, l in enumerate(linhas) if l.startswith("## Sheet name: SISGEO")) + 2
    linhas[i] = linhas[i].replace("Corte de Árvore", "Fogo em Vegetação").replace("Salvamento de Pessoa", "Fogo em Vegetação")
    arq = tmp_path / "com_fogo.txt"
    arq.write_text("\n".join(linhas), encoding="utf-8")
    rc, saida = rodar(tmp_path, arq)
    sis = json.loads((saida / "sisgeo.json").read_text(encoding="utf-8"))
    meta = json.loads((saida / "meta.json").read_text(encoding="utf-8"))
    assert not any(r.get("tipo") == "Fogo em Vegetação" for r in sis)
    assert meta["conjuntos"]["sisgeo"]["excluidos"] >= 1


def test_nivel_de_resposta_de_cada_planilha(tmp_path):
    rc, saida = rodar_duas(tmp_path)
    assert json.loads((saida / "nivel_resposta.json").read_text(encoding="utf-8")) == [{"nivel": 1}]
    assert json.loads((saida / "fogo_nivel_resposta.json").read_text(encoding="utf-8")) == [{"nivel": 2}]


def test_depuracao_por_situacao_e_por_motivo(tmp_path):
    rc, saida = rodar_duas(tmp_path)
    assert rc == 0
    meta = json.loads((saida / "meta.json").read_text(encoding="utf-8"))
    dep = meta["conjuntos"]["sisgeo"]["depuracao"]
    # amostra: 1 falso aviso, 1 com motivo, 1 cancelada COM motivo; "atendida com prestação de serviço" é válida
    assert dep == {"validas": 36, "situacao": 1, "motivo": 1, "clima": 0, "subtipo": 0, "ambos": 1}
    sis = json.loads((saida / "sisgeo.json").read_text(encoding="utf-8"))
    validas = [r for r in sis if "depuracao" not in r]
    assert {r["situacao"] for r in validas} <= {"Encerrada com empenho de viatura", "Ocorrência atendida com prestação de serviço"}
    assert not any("motivo_exclusao" in r for r in sis), "coluna bruta do motivo não pode ser publicada"
    com_motivo = [r for r in sis if r.get("motivo")]
    assert len(com_motivo) == 2 and all("motivo" in r["depuracao"] for r in com_motivo)
    fv = meta["conjuntos"]["fogo_sisgeo"]["depuracao"]
    assert fv["motivo"] == 1 and fv["situacao"] >= 1


def test_motivo_higienizado():
    from etl.build import higienizar_motivo
    assert higienizar_motivo("Fogo no lixo") == "Fogo no lixo"
    assert "99876" not in higienizar_motivo("ligar p/ (21) 99876-5432 Sr. fulano")
    assert "@" not in higienizar_motivo("ver email a.b@x.com.br")
    assert "123.456.789" not in higienizar_motivo("CPF 123.456.789-00")
    assert len(higienizar_motivo("x" * 300)) == 118


def test_fogo_sem_coordenada_publicada_e_com_uc(tmp_path):
    rc, saida = rodar_duas(tmp_path)
    assert rc == 0
    fv = json.loads((saida / "fogo_sisgeo.json").read_text(encoding="utf-8"))
    assert not any("latlon" in r for r in fv), "coordenada do fogo não pode ser publicada"
    meta = json.loads((saida / "meta.json").read_text(encoding="utf-8"))
    assert len(meta["ucs"]) > 100
    assert all(r["uc_faixa"] in ("dentro", "500", "1000") for r in fv if "uc_faixa" in r)


def test_ocorrencia_fora_do_rj_vira_aviso_proprio(tmp_path):
    texto = (Path(__file__).parent / "fixtures" / "amostra_fogo.txt").read_text(encoding="utf-8")
    linhas = texto.split("\n")
    i = next(k for k, l in enumerate(linhas) if l.startswith("REDEC,IdEvento")) + 1
    import csv as _csv, io as _io
    r = next(_csv.reader([linhas[i]]))
    h = next(_csv.reader([linhas[i - 1]]))
    r += [""] * (len(h) - len(r))
    r[h.index("Município")] = "Guaratinguetá"
    r[h.index("Latitude/Longitude")] = "-22.8182,-45.1822"
    out = _io.StringIO(); _csv.writer(out, lineterminator="").writerow(r); linhas[i] = out.getvalue()
    fogo = tmp_path / "fogo.txt"; fogo.write_text("\n".join(linhas), encoding="utf-8")
    saida = tmp_path / "data"
    assert build.main(["--fonte", "texto", "--origem", str(AMOSTRA), "--origem-fogo", str(fogo), "--saida", str(saida)]) == 0
    meta = json.loads((saida / "meta.json").read_text(encoding="utf-8"))
    av = meta["avisos"]["fogo_sisgeo"]
    assert any("FORA DO RJ" in a and "Guaratinguetá" in a for a in av)
    assert not any("-45.18" in a for a in av), "coordenada não pode aparecer no aviso"
    assert not any("município desconhecido" in a for a in av)


def test_avisos_trazem_numero_da_linha_e_linha_nao_e_publicada(tmp_path):
    rc, saida = rodar_duas(tmp_path)
    meta = json.loads((saida / "meta.json").read_text(encoding="utf-8"))
    rep = [a for a in meta["avisos"]["fogo_sisgeo"] if "repetida" in a]
    assert rep and re.search(r"linha \d+ repete a linha \d+", rep[0])
    for f in saida.glob("*.json"):
        assert '"_linha"' not in f.read_text(encoding="utf-8"), f.name


def test_colunas_em_outra_ordem_e_posicao_no_lugar_de_latlon(tmp_path):
    """Download colado direto: colunas em outra ordem e 'Posição' no lugar de 'Latitude/Longitude'."""
    import csv as _csv, io as _io
    texto = (Path(__file__).parent / "fixtures" / "amostra_fogo.txt").read_text(encoding="utf-8")
    partes = texto.split("## Sheet name: ")
    k = next(i for i, p in enumerate(partes) if p.startswith("SISGEO_FV\n"))
    cab, corpo = partes[k].split("\n", 1)
    linhas = list(_csv.reader(_io.StringIO(corpo)))
    h = linhas[0]
    largura = len(h)
    linhas = [r + [""] * (largura - len(r)) for r in linhas]
    ordem = list(reversed(range(largura)))
    linhas = [[r[i] for i in ordem] for r in linhas]
    linhas[0] = ["Posição" if c == "Latitude/Longitude" else c for c in linhas[0]]
    out = _io.StringIO(); _csv.writer(out, lineterminator="\n").writerows(linhas)
    partes[k] = cab + "\n" + out.getvalue()
    fogo = tmp_path / "fogo.txt"; fogo.write_text("## Sheet name: ".join(partes), encoding="utf-8")
    ref_saida = tmp_path / "ref"
    assert build.main(["--fonte", "texto", "--origem", str(AMOSTRA), "--origem-fogo",
                       str(Path(__file__).parent / "fixtures" / "amostra_fogo.txt"), "--saida", str(ref_saida)]) == 0
    saida = tmp_path / "data"
    assert build.main(["--fonte", "texto", "--origem", str(AMOSTRA), "--origem-fogo", str(fogo), "--saida", str(saida)]) == 0
    a = (ref_saida / "fogo_sisgeo.json").read_text(encoding="utf-8")
    b = (saida / "fogo_sisgeo.json").read_text(encoding="utf-8")
    assert a == b, "mesma planilha em outra ordem deve gerar exatamente os mesmos dados"


def test_aba_renomeada_para_sisgeo_chuvas(tmp_path):
    texto = AMOSTRA.read_text(encoding="utf-8").replace("## Sheet name: SISGEO\n", "## Sheet name: SISGEO_CHUVAS\n")
    origem = tmp_path / "base.txt"; origem.write_text(texto, encoding="utf-8")
    rc, saida = rodar(tmp_path, origem)
    assert rc == 0
    meta = json.loads((saida / "meta.json").read_text(encoding="utf-8"))
    assert meta["conjuntos"]["sisgeo"]["aba"] == "SISGEO_CHUVAS" and meta["conjuntos"]["sisgeo"]["linhas"] > 0


def test_chuvas_condicao_climatica_tempo_chuvoso(tmp_path):
    """SisGeO · Chuvas: condição climática preenchida e diferente de 'Tempo Chuvoso' sai da contagem;
    vazia não exclui (registros antigos sem a informação)."""
    import csv as _csv, io as _io
    partes = AMOSTRA.read_text(encoding="utf-8").split("## Sheet name: ")
    k = next(i for i, p in enumerate(partes) if p.startswith("SISGEO\n"))
    nome, corpo = partes[k].split("\n", 1)
    linhas = list(_csv.reader(_io.StringIO(corpo)))
    linhas = [l for l in linhas if l]
    linhas[0].append("Condição climática")
    valores = ["Tempo Chuvoso", "Tempo seco", "", "tempo chuvoso", "Nublado"]
    for i, l in enumerate(linhas[1:]):
        l.append(valores[i % len(valores)])
    out = _io.StringIO(); _csv.writer(out, lineterminator="\n").writerows(linhas)
    partes[k] = nome + "\n" + out.getvalue()
    origem = tmp_path / "base.txt"; origem.write_text("## Sheet name: ".join(partes), encoding="utf-8")
    rc, saida = rodar(tmp_path, origem)
    assert rc == 0
    sis = json.loads((saida / "sisgeo.json").read_text(encoding="utf-8"))
    validas = [r for r in sis if "depuracao" not in r]
    assert all(N.chave(r.get("condicao_climatica") or "TEMPO CHUVOSO") == "TEMPO CHUVOSO" for r in validas)
    assert any(r.get("condicao_climatica") is None for r in validas), "vazia não exclui"
    clima = [r for r in sis if "clima" in r.get("depuracao", "")]
    assert clima and {r["condicao_climatica"] for r in clima} <= {"Tempo seco", "Nublado"}
    meta = json.loads((saida / "meta.json").read_text(encoding="utf-8"))
    assert meta["conjuntos"]["sisgeo"]["depuracao"]["clima"] > 0


def test_tempo_seco_volta_a_contar_com_alerta_no_dia_ou_na_vespera():
    """Tempo seco com alerta IDAP/CB para o município (ou só para a região dele) no dia ou na véspera
    é válida; sem alerta, ou alerta de sirene, ou alerta de 2 dias antes, continua excluída."""
    ref = N.Referencia()
    _, rio = ref.municipio("Rio de Janeiro")
    _, petro = ref.municipio("Petrópolis")
    _, campos = ref.municipio("Campos dos Goytacazes")
    redec_petro = ref.redec_do_municipio(petro)
    seco = lambda d, cod, dep="clima": {"data_ocorrencia": d + "T10:00", "cod_ibge": cod, "condicao_climatica": "Tempo seco", "depuracao": dep}
    regs = [seco("2026-10-10", rio), seco("2026-10-11", rio), seco("2026-10-12", rio),   # alerta dia 10
            seco("2026-10-10", petro),                                                  # alerta só por região
            seco("2026-10-10", campos),                                                 # só sirene
            seco("2026-10-11", rio, "situacao+clima")]
    alertas = [{"tipo": "idap", "data": "2026-10-10", "envios": 1, "municipios": [rio], "redecs": []},
               {"tipo": "cb", "data": "2026-10-10", "envios": 2, "municipios": [], "redecs": [redec_petro]},
               {"tipo": "sirene", "data": "2026-10-10", "envios": 1, "municipios": [campos], "redecs": []}]
    rel = build.Relatorio()
    rel.depuracao["sisgeo"] = {"validas": 0, "situacao": 0, "motivo": 0, "clima": 5, "ambos": 1}
    build.clima_com_alerta("sisgeo", {"conjunto": "alertas_msg", "tipos": ["idap", "cb"], "dias_antes": 1},
                           {"sisgeo": regs, "alertas_msg": alertas}, ref, rel)
    assert [r.get("depuracao") for r in regs] == [None, None, "clima", None, "clima", "situacao"]
    assert rel.depuracao["sisgeo"] == {"validas": 3, "situacao": 1, "motivo": 0, "clima": 2, "ambos": 0}
    assert rel.clima_com_alerta["sisgeo"] == 4


def test_bairros_do_rio_viram_rio_de_janeiro():
    ref = N.Referencia()
    for v in ("Bandeirante", "Recreio dos Bandeirantes", "Jpa", "Jacarepaguá"):
        assert ref.municipio(v)[0] == ref.municipio("Rio de Janeiro")[0]


def test_depuracao_tipos_sem_clima_e_motivo_sempre_exclui():
    """Inundação/Alagamento e Deslizamento/Desabamento contam com qualquer condição climática;
    Motivo da Exclusão preenchido exclui sempre, mesmo com Tempo Chuvoso ou tipo isento."""
    dep = {"situacoes_validas": ["Encerrada com empenho de viatura"], "condicoes_validas": ["Tempo Chuvoso"],
           "clima_nao_se_aplica_aos_tipos": ["Inundação/Alagamento", "Deslizamento/Desabamento"]}
    base = {"situacao": "Encerrada com empenho de viatura"}
    regs = [{**base, "tipo": "Inundação/Alagamento", "condicao_climatica": "Tempo seco"},
            {**base, "tipo": "DESLIZAMENTO/DESABAMENTO", "condicao_climatica": "Tempo seco"},
            {**base, "tipo": "Corte de Árvore", "condicao_climatica": "Tempo seco"},
            {**base, "tipo": "Corte de Árvore", "condicao_climatica": "Tempo Chuvoso", "motivo_exclusao": "Árvore podada"},
            {**base, "tipo": "Inundação/Alagamento", "condicao_climatica": "Tempo seco", "motivo_exclusao": "vazamento"}]
    rel = build.Relatorio()
    build.depurar("sisgeo", dep, regs, {"situacao": 0, "condicao_climatica": 1, "motivo_exclusao": 2}, rel)
    assert [r.get("depuracao") for r in regs] == [None, None, "clima", "motivo", "motivo"]


def test_motivo_revisar_nao_exclui_e_vai_para_a_qualidade():
    dep = {"situacoes_validas": ["Encerrada com empenho de viatura"], "prefixo_revisar": "REVISAR"}
    ok = {"situacao": "Encerrada com empenho de viatura"}
    regs = [{**ok, "_linha": 10, "motivo_exclusao": "REVISAR: fogo no lixo?"},
            {**ok, "_linha": 11, "motivo_exclusao": "Fogo no lixo"},
            {**ok, "_linha": 12, "motivo_exclusao": "revisar"}]
    rel = build.Relatorio()
    build.depurar("fogo_sisgeo", dep, regs, {"situacao": 0, "motivo_exclusao": 1}, rel)
    assert [r.get("depuracao") for r in regs] == [None, "motivo", None]
    assert "motivo" not in regs[0]
    aviso = rel.avisos["fogo_sisgeo"][0]
    assert "2 ocorrência(s) marcadas para revisar" in aviso and "linhas 10, 12" in aviso


def test_subtipo_sem_relacao_com_chuva_sai_sempre():
    dep = {"situacoes_validas": ["Encerrada com empenho de viatura"], "condicoes_validas": ["Tempo Chuvoso"],
           "subtipos_sem_relacao": ["Retirada de Anel, Adornos e Afins"]}
    ok = {"situacao": "Encerrada com empenho de viatura", "tipo": "Salvamento de Pessoa"}
    regs = [{**ok, "subtipo": "Retirada de Anel, Adornos e Afins", "condicao_climatica": "Tempo Chuvoso"},
            {**ok, "subtipo": "RETIRADA DE ANEL, ADORNOS E AFINS", "condicao_climatica": "Tempo seco"},
            {**ok, "subtipo": "Em Elevador", "condicao_climatica": "Tempo Chuvoso"}]
    rel = build.Relatorio()
    build.depurar("sisgeo", dep, regs, {"situacao": 0, "condicao_climatica": 1, "subtipo": 2}, rel)
    assert [r.get("depuracao") for r in regs] == ["subtipo", "clima+subtipo", None]
    # o alerta só devolve a condição climática: o subtipo continua excluindo
    build.clima_com_alerta("sisgeo", {"conjunto": "a", "tipos": ["idap"], "dias_antes": 1},
                           {"sisgeo": [dict(regs[1], data_ocorrencia="2026-10-10T10:00", cod_ibge="3304557")],
                            "a": [{"tipo": "idap", "data": "2026-10-10", "envios": 1, "municipios": ["3304557"], "redecs": []}]},
                           N.Referencia(), rel)
    assert rel.depuracao["sisgeo"]["subtipo"] == 1


# ------------------------------------------------- histórico de danos humanos
AMOSTRA_HIST = Path(__file__).parent / "fixtures" / "amostra_historico.txt"


def rodar_historico(tmp_path, hist=AMOSTRA_HIST):
    saida = tmp_path / "data"
    args = ["--fonte", "texto", "--origem", str(AMOSTRA), "--saida", str(saida)]
    if hist:
        args += ["--origem-historico", str(hist)]
    return build.main(args), saida


def test_historico_de_danos_vira_conjunto_proprio(tmp_path):
    rc, saida = rodar_historico(tmp_path)
    assert rc == 0
    meta = json.loads((saida / "meta.json").read_text(encoding="utf-8"))
    assert meta["conjuntos"]["danos_historico"]["planilha"] == "Histórico de Danos Humanos FE-SEDEC-RJ"
    h = json.loads((saida / "danos_historico.json").read_text(encoding="utf-8"))
    assert len(h) == 21
    angra = [r for r in h if r["cod_ibge"] == "3300100" and r["data_ref"] == "2026-02-23"][0]
    assert (angra["obitos"], angra["desabrigados"], angra["desalojados"], angra["outros_afetados"]) == (3, 100, 300, 0)
    assert angra["tipo_registro"] == "RETRATO DIÁRIO" and angra["id_fonte"] == "F002"
    # compactado: município e REDEC voltam no navegador pelo código IBGE
    assert "municipio" not in angra and "redec" not in angra
    # o total não é publicado (o painel soma as quatro categorias) nem as observações
    assert not {"total_afetados", "obs"} & set(angra)
    # vazio continua vazio (não informado), zero continua zero
    campos = [r for r in h if r["cod_ibge"] == "3301009"][0]
    assert campos["outros_afetados"] is None and campos["obitos"] == 0


def test_sem_planilha_de_historico_publica_o_resto(tmp_path):
    rc, saida = rodar_historico(tmp_path, hist=None)
    assert rc == 0
    assert json.loads((saida / "danos_historico.json").read_text(encoding="utf-8")) == []
    meta = json.loads((saida / "meta.json").read_text(encoding="utf-8"))
    assert meta["conjuntos"]["danos_humanos"]["linhas"] > 0


def test_historico_sem_coluna_obrigatoria_bloqueia(tmp_path):
    quebrada = tmp_path / "hist.txt"
    quebrada.write_text(AMOSTRA_HIST.read_text(encoding="utf-8").replace("DATA_REF", "DATA"), encoding="utf-8")
    rc, _ = rodar_historico(tmp_path, quebrada)
    assert rc == 1
