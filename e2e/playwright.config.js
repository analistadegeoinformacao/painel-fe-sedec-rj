// Teste de fumaça: sobe o site com os dados gerados e confere que nada quebrou.
const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: ".",
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:4173", viewport: { width: 1440, height: 900 } },
  webServer: { command: "python3 -m http.server 4173 --bind 127.0.0.1 --directory ../site", port: 4173, reuseExistingServer: true },
});
