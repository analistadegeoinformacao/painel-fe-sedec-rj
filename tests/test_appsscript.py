"""Simula o App da Web do Apps Script: POST -> 302 -> GET com o JSON,
exatamente como o Google responde, sem precisar de rede."""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from etl import fonte

TOKEN = "abc123"
RESPOSTA = {}


class FalsoGoogle(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        corpo = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        global RESPOSTA
        if corpo.get("token") != TOKEN:
            RESPOSTA = {"erro": "não autorizado"}
        else:
            RESPOSTA = {"abas": {a: [["DATA", "REDEC"], ["01/02/2026", "REDEC 1 - CAPITAL"]] for a in corpo["abas"]}}
        self.send_response(302)
        self.send_header("Location", "/echo")
        self.end_headers()

    def do_GET(self):
        dados = json.dumps(RESPOSTA).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)


@pytest.fixture
def servidor():
    srv = HTTPServer(("127.0.0.1", 0), FalsoGoogle)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}/exec"
    srv.shutdown()


def test_le_abas_seguindo_redirecionamento(servidor, monkeypatch):
    monkeypatch.setenv("APPS_SCRIPT_TOKEN", TOKEN)
    abas = fonte.ler("appsscript", servidor, ["SISGEO", "ALERTAS"])
    assert set(abas) == {"SISGEO", "ALERTAS"}
    assert abas["SISGEO"][1] == ["01/02/2026", "REDEC 1 - CAPITAL"]


def test_token_errado_para_com_mensagem_clara(servidor, monkeypatch):
    monkeypatch.setenv("APPS_SCRIPT_TOKEN", "errado")
    with pytest.raises(SystemExit, match="APPS_SCRIPT_TOKEN"):
        fonte.ler("appsscript", servidor, ["SISGEO"])


def test_sem_segredos_configurados(monkeypatch):
    monkeypatch.delenv("APPS_SCRIPT_TOKEN", raising=False)
    with pytest.raises(SystemExit, match="APPS_SCRIPT"):
        fonte.ler("appsscript", "", ["SISGEO"])


def test_resposta_html_explica_o_problema():
    with pytest.raises(SystemExit, match="App da Web"):
        fonte.abas_do_json("<html>login</html>")
