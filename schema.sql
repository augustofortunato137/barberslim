-- ============================================================
-- BARBERSLIM — ESQUEMA DO BANCO DE DADOS (PostgreSQL)
-- ============================================================
-- Este arquivo define TODAS as tabelas do banco. Ele é executado
-- automaticamente pelo database.js quando o servidor inicia.
-- Execute em um PostgreSQL online (Neon/Supabase) — ou deixe que
-- o backend rode este script na primeira inicialização.
-- ============================================================

-- ------------------------------------------------------------
-- TABELA: usuarios
-- Guarda os clientes que criam conta no site (cadastro).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
    id          TEXT PRIMARY KEY,                 -- id único (ex.: usr_xxx)
    nome        TEXT NOT NULL,                  -- nome completo do cliente
    email       TEXT NOT NULL UNIQUE,          -- e-mail (não pode repetir)
    whatsapp    TEXT NOT NULL,                 -- WhatsApp com DDD
    senha_hash  TEXT NOT NULL,                 -- senha criptografada (bcrypt)
    tipo        TEXT NOT NULL DEFAULT 'cliente', -- 'cliente' ou 'admin'
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW() -- data de criação
);

-- ------------------------------------------------------------
-- Tabela: barbeiros
-- Dados fixos dos barbeiros.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS barbeiros (
    id           TEXT PRIMARY KEY,             -- ex.: b1, b2, b3...
    nome         TEXT NOT NULL,
    especialidade TEXT NOT NULL,
    icone        TEXT NOT NULL
);

-- ------------------------------------------------------------
-- Tabela: servicos
-- Serviços oferecidos pela barbearia com preço e duração.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS servicos (
    id      TEXT PRIMARY KEY,                  -- ex.: s1, s2, s3...
    nome    TEXT NOT NULL,
    preco   REAL NOT NULL,                     -- preço em reais (R$)
    duracao INTEGER NOT NULL                   -- duração em minutos
);

-- ------------------------------------------------------------
-- Tabela: agendamentos
-- Registro de cada horário marcado por um cliente.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agendamentos (
    id              TEXT PRIMARY KEY,          -- id único (ex.: ag_xxx)
    usuario_id      TEXT,                      -- FK do usuário (NULL p/ visitante)
    cliente_nome    TEXT NOT NULL,             -- nome exibido no agendamento
    cliente_whatsapp TEXT NOT NULL,            -- WhatsApp p/ contato
    barbeiro_id     TEXT NOT NULL,             -- FK do barbeiro
    barbeiro_nome   TEXT NOT NULL,             -- nome do barbeiro (denormalizado)
    servicos        TEXT NOT NULL,             -- nomes dos serviços (JSON array)
    servicos_ids    TEXT NOT NULL,             -- ids dos serviços (JSON array)
    total           REAL NOT NULL,             -- valor total dos serviços
    data            TEXT NOT NULL,             -- data 'YYYY-MM-DD'
    horario         TEXT NOT NULL,             -- horário 'HH:MM'
    status          TEXT NOT NULL DEFAULT 'confirmado', -- 'confirmado'|'cancelado'
    forma_pagamento TEXT NOT NULL DEFAULT 'pix',        -- 'pix' ou 'dinheiro'
    payment_mp_id   TEXT,                              -- id do pagamento no Mercado Pago (qnd integrado)
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    FOREIGN KEY (barbeiro_id) REFERENCES barbeiros(id)
);

-- Garante colunas novas em bancos já criados.
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS forma_pagamento TEXT NOT NULL DEFAULT 'pix';
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS payment_mp_id TEXT;

-- ------------------------------------------------------------
-- SEED (dados iniciais) — barbeiros e serviços padrão
-- (ON CONFLICT DO NOTHING evita duplicar se o script rodar de novo)
-- ------------------------------------------------------------
INSERT INTO barbeiros (id, nome, especialidade, icone) VALUES
    ('b1', 'Augusto',      'Cortes clássicos & navalha', 'fa-user-tie'),
    ('b2', 'Fernanda',     'Degradê & barba desenhada',  'fa-user'),
    ('b3', 'João Henrique','Estilos modernos',         'fa-user-graduate'),
    ('b4', 'Gabriel',      'Cortes e finalizações',    'fa-user')
ON CONFLICT (id) DO NOTHING;

INSERT INTO servicos (id, nome, preco, duracao) VALUES
    ('s1', 'Corte Social',      40.00, 30),
    ('s2', 'Corte + Barba',     65.00, 50),
    ('s3', 'Barba Desenhada',   35.00, 25),
    ('s4', 'Degradê Navalhado', 55.00, 40),
    ('s5', 'Sobrancelha',       15.00, 10)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- ÍNDICE ÚNICO: impede dois agendamentos ativos no mesmo
-- barbeiro + data + horário. (Proteção contra duplo agendamento
-- mesmo se a checagem na API falhar.)
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_agendamento_slot
    ON agendamentos (barbeiro_id, data, horario)
    WHERE status != 'cancelado';

-- ------------------------------------------------------------
-- USUÁRIO ADMIN PADRÃO
-- O admin NÃO é criado por este script. A senha dele é gerada
-- dinamicamente pelo backend (database.js) com bcrypt, a partir da
-- variável de ambiente ADMIN_SENHA.
-- ------------------------------------------------------------