# Painel de Monitoramento — Defesa Civil RJ

Painel estático (GitHub Pages) alimentado pela planilha **NOVA BASE ANALISTAS**.
SEDEC-RJ · FE-SEDEC · NI²AD.

```
Google Sheets ──(GitHub Actions, a cada 30 min)──► ETL Python ──► validação ──► JSON ──► teste no navegador ──► GitHub Pages
                                                       │ falhou?
                                                       └─► nada é publicado; o site continua com a última versão boa
```

## Dois ambientes

| Ambiente | Link | Abas |
|---|---|---|
| **Ocorrências SisGeO** (CBMERJ, vermelho) | `.../#amb=sisgeo` | Visão geral · Tipos e unidades · Registros · Qualidade |
| **Eventos REDECs** (Defesa Civil, laranja) | `.../#amb=redecs` | Visão geral · Decretação · Resposta · Registros · Consulta · Qualidade |

Cada ambiente tem mapa, indicadores e gráficos próprios. Os filtros (período, REDEC, município) são mantidos ao
trocar de ambiente, para comparar as duas fontes no mesmo recorte. O endereço guarda ambiente, aba e filtros:
`#amb=redecs&aba=decretos&redec=REDEC%2011%20-%20NOROESTE` abre direto nos decretos do Noroeste.

## Por que este desenho não quebra a cada commit

| Risco | Proteção |
|---|---|
| Alguém renomeia/apaga coluna ou aba | `config/fontes.yml` é o **contrato**. Coluna obrigatória ausente = publicação bloqueada. Grafias diferentes (acento, maiúscula, quebra de linha) são aceitas. |
| Datas, números e nomes digitados de jeitos diferentes | `etl/normaliza.py` padroniza (testado em `tests/`). O que não der para ler vira campo vazio + aviso na aba **Qualidade dos dados**. |
| Município escrito de outro jeito / REDEC vazia | Junção pela tabela `referencia/municipios_rj.csv` (código IBGE). REDEC vazia é completada pelo município. |
| Um commit quebra o JavaScript | Teste Playwright abre todas as abas e reprova se houver erro. Sem passar, não publica. |
| Uma base falha ao carregar | Cada painel é isolado: só aquele cartão mostra aviso. |
| CDN fora do ar / biblioteca muda de versão | ECharts 5.5.1 e Leaflet 1.9.4 estão **dentro do repositório** (`site/assets/vendor`). |
| Atualização de dependência | Versões fixas; Dependabot abre PR mensal, que só entra se os testes passarem. |
| Dados pessoais | Só sai do ETL o que está listado no contrato. Nomes/matrículas do efetivo e endereços **não** são publicados; coordenadas são arredondadas (~100 m). Há teste que reprova se uma matrícula vazar. |

## Estrutura

```
config/fontes.yml          contrato: abas, colunas, tipos, obrigatórias, limites
referencia/municipios_rj.csv  92 municípios · código IBGE · REDEC
apps-script/Codigo.gs      ponte gratuita planilha -> GitHub (colar no Apps Script da planilha)
etl/                       fonte.py (leitura) · normaliza.py (limpeza) · build.py (orquestra)
site/                      index.html · assets/{css,js,geo,vendor} · data/ (gerado, não versionado)
tests/                     testes do ETL + amostra anonimizada
e2e/                       teste de fumaça no navegador (Playwright)
.github/workflows/         publicar.yml (cron + push) · ci.yml (PR)
```

## Configuração inicial (uma vez) — 100% gratuita

A leitura da planilha usa um **Google Apps Script** dentro da própria planilha: sem Google Cloud, sem cartão,
sem período de teste. O GitHub Pages é gratuito para repositórios públicos.

1. **Na planilha** NOVA BASE ANALISTAS: *Extensões › Apps Script*. Cole o conteúdo de `apps-script/Codigo.gs` e salve.
2. Selecione a função `gerarToken` › **Executar** › autorize com a sua conta. Copie o token que aparece no *Registro de execução*.
3. *Implantar › Nova implantação* › tipo **App da Web** · Executar como: **Eu** · Quem pode acessar: **Qualquer pessoa**.
   Copie a URL (termina em `/exec`).
   *"Qualquer pessoa" só permite chamar a URL; sem o token ela responde "não autorizado".*
4. **No GitHub** › *Settings › Secrets and variables › Actions › New repository secret*:
   - `APPS_SCRIPT_URL` = URL do passo 3
   - `APPS_SCRIPT_TOKEN` = token do passo 2
5. *Actions › Atualizar e publicar painel › Run workflow*.

Já configurado no repositório: Pages via GitHub Actions e proteção da branch `main` (exige PR com testes verdes).

> Alternativa sem Apps Script: `--fonte google` com conta de serviço do Google Cloud (a Sheets API também é gratuita,
> mas exige criar um projeto no Cloud). Ver `etl/fonte.py`.

## Rodar no computador

```bash
pip install -r requirements-dev.txt
pytest -q
python -m etl.build --fonte xlsx --origem planilha.xlsx      # ou --fonte texto (dump) / --fonte appsscript
python -m http.server 8000 --directory site                  # abrir http://localhost:8000
cd e2e && npm ci && npx playwright install chromium && npx playwright test
```

## Rotina do dia a dia

- **Mudou a planilha?** Se for só conteúdo, nada a fazer. Se criou/renomeou coluna que deve aparecer no painel,
  acrescente o nome em `config/fontes.yml` (num PR).
- **Publicação falhou?** Actions → execução vermelha → etapa "Ler planilha, validar…" mostra a linha com `ERRO`
  e o que corrigir. O site continua no ar com os dados anteriores; o selo no topo fica amarelo após 3 h sem atualizar.
- **Mudança no site?** Sempre em branch + PR. O PR roda testes e anexa um print do painel (artefato `print-painel-pr`).

## Observações

- A amostra de testes (`tests/fixtures/amostra.txt`) é fictícia: estrutura real, textos e identificadores trocados.
- O GitHub desativa workflows agendados de repositórios **públicos** após 60 dias sem commits. Um commit qualquer reativa.
- GitHub Pages em conta gratuita é **público** para quem tiver o link (`noindex` só evita buscadores).
  Para acesso restrito, ver o documento do projeto (opções: GitHub Enterprise com Pages privado, ou Cloudflare Pages + Access).
