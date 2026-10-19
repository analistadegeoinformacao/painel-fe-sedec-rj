const { test, expect } = require("@playwright/test");

const AMBIENTES = {
  sisgeo: ["geral", "tipos", "registros", "qualidade"],
  redecs: ["geral", "decretos", "resposta", "registros", "consulta", "qualidade"],
  fogo: ["geral", "territorios", "condicoes", "registros", "qualidade"],
};

async function abrir(page, hash = "") {
  // mapa base e fontes externas não fazem parte do teste
  await page.route(/arcgisonline|fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await page.goto("/" + hash);
  await page.waitForFunction(() => window.__painelPronto === true);
}

test("os três ambientes carregam todas as abas sem erro de JavaScript", async ({ page }) => {
  const erros = [];
  page.on("pageerror", (e) => erros.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && erros.push(m.text()));
  // qualquer arquivo do PRÓPRIO site que falhe (404 etc.) reprova o teste
  page.on("response", (r) => r.url().startsWith("http://127.0.0.1") && r.status() >= 400 && erros.push(`${r.status()} ${r.url()}`));
  await abrir(page);
  await expect(page.locator("#status-dados")).toContainText("Dados de");

  for (const [amb, abas] of Object.entries(AMBIENTES)) {
    await page.click(`.ambientes a[data-amb="${amb}"]`);
    await expect(page.locator("body")).toHaveAttribute("data-amb", amb);
    // abas do outro ambiente ficam escondidas
    for (const outro of Object.keys(AMBIENTES).filter((a) => a !== amb)) {
      await expect(page.locator(`.abas [data-amb="${outro}"]:visible`)).toHaveCount(0);
    }
    for (const aba of abas) {
      await page.click(`.abas [data-amb="${amb}"][data-aba="${aba}"]`);
      const sec = page.locator(`.painel-aba[data-amb="${amb}"][data-aba="${aba}"]`);
      await expect(sec).toBeVisible();
      await expect(sec.locator(".falha")).toHaveCount(0);
    }
    await page.click(`.abas [data-amb="${amb}"][data-aba="geral"]`);
    const MAPA = { sisgeo: "s-mapa", redecs: "r-mapa", fogo: "fv-mapa" };
    await expect(page.locator(`#${MAPA[amb]} .leaflet-interactive`).first()).toBeVisible();
    await page.screenshot({ path: `test-results/painel-${amb}.png`, fullPage: true });
  }
  expect(erros, erros.join("\n")).toEqual([]);
});

test("cada ambiente mostra só a sua fonte", async ({ page }) => {
  await abrir(page, "#amb=sisgeo");
  const nSisgeo = await page.locator("#s-kpis .kpi__valor").first().innerText();
  await abrir(page, "#amb=redecs");
  await expect(page.locator(".painel-aba[data-amb='redecs'][data-aba='geral']")).toBeVisible();
  await expect(page.locator(".painel-aba[data-amb='sisgeo']:visible")).toHaveCount(0);
  const nEventos = await page.locator("#r-kpis .kpi__valor").first().innerText();
  expect(nSisgeo).not.toEqual(nEventos);
});

test("link direto abre o ambiente e a aba certos, com o filtro aplicado", async ({ page }) => {
  await abrir(page, "#amb=redecs&aba=decretos&redec=REDEC%2011%20-%20NOROESTE");
  await expect(page.locator(".painel-aba[data-amb='redecs'][data-aba='decretos']")).toBeVisible();
  await expect(page.locator("#f-redec")).toHaveValue("REDEC 11 - NOROESTE");
});

test("filtro de REDEC reduz os números e é mantido ao trocar de ambiente", async ({ page }) => {
  await abrir(page);
  const total = await page.locator("#s-kpis .kpi__sub").first().innerText();
  await page.selectOption("#f-redec", { index: 1 });
  await expect(page.locator("#s-kpis .kpi__sub").first()).not.toHaveText(total);
  await page.click('.ambientes a[data-amb="redecs"]');
  await expect(page.locator("#f-redec")).not.toHaveValue("");
});

test("nenhum dado pessoal no JSON publicado", async ({ request }) => {
  for (const base of ["sisgeo", "fogo_sisgeo", "fogo_abertos"]) {
    const txt = await (await request.get(`/data/${base}.json`)).text();
    expect(txt, base).not.toMatch(/\(#?\d{5,7}\)/);
    expect(txt.toLowerCase(), base).not.toContain("efetivo");
  }
});

test("botão Atualizar busca a versão mais recente e carrega dados novos", async ({ page }) => {
  let gerado = null;
  await page.route(/data\/meta\.json/, async (route) => {
    const r = await route.fetch();
    const meta = await r.json();
    if (gerado) meta.gerado_em = gerado;
    await route.fulfill({ response: r, json: meta });
  });
  await abrir(page);
  const botao = page.locator("#botao-atualizar");
  await expect(botao).toBeVisible();
  await botao.click();
  await expect(page.locator("#status-dados")).toContainText("Já está com os dados mais recentes");
  gerado = "2099-01-01T00:00:00-03:00";            // simula uma publicação nova
  await botao.click();
  await expect(page.locator("#status-dados")).toContainText("Dados novos carregados");
  await expect(botao).toBeEnabled();
});

test("SisGeO: indicadores de tipo, subtipo, município e REDEC", async ({ page }) => {
  await abrir(page, "#amb=sisgeo");
  await expect(page.locator("#s-kpis .kpi__rotulo")).toHaveText([
    "Tipo mais frequente", "Subtipo mais frequente", "Município com mais ocorrências", "REDEC com mais ocorrências",
  ]);
  await expect(page.locator("#s-kpis .kpi__sub").first()).toContainText("ocorrências (");
});

test("filtro de tipo de evento: só no SisGeO e muda os números", async ({ page }) => {
  await abrir(page, "#amb=sisgeo");
  const filtro = page.locator("#f-tipo");
  await expect(filtro).toBeVisible();
  const opcoes = await filtro.locator("option").allInnerTexts();
  expect(opcoes.length).toBeGreaterThan(2);
  const ultimo = opcoes.at(-1);                       // o tipo menos frequente
  await filtro.selectOption({ label: ultimo });
  await expect(page.locator("#s-kpis .kpi__valor").first()).toHaveText(ultimo);
  await expect(page).toHaveURL(/tipo=/);
  await page.click('.ambientes a[data-amb="redecs"]');
  await expect(filtro).toBeHidden();                  // não existe no ambiente REDECs
});

test("logo da FE no cabeçalho e lema no rodapé", async ({ page }) => {
  await abrir(page);
  const logo = page.locator(".topo__logo");
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(page.locator(".rodape__lema")).toHaveText("FE-SEDEC: Inteligência que orienta. Apoio que fortalece. Ação que protege.");
});

test("SisGeO › Tipos e territórios: rosca de tipo, subtipo, municípios e 11 REDECs", async ({ page }) => {
  await abrir(page, "#amb=sisgeo&aba=tipos");
  for (const id of ["s-tipo", "s-subtipo", "s-tipos-mun", "s-tipos-redec"]) {
    await expect(page.locator(`#${id} svg`)).toBeVisible();
  }
  await expect(page.locator("#s-tipos-redec")).toContainText("11 · Noroeste");
  await expect(page.locator("#s-unidade, #s-situacao")).toHaveCount(0);
});

test("mapa tem o contorno do estado", async ({ page }) => {
  await abrir(page);
  await expect(page.locator("#s-mapa .leaflet-contorno-pane path")).toHaveCount(1);
});

test("Fogo em vegetação: eventos x ocorrências e quadro de eventos em andamento", async ({ page, request }) => {
  // a planilha de fogo é opcional: sem dados dela (ponte antiga, planilha fora do ar), o ambiente
  // precisa abrir mostrando "sem registros" — e o teste não pode bloquear a publicação do resto
  const fv = await (await request.get("/data/fogo_sisgeo.json")).json();
  await abrir(page, "#amb=fogo");
  if (!fv.length) {
    await expect(page.locator("#fv-redec .vazio")).toBeVisible();
    await expect(page.locator(".painel-aba[data-amb='fogo'] .falha")).toHaveCount(0);
    return;
  }
  await expect(page.locator("#fv-kpis .kpi__rotulo")).toHaveText(["Ocorrências válidas", "Eventos", "Eventos com apoio", "Municípios atingidos", "Em andamento"]);
  const n = (i) => page.locator("#fv-kpis .kpi__valor").nth(i).innerText().then((t) => Number(t.replace(/\D/g, "")));
  const [ocorr, eventos] = [await n(0), await n(1)];
  expect(ocorr).toBeGreaterThan(0);
  expect(eventos).toBeLessThanOrEqual(ocorr);            // um evento pode ter várias ocorrências
  await expect(page.locator("#fv-mes svg")).toBeVisible();
  await expect(page.locator("#fv-abertos")).not.toBeEmpty();
  await page.click('.abas [data-amb="fogo"][data-aba="condicoes"]');
  await expect(page.locator("#fv-kpis-clima .kpi")).toHaveCount(3);
});

test("nível de resposta visível em todos os ambientes, com a cor do nível", async ({ page, request }) => {
  const nrChuva = (await (await request.get("/data/nivel_resposta.json")).json())[0]?.nivel;
  const nrFogo = (await (await request.get("/data/fogo_nivel_resposta.json")).json())[0]?.nivel;
  await abrir(page);
  for (const [amb, nr] of [["sisgeo", nrChuva], ["redecs", nrChuva], ["fogo", nrFogo]]) {
    await page.click(`.ambientes a[data-amb="${amb}"]`);
    if (nr === undefined) { await expect(page.locator("#nr")).toBeHidden(); continue; }
    await expect(page.locator("#nr")).toBeVisible();
    await expect(page.locator("#nr")).toHaveAttribute("data-nr", String(nr));
    await expect(page.locator("#nr .nr__valor")).toHaveText(`NR ${nr}`);
  }
});

test("cartões por dia trazem a comparação com o mesmo período do ano anterior", async ({ page }) => {
  await abrir(page, "#amb=sisgeo");
  await expect(page.locator("#s-serie-nota")).toContainText(/mesmo período|\d{4}:/);
  await page.click('.ambientes a[data-amb="fogo"]');
  const nota = page.locator("#fv-serie-nota");
  if (await page.locator("#fv-serie .vazio").count() === 0) await expect(nota).not.toBeEmpty();
});

test("SisGeO · Chuvas avisa que o fogo tem ambiente próprio (quando houver fogo na planilha)", async ({ page, request }) => {
  const meta = await (await request.get("/data/meta.json")).json();
  await abrir(page, "#amb=sisgeo");
  const aviso = page.locator("#s-aviso-fogo");
  if (meta.conjuntos.sisgeo?.excluidos) {
    await expect(aviso).toBeVisible();
    await aviso.locator("a").click();
    await expect(page.locator("body")).toHaveAttribute("data-amb", "fogo");
  } else {
    await expect(aviso).toBeHidden();
  }
});

test("gráfico volta a aparecer depois de um filtro sem registros", async ({ page }) => {
  await page.goto("/#amb=sisgeo");
  await page.waitForFunction(() => window.__painelPronto);
  await page.fill("#f-de", "1990-01-01");
  await page.fill("#f-ate", "1990-01-02");
  await page.locator("#f-ate").dispatchEvent("change");
  await expect(page.locator("#s-redec .vazio")).toBeVisible();
  await page.click(".filtros__periodo button[data-periodo=tudo]");
  for (const id of ["#s-redec", "#s-serie", "#s-top-mun"]) {
    await expect(page.locator(`${id} .vazio`)).toHaveCount(0);
    await expect(page.locator(`${id} svg`).first()).toBeVisible();
  }
});

test("cartão Eventos com apoio abre a tabela filtrada", async ({ page }) => {
  await page.goto("/#amb=fogo");
  await page.waitForFunction(() => window.__painelPronto);
  const cartao = page.locator("#fv-kpis button.kpi", { hasText: "Eventos com apoio" });
  test.skip(await cartao.count() === 0, "amostra sem eventos com apoio");
  await cartao.click();
  await expect(page).toHaveURL(/aba=registros/);
  await expect(page).toHaveURL(/apoio=1/);
  await expect(page.locator("#fv-tabela-filtro")).toContainText("Só eventos com apoio");
  const linhas = page.locator("#fv-tabela tbody tr");
  expect(await linhas.count()).toBeGreaterThanOrEqual(2);
  await page.click("#fv-tabela-filtro button");
  await expect(page.locator("#fv-tabela-filtro")).toContainText("Mostrar só eventos com apoio");
});

test("depuração: excluídas não contam e aparecem na aba Depuração", async ({ page, request }) => {
  const meta = await (await request.get("/data/meta.json")).json();
  for (const [amb, p, conj] of [["sisgeo", "s", "sisgeo"], ["fogo", "fv", "fogo_sisgeo"]]) {
    const dep = meta.conjuntos[conj]?.depuracao;
    if (!dep || dep.situacao + dep.motivo + dep.ambos === 0) continue; // planilha sem exclusões (ou de fogo vazia)
    await page.goto("about:blank");
    await page.goto(`/#amb=${amb}&aba=depuracao`);
    await page.waitForFunction(() => window.__painelPronto);
    await expect(page.locator(`#${p}-dep-kpis`)).toContainText("Excluídas por motivo");
    const linhas = await page.locator(`#${p}-dep-tabela tbody tr`).count();
    expect(linhas).toBeGreaterThan(0);
    // nenhuma linha da tabela de registros tem situação fora das válidas
    await page.click(`.abas [data-amb="${amb}"][data-aba="registros"]`);
    const sits = await page.locator(`#${p === "s" ? "s" : "fv"}-tabela tbody td`).allTextContents();
    expect(sits.some((t) => /Falso aviso|Cancelad|desistiu/.test(t))).toBe(false);
  }
});

test("SisGeO · Chuvas: cartões numéricos por tipo filtram o painel", async ({ page }) => {
  await abrir(page, "#amb=sisgeo");
  const cartoes = page.locator("#s-kpis-num .kpi");
  await expect(cartoes).toHaveCount(5);
  await expect(cartoes.first()).toContainText("Ocorrências válidas");
  const corte = page.locator("#s-kpis-num button.kpi", { hasText: "Corte de Árvore" });
  await corte.click();
  await expect(page).toHaveURL(/tipo=/);
  await expect(page.locator("#s-kpis-num button.kpi", { hasText: "Corte de Árvore" })).toContainText("Limpar filtro");
  await page.locator("#s-kpis-num button.kpi", { hasText: "Corte de Árvore" }).click();
  await expect(page).not.toHaveURL(/tipo=/);
});

test("botão alterna modo claro/escuro e lembra a escolha", async ({ page }) => {
  await abrir(page, "#amb=sisgeo");
  const fundo = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const antes = await fundo();
  await page.click("#botao-tema");
  const depois = await fundo();
  expect(depois).not.toBe(antes);
  await page.reload();
  await page.waitForFunction(() => window.__painelPronto);
  expect(await fundo()).toBe(depois);
  await page.click("#botao-tema");
  expect(await fundo()).toBe(antes);
  await expect(page.locator(".painel-aba:not([hidden]) .falha")).toHaveCount(0);
});

test("SisGeO · Fogo: cartões de UC e ranking das UCs", async ({ page }) => {
  await abrir(page, "#amb=fogo");
  const linha2 = page.locator("#fv-kpis-lider .kpi__rotulo");
  await expect(linha2).toHaveText(["Subtipo mais frequente", "Município com mais ocorrências", "REDEC com mais ocorrências", "Eventos em UC ou até 1 km", "UC mais pressionada"]);
  await expect(page.locator("#fv-kpis .kpi")).toHaveCount(5); // linha 1 intacta
  const ver = page.locator("#fv-kpis-lider button.kpi", { hasText: "Eventos em UC" });
  if (await ver.count()) {
    await ver.click();
    await expect(page).toHaveURL(/aba=territorios/);
    await expect(page.locator("#fv-ucs svg")).toBeVisible();
  }
});

test("Resposta: envios IDAP/Cell Broadcast/sirenes e mensagens ao clicar", async ({ page }) => {
  await abrir(page, "#amb=redecs&aba=resposta");
  await expect(page.locator("#r-kpis-resposta .kpi__rotulo")).toHaveText(["Ações de ajuda humanitária", "Pontos de apoio", "Envios IDAP", "Envios Cell Broadcast", "Acionamentos de sirenes"]);
  const idap = page.locator("#r-kpis-resposta button.kpi", { hasText: "Envios IDAP" });
  if (await idap.count()) {
    await idap.click();
    await expect(page.locator("#r-alertas-filtro [aria-pressed=true]")).toContainText("IDAP");
    await expect(page.locator("#r-alertas tbody tr").first()).toContainText("IDAP");
  }
});

test("Decretação: padrão só vigentes; cartão alterna para todos os registrados", async ({ page }) => {
  await abrir(page, "#amb=redecs&aba=decretos");
  await expect(page.locator("#r-decretos-titulo")).toHaveText("Decretos municipais vigentes");
  const n = (i) => page.locator("#r-kpis-decretos .kpi__valor").nth(i).innerText().then((t) => Number(t.replace(/\D/g, "")));
  const [registrados, vigentes] = [await n(0), await n(1)];
  const linhas = async () => { const t = await page.locator("#r-decretos .t-conta").innerText(); return Number((t.match(/\d+/) || ["0"])[0]); };
  if (vigentes) expect(await linhas()).toBe(vigentes);
  await page.locator("#r-kpis-decretos button.kpi", { hasText: "Decretos registrados" }).click();
  await expect(page.locator("#r-decretos-titulo")).toHaveText("Decretos municipais registrados");
  if (registrados) expect(await linhas()).toBe(registrados);
  await page.locator("#r-kpis-decretos button.kpi", { hasText: "Decretos registrados" }).click();
  await expect(page.locator("#r-decretos-titulo")).toHaveText("Decretos municipais vigentes");
});
