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
  await expect(page.locator("#fv-kpis .kpi__rotulo")).toHaveText(["Ocorrências", "Eventos", "Eventos com apoio", "Municípios atingidos", "Em andamento"]);
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
