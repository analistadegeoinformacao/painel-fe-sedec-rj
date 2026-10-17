// Gráficos (ECharts). Cores sempre lidas dos tokens CSS, para respeitar
// o tema claro/escuro. Um gráfico = uma série = uma cor; sem eixo duplo.
import { fmt, fmtData } from "./util.js";

const instancias = new Map();
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function tema() {
  return {
    serie: css("--serie"), destaque: css("--serie-destaque"), texto: css("--texto"),
    texto2: css("--texto-2"), texto3: css("--texto-3"), grade: css("--grade"), superficie: css("--superficie"),
    fonte: css("--fonte"),
  };
}

function iniciar(el) {
  if (!window.echarts) throw new Error("ECharts não carregou");
  let g = instancias.get(el);
  if (!g || g.isDisposed()) {
    g = echarts.init(el, null, { renderer: "svg", locale: "PT-br" });
    instancias.set(el, g);
    new ResizeObserver(() => g.resize()).observe(el);
  }
  return g;
}

function tooltipBase(t) {
  return {
    backgroundColor: t.superficie, borderColor: t.grade, textStyle: { color: t.texto, fontFamily: t.fonte, fontSize: 12.5 },
    extraCssText: "box-shadow:0 4px 14px rgba(0,0,0,.12);border-radius:8px;",
  };
}

/** Barras horizontais ordenadas. itens: [[rotulo, valor, chaveOriginal?]] */
export function barrasH(el, itens, { aoClicar, selecionado, unidade = "registros" } = {}) {
  const t = tema();
  const g = iniciar(el);
  const dados = itens.slice().reverse();
  g.setOption(
    {
      animationDuration: 300,
      textStyle: { fontFamily: t.fonte },
      grid: { left: 8, right: 48, top: 4, bottom: 4, containLabel: true },
      tooltip: { ...tooltipBase(t), trigger: "item", formatter: (p) => `${p.name}<br><b>${fmt(p.value)}</b> ${unidade}` },
      xAxis: { type: "value", show: false },
      yAxis: {
        type: "category", data: dados.map((d) => d[0]), axisTick: { show: false }, axisLine: { show: false },
        axisLabel: { color: t.texto2, fontSize: 12, width: 190, overflow: "truncate" },
      },
      series: [{
        type: "bar", barMaxWidth: 18, barCategoryGap: "35%",
        data: dados.map((d) => ({
          value: d[1], chave: d[2] ?? d[0],
          itemStyle: { color: selecionado && (d[2] ?? d[0]) === selecionado ? t.destaque : t.serie, borderRadius: [0, 4, 4, 0] },
        })),
        label: { show: true, position: "right", color: t.texto2, fontSize: 12, formatter: (p) => fmt(p.value) },
        emphasis: { itemStyle: { color: t.destaque } },
        cursor: aoClicar ? "pointer" : "default",
      }],
    },
    true
  );
  g.off("click");
  if (aoClicar) g.on("click", (p) => aoClicar(p.data.chave));
}

/** Série diária. pontos: [[isoData, valor]] (dias sem registro devem vir com 0). */
/**
 * Série diária. pontos: [[isoData, valor]] (dias sem registro com 0).
 * Comparação opcional com o mesmo período do ano anterior:
 *   anterior: [[isoData no eixo atual, valor, isoData real do ano anterior]]
 * A série anterior é tracejada e cinza, com legenda (identidade não depende só da cor).
 */
export function serieDiaria(el, pontos, { unidade = "ocorrências", anterior = null, rotuloAtual = "", rotuloAnterior = "" } = {}) {
  const t = tema();
  const g = iniciar(el);
  const comparar = Array.isArray(anterior) && anterior.length > 0;
  const realAnterior = comparar ? new Map(anterior.map(([x, , real]) => [x, real])) : null;
  const series = [{
    name: rotuloAtual || "Período", type: "line", data: pontos, showSymbol: false, symbolSize: 8, z: 3,
    lineStyle: { width: 2, color: t.serie }, itemStyle: { color: t.serie }, areaStyle: { color: t.serie, opacity: 0.08 },
  }];
  if (comparar) {
    series.push({
      name: rotuloAnterior || "Ano anterior", type: "line", data: anterior.map(([x, v]) => [x, v]), showSymbol: false, z: 2,
      lineStyle: { width: 1.5, color: t.texto3, type: [5, 4] }, itemStyle: { color: t.texto3 },
    });
  }
  g.setOption(
    {
      animationDuration: 300,
      textStyle: { fontFamily: t.fonte },
      legend: comparar ? { top: 0, right: 0, itemWidth: 18, itemHeight: 8, textStyle: { color: t.texto2, fontSize: 12 } } : { show: false },
      grid: { left: 8, right: 16, top: comparar ? 32 : 16, bottom: 8, containLabel: true },
      tooltip: {
        ...tooltipBase(t), trigger: "axis", axisPointer: { type: "line", lineStyle: { color: t.texto3 } },
        formatter: (ps) => ps.map((p) => {
          const dia = p.seriesIndex === 1 ? realAnterior.get(p.value[0]) : p.value[0];
          return `${p.marker}${fmtData(dia)}: <b>${fmt(p.value[1])}</b> ${unidade}`;
        }).join("<br>"),
      },
      xAxis: {
        type: "time", axisLine: { lineStyle: { color: t.grade } }, axisTick: { show: false },
        axisLabel: { color: t.texto3, fontSize: 11.5, formatter: { day: "{dd}/{MM}", month: "{MMM}", year: "{yyyy}" } },
      },
      yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: t.grade } }, axisLabel: { color: t.texto3, fontSize: 11.5 } },
      dataZoom: pontos.length > 60 ? [{ type: "inside" }] : [],
      series,
    },
    true
  );
}

// "DESLIZAMENTO/DESABAMENTO" -> "Deslizamento/Desabamento" (só nomes todos em maiúsculas)
const nomeCurto = (n) => (n === n.toUpperCase() ? n.toLowerCase().replace(/(^|[\s/(])\p{L}/gu, (m) => m.toUpperCase()) : n);

/**
 * Rosca (partes de um todo). itens: [[rotulo, valor]] já ordenados do maior
 * para o menor. Até 6 fatias em cores de ordem fixa; acima disso, o excedente
 * vira "Outros". Cada fatia leva nome e % escritos (não depende só da cor).
 */
export function rosca(el, itens, { unidade = "ocorrências", maxFatias = 6 } = {}) {
  const t = tema();
  const g = iniciar(el);
  let fatias = itens.filter(([, v]) => v > 0);
  if (fatias.length > maxFatias) {
    const resto = fatias.slice(maxFatias - 1).reduce((s, [, v]) => s + v, 0);
    fatias = [...fatias.slice(0, maxFatias - 1), ["Outros", resto]];
  }
  const total = fatias.reduce((s, [, v]) => s + v, 0);
  const cores = [1, 2, 3, 4, 5, 6].map((i) => css(`--cat-${i}`));
  const estreito = el.clientWidth < 520; // celular: legenda embaixo em vez de rótulos em volta
  const valorDe = Object.fromEntries(fatias);
  const pct = (v) => (total ? Math.round((100 * v) / total) : 0);
  g.setOption(
    {
      animationDuration: 300,
      textStyle: { fontFamily: t.fonte },
      tooltip: { ...tooltipBase(t), trigger: "item",
        formatter: (p) => `${p.name}<br><b>${fmt(p.value)}</b> ${unidade} (${p.percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)` },
      legend: estreito ? {
        top: "58%", left: "center", orient: "vertical", type: "plain", icon: "circle", itemWidth: 10, itemHeight: 10, itemGap: 8,
        textStyle: { color: t.texto2, fontSize: 12, fontFamily: t.fonte },
        formatter: (n) => `${nomeCurto(n)}  ${fmt(valorDe[n])} · ${pct(valorDe[n])}%`,
      } : { show: false },
      title: {
        text: fmt(total), subtext: unidade, left: "center", top: estreito ? "22%" : "center", itemGap: 2,
        textStyle: { color: t.texto, fontSize: 22, fontWeight: 600, fontFamily: t.fonte },
        subtextStyle: { color: t.texto3, fontSize: 12, fontFamily: t.fonte },
      },
      series: [{
        type: "pie", radius: estreito ? ["30%", "44%"] : ["48%", "70%"], center: ["50%", estreito ? "30%" : "50%"],
        padAngle: 1.5, minAngle: 2, avoidLabelOverlap: true,
        itemStyle: { borderColor: t.superficie, borderWidth: 2, borderRadius: 4 },
        label: {
          show: !estreito, color: t.texto2, fontSize: 12, lineHeight: 16, alignTo: "edge", edgeDistance: 8,
          formatter: (p) => `${nomeCurto(p.name)}\n{v|${fmt(p.value)} · ${p.percent.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%}`,
          rich: { v: { color: t.texto3, fontSize: 11.5 } },
        },
        labelLine: { show: !estreito, length: 10, length2: 12, lineStyle: { color: t.grade } },
        emphasis: { scaleSize: 4, label: { fontWeight: 600 } },
        data: fatias.map(([nome, valor], i) => ({ name: nome, value: valor, itemStyle: { color: cores.at(i) } })),
      }],
    },
    true
  );
}

/**
 * Colunas agrupadas por mês, uma série por ano (no máximo 3 anos, cores de
 * ordem fixa). series: [[ano, [12 valores]]]. Legenda sempre visível.
 */
export function colunasPorMes(el, series, { unidade = "ocorrências" } = {}) {
  const t = tema();
  const g = iniciar(el);
  const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const cores = [1, 2, 3].map((i) => css(`--cat-${i}`));
  g.setOption(
    {
      animationDuration: 300,
      textStyle: { fontFamily: t.fonte },
      legend: { top: 0, right: 0, icon: "roundRect", itemWidth: 12, itemHeight: 8, textStyle: { color: t.texto2, fontSize: 12 } },
      grid: { left: 8, right: 8, top: 32, bottom: 4, containLabel: true },
      tooltip: { ...tooltipBase(t), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: t.grade, opacity: 0.5 } },
        formatter: (ps) => `${ps[0].axisValue}<br>` + ps.map((p) => `${p.marker}${p.seriesName}: <b>${fmt(p.value)}</b> ${unidade}`).join("<br>") },
      xAxis: { type: "category", data: meses, axisTick: { show: false }, axisLine: { lineStyle: { color: t.grade } },
        axisLabel: { color: t.texto3, fontSize: 11.5 } },
      yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: t.grade } }, axisLabel: { color: t.texto3, fontSize: 11.5 } },
      series: series.slice(-3).map(([ano, valores], i) => ({
        name: String(ano), type: "bar", data: valores, barMaxWidth: 14, barGap: "15%",
        itemStyle: { color: cores.at(i), borderRadius: [4, 4, 0, 0] },
      })),
    },
    true
  );
}

export function redimensionarTodos() {
  instancias.forEach((g) => !g.isDisposed() && g.resize());
}
