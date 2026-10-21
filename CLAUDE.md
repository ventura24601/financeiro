# Controle Financeiro e Caixa — IcomTV

Camada própria de análise financeira da ICOM TV Corporativa LTDA (SaaS de TV de sala de espera, receita recorrente via Vindi, hardware em comodato, Lucro Real). O ERP oficial continua sendo o ContaAzul; este sistema é alimentado pelo upload de extratos bancários.

## Como trabalhar neste projeto
- Trabalhar em **fases** e parar ao fim de cada uma para validação do CEO. Status atual: **Fase 0 (descoberta)**.
- Protótipo funcionando > documentação longa.
- Se algum número não fechar (conciliação, duplicidade, transferência suspeita), **parar e avisar** antes de seguir.
- Nunca inventar categoria. Abaixo do limiar de confiança, o lançamento vai para "pendentes de revisão".
- Toda classificação precisa ser rastreável (qual regra/motivo levou à categoria).

## Fases
0. Descoberta (perguntas) · 1. Banco + importação · 2. DRE + classificação · 3. Custos fixos e recorrência · 4. Caixa e projeção · 5. Comparativos · 6. Evolução/snapshots/anomalias · 7. Comandos `.claude/commands/` e saídas.

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
