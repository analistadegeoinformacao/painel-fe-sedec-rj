// Utilitários puros (sem DOM global, sem estado).
const nf = new Intl.NumberFormat("pt-BR");
const nfMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export const fmt = (n) => (n === null || n === undefined || Number.isNaN(n) ? "—" : nf.format(n));
export const fmtMoeda = (n) => (n === null || n === undefined ? "—" : nfMoeda.format(n));

/** '2026-03-05' ou '2026-03-05T14:20' -> '05/03/2026' (+ ' 14:20') */
export function fmtData(iso) {
  if (!iso) return "—";
  const [d, h] = iso.split("T");
  const [a, m, dia] = d.split("-");
  return `${dia}/${m}/${a}${h ? " " + h.slice(0, 5) : ""}`;
}

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Data de hoje em Brasília, formato ISO (yyyy-mm-dd). */
export function hojeBRT() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export function somaDias(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diasEntre(a, b) {
  return Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 86400000);
}

export function contarPor(linhas, chave) {
  const m = new Map();
  for (const l of linhas) {
    const k = typeof chave === "function" ? chave(l) : l[chave];
    if (k === null || k === undefined || k === "") continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

export function somarPor(linhas, chave, campo) {
  const m = new Map();
  for (const l of linhas) {
    const k = l[chave];
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + (l[campo] || 0));
  }
  return m;
}

export const soma = (linhas, campo) => linhas.reduce((t, l) => t + (l[campo] || 0), 0);

/** 'REDEC 2 - BAIXADA FLUMINENSE' -> '2 · Baixada Fluminense' */
export function rotuloRedec(r) {
  const m = /REDEC\s*(\d+)\s*-\s*(.*)/i.exec(r || "");
  if (!m) return r || "—";
  return `${m[1]} · ${titulo(m[2])}`;
}

export function titulo(s) {
  const minusc = new Set(["de", "da", "do", "das", "dos", "e"]);
  return String(s || "")
    .toLowerCase()
    .replace(/\s*-\s*rj$/, "")
    .split(" ")
    .map((p, i) => (i > 0 && minusc.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ")
    .replace(/\bIi\b/, "II").replace(/\bIii\b/, "III");
}

export function baixarCSV(nome, colunas, linhas) {
  const q = (v) => {
    const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const corpo = [colunas.map((c) => q(c.titulo)).join(";"), ...linhas.map((l) => colunas.map((c) => q(l[c.campo])).join(";"))].join("\n");
  const blob = new Blob(["﻿" + corpo], { type: "text/csv;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: nome + ".csv" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
