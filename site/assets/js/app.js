import { carregar } from "./dados.js";
import { seguro, kpis, tabela, indisponivel, multiSelecao } from "./componentes.js";
import { barrasH, serieDiaria, rosca, colunasPorMes, redimensionarTodos } from "./graficos.js";
import { criarMapa } from "./mapa.js";
import { iniciarAnalytics, registrarAba } from "./analytics.js";
import { fmt, fmtData, fmtMoeda, esc, hojeBRT, somaDias, diasEntre, contarPor, soma, rotuloRedec, titulo } from "./util.js";

// =====================================================================
//  Três ambientes independentes, cada um com suas abas e seu mapa:
//    sisgeo  — ocorrências do SisGeO (CBMERJ) — planilha NOVA BASE ANALISTAS
//    redecs  — eventos informados pelas REDECs + decretação, resposta, consulta
//    fogo    — fogo em vegetação (SisGeO) — PLANILHA FOGO EM VEGETAÇÃO
//  Os filtros (período, REDEC, município) são compartilhados: ao trocar de
//  ambiente o recorte é mantido, para comparar as duas fontes.
// =====================================================================

const AMBIENTES = {
  sisgeo: { abas: ["geral", "tipos", "registros", "depuracao", "qualidade"], conjuntos: ["sisgeo", "nivel_resposta"],
            fonte: "Fonte: SISGEO/CBMERJ | CEMADEN-RJ | INMET" },
  redecs: { abas: ["geral", "decretos", "resposta", "registros", "consulta", "qualidade"],
            conjuntos: ["eventos", "boletins", "danos_humanos", "danos_historico", "decretos", "decretos_historico", "alertas",
                        "ajuda_humanitaria", "pontos_apoio", "severidade", "s2id", "chuva_24h", "chuva_1h", "nivel_resposta", "alertas_msg"],
            fonte: "Fonte: SISGEO/CBMERJ | CEMADEN-RJ | INMET" },
  fogo:   { abas: ["geral", "territorios", "condicoes", "registros", "depuracao", "qualidade"],
            conjuntos: ["fogo_sisgeo", "fogo_abertos", "fogo_risco", "fogo_temperatura", "fogo_umidade", "fogo_nivel_resposta", "fogo_ultimo_dia", "fogo"],
            fonte: "Fonte: SISGEO/CBMERJ | CEMADEN-RJ | INMET" },
};

const st = { amb: "sisgeo", aba: "geral", de: "", ate: "", periodo: "tudo", redec: "", municipio: "", tipo: "", camada: "eventos", apoio: "", alerta: "", decretos: "", danos: "", evol: "" };
const ultimaAba = { sisgeo: "geral", redecs: "geral", fogo: "geral" };
let BASE = null;
let redecDoCod = new Map();
const mapas = {}; // amb -> Promise<mapa>
// REDEC e município aceitam várias escolhas: no estado (e no link) ficam como lista separada por vírgula
const lista = (v) => (v ? String(v).split(",").filter(Boolean) : []);
const redecsSel = () => lista(st.redec);
const munsSel = () => lista(st.municipio);
let ctrlRedec, ctrlMun;

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
  fogo_sisgeo: (l) => l.data_ocorrencia?.slice(0, 10), fogo_abertos: (l) => l.data_ocorrencia?.slice(0, 10),
  fogo_temperatura: (l) => l.data, fogo_umidade: (l) => l.data,
  sisgeo: (l) => l.data_ocorrencia?.slice(0, 10), eventos: (l) => l.data, boletins: (l) => l.data,
  alertas: (l) => l.data, alertas_msg: (l) => l.data, ajuda_humanitaria: (l) => l.data, pontos_apoio: (l) => l.data,
};

// Depuração do SisGeO (feita no ETL): linhas com "depuracao" (situacao | motivo | ambos) não contam
// em nenhum painel; só aparecem na aba Depuração (depuracao: "excluidas").
function filtrar(nome, { comPeriodo = true, depuracao = "validas", semTipo = false } = {}) {
  const linhas = BASE.dados[nome];
  if (linhas === null || linhas === undefined) return null;
  const fd = CAMPO_DATA[nome];
  const rs = redecsSel(), ms = munsSel();
  return linhas.filter((l) => {
    if (depuracao === "validas" && l.depuracao) return false;
    if (depuracao === "excluidas" && !l.depuracao) return false;
    if (comPeriodo && fd && (st.de || st.ate)) {
      const d = fd(l);
      if (!d || (st.de && d < st.de) || (st.ate && d > st.ate)) return false;
    }
    if (nome === "alertas_msg") {
      // mensagem sem local identificado vale para o estado todo; IDAP por região vale para a REDEC citada
      if (ms.length && l.municipios.length && !l.municipios.some((c) => ms.includes(c))) return false;
      if (ms.length && !l.municipios.length && l.redecs.length && !l.redecs.some((r) => ms.some((c) => redecDoCod.get(c) === r))) return false;
      if (rs.length && l.redecs.length && !l.redecs.some((r) => rs.includes(r))) return false;
      return true;
    }
    if (rs.length && !rs.includes(l.redec ?? redecDoCod.get(l.cod_ibge))) return false;
    if (ms.length && !ms.includes(l.cod_ibge)) return false;
    if (st.tipo && !semTipo && nome === "sisgeo" && l.tipo !== st.tipo) return false; // filtro só do ambiente SisGeO
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

// municípios oferecidos = os das REDECs escolhidas (todos, se nenhuma); escolhas fora delas saem
function preencherMunicipios() {
  const rs = redecsSel();
  const ops = BASE.meta.municipios.filter((m) => !rs.length || rs.includes(m.redec))
    .map((m) => ({ valor: m.cod_ibge, rotulo: titulo(m.municipio) }));
  st.municipio = ctrlMun.opcoes(ops, munsSel()).join(",");
}

function montarFiltros() {
  ctrlRedec = multiSelecao(document.getElementById("f-redec"), { todos: "Todas", plural: "selecionadas",
    aoMudar: (v) => { st.redec = v.join(","); preencherMunicipios(); atualizar(); } });
  ctrlMun = multiSelecao(document.getElementById("f-municipio"), { todos: "Todos", plural: "selecionados", busca: true,
    aoMudar: (v) => { st.municipio = v.join(","); atualizar(); } });
  ctrlRedec.opcoes(BASE.meta.redecs.map((r) => ({ valor: r, rotulo: rotuloRedec(r) })), redecsSel());
  preencherMunicipios();
  document.querySelector(".filtros__periodo").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) { aplicarPeriodo(b.dataset.periodo); atualizar(); }
  });
  document.getElementById("f-de").addEventListener("change", (e) => { st.de = e.target.value; st.periodo = ""; atualizar(); });
  document.getElementById("f-ate").addEventListener("change", (e) => { st.ate = e.target.value; st.periodo = ""; atualizar(); });
  const selT = document.getElementById("f-tipo");
  ordenar(contarPor((BASE.dados.sisgeo || []).filter((l) => !l.depuracao), "tipo")).forEach(([t]) => selT.add(new Option(t, t)));
  selT.addEventListener("change", (e) => { st.tipo = e.target.value; atualizar(); });
  document.getElementById("f-limpar").addEventListener("click", () => {
    Object.assign(st, { de: "", ate: "", periodo: "tudo", redec: "", municipio: "", tipo: "", apoio: "", alerta: "", decretos: "", danos: "", evol: "" });
    preencherMunicipios();
    atualizar();
  });
}

function sincronizarControles() {
  document.body.dataset.amb = st.amb;
  document.getElementById("f-de").value = st.de;
  document.getElementById("f-ate").value = st.ate;
  ctrlRedec.marcar(redecsSel());
  ctrlMun.marcar(munsSel());
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
// Fogo em vegetação: ocorrências/dia no estado que indicam a Operação Extinctus (linha de referência)
const INDICATIVO_EXTINCTUS = 70;
// ---- comparação com o mesmo período do ano anterior (cartões "por dia")
// Janela: o período escolhido no filtro; em "Tudo", o ano mais recente dos dados (1º jan → último dia).
// A série anterior respeita REDEC/município/tipo, mas não o filtro de período (é deslocada 1 ano).
const menosUmAno = (iso) => {
  const [a, m, d] = iso.split("-");
  return `${Number(a) - 1}-${m}-${m === "02" && d === "29" ? "28" : d}`;
};
function comparativoDiario(nome, campoData, idNota, unidade) {
  const linhas = filtrar(nome, { comPeriodo: false });
  if (!linhas?.length) return null;
  const datas = linhas.map(campoData).filter(Boolean).sort();
  const maxData = datas.at(-1);
  let ini, fim;
  if (st.de || st.ate) { ini = st.de || datas[0]; fim = st.ate || maxData; }
  else {
    // até hoje (se o ano for o atual): dias após o último dado ficam sem ponto, como "ainda sem dados"
    const hoje = hojeBRT();
    ini = `${maxData.slice(0, 4)}-01-01`;
    fim = hoje.slice(0, 4) === maxData.slice(0, 4) && hoje > maxData ? hoje : maxData;
  }
  const c = contarPor(linhas, campoData);
  const pontos = [], anterior = [];
  let tA = 0, tB = 0;
  for (let d = ini; d <= fim; d = somaDias(d, 1)) {
    const a = d > maxData ? null : c.get(d) || 0, dAnt = menosUmAno(d), b = c.get(dAnt) || 0;
    tA += a || 0; tB += b;
    pontos.push([d, a]);
    anterior.push([d, b, dAnt]);
  }
  const anos = (x, y) => (x.slice(0, 4) === y.slice(0, 4) ? x.slice(0, 4) : `${x.slice(0, 4)}–${y.slice(0, 4)}`);
  const rotA = anos(ini, fim), rotB = anos(menosUmAno(ini), menosUmAno(fim));
  const nota = document.getElementById(idNota);
  if (nota) {
    const janela = `${fmtData(ini)} a ${fmtData(fim)}`;
    if (!tB) nota.textContent = `${janela} · sem registros no mesmo período de ${rotB}`;
    else {
      const var_ = Math.round((100 * (tA - tB)) / tB);
      nota.textContent = `${janela}: ${fmt(tA)} ${unidade} · ${rotB}: ${fmt(tB)} (${var_ > 0 ? "+" : ""}${var_}%)`;
    }
  }
  return { pontos, anterior: tB ? anterior : null, rotuloAtual: rotA, rotuloAnterior: rotB };
}

// ---- nível de resposta (NR) do ambiente ativo, sempre visível no topo
function mostrarNR() {
  const el = document.getElementById("nr");
  if (!el || !BASE) return;
  const conj = st.amb === "fogo" ? "fogo_nivel_resposta" : "nivel_resposta";
  const nivel = BASE.dados[conj]?.[0]?.nivel;
  if (nivel === null || nivel === undefined) { el.hidden = true; return; }
  el.hidden = false;
  el.dataset.nr = String(nivel);
  el.querySelector(".nr__valor").textContent = `NR ${nivel}`;
  el.title = `Nível de resposta ${nivel} — ${BASE.meta.conjuntos[conj]?.planilha || ""}`;
}

const ordenar = (mapa, n = Infinity) => [...mapa.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const nomeMun = (cod) => titulo(BASE.meta.municipios.find((m) => m.cod_ibge === cod)?.municipio || cod);
// clique numa barra ou no mapa: acrescenta ou retira da seleção
const alternar = (v, x) => { const s = lista(v); return (s.includes(x) ? s.filter((y) => y !== x) : [...s, x]).join(","); };
const alternarRedec = (r) => { st.redec = alternar(st.redec, r); preencherMunicipios(); atualizar(); };
const alternarMunicipio = (cod) => { st.municipio = alternar(st.municipio, cod); atualizar(); };
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

// O que mais aparece numa dimensão, com quantidade e % do total filtrado (cartões "mais frequente")
function liderDe(linhas, campo, nomear = (v) => v) {
  if (!linhas?.length) return { valor: "—", sub: "sem ocorrências no recorte" };
  const [k, n] = ordenar(contarPor(linhas, campo), 1)[0] || [];
  if (!k) return { valor: "—", sub: "não informado" };
  return { valor: nomear(k), sub: `${fmt(n)} de ${fmt(linhas.length)} ocorrências (${Math.round((100 * n) / linhas.length)}%)` };
}

// Tipos com cartão numérico no SisGeO · Chuvas (grafia comparada sem acento/maiúscula)
const TIPOS_PRINCIPAIS = ["Corte de Árvore", "Deslizamento/Desabamento", "Inundação/Alagamento", "Salvamento de Pessoa"];

const SISGEO = {
  geral() {
    const sis = filtrar("sisgeo");
    seguro("s-kpis-num", (el) => {
      // quantidades por tipo principal; clicar filtra o painel por aquele tipo (clicar de novo limpa)
      const chave = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
      const semTipo = filtrar("sisgeo", { semTipo: true });
      const total = semTipo?.length ?? null;
      const doTipo = (nome) => {
        const real = [...new Set((semTipo || []).map((l) => l.tipo))].find((t) => chave(t) === chave(nome)) || nome;
        const n = (semTipo || []).filter((l) => l.tipo === real).length;
        const ativo = st.tipo === real;
        return { rotulo: nome, valor: semTipo ? n : "—", destaque: ativo,
          sub: semTipo?.length ? `${Math.round((100 * n) / semTipo.length)}% das ocorrências válidas` : "",
          acao: () => { st.tipo = ativo ? "" : real; atualizar(); }, rotuloAcao: ativo ? "Limpar filtro" : "Filtrar",
          dicaAcao: ativo ? "Mostrar todos os tipos" : `Filtrar o painel por ${nome}` };
      };
      kpis(el, [
        { rotulo: "Ocorrências válidas", valor: total ?? "—", destaque: !st.tipo,
          sub: `${descricaoPeriodo()} · ${fmt(filtrar("sisgeo", { depuracao: "excluidas", semTipo: true })?.length || 0)} excluídas na depuração` },
        ...TIPOS_PRINCIPAIS.map(doTipo),
      ]);
    });
    seguro("s-kpis", (el) => {
      const lider = (campo, nomear) => liderDe(sis, campo, nomear);
      kpis(el, [
        { rotulo: "Tipo mais frequente", texto: true, destaque: true, ...lider("tipo") },
        { rotulo: "Subtipo mais frequente", texto: true, ...lider("subtipo") },
        { rotulo: "Município com mais ocorrências", texto: true, ...lider("cod_ibge", nomeMun) },
        { rotulo: "REDEC com mais ocorrências", texto: true, ...lider("redec", rotuloRedec) },
      ]);
    });
    seguro("s-redec", (el) => { if (!indisponivel(el, sis)) barrasH(el, porRedec(sis), { aoClicar: alternarRedec, selecionado: redecsSel(), unidade: "ocorrências" }); });
    seguro("s-serie", (el) => {
      if (indisponivel(el, sis)) return;
      const c = comparativoDiario("sisgeo", CAMPO_DATA.sisgeo, "s-serie-nota", "ocorrências");
      if (c) serieDiaria(el, c.pontos, c);
    });
    seguro("s-aviso-fogo", (el) => {
      const n = BASE.meta.conjuntos.sisgeo?.excluidos || 0;
      el.hidden = !n;
      el.innerHTML = n ? `As ${fmt(n)} ocorrências de <b>fogo em vegetação</b> registradas nesta planilha não entram aqui: o fogo tem ambiente próprio, ` +
        `<a href="#amb=fogo">SisGeO · Fogo</a>, alimentado pela PLANILHA FOGO EM VEGETAÇÃO.` : "";
    });
    seguro("s-top-mun", (el) => {
      if (indisponivel(el, sis)) return;
      barrasH(el, ordenar(contarPor(sis, "cod_ibge"), 10).map(([k, v]) => [nomeMun(k), v, k]),
        { aoClicar: alternarMunicipio, selecionado: munsSel(), unidade: "ocorrências" });
    });
    mapaDo("sisgeo", "s-mapa").then((m) => m?.pintar(contarPor(sis || [], "cod_ibge"), "Ocorrências", "ocorrência(s)", munsSel()));
  },
  tipos() {
    const sis = filtrar("sisgeo");
    seguro("s-tipo", (el) => { if (!indisponivel(el, sis)) rosca(el, ordenar(contarPor(sis, "tipo")), { unidade: "ocorrências" }); });
    seguro("s-subtipo", (el) => { if (!indisponivel(el, sis)) barrasH(el, ordenar(contarPor(sis, "subtipo"), 10), { unidade: "ocorrências" }); });
    seguro("s-tipos-mun", (el) => {
      if (indisponivel(el, sis)) return;
      barrasH(el, ordenar(contarPor(sis, "cod_ibge"), 10).map(([k, v]) => [nomeMun(k), v, k]),
        { aoClicar: alternarMunicipio, selecionado: munsSel(), unidade: "ocorrências" });
    });
    seguro("s-tipos-redec", (el) => { if (!indisponivel(el, sis)) barrasH(el, porRedec(sis), { aoClicar: alternarRedec, selecionado: redecsSel(), unidade: "ocorrências" }); });
  },
  registros() {
    seguro("s-tabela", (el) => tabela(el, { nome: "sisgeo", linhas: filtrar("sisgeo"), ordem: { campo: "data_ocorrencia", dir: -1 }, colunas: COLUNAS_SISGEO }));
  },
  qualidade() { seguro("s-qualidade", (el) => qualidade(el, AMBIENTES.sisgeo.conjuntos)); },
};

// ===================================================== AMBIENTE REDECS
const NATUREZAS = [["inundacao", "Inundação / alagamento"], ["deslizamento", "Deslizamento"], ["desabamento", "Desabamento"],
  ["destelhamento", "Destelhamento"], ["salvamento", "Salvamento de pessoa"], ["queda_arvore", "Queda de árvore"], ["outros", "Outros"]];

const DANOS = [["desalojados", "Desalojados"], ["desabrigados", "Desabrigados"], ["afetados", "Afetados"], ["obitos", "Óbitos"]];
// ---- danos humanos: histórico diário (planilha "Histórico de Danos Humanos FE-SEDEC-RJ")
// Cada linha é um retrato ACUMULADO de um município numa data. A situação numa data D é, para cada
// município, o seu último retrato até D. Datas diferentes nunca se somam (o mesmo desalojado de ontem
// é o desalojado de hoje). Só entram os retratos diários: ápice e consolidados são outra natureza.
// Afetados (total) = desalojados + desabrigados + óbitos + outros afetados.
const n0 = (v) => (typeof v === "number" ? v : 0);
const ehRetrato = (l) => String(l.tipo_registro || "").toUpperCase().startsWith("RETRATO") && l.data_ref && l.cod_ibge;
const temHistorico = () => (BASE.dados.danos_historico || []).some(ehRetrato);
function retratosDiarios() {
  const h = filtrar("danos_historico", { comPeriodo: false });
  if (!h) return null;
  return h.filter(ehRetrato)
    .map((l) => ({ ...l, afetados: n0(l.desalojados) + n0(l.desabrigados) + n0(l.obitos) + n0(l.outros_afetados) }))
    .sort((a, b) => (a.data_ref < b.data_ref ? -1 : a.data_ref > b.data_ref ? 1 : 0));
}
// Fontes do histórico: a fonte ATUAL é a que tem o retrato mais recente (hoje, a aba DANOS HUMANOS, F003);
// ela vale até a próxima mudança, porque ali "sem retrato" quer dizer "nada mudou". As demais são DADOS
// HISTÓRICOS: cada uma vale só até o seu último dia (ex.: Planilha Situacional até 03/06/2026). Depois disso,
// sem retrato da fonte atual, a data fica sem dados (nunca repete números de meses atrás).
// A cobertura é calculada sobre o histórico inteiro (sem o filtro de REDEC/município).
let COBERTURA = null;
function cobertura() {
  if (COBERTURA && COBERTURA.base === BASE.dados.danos_historico) return COBERTURA;
  const fim = new Map();
  let atual = null, maxData = "";
  for (const l of (BASE.dados.danos_historico || []).filter(ehRetrato)) {
    const f = l.id_fonte || "";
    if (!fim.has(f) || l.data_ref > fim.get(f)) fim.set(f, l.data_ref);
    if (l.data_ref > maxData) { maxData = l.data_ref; atual = f; }
  }
  const fimHistorico = [...fim.entries()].filter(([f]) => f !== atual).reduce((m, [, d]) => (d > m ? d : m), "");
  const iniAtual = (BASE.dados.danos_historico || []).filter((l) => ehRetrato(l) && (l.id_fonte || "") === atual)
    .reduce((m, l) => (!m || l.data_ref < m ? l.data_ref : m), "");
  COBERTURA = { base: BASE.dados.danos_historico, fim, atual, fimHistorico, iniAtual };
  return COBERTURA;
}
const valeEm = (l, dia, cob) => (l.id_fonte || "") === cob.atual || dia <= cob.fim.get(l.id_fonte || "");
const ehHistorico = (dia, cob) => cob.fimHistorico && dia <= cob.fimHistorico && !(cob.iniAtual && dia >= cob.iniAtual);
function situacaoEm(retratos, dia) {
  const cob = cobertura();
  const ult = new Map();
  for (const l of retratos) {
    if (l.data_ref > dia) break;
    ult.set(l.cod_ibge, l);
  }
  return [...ult.values()].filter((l) => valeEm(l, dia, cob));
}
// série diária do estado (ou do recorte): soma, a cada dia, o último retrato válido de cada município;
// dia sem nenhum retrato válido fica sem ponto (buraco na linha)
function evolucaoDanos(retratos, campo, ini, fim) {
  if (!retratos.length) return [];
  const cob = cobertura();
  const ult = new Map();
  const pontos = [];
  let i = 0;
  for (let d = retratos[0].data_ref < ini ? retratos[0].data_ref : ini; d <= fim; d = somaDias(d, 1)) {
    while (i < retratos.length && retratos[i].data_ref <= d) { ult.set(retratos[i].cod_ibge, retratos[i]); i++; }
    if (d < ini) continue;
    const validos = [...ult.values()].filter((l) => valeEm(l, d, cob));
    pontos.push([d, validos.length ? validos.reduce((t, l) => t + n0(l[campo]), 0) : null]);
  }
  return pontos;
}
const ROTULO_ALERTA = { idap: "IDAP", cb: "Cell Broadcast", sirene: "Sirenes" };

// Cartões de danos humanos: com o histórico, situação na data "Até" (sem filtro, hoje);
// sem ele (planilha fora do ar), a aba DANOS HUMANOS da NOVA BASE, como antes.
function dadosDanos() {
  if (temHistorico()) {
    const retratos = retratosDiarios() || [];
    const dia = st.ate || hojeBRT();
    const linhas = situacaoEm(retratos, dia);
    const ultimo = linhas.reduce((m, l) => (l.data_ref > m ? l.data_ref : m), "");
    return { historico: true, retratos, dia, linhas, ultimo, cob: cobertura() };
  }
  // aba DANOS HUMANOS: a coluna AFETADOS são os outros afetados; o cartão mostra o total
  const dh = filtrar("danos_humanos", { comPeriodo: false });
  const linhas = dh && dh.map((l) => ({ ...l, outros_afetados: l.afetados,
    afetados: n0(l.desalojados) + n0(l.desabrigados) + n0(l.obitos) + n0(l.afetados) }));
  return { historico: false, linhas };
}
function cartoesDanos(danos) {
  // "situação atual" / "dados históricos · situação em 15/04/2026" / "sem dados nesta data"
  const hoje = !danos.historico || danos.dia >= hojeBRT();
  let sub = "situação atual · aba DANOS HUMANOS";
  if (danos.historico) {
    const cob = danos.cob;
    if (danos.linhas.length) {
      sub = hoje ? "situação atual" : `${ehHistorico(danos.dia, cob) ? "dados históricos · " : ""}situação em ${fmtData(danos.dia)}`;
    } else if (cob.fimHistorico && danos.dia > cob.fimHistorico && cob.iniAtual && danos.dia < cob.iniAtual) {
      sub = `sem dados em ${fmtData(danos.dia)} · dados históricos até ${fmtData(cob.fimHistorico)}; dados atuais desde ${fmtData(cob.iniAtual)}`;
    } else {
      sub = `sem registro em ${fmtData(danos.dia)}`;
    }
  }
  return DANOS.map(([campo, rotulo]) => {
    const n = danos.linhas && danos.linhas.length ? soma(danos.linhas, campo) : danos.linhas && !danos.historico ? 0 : null;
    const ativo = st.danos === campo;
    const sub2 = campo === "afetados" && danos.linhas?.length ? `${sub} · inclui desalojados, desabrigados e óbitos · outros: ${fmt(soma(danos.linhas, "outros_afetados"))}` : sub;
    return { rotulo, valor: n ?? "—", sub: sub2, destaque: ativo,
      ...(n ? { acao: () => { st.danos = ativo ? "" : campo; atualizar(); }, rotuloAcao: ativo ? "Fechar" : "Clique para detalhar",
        dicaAcao: ativo ? "Fechar a lista" : `Mostrar os municípios que somam ${fmt(n)}` } : {}) };
  });
}

const REDECS = {
  geral() {
    const ev = filtrar("eventos"), dec = filtrar("decretos", { comPeriodo: false });
    const danos = dadosDanos();
    seguro("r-kpis", (el) => kpis(el, [
      { rotulo: "Eventos", valor: ev?.length ?? "—", sub: descricaoPeriodo(), destaque: true },
      { rotulo: "Municípios atingidos", valor: ev ? muns(ev) : "—", sub: "de 92 no estado" },
      { rotulo: "Decretos vigentes", valor: dec ? dec.filter(vigente).length : "—", sub: "situação hoje" },
      ...cartoesDanos(danos),
    ]));
    // ao clicar num cartão de danos humanos: só os municípios que compõem aquele número
    seguro("r-danos", (el) => {
      const sec = el.closest(".cartao");
      const item = DANOS.find(([c]) => c === st.danos);
      if (!item || !danos.linhas) { sec.hidden = true; return; }
      sec.hidden = false;
      const [campo, rotulo] = item;
      const linhas = danos.linhas.filter((l) => (l[campo] || 0) > 0);
      document.getElementById("r-danos-titulo").textContent = danos.historico
        ? `${rotulo}: ${fmt(soma(linhas, campo))} ${danos.dia >= hojeBRT() ? "hoje" : `em ${fmtData(danos.dia)}`} — de onde vem`
        : `${rotulo}: ${fmt(soma(linhas, campo))} — de onde vem`;
      document.getElementById("r-danos-dica").textContent = danos.historico
        ? "último retrato de cada município até a data escolhida"
        : "linhas da aba DANOS HUMANOS que somam o número do cartão";
      const colunas = danos.historico
        ? [{ campo: "municipio", titulo: "Município", formato: titulo }, { campo: "redec", titulo: "REDEC", formato: rotuloRedec },
          ...[["desalojados", "Desalojados"], ["desabrigados", "Desabrigados"], ["obitos", "Óbitos"], ["outros_afetados", "Outros afetados"], ["afetados", "Afetados (total)"]]
            .map(([c, r]) => ({ campo: c, titulo: c === campo ? `▶ ${r}` : r, tipo: "num" })),
          { campo: "data_ref", titulo: "Retrato de", formato: fmtData }]
        : [{ campo: "municipio", titulo: "Município", formato: titulo }, { campo: "redec", titulo: "REDEC", formato: rotuloRedec },
          ...DANOS.map(([c, r]) => ({ campo: c, titulo: c === campo ? `▶ ${r}` : r, tipo: "num" }))];
      tabela(el, { nome: `danos_humanos_${campo}`, linhas, porPagina: 100, ordem: { campo, dir: -1 }, colunas });
    });
    // evolução diária (só com o histórico): a categoria segue o cartão clicado; padrão desalojados
    seguro("r-evol", (el) => {
      const sec = el.closest(".cartao");
      if (!danos.historico) { sec.hidden = true; return; }
      sec.hidden = false;
      const campo = st.evol || (st.danos && DANOS.some(([c]) => c === st.danos) ? st.danos : "desalojados");
      const rotulo = DANOS.find(([c]) => c === campo)?.[1] || "Desalojados";
      const alt = document.getElementById("r-evol-alt");
      alt.innerHTML = DANOS.map(([c, r]) => `<button type="button" data-evol="${c}" aria-pressed="${c === campo}">${r}</button>`).join("");
      alt.querySelectorAll("[data-evol]").forEach((b) => b.addEventListener("click", () => { st.evol = b.dataset.evol; atualizar(); }));
      if (!danos.retratos.length) { el.innerHTML = `<div class="vazio">Sem retratos de danos humanos para os filtros selecionados.</div>`; return; }
      const ini = st.de || danos.retratos[0].data_ref;
      const pontos = evolucaoDanos(danos.retratos, campo, ini, danos.dia);
      const nota = document.getElementById("r-evol-nota");
      const cob = danos.cob;
      const lacuna = cob.fimHistorico && cob.iniAtual && somaDias(cob.fimHistorico, 1) < cob.iniAtual
        ? ` · sem dados de ${fmtData(somaDias(cob.fimHistorico, 1))} a ${fmtData(somaDias(cob.iniAtual, -1))} (dados históricos até ${fmtData(cob.fimHistorico)})` : "";
      if (nota) nota.textContent = `${fmtData(ini)} a ${fmtData(danos.dia)} · cada dia soma o último retrato de cada município${lacuna}`;
      serieDiaria(el, pontos, { unidade: rotulo.toLowerCase() });
    });
    seguro("r-redec", (el) => { if (!indisponivel(el, ev)) barrasH(el, porRedec(ev), { aoClicar: alternarRedec, selecionado: redecsSel(), unidade: "eventos" }); });
    seguro("r-serie", (el) => {
      if (indisponivel(el, ev)) return;
      const c = comparativoDiario("eventos", CAMPO_DATA.eventos, "r-serie-nota", "eventos");
      if (c) serieDiaria(el, c.pontos, { ...c, unidade: "eventos" });
    });
    seguro("r-natureza", (el) => {
      if (indisponivel(el, ev)) return;
      barrasH(el, NATUREZAS.map(([k, r]) => [r, soma(ev, k)]).sort((a, b) => b[1] - a[1]), { unidade: "ocorrências" });
    });
    mapaDo("redecs", "r-mapa").then((m) => {
      if (!m) return;
      if (st.camada === "decretos") {
        const v = new Map();
        (dec || []).filter(vigente).forEach((l) => v.set(l.cod_ibge, 1));
        m.pintar(v, "Decretos vigentes", "decreto(s) vigente(s)", munsSel());
      } else {
        m.pintar(contarPor(ev || [], "cod_ibge"), "Eventos", "evento(s)", munsSel());
      }
    });
  },
  decretos() {
    const dec = filtrar("decretos", { comPeriodo: false });
    const comV = (dec || []).map((l) => ({ ...l, _v: vigencia(l) }));
    // padrão: só os vigentes; o cartão "Decretos registrados" alterna para a lista completa
    const todos = st.decretos === "todos";
    const vigentesHoje = comV.filter((l) => (l._v.dias ?? -1) >= 0);
    const alternar = (v) => () => { st.decretos = v; atualizar(); };
    seguro("r-kpis-decretos", (el) => kpis(el, [
      { rotulo: "Decretos registrados", valor: dec?.length ?? "—", destaque: todos,
        acao: alternar(todos ? "" : "todos"), rotuloAcao: todos ? "Mostrar só os vigentes" : "Ver todos os registrados",
        dicaAcao: todos ? "Voltar à lista de decretos vigentes" : "Mostrar na tabela todos os decretos registrados" },
      { rotulo: "Vigentes hoje", valor: vigentesHoje.length, destaque: !todos },
      { rotulo: "Vencem em até 15 dias", valor: comV.filter((l) => l._v.classe === "atencao").length },
      { rotulo: "Encerrados", valor: comV.filter((l) => l._v.rotulo === "Encerrado").length },
    ]));
    seguro("r-decretos", (el) => tabela(el, {
      nome: todos ? "decretos_registrados" : "decretos_vigentes", linhas: dec === null ? null : (todos ? comV : vigentesHoje), ordem: { campo: "termino", dir: 1 },
      colunas: [
        { campo: "municipio", titulo: "Município", formato: titulo }, { campo: "redec", titulo: "REDEC", formato: rotuloRedec },
        { campo: "decreto", titulo: "Decreto" }, { campo: "nivel", titulo: "Nível", tipo: "num" },
        { campo: "data_decreto", titulo: "Decretação", formato: fmtData }, { campo: "prazo_dias", titulo: "Prazo (d)", tipo: "num" },
        { campo: "termino", titulo: "Término", formato: fmtData },
        { campo: "_v", titulo: "Situação", tipo: "html", formato: (v) => `<span class="chip chip--${v.classe}">${esc(v.rotulo)}</span>` },
      ],
    }));
    const tit = document.getElementById("r-decretos-titulo");
    if (tit) tit.textContent = todos ? "Decretos municipais registrados" : "Decretos municipais vigentes";
  },
  resposta() {
    const aj = filtrar("ajuda_humanitaria"), pa = filtrar("pontos_apoio"), sev = filtrar("severidade", { comPeriodo: false });
    const msg = filtrar("alertas_msg");
    const doTipo = (t) => (msg || []).filter((l) => l.tipo === t);
    const abrir = (t) => () => { st.alerta = t; atualizar(); requestAnimationFrame(() => document.getElementById("r-alertas")?.scrollIntoView({ behavior: "smooth", block: "start" })); };
    const cartaoMsg = (t, rotulo, sub) => {
      const ls = doTipo(t), n = soma(ls, "envios");
      return { rotulo, valor: msg ? n : "—", sub: msg ? sub(ls) : "aba ALERTAS-MENSAGENS indisponível",
        ...(ls.length ? { acao: abrir(t), rotuloAcao: "Ver mensagens", dicaAcao: "Abrir o texto das mensagens" } : {}) };
    };
    seguro("r-kpis-resposta", (el) => kpis(el, [
      { rotulo: "Ações de ajuda humanitária", valor: aj?.length ?? "—", destaque: true },
      { rotulo: "Pontos de apoio", valor: pa?.length ?? "—" },
      cartaoMsg("idap", "Envios IDAP", (ls) => `${fmt(ls.length)} mensagem(ns) no período`),
      cartaoMsg("cb", "Envios Cell Broadcast", (ls) => `${fmt(ls.length)} mensagem(ns) no período`),
      cartaoMsg("sirene", "Acionamentos de sirenes", (ls) => `${fmt(soma(ls, "sirenes"))} sirenes/estações acionadas`),
    ]));
    seguro("r-alertas-filtro", (el) => {
      const ops = [["idap", "IDAP"], ["cb", "Cell Broadcast"], ["sirene", "Sirenes"], ["", "Todas"]];
      el.innerHTML = ops.map(([v, r]) => `<button type="button" class="botao-texto" data-alerta="${v}" aria-pressed="${(st.alerta || "") === v}">${r} (${fmt(v ? doTipo(v).length : (msg || []).length)})</button>`).join("");
      el.querySelectorAll("[data-alerta]").forEach((b) => b.addEventListener("click", () => { st.alerta = b.dataset.alerta; atualizar(); }));
    });
    seguro("r-alertas", (el) => tabela(el, {
      nome: "mensagens_alerta", porPagina: 15, ordem: { campo: "quando", dir: -1 },
      linhas: msg && (st.alerta ? doTipo(st.alerta) : msg).map((l) => ({ ...l, quando: `${l.data || ""} ${l.hora || ""}`, tipo_nome: ROTULO_ALERTA[l.tipo] || "Outra" })),
      colunas: [
        { campo: "quando", titulo: "Data", formato: (v) => `${fmtData(v.slice(0, 10))} ${v.slice(11)}` }, { campo: "tipo_nome", titulo: "Tipo" },
        { campo: "envios", titulo: "Envios / acionam.", tipo: "num" }, { campo: "resumo", titulo: "Resumo", tipo: "longo" },
        { campo: "texto", titulo: "Mensagem (clique para abrir)", tipo: "longo",
          formato: (v) => String(v || "").replace(/^(\s*[_*"]*\s*(SEDEC-?RJ|CEMADEN-RJ)[_*\s]*\n)+/i, "").trim() }, // sem o cabeçalho fixo
      ],
    }));
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
        // desalojados/desabrigados/óbitos ficam fora daqui de propósito: a fonte oficial é a aba DANOS HUMANOS
        { campo: "total_ocorrencias", titulo: "Ocorr.", tipo: "num" },
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
      danos_historico: { nota: "Histórico de danos humanos: um retrato por município e data (retratos diários, ápice e consolidados). Afetados (total) = desalojados + desabrigados + óbitos + outros afetados.", colunas: [
        { campo: "data_ref", titulo: "Data", formato: fmtData }, { campo: "municipio", titulo: "Município", formato: titulo },
        { campo: "redec", titulo: "REDEC", formato: rotuloRedec }, { campo: "desalojados", titulo: "Desalojados", tipo: "num" },
        { campo: "desabrigados", titulo: "Desabrigados", tipo: "num" }, { campo: "obitos", titulo: "Óbitos", tipo: "num" },
        { campo: "outros_afetados", titulo: "Outros afetados", tipo: "num" }, { campo: "tipo_registro", titulo: "Tipo" },
        { campo: "origem", titulo: "Origem" }, { campo: "id_fonte", titulo: "Fonte" }] },
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

// ===================================================== AMBIENTE FOGO
// Identidade no SisGeO: evento (IdEvento) + ocorrência (C…). Um evento com
// várias ocorrências = unidades em apoio operacional.
const eventosDe = (linhas) => contarPor(linhas, "id_evento");
const COR_RISCO = { "MUITO ALTO": "critico", ALTO: "critico", MODERADO: "atencao", BAIXO: "ok", "MUITO BAIXO": "ok" };
const chipRisco = (v) => (v ? `<span class="chip chip--${COR_RISCO[String(v).toUpperCase()] || "neutro"}">${esc(v)}</span>` : "—");
// Unidades de conservação: o ETL marca cada ocorrência com a UC (índice em meta.ucs) e a faixa
// (dentro / até 500 m / até 1 km). Conta EVENTOS: um evento vale uma vez, na faixa mais próxima
// entre as suas ocorrências.
const ORDEM_FAIXA = { dentro: 0, 500: 1, 1000: 2 };
const nomeUC = (i) => titulo(BASE.meta.ucs?.[i]?.nome || "UC");
// siglas usuais (SNUC) só no ranking, para o nome caber também no celular
const SIGLAS_UC = [[/^Parque Nacional\b/, "PARNA"], [/^Parque Estadual\b/, "PE"], [/^Parque Natural Municipal\b/, "PNM"],
  [/^Refúgio de Vida Silvestre\b/, "RVS"], [/^Reserva Biológica\b/, "REBIO"], [/^Estação Ecológica\b/, "ESEC"], [/^Monumento Natural\b/, "MONA"]];
const siglaUC = (i) => SIGLAS_UC.reduce((n, [re, s]) => n.replace(re, s), nomeUC(i));
function eventosPertoDeUC(linhas) {
  if (!linhas || !BASE.meta.ucs) return null;
  const melhor = new Map();
  for (const l of linhas) {
    if (!l.uc_faixa) continue;
    const atual = melhor.get(l.id_evento);
    if (!atual || ORDEM_FAIXA[l.uc_faixa] < ORDEM_FAIXA[atual.uc_faixa]) melhor.set(l.id_evento, l);
  }
  const faixa = { dentro: 0, 500: 0, 1000: 0 }, porUC = new Map();
  for (const l of melhor.values()) { faixa[l.uc_faixa]++; porUC.set(l.uc, (porUC.get(l.uc) || 0) + 1); }
  return { total: melhor.size, faixa, porUC };
}
const maisRecentes = (linhas, campo = "data") => (linhas || []).slice().sort((a, b) => ((b[campo] || "") > (a[campo] || "") ? 1 : -1));

const FOGO = {
  geral() {
    const fv = filtrar("fogo_sisgeo"), ab = filtrar("fogo_abertos", { comPeriodo: false });
    seguro("fv-kpis", (el) => {
      const ev = fv ? eventosDe(fv) : null;
      const apoio = ev ? [...ev.values()].filter((n) => n > 1).length : null;
      kpis(el, [
        { rotulo: "Ocorrências válidas", valor: fv?.length ?? "—", destaque: true,
          sub: `${descricaoPeriodo()} · ${fmt(filtrar("fogo_sisgeo", { depuracao: "excluidas" })?.length || 0)} excluídas na depuração` },
        { rotulo: "Eventos", valor: ev ? ev.size : "—", sub: "números de evento distintos" },
        { rotulo: "Eventos com apoio", valor: apoio ?? "—", sub: "mais de uma unidade no mesmo evento",
          ...(apoio ? { acao: () => { st.apoio = "1"; st.aba = "registros"; atualizar(); window.scrollTo({ top: 0 }); },
            rotuloAcao: "Ver eventos", dicaAcao: "Abrir a tabela só com os eventos com apoio" } : {}) },
        { rotulo: "Municípios atingidos", valor: fv ? muns(fv) : "—", sub: "de 92 no estado" },
        { rotulo: "Em andamento", valor: ab ? ab.length : "—", sub: "aba EVENTOS ABERTOS" },
      ]);
    });
    seguro("fv-kpis-lider", (el) => {
      const uc = eventosPertoDeUC(fv);
      const [ucTop, nTop] = uc ? ordenar(uc.porUC, 1)[0] || [] : [];
      kpis(el, [
        { rotulo: "Subtipo mais frequente", texto: true, ...liderDe(fv, "subtipo") },
        { rotulo: "Município com mais ocorrências", texto: true, ...liderDe(fv, "cod_ibge", nomeMun) },
        { rotulo: "REDEC com mais ocorrências", texto: true, ...liderDe(fv, "redec", rotuloRedec) },
        { rotulo: "Eventos em UC ou até 1 km", texto: true, valor: uc ? fmt(uc.total) : "—",
          sub: uc ? `${fmt(uc.faixa.dentro)} dentro · ${fmt(uc.faixa["500"])} até 500 m · ${fmt(uc.faixa["1000"])} até 1 km` : "cruzamento com UCs indisponível",
          ...(uc?.total ? { acao: () => { st.aba = "territorios"; atualizar(); requestAnimationFrame(() => document.getElementById("fv-ucs")?.scrollIntoView({ behavior: "smooth", block: "center" })); },
            rotuloAcao: "Ver ranking", dicaAcao: "Abrir o ranking das UCs" } : {}) },
        { rotulo: "UC mais pressionada", texto: true, valor: ucTop !== undefined ? nomeUC(ucTop) : "—",
          sub: ucTop !== undefined ? `${fmt(nTop)} eventos dentro ou até 1 km · ${BASE.meta.ucs[ucTop]?.esfera || ""}` : (uc ? "nenhum evento em UC ou até 1 km" : "") },
      ]);
    });
    seguro("fv-redec", (el) => { if (!indisponivel(el, fv)) barrasH(el, porRedec(fv), { aoClicar: alternarRedec, selecionado: redecsSel(), unidade: "ocorrências" }); });
    seguro("fv-serie", (el) => {
      if (indisponivel(el, fv)) return;
      const c = comparativoDiario("fogo_sisgeo", CAMPO_DATA.fogo_sisgeo, "fv-serie-nota", "ocorrências");
      // Indicativo Extinctus: referência estadual de ocorrências/dia — só faz sentido sem filtro de território
      const referencia = !st.redec && !st.municipio ? { valor: INDICATIVO_EXTINCTUS, rotulo: "Indicativo Extinctus" } : null;
      if (c) serieDiaria(el, c.pontos, { ...c, referencia });
    });
    seguro("fv-mes", (el) => {
      if (indisponivel(el, fv)) return;
      const porAno = new Map();
      for (const l of fv) {
        const d = l.data_ocorrencia;
        if (!d) continue;
        const ano = d.slice(0, 4), m = Number(d.slice(5, 7)) - 1;
        if (!porAno.has(ano)) porAno.set(ano, Array(12).fill(0));
        porAno.get(ano)[m] += 1;
      }
      colunasPorMes(el, [...porAno.entries()].sort());
    });
    seguro("fv-abertos", (el) => {
      if (ab && !ab.length) { el.innerHTML = `<div class="vazio">Nenhum evento de fogo em aberto no momento.</div>`; return; }
      tabela(el, {
        nome: "fogo_em_andamento", linhas: ab, porPagina: 15, ordem: { campo: "data_ocorrencia", dir: -1 },
        colunas: [
          { campo: "data_ocorrencia", titulo: "Início", formato: fmtData }, { campo: "id_evento", titulo: "Evento" },
          { campo: "ocorrencia", titulo: "Ocorrência" }, { campo: "municipio", titulo: "Município", formato: titulo },
          { campo: "bairro", titulo: "Bairro" }, { campo: "subtipo", titulo: "Subtipo" },
          { campo: "unidade", titulo: "Unidade" }, { campo: "situacao", titulo: "Situação" },
        ],
      });
    });
    mapaDo("fogo", "fv-mapa").then((m) => m?.pintar(contarPor(fv || [], "cod_ibge"), "Ocorrências de fogo", "ocorrência(s)", munsSel()));
  },

  territorios() {
    const fv = filtrar("fogo_sisgeo");
    seguro("fv-subtipo", (el) => { if (!indisponivel(el, fv)) rosca(el, ordenar(contarPor(fv, "subtipo")), { unidade: "ocorrências" }); });
    seguro("fv-unidade", (el) => { if (!indisponivel(el, fv)) barrasH(el, ordenar(contarPor(fv, "unidade"), 10), { unidade: "ocorrências" }); });
    seguro("fv-mun", (el) => {
      if (indisponivel(el, fv)) return;
      barrasH(el, ordenar(contarPor(fv, "cod_ibge"), 10).map(([k, v]) => [nomeMun(k), v, k]),
        { aoClicar: alternarMunicipio, selecionado: munsSel(), unidade: "ocorrências" });
    });
    seguro("fv-redec2", (el) => { if (!indisponivel(el, fv)) barrasH(el, porRedec(fv), { aoClicar: alternarRedec, selecionado: redecsSel(), unidade: "ocorrências" }); });
    seguro("fv-ucs", (el) => {
      if (indisponivel(el, fv)) return;
      const uc = eventosPertoDeUC(fv);
      if (!uc) { el.innerHTML = `<div class="falha">Cruzamento com unidades de conservação indisponível nesta atualização.</div>`; return; }
      if (indisponivel(el, uc.total ? [1] : [])) return;
      barrasH(el, ordenar(uc.porUC, 15).map(([k, v]) => [siglaUC(k), v, k]), { unidade: "eventos", largRotulo: 300 });
    });
  },

  condicoes() {
    const ult = (BASE.dados.fogo_ultimo_dia || [])[0];
    seguro("fv-kpis-clima", (el) => kpis(el, [
      { rotulo: "Maior temperatura do último dia", texto: true, destaque: true,
        valor: ult?.temp_c != null ? `${ult.temp_c.toLocaleString("pt-BR")} °C` : "—",
        sub: ult ? `${titulo(ult.municipio_temp || "")} · ${fmtData(ult.data)}` : "sem registro" },
      { rotulo: "Menor umidade do último dia", texto: true,
        valor: ult?.ur_pct != null ? `${ult.ur_pct.toLocaleString("pt-BR")} %` : "—",
        sub: ult ? `${titulo(ult.municipio_ur || "")} · ${fmtData(ult.data)}` : "sem registro" },
      { rotulo: "REDECs com risco alto ou muito alto", texto: true,
        valor: (() => { const r = filtrar("fogo_risco", { comPeriodo: false }); return r ? String(r.filter((l) => /ALTO/i.test(l.risco || "")).length) : "—"; })(),
        sub: "de 11 regionais" },
    ]));
    seguro("fv-risco", (el) => tabela(el, {
      nome: "risco_incendio", linhas: filtrar("fogo_risco", { comPeriodo: false }), porPagina: 20,
      colunas: [{ campo: "redec", titulo: "REDEC", formato: rotuloRedec },
        { campo: "risco", titulo: "Risco de incêndio florestal", tipo: "html", formato: chipRisco }],
    }));
    seguro("fv-temp", (el) => tabela(el, {
      nome: "maiores_temperaturas", linhas: maisRecentes(filtrar("fogo_temperatura")), porPagina: 15,
      colunas: [{ campo: "data", titulo: "Data", formato: fmtData }, { campo: "municipio", titulo: "Município", formato: titulo },
        { campo: "temp_c", titulo: "Maior temperatura (°C)", tipo: "num" }],
    }));
    seguro("fv-umid", (el) => tabela(el, {
      nome: "menores_umidades", linhas: maisRecentes(filtrar("fogo_umidade")), porPagina: 15,
      colunas: [{ campo: "data", titulo: "Data", formato: fmtData }, { campo: "municipio", titulo: "Município", formato: titulo },
        { campo: "ur_pct", titulo: "Menor umidade (%)", tipo: "num" }],
    }));
  },

  registros() {
    const todas = filtrar("fogo_sisgeo");
    // "Eventos com apoio": só eventos com 2+ ocorrências, agrupados por evento (aberto pelo cartão da Visão geral)
    const ev = todas ? eventosDe(todas) : new Map();
    const soApoio = st.apoio === "1";
    const linhas = !todas ? todas : (soApoio ? todas.filter((l) => ev.get(l.id_evento) > 1) : todas)
      .map((l) => ({ ...l, n_ocorrencias: ev.get(l.id_evento) || 1 }));
    seguro("fv-tabela-filtro", (el) => {
      const nEv = [...ev.values()].filter((n) => n > 1).length;
      el.innerHTML = soApoio
        ? `<span class="chip chip--atencao">Só eventos com apoio: ${fmt(nEv)} eventos · ${fmt(linhas?.length || 0)} ocorrências</span> <button type="button" class="botao-texto" data-apoio="">Mostrar todas</button>`
        : nEv ? `<button type="button" class="botao-texto" data-apoio="1">Mostrar só eventos com apoio (${fmt(nEv)})</button>` : "";
      el.querySelector("[data-apoio]")?.addEventListener("click", (e) => { st.apoio = e.currentTarget.dataset.apoio; atualizar(); });
    });
    seguro("fv-tabela", (el) => tabela(el, {
      nome: soApoio ? "fogo_eventos_com_apoio" : "fogo_em_vegetacao", linhas,
      ordem: soApoio ? { campo: "id_evento", dir: -1 } : { campo: "data_ocorrencia", dir: -1 },
      colunas: [
        { campo: "data_ocorrencia", titulo: "Data", formato: fmtData }, { campo: "id_evento", titulo: "Evento" },
        { campo: "ocorrencia", titulo: "Ocorrência" }, { campo: "n_ocorrencias", titulo: "Ocorr. no evento", tipo: "num" },
        { campo: "municipio", titulo: "Município", formato: titulo },
        { campo: "redec", titulo: "REDEC", formato: rotuloRedec }, { campo: "subtipo", titulo: "Subtipo" },
        { campo: "unidade", titulo: "Unidade" }, { campo: "situacao", titulo: "Situação" },
        { campo: "vitimas", titulo: "Vítimas", tipo: "num" },
      ],
    }));
  },

  qualidade() { seguro("fv-qualidade", (el) => qualidade(el, AMBIENTES.fogo.conjuntos)); },
};

// ---- aba Depuração (SisGeO · Chuvas e SisGeO · Fogo)
const ROTULO_DEP = { situacao: "Situação", motivo: "Motivo da exclusão", clima: "Condição climática", subtipo: "Subtipo" };
// SisGeO · Chuvas: condição climática (tempo seco sem alerta) e subtipo (ex.: retirada de anel) formam um grupo só
const SEM_CHUVA = { clima: "Sem relação com chuvas (tempo seco sem alerta)", subtipo: "Sem relação com chuvas (subtipo)" };
// "situacao+clima" -> "Situação e Condição climática"
const rotuloDep = (d, chuvas = false) => String(d || "").split("+").map((k) => (chuvas && SEM_CHUVA[k]) || ROTULO_DEP[k] || k).join(" e ");
const categoriaDep = (d, chuvas = false) => {
  const cats = [...new Set(String(d).split("+").map((k) => (chuvas && SEM_CHUVA[k] ? "semchuva" : k)))];
  return cats.length > 1 ? "ambos" : cats[0];
};
function abaDepuracao(nome, p) {
  const validas = filtrar(nome), exc = filtrar(nome, { depuracao: "excluidas" });
  seguro(`${p}-dep-kpis`, (el) => {
    if (indisponivel(el, validas && exc && [...validas, ...exc])) return;
    const comClima = "clima" in (BASE.meta.conjuntos[nome]?.depuracao || {});
    const c = contarPor(exc.map((l) => ({ k: categoriaDep(l.depuracao, comClima) })), "k"), total = validas.length + exc.length;
    const pct = (n) => (total ? `${Math.round((100 * n) / total)}% do registrado` : "");
    kpis(el, [
      { rotulo: "Registradas", valor: total, sub: descricaoPeriodo() },
      { rotulo: "Válidas", valor: validas.length, sub: pct(validas.length), destaque: true },
      // no SisGeO · Chuvas o card de situação só aparece quando há alguma (o download costuma vir sem canceladas)
      ...(!comClima || c.get("situacao") ? [{ rotulo: "Excluídas por situação", valor: c.get("situacao") || 0, sub: "situação diferente das válidas" }] : []),
      { rotulo: "Excluídas por motivo", valor: c.get("motivo") || 0, sub: "com Motivo da Exclusão preenchido" },
      ...(comClima ? [{ rotulo: "Sem relação com chuvas intensas", valor: c.get("semchuva") || 0, sub: "tempo seco sem alerta ou subtipo como retirada de anel" }] : []),
      { rotulo: comClima ? "Por mais de um critério" : "Por situação e motivo", valor: c.get("ambos") || 0, sub: `total excluído: ${fmt(exc.length)} (${pct(exc.length) || "0%"})` },
    ]);
  });
  seguro(`${p}-dep-situacao`, (el) => {
    if (indisponivel(el, exc)) return;
    const porSit = exc.filter((l) => String(l.depuracao).includes("situacao"));
    if (indisponivel(el, porSit)) return;
    barrasH(el, ordenar(contarPor(porSit.map((l) => ({ s: l.situacao || "(sem situação)" })), "s"), 10), { unidade: "ocorrências" });
  });
  seguro(`${p}-dep-municipio`, (el) => {
    if (!indisponivel(el, exc)) barrasH(el, ordenar(contarPor(exc, "cod_ibge"), 10).map(([k, v]) => [nomeMun(k), v, k]),
      { aoClicar: alternarMunicipio, selecionado: munsSel(), unidade: "ocorrências" });
  });
  seguro(`${p}-dep-redec`, (el) => { if (!indisponivel(el, exc)) barrasH(el, porRedec(exc), { aoClicar: alternarRedec, selecionado: redecsSel(), unidade: "ocorrências" }); });
  seguro(`${p}-dep-tabela`, (el) => tabela(el, {
    nome: `${nome}_excluidas_depuracao`, linhas: exc?.map((l) => ({ ...l, exclusao: rotuloDep(l.depuracao, "clima" in (BASE.meta.conjuntos[nome]?.depuracao || {})) })),
    ordem: { campo: "data_ocorrencia", dir: -1 },
    colunas: [
      { campo: "data_ocorrencia", titulo: "Data", formato: fmtData }, { campo: "id_evento", titulo: "Evento" },
      { campo: "ocorrencia", titulo: "Ocorrência" }, { campo: "exclusao", titulo: "Excluída por" },
      { campo: "motivo", titulo: "Motivo da exclusão", tipo: "longo" }, { campo: "situacao", titulo: "Situação" },
      ...("clima" in (BASE.meta.conjuntos[nome]?.depuracao || {}) ? [{ campo: "condicao_climatica", titulo: "Condição climática" }] : []),
      { campo: "municipio", titulo: "Município", formato: titulo },
      { campo: "redec", titulo: "REDEC", formato: rotuloRedec }, { campo: "subtipo", titulo: "Subtipo" },
      { campo: "unidade", titulo: "Unidade" },
    ],
  }));
}
SISGEO.depuracao = () => abaDepuracao("sisgeo", "s");
FOGO.depuracao = () => abaDepuracao("fogo_sisgeo", "fv");

const RENDER = { sisgeo: SISGEO, redecs: REDECS, fogo: FOGO };

// ------------------------------------------------ dados novos
// O GitHub consulta a planilha a cada ~10 min e só republica quando algo mudou.
// O botão "Atualizar" busca na hora a versão mais recente publicada; um painel
// deixado aberto também confere sozinho a cada 2 min.
async function verificarDadosNovos() {
  const r = await fetch(`data/meta.json?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`meta.json: HTTP ${r.status}`);
  const meta = await r.json();
  if (meta.gerado_em === BASE.meta.gerado_em) return false;
  if (meta.versao_dados && meta.versao_dados === BASE.meta.versao_dados) {
    // planilha conferida de novo, sem dados novos: só atualiza o horário da última leitura
    BASE.meta.gerado_em = meta.gerado_em;
    status(BASE.meta);
    return false;
  }
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
    clearTimeout(botao._volta); // cliques seguidos: só o último devolve o selo ao normal
    botao._volta = setTimeout(() => status(BASE.meta), 4000);
  });
}

// ---- modo claro/escuro: o botão alterna e guarda a escolha neste navegador
function temaEfetivo() {
  const t = document.documentElement.dataset.theme;
  if (t === "light" || t === "dark") return t;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function marcarTema() {
  const escuro = temaEfetivo() === "dark";
  document.documentElement.dataset.temaEfetivo = escuro ? "escuro" : "claro";
  const b = document.getElementById("botao-tema");
  if (b) b.title = b.ariaLabel = escuro ? "Mudar para modo claro" : "Mudar para modo escuro";
}
function montarBotaoTema() {
  marcarTema();
  document.getElementById("botao-tema")?.addEventListener("click", () => {
    const novo = temaEfetivo() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = novo;
    try { localStorage.setItem("painel-tema", novo); } catch (e) { /* navegador sem armazenamento: vale só nesta visita */ }
    marcarTema();
    atualizar(); // gráficos e mapa leem as cores do tema na hora de desenhar
  });
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (!document.documentElement.dataset.theme) { marcarTema(); atualizar(); }
  });
}

function atualizar() {
  sincronizarControles();
  mostrarNR();
  gravarURL();
  registrarAba(st.amb, st.aba);
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
  el.textContent = `Última leitura: ${quando}`;
  el.title = "Horário em que a planilha foi conferida pela última vez (conferência automática a cada ~10 min)";
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
  // painel aberto numa tela: confere a cada 2 min se há dados novos e recarrega sozinho
  setInterval(() => verificarDadosNovos().catch(() => {}), 2 * 60 * 1000);

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

  try { iniciarAnalytics(); } catch (e) { console.error(e); } // contagem de acessos nunca derruba o painel
  montarBotaoTema();
  atualizar();
  window.__painelPronto = true; // usado pelo teste automatizado
}

document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", iniciar) : iniciar();
