-- Espelho no Supabase do banco local (financeiro/schema.sql).
-- O SQLite local continua sendo a área de trabalho do importador; após cada importação,
-- `python -m financeiro sincronizar` envia tudo para cá com os MESMOS ids.
-- Valores em centavos (BIGINT). Acesso só pelo servidor (service_role): RLS ligado e sem policies.

CREATE TABLE contas (
    id BIGINT PRIMARY KEY,
    codigo VARCHAR(40) NOT NULL UNIQUE,
    nome VARCHAR(120) NOT NULL,
    banco VARCHAR(40),
    tipo VARCHAR(20) NOT NULL,
    agencia VARCHAR(20),
    numero VARCHAR(30),
    saldo_inicial_centavos BIGINT,
    saldo_inicial_data DATE,
    ativa BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE categorias (
    id BIGINT PRIMARY KEY,
    codigo VARCHAR(40) NOT NULL UNIQUE,
    nome VARCHAR(120) NOT NULL,
    linha_dre VARCHAR(60) NOT NULL,
    origem VARCHAR(20) NOT NULL DEFAULT 'manual',
    ativa BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE regras_classificacao (
    id BIGINT PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    prioridade INTEGER NOT NULL DEFAULT 100,
    padrao_descricao VARCHAR(200),
    contraparte_doc VARCHAR(20),
    valor_min_centavos BIGINT,
    valor_max_centavos BIGINT,
    categoria_id BIGINT NOT NULL REFERENCES categorias(id),
    confianca INTEGER NOT NULL,
    origem VARCHAR(20) NOT NULL DEFAULT 'manual',
    ativa BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE importacoes (
    id BIGINT PRIMARY KEY,
    arquivo VARCHAR(300) NOT NULL,
    arquivo_sha256 CHAR(64) NOT NULL,
    formato VARCHAR(20) NOT NULL,
    conta_id BIGINT NOT NULL REFERENCES contas(id),
    periodo_inicio DATE,
    periodo_fim DATE,
    gerado_em VARCHAR(40),
    importado_em TIMESTAMPTZ NOT NULL,
    linhas_lidas INTEGER NOT NULL,
    novos INTEGER NOT NULL,
    duplicados INTEGER NOT NULL,
    conciliacao_ok BOOLEAN,
    conciliacao_msg TEXT
);

CREATE TABLE lancamentos (
    id BIGINT PRIMARY KEY,
    conta_id BIGINT NOT NULL REFERENCES contas(id),
    data DATE NOT NULL,
    descricao VARCHAR(300) NOT NULL,
    descricao_norm VARCHAR(300) NOT NULL,
    valor_centavos BIGINT NOT NULL,
    contraparte_nome VARCHAR(200),
    contraparte_doc VARCHAR(20),
    contraparte_conta VARCHAR(60),
    tipo VARCHAR(30) NOT NULL DEFAULT 'operacional',
    tipo_motivo VARCHAR(200),
    canal VARCHAR(30),
    estimado BOOLEAN NOT NULL DEFAULT FALSE,
    previsto BOOLEAN NOT NULL DEFAULT FALSE,
    id_externo VARCHAR(80),
    contrapartida_conta_id BIGINT REFERENCES contas(id),
    espelho_de BIGINT REFERENCES lancamentos(id) ON DELETE CASCADE,
    hash CHAR(64) NOT NULL UNIQUE,
    importacao_id BIGINT REFERENCES importacoes(id),
    categoria_id BIGINT REFERENCES categorias(id),
    confianca INTEGER,
    classificacao_motivo VARCHAR(300),
    criado_em TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_lanc_conta_data ON lancamentos (conta_id, data);
CREATE INDEX ix_lanc_doc ON lancamentos (contraparte_doc);

CREATE TABLE saldos_diarios (
    conta_id BIGINT NOT NULL REFERENCES contas(id),
    data DATE NOT NULL,
    fonte VARCHAR(20) NOT NULL,
    saldo_centavos BIGINT NOT NULL,
    importacao_id BIGINT REFERENCES importacoes(id),
    PRIMARY KEY (conta_id, data, fonte)
);

CREATE TABLE custos_fixos (
    id BIGINT PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    categoria_id BIGINT REFERENCES categorias(id),
    contraparte_doc VARCHAR(20),
    valor_esperado_centavos BIGINT NOT NULL,
    dia_esperado INTEGER,
    periodicidade VARCHAR(20) NOT NULL DEFAULT 'mensal',
    conta_id BIGINT REFERENCES contas(id),
    ativo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE snapshots (
    id BIGINT PRIMARY KEY,
    criado_em TIMESTAMPTZ NOT NULL,
    tipo VARCHAR(30) NOT NULL,
    referencia TEXT,
    conteudo_json JSONB NOT NULL
);

-- O que o painel web lê: a versão mais recente do conjunto de dados (agregados + projeção).
CREATE TABLE painel_publicacoes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    dados JSONB NOT NULL
);

-- Sem policies: anon e authenticated não leem nem gravam nada; só a service_role (servidor).
ALTER TABLE contas ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE regras_classificacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE importacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lancamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE saldos_diarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE custos_fixos ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE painel_publicacoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
