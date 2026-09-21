/* =========================================================
   BARBERSLIM — TEMA (escuro / claro)
   =========================================================
   Este script é carregado no <head>, ANTES do corpo da página.
   Isso é proposital: ele aplica a classe do tema no <html> o mais
   cedo possível, evitando que o usuário veja um "flash" do tema
   escuro antes do claro aparecer.

   Modo ESCURO  -> identidade atual (preto + dourado). É o padrão.
   Modo CLARO   -> branco como cor principal e azul como secundária
                   (com azuis mais escuros na hierarquia terciária).

   A escolha fica salva em localStorage na chave 'bsp_tema'.
   ========================================================= */
(function () {
  'use strict';

  var CHAVE = 'bsp_tema';          // onde a preferência é guardada
  var CLASSE = 'tema-claro';       // classe aplicada em <html> no modo claro

  /** Lê o tema salvo. Devolve 'claro' ou 'escuro'. */
  function temaSalvo() {
    try {
      var t = localStorage.getItem(CHAVE);
      return t === 'claro' ? 'claro' : 'escuro';
    } catch (e) {
      return 'escuro'; // se o localStorage estiver bloqueado, usa o padrão
    }
  }

  /** Aplica o tema no <html> (aplica/remove a classe). */
  function aplicar(tema) {
    var claro = tema === 'claro';
    document.documentElement.classList.toggle(CLASSE, claro);
    // Mantém a cor da barra do navegador (mobile) coerente com o tema
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', claro ? '#ffffff' : '#0d0c11');
  }

  // 1) Aplicação imediata (antes do body renderizar) — evita o flash.
  aplicar(temaSalvo());

  // 2) Ligação do botão depois que o HTML estiver pronto.
  function ligarBotao() {
    var btn = document.getElementById('btn-tema');
    if (!btn) return;
    var icone = document.getElementById('icone-tema');

    /** Sincroniza ícone e rótulos de acessibilidade com o tema atual. */
    function sincronizar() {
      var claro = document.documentElement.classList.contains(CLASSE);
      if (icone) icone.className = claro ? 'fas fa-sun' : 'fas fa-moon';
      btn.setAttribute('aria-pressed', String(claro));
      btn.setAttribute(
        'aria-label',
        claro ? 'Alternar para o modo escuro' : 'Alternar para o modo claro'
      );
      btn.setAttribute('title', claro ? 'Mudar para tema escuro' : 'Mudar para tema claro');
    }

    btn.addEventListener('click', function () {
      var claroAgora = document.documentElement.classList.contains(CLASSE);
      var novo = claroAgora ? 'escuro' : 'claro';
      aplicar(novo);
      try { localStorage.setItem(CHAVE, novo); } catch (e) { /* ignora */ }
      sincronizar();
    });

    sincronizar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ligarBotao);
  } else {
    ligarBotao();
  }
})();
