from datetime import datetime, timedelta, timezone

from etl.site_travado import travado

AGORA = datetime(2026, 11, 5, 21, 0, tzinfo=timezone.utc)
HA = lambda m: (AGORA - timedelta(minutes=m)).isoformat()


def test_site_recente_nao_esta_travado():
    assert not travado(HA(5), AGORA)[0]
    assert not travado(HA(29), AGORA)[0]


def test_site_parado_ha_30_min_ou_mais_esta_travado():
    esta, motivo = travado(HA(30), AGORA)
    assert esta and "30 min" in motivo
    assert travado(HA(700), AGORA)[0]


def test_sem_leitura_do_site_nao_afirma_travamento():
    assert not travado(None, AGORA)[0]
    assert not travado("não é data", AGORA)[0]


def test_limite_configuravel():
    assert travado(HA(12), AGORA, limite_min=10)[0]
