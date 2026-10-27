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
 * ATUALIZAÇÃO: o GitHub consulta esta ponte a cada ~10 min e só republica o
 * painel quando os dados mudaram. Não há nada para configurar aqui.
 *
 * SEGURANÇA: sem o token a resposta é "não autorizado". O token fica só nas
 * Propriedades deste projeto e no segredo do GitHub. Para trocar, rode
 * gerarToken de novo e atualize o segredo. A planilha é só lida, nunca
 * alterada.
 */

// ID da planilha NOVA BASE ANALISTAS (o trecho entre /d/ e /edit no endereço)
var PAINEL_PLANILHA_ID = '1SN6hpLNlyKrSYUSu0gUlzF8OaIUeuDMA4i0Gq3bpeGY';
// Planilhas que a ponte aceita ler (lista fechada: nenhuma outra é lida).
var PAINEL_PLANILHAS_PERMITIDAS = [
  PAINEL_PLANILHA_ID,                               // NOVA BASE ANALISTAS (chuvas)
  '1rlC6lxivHTj0xLmjDzENe4NEHMN6EFI6d8d2QSDXPVA',   // PLANILHA FOGO EM VEGETAÇÃO
  '1CGGPQ5y0ZoSV2fybEaUQZSBCrXTxcWBv2nq-VS9bMYM'    // HISTÓRICO DE DANOS HUMANOS
];

function doPost(e) {
  var corpo = {};
  try { corpo = JSON.parse(e.postData.contents); } catch (err) {}
  var token = PropertiesService.getScriptProperties().getProperty('PAINEL_TOKEN');
  if (!token || corpo.token !== token) {
    return painelJson_({ erro: 'não autorizado' });
  }
  var pedidas = corpo.abas || [];
  var planilhaId = corpo.planilha || PAINEL_PLANILHA_ID;
  if (PAINEL_PLANILHAS_PERMITIDAS.indexOf(planilhaId) < 0) {
    return painelJson_({ erro: 'planilha não permitida' });
  }
  var livro = SpreadsheetApp.openById(planilhaId);
  var abas = {};
  livro.getSheets().forEach(function (aba) {
    var nome = aba.getName();
    if (pedidas.length === 0 || pedidas.indexOf(nome) >= 0) {
      // getDisplayValues = o texto exatamente como aparece na tela
      abas[nome] = aba.getDataRange().getDisplayValues();
    }
  });
  return painelJson_({ planilha: livro.getName(), planilha_id: planilhaId, lido_em: new Date().toISOString(), abas: abas });
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
  PAINEL_PLANILHAS_PERMITIDAS.forEach(function (id) {
    var livro = SpreadsheetApp.openById(id);
    Logger.log('Planilha: ' + livro.getName() + ' — ' + livro.getSheets().length + ' abas');
  });
}

/**
 * Limpeza: se a "atualização automática" de uma versão anterior deste código
 * chegou a ser ativada, rode esta função UMA vez para remover os gatilhos e o
 * GITHUB_TOKEN. Não faz nada se nunca foi ativada.
 */
function desativarAtualizacaoAutomatica() {
  ScriptApp.getProjectTriggers().forEach(function (g) {
    var f = g.getHandlerFunction();
    if (f === 'painelAoAlterar' || f === 'painelVerificarPendencia') ScriptApp.deleteTrigger(g);
  });
  var props = PropertiesService.getScriptProperties();
  ['GITHUB_TOKEN', 'PAINEL_PENDENTE', 'PAINEL_ULTIMO_DISPARO'].forEach(function (k) { props.deleteProperty(k); });
  Logger.log('Gatilhos e GITHUB_TOKEN removidos (se existiam).');
}

function painelJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
