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
export function serieDiaria(el, pontos, { unidade = "ocorrências" } = {}) {
  const t = tema();
  const g = iniciar(el);
  g.setOption(
    {
      animationDuration: 300,
      textStyle: { fontFamily: t.fonte },
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      tooltip: {
        ...tooltipBase(t), trigger: "axis", axisPointer: { type: "line", lineStyle: { color: t.texto3 } },
        formatter: (ps) => `${fmtData(ps[0].axisValue)}<br><b>${fmt(ps[0].value[1])}</b> ${unidade}`,
      },
      xAxis: {
        type: "time", axisLine: { lineStyle: { color: t.grade } }, axisTick: { show: false },
        axisLabel: { color: t.texto3, fontSize: 11.5, formatter: { day: "{dd}/{MM}", month: "{MMM}", year: "{yyyy}" } },
      },
      yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: t.grade } }, axisLabel: { color: t.texto3, fontSize: 11.5 } },
      dataZoom: pontos.length > 60 ? [{ type: "inside" }] : [],
      series: [{
        type: "line", data: pontos, showSymbol: false, symbolSize: 8, lineStyle: { width: 2, color: t.serie },
        itemStyle: { color: t.serie }, areaStyle: { color: t.serie, opacity: 0.08 },
      }],
    },
    true
  );
}

export function redimensionarTodos() {
  instancias.forEach((g) => !g.isDisposed() && g.resize());
}
