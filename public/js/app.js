/* =========================================================
   BARBERSLIM — APP.JS
   Sistema de agendamento com autenticação simulada (localStorage)
   ========================================================= */

(function () {
  'use strict';

  /* ---------------------------------------------------------
     1) DADOS BASE (barbeiros, serviços) e CHAVES DE STORAGE
     --------------------------------------------------------- */
  const CHAVES = {
    USUARIOS: 'bsp_usuarios',
    SESSAO: 'bsp_sessao',
    AGENDAMENTOS: 'bsp_agendamentos',
    A11Y: 'bsp_acessibilidade',
    ADMIN_SALVO: 'bsp_admin_salvo'  // acesso admin mantido (voltar sem senha)
  };

  /** Guarda a sessão do admin em uma chave separada para permitir
   *  "voltar ao painel" sem digitar senha novamente (botão Manter conectado). */
  function salvarAdminSalvo() {
    const s = getSessao();
    if (s && s.tipo === 'admin') localStorage.setItem(CHAVES.ADMIN_SALVO, JSON.stringify(s));
  }
  function getAdminSalvo() { return lerStorage(CHAVES.ADMIN_SALVO, null); }
  function limparAdminSalvo() { localStorage.removeItem(CHAVES.ADMIN_SALVO); }

  const ADMIN = { email: 'admin@barberslim.com', senha: 'TCC2026' };

  const BARBEIROS = [
    { id: 'b1', nome: 'Augusto', especialidade: 'Cortes clássicos & navalha', icone: 'fa-user-tie' },
    { id: 'b2', nome: 'Fernanda', especialidade: 'Degradê & barba desenhada', icone: 'fa-user' },
    { id: 'b3', nome: 'João Henrique', especialidade: 'Estilos modernos', icone: 'fa-user-graduate' },
    { id: 'b4', nome: 'Gabriel', especialidade: 'Cortes e finalizações', icone: 'fa-user' }
  ];

  const SERVICOS = [
    { id: 's1', nome: 'Corte Social', preco: 40, duracao: 30 },
    { id: 's2', nome: 'Corte + Barba', preco: 65, duracao: 50 },
    { id: 's3', nome: 'Barba Desenhada', preco: 35, duracao: 25 },
    { id: 's4', nome: 'Degradê Navalhado', preco: 55, duracao: 40 },
    { id: 's5', nome: 'Sobrancelha', preco: 15, duracao: 10 }
  ];

  const HORA_INICIO = 9;   // 09h
  const HORA_FIM = 20;     // 20h
  const INTERVALO_MIN = 40; // minutos entre horários

  /* ---------------------------------------------------------
     2) UTILITÁRIOS DE STORAGE (camada de dados)
     ---------------------------------------------------------
     Estes helpers isolam o acesso aos dados. Hoje eles usam
     localStorage (modo demonstração). Para conectar ao banco de
     dados, veja js/api.js — ele expõe funções equivalentes
     (loginAsync, criarAgendamentoAsync etc.) que chamam a API.
     --------------------------------------------------------- */

  /** Lê um valor JSON do localStorage. Se não existir ou estiver
   *  corrompido, devolve o valor padrão (padrao). */
  function lerStorage(chave, padrao) {
    try {
      const bruto = localStorage.getItem(chave);
      return bruto ? JSON.parse(bruto) : padrao;
    } catch (e) {
      // JSON inválido (ex.: dado antigo corrompido) -> usa o padrão
      return padrao;
    }
  }
  /** Grava um valor (qualquer objeto JS) como JSON no localStorage. */
  function salvarStorage(chave, valor) {
    localStorage.setItem(chave, JSON.stringify(valor));
  }

  /* Funções dedicadas a cada coleção (usuários, sessão, agendamentos).
     Centralizar aqui facilita trocar a fonte de dados depois. */
  // ------------------------------------------------------------
  // 2-B) CAMADA DE DADOS (backend + cache em memória)
  // ------------------------------------------------------------
  // Se js/api.js estiver carregado (window.BarberSlimAPI existe), os
  // dados passam a vir do banco via API. Mantemos um cache em memória
  // para as funções síncronas já existentes continuarem funcionando;
  // as escritas/leituras reais são assíncronas (API).
  // ------------------------------------------------------------
  const backendAtivo = typeof window.BarberSlimAPI !== 'undefined';

  // Cache em memória (inicializado com localStorage do modo demo)
  let cacheUsuarios = lerStorage(CHAVES.USUARIOS, []);
  let cacheAgendamentos = lerStorage(CHAVES.AGENDAMENTOS, []);
  let cacheBarbeiros = BARBEIROS;
  let cacheServicos = SERVICOS;

  function getUsuarios() { return cacheUsuarios; }
  function setUsuarios(lista) { cacheUsuarios = lista; salvarStorage(CHAVES.USUARIOS, lista); }
  function getSessao() { return lerStorage(CHAVES.SESSAO, null); }
  function setSessao(sessao) { salvarStorage(CHAVES.SESSAO, sessao); }
  function limparSessao() { localStorage.removeItem(CHAVES.SESSAO); }
  function getAgendamentos() { return cacheAgendamentos; }
  function setAgendamentos(lista) { cacheAgendamentos = lista; salvarStorage(CHAVES.AGENDAMENTOS, lista); }

  /** Converte um agendamento vindo da API (snake_case) para o shape
   *  interno (camelCase) que o restante do app.js espera. */
  function normalizarAgendamento(a) {
    return {
      id: a.id,
      userId: a.usuario_id || null,
      clienteNome: a.cliente_nome,
      clienteWhatsapp: a.cliente_whatsapp,
      barbeiroId: a.barbeiro_id,
      barbeiroNome: a.barbeiro_nome,
      servicos: a.servicos,
      servicosIds: a.servicos_ids,
      total: a.total,
      data: a.data,
      horario: a.horario,
      pagamento: a.forma_pagamento || a.pagamento || null,
      status: a.status,
      criadoEm: a.criado_em
    };
  }

  /** Carrega barbeiros e serviços do backend para o cache. */
  async function carregarCatalogo() {
    if (!backendAtivo) return;
    try {
      const [barbeiros, servicos] = await Promise.all([
        window.BarberSlimAPI.listarBarbeirosAsync(),
        window.BarberSlimAPI.listarServicosAsync()
      ]);
      if (Array.isArray(barbeiros) && barbeiros.length) cacheBarbeiros = barbeiros;
      if (Array.isArray(servicos) && servicos.length) cacheServicos = servicos;
    } catch (e) {
      console.warn('[BarberSlim] Falha ao carregar catálogo do backend:', e.message);
    }
  }

  /** Recarrega os agendamentos do backend para o cache. */
  async function refrescarAgendamentos() {
    if (!backendAtivo) return;
    try {
      const lista = await window.BarberSlimAPI.listarAgendamentosAsync();
      cacheAgendamentos = (Array.isArray(lista) ? lista : []).map(normalizarAgendamento);
    } catch (e) {
      console.warn('[BarberSlim] Falha ao carregar agendamentos do backend:', e.message);
    }
  }

  /** Gera um id único no formato "prefixo_xxxxx" combinando a data
   *  atual em base 36 com um trecho aleatório (evita colisões). */
  function gerarId(prefixo) {
    return prefixo + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* Data em YYYY-MM-DD no fuso local do usuário (corrige o bug de dia
     quando se usa toISOString, que trabalha em UTC). */
  function dataLocal(dt) {
    const ano = dt.getFullYear();
    const mes = String(dt.getMonth() + 1).padStart(2, '0');
    const dia = String(dt.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }

  /* Escapa caracteres HTML para impedir injeção de scripts (XSS) quando
     inserimos dados vindos do banco/usuario dentro de templates HTML. */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /* ---------------------------------------------------------
     3) BARRA DE CARREGAMENTO (microinteração)
     --------------------------------------------------------- */
  const barraCarregamento = document.getElementById('loading-bar');
  function dispararLoadingBar() {
    barraCarregamento.classList.remove('completa');
    barraCarregamento.classList.add('ativa');
    setTimeout(() => {
      barraCarregamento.classList.add('completa');
      setTimeout(() => {
        barraCarregamento.classList.remove('ativa', 'completa');
      }, 400);
    }, 220);
  }

  /* ---------------------------------------------------------
     4) EFEITO RIPPLE NOS BOTÕES
     ---------------------------------------------------------
     Anima todos os botões da página com um efeito "onda" ao clicar.
     Usamos delegação de eventos (um único listener no document) em vez
     de um listener por botão — mais performático e funciona para
     botões criados dinamicamente depois. */
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.btn');   // botão (ou pai) clicado
    if (!btn) return;                       // clique fora de um botão
    const rect = btn.getBoundingClientRect(); // posição/tamanho do botão
    const ripple = document.createElement('span');
    const tamanho = Math.max(rect.width, rect.height); // diâmetro da onda
    ripple.className = 'ripple';                       // estilo da onda
    ripple.style.width = ripple.style.height = tamanho + 'px';
    // Centraliza a onda no ponto do clique (coordenadas do mouse - topo do botão)
    ripple.style.left = (e.clientX - rect.left - tamanho / 2) + 'px';
    ripple.style.top = (e.clientY - rect.top - tamanho / 2) + 'px';
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 650); // remove a onda após a animação
  });

  /* ---------------------------------------------------------
     5) NAVEGAÇÃO ENTRE VIEWS (SPA sem recarregar)
     ---------------------------------------------------------
     A aplicação é uma SPA: trocar de "tela" apenas mostra/oculta as
     <section class="view">, sem recarregar a página. A função irPara
     é o coração dessa navegação. */
  const views = document.querySelectorAll('.view');
  const navPrincipal = document.getElementById('nav-principal');
  const btnHamburguer = document.getElementById('btn-hamburguer');

  /** Exibe a tela cujo data-view = nomeView e oculta as demais. */
  function irPara(nomeView) {
    dispararLoadingBar();
    views.forEach(v => {
      // Só a view que tem data-view == nomeView fica visível
      v.hidden = v.dataset.view !== nomeView;
    });
    // Ao trocar de tela, garante que o modal de estatísticas e o painel de
    // acessibilidade sejam fechados (evita tela "presa").
    if (modalStats) { fecharModalStats(); }
    fecharPainelA11y();
    // Rola ao topo (suave, a menos que o usuário tenha reduzido movimento)
    window.scrollTo({ top: 0, behavior: document.documentElement.classList.contains('a11y-reduzir-movimento') ? 'auto' : 'smooth' });
    navPrincipal.classList.remove('aberto');
    btnHamburguer.setAttribute('aria-expanded', 'false');

    // Algumas telas precisam ser "montadas" (preenchidas) a cada visita
    if (nomeView === 'agendamento') montarAgendamento();
    if (nomeView === 'historico') montarHistorico();
    if (nomeView === 'admin') montarAdmin();
    if (nomeView === 'admin-login') atualizarAcessoAdminSalvo();

    // Acessibilidade: move o foco para o título da nova tela
    const primeiroFoco = document.querySelector(`.view[data-view="${nomeView}"] h1, .view[data-view="${nomeView}"] h2`);
    if (primeiroFoco) { primeiroFoco.setAttribute('tabindex', '-1'); primeiroFoco.focus({ preventScroll: true }); }
  }

  document.addEventListener('click', function (e) {
    const alvo = e.target.closest('[data-nav]');
    if (!alvo) return;
    e.preventDefault();
    irPara(alvo.dataset.nav);
  });

  document.querySelectorAll('[data-scroll]').forEach(link => {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      irPara('home');
      setTimeout(() => {
        const destino = document.getElementById(link.dataset.scroll);
        if (destino) destino.scrollIntoView({ behavior: 'smooth' });
      }, 60);
    });
  });

  btnHamburguer.addEventListener('click', function () {
    const aberto = navPrincipal.classList.toggle('aberto');
    btnHamburguer.setAttribute('aria-expanded', String(aberto));
  });

  document.getElementById('ano-atual').textContent = new Date().getFullYear();

  /* ---------------------------------------------------------
     6) HERO SLIDER (3 frases rotativas)
     --------------------------------------------------------- */
  const slides = document.querySelectorAll('.hero__slide');
  const pontos = document.querySelectorAll('.hero__ponto');
  let slideAtual = 0, intervaloSlider = null;

  function mostrarSlide(indice) {
    slides.forEach((s, i) => s.classList.toggle('is-ativo', i === indice));
    pontos.forEach((p, i) => {
      p.classList.toggle('is-ativo', i === indice);
      p.setAttribute('aria-selected', String(i === indice));
    });
    slideAtual = indice;
  }
  function proximoSlide() { mostrarSlide((slideAtual + 1) % slides.length); }
  function iniciarSlider() {
    pararSlider();
    if (!document.documentElement.classList.contains('a11y-reduzir-movimento')) {
      intervaloSlider = setInterval(proximoSlide, 5500);
    }
  }
  function pararSlider() { if (intervaloSlider) clearInterval(intervaloSlider); }
  pontos.forEach((p, i) => p.addEventListener('click', () => { mostrarSlide(i); iniciarSlider(); }));
  iniciarSlider();

  /* ---------------------------------------------------------
     7) PAINEL DE ACESSIBILIDADE
     --------------------------------------------------------- */
  const btnAcessibilidade = document.getElementById('btn-acessibilidade');
  const painelAcessibilidade = document.getElementById('painel-acessibilidade');
  const fecharAcessibilidade = document.getElementById('fechar-acessibilidade');
  const overlay = document.getElementById('overlay');

  const togglesA11y = {
    'a11y-contraste': document.getElementById('toggle-contraste'),
    'a11y-texto-grande': document.getElementById('toggle-texto-grande'),
    'a11y-reduzir-movimento': document.getElementById('toggle-reduzir-movimento'),
    'a11y-daltonico': document.getElementById('toggle-daltonico'),
    'a11y-leitor-tela': document.getElementById('toggle-leitor-tela')
  };

  function abrirPainelA11y() {
    painelAcessibilidade.hidden = false;
    overlay.hidden = false;
    btnAcessibilidade.setAttribute('aria-expanded', 'true');
  }
  function fecharPainelA11y() {
    painelAcessibilidade.hidden = true;
    overlay.hidden = true;
    btnAcessibilidade.setAttribute('aria-expanded', 'false');
  }
  btnAcessibilidade.addEventListener('click', abrirPainelA11y);
  fecharAcessibilidade.addEventListener('click', fecharPainelA11y);
  overlay.addEventListener('click', fecharPainelA11y);

  function aplicarPreferenciasA11y() {
    const prefs = lerStorage(CHAVES.A11Y, {});
    Object.keys(togglesA11y).forEach(classe => {
      const ativo = !!prefs[classe];
      document.documentElement.classList.toggle(classe, ativo);
      togglesA11y[classe].checked = ativo;
    });
    iniciarSlider();
  }

  Object.keys(togglesA11y).forEach(classe => {
    togglesA11y[classe].addEventListener('change', function () {
      const prefs = lerStorage(CHAVES.A11Y, {});
      prefs[classe] = this.checked;
      salvarStorage(CHAVES.A11Y, prefs);
      document.documentElement.classList.toggle(classe, this.checked);
      iniciarSlider();
    });
  });

  document.getElementById('btn-resetar-acessibilidade').addEventListener('click', function () {
    salvarStorage(CHAVES.A11Y, {});
    aplicarPreferenciasA11y();
  });

  aplicarPreferenciasA11y();

  /* ---------------------------------------------------------
     7-B) SCROLL-REVEAL DAS SEÇÕES + CONTADOR DA PROVA SOCIAL
     --------------------------------------------------------- */
  const reduzMovimento = () => document.documentElement.classList.contains('a11y-reduzir-movimento');

  function animarContador(span) {
    const alvo = parseFloat(span.dataset.contar);
    const sufixo = span.dataset.sufixo || '';
    const casasDecimais = span.dataset.decimal ? parseInt(span.dataset.decimal, 10) : 0;
    if (reduzMovimento()) { span.textContent = alvo.toFixed(casasDecimais) + sufixo; return; }
    const duracao = 1200;
    const inicio = performance.now();
    function passo(agora) {
      const progresso = Math.min((agora - inicio) / duracao, 1);
      const valorAtual = alvo * progresso;
      span.textContent = valorAtual.toFixed(casasDecimais) + sufixo;
      if (progresso < 1) requestAnimationFrame(passo);
    }
    requestAnimationFrame(passo);
  }

  const observador = new IntersectionObserver((entradas) => {
    entradas.forEach(entrada => {
      if (!entrada.isIntersecting) return;
      entrada.target.classList.add('em-vista');
      entrada.target.querySelectorAll('[data-contar]').forEach(animarContador);
      observador.unobserve(entrada.target);
    });
  }, { threshold: 0.2 });

  document.querySelectorAll('.reveal-secao').forEach(secao => observador.observe(secao));

  /* ---------------------------------------------------------
     7-C) ACORDEÃO DE FAQ
     --------------------------------------------------------- */
  document.querySelectorAll('.acordeao__pergunta').forEach(botao => {
    botao.addEventListener('click', function () {
      const item = this.closest('.acordeao__item');
      const resposta = item.querySelector('.acordeao__resposta');
      const abrindo = this.getAttribute('aria-expanded') !== 'true';
      this.setAttribute('aria-expanded', String(abrindo));
      resposta.hidden = !abrindo;
    });
  });

  /* ---------------------------------------------------------
     8) VALIDAÇÕES
     --------------------------------------------------------- */
  function emailValido(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
  function whatsappValido(numero) {
    const digitos = numero.replace(/\D/g, '');
    return digitos.length >= 10 && digitos.length <= 13;
  }
  function forcaSenha(senha) {
    let pontos = 0;
    if (senha.length >= 6) pontos++;
    if (senha.length >= 10) pontos++;
    if (/[A-Z]/.test(senha)) pontos++;
    if (/[0-9]/.test(senha)) pontos++;
    if (/[^A-Za-z0-9]/.test(senha)) pontos++;
    if (pontos <= 1) return { nivel: 'fraca', pct: 25, cor: '#b3563a' };
    if (pontos <= 2) return { nivel: 'razoável', pct: 50, cor: '#ffaa00' };
    if (pontos <= 3) return { nivel: 'boa', pct: 75, cor: '#ffd900' };
    return { nivel: 'forte', pct: 100, cor: '#7ee787' };
  }
  function mostrarErro(idCampo, mensagem) {
    const el = document.getElementById(idCampo);
    if (el) el.textContent = mensagem || '';
  }
  function definirStatus(idEl, texto, tipo) {
    const el = document.getElementById(idEl);
    el.textContent = texto;
    el.className = 'mensagem-status' + (tipo ? ' ' + tipo : '');
  }

  /* Alternar exibição de senha */
  document.querySelectorAll('[data-toggle-senha]').forEach(botao => {
    botao.addEventListener('click', function () {
      const input = document.getElementById(this.dataset.toggleSenha);
      const oculto = input.type === 'password';
      input.type = oculto ? 'text' : 'password';
      this.innerHTML = oculto ? '<i class="fas fa-eye-slash" aria-hidden="true"></i>' : '<i class="fas fa-eye" aria-hidden="true"></i>';
      this.setAttribute('aria-label', oculto ? 'Ocultar senha' : 'Mostrar senha');
    });
  });

  /* ---------------------------------------------------------
     9) CADASTRO
     --------------------------------------------------------- */
  const inputCadSenha = document.getElementById('cad-senha');
  const barraForca = document.getElementById('barra-forca');
  const textoForca = document.getElementById('texto-forca');
  inputCadSenha.addEventListener('input', function () {
    if (!this.value) { barraForca.style.width = '0%'; textoForca.textContent = 'Força da senha: —'; return; }
    const f = forcaSenha(this.value);
    barraForca.style.width = f.pct + '%';
    barraForca.style.background = f.cor;
    textoForca.textContent = 'Força da senha: ' + f.nivel;
  });

  document.getElementById('form-cadastro').addEventListener('submit', async function (e) {
    e.preventDefault();
    const nome = document.getElementById('cad-nome').value.trim();
    const email = document.getElementById('cad-email').value.trim().toLowerCase();
    const whatsapp = document.getElementById('cad-whatsapp').value.trim();
    const senha = document.getElementById('cad-senha').value;

    ['erro-cad-nome', 'erro-cad-email', 'erro-cad-whatsapp', 'erro-cad-senha'].forEach(id => mostrarErro(id, ''));
    let valido = true;

    if (nome.length < 3) { mostrarErro('erro-cad-nome', 'Informe seu nome completo.'); valido = false; }
    if (!emailValido(email)) { mostrarErro('erro-cad-email', 'E-mail inválido.'); valido = false; }
    if (!whatsappValido(whatsapp)) { mostrarErro('erro-cad-whatsapp', 'Informe um WhatsApp válido com DDD.'); valido = false; }
    if (senha.length < 6) { mostrarErro('erro-cad-senha', 'A senha deve ter ao menos 6 caracteres.'); valido = false; }
    if (!valido) { definirStatus('msg-cadastro', 'Corrija os campos destacados.', 'erro'); return; }

    // === Modo backend (banco de dados) ===
    if (backendAtivo) {
      try {
        const res = await window.BarberSlimAPI.registrarAsync({ nome, email, whatsapp, senha });
        const u = res.usuario;
        setSessao({ tipo: 'cliente', userId: u.id, nome: u.nome, whatsapp: u.whatsapp, email: u.email, token: res.token });
        definirStatus('msg-cadastro', 'Conta criada com sucesso! Redirecionando...', 'sucesso');
        atualizarHeaderSessao();
        setTimeout(() => irPara('home'), 900);
      } catch (err) {
        const msg = (err && err.message) || 'Erro ao criar a conta.';
        if (/já cadastrado|já está cadastrado|existe/i.test(msg)) {
          mostrarErro('erro-cad-email', 'Este e-mail já está cadastrado.');
        } else {
          definirStatus('msg-cadastro', msg, 'erro');
        }
      }
      return;
    }

    // === Modo demonstração (localStorage) ===
    const usuarios = getUsuarios();
    if (usuarios.some(u => u.email === email)) {
      mostrarErro('erro-cad-email', 'Este e-mail já está cadastrado.');
      valido = false;
    }
    if (!valido) { definirStatus('msg-cadastro', 'Corrija os campos destacados.', 'erro'); return; }

    const novoUsuario = { id: gerarId('usr'), nome, email, whatsapp, senha, criadoEm: new Date().toISOString() };
    usuarios.push(novoUsuario);
    setUsuarios(usuarios);

    definirStatus('msg-cadastro', 'Conta criada com sucesso! Redirecionando...', 'sucesso');
    setSessao({ tipo: 'cliente', userId: novoUsuario.id, nome: novoUsuario.nome, email: novoUsuario.email });
    atualizarHeaderSessao();
    setTimeout(() => irPara('home'), 900);
  });

  /* ---------------------------------------------------------
     10) LOGIN (conta / visitante) e LOGIN ADMIN
     --------------------------------------------------------- */
  document.querySelectorAll('.aba-auth').forEach(aba => {
    aba.addEventListener('click', function () {
      document.querySelectorAll('.aba-auth').forEach(a => { a.classList.remove('is-ativa'); a.setAttribute('aria-selected', 'false'); });
      this.classList.add('is-ativa');
      this.setAttribute('aria-selected', 'true');
      document.querySelectorAll('[data-aba-conteudo]').forEach(c => { c.hidden = c.dataset.abaConteudo !== this.dataset.aba; });
    });
  });

  document.getElementById('form-login').addEventListener('submit', async function (e) {
    e.preventDefault();
    ['erro-login-email', 'erro-login-senha'].forEach(id => mostrarErro(id, ''));
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const senha = document.getElementById('login-senha').value;

    let valido = true;
    if (!emailValido(email)) { mostrarErro('erro-login-email', 'E-mail inválido.'); valido = false; }
    if (!senha) { mostrarErro('erro-login-senha', 'Informe sua senha.'); valido = false; }
    if (!valido) return;

    // === Modo backend (banco de dados) ===
    if (backendAtivo) {
      try {
        const res = await window.BarberSlimAPI.loginAsync(email, senha);
        const u = res.usuario;
        setSessao({ tipo: 'cliente', userId: u.id, nome: u.nome, whatsapp: u.whatsapp, email: u.email, lembrar: document.getElementById('login-lembrar').checked, token: res.token });
        atualizarHeaderSessao();
        definirStatus('msg-login', 'Login realizado com sucesso!', 'sucesso');
        setTimeout(() => irPara('home'), 500);
      } catch (err) {
        definirStatus('msg-login', (err && err.message) || 'E-mail ou senha incorretos.', 'erro');
      }
      return;
    }

    // === Modo demonstração (localStorage) ===
    const usuario = getUsuarios().find(u => u.email === email && u.senha === senha);
    if (!usuario) {
      definirStatus('msg-login', 'E-mail ou senha incorretos.', 'erro');
      return;
    }
    setSessao({ tipo: 'cliente', userId: usuario.id, nome: usuario.nome, email: usuario.email, lembrar: document.getElementById('login-lembrar').checked });
    atualizarHeaderSessao();
    definirStatus('msg-login', 'Login realizado com sucesso!', 'sucesso');
    setTimeout(() => irPara('home'), 500);
  });

  document.getElementById('btn-entrar-visitante').addEventListener('click', function () {
    ['erro-visitante-nome', 'erro-visitante-whatsapp'].forEach(id => mostrarErro(id, ''));
    const nome = document.getElementById('visitante-nome').value.trim();
    const whatsapp = document.getElementById('visitante-whatsapp').value.trim();
    let valido = true;
    if (nome.length < 2) { mostrarErro('erro-visitante-nome', 'Informe seu nome.'); valido = false; }
    if (!whatsappValido(whatsapp)) { mostrarErro('erro-visitante-whatsapp', 'Informe um WhatsApp válido.'); valido = false; }
    if (!valido) return;

    setSessao({ tipo: 'visitante', userId: null, nome, whatsapp });
    atualizarHeaderSessao();
    irPara('agendamento');
  });

  document.getElementById('form-admin-login').addEventListener('submit', async function (e) {
    e.preventDefault();
    const email = document.getElementById('admin-email').value.trim().toLowerCase();
    const senha = document.getElementById('admin-senha').value;

    // === Modo backend (banco de dados) ===
    if (backendAtivo) {
      try {
        const res = await window.BarberSlimAPI.loginAsync(email, senha);
        const u = res.usuario;
        // Só aceita se o backend disser que o usuário é admin
        if (!u || u.tipo !== 'admin') {
          definirStatus('msg-admin-login', 'Credenciais administrativas inválidas.', 'erro');
          return;
        }
        setSessao({ tipo: 'admin', userId: 'admin', nome: 'Administrador', token: res.token });
        if (document.getElementById('admin-lembrar').checked) salvarAdminSalvo();
        atualizarHeaderSessao();
        definirStatus('msg-admin-login', 'Acesso concedido!', 'sucesso');
        setTimeout(() => irPara('admin'), 500);
      } catch (err) {
        definirStatus('msg-admin-login', (err && err.message) || 'Credenciais administrativas inválidas.', 'erro');
      }
      return;
    }

    // === Modo demonstração (localStorage) ===
    if (email === ADMIN.email && senha === ADMIN.senha) {
      setSessao({ tipo: 'admin', userId: 'admin', nome: 'Administrador' });
      if (document.getElementById('admin-lembrar').checked) salvarAdminSalvo();
      atualizarHeaderSessao();
      definirStatus('msg-admin-login', 'Acesso concedido!', 'sucesso');
      setTimeout(() => irPara('admin'), 500);
    } else {
      definirStatus('msg-admin-login', 'Credenciais administrativas inválidas.', 'erro');
    }
  });

  document.getElementById('btn-sair').addEventListener('click', function () {
    limparSessao();
    atualizarHeaderSessao();
    irPara('home');
  });

  /** Mostra/oculta o botão "Voltar ao painel (acesso salvo)" na tela de login
   *  admin. Existe só quando o admin marcou "Manter conectado". */
  function atualizarAcessoAdminSalvo() {
    const tem = !!getAdminSalvo();
    const b = document.getElementById('btn-voltar-admin');
    const e = document.getElementById('btn-esquecer-admin');
    if (b) b.hidden = !tem;
    if (e) e.hidden = !tem;
  }

  // Volta ao painel SEM digitar a senha (restaura a sessão salva do admin).
  document.getElementById('btn-voltar-admin').addEventListener('click', function () {
    const salvo = getAdminSalvo();
    if (!salvo) { atualizarAcessoAdminSalvo(); return; }
    setSessao(salvo);
    atualizarHeaderSessao();
    definirStatus('msg-admin-login', '', '');
    irPara('admin');
  });

  // Apaga o acesso salvo (logout definitivo — volta a pedir senha sempre).
  document.getElementById('link-esquecer-admin').addEventListener('click', function (e) {
    e.preventDefault();
    limparAdminSalvo();
    limparSessao();
    atualizarAcessoAdminSalvo();
    atualizarHeaderSessao();
    definirStatus('msg-admin-login', 'Acesso salvo apagado. Será necessário entrar com a senha.', 'sucesso');
    irPara('home');
  });

  function atualizarHeaderSessao() {
    const sessao = getSessao();
    const btnEntrar = document.getElementById('btn-entrar-nav');
    const btnSair = document.getElementById('btn-sair');
    const btnHistorico = document.getElementById('btn-historico-nav');

    if (sessao) {
      btnEntrar.hidden = true;
      btnSair.hidden = false;
      btnHistorico.hidden = sessao.tipo === 'admin';
      btnSair.innerHTML = `<i class="fas fa-right-from-bracket" aria-hidden="true"></i> Sair (${esc(sessao.nome.split(' ')[0])})`;
    } else {
      btnEntrar.hidden = false;
      btnSair.hidden = true;
      btnHistorico.hidden = true;
    }
  }

  /* ---------------------------------------------------------
     11) AGENDAMENTO
     --------------------------------------------------------- */
  const selecaoAgendamento = { barbeiroId: null, servicos: [], data: null, horario: null, pagamento: null };

  function montarAgendamento() {
    selecaoAgendamento.barbeiroId = null;
    selecaoAgendamento.servicos = [];
    selecaoAgendamento.data = null;
    selecaoAgendamento.horario = null;
    selecaoAgendamento.pagamento = null;
    mostrarErro('msg-agendamento', '');

    // Reseta a seleção de pagamento (rádios)
    const radiosPagamento = document.querySelectorAll('#lista-pagamento input[name="pagamento"]');
    radiosPagamento.forEach(r => { r.checked = false; });

    const listaBarbeiros = document.getElementById('lista-barbeiros');
    listaBarbeiros.innerHTML = cacheBarbeiros.map(b => `
      <button type="button" class="opcao-selecao" data-barbeiro="${esc(b.id)}">
        <i class="icone-check fas fa-circle-check" aria-hidden="true"></i>
        <strong><i class="fas ${esc(b.icone)}" aria-hidden="true"></i> ${esc(b.nome)}</strong>
        <small>${esc(b.especialidade)}</small>
      </button>
    `).join('');

    const listaServicos = document.getElementById('lista-servicos');
    listaServicos.innerHTML = cacheServicos.map(s => `
      <button type="button" class="opcao-selecao" data-servico="${esc(s.id)}">
        <i class="icone-check fas fa-circle-check" aria-hidden="true"></i>
        <strong>${esc(s.nome)}</strong>
        <small>R$ ${s.preco.toFixed(2)} · ${s.duracao} min</small>
      </button>
    `).join('');

    const inputData = document.getElementById('agenda-data');
    inputData.min = dataLocal(new Date()); // mínimo = hoje, no fuso local
    inputData.value = '';
    document.getElementById('lista-horarios').innerHTML = '<p class="dica">Selecione uma data para ver os horários disponíveis.</p>';
    atualizarPassos(); // zera os indicadores de etapa ao abrir a tela

    listaBarbeiros.querySelectorAll('[data-barbeiro]').forEach(btn => {
      btn.addEventListener('click', function () {
        listaBarbeiros.querySelectorAll('[data-barbeiro]').forEach(b => b.classList.remove('is-selecionada'));
        this.classList.add('is-selecionada');
        selecaoAgendamento.barbeiroId = this.dataset.barbeiro;
        atualizarPassos();
        renderizarHorarios();
      });
    });

    listaServicos.querySelectorAll('[data-servico]').forEach(btn => {
      btn.addEventListener('click', function () {
        const id = this.dataset.servico;
        const idx = selecaoAgendamento.servicos.indexOf(id);
        if (idx === -1) { selecaoAgendamento.servicos.push(id); this.classList.add('is-selecionada'); }
        else { selecaoAgendamento.servicos.splice(idx, 1); this.classList.remove('is-selecionada'); }
        atualizarPassos();
      });
    });

    // Escolha da forma de pagamento (PIX ou Dinheiro) — vincula uma única vez.
    if (!radiosPagamento[0] || !radiosPagamento[0].dataset.vinculado) {
      radiosPagamento.forEach(r => {
        r.dataset.vinculado = '1';
        r.addEventListener('change', function () {
          selecaoAgendamento.pagamento = this.value;
          atualizarPassos();
        });
      });
    }

    // Só vincula o listener uma única vez: como o input é reutilizado a cada
    // abertura da tela, re-vincular acumularia vários 'change' disparados juntos.
    if (!inputData.dataset.vinculado) {
      inputData.dataset.vinculado = '1';
      inputData.addEventListener('change', function () {
        selecaoAgendamento.data = this.value;
        selecaoAgendamento.horario = null;
        renderizarHorarios();
        atualizarPassos();
      });
    }
  }

  /** Gera a lista de horários do dia, do HORA_INICIO até HORA_FIM,
   *  pulando INTERVALO_MIN minutos entre cada um.
   *  Ex.: das 09:00 às 20:00 com 40 min de intervalo →
   *  09:00, 09:40, 10:20, 11:00, ...
   *  O cálculo usa minutos totais desde meia-noite para facilitar a soma. */
  function gerarHorariosDoDia() {
    const horarios = [];
    let minutosTotais = HORA_INICIO * 60; // 9h em minutos
    const fimMinutos = HORA_FIM * 60;      // 20h em minutos
    while (minutosTotais < fimMinutos) {
      // Converte minutos totais de volta para HH:MM
      const h = String(Math.floor(minutosTotais / 60)).padStart(2, '0');
      const m = String(minutosTotais % 60).padStart(2, '0');
      horarios.push(`${h}:${m}`);
      minutosTotais += INTERVALO_MIN;
    }
    return horarios;
  }

  /** Busca os horários já ocupados (não cancelados) de um barbeiro numa data.
   *  No modo backend online usa o endpoint público (impede conflito entre
   *  usuários, pois considera agendamentos de TODOS); no modo demo calcula
   *  a partir do cache local. */
  async function obterHorariosOcupados(barbeiroId, data) {
    if (backendAtivo) {
      try {
        const r = await window.BarberSlimAPI.horariosOcupadosAsync(data, barbeiroId);
        return Array.isArray(r.ocupados) ? r.ocupados : [];
      } catch (e) {
        console.warn('[BarberSlim] Falha ao buscar horários ocupados:', e.message);
        return [];
      }
    }
    return getAgendamentos()
      .filter(a => a.status !== 'cancelado' && a.barbeiroId === barbeiroId && a.data === data)
      .map(a => a.horario);
  }

  /** Desenha os botões de horário da data/barbeiro escolhidos.
   *  Marca como INDISPONÍVEIS (disabled):
   *   1. horários já agendados (por QUALQUER usuário) para aquele barbeiro naquela data;
   *   2. se a data for hoje, horários que já passaram (evita "agendar no passado"). */
  async function renderizarHorarios() {
    const container = document.getElementById('lista-horarios');
    // Sem data e/ou barbeiro ainda, não há como calcular horários
    if (!selecaoAgendamento.data || !selecaoAgendamento.barbeiroId) {
      container.innerHTML = '<p class="dica">Escolha o barbeiro e a data para ver os horários.</p>';
      return;
    }
    // Busca os horários já ocupados deste barbeiro nesta data (endpoint público ou demo)
    const ocupados = await obterHorariosOcupados(selecaoAgendamento.barbeiroId, selecaoAgendamento.data);

    const horarios = gerarHorariosDoDia();

    // Se a data escolhida for hoje, bloqueia horários que já passaram.
    const agora = new Date();
    const dataEhHoje = selecaoAgendamento.data === dataLocal(agora);
    const minutosAtual = agora.getHours() * 60 + agora.getMinutes();

    container.innerHTML = horarios.map(h => {
      const [hh, mm] = h.split(':').map(Number); // ex.: "14:00" -> [14, 0]
      const noPassado = dataEhHoje && (hh * 60 + mm) <= minutosAtual;
      const indisponivel = ocupados.includes(h) || noPassado;
      // Botão desabilitado (sem evento de clique) se o horário não estiver livre
      return `<button type="button" class="horario-btn" data-horario="${h}" ${indisponivel ? 'disabled aria-disabled="true"' : ''}>${h}</button>`;
    }).join('');

    // Liga o clique apenas nos horários DISPONÍVEIS (não desabilitados)
    container.querySelectorAll('.horario-btn:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', function () {
        container.querySelectorAll('.horario-btn').forEach(b => b.classList.remove('is-selecionado'));
        this.classList.add('is-selecionado');
        selecaoAgendamento.horario = this.dataset.horario; // guarda o horário escolhido
        atualizarPassos();
      });
    });
  }

  /** Atualiza o indicador visual das 3 etapas do agendamento
   *  (1. Barbeiro, 2. Serviços, 3. Data & Hora), acendendo a etapa
   *  que já foi preenchida pelo usuário. */
  function atualizarPassos() {
    const passo1 = document.querySelector('[data-passo="1"]');
    const passo2 = document.querySelector('[data-passo="2"]');
    const passo3 = document.querySelector('[data-passo="3"]');
    const passo4 = document.querySelector('[data-passo="4"]');
    passo1.classList.toggle('is-ativo', !!selecaoAgendamento.barbeiroId);
    passo2.classList.toggle('is-ativo', selecaoAgendamento.servicos.length > 0);
    passo3.classList.toggle('is-ativo', !!selecaoAgendamento.horario);
    passo4.classList.toggle('is-ativo', !!selecaoAgendamento.pagamento);
  }

  /* Handler do botão "Confirmar Agendamento".
     Passos:
     1. Garante que há uma sessão válida (login ou visitante).
     2. Valida cada etapa (barbeiro, serviço, data, horário).
     3. Monta o objeto `agendamento` com todos os dados.
     4. Salva (no localStorage ou no banco via api.js).
     5. Mostra a tela de confirmação. */
  document.getElementById('btn-confirmar-agendamento').addEventListener('click', async function () {
    const sessao = getSessao();
    // Admin não agenda; e sem sessão manda para o login
    if (!sessao || sessao.tipo === 'admin') {
      mostrarErro('msg-agendamento', 'Faça login ou entre como visitante para agendar.');
      irPara('login');
      return;
    }
    // Validações em cascata (mostra a primeira que falhar)
    if (!selecaoAgendamento.barbeiroId) { mostrarErro('msg-agendamento', 'Selecione um barbeiro.'); return; }
    if (selecaoAgendamento.servicos.length === 0) { mostrarErro('msg-agendamento', 'Selecione ao menos um serviço.'); return; }
    if (!selecaoAgendamento.data) { mostrarErro('msg-agendamento', 'Selecione uma data.'); return; }
    if (!selecaoAgendamento.horario) { mostrarErro('msg-agendamento', 'Selecione um horário.'); return; }
    if (!selecaoAgendamento.pagamento) { mostrarErro('msg-agendamento', 'Escolha a forma de pagamento (PIX ou dinheiro).'); return; }

    mostrarErro('msg-agendamento', '');

    // Resolve os objetos escolhidos (barbeiro e serviços) pelos ids salvos
    const barbeiro = cacheBarbeiros.find(b => b.id === selecaoAgendamento.barbeiroId);
    const servicosEscolhidos = cacheServicos.filter(s => selecaoAgendamento.servicos.includes(s.id));
    const total = servicosEscolhidos.reduce((soma, s) => soma + s.preco, 0); // soma os preços

    // Monta o registro completo do agendamento (shape interno)
    const agendamento = {
      id: gerarId('ag'),
      userId: sessao.userId,
      clienteNome: sessao.nome,
      clienteWhatsapp: sessao.whatsapp || (getUsuarios().find(u => u.id === sessao.userId) || {}).whatsapp || '',
      barbeiroId: barbeiro.id,
      barbeiroNome: barbeiro.nome,
      servicos: servicosEscolhidos.map(s => s.nome),       // nomes p/ exibição
      servicosIds: servicosEscolhidos.map(s => s.id),     // ids p/ consultas
      total,
      data: selecaoAgendamento.data,
      horario: selecaoAgendamento.horario,
      pagamento: selecaoAgendamento.pagamento,
      status: 'confirmado',
      criadoEm: new Date().toISOString()
    };

    // === Modo backend (banco de dados) ===
    if (backendAtivo) {
      this.disabled = true;
      try {
        const criado = await window.BarberSlimAPI.criarAgendamentoAsync({
          usuario_id: sessao.userId || null,
          cliente_nome: agendamento.clienteNome,
          cliente_whatsapp: agendamento.clienteWhatsapp,
          barbeiro_id: agendamento.barbeiroId,
          barbeiro_nome: agendamento.barbeiroNome,
          servicos: agendamento.servicos,
          servicos_ids: agendamento.servicosIds,
          total: agendamento.total,
          data: agendamento.data,
          horario: agendamento.horario,
          pagamento: agendamento.pagamento
        });
        agendamento.id = criado.id;
        await refrescarAgendamentos(); // atualiza o cache com o novo registro
        // PIX: mostra a tela de pagamento e só libera após confirmar o pagamento.
        if (agendamento.pagamento === 'pix') {
          await montarPagamento(agendamento);
          irPara('pagamento');
        } else {
          montarConfirmacao(agendamento);
          irPara('confirmacao');
        }
      } catch (err) {
        mostrarErro('msg-agendamento', (err && err.message) || 'Erro ao salvar o agendamento.');
      } finally {
        this.disabled = false;
      }
      return;
    }

    // === Modo demonstração (localStorage) ===
    const lista = getAgendamentos();
    lista.push(agendamento);
    setAgendamentos(lista);

    // PIX: mostra a tela de pagamento e só libera após confirmar.
    if (agendamento.pagamento === 'pix') {
      montarPagamentoDemo(agendamento);
      irPara('pagamento');
    } else {
      montarConfirmacao(agendamento);
      irPara('confirmacao');
    }
  });

  /** Converte 'YYYY-MM-DD' (ISO) para o formato brasileiro 'DD/MM/YYYY'. */
  function formatarDataBR(iso) {
    const [ano, mes, dia] = iso.split('-');
    return `${dia}/${mes}/${ano}`;
  }

  /** Preenche o resumo (dl) da tela de confirmação com os dados do
   *  agendamento recém-criado. */
  function montarConfirmacao(ag) {
    const resumo = document.getElementById('resumo-agendamento');
    resumo.innerHTML = `
      <div><dt>Cliente</dt><dd>${esc(ag.clienteNome)}</dd></div>
      <div><dt>Barbeiro</dt><dd>${esc(ag.barbeiroNome)}</dd></div>
      <div><dt>Serviços</dt><dd>${esc(ag.servicos.join(', '))}</dd></div>
      <div><dt>Data</dt><dd>${formatarDataBR(ag.data)}</dd></div>
      <div><dt>Horário</dt><dd>${esc(ag.horario)}</dd></div>
      <div><dt>Pagamento</dt><dd>${esc(ag.pagamento === 'dinheiro' ? 'Dinheiro' : 'PIX')}</dd></div>
      <div><dt>Total</dt><dd>R$ ${ag.total.toFixed(2)}</dd></div>
    `;
  }

  /* ---------------------------------------------------------
     11-B) PAGAMENTO PIX — tela de pagamento
     --------------------------------------------------------- */
  let agendamentoPendente = null; // agendamento PIX aguardando pagamento

  /** Monta a tela de pagamento PIX. Exige o e-mail (para o Mercado Pago
   *  criar a cobrança real) e um clique em "Gerar pagamento PIX". */
  function montarPagamento(ag) {
    agendamentoPendente = ag;
    pararPolling();
    mostrarErro('msg-pagamento', '');
    const sessao = getSessao();
    const emailPrefill = (sessao && sessao.email) || '';
    document.getElementById('resumo-pagamento').innerHTML = `
      <div><dt>Barbeiro</dt><dd>${esc(ag.barbeiroNome)}</dd></div>
      <div><dt>Serviços</dt><dd>${esc(ag.servicos.join(', '))}</dd></div>
      <div><dt>Data</dt><dd>${formatarDataBR(ag.data)}</dd></div>
      <div><dt>Horário</dt><dd>${esc(ag.horario)}</dd></div>
      <div><dt>Total a pagar</dt><dd>R$ ${ag.total.toFixed(2)}</dd></div>
    `;
    document.getElementById('pix-email').value = emailPrefill;
    document.getElementById('div-gerar-pix').hidden = false;
    document.getElementById('div-pix-pronto').hidden = true;
    document.getElementById('btn-confirmar-pagamento').hidden = true;
    document.getElementById('dica-pagamento').textContent = 'Ao pagar, seu horário é liberado automaticamente.';
  }

  /** Gera a cobrança PIX (Mercado Pago real ou estático) e mostra o QR. */
  async function gerarPagamentoPix() {
    const ag = agendamentoPendente;
    if (!ag) return;
    const email = document.getElementById('pix-email').value.trim().toLowerCase();
    if (!emailValido(email)) { mostrarErro('msg-pagamento', 'Informe um e-mail válido para gerar o PIX.'); return; }

    const btn = document.getElementById('btn-gerar-pix');
    btn.disabled = true;
    btn.textContent = 'Gerando...';
    mostrarErro('msg-pagamento', '');
    try {
      const r = await window.BarberSlimAPI.obterPixAsync(ag.id, email);
      document.getElementById('pix-qr').src = r.qrDataUrl || '';
      document.getElementById('pix-copia').value = r.copiaECola || '';
      document.getElementById('div-gerar-pix').hidden = true;
      document.getElementById('div-pix-pronto').hidden = false;
      document.getElementById('btn-confirmar-pagamento').hidden = false;
      document.getElementById('dica-pagamento').textContent =
        (r.gateway === 'mercadopago')
          ? 'Pagamento do Mercado Pago: ao pagar, seu horário é confirmado automaticamente.'
          : 'Após pagar, clique em "Já paguei" para liberar seu horário.';
      // Com Mercado Pago, fica de olho no status e confirma sozinho quando aprovar.
      if (r.gateway === 'mercadopago') iniciarPolling(ag);
    } catch (e) {
      const precisaEmail = !!(e && e.precisaEmail) || /e-mail/i.test((e && e.message) || '');
      mostrarErro('msg-pagamento', (e && e.message) || 'Não foi possível gerar o PIX. Tente novamente.');
      if (precisaEmail) document.getElementById('div-gerar-pix').hidden = false;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-qrcode" aria-hidden="true"></i> Gerar pagamento PIX';
    }
  }

  let timerPolling = null;
  function pararPolling() { if (timerPolling) { clearInterval(timerPolling); timerPolling = null; } }
  /** Consulta o status a cada 2s; quando confirmado, fecha a tela de pagamento. */
  function iniciarPolling(ag) {
    pararPolling();
    timerPolling = setInterval(async () => {
      try {
        const s = await window.BarberSlimAPI.obterStatusAsync(ag.id);
        if (s && s.status === 'confirmado') {
          pararPolling();
          agendamentoPendente = null;
          ag.status = 'confirmado';
          await refrescarAgendamentos();
          montarConfirmacao(ag);
          irPara('confirmacao');
        }
      } catch (e) { /* mantém tentando */ }
    }, 2000);
  }

  /** Modo demonstração (sem backend): não há QR real — só avisa. */
  function montarPagamentoDemo(ag) {
    agendamentoPendente = ag;
    pararPolling();
    mostrarErro('msg-pagamento', '');
    document.getElementById('resumo-pagamento').innerHTML = `
      <div><dt>Barbeiro</dt><dd>${esc(ag.barbeiroNome)}</dd></div>
      <div><dt>Serviços</dt><dd>${esc(ag.servicos.join(', '))}</dd></div>
      <div><dt>Data</dt><dd>${formatarDataBR(ag.data)}</dd></div>
      <div><dt>Horário</dt><dd>${esc(ag.horario)}</dd></div>
      <div><dt>Total a pagar</dt><dd>R$ ${ag.total.toFixed(2)}</dd></div>
    `;
    document.getElementById('div-gerar-pix').hidden = true;
    document.getElementById('div-pix-pronto').hidden = true;
    document.getElementById('btn-confirmar-pagamento').hidden = false;
    document.getElementById('dica-pagamento').textContent = 'Modo demonstração: clique em "Já paguei" para liberar o horário.';
    document.getElementById('pix-qr').removeAttribute('src');
    document.getElementById('pix-copia').value = '';
  }

  /** Confirma o pagamento — só aqui o agendamento PIX é liberado. */
  async function confirmarPagamento() {
    const ag = agendamentoPendente;
    if (!ag) return;
    const btn = document.getElementById('btn-confirmar-pagamento');
    btn.disabled = true;
    try {
      if (backendAtivo) {
        await window.BarberSlimAPI.confirmarPagamentoAsync(ag.id);
        await refrescarAgendamentos();
        ag.status = 'confirmado';
      } else {
        const lista = getAgendamentos();
        const alvo = lista.find(a => a.id === ag.id);
        if (alvo) alvo.status = 'confirmado';
        setAgendamentos(lista);
      }
      agendamentoPendente = null;
      montarConfirmacao(ag);
      irPara('confirmacao');
    } catch (err) {
      mostrarErro('msg-pagamento', (err && err.message) || 'Erro ao confirmar o pagamento.');
    } finally {
      btn.disabled = false;
    }
  }

  document.getElementById('btn-confirmar-pagamento').addEventListener('click', confirmarPagamento);
  document.getElementById('btn-gerar-pix').addEventListener('click', gerarPagamentoPix);
  document.getElementById('btn-copiar-pix').addEventListener('click', function () {
    const ta = document.getElementById('pix-copia');
    if (!ta.value) return;
    const ok = navigator.clipboard ? navigator.clipboard.writeText(ta.value) : null;
    if (ok && ok.then) {
      ok.then(() => mostrarErro('msg-pagamento', 'Código copiado! Copie e pague no seu banco.'))
        .catch(() => {});
    } else {
      ta.select();
      document.execCommand('copy');
      mostrarErro('msg-pagamento', 'Código copiado! Copie e pague no seu banco.');
    }
  });
  document.getElementById('btn-cancelar-pagamento').addEventListener('click', function () {
    pararPolling();
    agendamentoPendente = null;
    mostrarErro('msg-pagamento', '');
    irPara('home');
  });

  /** Rótulo legível do status de um agendamento (HTML de badge). */
  function rotuloStatus(ag) {
    const s = ag.status;
    if (s === 'aguardando_pagamento') return '<span class="selo-status selo-status--pendente">Aguardando pagamento</span>';
    if (s === 'cancelado') return '<span class="selo-status selo-status--cancelado">Cancelado</span>';
    return '<span class="selo-status selo-status--confirmado">Confirmado</span>';
  }

  /* ---------------------------------------------------------
     12) HISTÓRICO DO CLIENTE
     --------------------------------------------------------- */
  async function montarHistorico() {
    const sessao = getSessao();
    const container = document.getElementById('lista-historico');
    if (!sessao) {
      container.innerHTML = '<p class="dica">Faça login para ver seu histórico de agendamentos.</p>';
      return;
    }

    // Modo backend: busca do banco apenas os agendamentos deste cliente
    let meus;
    if (backendAtivo) {
      try {
        const lista = await window.BarberSlimAPI.listarAgendamentosAsync(sessao.userId);
        meus = (Array.isArray(lista) ? lista : []).map(normalizarAgendamento);
      } catch (e) {
        console.warn('[BarberSlim] Falha ao carregar histórico:', e.message);
        meus = [];
      }
    } else {
      meus = getAgendamentos();
    }

    meus = meus
      .filter(a => (sessao.userId && a.userId === sessao.userId) || (!sessao.userId && a.clienteWhatsapp === sessao.whatsapp))
      .sort((a, b) => (a.data + a.horario < b.data + b.horario ? 1 : -1));

    if (meus.length === 0) {
      container.innerHTML = '<p class="dica">Você ainda não tem agendamentos. Que tal marcar um horário agora?</p>';
      return;
    }

    container.innerHTML = meus.map(ag => `
      <div class="item-historico">
        <div class="item-historico__info">
          <strong>${esc(ag.barbeiroNome)} — ${esc(ag.servicos.join(', '))}</strong>
          <span>${formatarDataBR(ag.data)} às ${esc(ag.horario)} · R$ ${ag.total.toFixed(2)} · ${esc(ag.pagamento === 'dinheiro' ? 'Dinheiro' : 'PIX')}</span>
        </div>
        ${rotuloStatus(ag)}
      </div>
    `).join('');
  }

  /* ---------------------------------------------------------
     13) PAINEL ADMINISTRATIVO
     ---------------------------------------------------------
     Tela restrita ao administrador. Mostra:
       - contadores (total, hoje, clientes);
       - tabela com todos os agendamentos;
       - botão de excluir cada agendamento;
       - botão de exportar dados em JSON.
     O acesso é protegido: só quem está logado como 'admin' entra;
     caso contrário, é redirecionado para a tela de login do admin. */
  async function montarAdmin() {
    const sessao = getSessao();
    // Proteção: sem sessão de admin, volta para o login administrativo
    if (!sessao || sessao.tipo !== 'admin') { irPara('admin-login'); return; }

    // Modo backend: carrega os dados reais do banco antes de exibir o painel
    if (backendAtivo) {
      try {
        const [ag, us] = await Promise.all([
          window.BarberSlimAPI.listarAgendamentosAsync(),
          window.BarberSlimAPI.listarUsuariosAsync()
        ]);
        cacheAgendamentos = (Array.isArray(ag) ? ag : []).map(normalizarAgendamento);
        cacheUsuarios = Array.isArray(us) ? us : [];
      } catch (e) {
        console.warn('[BarberSlim] Falha ao carregar dados do admin:', e.message);
      }
    }

    const agendamentos = getAgendamentos();
    const usuarios = getUsuarios();
    // Data de hoje no fuso local (para o contador "Hoje") — não usar UTC
    const hojeISO = dataLocal(new Date());

    // Preenche os cartões de estatística
    document.getElementById('stat-total').textContent = agendamentos.length;
    document.getElementById('stat-hoje').textContent = agendamentos.filter(a => a.data === hojeISO).length;
    document.getElementById('stat-clientes').textContent = usuarios.length;

    // Monta a tabela de agendamentos (ordenados do mais recente para o mais antigo)
    const corpo = document.getElementById('corpo-tabela-admin');
    const vazio = document.getElementById('admin-vazio');
    if (agendamentos.length === 0) {
      corpo.innerHTML = '';
      vazio.hidden = false;   // mostra o aviso "nenhum agendamento"
    } else {
      vazio.hidden = true;
      corpo.innerHTML = agendamentos
        .slice()
        .sort((a, b) => (a.data + a.horario < b.data + b.horario ? 1 : -1))
        .map(ag => `
          <tr data-linha="${esc(ag.id)}">
            <td>${esc(ag.clienteNome)}</td>
            <td>${esc(ag.barbeiroNome)}</td>
            <td>${esc(ag.servicos.join(', '))}</td>
            <td>${formatarDataBR(ag.data)}</td>
            <td>${esc(ag.horario)}</td>
            <td>${esc(ag.pagamento === 'dinheiro' ? 'Dinheiro' : 'PIX')}</td>
            <td>${rotuloStatus(ag)}</td>
            <td><button type="button" class="btn-excluir" data-excluir="${esc(ag.id)}">Excluir</button></td>
          </tr>
        `).join('');
    }

    // Liga o clique de cada botão "Excluir" (com confirmação)
    corpo.querySelectorAll('[data-excluir]').forEach(botao => {
      botao.addEventListener('click', async function () {
        if (!confirm('Deseja realmente excluir este agendamento?')) return;
        if (backendAtivo) {
          try {
            await window.BarberSlimAPI.excluirAgendamentoAsync(this.dataset.excluir);
            cacheAgendamentos = cacheAgendamentos.filter(a => a.id !== this.dataset.excluir);
          } catch (e) {
            alert('Erro ao excluir: ' + ((e && e.message) || 'falha na comunicação.'));
          }
        } else {
          // Remove do array e regrava (modo demo) — depois remonta o painel atualizado
          cacheAgendamentos = cacheAgendamentos.filter(a => a.id !== this.dataset.excluir);
          salvarStorage(CHAVES.AGENDAMENTOS, cacheAgendamentos);
        }
        montarAdmin();
      });
    });
  }

  document.getElementById('btn-exportar').addEventListener('click', function () {
    const dados = {
      agendamentos: getAgendamentos(),
      usuarios: getUsuarios().map(u => ({ id: u.id, nome: u.nome, email: u.email, whatsapp: u.whatsapp })),
      exportadoEm: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'barberslim-dados.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  /* ---------------------------------------------------------
     14) MODAL DE ESTATÍSTICAS (gráficos)
     ---------------------------------------------------------
     Abre uma janela com dois gráficos de barras simples (CSS), mostrando
     os agendamentos contados por serviço e por barbeiro. */
  const modalStats = document.getElementById('modal-estatisticas');

  function abrirModalStats() {
    montarGraficos();          // reconstrói os gráficos com dados atuais
    modalStats.hidden = false;
    document.body.style.overflow = 'hidden'; // trava a rolagem do fundo
  }
  function fecharModalStats() {
    modalStats.hidden = true;
    document.body.style.overflow = ''; // libera a rolagem
  }

  document.getElementById('btn-abrir-estatisticas').addEventListener('click', abrirModalStats);
  document.getElementById('fechar-modal-stats').addEventListener('click', fecharModalStats);
  // Clicar fora da caixa do modal (no fundo escuro) também fecha
  modalStats.addEventListener('click', function (e) { if (e.target === modalStats) fecharModalStats(); });
  // Tecla ESC fecha tanto o modal quanto o painel de acessibilidade
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { fecharModalStats(); fecharPainelA11y(); }
  });

  /** Desenha um gráfico de barras a partir de um objeto { rótulo: contagem }.
   *  @param containerId id do elemento que receberá as barras
   *  @param contagens   objeto com as quantidades
   *  @param maxItens    quantas maiores categorias mostrar (padrão 10) */
  function montarGrafico(containerId, contagens, maxItens) {
    const container = document.getElementById(containerId);
    // Ordena pelas maiores contagens e limita a quantidade de barras
    const entradas = Object.entries(contagens).sort((a, b) => b[1] - a[1]).slice(0, maxItens || 10);
    if (entradas.length === 0) { container.innerHTML = '<p class="dica">Ainda não há dados suficientes.</p>'; return; }
    const maximo = Math.max(...entradas.map(e => e[1])); // maior valor -> 100% da barra
    container.innerHTML = entradas.map(([rotulo, valor]) => `
      <div class="grafico-barras__linha">
        <span class="grafico-barras__rotulo">${esc(rotulo)}</span>
        <span class="grafico-barras__trilha"><span class="grafico-barras__preenchimento" style="width:${(valor / maximo) * 100}%"></span></span>
        <span class="grafico-barras__valor">${valor}</span>
      </div>
    `).join('');
  }

  /** Percorre todos os agendamentos e conta quantos existem por serviço
   *  e por barbeiro, depois chama montarGrafico para cada um. */
  function montarGraficos() {
    const agendamentos = getAgendamentos();
    const porServico = {};
    const porBarbeiro = {};
    agendamentos.forEach(ag => {
      // Cada agendamento pode ter vários serviços; conta cada nome
      ag.servicos.forEach(nome => { porServico[nome] = (porServico[nome] || 0) + 1; });
      porBarbeiro[ag.barbeiroNome] = (porBarbeiro[ag.barbeiroNome] || 0) + 1;
    });
    montarGrafico('grafico-servicos', porServico);
    montarGrafico('grafico-barbeiros', porBarbeiro);
  }

  /* ---------------------------------------------------------
     15) INICIALIZAÇÃO
     --------------------------------------------------------- */
  atualizarHeaderSessao();
  irPara('home');

  // Se o backend estiver ativo, carrega catálogo e agenda para o cache
  if (backendAtivo) {
    carregarCatalogo();
    refrescarAgendamentos();
  }
})();
