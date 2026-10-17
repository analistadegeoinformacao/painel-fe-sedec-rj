import { carregar } from "./dados.js";
import { seguro, kpis, tabela, indisponivel } from "./componentes.js";
import { barrasH, serieDiaria, rosca, redimensionarTodos } from "./graficos.js";
import { criarMapa } from "./mapa.js";
import { fmt, fmtData, fmtMoeda, esc, hojeBRT, somaDias, diasEntre, contarPor, soma, rotuloRedec, titulo } from "./util.js";

// =====================================================================
//  Dois ambientes independentes, cada um com suas abas e seu mapa:
//    sisgeo  — ocorrências do SisGeO (CBMERJ)
//    redecs  — eventos informados pelas REDECs + decretação, resposta, consulta
//  Os filtros (período, REDEC, município) são compartilhados: ao trocar de
//  ambiente o recorte é mantido, para comparar as duas fontes.
// =====================================================================

const AMBIENTES = {
  sisgeo: { abas: ["geral", "tipos", "registros", "qualidade"], conjuntos: ["sisgeo"],
            fonte: "Fonte: SisGeO / CBMERJ — aba SISGEO da planilha NOVA BASE ANALISTAS" },
  redecs: { abas: ["geral", "decretos", "resposta", "registros", "consulta", "qualidade"],
            conjuntos: ["eventos", "boletins", "danos_humanos", "decretos", "decretos_historico", "alertas",
                        "ajuda_humanitaria", "pontos_apoio", "severidade", "s2id", "chuva_24h", "chuva_1h"],
            fonte: "Fonte: REDECs / SEDEC-RJ — planilha NOVA BASE ANALISTAS · S2iD" },
};

const st = { amb: "sisgeo", aba: "geral", de: "", ate: "", periodo: "tudo", redec: "", municipio: "", tipo: "", camada: "eventos" };
const ultimaAba = { sisgeo: "geral", redecs: "geral" };
let BASE = null;
let redecDoCod = new Map();
const mapas = {}; // amb -> Promise<mapa>

// ----------------------------------------------------------------- URL
// #amb=redecs&aba=decretos&redec=... -> cada ambiente/recorte tem seu próprio link
function lerURL() {
  const p = new URLSearchParams(location.hash.slice(1));
  for (const k of Object.keys(st)) if (p.has(k)) st[k] = p.get(k);
  if (!AMBIENTES[st.amb]) st.amb = "sisgeo";
  if (!AMBIENTES[st.amb].abas.includes(st.aba)) st.aba = "geral";
  if (p.has("de") || p.has("ate")) st.periodo = p.get("periodo") || "";
}
function gravarURL() {
  const p = new URLSearchParams();
  const padrao = { aba: "geral", periodo: "tudo", camada: "eventos" };
  for (const [k, v] of Object.entries(st)) if (v && padrao[k] !== v) p.set(k, v);
  history.replaceState(null, "", "#" + p.toString());
}

// ------------------------------------------------------------- filtros
const CAMPO_DATA = {
  sisgeo: (l) => l.data_ocorrencia?.slice(0, 10), eventos: (l) => l.data, boletins: (l) => l.data,
  alertas: (l) => l.data, ajuda_humanitaria: (l) => l.data, pontos_apoio: (l) => l.data,
};

function filtrar(nome, { comPeriodo = true } = {}) {
  const linhas = BASE.dados[nome];
  if (linhas === null || linhas === undefined) return null;
  const fd = CAMPO_DATA[nome];
  return linhas.filter((l) => {
    if (comPeriodo && fd && (st.de || st.ate)) {
      const d = fd(l);
      if (!d || (st.de && d < st.de) || (st.ate && d > st.ate)) return false;
    }
    if (st.redec && (l.redec ?? redecDoCod.get(l.cod_ibge)) !== st.redec) return false;
    if (st.municipio && l.cod_ibge !== st.municipio) return false;
    if (st.tipo && nome === "sisgeo" && l.tipo !== st.tipo) return false; // filtro só do ambiente SisGeO
    return true;
  });
}

function aplicarPeriodo(p) {
  st.periodo = p;
  const hoje = hojeBRT();
  if (p === "tudo") { st.de = ""; st.ate = ""; }
  else if (p === "ano") { st.de = hoje.slice(0, 4) + "-01-01"; st.ate = hoje; }
  else { st.de = somaDias(hoje, -(Number(p) - 1)); st.ate = hoje; }
}
const descricaoPeriodo = () =>
  !st.de && !st.ate ? "todo o período" : `${st.de ? fmtData(st.de) : "início"} a ${st.ate ? fmtData(st.ate) : "hoje"}`;

function preencherMunicipios() {
  const sel = document.getElementById("f-municipio");
  sel.length = 1;
  BASE.meta.municipios.filter((m) => !st.redec || m.redec === st.redec)
    .forEach((m) => sel.add(new Option(titulo(m.municipio), m.cod_ibge)));
}

function montarFiltros() {
  const selR = document.getElementById("f-redec");
  BASE.meta.redecs.forEach((r) => selR.add(new Option(rotuloRedec(r), r)));
  preencherMunicipios();
  document.querySelector(".filtros__periodo").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) { aplicarPeriodo(b.dataset.periodo); atualizar(); }
  });
  document.getElementById("f-de").addEventListener("change", (e) => { st.de = e.target.value; st.periodo = ""; atualizar(); });
  document.getElementById("f-ate").addEventListener("change", (e) => { st.ate = e.target.value; st.periodo = ""; atualizar(); });
  selR.addEventListener("change", (e) => { st.redec = e.target.value; st.municipio = ""; preencherMunicipios(); atualizar(); });
  document.getElementById("f-municipio").addEventListener("change", (e) => { st.municipio = e.target.value; atualizar(); });
  const selT = document.getElementById("f-tipo");
  ordenar(contarPor(BASE.dados.sisgeo || [], "tipo")).forEach(([t]) => selT.add(new Option(t, t)));
  selT.addEventListener("change", (e) => { st.tipo = e.target.value; atualizar(); });
  document.getElementById("f-limpar").addEventListener("click", () => {
    Object.assign(st, { de: "", ate: "", periodo: "tudo", redec: "", municipio: "", tipo: "" });
    preencherMunicipios();
    atualizar();
  });
}

function sincronizarControles() {
  document.body.dataset.amb = st.amb;
  document.getElementById("f-de").value = st.de;
  document.getElementById("f-ate").value = st.ate;
  document.getElementById("f-redec").value = st.redec;
  document.getElementById("f-municipio").value = st.municipio;
  document.getElementById("f-tipo").value = st.tipo;
  document.querySelectorAll(".filtros__periodo button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.periodo === st.periodo));
  document.querySelectorAll(".ambientes a").forEach((a) => (a.dataset.amb === st.amb ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  document.querySelectorAll(".abas [role=tab]").forEach((b) => {
    b.hidden = b.dataset.amb !== st.amb;
    b.setAttribute("aria-selected", b.dataset.amb === st.amb && b.dataset.aba === st.aba);
  });
  document.querySelectorAll(".painel-aba").forEach((s) => (s.hidden = !(s.dataset.amb === st.amb && s.dataset.aba === st.aba)));
  document.querySelectorAll("[data-mapa]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mapa === st.camada));
  document.getElementById("rodape-fonte").textContent = AMBIENTES[st.amb].fonte;
}

// ---------------------------------------------------------- utilitários
const porDia = (linhas, fd) => {
  const c = contarPor(linhas, fd);
  if (!c.size) return [];
  const dias = [...c.keys()].sort();
  const out = [];
  for (let d = st.de || dias[0], fim = st.ate || dias.at(-1); d <= fim; d = somaDias(d, 1)) out.push([d, c.get(d) || 0]);
  return out;
};
const ordenar = (mapa, n = Infinity) => [...mapa.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const nomeMun = (cod) => titulo(BASE.meta.municipios.find((m) => m.cod_ibge === cod)?.municipio || cod);
const alternarRedec = (r) => { st.redec = st.redec === r ? "" : r; st.municipio = ""; preencherMunicipios(); atualizar(); };
const alternarMunicipio = (cod) => { st.municipio = st.municipio === cod ? "" : cod; atualizar(); };
const porRedec = (linhas) => { const c = contarPor(linhas, "redec"); return BASE.meta.redecs.map((r) => [rotuloRedec(r), c.get(r) || 0, r]); };
const muns = (linhas) => new Set((linhas || []).map((l) => l.cod_ibge).filter(Boolean)).size;

function vigencia(l) {
  if (!l.termino) return { rotulo: "Sem término informado", classe: "neutro", dias: null };
  const dias = diasEntre(hojeBRT(), l.termino);
  if (dias < 0) return { rotulo: "Encerrado", classe: "neutro", dias };
  if (dias <= 15) return { rotulo: `Vence em ${dias} d`, classe: "atencao", dias };
  return { rotulo: `Vigente (${dias} d)`, classe: "ok", dias };
}
const vigente = (l) => (vigencia(l).dias ?? -1) >= 0;

function mapaDo(amb, id) {
  if (!mapas[amb]) {
    mapas[amb] = criarMapa(document.getElementById(id), alternarMunicipio).catch((e) => {
      console.error(e);
      document.getElementById(id).innerHTML = `<div class="falha">Mapa indisponível.</div>`;
      return null;
    });
  }
  return mapas[amb];
}

function qualidade(el, chaves) {
  const av = BASE.meta.avisos || {};
  const blocos = chaves.map((k) => [k, av[k] || []]).filter(([, v]) => v.length);
  const falhas = BASE.falhas.filter((f) => chaves.includes(f));
  el.className = "qualidade";
  el.innerHTML = (falhas.length ? `<h3>Bases que não carregaram</h3><ul>${falhas.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : "") +
    (blocos.length
      ? blocos.map(([k, v]) => `<h3>${esc(BASE.meta.conjuntos[k]?.titulo || k)} <span class="dica">aba “${esc(BASE.meta.conjuntos[k]?.aba || "")}”</span></h3><ul>${v.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>`).join("")
      : `<div class="vazio">Nenhum problema encontrado na última atualização.</div>`);
}

// ===================================================== AMBIENTE SISGEO
const COLUNAS_SISGEO = [
  { campo: "data_ocorrencia", titulo: "Data", formato: fmtData }, { campo: "ocorrencia", titulo: "Ocorrência" },
  { campo: "municipio", titulo: "Município", formato: titulo }, { campo: "redec", titulo: "REDEC", formato: rotuloRedec },
  { campo: "tipo", titulo: "Tipo" }, { campo: "subtipo", titulo: "Subtipo" }, { campo: "unidade", titulo: "Unidade" },
  { campo: "situacao", titulo: "Situação" }, { campo: "vitimas", titulo: "Vítimas", tipo: "num" },
];

const SISGEO = {
  geral() {
    const sis = filtrar("sisgeo");
    seguro("s-kpis", (el) => {
      // o que mais aparece em cada dimensão, com quantidade e % do total filtrado
      const lider = (campo, nomear = (v) => v) => {
        if (!sis?.length) return { valor: "—", sub: "sem ocorrências no recorte" };
        const [k, n] = ordenar(contarPor(sis, campo), 1)[0] || [];
        if (!k) return { valor: "—", sub: "não informado" };
        return { valor: nomear(k), sub: `${fmt(n)} de ${fmt(sis.length)} ocorrências (${Math.round((100 * n) / sis.length)}%)` };
      };
      kpis(el, [
        { rotulo: "Tipo mais frequente", texto: true, destaque: true, ...lider("tipo") },
        { rotulo: "Subtipo mais frequente", texto: true, ...lider("subtipo") },
        { rotulo: "Município com mais ocorrências", texto: true, ...lider("cod_ibge", nomeMun) },
        { rotulo: "REDEC com mais ocorrências", texto: true, ...lider("redec", rotuloRedec) },
      ]);
    });
    seguro("s-redec", (el) => { if (!indisponivel(el, sis)) barrasH(el, porRedec(sis), { aoClicar: alternarRedec, selecionado: st.redec, unidade: "ocorrências" }); });
    seguro("s-serie", (el) => { if (!indisponivel(el, sis)) serieDiaria(el, porDia(sis, CAMPO_DATA.sisgeo)); });
    seguro("s-top-mun", (el) => {
      if (indisponivel(el, sis)) return;
      barrasH(el, ordenar(contarPor(sis, "cod_ibge"), 10).map(([k, v]) => [nomeMun(k), v, k]),
        { aoClicar: alternarMunicipio, selecionado: st.municipio, unidade: "ocorrências" });
    });
    mapaDo("sisgeo", "s-mapa").then((m) => m?.pintar(contarPor(sis || [], "cod_ibge"), "Ocorrências", "ocorrência(s)", st.municipio));
  },
  tipos() {
    const sis = filtrar("sisgeo");
    seguro("s-tipo", (el) => { if (!indisponivel(el, sis)) rosca(el, ordenar(contarPor(sis, "tipo")), { unidade: "ocorrências" }); });
    seguro("s-subtipo", (el) => { if (!indisponivel(el, sis)) barrasH(el, ordenar(contarPor(sis, "subtipo"), 10), { unidade: "ocorrências" }); });
    seguro("s-tipos-mun", (el) => {
      if (indisponivel(el, sis)) return;
      barrasH(el, ordenar(contarPor(sis, "cod_ibge"), 10).map(([k, v]) => [nomeMun(k), v, k]),
        { aoClicar: alternarMunicipio, selecionado: st.municipio, unidade: "ocorrências" });
    });
    seguro("s-tipos-redec", (el) => { if (!indisponivel(el, sis)) barrasH(el, porRedec(sis), { aoClicar: alternarRedec, selecionado: st.redec, unidade: "ocorrências" }); });
  },
  registros() {
    seguro("s-tabela", (el) => tabela(el, { nome: "sisgeo", linhas: filtrar("sisgeo"), ordem: { campo: "data_ocorrencia", dir: -1 }, colunas: COLUNAS_SISGEO }));
  },
  qualidade() { seguro("s-qualidade", (el) => qualidade(el, AMBIENTES.sisgeo.conjuntos)); },
};

// ===================================================== AMBIENTE REDECS
const NATUREZAS = [["inundacao", "Inundação / alagamento"], ["deslizamento", "Deslizamento"], ["desabamento", "Desabamento"],
  ["destelhamento", "Destelhamento"], ["salvamento", "Salvamento de pessoa"], ["queda_arvore", "Queda de árvore"], ["outros", "Outros"]];

const REDECS = {
  geral() {
    const ev = filtrar("eventos"), dec = filtrar("decretos", { comPeriodo: false }), dh = filtrar("danos_humanos", { comPeriodo: false });
    seguro("r-kpis", (el) => kpis(el, [
      { rotulo: "Eventos", valor: ev?.length ?? "—", sub: descricaoPeriodo(), destaque: true },
      { rotulo: "Municípios atingidos", valor: ev ? muns(ev) : "—", sub: "de 92 no estado" },
      { rotulo: "Decretos vigentes", valor: dec ? dec.filter(vigente).length : "—", sub: "situação hoje" },
      { rotulo: "Desabrigados", valor: dh ? soma(dh, "desabrigados") : "—", sub: "consolidado" },
      { rotulo: "Desalojados", valor: dh ? soma(dh, "desalojados") : "—", sub: "consolidado" },
      { rotulo: "Óbitos", valor: dh ? soma(dh, "obitos") : "—", sub: "consolidado" },
    ]));
    seguro("r-redec", (el) => { if (!indisponivel(el, ev)) barrasH(el, porRedec(ev), { aoClicar: alternarRedec, selecionado: st.redec, unidade: "eventos" }); });
    seguro("r-serie", (el) => { if (!indisponivel(el, ev)) serieDiaria(el, porDia(ev, CAMPO_DATA.eventos), { unidade: "eventos" }); });
    seguro("r-natureza", (el) => {
      if (indisponivel(el, ev)) return;
      barrasH(el, NATUREZAS.map(([k, r]) => [r, soma(ev, k)]).sort((a, b) => b[1] - a[1]), { unidade: "ocorrências" });
    });
    mapaDo("redecs", "r-mapa").then((m) => {
      if (!m) return;
      if (st.camada === "decretos") {
        const v = new Map();
        (dec || []).filter(vigente).forEach((l) => v.set(l.cod_ibge, 1));
        m.pintar(v, "Decretos vigentes", "decreto(s) vigente(s)", st.municipio);
      } else {
        m.pintar(contarPor(ev || [], "cod_ibge"), "Eventos", "evento(s)", st.municipio);
      }
    });
  },
  decretos() {
    const dec = filtrar("decretos", { comPeriodo: false });
    const comV = (dec || []).map((l) => ({ ...l, _v: vigencia(l) }));
    seguro("r-kpis-decretos", (el) => kpis(el, [
      { rotulo: "Decretos registrados", valor: dec?.length ?? "—", destaque: true },
      { rotulo: "Vigentes hoje", valor: comV.filter((l) => (l._v.dias ?? -1) >= 0).length },
      { rotulo: "Vencem em até 15 dias", valor: comV.filter((l) => l._v.classe === "atencao").length },
      { rotulo: "Encerrados", valor: comV.filter((l) => l._v.rotulo === "Encerrado").length },
    ]));
    seguro("r-decretos", (el) => tabela(el, {
      nome: "decretos", linhas: dec === null ? null : comV, ordem: { campo: "termino", dir: 1 },
      colunas: [
        { campo: "municipio", titulo: "Município", formato: titulo }, { campo: "redec", titulo: "REDEC", formato: rotuloRedec },
        { campo: "decreto", titulo: "Decreto" }, { campo: "nivel", titulo: "Nível", tipo: "num" },
        { campo: "data_decreto", titulo: "Decretação", formato: fmtData }, { campo: "prazo_dias", titulo: "Prazo (d)", tipo: "num" },
        { campo: "termino", titulo: "Término", formato: fmtData },
        { campo: "_v", titulo: "Situação", tipo: "html", formato: (v) => `<span class="chip chip--${v.classe}">${esc(v.rotulo)}</span>` },
      ],
    }));
  },
  resposta() {
    const aj = filtrar("ajuda_humanitaria"), pa = filtrar("pontos_apoio"), al = filtrar("alertas"), sev = filtrar("severidade", { comPeriodo: false });
    seguro("r-kpis-resposta", (el) => kpis(el, [
      { rotulo: "Ações de ajuda humanitária", valor: aj?.length ?? "—", destaque: true },
      { rotulo: "Pontos de apoio", valor: pa?.length ?? "—" },
      { rotulo: "Dias com alerta IDAP", valor: al ? al.filter((l) => l.idap).length : "—" },
      { rotulo: "Envios Cell Broadcast", valor: al ? soma(al, "cell_broadcast") : "—" },
    ]));
    seguro("r-ajuda", (el) => tabela(el, {
      nome: "ajuda_humanitaria", linhas: aj, porPagina: 15, ordem: { campo: "data", dir: -1 },
      colunas: [{ campo: "data", titulo: "Data", formato: fmtData }, { campo: "municipio", titulo: "Município", formato: titulo },
        { campo: "acao", titulo: "Ação", tipo: "longo" }, { campo: "setor", titulo: "Setor" }],
    }));
    seguro("r-pontos", (el) => tabela(el, {
      nome: "pontos_apoio", linhas: pa, porPagina: 15, ordem: { campo: "data", dir: -1 },
      colunas: [{ campo: "data", titulo: "Data", formato: fmtData }, { campo: "municipio", titulo: "Município", formato: titulo },
        { campo: "bairro", titulo: "Bairro" }, { campo: "ponto", titulo: "Ponto de apoio" }],
    }));
    seguro("r-severidade", (el) => tabela(el, {
      nome: "severidade", linhas: sev, porPagina: 20,
      colunas: [{ campo: "redec", titulo: "REDEC", formato: rotuloRedec }, { campo: "severidade", titulo: "Severidade" }],
    }));
  },
  registros() {
    seguro("r-tabela", (el) => tabela(el, {
      nome: "eventos_redecs", linhas: filtrar("eventos"), ordem: { campo: "data", dir: -1 },
      colunas: [
        { campo: "data", titulo: "Data", formato: fmtData }, { campo: "hora", titulo: "Hora" },
        { campo: "municipio", titulo: "Município", formato: titulo }, { campo: "redec", titulo: "REDEC", formato: rotuloRedec },
        { campo: "descricao", titulo: "Descrição", tipo: "longo" },
        { campo: "desabrigados", titulo: "Desabrig.", tipo: "num" }, { campo: "desalojados", titulo: "Desaloj.", tipo: "num" },
        { campo: "obitos", titulo: "Óbitos", tipo: "num" }, { campo: "total_ocorrencias", titulo: "Ocorr.", tipo: "num" },
      ],
    }));
  },
  consulta() {
    const BASES = {
      s2id: { nota: "Registros do S2iD com danos, prejuízos, homologação e reconhecimento.", colunas: [
        { campo: "municipio", titulo: "Município", formato: titulo }, { campo: "desalojados", titulo: "Desaloj.", tipo: "num" },
        { campo: "desabrigados", titulo: "Desabrig.", tipo: "num" }, { campo: "afetados", titulo: "Afetados", tipo: "num" },
        { campo: "obitos", titulo: "Óbitos", tipo: "num" }, { campo: "danos_materiais", titulo: "Danos materiais", formato: fmtMoeda },
        { campo: "prejuizo_publico", titulo: "Prej. público", formato: fmtMoeda }, { campo: "prejuizo_privado", titulo: "Prej. privado", formato: fmtMoeda },
        { campo: "homologacao", titulo: "Homologação estadual", tipo: "longo" }, { campo: "reconhecimento", titulo: "Reconhecimento federal", tipo: "longo" },
        { campo: "fide", titulo: "FIDE", tipo: "longo" }] },
      decretos_historico: { nota: "Todos os decretos já registrados, inclusive encerrados.", colunas: [
        { campo: "municipio", titulo: "Município", formato: titulo }, { campo: "redec", titulo: "REDEC", formato: rotuloRedec },
        { campo: "decreto", titulo: "Decreto" }, { campo: "nivel", titulo: "Nível", tipo: "num" },
        { campo: "data_decreto", titulo: "Decretação", formato: fmtData }, { campo: "termino", titulo: "Término", formato: fmtData }] },
      danos_humanos: { nota: "Consolidado de danos humanos por município.", colunas: [
        { campo: "municipio", titulo: "Município", formato: titulo }, { campo: "redec", titulo: "REDEC", formato: rotuloRedec },
        { campo: "desalojados", titulo: "Desalojados", tipo: "num" }, { campo: "desabrigados", titulo: "Desabrigados", tipo: "num" },
        { campo: "afetados", titulo: "Afetados", tipo: "num" }, { campo: "obitos", titulo: "Óbitos", tipo: "num" }] },
      boletins: { nota: "Boletins sem município na aba EVENTOS REDECS (sirenes CEMADEN-RJ, Cell Broadcast).", colunas: [
        { campo: "data", titulo: "Data", formato: fmtData }, { campo: "hora", titulo: "Hora" }, { campo: "descricao", titulo: "Boletim", tipo: "longo" }] },
      alertas: { nota: "Registro diário de alertas.", colunas: [
        { campo: "data", titulo: "Data", formato: fmtData }, { campo: "idap", titulo: "IDAP", formato: (v) => (v === true ? "Sim" : v === false ? "Não" : "—") },
        { campo: "cell_broadcast", titulo: "Cell Broadcast", tipo: "num" }] },
    };
    const sel = document.getElementById("r-base");
    if (!sel.length) {
      Object.keys(BASES).forEach((k) => sel.add(new Option(BASE.meta.conjuntos[k]?.titulo || k, k)));
      sel.addEventListener("change", () => REDECS.consulta());
    }
    const b = BASES[sel.value];
    document.getElementById("r-nota").textContent = b.nota;
    seguro("r-consulta", (el) => tabela(el, { nome: sel.value, linhas: filtrar(sel.value), colunas: b.colunas }));
  },
  qualidade() { seguro("r-qualidade", (el) => qualidade(el, AMBIENTES.redecs.conjuntos)); },
};

const RENDER = { sisgeo: SISGEO, redecs: REDECS };

// ------------------------------------------------ dados novos
// O GitHub consulta a planilha a cada ~10 min e só republica quando algo mudou.
// O botão "Atualizar" busca na hora a versão mais recente publicada; um painel
// deixado aberto também confere sozinho a cada 5 min.
async function verificarDadosNovos() {
  const r = await fetch(`data/meta.json?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`meta.json: HTTP ${r.status}`);
  const meta = await r.json();
  if (meta.gerado_em === BASE.meta.gerado_em) return false;
  const nova = await carregar();
  BASE.meta = nova.meta;
  BASE.dados = nova.dados;
  BASE.falhas = nova.falhas;
  status(BASE.meta);
  atualizar();
  return true;
}

function montarBotaoAtualizar() {
  const botao = document.getElementById("botao-atualizar");
  const rotulo = botao.querySelector("span");
  const el = document.getElementById("status-dados");
  botao.hidden = false;
  botao.addEventListener("click", async () => {
    rotulo.textContent = "Buscando…";
    botao.disabled = true;
    botao.classList.add("girando");
    let msg;
    try {
      msg = (await verificarDadosNovos()) ? "Dados novos carregados" : "Já está com os dados mais recentes";
    } catch (e) {
      console.error("[painel] atualizar:", e);
      msg = "Sem conexão com o site agora";
    }
    botao.classList.remove("girando");
    botao.disabled = false;
    rotulo.textContent = "Atualizar";
    el.textContent = msg;
    setTimeout(() => status(BASE.meta), 4000);
  });
}

function atualizar() {
  sincronizarControles();
  gravarURL();
  RENDER[st.amb][st.aba]?.();
}

function trocarAmbiente(amb) {
  if (!AMBIENTES[amb] || amb === st.amb) return;
  ultimaAba[st.amb] = st.aba;
  st.amb = amb;
  st.aba = ultimaAba[amb];
  atualizar();
  requestAnimationFrame(() => {
    redimensionarTodos();
    mapas[amb]?.then((m) => m?.redimensionar());
  });
}

function status(meta) {
  const el = document.getElementById("status-dados");
  const gerado = new Date(meta.gerado_em);
  const horas = (Date.now() - gerado) / 3.6e6;
  const quando = gerado.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  el.textContent = `Dados de ${quando}`;
  el.dataset.estado = horas > 3 ? "antigo" : "ok";
  if (horas > 3) el.textContent += " · atualização atrasada";
  for (const [amb, cfg] of Object.entries(AMBIENTES)) {
    const n = cfg.conjuntos.reduce((t, k) => t + (meta.avisos?.[k]?.length || 0), 0);
    document.querySelector(`[data-avisos="${amb}"]`).textContent = n || "";
  }
  document.getElementById("rodape-versao").textContent = `Atualizado em ${gerado.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`;
}

// ---------------------------------------------------------------- início
async function iniciar() {
  lerURL();
  try {
    BASE = await carregar();
  } catch (e) {
    console.error(e);
    const el = document.getElementById("status-dados");
    el.textContent = "Falha ao carregar os dados";
    el.dataset.estado = "erro";
    document.getElementById("conteudo").innerHTML = `<div class="falha">Não foi possível carregar os dados do painel. Tente recarregar a página.</div>`;
    return;
  }
  redecDoCod = new Map(BASE.meta.municipios.map((m) => [m.cod_ibge, m.redec]));
  status(BASE.meta);
  montarFiltros();
  montarBotaoAtualizar();
  // painel aberto numa tela: confere a cada 5 min se há dados novos e recarrega sozinho
  setInterval(() => verificarDadosNovos().catch(() => {}), 5 * 60 * 1000);

  document.querySelector(".ambientes").addEventListener("click", (e) => {
    const a = e.target.closest("a[data-amb]");
    if (!a) return;
    e.preventDefault();
    trocarAmbiente(a.dataset.amb);
  });
  document.querySelector(".abas").addEventListener("click", (e) => {
    const b = e.target.closest("[role=tab]");
    if (!b) return;
    st.aba = b.dataset.aba;
    atualizar();
    requestAnimationFrame(redimensionarTodos);
  });
  document.querySelector(".alternador").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mapa]");
    if (b) { st.camada = b.dataset.mapa; atualizar(); }
  });
  // link colado de outro ambiente (#amb=redecs) com a página já aberta
  window.addEventListener("hashchange", () => {
    const amb = new URLSearchParams(location.hash.slice(1)).get("amb") || "sisgeo";
    if (amb !== st.amb) trocarAmbiente(amb);
  });

  atualizar();
  window.__painelPronto = true; // usado pelo teste automatizado
}

document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", iniciar) : iniciar();
