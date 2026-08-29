/* =========================================================
   BARBERSLIM — database.js
   Camada de acesso ao banco de dados PostgreSQL (na nuvem).

   Este módulo é RESPONSÁVEL por:
     1. Conectar ao PostgreSQL (ex.: Neon/Supabase) via DATABASE_URL.
     2. Criar as tabelas (a partir de schema.sql) caso ainda não
        existam — na primeira execução.
     3. Popular dados iniciais (barbeiros, serviços e admin).
     4. Expor as funções (ASSÍNCRONAS) que o server.js usa.

   Dependências usadas:
     - pg (node-postgres) : driver de conexão com o PostgreSQL.
     - bcryptjs           : hash das senhas (nunca guardamos a senha crua).
     - dotenv             : lê as variáveis do arquivo .env.
   ========================================================= */

const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

// Carrega as variáveis do arquivo .env para process.env.
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ------------------------------------------------------------
// 1) CONEXÃO COM O POSTGRESQL
// ------------------------------------------------------------
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('[database] ERRO: variável DATABASE_URL não foi definida.');
    console.error('[database] Crie um PostgreSQL online (Neon/Supabase) e ponha a connection string no arquivo .env');
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    // Neon/Supabase exigem SSL. Use PGSSL=false apenas em bancos locais.
    ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }
});

pool.on('error', (err) => {
    console.error('[database] Erro inesperado no pool do PostgreSQL:', err.message);
});

// ------------------------------------------------------------
// 2) CRIAÇÃO DAS TABELAS E SEED INICIAL
// ------------------------------------------------------------
async function init() {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
    await seedAdmin();
    console.log('[database] Conectado ao PostgreSQL — tabelas prontas.');
}

// ------------------------------------------------------------
// 3) SEED DO ADMIN (garante que o usuário admin exista)
// ------------------------------------------------------------
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@barberslim.com';
const ADMIN_SENHA = process.env.ADMIN_SENHA || 'TCC2026';

async function seedAdmin() {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE id = $1', ['admin']);
    const hash = await bcrypt.hash(ADMIN_SENHA, 10); // 10 = fator de custo
    if (rows.length === 0) {
        await pool.query(
            `INSERT INTO usuarios (id, nome, email, whatsapp, senha_hash, tipo, criado_em)
             VALUES ($1, $2, $3, $4, $5, 'admin', NOW())`,
            ['admin', 'Administrador', ADMIN_EMAIL, '14996628499', hash]
        );
        console.log('[database] Admin criado:', ADMIN_EMAIL);
    } else if (!(await bcrypt.compare(ADMIN_SENHA, rows[0].senha_hash))) {
        // A senha mudou no .env -> atualiza o hash
        await pool.query('UPDATE usuarios SET senha_hash = $1 WHERE id = $2', [hash, 'admin']);
        console.log('[database] Senha do admin atualizada');
    }
}

// ------------------------------------------------------------
// 4) FUNÇÕES DE ACESSO (repositórios — TODAS ASSÍNCRONAS)
// ------------------------------------------------------------
// Cada função recebe e devolve objetos JS puros, nunca resultados
// crus do driver. Isola a lógica de negócio do SQL.

/* ---------- USUÁRIOS ---------- */

/**
 * Cria um novo usuário cliente.
 * @param {object} dados { nome, email, whatsapp, senha }
 * @returns {Promise<object|null>} usuário (sem senha) ou null se o e-mail já existe.
 */
async function criarUsuario({ nome, email, whatsapp, senha }) {
    const existente = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existente.rows.length > 0) return null;

    const id = 'usr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const hash = await bcrypt.hash(senha, 10);
    try {
      await pool.query(
          `INSERT INTO usuarios (id, nome, email, whatsapp, senha_hash, tipo, criado_em)
           VALUES ($1, $2, $3, $4, $5, 'cliente', NOW())`,
          [id, nome, email.toLowerCase(), whatsapp, hash]
      );
    } catch (err) {
      // Corrida: dois cadastros com o mesmo e-mail ao mesmo tempo -> UNIQUE barra
      if (err && err.code === '23505') return null;
      throw err;
    }
    return buscarUsuario(id);
}

/**
 * Busca um usuário pelo e-mail e confere a senha.
 * @returns {Promise<object|null>} usuário (sem senha) se as credenciais forem válidas.
 */
async function login(email, senha) {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE email = $1', [String(email).toLowerCase()]);
    if (rows.length === 0) return null;
    const user = rows[0];
    if (!(await bcrypt.compare(senha, user.senha_hash))) return null;
    return sanitizarUsuario(user);
}

/** Busca um usuário pelo id. */
async function buscarUsuario(id) {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
    return rows.length ? sanitizarUsuario(rows[0]) : null;
}

/** Remove a senha_hash antes de devolver o usuário para a API. */
function sanitizarUsuario(user) {
    const { senha_hash, ...semSenha } = user;
    return semSenha;
}

/** Lista todos os usuários (sem senha). Usado pelo admin. */
async function listarUsuarios() {
    const { rows } = await pool.query(
        'SELECT id, nome, email, whatsapp, tipo, criado_em FROM usuarios ORDER BY criado_em DESC'
    );
    return rows;
}

/* ---------- AGENDAMENTOS ---------- */

/**
 * Cria um novo agendamento.
 * @param {object} dados — todos os campos do agendamento.
 * @returns {Promise<object>} o agendamento recém-criado.
 */
async function criarAgendamento(dados) {
    const id = 'ag_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    // PIX: fica AGUARDANDO o pagamento (só confirma quando o cliente confirma).
    // Dinheiro: confirma de imediato (paga na hora do atendimento).
    const status = dados.pagamento === 'pix' ? 'aguardando_pagamento' : 'confirmado';
    await pool.query(
        `INSERT INTO agendamentos
         (id, usuario_id, cliente_nome, cliente_whatsapp, barbeiro_id, barbeiro_nome,
          servicos, servicos_ids, total, data, horario, status, forma_pagamento, criado_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW())`,
        [
            id,
            dados.usuario_id || null,
            dados.cliente_nome,
            dados.cliente_whatsapp,
            dados.barbeiro_id,
            dados.barbeiro_nome,
            JSON.stringify(dados.servicos),      // array de nomes -> JSON
            JSON.stringify(dados.servicos_ids),  // array de ids -> JSON
            dados.total,
            dados.data,
            dados.horario,
            status,
            (dados.pagamento === 'dinheiro') ? 'dinheiro' : 'pix'  // forma de pagamento
        ]
    );
    return buscarAgendamento(id);
}

/** Confirma o pagamento de um agendamento (marca como pago/confirmado).
 *  Usado no fluxo PIX após o cliente declarar que pagou. */
async function marcarPago(id) {
    const result = await pool.query(
        `UPDATE agendamentos SET status = 'confirmado' WHERE id = $1 AND status != 'cancelado'`,
        [id]
    );
    return result.rowCount > 0;
}

/** Salva o id do pagamento do Mercado Pago vinculado ao agendamento. */
async function salvarPagamentoMP(id, paymentMpId) {
    await pool.query(
        `UPDATE agendamentos SET payment_mp_id = $1 WHERE id = $2`,
        [paymentMpId, id]
    );
}

/** Confirma o agendamento cujo payment_mp_id (Mercado Pago) foi aprovado.
 *  Usado pelo webhook do Mercado Pago. */
async function marcarPagoPorPaymentMP(paymentMpId) {
    const result = await pool.query(
        `UPDATE agendamentos SET status = 'confirmado'
         WHERE payment_mp_id = $1 AND status != 'cancelado'`,
        [paymentMpId]
    );
    return result.rowCount > 0;
}

/** Busca um agendamento pelo id. */
async function buscarAgendamento(id) {
    const { rows } = await pool.query('SELECT * FROM agendamentos WHERE id = $1', [id]);
    return rows.length ? decodificarAgendamento(rows[0]) : null;
}

/**
 * Lista os agendamentos, com filtros opcionais.
 * @param {object} filtro { barbeiro_id, data, usuario_id }
 */
async function listarAgendamentos(filtro = {}) {
    let sql = 'SELECT * FROM agendamentos WHERE 1=1';
    const params = [];
    if (filtro.barbeiro_id) { params.push(filtro.barbeiro_id); sql += ` AND barbeiro_id = $${params.length}`; }
    if (filtro.data)        { params.push(filtro.data);        sql += ` AND data = $${params.length}`; }
    if (filtro.usuario_id)  { params.push(filtro.usuario_id);  sql += ` AND usuario_id = $${params.length}`; }
    sql += ' ORDER BY data DESC, horario DESC';
    const { rows } = await pool.query(sql, params);
    return rows.map(decodificarAgendamento);
}

/** Deleta um agendamento (usado pelo admin). Retorna true se removeu algo. */
async function excluirAgendamento(id) {
    const result = await pool.query('DELETE FROM agendamentos WHERE id = $1', [id]);
    return result.rowCount > 0;
}

/**
 * Verifica se um horário já está ocupado para um barbeiro numa data
 * (agendamentos não cancelados). Evita duplo agendamento no servidor.
 */
async function slotOcupado(barbeiro_id, data, horario) {
    const { rows } = await pool.query(
        `SELECT 1 FROM agendamentos
         WHERE barbeiro_id = $1 AND data = $2 AND horario = $3 AND status != 'cancelado'
         LIMIT 1`,
        [barbeiro_id, data, horario]
    );
    return rows.length > 0;
}

/** Devolve a lista de horários JÁ OCUPADOS (não cancelados) de um barbeiro numa data.
 *  Usado pelo front para deixar esses horários indisponíveis para os demais usuários.
 *  Retorna apenas os horários (sem dados pessoais) — seguro para acesso público. */
async function horariosOcupados(data, barbeiro_id) {
    const params = [data];
    let sql = `SELECT horario FROM agendamentos
               WHERE data = $1 AND status != 'cancelado'`;
    if (barbeiro_id) {
        params.push(barbeiro_id);
        sql += ` AND barbeiro_id = $${params.length}`;
    }
    const { rows } = await pool.query(sql, params);
    return rows.map(r => r.horario);
}

/** Converte a linha (servicos em JSON) para um objeto JS com arrays de verdade. */
function decodificarAgendamento(row) {
    return {
        ...row,
        servicos: JSON.parse(row.servicos),
        servicos_ids: JSON.parse(row.servicos_ids)
    };
}

/* ---------- BARBEIROS / SERVIÇOS (configuração) ---------- */
async function listarBarbeiros() {
    const { rows } = await pool.query('SELECT * FROM barbeiros ORDER BY id');
    return rows;
}
async function listarServicos() {
    const { rows } = await pool.query('SELECT * FROM servicos ORDER BY id');
    return rows;
}

// ------------------------------------------------------------
// EXPORTAÇÃO
// ------------------------------------------------------------
module.exports = {
    init,
    pool,
    login,
    criarUsuario,
    buscarUsuario,
    listarUsuarios,
    criarAgendamento,
    buscarAgendamento,
    listarAgendamentos,
    excluirAgendamento,
    marcarPago,
    salvarPagamentoMP,
    marcarPagoPorPaymentMP,
    slotOcupado,
    horariosOcupados,
    listarBarbeiros,
    listarServicos
};