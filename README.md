# BarberSlim — Sistema de Agendamento para Barbearia

Aplicação web completa (frontend + backend Node/Express + PostgreSQL) para uma
barbearia agendar horários online: escolha do barbeiro, serviços, data/hora,
forma de pagamento (PIX ou dinheiro) e painel administrativo.

## Demonstração online
- **Site/API (Render):** https://barberslim.com.br
- **Banco de dados (Neon/PostgreSQL):** região `sa-east-1` (AWS São Paulo)

## Hospedagem e tecnologias
| Camada | Tecnologia |
|---|---|
| Linguagem (backend) | JavaScript — Node.js 20 |
| Framework HTTP | Express 4 |
| Banco de dados | PostgreSQL (Neon) |
| Autenticação | JWT (`jsonwebtoken`) + bcrypt |
| Segurança | Helmet (CSP), CORS, express-rate-limit |
| Pagamento | Mercado Pago (PIX + webhook) ou PIX estático (QR local) |
| Frontend | HTML5 + CSS3 + JavaScript puro (SPA, sem build) |
| Hospedagem da aplicação | Render |
| Repositório | GitHub |

## Estrutura
```
├── server.js       → API REST + serve o frontend (Node/Express)
├── database.js     → acesso ao PostgreSQL (pg Pool, assíncrono)
├── schema.sql      → cria tabelas + seed inicial + índice anti-duplicidade
├── package.json    → dependências (express, pg, bcryptjs, jsonwebtoken...)
├── public/         → frontend (index.html, css/, js/)
│   ├── index.html  → página principal (SPA)
│   ├── css/styles.css
│   └── js/
│       ├── api.js  → camada de integração com o backend (fetch)
│       └── app.js  → lógica da interface
└── .env.example    → modelo das variáveis de ambiente
```

## Como rodar localmente
1. Instale o [Node.js](https://nodejs.org) (LTS).
2. Crie um PostgreSQL online (ex.: [Neon](https://neon.tech)) e copie a
   connection string.
3. Copie `.env.example` para `.env` e preencha `DATABASE_URL` (e, se quiser,
   `ADMIN_EMAIL`, `ADMIN_SENHA`, `JWT_SECRET`).
4. Instale as dependências e inicie:
   ```bash
   npm install
   npm start
   ```
5. Acesse **http://localhost:3000**.

O banco (tabelas, barbeiros, serviços e admin) é criado automaticamente no
primeiro start via `schema.sql` + `database.js`.

## API (principais endpoints)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/health` | status do servidor |
| POST | `/api/auth/register` | cria conta de cliente |
| POST | `/api/auth/login` | autentica (cliente/admin) e devolve token |
| GET | `/api/barbeiros` | catálogo público de barbeiros |
| GET | `/api/servicos` | catálogo público de serviços |
| GET | `/api/agendamentos/ocupados?data=&barbeiro_id=` | horários já ocupados (público) |
| GET | `/api/agendamentos` | exige login (admin: todos; cliente: só os dele) |
| POST | `/api/agendamentos` | cria agendamento (logado ou visitante) |
| POST | `/api/agendamentos/:id/cancelar` | cancela (marca como cancelado e libera o horário) — dono ou admin |
| GET | `/api/agendamentos/:id/pix` | dados do PIX — só o dono (ou admin) |
| GET | `/api/agendamentos/:id/status` | status do agendamento — só o dono (ou admin) |
| POST | `/api/agendamentos/:id/pagar` | confirmação manual (só admin quando há gateway) |
| POST | `/api/webhooks/mercadopago` | notificação do Mercado Pago |
| DELETE | `/api/agendamentos/:id` | exclui (somente admin) |
| GET | `/api/usuarios` | lista usuários (somente admin) |

## Segurança
- Senhas com **bcrypt**; autenticação por **JWT** com expiração.
- **Helmet** (headers/CSP) + **rate limit** em login, cadastro, reserva e webhook.
- Rotas sensíveis exigem token; cliente só vê os próprios agendamentos.
- **Servidor é a fonte da verdade**: o total e o nome do barbeiro são
  recalculados a partir do banco, nunca aceitos do navegador.
- **Datas passadas** são recusadas (fuso `America/Sao_Paulo`).
- **Anti-duplicidade de horário**: checagem no servidor + índice único no banco.
- **Pagamento**: com Mercado Pago ativo, só o **webhook** confirma — o cliente
  não consegue se auto-liberar. Recursos de pagamento (`/pix`, `/status`)
  só são acessíveis pelo dono do agendamento (ou admin).
- **Sessão expirada** derruba o login na interface (tratamento de 401).
- **Anti-XSS** no frontend (`esc()`) + CSP restritiva.
- **SQL Injection**: todas as consultas são parametrizadas (`$1, $2`).
- O endpoint público `/ocupados` devolve apenas horários — nenhum dado pessoal.
- O acesso ao painel admin aparece na interface **apenas** com sessão de admin.

## Admin
- E-mail: definido pela variável **`ADMIN_EMAIL`** (nenhum valor fica no código).
- Senha: definida por **`ADMIN_SENHA`** (guardada como hash bcrypt no banco).

> Para trocar a senha: altere `ADMIN_SENHA` nas variáveis de ambiente e
> reinicie o serviço. O `seedAdmin()` sincroniza o hash automaticamente.
> **Nunca** comite credenciais no repositório.