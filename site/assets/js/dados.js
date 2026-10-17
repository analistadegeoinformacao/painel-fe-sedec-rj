// Carregamento dos JSON gerados pelo ETL. Cada conjunto é carregado de forma
// independente: se um falhar, os outros painéis continuam funcionando.
const VERSAO_CONTRATO = 1;
const CONJUNTOS = [
  "sisgeo", "eventos", "boletins", "danos_humanos", "decretos", "decretos_historico",
  "alertas", "ajuda_humanitaria", "pontos_apoio", "severidade", "s2id", "chuva_24h", "chuva_1h",
];

async function json(caminho) {
  // ?v= evita cache velho do navegador/CDN após cada atualização
  const r = await fetch(caminho, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status}`);
  return r.json();
}

export async function carregar(base = "data") {
  const meta = await json(`${base}/meta.json`);
  if (meta.versao_contrato !== VERSAO_CONTRATO) {
    throw new Error(`Versão de dados ${meta.versao_contrato} incompatível com o site (${VERSAO_CONTRATO}).`);
  }
  const v = encodeURIComponent(meta.gerado_em);
  const resultados = await Promise.allSettled(CONJUNTOS.map((c) => json(`${base}/${c}.json?v=${v}`)));
  const dados = {};
  const falhas = [];
  resultados.forEach((r, i) => {
    if (r.status === "fulfilled" && Array.isArray(r.value)) dados[CONJUNTOS[i]] = r.value;
    else {
      dados[CONJUNTOS[i]] = null; // null = indisponível (diferente de [] = vazio)
      falhas.push(CONJUNTOS[i]);
    }
  });
  return { meta, dados, falhas };
}
