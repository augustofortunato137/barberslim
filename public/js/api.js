/* =========================================================
   BARBERSLIM — api.js
   CAMADA DE INTEGRAÇÃO DO FRONTEND COM O BACKEND
   =========================================================
   Este arquivo troca o armazenamento "local" (localStorage) por um
   banco de dados de verdade, chamando a API REST do backend.

   REQUISITOS:
     - Backend rodando em http://localhost:3000 (veja backend/README.md)
     - O arquivo js/api.js deve ser carregado ANTES de js/app.js,
       adicionando no index.html (na tag <head> ou antes de app.js):

           <script src="js/api.js"></script>
           <script src="js/app.js"></script>

   COMO FUNCIONA:
     - Quando API_URL está definido, a app usa o backend.
     - Quando API_URL é null, a app continua usando localStorage
       (modo demonstração sem servidor).
   ========================================================= */

(function () {
  'use strict';

  // ------------------------------------------------------------------
  // CONFIGURAÇÃO — endereço da API (backend publicado).
  //
  // Para uso profissional/online, o backend roda numa plataforma (ex.:
  // Render/Railway) e o front aponta para o endereço dela. Defina aqui:
  //   1. Coloque a URL do backend publicado, OU
  //   2. Sobrescreva antes do load com: window.BARBERSLIM_API_URL = 'https://...';
  //
  // Quando o site é servido pelo MESMO domínio do backend (http/https),
  // deixamos vazio para usar caminho relativo (/api).
  // ------------------------------------------------------------------
  const API_URL = (typeof window !== 'undefined' && window.BARBERSLIM_API_URL)
    ? window.BARBERSLIM_API_URL
    : (typeof location !== 'undefined' && location.protocol !== 'file:')
        ? ''   // mesmo domínio da API (ex.: deploy integrado)
        : 'http://localhost:3000'; // frontend aberto direto do disco (dev)

  // Se API_URL for null (desativado explicitamente), app.js usa localStorage.
  // ATENÇÃO: '' é um valor VÁLIDO (mesmo domínio / API relativa) — por isso
  // verificamos apenas null, não falsy.
  if (API_URL === null) return;

  // ------------------------------------------------------------------
  // Função auxiliar para chamadas HTTP (fetch) ao backend.
  // monta URL, aplica o corpo JSON e devolve o JSON da resposta.
  // Inclui o token de autenticação (se houver sessão logada) no header.
  // ------------------------------------------------------------------
  // Chave onde o app.js guarda a sessão (token incluso).
  const CHAVE_SESSAO = 'bsp_sessao';

  /** Lê o token da sessão logada (armazenada no localStorage). */
  function tokenAtual() {
    try {
      const s = JSON.parse(localStorage.getItem(CHAVE_SESSAO));
      return (s && s.token) ? s.token : null;
    } catch (e) { return null; }
  }

  async function chamar(rota, opcoes = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const t = tokenAtual();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    const resposta = await fetch(API_URL + rota, {
      headers,
      ...opcoes
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      // Transforma o erro do backend em exceção para tratamento no app.js
      const erro = new Error(dados.erro || 'Erro de comunicação com o servidor.');
      if (dados.precisaEmail) erro.precisaEmail = true; // repassa flag do /pix
      throw erro;
    }
    return dados;
  }

  // Sessão do usuário logado (guardada no localStorage, mas enriquecida
  // pelo backend). Mantemos um pequeno cache aqui.
  let sessaoCache = null;

  // ------------------------------------------------------------------
  // API PÚBLICA — mesmas funções que o app.js espera, porém ASSÍNCRONAS.
  // Os nomes terminam em "Async" para deixar claro que são assíncronas.
  // ------------------------------------------------------------------

  const api = {
    /**
     * Autentica um usuário (cliente ou admin) no backend.
     * @param {string} email
     * @param {string} senha
     * @returns {Promise<object>} { token, usuario }
     */
    loginAsync: (email, senha) => chamar('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ email, senha })
    }),

    /**
     * Registra um novo cliente.
     * @param {object} dados { nome, email, whatsapp, senha }
     */
    registrarAsync: (dados) => chamar('/api/auth/register', {
      method: 'POST', body: JSON.stringify(dados)
    }),

    /** Lista todos os agendamentos (admin) ou só os do usuário atual. */
    async listarAgendamentosAsync(usuarioId) {
      const q = usuarioId ? `?usuario=${encodeURIComponent(usuarioId)}` : '';
      return chamar('/api/agendamentos' + q);
    },

    /** Cria um agendamento no banco. */
    criarAgendamentoAsync: (dados) => chamar('/api/agendamentos', {
      method: 'POST', body: JSON.stringify(dados)
    }),

    /** Exclui um agendamento (admin). */
    excluirAgendamentoAsync: (id) => chamar('/api/agendamentos/' + id, { method: 'DELETE' }),

    /** Dados de pagamento PIX de um agendamento (copia e cola + QR).
     *  Com Mercado Pago ativo, precisa do e-mail do pagador para gerar a
     *  cobrança real (query ?email=). */
    obterPixAsync: (id, email) => chamar('/api/agendamentos/' + id + '/pix?email=' + encodeURIComponent(email || '')),

    /** Confirma o pagamento PIX de um agendamento (libera a agenda). */
    confirmarPagamentoAsync: (id) => chamar('/api/agendamentos/' + id + '/pagar', { method: 'POST' }),

    /** Status público de um agendamento (para saber se o pagamento foi
     *  confirmado automaticamente pelo Mercado Pago). */
    obterStatusAsync: (id) => chamar('/api/agendamentos/' + id + '/status'),

    /** Horários já ocupados (não cancelados) de um barbeiro numa data.
     *  Endpoint público — retorna apenas os horários, sem dados pessoais.
     *  @param {string} data formato YYYY-MM-DD
     *  @param {string} [barbeiroId] barbeiro (opcional)
     *  @returns {Promise<{ocupados: string[]}>} */
    horariosOcupadosAsync: (data, barbeiroId) =>
      chamar('/api/agendamentos/ocupados?data=' + encodeURIComponent(data) +
        (barbeiroId ? '&barbeiro_id=' + encodeURIComponent(barbeiroId) : '')),

    /** Lista usuários cadastrados (admin). */
    listarUsuariosAsync: () => chamar('/api/usuarios'),

    /** Lista barbeiros e serviços vindos do banco. */
    listarBarbeirosAsync: () => chamar('/api/barbeiros'),
    listarServicosAsync: () => chamar('/api/servicos'),

    /** Verifica se o backend está acessível. */
    testarAsync: () => chamar('/api/health')
  };

  // ------------------------------------------------------------------
  // EXPORT
  // ------------------------------------------------------------------
  // Ficamos disponível no objeto global `window.API` para o app.js usar.
  window.BarberSlimAPI = api;

  // Log informativo no console do navegador (útil para depuração).
  console.log('[BarberSlim] Modo backend ATIVADO — API em', API_URL);
})();