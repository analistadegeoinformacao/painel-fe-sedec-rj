import pytest
from etl import normaliza as N

REF = N.Referencia()


@pytest.mark.parametrize("entrada,esperado", [
    ("01/01/2026", "2026-01-01"),
    ("1/2/2026 04:27", "2026-02-01"),
    ("02/03/26", "2026-03-02"),
    ("06/032026", "2026-03-06"),      # barra faltando (caso real)
    ("´08/04/2026", "2026-04-08"),    # acento colado (caso real)
    ("", None), ("#N/A", None), ("null", None),
])
def test_data(entrada, esperado):
    assert N.data(entrada) == esperado


def test_data_ilegivel():
    with pytest.raises(ValueError):
        N.data("ontem")


@pytest.mark.parametrize("entrada,esperado", [("21:10", "21:10"), ("16h", "16:00"), ("8h30", "08:30"), ("14;53", "14:53"), ("", None)])
def test_hora(entrada, esperado):
    assert N.hora(entrada) == esperado


@pytest.mark.parametrize("entrada,esperado", [("13.695", 13695), ("0", 0), ("", None), ("12,0", 12)])
def test_inteiro(entrada, esperado):
    assert N.inteiro(entrada) == esperado


def test_inteiro_rejeita_data_formatada():
    # Sheets às vezes formata 0 como data (caso real na aba SISGEO)
    with pytest.raises(ValueError):
        N.inteiro("30/12/1899 00:00")


def test_decimal_reais():
    assert N.decimal("R$ 2.625.000,00") == 2625000.0
    assert N.decimal("0,0") == 0.0


def test_cabecalho_tolerante():
    assert N.chave("DESABRIGADOS\n(Nº)") == N.chave("Desabrigados (nº)")
    assert N.chave("INUNDAÇÃO / ALAGAMENTO") == N.chave("inundacao/alagamento")


@pytest.mark.parametrize("entrada", ["Rio de Janeiro", "RIO DE JANEIRO - RJ", "rio de janeiro"])
def test_municipio(entrada):
    assert REF.municipio(entrada) == ("RIO DE JANEIRO - RJ", "3304557")


def test_distrito_vira_municipio():
    assert REF.municipio("Itaipava")[0] == "PETRÓPOLIS - RJ"


def test_municipio_desconhecido():
    with pytest.raises(ValueError):
        REF.municipio("Gotham")


@pytest.mark.parametrize("entrada", ["REDEC 6 – Sul II", "REDEC 6 - SUL II", "redec 6"])
def test_redec(entrada):
    assert REF.redec(entrada) == "REDEC 6 - SUL II"


def test_referencia_completa():
    assert len(REF.linhas) == 92
    assert len(REF.redecs) == 11
    assert all(r["cod_ibge"].startswith("33") for r in REF.linhas)


def test_latlon_arredonda_e_valida():
    assert N.latlon("-22.94693,-43.20291") == [-22.947, -43.203]
    with pytest.raises(ValueError):
        N.latlon("-3.1,-60.0")  # fora do RJ


def test_sao_francisco_do_itabapoana_digitado_errado():
    ref = N.Referencia()
    assert ref.municipio("São Francisco do Itabapoana") == ref.municipio("São Francisco de Itabapoana")


def test_itaipava_e_petropolis():
    ref = N.Referencia()
    assert ref.municipio("Itaipava") == ref.municipio("Petrópolis")
    assert ref.municipio("ITAIPAVA - RJ") == ref.municipio("Petrópolis")


def test_data_no_formato_de_sistema():
    assert N.datahora("2026-10-18 08:03:00") == "2026-10-18T08:03"
    assert N.data("2026-10-18") == "2026-10-18"
    assert N.datahora("18/10/2026 08:03") == "2026-10-18T08:03"
