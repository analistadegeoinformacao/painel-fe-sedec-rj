// Rodar: node --test tests/js/
import { test } from "node:test";
import assert from "node:assert/strict";
import { resumoNota, blocoNota, linhaDecreto, ESQUEMA } from "../../site/assets/js/nota.js";

const municipios = [
  { cod_ibge: "3304557", municipio: "RIO DE JANEIRO - RJ", redec: "REDEC 1 - CAPITAL" },
  { cod_ibge: "3303500", municipio: "NOVA IGUAÇU - RJ", redec: "REDEC 2 - BAIXADA FLUMINENSE" },
  { cod_ibge: "3303302", municipio: "NITERÓI - RJ", redec: "REDEC 3 - METROPOLITANA" },
];
const oc = (cod, dt, tipo, extra = {}) => ({ cod_ibge: cod, data_ocorrencia: dt, tipo, situacao: "Ocorrência atendida com prestação de serviço", ...extra });
const sisgeo = [
  oc("3304557", "2026-11-10T07:00", "Corte de Árvore"),            // borda inicial (conta)
  oc("3304557", "2026-11-10T12:30", "Corte de Árvore", { vitimas: 1 }),
  oc("3303500", "2026-11-10T18:59", "Deslizamento/Desabamento"),
  oc("3303302", "2026-11-10T19:00", "Corte de Árvore"),            // borda final (conta)
  oc("3303302", "2026-11-10T19:01", "Corte de Árvore"),            // fora
  oc("3304557", "2026-11-10T06:59", "Corte de Árvore"),            // fora
  oc("3303500", "2026-11-10T10:00", "Corte de Árvore", { depuracao: "situacao", situacao: "Em andamento" }), // total, não validada
];

test("janela por data e hora, validadas x total, REDEC e municípios", () => {
  const r = resumoNota({ ini: "2026-11-10T07:00", fim: "2026-11-10T19:00", sisgeo, municipios, vigente: () => true });
  assert.equal(r.chuvas.total, 5);
  assert.equal(r.chuvas.validadas, 4);
  assert.equal(r.chuvas.excluidas, 1);
  assert.deepEqual(r.chuvas.tipos, { "Corte de Árvore": 3, "Deslizamento/Desabamento": 1 });
  assert.equal(r.chuvas.vitimas, 1);
  assert.equal(r.chuvas.redec[1], 2);
  assert.equal(r.chuvas.redec[2], 1);
  assert.equal(r.chuvas.redec[3], 1);
  assert.equal(r.chuvas.redec[4], 0);
  assert.deepEqual(r.chuvas.municipios[1], { "Rio de Janeiro": 2 });
  const soma = Object.values(r.chuvas.redec).reduce((a, b) => a + b, 0);
  assert.equal(soma, r.chuvas.validadas);          // regra que a ferramenta confere
  assert.equal(r.chuvas.situacoes["Em andamento"], 1);
  assert.equal(r.fogo, null);
});

test("danos: soma o retrato devolvido para a data do fim", () => {
  let diaPedido = null;
  const danos = (dia) => { diaPedido = dia; return { historico: true, ultimo: "2026-11-10",
    linhas: [{ desabrigados: 2, desalojados: 30, obitos: 0, outros_afetados: 5, afetados: 37 }, { desabrigados: 0, desalojados: 18, obitos: 1, outros_afetados: 317, afetados: 336 }] }; };
  const r = resumoNota({ ini: "2026-11-10T19:00", fim: "2026-11-11T07:00", sisgeo: [], municipios, danos, vigente: () => true });
  assert.equal(diaPedido, "2026-11-11");
  assert.deepEqual(r.danos, { data: "2026-11-11", retrato: "2026-11-10", historico: true, desabrigados: 2, desalojados: 48, obitos: 1, outros: 322, afetados: 373 });
  const vazio = resumoNota({ ini: "2026-11-10T19:00", fim: "2026-11-11T07:00", sisgeo: [], municipios, danos: () => ({ historico: true, linhas: [] }), vigente: () => true });
  assert.equal(vazio.danos, null);
});

test("decretos vigentes viram a linha da Nota", () => {
  const l = { cod_ibge: "3303500", municipio: "NOVA IGUAÇU - RJ", decreto: "187 de 07/10/26", data_decreto: "2026-10-07", prazo_dias: 180, nivel: 2, termino: "2027-04-04" };
  assert.equal(linhaDecreto(l, "Nova Iguaçu"), "NOVA IGUAÇU - Decreto Municipal N° 187 de 07 de Outubro de 2026 - Situação de Emergência Nível II (180 dias).");
  const r = resumoNota({ ini: "2026-11-10T07:00", fim: "2026-11-10T19:00", sisgeo: [], municipios, decretos: [l, { ...l, municipio: "NITERÓI - RJ", cod_ibge: "3303302" }], vigente: (x) => x.cod_ibge === "3303500" });
  assert.equal(r.decretos.length, 1);
  assert.equal(r.decretos[0].redec, 2);
});

test("severidade, alertas e formato do bloco", () => {
  const r = resumoNota({ ini: "2026-11-10T19:00", fim: "2026-11-11T07:00", sisgeo: [], municipios, vigente: () => true,
    severidade: [{ redec: "REDEC 5 - SUL I", severidade: "ALTO" }, { redec: "REDEC 7 - SERRANA I", severidade: "Muito Alto" }, { redec: "REDEC 1 - CAPITAL", severidade: "MODERADO" }],
    alertas: [{ data: "2026-11-10T20:00", tipo: "idap", envios: 2 }, { data: "2026-11-09T20:00", tipo: "idap", envios: 9 }, { data: "2026-11-11T03:00", tipo: "sirene", envios: 1 }] });
  assert.deepEqual(r.severidade, { alto: [5], muito_alto: [7] });
  assert.deepEqual(r.alertas, { idap: { registros: 1, envios: 2 }, sirene: { registros: 1, envios: 1 } });
  const b = blocoNota(r);
  const [cab, json] = b.split("\n");
  assert.equal(cab, ESQUEMA);
  assert.equal(JSON.parse(json).v, 1);
});
