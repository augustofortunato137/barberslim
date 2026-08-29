/* =========================================================
   BARBERSLIM — pix.js
   Geração de PIX "estático" (copia e cola + QR Code).

   Este módulo monta o payload EMV/BR Code (o "copia e cola") que
   os bancos reconhecem como uma cobrança PIX, e gera o QR Code.

   IMPORTANTE: é um PIX ESTÁTICO — o pagamento cai DIRETO na chave
   da barbearia, sem intermediário. O sistema NÃO consegue saber
   automaticamente se o dinheiro caiu; o cliente confirma no site.

   Para integrar um gateway de verdade (Mercado Pago etc.), basta
   trocar este módulo por chamadas à API do provedor e substituir a
   confirmação manual pela notificação automática (webhook).
   ========================================================= */

/** Monta um campo EMV: id + (2 dígitos do tamanho) + valor. */
function campo(id, valor) {
  const v = String(valor);
  return id + String(v.length).padStart(2, '0') + v;
}

/** CRC16-CCITT (polinômio 0x1021), usado no campo 63 do BR Code. */
function crc16(entrada) {
  let crc = 0xFFFF;
  for (let i = 0; i < entrada.length; i++) {
    crc ^= entrada.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc;
}

/**
 * Monta o PIX "copia e cola" (payload EMV / BR Code).
 * @param {object} cfg { chave, nome, cidade, valor, txid }
 * @returns {string} código copia e cola
 */
function montarPixCopiaECola({ chave, nome, cidade, valor, txid }) {
  const gui = campo('00', 'BR.GOV.BCB.PIX');                 // GUI oficial do PIX
  const chaveField = campo('01', chave);                     // a chave (celular/email/cpf/aleatória)
  const conta = campo('26', gui + chaveField);               // Merchant Account Info
  let payload = '000201';                                    // formato de payload (EMV)
  payload += conta;
  payload += campo('52', '2024');                            // categoria do negócio
  payload += campo('53', '986');                             // moeda: Real (BRL)
  if (valor != null && !isNaN(Number(valor)) && Number(valor) > 0) {
    payload += campo('54', Number(valor).toFixed(2));        // valor da cobrança
  }
  payload += campo('58', 'BR');                              // país
  payload += campo('59', (nome || 'BARBERSLIM').toUpperCase().slice(0, 25));  // recebedor
  payload += campo('60', (cidade || 'OURINHOS').toUpperCase().slice(0, 15));  // cidade
  payload += campo('62', campo('05', (txid || '***').slice(0, 25)));          // txid
  payload += '6304';                                         // campo de CRC (id+len)
  return payload + crc16(payload).toString(16).toUpperCase().padStart(4, '0');
}

module.exports = { montarPixCopiaECola, crc16 };