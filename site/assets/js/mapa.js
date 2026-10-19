// Mapa coroplético dos 92 municípios (Leaflet). A junção é feita pelo
// código IBGE — nunca pelo nome — para não depender de grafia.
// Cada ambiente cria o seu mapa com criarMapa(); a malha é baixada uma vez só.
import { fmt, titulo } from "./util.js";

let malha = null;
let contorno = null;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// Faixas ajustadas ao recorte: um intervalo fixo não serve para "7 dias" e para "o ano todo" (no ano,
// muitos municípios passam de 100 e o mapa satura). As faixas crescem em progressão geométrica de 1 até
// o maior valor do recorte (cada faixa ~2–4× a anterior) e são arredondadas para números "redondos"
// (1, 2, 5, 10, 20, 25, 50, 100…), então a legenda continua fácil de ler. 0 tem cor própria.
function redondo(x) {
  const p = 10 ** Math.floor(Math.log10(x));
  const cands = [1, 2, 2.5, 5, 10].map((r) => r * p).filter(Number.isInteger);
  return cands.reduce((a, b) => (Math.abs(Math.log(b / x)) < Math.abs(Math.log(a / x)) ? b : a));
}
export function classesPara(valores, n = 6) {
  const max = Math.max(0, ...valores);
  if (max < 1) return [];
  const cortes = [1];
  for (let i = 1; i < n; i++) {
    const c = redondo(max ** (i / n));
    if (c > cortes.at(-1) && c <= max) cortes.push(c);
  }
  return cortes.map((min, i) => ({ min, max: i + 1 < cortes.length ? cortes[i + 1] - 1 : Infinity }));
}
// com menos classes, as cores se espalham pela rampa (a mais alta sempre é --seq-6)
const corDaClasse = (i, total) => css(`--seq-${total <= 1 ? 6 : Math.round(1 + (i * 5) / (total - 1))}`);
function cor(v, classes) {
  if (!v) return css("--seq-0");
  const i = classes.findIndex((c) => v >= c.min && v <= c.max);
  return corDaClasse(i < 0 ? classes.length - 1 : i, classes.length);
}

async function carregarMalha() {
  if (!malha) {
    malha = fetch("assets/geo/rj-municipios.geojson").then((r) => {
      if (!r.ok) throw new Error("malha municipal indisponível");
      return r.json();
    });
  }
  return malha;
}

async function carregarContorno() {
  if (!contorno) {
    contorno = fetch("assets/geo/rj-contorno.geojson").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  return contorno;
}

/** Cria um mapa no elemento. Devolve { pintar(valores, rotulo, unidade), redimensionar() }. */
export async function criarMapa(el, aoClicar) {
  if (!window.L) throw new Error("Leaflet não carregou");
  const geo = await carregarMalha();
  const mapa = L.map(el, { zoomSnap: 0.25, scrollWheelZoom: false });
  // Mapa base é opcional: se o serviço de tiles cair, o coroplético continua visível.
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 13, attribution: "Tiles © Esri · Malha municipal IBGE",
  }).addTo(mapa);
  const camada = L.geoJSON(geo, {
    style: () => ({ weight: 0.9, color: css("--limite-mun"), fillOpacity: 0.9, fillColor: css("--seq-0") }),
    onEachFeature: (f, lyr) => {
      lyr.on("mouseover", () => lyr.setStyle({ weight: 2, color: css("--texto") }).bringToFront());
      lyr.on("mouseout", () => lyr.setStyle({ weight: 0.9, color: css("--limite-mun") }));
      lyr.on("click", () => aoClicar?.(f.properties.id));
    },
  }).addTo(mapa);
  // Contorno do estado por cima de tudo: sem ele, municípios com 0 se confundem com o fundo claro
  const geoContorno = await carregarContorno();
  let linhaEstado = null;
  if (geoContorno) {
    mapa.createPane("contorno").style.zIndex = 450;
    mapa.getPane("contorno").style.pointerEvents = "none";
    linhaEstado = L.geoJSON(geoContorno, {
      pane: "contorno", interactive: false,
      style: () => ({ color: css("--contorno"), weight: 1.6, fill: false, opacity: 1 }),
    }).addTo(mapa);
  }
  const limites = camada.getBounds();
  mapa.fitBounds(limites, { padding: [8, 8] });
  // botão logo abaixo do + / −: volta a enquadrar o estado inteiro com um clique
  const enquadrar = L.control({ position: "topleft" });
  enquadrar.onAdd = () => {
    const div = L.DomUtil.create("div", "leaflet-bar");
    const a = L.DomUtil.create("a", "botao-enquadrar", div);
    a.href = "#";
    a.title = a.ariaLabel = "Enquadrar o estado do RJ";
    a.setAttribute("role", "button");
    a.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`;
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.on(a, "click", (e) => { L.DomEvent.preventDefault(e); mapa.fitBounds(limites, { padding: [8, 8] }); });
    return div;
  };
  enquadrar.addTo(mapa);
  new ResizeObserver(() => mapa.invalidateSize()).observe(el);
  let legenda;

  return {
    redimensionar() {
      mapa.invalidateSize();
      mapa.fitBounds(limites, { padding: [8, 8] });
    },
    /** valores: Map(cod_ibge -> número) */
    pintar(valores, rotulo, unidade, selecionado = "") {
      linhaEstado?.setStyle({ color: css("--contorno") }); // acompanha o tema claro/escuro
      const classes = classesPara(valores.values());
      const maior = Math.max(0, ...valores.values());
      camada.eachLayer((lyr) => {
        const id = lyr.feature.properties.id;
        const v = valores.get(id) || 0;
        lyr.setStyle({ fillColor: cor(v, classes), weight: id === selecionado ? 2.5 : 0.9, color: id === selecionado ? css("--texto") : css("--limite-mun") });
        lyr.bindTooltip(`<b>${titulo(lyr.feature.properties.name)}</b><br>${fmt(v)} ${unidade}`, { sticky: true, className: "dica-mapa" });
      });
      legenda?.remove();
      legenda = L.control({ position: "bottomright" });
      legenda.onAdd = () => {
        const d = L.DomUtil.create("div", "legenda-mapa");
        d.innerHTML = `<b>${rotulo}</b><div><i style="background:${css("--seq-0")}"></i>0</div>` +
          classes.map((c, i) => {
            const ate = c.max === Infinity ? maior : c.max;
            return `<div><i style="background:${corDaClasse(i, classes.length)}"></i>${c.min === ate ? fmt(c.min) : fmt(c.min) + "–" + fmt(ate)}</div>`;
          }).join("") + (classes.length ? `<small>faixas ajustadas ao filtro</small>` : "");
        return d;
      };
      legenda.addTo(mapa);
    },
  };
}
