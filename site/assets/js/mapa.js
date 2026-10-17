// Mapa coroplético dos 92 municípios (Leaflet). A junção é feita pelo
// código IBGE — nunca pelo nome — para não depender de grafia.
// Cada ambiente cria o seu mapa com criarMapa(); a malha é baixada uma vez só.
import { fmt, titulo } from "./util.js";

let malha = null;
let contorno = null;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// Classes fixas, para leitura consistente entre dias e entre ambientes.
const CLASSES = [
  { min: 1, max: 1 }, { min: 2, max: 4 }, { min: 5, max: 9 }, { min: 10, max: 24 },
  { min: 25, max: 49 }, { min: 50, max: 99 }, { min: 100, max: Infinity },
];
const passo = (i) => css(`--seq-${Math.min(i + 1, 6)}`);
function cor(v) {
  if (!v) return css("--seq-0");
  return passo(CLASSES.findIndex((c) => v >= c.min && v <= c.max));
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
      camada.eachLayer((lyr) => {
        const id = lyr.feature.properties.id;
        const v = valores.get(id) || 0;
        lyr.setStyle({ fillColor: cor(v), weight: id === selecionado ? 2.5 : 0.9, color: id === selecionado ? css("--texto") : css("--limite-mun") });
        lyr.bindTooltip(`<b>${titulo(lyr.feature.properties.name)}</b><br>${fmt(v)} ${unidade}`, { sticky: true, className: "dica-mapa" });
      });
      legenda?.remove();
      legenda = L.control({ position: "bottomright" });
      legenda.onAdd = () => {
        const d = L.DomUtil.create("div", "legenda-mapa");
        d.innerHTML = `<b>${rotulo}</b><div><i style="background:${css("--seq-0")}"></i>0</div>` +
          CLASSES.map((c, i) => `<div><i style="background:${passo(i)}"></i>${c.max === Infinity ? c.min + "+" : c.min === c.max ? c.min : c.min + "–" + c.max}</div>`).join("");
        return d;
      };
      legenda.addTo(mapa);
    },
  };
}
