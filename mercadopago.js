/* =========================================================
   BARBERSLIM — mercadopago.js
   Integração com o Mercado Pago (PIX real).

   Substitui o PIX "estático" (manual) por cobranças PIX reais
   criadas na conta do Mercado Pago. Quando o cliente paga, o
   Mercado Pago NOTIFICA o nosso servidor (webhook) e o sistema
   confirma o agendamento automaticamente.

   Configuração (variáveis de ambiente):
     MERCADOPAGO_ACCESS_TOKEN  — Access Token de PRODUÇÃO da conta.
   ========================================================= */

const MP_BASE = 'https://api.mercadopago.com/v1';

/**
 * Cria uma cobrança PIX no Mercado Pago.
 * @param {object} cfg { token, valor, descricao, externalRef, email, notificationUrl }
 * @returns {Promise<object>} { id, status, qr_code (copia e cola), qr_code_base64 }
 */
async function criarPagamentoPix({ token, valor, descricao, externalRef, email, notificationUrl }) {
  const body = {
    transaction_amount: Number(valor),
    description: String(descricao || 'Agendamento BarberSlim'),
    payment_method_id: 'pix',
    external_reference: String(externalRef),
    notification_url: String(notificationUrl)
  };
  // O Mercado Pago exige um "payer" (email) na cobrança PIX.
  if (email) body.payer = { email };
  else body.payer = {}; // será validado: sem email, o MP rejeita (tratamos abaixo)

  const resp = await fetch(MP_BASE + '/payments', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      // Obrigatório no Mercado Pago para garantir idempotência.
      'X-Idempotency-Key': String(externalRef) + '-' + Date.now()
    },
    body: JSON.stringify(body)
  });
  const j = await resp.json();

  if (!resp.ok || resp.status >= 400) {
    const msg = (j && j.message) || (j && j.cause && j.cause[0] && j.cause[0].description) || 'falha ao criar PIX';
    // payer sem email -> pede um e-mail válido
    if (/payer_cannot_be_nil|email/.test(JSON.stringify(j))) {
      const err = new Error('É necessário informar um e-mail para gerar o PIX.');
      err.code = 'MP_NEEDS_EMAIL';
      throw err;
    }
    const err = new Error('Mercado Pago: ' + msg);
    err.code = 'MP_ERROR';
    throw err;
  }

  const td = (j.point_of_interaction && j.point_of_interaction.transaction_data) || {};
  return {
    id: j.id,
    status: j.status,               // 'pending' até o pagamento
    qr_code: td.qr_code || '',      // PIX copia e cola
    qr_code_base64: td.qr_code_base64 || '' // QR em base64 (sem prefixo)
  };
}

/**
 * Consulta o status de um pagamento no Mercado Pago.
 * @returns {Promise<object>} { id, status, external_reference }
 */
async function consultarPagamento(token, paymentId) {
  const resp = await fetch(MP_BASE + '/payments/' + paymentId, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  const j = await resp.json();
  if (!resp.ok) {
    const err = new Error('Mercado Pago: erro ao consultar pagamento ' + paymentId);
    err.code = 'MP_QUERY_ERROR';
    throw err;
  }
  return { id: j.id, status: j.status, external_reference: j.external_reference };
}

module.exports = { criarPagamentoPix, consultarPagamento, MP_BASE };