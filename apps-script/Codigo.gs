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
 * ATUALIZAÇÃO AUTOMÁTICA AO EDITAR A PLANILHA (opcional, também gratuita):
 *  A. No GitHub: Settings (da sua conta) > Developer settings > Personal access
 *     tokens > Fine-grained tokens > Generate new token.
 *       Repository access: Only select repositories > painel-fe-sedec-rj
 *       Permissions > Repository > Actions: Read and write   (só isso)
 *     Copie o token (começa com github_pat_).
 *  B. Neste projeto: Configurações do projeto (engrenagem) > Propriedades do
 *     script > Adicionar propriedade:  GITHUB_TOKEN = o token do passo A.
 *  C. Selecione a função ativarAtualizacaoAutomatica e clique em Executar.
 *     Autorize (pede acesso a gatilhos e a serviços externos).
 *  Pronto: ~2 a 7 minutos depois que alguém PARA de editar a planilha, o
 *  painel é republicado. Edições seguidas viram uma publicação só.
 *  Para publicar na hora: execute atualizarPainelAgora.
 *  Para desligar: execute desativarAtualizacaoAutomatica.
 *
 * SEGURANÇA: sem o token a resposta é "não autorizado". O token fica só nas
 * Propriedades deste projeto e no segredo do GitHub. Para trocar, rode
 * gerarToken de novo e atualize o segredo. A planilha é só lida, nunca
 * alterada. O GITHUB_TOKEN só permite disparar o fluxo de publicação.
 */

// ID da planilha NOVA BASE ANALISTAS (o trecho entre /d/ e /edit no endereço)
var PAINEL_PLANILHA_ID = '1SN6hpLNlyKrSYUSu0gUlzF8OaIUeuDMA4i0Gq3bpeGY';
// Repositório e fluxo que publicam o painel
var PAINEL_REPO = 'analistadegeoinformacao/painel-fe-sedec-rj';
var PAINEL_FLUXO = 'publicar.yml';
// Espera após a última edição antes de publicar (junta várias edições em uma)
var PAINEL_ESPERA_MIN = 2;

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

// ------------------------------------------------ atualização automática

function ativarAtualizacaoAutomatica() {
  if (!PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN')) {
    throw new Error('Cadastre GITHUB_TOKEN em Configurações do projeto > Propriedades do script (ver instruções no topo).');
  }
  desativarAtualizacaoAutomatica();
  ScriptApp.newTrigger('painelAoAlterar').forSpreadsheet(PAINEL_PLANILHA_ID).onChange().create();
  ScriptApp.newTrigger('painelVerificarPendencia').timeBased().everyMinutes(5).create();
  Logger.log('Atualização automática ATIVADA. O painel será republicado alguns minutos após cada edição.');
}

function desativarAtualizacaoAutomatica() {
  ScriptApp.getProjectTriggers().forEach(function (g) {
    var f = g.getHandlerFunction();
    if (f === 'painelAoAlterar' || f === 'painelVerificarPendencia') ScriptApp.deleteTrigger(g);
  });
  PropertiesService.getScriptProperties().deleteProperty('PAINEL_PENDENTE');
  Logger.log('Atualização automática desativada.');
}

/** Publica agora, sem esperar. */
function atualizarPainelAgora() {
  painelDisparar_();
  Logger.log('Publicação solicitada. O painel atualiza em cerca de 2 minutos.');
}

/** Gatilho: a planilha mudou. Só anota a hora; quem publica é o verificador. */
function painelAoAlterar(e) {
  PropertiesService.getScriptProperties().setProperty('PAINEL_PENDENTE', String(Date.now()));
}

/** Gatilho a cada 5 min: publica se houve edição e ela já "assentou". */
function painelVerificarPendencia() {
  var props = PropertiesService.getScriptProperties();
  var pendente = Number(props.getProperty('PAINEL_PENDENTE') || 0);
  if (!pendente) return;
  if (Date.now() - pendente < PAINEL_ESPERA_MIN * 60 * 1000) return; // ainda editando
  props.deleteProperty('PAINEL_PENDENTE');
  painelDisparar_();
}

function painelDisparar_() {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_TOKEN não cadastrado nas Propriedades do script.');
  var r = UrlFetchApp.fetch('https://api.github.com/repos/' + PAINEL_REPO + '/actions/workflows/' + PAINEL_FLUXO + '/dispatches', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token.trim(), Accept: 'application/vnd.github+json' },
    payload: JSON.stringify({ ref: 'main' }),
    muteHttpExceptions: true
  });
  if (r.getResponseCode() !== 204) {
    throw new Error('GitHub recusou (' + r.getResponseCode() + '): ' + r.getContentText().slice(0, 300) +
                    ' — confira se o GITHUB_TOKEN tem "Actions: Read and write" neste repositório.');
  }
}

function painelJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
