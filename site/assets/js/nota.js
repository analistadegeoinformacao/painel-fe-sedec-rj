// Resumo para a Nota Técnica Operacional (NI²AD).
// Funções puras (sem DOM, sem estado): recebem os conjuntos já carregados e devolvem os números do período,
// usando as MESMAS regras do painel (depuração do SisGeO, último retrato de danos por município, decretos vigentes).
// O bloco de texto gerado é colado na "Ferramenta-base do Operador", que preenche a Nota e confere os totais.
import { titulo } from "./util.js";

export const ESQUEMA = "NIIAD-NOTA/1";
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const ROMANO = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V" };
const chave = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const n0 = (v) => (typeof v === "number" ? v : 0);
const redecNum = (r) => { const m = /REDEC\s*(\d+)/i.exec(r || ""); return m ? Number(m[1]) : null; };
const minuto = (s) => String(s || "").slice(0, 16); // 'YYYY-MM-DDTHH:MM'
const noPeriodo = (dt, ini, fim) => { const d = minuto(dt); return d.length === 16 && d >= ini && d <= fim; };

function contarRedecMun(linhas, nomeDoCod, redecDoCod) {
  const redec = {}, municipios = {};
  for (let i = 1; i <= 11; i++) redec[i] = 0;
  for (const l of linhas) {
    const r = redecNum(l.redec ?? redecDoCod.get(l.cod_ibge));
    if (!r) continue;
    redec[r]++;
    const nome = nomeDoCod.get(l.cod_ibge);
    if (nome) { (municipios[r] ||= {}); municipios[r][nome] = (municipios[r][nome] || 0) + 1; }
  }
  return { redec, municipios };
}

function blocoSisgeo(linhas, ini, fim, nomeDoCod, redecDoCod) {
  const todas = (linhas || []).filter((l) => noPeriodo(l.data_ocorrencia, ini, fim));
  const validas = todas.filter((l) => !l.depuracao);
  const tipos = {};
  for (const l of validas) tipos[l.tipo || "Sem tipo"] = (tipos[l.tipo || "Sem tipo"] || 0) + 1;
  const situacoes = {};
  for (const l of todas) situacoes[l.situacao || "Sem situação"] = (situacoes[l.situacao || "Sem situação"] || 0) + 1;
  return { total: todas.length, validadas: validas.length, excluidas: todas.length - validas.length, tipos,
    vitimas: validas.reduce((t, l) => t + n0(l.vitimas), 0), situacoes, ...contarRedecMun(validas, nomeDoCod, redecDoCod) };
}

/** "4.916 de 15/01/26" + data + prazo + nível -> linha pronta para a Nota (o operador confere SE/ECP e o nº do SEI). */
export function linhaDecreto(l, nomeMun) {
  const num = /^\s*([\d.\/]+)\s+de\b/i.exec(l.decreto || "")?.[1] || String(l.decreto || "").trim();
  const [a, m, d] = String(l.data_decreto || "").split("-");
  const data = a && m && d ? `${d} de ${MESES[Number(m) - 1]} de ${a}` : "data não informada";
  const nivel = l.nivel ? ` Nível ${ROMANO[l.nivel] || l.nivel}` : "";
  const prazo = l.prazo_dias ? ` (${l.prazo_dias} dias)` : "";
  return `${String(nomeMun || l.municipio || "").toUpperCase()} - Decreto Municipal N° ${num} de ${data} - Situação de Emergência${nivel}${prazo}.`;
}

/**
 * entrada: { ini, fim ('YYYY-MM-DDTHH:MM'), sisgeo, fogo, fogoAbertos, municipios (meta), danos(dia), decretos, vigente(l),
 *            severidade, alertas, gerado }
 */
export function resumoNota(e) {
  const nomeDoCod = new Map(e.municipios.map((m) => [m.cod_ibge, titulo(m.municipio)]));
  const redecDoCod = new Map(e.municipios.map((m) => [m.cod_ibge, m.redec]));
  const chuvas = blocoSisgeo(e.sisgeo, e.ini, e.fim, nomeDoCod, redecDoCod);
  const fogo = e.fogo ? blocoSisgeo(e.fogo, e.ini, e.fim, nomeDoCod, redecDoCod) : null;
  if (fogo) fogo.abertas = (e.fogoAbertos || []).filter((l) => noPeriodo(l.data_ocorrencia, e.ini, e.fim)).length;

  const dia = e.fim.slice(0, 10);
  const d = e.danos ? e.danos(dia) : null;
  let danos = null;
  if (d && d.linhas && d.linhas.length) {
    const s = (c) => d.linhas.reduce((t, l) => t + n0(l[c]), 0);
    danos = { data: dia, retrato: d.ultimo || null, historico: !!d.historico, desabrigados: s("desabrigados"), desalojados: s("desalojados"),
      obitos: s("obitos"), outros: s("outros_afetados"), afetados: s("afetados") };
  }

  const decretos = (e.decretos || []).filter((l) => e.vigente(l)).map((l) => ({
    municipio: nomeDoCod.get(l.cod_ibge) || titulo(l.municipio), redec: redecNum(l.redec ?? redecDoCod.get(l.cod_ibge)),
    termino: l.termino || null, linha: linhaDecreto(l, nomeDoCod.get(l.cod_ibge) || titulo(l.municipio)) }));

  const sev = { alto: [], muito_alto: [] };
  for (const l of e.severidade || []) {
    const k = chave(l.severidade), r = redecNum(l.redec);
    if (!r) continue;
    if (k === "muito alto" || k === "muito alta") sev.muito_alto.push(r);
    else if (k === "alto" || k === "alta") sev.alto.push(r);
  }

  const alertas = {};
  const d0 = e.ini.slice(0, 10);
  for (const l of e.alertas || []) {
    const dd = String(l.data || "").slice(0, 10);
    if (!dd || dd < d0 || dd > dia || !l.tipo) continue;
    alertas[l.tipo] ||= { registros: 0, envios: 0 };
    alertas[l.tipo].registros++;
    alertas[l.tipo].envios += n0(l.envios);
  }

  return { v: 1, gerado: e.gerado || null, ini: e.ini, fim: e.fim, chuvas, fogo, danos, decretos, severidade: sev, alertas };
}

/** Texto para copiar: primeira linha identifica o formato; segunda é o JSON (uma linha). */
export function blocoNota(resumo) {
  return `${ESQUEMA}\n${JSON.stringify(resumo)}`;
}
