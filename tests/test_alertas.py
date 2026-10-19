"""Leitura das mensagens de alerta coladas do WhatsApp (etl/alertas.py)."""
from etl import alertas as A, normaliza as N

REF = N.Referencia()


def _um(texto):
    return A.estruturar([{"data": "2026-10-15T16:30", "mensagem": texto}], REF, lambda m: None)[0]


def test_idap_numerado_conta_cada_alerta():
    r = _um("📱 ALERTA IDAP\n\n1-Tipo: Chuvas Intensas para as regiões Costa Verde e Sul I.\n\n"
            "-Vigência: 16h25\n\n2-Tipo: Chuvas Intensas para as regiões Norte.\n")
    assert r["tipo"] == "idap" and r["envios"] == 2
    assert {"REDEC 4 - COSTA VERDE", "REDEC 5 - SUL I", "REDEC 10 - NORTE"} <= set(r["redecs"])
    assert "REDEC 6 - SUL II" not in r["redecs"]


def test_idap_estado_todo_fica_sem_local():
    r = _um("SEDEC-RJ\nCEMADEN-RJ\n\nALERTA VIA IDAP\n\n-Tipo: Chuvas para todos os municípios, exceto Sapucaia.")
    assert r["envios"] == 1 and r["redecs"] == [] and r["municipios"] == []


def test_cell_broadcast_soma_alertas_por_municipio():
    r = _um("SEDEC-RJ\nCEMADEN-RJ\n\nDEFESA CIVIL ALERTA (DCA/CBS)\n\nMunicípio:\nTeresópolis: 01 Alerta\nGuapimirim: 02 Alertas\n")
    assert r["tipo"] == "cb" and r["envios"] == 3 and len(r["municipios"]) == 2


def test_cell_broadcast_envio_unico_com_varios_municipios():
    r = _um("ENVIO DE DEFESA CIVIL ALERTA (CELLBROADCAST)\nTipo: SEVERO\nCategoria: Chuva\n\nMunicípio:\n"
            "Cordeiro, Cantagalo e Macuco\n\nPolígono de todos os municípios.\n")
    assert r["envios"] == 1 and len(r["municipios"]) == 3


def test_sirenes_contam_acionamento_e_ignoram_desligadas():
    r = _um("TOQUE DE AVISO DE CHUVA (13/10/2026 - 18h35)\n\nMunicípio:\nTeresópolis: 24 sirenes\nMagé: 10 estações\n\n"
            "TOQUE DE AVISO DE CHUVA - Sirenes DESLIGADAS (19h)\n\nMunicípio:\nDuque de Caxias: 18 estações\n\nFonte: CEMADEN-RJ")
    assert r["tipo"] == "sirene" and r["envios"] == 2 and r["sirenes"] == 34
    d = _um("TOQUE DE AVISO DE CHUVA - sirenes DESLIGADAS (19h)\n\nMunicípio:\nTeresópolis: 24 sirenes")
    assert d["envios"] == 0 and d["resumo"].startswith("Sirenes desligadas")


def test_mensagem_desconhecida_vira_aviso():
    avisos = []
    A.estruturar([{"data": "2026-10-15T10:00", "mensagem": "Bom dia a todos"}], REF, avisos.append)
    assert avisos


def test_itaipava_nas_mensagens_conta_como_petropolis():
    r = _um("TOQUE DE AVISO DE CHUVA (13/10/2026 - 18h35)\n\nMunicípio:\nItaipava: 3 sirenes\n\nFonte: CEMADEN-RJ")
    _, cod = REF.municipio("Petrópolis")
    assert r["municipios"] == [cod] and r["envios"] == 1
