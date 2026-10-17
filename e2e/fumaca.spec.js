const { test, expect } = require("@playwright/test");

const AMBIENTES = {
  sisgeo: ["geral", "tipos", "registros", "qualidade"],
  redecs: ["geral", "decretos", "resposta", "registros", "consulta", "qualidade"],
};

async function abrir(page, hash = "") {
  // mapa base e fontes externas não fazem parte do teste
  await page.route(/arcgisonline|fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await page.goto("/" + hash);
  await page.waitForFunction(() => window.__painelPronto === true);
}

test("os dois ambientes carregam todas as abas sem erro de JavaScript", async ({ page }) => {
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
    const outro = amb === "sisgeo" ? "redecs" : "sisgeo";
    await expect(page.locator(`.abas [data-amb="${outro}"]:visible`)).toHaveCount(0);
    for (const aba of abas) {
      await page.click(`.abas [data-amb="${amb}"][data-aba="${aba}"]`);
      const sec = page.locator(`.painel-aba[data-amb="${amb}"][data-aba="${aba}"]`);
      await expect(sec).toBeVisible();
      await expect(sec.locator(".falha")).toHaveCount(0);
    }
    await page.click(`.abas [data-amb="${amb}"][data-aba="geral"]`);
    await expect(page.locator(`#${amb[0]}-mapa .leaflet-interactive`).first()).toBeVisible();
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
  const txt = await (await request.get("/data/sisgeo.json")).text();
  expect(txt).not.toMatch(/\(#?\d{5,7}\)/);
  expect(txt.toLowerCase()).not.toContain("efetivo");
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
