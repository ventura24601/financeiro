-- Schema compatível com SQLite e Postgres.
-- Valores monetários em centavos (BIGINT) para nunca passar por float.
-- Datas em ISO 'YYYY-MM-DD'; timestamps em ISO com fuso America/Sao_Paulo.
-- Na migração para Postgres: trocar "INTEGER PRIMARY KEY" por "BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY".

CREATE TABLE IF NOT EXISTS contas (
    id INTEGER PRIMARY KEY,
    codigo VARCHAR(40) NOT NULL UNIQUE,
    nome VARCHAR(120) NOT NULL,
    banco VARCHAR(40),
    tipo VARCHAR(20) NOT NULL,                -- corrente | gateway | investimento | cartao
    agencia VARCHAR(20),
    numero VARCHAR(30),
    saldo_inicial_centavos BIGINT,            -- informado pelo CEO quando o extrato não traz saldo
    saldo_inicial_data DATE,
    ativa BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS categorias (
    id INTEGER PRIMARY KEY,
    codigo VARCHAR(40) NOT NULL UNIQUE,
    nome VARCHAR(120) NOT NULL,
    linha_dre VARCHAR(60) NOT NULL,           -- ex.: receita_bruta, deducoes, csp, desp_comerciais...
    origem VARCHAR(20) NOT NULL DEFAULT 'manual',  -- manual | contaazul
    ativa BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS regras_classificacao (
    id INTEGER PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    prioridade INTEGER NOT NULL DEFAULT 100,
    padrao_descricao VARCHAR(200),
    contraparte_doc VARCHAR(20),
    valor_min_centavos BIGINT,
    valor_max_centavos BIGINT,
    categoria_id INTEGER NOT NULL REFERENCES categorias(id),
    confianca INTEGER NOT NULL,               -- 0 a 100
    origem VARCHAR(20) NOT NULL DEFAULT 'manual',
    ativa BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS importacoes (
    id INTEGER PRIMARY KEY,
    arquivo VARCHAR(300) NOT NULL,
    arquivo_sha256 CHAR(64) NOT NULL,
    formato VARCHAR(20) NOT NULL,
    conta_id INTEGER NOT NULL REFERENCES contas(id),
    periodo_inicio DATE,
    periodo_fim DATE,
    gerado_em VARCHAR(40),
    importado_em VARCHAR(40) NOT NULL,
    linhas_lidas INTEGER NOT NULL,
    novos INTEGER NOT NULL,
    duplicados INTEGER NOT NULL,
    conciliacao_ok BOOLEAN,
    conciliacao_msg TEXT
);

CREATE TABLE IF NOT EXISTS lancamentos (
    id INTEGER PRIMARY KEY,
    conta_id INTEGER NOT NULL REFERENCES contas(id),
    data DATE NOT NULL,
    descricao VARCHAR(300) NOT NULL,
    descricao_norm VARCHAR(300) NOT NULL,
    valor_centavos BIGINT NOT NULL,           -- positivo = entrada, negativo = saída
    contraparte_nome VARCHAR(200),
    contraparte_doc VARCHAR(20),              -- só dígitos
    contraparte_conta VARCHAR(60),            -- agência/conta de origem/destino
    -- operacional | transferencia_interna | varredura_aplicacao | aplicacao_resgate
    tipo VARCHAR(30) NOT NULL DEFAULT 'operacional',
    tipo_motivo VARCHAR(200),
    canal VARCHAR(30),                        -- vindi | bambuno | bambuno_cartao | outros_gateways
    estimado BOOLEAN NOT NULL DEFAULT FALSE,  -- receita estimada por repasse (sem detalhe)
    previsto BOOLEAN NOT NULL DEFAULT FALSE,  -- crédito futuro (recebível), ainda não caiu
    id_externo VARCHAR(80),
    contrapartida_conta_id INTEGER REFERENCES contas(id),  -- outra conta própria envolvida
    espelho_de INTEGER REFERENCES lancamentos(id),  -- lado gerado de uma transferência interna
    hash CHAR(64) NOT NULL UNIQUE,
    importacao_id INTEGER REFERENCES importacoes(id),
    categoria_id INTEGER REFERENCES categorias(id),
    confianca INTEGER,
    classificacao_motivo VARCHAR(300),
    criado_em VARCHAR(40) NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_lanc_conta_data ON lancamentos (conta_id, data);
CREATE INDEX IF NOT EXISTS ix_lanc_doc ON lancamentos (contraparte_doc);

CREATE TABLE IF NOT EXISTS saldos_diarios (
    conta_id INTEGER NOT NULL REFERENCES contas(id),
    data DATE NOT NULL,
    fonte VARCHAR(20) NOT NULL,               -- extrato | extrato_parcial | calculado
    saldo_centavos BIGINT NOT NULL,
    importacao_id INTEGER REFERENCES importacoes(id),
    PRIMARY KEY (conta_id, data, fonte)
);

CREATE TABLE IF NOT EXISTS custos_fixos (
    id INTEGER PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    categoria_id INTEGER REFERENCES categorias(id),
    contraparte_doc VARCHAR(20),
    valor_esperado_centavos BIGINT NOT NULL,
    dia_esperado INTEGER,
    periodicidade VARCHAR(20) NOT NULL DEFAULT 'mensal',
    conta_id INTEGER REFERENCES contas(id),
    ativo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY,
    criado_em VARCHAR(40) NOT NULL,
    tipo VARCHAR(30) NOT NULL,                -- importacao | relatorio
    referencia VARCHAR(60),
    conteudo_json TEXT NOT NULL
);
