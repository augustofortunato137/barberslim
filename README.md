# BarberSlim — Sistema de Agendamento para Barbearia

Aplicação web completa (frontend + backend Node/Express + PostgreSQL) para uma
barbearia agendar horários online: escolha do barbeiro, serviços, data/hora,
forma de pagamento (PIX ou dinheiro) e painel administrativo.

## Demonstração online
- **Site/API (Railway):** https://barberslim-production.up.railway.app

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
| DELETE | `/api/agendamentos/:id` | exclui (somente admin) |
| GET | `/api/usuarios` | lista usuários (somente admin) |

## Segurança
- Senhas com **bcrypt**; autenticação por **JWT** com expiração.
- **Helmet** (headers/CSP) + **rate limit** no login/cadastro.
- Rotas sensíveis exigem token; cliente só vê os próprios agendamentos.
- **Anti-duplicidade de horário**: checagem no servidor + índice único no banco.
- **Anti-XSS** no frontend (`esc()`).
- Não há dados pessoais no endpoint público `/ocupados`.

## Admin padrão
- E-mail: (definido por `ADMIN_EMAIL`, padrão `admin@barberslim.com`)
- Senha: (definida por `ADMIN_SENHA`, padrão `TCC2026`)
> Mude a senha pelo `ADMIN_SENHA` no ambiente de produção.