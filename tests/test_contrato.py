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
