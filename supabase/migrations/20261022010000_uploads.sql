-- Upload de extratos pelo painel: o arquivo vai para o bucket privado `extratos`
-- e uma linha em `processamentos`; o GitHub Actions processa (python -m financeiro processar-uploads).

CREATE TABLE processamentos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    arquivo VARCHAR(300) NOT NULL,
    caminho VARCHAR(400) NOT NULL,          -- objeto no bucket `extratos`
    tamanho_bytes BIGINT,
    status VARCHAR(20) NOT NULL DEFAULT 'pendente',  -- pendente | processando | ok | divergencia | erro
    log TEXT,
    resumo JSONB,
    iniciado_em TIMESTAMPTZ,
    concluido_em TIMESTAMPTZ
);
ALTER TABLE processamentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON processamentos FROM anon, authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('extratos', 'extratos', FALSE, 10485760)
ON CONFLICT (id) DO NOTHING;
