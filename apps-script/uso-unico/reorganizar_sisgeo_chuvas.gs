/**
 * USO ÚNICO — reorganiza a aba SISGEO_CHUVAS (planilha NOVA BASE ANALISTAS)
 * para receber o download do SisGeO colado direto a partir da coluna B.
 *
 * Resultado:
 *   A        REDEC (sua fórmula continua aqui)
 *   B … U    as 20 colunas do download, na ordem em que ele vem
 *   V …      suas colunas extras (Motivo da Exclusão, Atualização Cenário, Durações…)
 *
 * COMO USAR (≈5 min):
 *  1. https://script.google.com › Novo projeto (projeto SEPARADO; não mexe nos scripts da planilha).
 *     Apague o conteúdo, cole este arquivo inteiro e salve.
 *  2. Selecione a função "simular" › Executar › autorize. Leia o Registro de execução:
 *     ele mostra, coluna por coluna, de onde vem cada uma. NADA é alterado.
 *  3. Se estiver certo, selecione "reorganizar" › Executar.
 *     Antes de mexer, ele cria uma cópia da aba (SISGEO_CHUVAS_ANTES_aaaammdd_hhmm).
 *  4. Confira a aba. Se algo sair errado: apague SISGEO_CHUVAS e renomeie a cópia de volta.
 *
 * Fórmulas: referências a colunas da própria aba (ex.: a REDEC apontando para o Município)
 * são ajustadas para a nova posição. Referências a OUTRAS abas que apontem para esta pela
 * letra (ex.: =SISGEO_CHUVAS!P2) NÃO são ajustadas — o registro avisa para conferir.
 */

var PLANILHA_ID = '1SN6hpLNlyKrSYUSu0gUlzF8OaIUeuDMA4i0Gq3bpeGY'; // NOVA BASE ANALISTAS
var ABA = 'SISGEO_CHUVAS';
var ABA_ANTIGA = 'SISGEO'; // se ainda não renomeou, o script usa este nome e já renomeia

// Ordem exata do download "SisGeO Consulta Ocorrência" (colunas B em diante)
var ORDEM_DOWNLOAD = ['IdEvento', 'Ocorrência', 'Data Ocorrência', 'Unidade', 'Tipo', 'Subtipo', 'Viatura',
  'Endereço', 'Posição', 'Efetivo', 'Data Despacho', 'Data Deslocamento', 'Data Chegada', 'Data Fechamento',
  'Situação', 'Município', 'Vítimas Qtd', 'Avaliação do cenário', 'Condição climática', 'Informações complementares'];

// Nome antigo na sua aba -> nome no download (mesma informação)
var RENOMEAR = { 'Latitude/Longitude': 'Posição', 'VítimaQtd': 'Vítimas Qtd', 'Avaliação Cenário': 'Avaliação do cenário' };

function chave_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function letra_(i) { // 0 -> A
  var s = '';
  for (i = i + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

/** Plano: para cada coluna nova, de qual coluna antiga ela vem (-1 = nova, vazia). */
function planejar_(cab) {
  var renomear = {};
  Object.keys(RENOMEAR).forEach(function (k) { renomear[chave_(k)] = RENOMEAR[k]; });
  var antigos = cab.map(function (h) { return renomear[chave_(h)] || String(h == null ? '' : h).trim(); });
  var pos = {};
  antigos.forEach(function (h, i) { if (h && !(chave_(h) in pos)) pos[chave_(h)] = i; });
  var nova = ['REDEC'].concat(ORDEM_DOWNLOAD);
  var naNova = {};
  nova.forEach(function (h) { naNova[chave_(h)] = true; });
  antigos.forEach(function (h) { if (h && !naNova[chave_(h)]) { nova.push(h); naNova[chave_(h)] = true; } });
  var origem = nova.map(function (h) { return chave_(h) in pos ? pos[chave_(h)] : -1; });
  return { cabecalho: nova, origem: origem, antigo: cab };
}

/** Ajusta referências A1 da própria aba (P2, $P$2, P:P, P2:P900) da posição antiga para a nova. */
function remapear_(formula, novaLetraDe) {
  var dentroTexto = false, out = '', i = 0;
  while (i < formula.length) {
    var c = formula[i];
    if (c === '"') { dentroTexto = !dentroTexto; out += c; i++; continue; }
    if (dentroTexto) { out += c; i++; continue; }
    if (c === '!') { // referência a OUTRA aba (Ref!A:B, 'Aba'!P2): copia como está
      var q = /^!(\$?[A-Z]{1,3}\$?\d*)(:\$?[A-Z]{1,3}\$?\d*)?/.exec(formula.slice(i));
      var pedaco = q ? q[0] : '!';
      out += pedaco; i += pedaco.length; continue;
    }
    var ant = i > 0 ? formula[i - 1] : '';
    var m = /^(\$?)([A-Z]{1,3})(\$?)(\d+)?/.exec(formula.slice(i));
    var podeSerRef = m && !/[A-Za-z0-9_.!'\]]/.test(ant);
    if (podeSerRef) {
      var depois = formula[i + m[0].length] || '';
      var ehFuncao = depois === '(' || /[A-Za-z_]/.test(depois);
      var ehRef = !ehFuncao && (m[4] || depois === ':' || ant === ':');
      if (ehRef && novaLetraDe[m[2]]) {
        out += m[1] + novaLetraDe[m[2]] + m[3] + (m[4] || '');
        i += m[0].length;
        continue;
      }
    }
    out += c; i++;
  }
  return out;
}

function mapaLetras_(plano) {
  var mapa = {};
  plano.origem.forEach(function (oi, ni) { if (oi >= 0) mapa[letra_(oi)] = letra_(ni); });
  // colunas antigas que sumiram não têm destino: ficam como estão (o registro avisa)
  return mapa;
}

function abrirAba_() {
  var ss = SpreadsheetApp.openById(PLANILHA_ID);
  var sh = ss.getSheetByName(ABA);
  if (!sh) {
    sh = ss.getSheetByName(ABA_ANTIGA);
    if (!sh) throw new Error('Não achei a aba ' + ABA + ' nem ' + ABA_ANTIGA);
  }
  return { ss: ss, sh: sh };
}

function descrever_(plano) {
  var linhas = ['Nova ordem (coluna nova ← coluna atual):'];
  plano.cabecalho.forEach(function (h, ni) {
    var oi = plano.origem[ni];
    linhas.push('  ' + letra_(ni) + '  ' + h + '   ←   ' + (oi >= 0 ? letra_(oi) + ' "' + plano.antigo[oi] + '"' : '(nova, fica vazia até a próxima colagem)'));
  });
  return linhas.join('\n');
}

/** Passo 2: só mostra o que vai acontecer. Não altera nada. */
function simular() {
  var a = abrirAba_();
  var cab = a.sh.getRange(1, 1, 1, a.sh.getLastColumn()).getValues()[0];
  var plano = planejar_(cab);
  Logger.log('Aba: ' + a.sh.getName() + ' · ' + (a.sh.getLastRow() - 1) + ' linhas de dados');
  Logger.log(descrever_(plano));
  var f = a.sh.getRange(2, 1, Math.min(5, Math.max(1, a.sh.getLastRow() - 1)), a.sh.getLastColumn()).getFormulas();
  var mapa = mapaLetras_(plano);
  f.forEach(function (lin, r) {
    lin.forEach(function (x, c) { if (x) Logger.log('Fórmula linha ' + (r + 2) + ' col ' + letra_(c) + ': ' + x + '  →  ' + remapear_(x, mapa)); });
  });
}

/** Passo 3: faz a cópia de segurança e reorganiza. */
function reorganizar() {
  var a = abrirAba_();
  var ss = a.ss, sh = a.sh;
  var copia = sh.copyTo(ss).setName(ABA + '_ANTES_' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyyMMdd_HHmm'));
  var rng = sh.getDataRange();
  var valores = rng.getValues(), formulas = rng.getFormulas(), formatos = rng.getNumberFormats();
  var plano = planejar_(valores[0]);
  var mapa = mapaLetras_(plano);
  var nLin = valores.length, nCol = plano.cabecalho.length;
  // colunas preenchidas por ARRAYFORMULA: só a célula da fórmula é copiada (o resto ela mesma recalcula)
  var porArray = {};
  formulas.forEach(function (l) { l.forEach(function (x, c) { if (/ARRAYFORMULA/i.test(x)) porArray[c] = true; }); });
  var out = [], fmt = [];
  for (var r = 0; r < nLin; r++) {
    var linha = [], lf = [];
    for (var j = 0; j < nCol; j++) {
      var oi = plano.origem[j];
      if (r === 0) { linha.push(oi >= 0 && formulas[0][oi] ? remapear_(formulas[0][oi], mapa) : plano.cabecalho[j]); lf.push('@'); continue; }
      if (oi < 0) { linha.push(''); lf.push('General'); continue; }
      if (formulas[r][oi]) linha.push(remapear_(formulas[r][oi], mapa));
      else linha.push(porArray[oi] ? '' : valores[r][oi]);
      lf.push(formatos[r][oi]);
    }
    out.push(linha); fmt.push(lf);
  }
  if (sh.getMaxColumns() < nCol) sh.insertColumnsAfter(sh.getMaxColumns(), nCol - sh.getMaxColumns());
  sh.clearContents();
  sh.getRange(1, 1, nLin, nCol).setNumberFormats(fmt).setValues(out);
  if (sh.getName() !== ABA) sh.setName(ABA);
  // conferência: mesmas ocorrências, na mesma quantidade
  var conf = sh.getRange(2, 2, nLin - 1, 2).getValues().map(function (l) { return l.join('|'); }).join('\n');
  var iEv = plano.origem[1], iOc = plano.origem[2];
  var orig = valores.slice(1).map(function (l) { return [l[iEv], l[iOc]].join('|'); }).join('\n');
  Logger.log(descrever_(plano));
  Logger.log('Cópia de segurança: ' + copia.getName());
  Logger.log(conf === orig ? 'CONFERIDO: ' + (nLin - 1) + ' linhas, mesmas ocorrências na mesma ordem.' :
                             'ATENÇÃO: a conferência IdEvento/Ocorrência não bateu — restaure a cópia e me avise.');
  Logger.log('Confira também outras abas/fórmulas que apontem para ' + ABA + ' pela letra da coluna.');
}

// para testes fora do Google (node)
if (typeof module !== 'undefined') module.exports = { planejar_: planejar_, remapear_: remapear_, mapaLetras_: mapaLetras_, letra_: letra_ };
