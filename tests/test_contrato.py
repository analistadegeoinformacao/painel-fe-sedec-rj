"""Testes de contrato: garantem que o ETL bloqueia publicação quando a
planilha muda de forma perigosa, e que dados pessoais nunca saem."""
import json
import re
from pathlib import Path

from etl import build

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
    assert dep == {"validas": 36, "situacao": 1, "motivo": 1, "ambos": 1}
    sis = json.loads((saida / "sisgeo.json").read_text(encoding="utf-8"))
    validas = [r for r in sis if "depuracao" not in r]
    assert {r["situacao"] for r in validas} <= {"Encerrada com empenho de viatura", "Ocorrência atendida com prestação de serviço"}
    assert not any("motivo_exclusao" in r for r in sis), "coluna bruta do motivo não pode ser publicada"
    com_motivo = [r for r in sis if r.get("motivo")]
    assert len(com_motivo) == 2 and all(r["depuracao"] in ("motivo", "ambos") for r in com_motivo)
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
