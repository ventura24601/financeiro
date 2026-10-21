# Controle Financeiro e Caixa — IcomTV

Camada própria de análise financeira da ICOM TV Corporativa LTDA (SaaS de TV de sala de espera, receita recorrente via Vindi, hardware em comodato, Lucro Real). O ERP oficial continua sendo o ContaAzul; este sistema é alimentado pelo upload de extratos bancários.

## Como trabalhar neste projeto
- Trabalhar em **fases** e parar ao fim de cada uma para validação do CEO. Status atual: **Fase 1 entregue, aguardando validação** (pendências da Fase 0: saldos iniciais da conta digital Vindi e dos fundos, ContaAzul, custos fixos, caixa mínimo, empresas relacionadas).

## Como rodar
```
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m financeiro importar    # extratos/entrada → banco → conciliação → extratos/processados
.venv/bin/python -m financeiro status      # contas, o que fica fora da DRE, entradas por canal, saídas
.venv/bin/python -m financeiro conciliar
.venv/bin/python -m pytest -q tests
```
Código: `financeiro/importadores/` (um leitor por formato → `Extrato`), `importar.py` (dedup, tipo, canal, espelhos, regra Vindi), `conciliacao.py`, `schema.sql`. Configuração editável: `config/contas.yaml` (contas próprias, CNPJs, saldos iniciais) e `config/tipos.yaml` (o que fica fora da DRE e canais de receita). Banco em `data/financeiro.db` (fora do git).
- Dedup: hash de conta + data + valor + descrição normalizada + **índice de ocorrência** no dia (dois lançamentos idênticos legítimos no mesmo dia não colapsam; reimportação gera os mesmos índices). Arquivo idêntico é reconhecido pelo sha256. Vindi deduplica pelo `Id`.
- Transferências internas e aplicações geram o **lado espelho** na conta de contrapartida (`espelho_de`), para o caixa consolidado fechar.
- Divergência de conciliação (exceto dia ainda aberto na exportação) → o comando para, retorna erro e mantém os arquivos em `extratos/entrada`.
- Protótipo funcionando > documentação longa.
- Se algum número não fechar (conciliação, duplicidade, transferência suspeita), **parar e avisar** antes de seguir.
- Nunca inventar categoria. Abaixo do limiar de confiança, o lançamento vai para "pendentes de revisão".
- Toda classificação precisa ser rastreável (qual regra/motivo levou à categoria).

## Fases
0. Descoberta (perguntas) · 1. Banco + importação · 2. DRE + classificação · 3. Custos fixos e recorrência · 4. Caixa e projeção · 5. Comparativos · 6. Evolução/snapshots/anomalias · 7. Comandos `.claude/commands/` e saídas.

## Decisões da Fase 0
- **Itaú ag. 0384 c/c 0011020-1** — exporta XLSX (cabeçalho + colunas Data, Lançamento, Ag/origem, Razão Social, CPF/CNPJ, Valor, Saldo). Linhas de saldo ("SALDO TOTAL DISPONÍVEL DIA", "SALDO EM CONTA CORRENTE") servem à conciliação, não são lançamentos.
- **Aplicação automática** (`APL/RES APLIC AUT MAIS`): varredura conta ↔ aplicação; fora da DRE e fora do fluxo. Conciliar pelo "SALDO TOTAL DISPONÍVEL DIA" (conta + aplic. aut.). Dia corrente é parcial (pode faltar rendimento).
- **Canais de receita** — todo recebimento leva o atributo `canal` para acompanhar a **migração da carteira Bambuno → Vindi** (série mensal de % por canal):
  - **Vindi** (= Yapay, CNPJ 14.338.304/0001-78). Até jul/2026 repassava direto ao Itaú (`PIX RECEBIDO VINDI`, `SISPAG VISA/MAST`, `RECEBIMENTOS YAPAY`) → receita.
  - **Conta digital Vindi da ICOM TV** (CNPJ próprio 21.571.448/0001-35, ag. 0001 c/c 8392-8): desde jun/2026 os clientes pagam nela e ela envia `PIX RECEBIDO ICOM TV` ao Itaú em lotes mensais. É **conta própria** (`contas`, tipo gateway).
  - Relatório de transações Vindi (CSV `;`, latin-1, colunas Id, Cliente, Meio de Pagamento, Valor Pago, Taxa, Valor loja, Data Credito, Status) = fonte da receita detalhada: só `Status = Aprovada`, receita bruta = Valor Pago na Data Credito, Taxa → CSP (taxas Vindi). Dedup por `Id`. Créditos futuros de cartão (Data Credito > hoje) = recebíveis para a projeção de caixa. Contém dados pessoais de clientes: nunca versionar.
  - **Regra anti-dupla contagem:** em períodos cobertos pelo relatório Vindi, `PIX RECEBIDO ICOM TV` = transferência interna. O CEO **nem sempre envia** o relatório: em período sem cobertura, o PIX vira receita canal Vindi marcada como "estimada por repasse" (sem detalhe por cliente/dia).
  - **Bambuno** (CNPJ 27.012.243/0001-04): `PIX RECEBIDO BAMBUNO` → receita canal Bambuno (canal antigo).
  - `TED PAGAR.ME` (CNPJ 18.727.053/0001-74) → vendas no cartão de crédito via Bambuno.
- **Fundos próprios** (`APLICACAO TRUST DI`, `APLICACAO MIX CP RF` etc.): contas de investimento da ICOM TV; fora da DRE, dentro do caixa consolidado. Saldo inicial informado pelo CEO na data do extrato; o sistema acompanha aplicações/resgates a partir daí.
- **Cartão corporativo** (`BUSINESS 4004-3417`): o pagamento da fatura na c/c é transferência para a conta "cartão"; as despesas são classificadas pelos itens da fatura. A fatura chega depois, por upload, e é lida pela **API da Claude** (exceção autorizada pelo CEO ao "nada para serviços externos": só o arquivo da fatura, `ANTHROPIC_API_KEY` no `.env`). Sem fatura do mês, o pagamento fica numa linha "Cartão corporativo — não detalhado" e vai para pendentes.

## Convenções técnicas
- Valores em BRL com `Decimal` (no banco: `NUMERIC(14,2)` / inteiro em centavos). **Nunca float.**
- Datas no fuso `America/Sao_Paulo`.
- SQLite local com schema compatível com Postgres (migração futura para Supabase de BI): sem tipos exclusivos de SQLite, `snake_case`, chaves explícitas.
- Tabelas mínimas: `contas`, `lancamentos`, `categorias`, `regras_classificacao`, `custos_fixos`, `saldos_diarios`, `importacoes`, `snapshots`.
- Deduplicação por hash de (data + valor + descrição normalizada + conta).
- Transferências entre contas próprias e aplicações/resgates de investimento afetam **caixa**, nunca a DRE.
- Conciliação após toda importação: saldo calculado vs saldo final do extrato; divergência = alerta com a diferença.
- Regras de classificação em arquivo editável (YAML), versionável **sem dados sensíveis** (sem valores/CNPJs de clientes se o repo for público).

## Segurança e privacidade
- **Repositório GitHub é PÚBLICO.** Extratos, banco de dados, relatórios, exportações e qualquer dado financeiro ficam fora do git (ver `.gitignore`).
- Nada de enviar dados financeiros a serviços externos sem pedido explícito.
- **Painel web no Netlify** (pedido explícito do CEO, exceção ao "tudo local"): https://painel-fin-799afb.netlify.app — pasta `web/`. `python -m financeiro publicar` gera `web/dados/dados.json` (agregados + lançamentos Itaú de 120 dias, sem CPF/CNPJ, PF só com iniciais, clientes Vindi só somados por dia) e faz `netlify deploy --prod` pela CLI (nunca via git: os dados não vão para o repositório). O JSON é empacotado dentro das funções (`/api/dados`, `/api/analise`), não é arquivo público. Login em `/api/login` com bloqueio (5 erros/IP = 15 min; 30 erros/h = login fechado). Variáveis no Netlify (contexto production, secretas): `APP_PASSWORD_HASH` (scrypt, gerar com `web/scripts/gerar_hash_senha.mjs`), `APP_SECRET_KEY`, `ANTHROPIC_API_KEY`, opcional `CLAUDE_MODEL`.
- **IA:** `/api/analise` envia os dados compactos (`web/lib/contexto.mjs`) para a API da Claude com prompt caching; resposta em streaming. Projeção dia a dia em `financeiro/projecao.py` (premissas no docstring, backtest mensal).
- **Login:** o dashboard/app local exige login por senha. A senha **não** é gravada em texto puro nem em arquivo versionado: apenas o hash (bcrypt/argon2) em `.env` local (`APP_PASSWORD_HASH`), gitignored. `.env.example` documenta a variável sem valor.

## Modelo de DRE gerencial de CAIXA
Sempre rotular como **"DRE gerencial de caixa"** (base = extrato). Se houver dados de competência (ContaAzul/Vindi), mostrar as duas visões lado a lado.

1. Receita Bruta — assinaturas recorrentes; implantação/setup; outros produtos (EvidenceTV, InstaPlay, Site…)
2. (-) Deduções — PIS/COFINS não cumulativo, ISS, cancelamentos/estornos
3. = Receita Líquida
4. (-) Custo do Serviço Prestado — software de gestão de telas, infra/servidores/cloud, produção de conteúdo, hardware/logística do comodato, taxas Vindi
5. = Lucro Bruto / Margem Bruta
6. (-) Despesas Comerciais — vendas, comissões, marketing, mídia paga, ferramentas comerciais
7. (-) Despesas Administrativas — pessoal adm, contabilidade, jurídico, aluguel, softwares de gestão
8. (-) Despesas com Pessoal — (opcional, se separado de 6 e 7; a definir na Fase 0)
9. = EBITDA / Margem EBITDA
10. (-) Depreciação — comodato de equipamentos
11. (+/-) Resultado Financeiro — rendimentos, juros, tarifas bancárias, IOF
12. = Resultado antes de IRPJ/CSLL
13. (-) IRPJ e CSLL
14. = Lucro Líquido

Categorias reais virão do plano de contas do ContaAzul (mapeamento categoria → linha da DRE em `categorias`).

## Comparativos (definições fixas)
- **Semana** = segunda a domingo. "Mesma semana" = mesma semana ordinal do mês; se não existir no mês anterior, avisar e usar a última. Mostrar também o mesmo intervalo de dias do mês (ex.: 15–21/out vs 15–21/set).
- **MTD** = dia 1 até hoje vs dia 1 até o mesmo dia do mês anterior; versão por dias úteis (feriados nacionais); e mesmo período do ano anterior quando houver histórico.
- Em todo comparativo: atual, anterior, variação R$ e %, por linha da DRE e por categoria; destacar maiores variações com uma frase de causa (lançamento/contraparte).
