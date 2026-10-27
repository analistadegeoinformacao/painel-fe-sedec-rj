/**
 * Retrato diário da aba DANOS HUMANOS -> planilha "Histórico de Danos Humanos FE-SEDEC-RJ".
 *
 * A aba DANOS HUMANOS (NOVA BASE ANALISTAS) guarda a situação atual de cada município e só muda
 * quando há atualização. Este script confere a aba de hora em hora e, quando ela mudou em relação
 * ao último retrato gravado, grava no HISTORICO o retrato do dia (fonte F003, "RETRATO DIÁRIO"):
 *   - uma linha por município com algum valor na aba;
 *   - uma linha zerada para quem tinha valor e saiu da aba (encerra o último valor no painel);
 *   - se a aba mudar de novo no mesmo dia, o retrato do dia é substituído (vale a última versão);
 *   - se a aba voltar a ficar igual ao último retrato anterior, o retrato do dia é apagado.
 * A coluna AFETADOS da aba DANOS HUMANOS são os OUTROS afetados (fora desalojados, desabrigados e
 * óbitos). O total é calculado pela fórmula da coluna TOTAL_AFETADOS do HISTORICO.
 *
 * INSTALAÇÃO (uma vez):
 *  1. Abra a planilha "Histórico de Danos Humanos FE-SEDEC-RJ" > Extensões > Apps Script.
 *  2. Cole este arquivo no lugar do conteúdo padrão e salve.
 *  3. Selecione a função instalar e clique em Executar. Autorize com a conta que tem acesso às
 *     duas planilhas. Ela grava o primeiro retrato (hoje) e liga a conferência de hora em hora.
 *  Para gravar na hora depois de mexer na aba DANOS HUMANOS: execute registrarRetrato.
 *  O que aconteceu em cada execução aparece em Execuções (menu à esquerda do editor).
 */

var HD_ORIGEM_ID = '1SN6hpLNlyKrSYUSu0gUlzF8OaIUeuDMA4i0Gq3bpeGY';   // NOVA BASE ANALISTAS
var HD_ORIGEM_ABA = 'DANOS HUMANOS';
var HD_HIST_ID = '1CGGPQ5y0ZoSV2fybEaUQZSBCrXTxcWBv2nq-VS9bMYM';     // Histórico de Danos Humanos
var HD_FONTE = 'F003';
var HD_FUSO = 'America/Sao_Paulo';
var HD_OBS_SAIU = 'Saiu da aba DANOS HUMANOS: registrado como 0 para encerrar o último valor';

function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (g) {
    if (g.getHandlerFunction() === 'registrarRetrato') ScriptApp.deleteTrigger(g);
  });
  ScriptApp.newTrigger('registrarRetrato').timeBased().everyHours(1).create();
  registrarRetrato();
}

function registrarRetrato() {
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(60000)) return;
  try {
    var hoje = Utilities.formatDate(new Date(), HD_FUSO, 'yyyy-MM-dd');
    var livro = SpreadsheetApp.openById(HD_HIST_ID);
    var hist = livro.getSheetByName('HISTORICO');
    var ref = hdReferencia_(livro.getSheetByName('MUNICIPIOS').getDataRange().getValues());

    var origem = SpreadsheetApp.openById(HD_ORIGEM_ID).getSheetByName(HD_ORIGEM_ABA);
    var lido = hdLerOrigem_(origem.getDataRange().getValues(), ref);
    if (lido.erro) throw new Error(lido.erro);
    lido.desconhecidos.forEach(function (n) { console.warn('Município não reconhecido na aba DANOS HUMANOS: ' + n); });

    var ultima = hist.getLastRow();
    var linhas = ultima > 1 ? hist.getRange(2, 1, ultima - 1, 15).getValues() : [];
    var plano = hdPlanejar_(lido.atual, linhas, hoje, HD_FONTE, hdData_);

    if (!plano.apagar.length && !plano.gravar.length) {
      console.log('Sem mudança na aba DANOS HUMANOS desde o último retrato.');
      return;
    }
    // apaga de baixo para cima o retrato de hoje (será regravado com a versão atual da aba)
    plano.apagar.sort(function (a, b) { return b - a; }).forEach(function (i) { hist.deleteRow(i + 2); });
    if (plano.gravar.length) {
      var ini = hist.getLastRow() + 1;
      var n = plano.gravar.length;
      // A:H e J:Q separados: a coluna I (TOTAL_AFETADOS) é uma fórmula que se estende sozinha
      hist.getRange(ini, 1, n, 8).setValues(plano.gravar.map(function (r) {
        var m = ref.porCod[r.cod];
        return [r.data, Number(r.cod), m.nome, m.redec, r.obitos, r.desabrigados, r.desalojados, r.outros];
      }));
      hist.getRange(ini, 10, n, 8).setValues(plano.gravar.map(function (r) {
        return ['RETRATO DIÁRIO', '', 'PRELIMINAR', '', '', HD_FONTE, r.nomeFonte || '', r.saiu ? HD_OBS_SAIU : ''];
      }));
      // mesmo formato de data das linhas que já existem (dd/mm/aaaa ou aaaa-mm-dd: o painel lê os dois)
      hist.getRange(ini, 1, n, 1).setNumberFormat(hist.getRange(2, 1).getNumberFormat());
    }
    hdRegistrarFonte_(livro, hoje);
    console.log('Retrato de ' + hoje + ': ' + plano.gravar.length + ' linha(s) gravada(s), ' +
                plano.apagar.length + ' substituída(s).');
  } finally {
    trava.releaseLock();
  }
}

// ------------------------------------------------------------------ partes puras (testáveis)

function hdChave_(s) {
  return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s*-\s*RJ\s*$/, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

function hdData_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, HD_FUSO, 'yyyy-MM-dd');
  return String(v || '').slice(0, 10);
}

/** MUNICIPIOS (COD_IBGE | MUNICIPIO | REDEC) -> busca por nome e por código */
function hdReferencia_(valores) {
  var porNome = {}, porCod = {};
  valores.slice(1).forEach(function (l) {
    if (!l[0]) return;
    var m = { cod: String(l[0]), nome: l[1], redec: l[2] };
    porCod[m.cod] = m;
    porNome[hdChave_(l[1])] = m;
  });
  // grafias que aparecem nas planilhas da Defesa Civil
  var apelidos = { 'VARRE E SAI': 'VARRE SAI', 'PATY DE ALFERES': 'PATY DO ALFERES', 'LAJE DE MURIAE': 'LAJE DO MURIAE',
    'CACHOEIRA DE MACACU': 'CACHOEIRAS DE MACACU', 'BOM JESUS DE ITABAPOANA': 'BOM JESUS DO ITABAPOANA',
    'PAULO DE FRONTIN': 'ENGENHEIRO PAULO DE FRONTIN', 'ARMACAO DE BUZIOS': 'ARMACAO DOS BUZIOS', 'BUZIOS': 'ARMACAO DOS BUZIOS' };
  Object.keys(apelidos).forEach(function (a) { if (porNome[apelidos[a]]) porNome[a] = porNome[apelidos[a]]; });
  return { porNome: porNome, porCod: porCod };
}

/** Número da célula: vazio continua vazio (não informado); "-" vale 0; "1.200" vale 1200. */
function hdNumero_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return Math.round(v);
  var s = String(v).trim();
  if (!s) return '';
  if (/^-+$/.test(s)) return 0;
  var n = Number(s.replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? '' : Math.round(n);
}

/** Aba DANOS HUMANOS -> { atual: {cod: {obitos, desabrigados, desalojados, outros, nomeFonte}}, desconhecidos, erro } */
function hdLerOrigem_(valores, ref) {
  if (!valores.length) return { erro: 'aba DANOS HUMANOS vazia' };
  var cab = valores[0].map(hdChave_);
  var col = function (nomes) { for (var i = 0; i < nomes.length; i++) { var j = cab.indexOf(nomes[i]); if (j >= 0) return j; } return -1; };
  var c = { mun: col(['MUNICIPIOS', 'MUNICIPIO']), desal: col(['DESALOJADOS']), desab: col(['DESABRIGADOS']),
            outros: col(['AFETADOS', 'OUTROS AFETADOS']), obitos: col(['OBITOS']) };
  var faltam = Object.keys(c).filter(function (k) { return c[k] < 0; });
  if (faltam.length) return { erro: 'colunas não encontradas na aba DANOS HUMANOS: ' + faltam.join(', ') };
  var atual = {}, desconhecidos = [];
  valores.slice(1).forEach(function (l) {
    var nome = String(l[c.mun] || '').trim();
    if (!nome) return;
    var r = { obitos: hdNumero_(l[c.obitos]), desabrigados: hdNumero_(l[c.desab]),
              desalojados: hdNumero_(l[c.desal]), outros: hdNumero_(l[c.outros]) };
    if (r.obitos === '' && r.desabrigados === '' && r.desalojados === '' && r.outros === '') return;
    var m = ref.porNome[hdChave_(nome)];
    if (!m) { desconhecidos.push(nome); return; }
    if (hdChave_(nome) !== hdChave_(m.nome)) r.nomeFonte = nome;
    atual[m.cod] = r;
  });
  return { atual: atual, desconhecidos: desconhecidos };
}

/**
 * Decide o que gravar. linhas = HISTORICO!A2:O (valores). Devolve
 * { apagar: [índices das linhas do retrato de hoje desta fonte], gravar: [linhas novas] }.
 */
function hdPlanejar_(atual, linhas, hoje, fonte, data) {
  var anterior = {}, dataAnt = {}, apagar = [];
  linhas.forEach(function (l, i) {
    var d = data(l[0]);
    if (!d || String(l[9]).toUpperCase().indexOf('RETRATO') !== 0) return;
    if (d === hoje && l[14] === fonte) { apagar.push(i); return; }
    var cod = String(l[1]);
    if (!dataAnt[cod] || d >= dataAnt[cod]) {
      dataAnt[cod] = d;
      anterior[cod] = { obitos: hdNumero_(l[4]), desabrigados: hdNumero_(l[5]), desalojados: hdNumero_(l[6]), outros: hdNumero_(l[7]) };
    }
  });
  var campos = ['obitos', 'desabrigados', 'desalojados', 'outros'];
  var igual = function (a, b) { return campos.every(function (k) { return String(a[k]) === String(b[k]); }); };
  var positivo = function (r) { return campos.some(function (k) { return Number(r[k]) > 0; }); };
  var gravar = [];
  var mudou = false;
  Object.keys(atual).forEach(function (cod) {
    var r = atual[cod];
    if (!anterior[cod] || !igual(r, anterior[cod])) mudou = true;
    gravar.push({ data: hoje, cod: cod, obitos: r.obitos, desabrigados: r.desabrigados, desalojados: r.desalojados,
                  outros: r.outros, nomeFonte: r.nomeFonte });
  });
  Object.keys(anterior).forEach(function (cod) {
    if (!atual[cod] && positivo(anterior[cod])) {
      mudou = true;
      gravar.push({ data: hoje, cod: cod, obitos: 0, desabrigados: 0, desalojados: 0, outros: 0, saiu: true });
    }
  });
  if (!mudou) gravar = [];
  // retrato de hoje já gravado e idêntico ao que seria gravado: nada a fazer
  if (apagar.length && gravar.length === apagar.length) {
    var hojeAtual = {};
    apagar.forEach(function (i) { var l = linhas[i]; hojeAtual[String(l[1])] = { obitos: hdNumero_(l[4]), desabrigados: hdNumero_(l[5]), desalojados: hdNumero_(l[6]), outros: hdNumero_(l[7]) }; });
    if (gravar.every(function (g) { return hojeAtual[g.cod] && igual(g, hojeAtual[g.cod]); })) return { apagar: [], gravar: [] };
  }
  gravar.sort(function (a, b) { return a.cod < b.cod ? -1 : 1; });
  return { apagar: apagar, gravar: gravar };
}

/** Linha da fonte F003 na aba FONTES (cria na primeira vez; depois só atualiza a data). */
function hdRegistrarFonte_(livro, hoje) {
  var aba = livro.getSheetByName('FONTES');
  var ids = aba.getRange(1, 1, Math.max(aba.getLastRow(), 1), 1).getValues().map(function (l) { return l[0]; });
  var i = ids.indexOf(HD_FONTE);
  if (i < 0) {
    var linha = ids.filter(String).length + 1;
    aba.getRange(linha, 1, 1, 9).setValues([[HD_FONTE,
      'Retratos diários da aba DANOS HUMANOS (NOVA BASE ANALISTAS), gravados automaticamente quando a aba muda',
      'NOVA BASE ANALISTAS, aba DANOS HUMANOS', 'https://docs.google.com/spreadsheets/d/' + HD_ORIGEM_ID,
      'RETRATO DIÁRIO', 'desde ' + hoje, '', hoje,
      'Script historico_danos.gs (conferência de hora em hora). Um retrato por dia em que a aba mudou; vale a última versão do dia. ' +
      'AFETADOS da aba = OUTROS_AFETADOS. Quem sai da aba ganha uma linha zerada.']]);
    // separador de argumentos conforme o idioma da planilha (pt_BR usa ";")
    var sep = /^en/.test(livro.getSpreadsheetLocale()) ? ',' : ';';
    aba.getRange(linha, 7).setFormula('=COUNTIF(HISTORICO!O:O' + sep + 'A' + linha + ')');
  } else {
    aba.getRange(i + 1, 8).setValue(hoje);
  }
}
