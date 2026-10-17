// Google Analytics 4 — contagem de acessos ao painel.
// Para ligar: cole o "ID da métrica" (começa com G-) abaixo. Vazio = nada é carregado.
// O ID não é segredo (fica visível em qualquer site que usa GA), pode ficar no repositório.
export const GA_ID = "G-3RBS4BNN07";

let ultimo = "";

export function iniciarAnalytics() {
  // não conta os testes automáticos (robô de publicação) nem cópias abertas no computador
  if (!GA_ID || navigator.webdriver || !location.hostname.endsWith("github.io")) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  // sem anúncios nem sinais do Google: só contagem de uso
  window.gtag("config", GA_ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(s);
}

/** Evento "ver_aba" a cada troca de ambiente/aba (para saber o que é mais consultado). */
export function registrarAba(ambiente, aba) {
  const chave = `${ambiente}/${aba}`;
  if (!window.gtag || chave === ultimo) return;
  ultimo = chave;
  window.gtag("event", "ver_aba", { ambiente, aba });
}
