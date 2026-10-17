from datetime import datetime, timedelta, timezone

from etl.precisa_publicar import decidir

AGORA = datetime(2026, 10, 17, 12, 0, tzinfo=timezone.utc)
HA = lambda m: (AGORA - timedelta(minutes=m)).isoformat()


def test_push_e_botao_sempre_publicam():
    assert decidir("push", "a", "a", HA(1), AGORA)[0]
    assert decidir("workflow_dispatch", "a", "a", HA(1), AGORA)[0]


def test_agendado_dados_mudaram():
    assert decidir("schedule", "novo", "velho", HA(5), AGORA)[0]


def test_agendado_sem_mudanca_nao_publica():
    publicar, motivo = decidir("schedule", "a", "a", HA(20), AGORA)
    assert not publicar and "iguais" in motivo


def test_agendado_sinal_de_vida_a_cada_hora():
    assert decidir("schedule", "a", "a", HA(61), AGORA)[0]


def test_site_inacessivel_publica():
    assert decidir("schedule", "a", None, None, AGORA)[0]
