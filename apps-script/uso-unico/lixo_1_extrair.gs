/**
 * USO ÚNICO — separa, da aba SISGEO_FV (PLANILHA FOGO EM VEGETAÇÃO), as ocorrências que citam
 * "lixo" (lixo, lixos, lixeira, lixão…) na Avaliação do cenário ou nas Informações complementares
 * e ainda estão SEM Motivo da Exclusão, para o Claude ler e decidir caso a caso.
 *
 * NÃO altera a planilha de fogo. Cria no seu Drive planilhas novas "LIXO REVISAR - parte N"
 * (até 250 ocorrências cada) com: linha, IdEvento, Ocorrência e o trecho do texto onde o lixo aparece.
 * Depois da revisão, essas planilhas podem ser apagadas.
 *
 * COMO USAR: script.google.com › Novo projeto › cole este arquivo › salve ›
 * selecione a função "extrair" › Executar › autorize. O registro mostra quantas foram separadas.
 */
var PLANILHA_ID = '1rlC6lxivHTj0xLmjDzENe4NEHMN6EFI6d8d2QSDXPVA'; // PLANILHA FOGO EM VEGETAÇÃO
var ABA = 'SISGEO_FV';
var POR_PARTE = 250;
var JANELA = 220; // caracteres antes e depois da palavra (texto curto vai inteiro)

function chave_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}
var RX = /\bLIX(O|OS|EIRA|EIRAS|AO|OES)\b/;

function coluna_(cab, nomes) {
  var k = cab.map(function (h) { return chave_(h).replace(/\s+/g, ' ').trim(); });
  for (var i = 0; i < nomes.length; i++) {
    var j = k.indexOf(chave_(nomes[i]));
    if (j >= 0) return j;
  }
  throw new Error('Coluna não encontrada: ' + nomes.join(' / '));
}

function trecho_(texto) {
  var t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (t.length <= 2 * JANELA + 40) return t;
  var m = RX.exec(chave_(t));
  if (!m) return '';
  var ini = Math.max(0, m.index - JANELA), fim = Math.min(t.length, m.index + m[0].length + JANELA);
  return (ini > 0 ? '…' : '') + t.slice(ini, fim) + (fim < t.length ? '…' : '');
}

function extrair() {
  var sh = SpreadsheetApp.openById(PLANILHA_ID).getSheetByName(ABA);
  var dados = sh.getDataRange().getDisplayValues();
  var cab = dados[0];
  var cEv = coluna_(cab, ['IdEvento']), cOc = coluna_(cab, ['Ocorrência']);
  var cAv = coluna_(cab, ['Avaliação do cenário', 'Avaliação Cenário']);
  var cIn = coluna_(cab, ['Informações complementares', 'Atualização Cenário']);
  var cMo = coluna_(cab, ['Motivo da Exclusão']);
  var linhas = [];
  for (var r = 1; r < dados.length; r++) {
    var l = dados[r];
    if (String(l[cMo]).trim()) continue; // já tem motivo: não precisa revisar
    var av = RX.test(chave_(l[cAv])), inf = RX.test(chave_(l[cIn]));
    if (!av && !inf) continue;
    linhas.push([r + 1, l[cEv], l[cOc], av ? trecho_(l[cAv]) : '', inf ? trecho_(l[cIn]) : '']);
  }
  var partes = Math.ceil(linhas.length / POR_PARTE);
  for (var p = 0; p < partes; p++) {
    var bloco = linhas.slice(p * POR_PARTE, (p + 1) * POR_PARTE);
    var nova = SpreadsheetApp.create('LIXO REVISAR - parte ' + (p + 1) + ' de ' + partes);
    var aba = nova.getSheets()[0];
    aba.getRange(1, 1, 1, 5).setValues([['linha', 'IdEvento', 'Ocorrência', 'Avaliação do cenário (trecho)', 'Informações complementares (trecho)']]);
    aba.getRange(2, 1, bloco.length, 5).setNumberFormat('@').setValues(bloco);
    Logger.log('Parte ' + (p + 1) + ': ' + bloco.length + ' ocorrências — ' + nova.getUrl());
  }
  Logger.log('Total separado para revisão: ' + linhas.length + ' (só as que ainda estão sem Motivo da Exclusão).');
}
