/**
 * Ponte gratuita planilha -> GitHub Actions (sem Google Cloud, sem cartão).
 *
 * INSTALAÇÃO (uma vez, na planilha NOVA BASE ANALISTAS):
 *  1. Extensões > Apps Script. Apague o conteúdo e cole este arquivo. Salve.
 *  2. Selecione a função gerarToken e clique em Executar. Autorize.
 *     O token aparece em "Registro de execução" — copie.
 *  3. Implantar > Nova implantação > tipo "App da Web":
 *       Executar como: Eu
 *       Quem pode acessar: Qualquer pessoa
 *     Copie a URL do app da Web (termina em /exec).
 *  4. No GitHub (Settings > Secrets and variables > Actions > New secret):
 *       APPS_SCRIPT_URL   = a URL do passo 3
 *       APPS_SCRIPT_TOKEN = o token do passo 2
 *
 * SEGURANÇA: sem o token a resposta é "não autorizado". O token fica só nas
 * Propriedades do script e no segredo do GitHub. Para trocar, rode gerarToken
 * de novo e atualize o segredo. Este script é somente leitura.
 */

function doPost(e) {
  var corpo = {};
  try { corpo = JSON.parse(e.postData.contents); } catch (err) {}
  var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token || corpo.token !== token) {
    return json_({ erro: 'não autorizado' });
  }
  var pedidas = corpo.abas || [];
  var livro = SpreadsheetApp.getActiveSpreadsheet();
  var abas = {};
  livro.getSheets().forEach(function (aba) {
    var nome = aba.getName();
    if (pedidas.length === 0 || pedidas.indexOf(nome) >= 0) {
      // getDisplayValues = o texto exatamente como aparece na tela
      abas[nome] = aba.getDataRange().getDisplayValues();
    }
  });
  return json_({ planilha: livro.getName(), lido_em: new Date().toISOString(), abas: abas });
}

function doGet() {
  return json_({ ok: true, uso: 'POST com {token, abas}' });
}

function gerarToken() {
  var t = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('TOKEN', t);
  Logger.log('APPS_SCRIPT_TOKEN = ' + t);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
