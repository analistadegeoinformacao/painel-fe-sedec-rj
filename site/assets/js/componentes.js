import { esc, fmt, baixarCSV } from "./util.js";

/** Executa a renderização de um painel isolando falhas: um erro em um gráfico
 *  mostra um aviso só naquele cartão, sem derrubar a página inteira. */
export function seguro(alvo, fn) {
  const el = typeof alvo === "string" ? document.getElementById(alvo) : alvo;
  if (!el) return;
  try {
    fn(el);
  } catch (e) {
    console.error(`[painel] falha em #${el.id}:`, e);
    el.innerHTML = `<div class="falha">Este painel não pôde ser exibido. Os demais seguem atualizados.</div>`;
  }
}

export function indisponivel(el, dados) {
  if (dados === null) {
    el.innerHTML = `<div class="falha">Base indisponível nesta atualização.</div>`;
    return true;
  }
  if (!dados.length) {
    el.innerHTML = `<div class="vazio">Nenhum registro para os filtros selecionados.</div>`;
    return true;
  }
  return false;
}

/** kpis: [{rotulo, valor, sub?, destaque?}] */
export function kpis(el, itens) {
  // item com acao: o cartão vira botão (ex.: "Eventos com apoio" abre a tabela já filtrada)
  el.innerHTML = itens
    .map(
      (k, i) => `<${k.acao ? `button type="button" data-kpi="${i}" title="${esc(k.dicaAcao || "")}"` : "div"} class="kpi${k.destaque ? " kpi--destaque" : ""}${k.acao ? " kpi--acao" : ""}">
        <div class="kpi__rotulo">${esc(k.rotulo).replaceAll("/", "/<wbr>")}</div>
        <div class="kpi__valor${k.texto ? " kpi__valor--texto" : ""}"${k.texto ? ` title="${esc(k.valor ?? "")}"` : ""}>${typeof k.valor === "number" ? fmt(k.valor) : esc(k.valor ?? "—")}</div>
        ${k.sub ? `<div class="kpi__sub">${esc(k.sub)}</div>` : ""}
        ${k.acao ? `<div class="kpi__acao">${esc(k.rotuloAcao || "Ver lista")} →</div>` : ""}
      </${k.acao ? "button" : "div"}>`
    )
    .join("");
  el.querySelectorAll("[data-kpi]").forEach((b) => b.addEventListener("click", () => itens[b.dataset.kpi].acao()));
}

/**
 * Tabela com busca, ordenação, paginação e exportação CSV.
 * colunas: [{campo, titulo, tipo?: 'num'|'data'|'longo'|'html', formato?: fn}]
 */
export function tabela(el, { colunas, linhas, nome = "dados", porPagina = 50, ordem = null }) {
  if (indisponivel(el, linhas)) return;
  const st = { busca: "", campo: ordem?.campo ?? null, dir: ordem?.dir ?? -1, pagina: 0 };
  el.innerHTML = `
    <div class="tabela__barra">
      <input type="search" placeholder="Buscar nesta tabela…" aria-label="Buscar">
      <div class="tabela__acoes"><span class="t-conta"></span><button type="button" class="t-csv">Exportar CSV</button></div>
    </div>
    <div class="tabela__rolagem"><table><thead><tr>${colunas
      .map((c) => `<th data-campo="${c.campo}" scope="col">${esc(c.titulo)}</th>`)
      .join("")}</tr></thead><tbody></tbody></table></div>
    <div class="paginacao"></div>`;
  const tbody = el.querySelector("tbody");
  const texto = (l) => colunas.map((c) => l[c.campo] ?? "").join(" ").toLowerCase();
  const indice = linhas.map((l) => [l, texto(l)]);

  function filtradas() {
    const q = st.busca.trim().toLowerCase();
    let r = q ? indice.filter(([, t]) => t.includes(q)).map(([l]) => l) : linhas.slice();
    if (st.campo) {
      r.sort((a, b) => {
        const x = a[st.campo], y = b[st.campo];
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (x > y ? 1 : -1) * st.dir;
      });
    }
    return r;
  }

  function celula(c, l) {
    const v = l[c.campo];
    if (c.formato) return c.tipo === "html" ? c.formato(v, l) : esc(c.formato(v, l));
    if (v === null || v === undefined || v === "") return `<span style="color:var(--texto-3)">—</span>`;
    if (c.tipo === "num") return fmt(v);
    if (c.tipo === "longo") return `<div class="longo" title="Clique para expandir">${esc(v)}</div>`;
    return esc(v);
  }

  function desenhar() {
    const r = filtradas();
    const paginas = Math.max(1, Math.ceil(r.length / porPagina));
    st.pagina = Math.min(st.pagina, paginas - 1);
    const fatia = r.slice(st.pagina * porPagina, (st.pagina + 1) * porPagina);
    tbody.innerHTML = fatia.length
      ? fatia
          .map((l) => `<tr>${colunas.map((c) => `<td class="${c.tipo === "num" ? "num" : ""}">${celula(c, l)}</td>`).join("")}</tr>`)
          .join("")
      : `<tr><td colspan="${colunas.length}"><div class="vazio">Nada encontrado.</div></td></tr>`;
    el.querySelector(".t-conta").textContent = `${fmt(r.length)} registro(s)`;
    el.querySelector(".paginacao").innerHTML =
      paginas > 1
        ? `<button type="button" data-p="-1" ${st.pagina === 0 ? "disabled" : ""}>‹ Anterior</button>
           <span>Página ${st.pagina + 1} de ${paginas}</span>
           <button type="button" data-p="1" ${st.pagina >= paginas - 1 ? "disabled" : ""}>Próxima ›</button>`
        : "";
    el.querySelectorAll("th").forEach((th) => {
      th.setAttribute("aria-sort", th.dataset.campo === st.campo ? (st.dir === 1 ? "ascending" : "descending") : "none");
    });
  }

  el.querySelector("input").addEventListener("input", (e) => { st.busca = e.target.value; st.pagina = 0; desenhar(); });
  el.querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("th");
    if (!th) return;
    st.dir = st.campo === th.dataset.campo ? -st.dir : -1;
    st.campo = th.dataset.campo;
    desenhar();
  });
  el.querySelector(".paginacao").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-p]");
    if (b) { st.pagina += Number(b.dataset.p); desenhar(); }
  });
  tbody.addEventListener("click", (e) => e.target.closest(".longo")?.classList.toggle("aberto"));
  el.querySelector(".t-csv").addEventListener("click", () => baixarCSV(nome, colunas, filtradas()));
  desenhar();
}
