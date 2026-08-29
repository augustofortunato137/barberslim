/* =========================================================
   BARBERSLIM — server.js
   Servidor HTTP (API REST) + banco de dados PostgreSQL.

   SEGURANÇA (v2.1):
     - Autenticação real por token JWT (com expiração).
     - Rotas sensíveis protegidas (admin exige sessão de admin).
     - Headers de segurança (helmet) e limite de tentativas (rate limit).
     - Checagem de horário ocupado no servidor (sem duplo agendamento).

   Para rodar:
     1. Crie um PostgreSQL online (Neon/Supabase) e defina DATABASE_URL no .env.
     2. Defina JWT_SECRET (senha secreta para assinar os tokens).
     3. cd backend && npm install && npm start
   ========================================================= */

const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');

const db = require('./database');
const pix = require('./pix');
const mercadopago = require('./mercadopago');

const PORT = process.env.PORT || 3000;
// Segredo para assinar os tokens. Em produção use um valor longo/aleatório.
const JWT_SECRET = process.env.JWT_SECRET || 'troque-este-segredo-em-producao';

// Token de PRODUÇÃO do Mercado Pago. Se ausente, o app volta ao PIX estático.
const MP_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN || '';

// Configuração do PIX estático (dados que aparecem no QR / comprovante).
const PIX_CHAVE  = process.env.PIX_CHAVE  || '14996628499';
const PIX_NOME   = process.env.PIX_NOME   || 'BARBERSLIM';
const PIX_CIDADE = process.env.PIX_CIDADE || 'OURINHOS';

const app = express();

// Atrás de um proxy (Railway/Cloudflare) o Express precisa confiar no cabeçalho
// X-Forwarded-For para ver o IP real do cliente — essencial para o rate limit.
// 'true' confia em todos os hops, usando o primeiro XFF (IP real do cliente).
app.set('trust proxy', true);

// ---------------------------------------------------------------------
// Middlewares de segurança
// ---------------------------------------------------------------------
// CSP configurado: permite o que o site usa (Google Fonts, Font Awesome via
// CDN, fontes/estilos) e, importante, o iframe do Google Maps (frame-src).
// Sem isso, o mapa da seção "Onde Estamos" é bloqueado pelo CSP padrão.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      fontSrc: ["'self'", "https:", "data:"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      // Google Maps (iframe de localização) + Google Search consola (link)
      frameSrc: ["'self'", "https://maps.google.com", "https://www.google.com"],
      imgSrc: ["'self'", "data:", "https:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "https:", "'unsafe-inline'"],
      connectSrc: ["'self'"]
    }
  },
  referrerPolicy: { policy: 'same-origin' }
}));            // headers de segurança (CSP, nosniff, etc.)

// CORS restrito: só permite o próprio app (mesmo domínio) + origens de dev.
// Como o front e a API rodam no MESMO domínio, as chamadas não têm Origin
// (libertado), mas um site malicioso não consegue consumir a API cruzada.
const ORIGENS = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5500,http://127.0.0.1:3000')
  .split(',').map(s => s.trim());
app.use(cors({
  origin(origin, cb) {
    if (!origin || ORIGENS.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use(express.json({ limit: '30kb' }));   // corpo JSON limitado (evita payloads gigantes/DoS)

// Serve o frontend (pasta public/) no mesmo domínio da API -> um link só.
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------
// Helpers de autenticação
// ---------------------------------------------------------------------
/** Gera um token JWT para o usuário (expira em 2h). */
function criarToken(usuario) {
  return jwt.sign({ id: usuario.id, tipo: usuario.tipo }, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRA || '1d' });
}

/** Lê e valida o token do header "Authorization: Bearer <token>". */
function lerToken(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  const t = h.slice(7).trim();
  try { return jwt.verify(t, JWT_SECRET); } catch { return null; }
}

/** Middleware: exige um token válido (qualquer usuário autenticado). */
function requireAuth(req, res, next) {
  const claim = lerToken(req);
  if (!claim) return res.status(401).json({ erro: 'Autenticação necessária.' });
  req.claim = claim;
  next();
}

/** Middleware: exige um token de ADMIN. */
function requireAdmin(req, res, next) {
  const claim = lerToken(req);
  if (!claim) return res.status(401).json({ erro: 'Autenticação necessária.' });
  if (claim.tipo !== 'admin') return res.status(403).json({ erro: 'Acesso restrito ao administrador.' });
  req.claim = claim;
  next();
}

// Envoltório para capturar erros das rotas assíncronas
function asyncRoute(fn) {
  return (req, res) => fn(req, res).catch(err => {
    console.error('[server] Erro na rota:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor.' });
  });
}

// Limita tentativas de login/cadastro (protege contra força bruta)
const limiteAuth = rateLimit({
  windowMs: 15 * 60 * 1000,     // janela de 15 min
  max: 30,                      // até 30 tentativas por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' }
});

// Limite GLOBAL da API (anti-DoS): 300 requisições/min por IP em tudo que é /api.
const limiteApi = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas requisições. Aguarde um instante e tente de novo.' }
});

// Limite de criação de reserva/PIX (evita um bot lotar todos os horários)
const limiteReserva = rateLimit({
  windowMs: 10 * 60 * 1000,   // janela de 10 min
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de agendamento. Aguarde alguns minutos.' }
});

// Limite do webhook (evita abuso/duplicação)
const limiteWebhook = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas notificações.' }
});

// Aplica o limite geral a TODAS as rotas da API.
app.use('/api', limiteApi);

// Validadores simples de formato (bloqueiam payloads malformados na origem)
const RE_DATA     = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORARIO  = /^([01]\d|2[0-3]):[0-5]\d$/;
const RE_BARBEIRO = /^[bB]\d{1,2}$/;
const RE_ID       = /^[\w-]{1,64}$/;

// ---------------------------------------------------------------------------
// ROTAS
// ---------------------------------------------------------------------------

/** GET /api/health — verifica se o servidor está no ar. */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', hora: new Date().toISOString() });
});

/** POST /api/auth/register — cria conta de cliente e retorna token. */
app.post('/api/auth/register', limiteAuth, asyncRoute(async (req, res) => {
  const { nome, email, whatsapp, senha } = req.body || {};
  if (!nome || nome.trim().length < 3) return res.status(400).json({ erro: 'Informe seu nome completo.' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ erro: 'E-mail inválido.' });
  if (!whatsapp || whatsapp.replace(/\D/g, '').length < 10) return res.status(400).json({ erro: 'WhatsApp inválido.' });
  if (!senha || senha.length < 6) return res.status(400).json({ erro: 'A senha deve ter ao menos 6 caracteres.' });

  const usuario = await db.criarUsuario({ nome, email, whatsapp, senha });
  if (!usuario) return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });
  res.status(201).json({ token: criarToken(usuario), usuario });
}));

/** POST /api/auth/login — autentica e devolve token. */
app.post('/api/auth/login', limiteAuth, asyncRoute(async (req, res) => {
  const { email, senha } = req.body || {};
  const usuario = await db.login(email, senha);
  if (!usuario) return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
  res.json({ token: criarToken(usuario), usuario });
}));

/** GET /api/barbeiros — catálogo público. */
app.get('/api/barbeiros', asyncRoute(async (req, res) => {
  res.json(await db.listarBarbeiros());
}));

/** GET /api/servicos — catálogo público. */
app.get('/api/servicos', asyncRoute(async (req, res) => {
  res.json(await db.listarServicos());
}));

/**
 * GET /api/agendamentos/ocupados?data=YYYY-MM-DD&barbeiro_id=<id>
 * Horários já reservados (não cancelados) de um barbeiro numa data.
 * PÚBLICO — retorna apenas os horários ocupados, sem dados pessoais,
 * para o front deixá-los indisponíveis para os demais usuários.
 */
app.get('/api/agendamentos/ocupados', asyncRoute(async (req, res) => {
  const { data, barbeiro_id } = req.query;
  if (!data) return res.status(400).json({ erro: 'Informe a data.' });
  if (!RE_DATA.test(String(data))) return res.status(400).json({ erro: 'Data inválida.' });
  if (barbeiro_id && !RE_BARBEIRO.test(String(barbeiro_id))) {
    return res.status(400).json({ erro: 'Barbeiro inválido.' });
  }
  const ocupados = await db.horariosOcupados(data, barbeiro_id || null);
  res.json({ ocupados });
}));

/**
 * GET /api/agendamentos — EXIGE LOGIN.
 * Admin: todos os agendamentos. Cliente: só os dele (via token, nunca por query).
 */
app.get('/api/agendamentos', requireAuth, asyncRoute(async (req, res) => {
  if (req.claim.tipo === 'admin') {
    return res.json(await db.listarAgendamentos());
  }
  // Cliente: usa o id do TOKEN (ignora qualquer ?usuario= enviado pelo cliente)
  res.json(await db.listarAgendamentos({ usuario_id: req.claim.id }));
}));

/**
 * POST /api/agendamentos — cria um agendamento.
 * - Logado (cliente): associa ao usuário do token (ignora usuario_id do corpo).
 * - Visitante (sem login): exige nome + whatsapp e fica sem vínculo de conta.
 * Bloqueia horário já ocupado (409) e valida no servidor.
 */
app.post('/api/agendamentos', limiteReserva, asyncRoute(async (req, res) => {
  const d = req.body || {};
  const claim = lerToken(req);   // pode ser null (visitante)

  // Normaliza e limita o tamanho dos campos (anti-payload gigante)
  d.cliente_nome = String(d.cliente_nome || '').trim().slice(0, 80);
  d.cliente_whatsapp = String(d.cliente_whatsapp || '').trim().slice(0, 20);
  d.barbeiro_nome = String(d.barbeiro_nome || '').slice(0, 60);

  // Validações comuns (formato estrito no servidor)
  if (d.cliente_nome.length < 2) return res.status(400).json({ erro: 'Nome do cliente é obrigatório.' });
  if (!RE_BARBEIRO.test(String(d.barbeiro_id || ''))) return res.status(400).json({ erro: 'Selecione um barbeiro válido.' });
  if (!Array.isArray(d.servicos) || d.servicos.length === 0 || d.servicos.length > 8) {
    return res.status(400).json({ erro: 'Selecione entre 1 e 8 serviços.' });
  }
  if (!RE_DATA.test(String(d.data || ''))) return res.status(400).json({ erro: 'Data inválida.' });
  if (!RE_HORARIO.test(String(d.horario || ''))) return res.status(400).json({ erro: 'Horário inválido.' });
  if (d.pagamento && !['pix', 'dinheiro'].includes(d.pagamento)) {
    return res.status(400).json({ erro: 'Forma de pagamento inválida.' });
  }
  const total = Math.min(Math.max(Number(d.total) || 0, 0), 100000);

  // Horário ocupado? (server-side)
  if (await db.slotOcupado(d.barbeiro_id, d.data, d.horario)) {
    return res.status(409).json({ erro: 'Este horário já foi reservado. Escolha outro.' });
  }

  // Se logado, o usuário é definido pelo token (nunca pelo corpo).
  const usuarioId = claim ? claim.id : null;
  if (!usuarioId && String(d.cliente_whatsapp).replace(/\D/g, '').length < 10) {
    return res.status(400).json({ erro: 'Informe um WhatsApp válido (visitante).' });
  }

  let criado;
  try {
    criado = await db.criarAgendamento({
      usuario_id: usuarioId,
      cliente_nome: d.cliente_nome,
      cliente_whatsapp: d.cliente_whatsapp || '',
      barbeiro_id: d.barbeiro_id,
      barbeiro_nome: d.barbeiro_nome,
      servicos: d.servicos.map(s => String(s).slice(0, 60)),
      servicos_ids: (d.servicos_ids || []).map(s => String(s).slice(0, 20)),
      total: total,
      data: d.data,
      horario: d.horario,
      pagamento: d.pagamento   // 'pix' ou 'dinheiro'
    });
  } catch (err) {
    // Corrida: dois pedidos simultâneos no mesmo horário -> índice único barra
    if (err && err.code === '23505') {
      return res.status(409).json({ erro: 'Este horário já foi reservado. Escolha outro.' });
    }
    throw err;
  }
  res.status(201).json(criado);
}));

/** DELETE /api/agendamentos/:id — apenas admin. */
app.delete('/api/agendamentos/:id', requireAdmin, asyncRoute(async (req, res) => {
  if (!RE_ID.test(String(req.params.id))) return res.status(400).json({ erro: 'Identificador inválido.' });
  const ok = await db.excluirAgendamento(req.params.id);
  if (!ok) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
  res.json({ ok: true });
}));

/**
 * GET /api/agendamentos/:id/pix — dados de pagamento PIX de um agendamento.
 * PÚBLICO (só contém dados de cobrança, nada pessoal do cliente).
 *
 * - Com Mercado Pago (MERCADOPAGO_ACCESS_TOKEN): cria uma cobrança PIX REAL
 *   (precisa do ?email= do pagador) e devolve o QR + copia e cola do MP.
 * - Sem MP: devolve o PIX estático (QR gerado localmente).
 */
app.get('/api/agendamentos/:id/pix', limiteReserva, asyncRoute(async (req, res) => {
  if (!RE_ID.test(String(req.params.id))) return res.status(400).json({ erro: 'Identificador inválido.' });
  const ag = await db.buscarAgendamento(req.params.id);
  if (!ag) return res.status(404).json({ erro: 'Agendamento não encontrado.' });

  // --- PIX via Mercado Pago (cria a cobrança real) ---
  if (MP_TOKEN) {
    const email = (req.query.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ erro: 'Informe um e-mail válido para o pagamento PIX.', precisaEmail: true });
    }
    try {
      const criado = await mercadopago.criarPagamentoPix({
        token: MP_TOKEN,
        valor: ag.total,
        descricao: 'Agendamento BarberSlim — ' + ag.barbeiro_nome,
        externalRef: ag.id,
        email,
        notificationUrl: notifUrl(req)
      });
      await db.salvarPagamentoMP(ag.id, String(criado.id));
      return res.json({
        gateway: 'mercadopago',
        copiaECola: criado.qr_code,
        qrDataUrl: criado.qr_code_base64 ? 'data:image/png;base64,' + criado.qr_code_base64 : '',
        chave: MP_TOKEN ? 'PIX via Mercado Pago' : PIX_CHAVE,
        valor: ag.total
      });
    } catch (err) {
      if (err.code === 'MP_NEEDS_EMAIL') return res.status(400).json({ erro: err.message, precisaEmail: true });
      console.error('[mp] falha ao criar PIX:', err.message);
      return res.status(502).json({ erro: 'Não foi possível gerar a cobrança PIX. Tente novamente.' });
    }
  }

  // --- PIX estático (sem Mercado Pago configurado) ---
  const copiaECola = pix.montarPixCopiaECola({
    chave: PIX_CHAVE, nome: PIX_NOME, cidade: PIX_CIDADE,
    valor: ag.total, txid: ag.id
  });
  const qrDataUrl = await QRCode.toDataURL(copiaECola, { width: 260, margin: 1 });
  res.json({ chave: PIX_CHAVE, copiaECola, qrDataUrl, valor: ag.total });
}));

/** Monta a URL pública de webhook a partir do Host da requisição.
 *  Permite sobrescrever via NOTIFICATION_BASE_URL (ex.: o domínio público). */
function notifUrl(req) {
  const base = process.env.NOTIFICATION_BASE_URL ||
    ((req.protocol || 'https') + '://' + (req.get('host') || 'barberslim-production.up.railway.app'));
  return base.replace(/\/$/, '') + '/api/webhooks/mercadopago';
}

/**
 * POST /api/webhooks/mercadopago — recebe a notificação do Mercado Pago.
 * Quando o pagamento é APROVADO, o sistema confirma o agendamento sozinho.
 */
app.post('/api/webhooks/mercadopago', limiteWebhook, express.json({ type: '*/*' }), asyncRoute(async (req, res) => {
  // O Mercado Pago exige resposta rápida (2xx). Confirma a entrega e processa em seguida.
  res.status(200).json({ recebido: true });

  const body = req.body || {};
  // Aceita os formatos comuns de notificação do Mercado Pago:
  //   { type: 'payment', data: { id } }  (webhook moderno)
  //   { data: { id } }                   (com ID direto no data)
  const tipo = body.type || body.action || '';
  const paymentId = (body.data && (body.data.id != null ? body.data.id : body.data.payment_id)) || body.id || null;

  // Processa em background (não bloqueia a resposta ao MP).
  setImmediate(async () => {
    try {
      if (!/payment/.test(tipo) || !paymentId) return;
      if (!MP_TOKEN) return;
      const info = await mercadopago.consultarPagamento(MP_TOKEN, paymentId);
      if (info.status === 'approved') {
        const ok = await db.marcarPagoPorPaymentMP(String(paymentId));
        console.log('[webhook] Pagamento aprovado #' + paymentId + (ok ? ' -> agendamento confirmado.' : ' (sem agendamento correspondente)'));
      } else {
        console.log('[webhook] Pagamento #' + paymentId + ' status:', info.status);
      }
    } catch (err) {
      console.error('[webhook] Erro ao processar pagamento:', err.message);
    }
  });
}));

/**
 * GET /api/agendamentos/:id/status — status público de um agendamento
 * (usado para o front saber se o pagamento foi confirmado pelo MP).
 */
app.get('/api/agendamentos/:id/status', asyncRoute(async (req, res) => {
  if (!RE_ID.test(String(req.params.id))) return res.status(400).json({ erro: 'Identificador inválido.' });
  const ag = await db.buscarAgendamento(req.params.id);
  if (!ag) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
  res.json({ status: ag.status, forma_pagamento: ag.forma_pagamento });
}));

/**
 * POST /api/agendamentos/:id/pagar — confirma o pagamento PIX.
 * Marca o agendamento como 'confirmado' (liberado).
 */
app.post('/api/agendamentos/:id/pagar', limiteReserva, asyncRoute(async (req, res) => {
  if (!RE_ID.test(String(req.params.id))) return res.status(400).json({ erro: 'Identificador inválido.' });
  const ok = await db.marcarPago(req.params.id);
  if (!ok) return res.status(404).json({ erro: 'Agendamento não encontrado ou já cancelado.' });
  res.json(await db.buscarAgendamento(req.params.id));
}));

/** GET /api/usuarios — apenas admin. */
app.get('/api/usuarios', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await db.listarUsuarios());
}));

// ---------------------------------------------------------------------
// Tratador global de erros (JSON malformado, corpo gigante, erros internos)
// ---------------------------------------------------------------------
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido.' });
  if (err && err.status === 413) return res.status(413).json({ erro: 'Corpo da requisição muito grande.' });
  console.error('[server] Erro inesperado:', err && err.message);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

// ---------------------------------------------------------------------
// Subida do servidor
// ---------------------------------------------------------------------
db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log('');
      console.log('==========================================');
      console.log('  BarberSlim — API segura (PostgreSQL)');
      console.log(`  Porta:      ${PORT}`);
      console.log(`  Health:     http://localhost:${PORT}/api/health`);
      console.log('==========================================');
      console.log('');
    });
  })
  .catch(err => {
    console.error('[server] Não foi possível iniciar com o banco de dados:');
    console.error(err.message);
    process.exit(1);
  });