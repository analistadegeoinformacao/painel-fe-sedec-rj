# Painel Integrado - Força Especializada da SEDEC-RJ

Painel estático (GitHub Pages) alimentado pela planilha **NOVA BASE ANALISTAS**.
SEDEC-RJ · FE-SEDEC · NI²AD.

```
Google Sheets ──(GitHub Actions, a cada 10 min)──► ETL Python ──► validação ──► JSON ──► teste no navegador ──► GitHub Pages
                                                       │ falhou?
                                                       └─► nada é publicado; o site continua com a última versão boa
```

## Três ambientes, duas planilhas

| Ambiente | Planilha de origem | Link | Abas |
|---|---|---|---|
| **SisGeO · Chuvas** (vermelho) | NOVA BASE ANALISTAS — sem "Fogo em Vegetação" | `#amb=sisgeo` | Visão geral · Tipos e territórios · Registros · Qualidade |
| **Eventos REDECs** (laranja) | NOVA BASE ANALISTAS (chuvas) | `#amb=redecs` | Visão geral · Decretação · Resposta · Registros · Consulta · Qualidade |
| **SisGeO · Fogo** (âmbar) | PLANILHA FOGO EM VEGETAÇÃO | `#amb=fogo` | Visão geral · Subtipos e territórios · Condições meteorológicas · Registros · Qualidade |

- Cada conjunto em `config/fontes.yml` declara `planilha:` (padrão: principal). Abas de planilhas diferentes nunca se
  misturam, mesmo com o mesmo nome. A ponte do Apps Script só lê as planilhas da lista `PAINEL_PLANILHAS_PERMITIDAS`
  e confirma qual leu; se não confirmar (ponte antiga), os dados de fogo ficam vazios com aviso — nunca misturados.
- **Identidade no SisGeO:** número do evento (`IdEvento`) + número da ocorrência (`C…`). Linhas com o mesmo par são
  repetições e saem da contagem; o mesmo evento com várias ocorrências = unidades em apoio (painel mostra
  "Ocorrências", "Eventos" e "Eventos com apoio").
- A planilha de fogo é opcional para a publicação: se estiver fora do ar, só o ambiente de fogo mostra aviso.
- Fogo em vegetação tem uma única fonte oficial: a planilha de fogo. Na NOVA BASE, o tipo "Fogo em Vegetação" é
  excluído do SisGeO · Chuvas (`excluir:` no contrato) e o painel avisa quantas ocorrências foram para o outro ambiente.
- **Nível de resposta (NR):** aba NÍVEL DE RESPOSTA de cada planilha, sempre visível no topo com as cores
  institucionais (NR1 verde, NR2 amarelo, NR3 laranja, NR4 vermelho, NR5 roxo). Chuvas e REDECs usam o NR da NOVA
  BASE; o ambiente de fogo usa o NR da planilha de fogo.
- **Por dia × ano anterior:** os cartões diários comparam a janela escolhida (em "Tudo": do 1º de janeiro do ano mais
  recente até hoje) com as mesmas datas do ano anterior (linha cinza). Até 31 dias, cada ponto mostra o número.
  No fogo, a linha vermelha tracejada marca o **Indicativo Extinctus (70 ocorrências/dia)** — só aparece sem filtro
  de REDEC/município, porque é uma referência estadual (`INDICATIVO_EXTINCTUS` em `site/assets/js/app.js`).
- **Mapas:** as faixas de cor se ajustam ao recorte (progressão geométrica de 1 até o maior valor, em números
  redondos), para o mapa não saturar quando muitos municípios passam de 100.
- **Depuração (SisGeO · Chuvas e SisGeO · Fogo):** só conta a ocorrência com situação "Ocorrência atendida com
  prestação de serviço" ou "Encerrada com empenho de viatura" **e** sem nada em "Motivo da Exclusão". As demais
  (excluídas por situação, por motivo ou pelos dois) ficam fora de todos os indicadores e aparecem só na aba
  **Depuração**. A lista de situações válidas está em `config/fontes.yml` (`depuracao:`); o motivo aparece na tabela da aba Depuração, sem números longos (telefone, CPF, matrícula) nem e-mails.
- **Unidades de conservação (SisGeO · Fogo):** o ETL cruza a coordenada de cada ocorrência com
  `referencia/ucs_rj.geojson` (UCs de proteção integral, sem zonas de amortecimento) e marca a UC e a faixa
  (dentro / até 500 m / até 1 km). A coordenada é descartada antes de publicar. Painel: cartões "Eventos em UC ou
  até 1 km" e "UC mais pressionada" (Visão geral) e ranking das UCs (Subtipos e territórios). Conta eventos.
- Filtros de período, REDEC e município valem nos três ambientes; o endereço guarda ambiente, aba e filtros.

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
apps-script/Codigo.gs      ponte gratuita planilha -> GitHub (projeto Apps Script separado, lê a planilha pelo ID)
etl/                       fonte.py (leitura) · normaliza.py (limpeza) · build.py (orquestra)
site/                      index.html · assets/{css,js,geo,vendor} · data/ (gerado, não versionado)
tests/                     testes do ETL + amostra anonimizada
e2e/                       teste de fumaça no navegador (Playwright)
.github/workflows/         publicar.yml (cron + push) · ci.yml (PR)
```

## Configuração inicial (uma vez) — 100% gratuita

A leitura da planilha usa um **Google Apps Script** dentro da própria planilha: sem Google Cloud, sem cartão,
sem período de teste. O GitHub Pages é gratuito para repositórios públicos.

1. Em **https://script.google.com › Novo projeto** (projeto **separado** — não use *Extensões › Apps Script* da
   planilha, para não interferir nos scripts e complementos que já existem nela). Cole `apps-script/Codigo.gs` e salve.
2. Selecione a função `gerarToken` › **Executar** › autorize com a conta que tem acesso à planilha.
   Copie o token que aparece no *Registro de execução*. (Opcional: rode `testarLeitura` para conferir o acesso.)
3. *Implantar › Nova implantação* › tipo **App da Web** · Executar como: **Eu** · Quem pode acessar: **Qualquer pessoa**.
   Copie a URL (termina em `/exec`).
   *"Qualquer pessoa" só permite chamar a URL; sem o token ela responde "não autorizado".*
4. **No GitHub** › *Settings › Secrets and variables › Actions › New repository secret*:
   - `APPS_SCRIPT_URL` = URL do passo 3
   - `APPS_SCRIPT_TOKEN` = token do passo 2
5. *Actions › Atualizar e publicar painel › Run workflow*.

Já configurado no repositório: Pages via GitHub Actions e proteção da branch `main` (exige PR com testes verdes).

### Frequência de atualização

O GitHub consulta a planilha **a cada 10 min** (horários de pico podem atrasar execuções agendadas) e só
republica o site quando os dados mudaram — ou 1x por hora, como sinal de vida. Sem tokens e sem nada a renovar.

- **Botão Atualizar** (topo do painel): carrega na hora a versão mais recente já publicada.
- **Painel aberto numa tela**: confere sozinho a cada 5 min e recarrega quando há dados novos.
- **Publicar imediatamente** (sem esperar os 10 min): *Actions › Atualizar e publicar painel › Run workflow*.

> Alternativa sem Apps Script: `--fonte google` com conta de serviço do Google Cloud (a Sheets API também é gratuita,
> mas exige criar um projeto no Cloud). Ver `etl/fonte.py`.

## Acessos (Google Analytics 4)

`site/assets/js/analytics.js` → `GA_ID = "G-…"`. Vazio = desligado. Conta só o site publicado (não conta testes nem
cópias locais). Além das visitas, envia o evento `ver_aba` com `ambiente` e `aba` (cadastre os dois como dimensões
personalizadas no GA para ver as abas mais consultadas). Sem Google Signals nem personalização de anúncios.

## Rodar no computador

```bash
pip install -r requirements-dev.txt
pytest -q
python -m etl.build --fonte xlsx --origem planilha.xlsx --origem-fogo fogo.xlsx   # ou --fonte texto / appsscript
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
