/**
 * Ponte gratuita planilha -> GitHub Actions (sem Google Cloud, sem cartão).
 *
 * Este é um projeto de Apps Script SEPARADO (independente), que lê a planilha
 * pelo ID. NÃO é colado dentro da planilha, então não interfere nos scripts e
 * complementos que já existem nela (AutoCrat, automações, etc.).
 *
 * INSTALAÇÃO (uma vez):
 *  1. Acesse https://script.google.com > Novo projeto. Dê o nome
 *     "Painel FE-SEDEC — ponte GitHub". Cole este arquivo no lugar do
 *     conteúdo padrão (o projeto é novo, não há nada a perder). Salve.
 *  2. Selecione a função gerarToken e clique em Executar. Autorize com a
 *     conta que tem acesso à planilha. O token aparece em "Registro de
 *     execução" — copie.
 *  3. Implantar > Nova implantação > tipo "App da Web":
 *       Executar como: Eu
 *       Quem pode acessar: Qualquer pessoa
 *     Copie a URL do app da Web (termina em /exec).
 *  4. No GitHub (Settings > Secrets and variables > Actions > New secret):
 *       APPS_SCRIPT_URL   = a URL do passo 3
 *       APPS_SCRIPT_TOKEN = o token do passo 2
 *
 * SEGURANÇA: sem o token a resposta é "não autorizado". O token fica só nas
 * Propriedades deste projeto e no segredo do GitHub. Para trocar, rode
 * gerarToken de novo e atualize o segredo. Este script é somente leitura.
 */

// ID da planilha NOVA BASE ANALISTAS (o trecho entre /d/ e /edit no endereço)
var PAINEL_PLANILHA_ID = '1SN6hpLNlyKrSYUSu0gUlzF8OaIUeuDMA4i0Gq3bpeGY';

function doPost(e) {
  var corpo = {};
  try { corpo = JSON.parse(e.postData.contents); } catch (err) {}
  var token = PropertiesService.getScriptProperties().getProperty('PAINEL_TOKEN');
  if (!token || corpo.token !== token) {
    return painelJson_({ erro: 'não autorizado' });
  }
  var pedidas = corpo.abas || [];
  var livro = SpreadsheetApp.openById(PAINEL_PLANILHA_ID);
  var abas = {};
  livro.getSheets().forEach(function (aba) {
    var nome = aba.getName();
    if (pedidas.length === 0 || pedidas.indexOf(nome) >= 0) {
      // getDisplayValues = o texto exatamente como aparece na tela
      abas[nome] = aba.getDataRange().getDisplayValues();
    }
  });
  return painelJson_({ planilha: livro.getName(), lido_em: new Date().toISOString(), abas: abas });
}

function doGet() {
  return painelJson_({ ok: true, uso: 'POST com {token, abas}' });
}

function gerarToken() {
  var t = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('PAINEL_TOKEN', t);
  Logger.log('APPS_SCRIPT_TOKEN = ' + t);
}

/** Opcional: rode para conferir se o projeto enxerga a planilha. */
function testarLeitura() {
  var livro = SpreadsheetApp.openById(PAINEL_PLANILHA_ID);
  Logger.log('Planilha: ' + livro.getName() + ' — ' + livro.getSheets().length + ' abas');
}

function painelJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
