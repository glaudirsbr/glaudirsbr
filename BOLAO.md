# 🇧🇷 Bolão do Brasil — Copa 2026

Aplicativo web para registro de palpites de placares dos jogos do Brasil na
fase de grupos da Copa do Mundo 2026, **com persistência compartilhada** —
todos que acessam o mesmo servidor veem os **mesmos palpites**.

## Diferença para a versão original

A versão original guardava os palpites em **IndexedDB** (cada aparelho via
apenas os seus). Esta versão usa um **servidor Node** com banco compartilhado.

## Persistência (dois modos, escolhidos automaticamente)

O servidor decide onde salvar conforme as variáveis de ambiente:

| Quando… | Usa… | Uso típico |
|---|---|---|
| `SUPABASE_URL` **e** `SUPABASE_SERVICE_KEY` definidas | **Supabase** (Postgres) | Produção / acesso pelo celular |
| caso contrário | **SQLite** (arquivo `bolao.db`) | Rodar no seu PC |

Assim você desenvolve localmente com SQLite (sem precisar de nada externo) e,
ao hospedar, aponta para o Supabase só definindo as duas variáveis.

## Stack

- **Back-end:** Node.js puro, **sem dependências externas** — só módulos
  nativos (`node:http`, `node:sqlite`, `fetch`).
- **Banco:** SQLite local (`node:sqlite`, Node ≥ 22.5) **ou** Supabase/Postgres
  via API REST (PostgREST).
- **Front-end:** HTML + CSS + JavaScript puro (`public/index.html`).

## Rodar localmente (SQLite)

Requer Node.js **22.5 ou superior**.

```bash
npm start          # ou: node server.js
```

Abra <http://localhost:3000>. Os dados ficam em `bolao.db` na pasta do projeto.

Variáveis opcionais: `PORT` (padrão `3000`), `DB_PATH` (padrão `./bolao.db`).

---

## Hospedar de graça (Render + Supabase) — para usar no celular

A combinação **Render (plano free) + Supabase (plano free)** deixa o app no ar
com um link público, sem custo. O Render pode hospedar de graça porque os
dados não ficam nele (disco efêmero) e sim no Supabase.

### Parte 1 — Criar o banco no Supabase

1. Crie uma conta em <https://supabase.com> e um **novo projeto** (free).
2. Abra **SQL Editor → New query**, cole o conteúdo de
   [`supabase-schema.sql`](./supabase-schema.sql) e clique em **Run**.
3. Em **Project Settings → API**, anote dois valores:
   - **Project URL** → vira `SUPABASE_URL` (ex.: `https://xxxx.supabase.co`)
   - **service_role** (em *Project API keys*) → vira `SUPABASE_SERVICE_KEY`

> ⚠️ A chave **service_role** é secreta e dá acesso total ao banco. Ela fica
> **só no servidor** (variável de ambiente) e nunca aparece no navegador.

### Parte 2 — Publicar no Render

1. Crie uma conta em <https://render.com> (pode entrar com o GitHub).
2. **New → Blueprint** e selecione este repositório. O Render lê o
   `render.yaml` automaticamente.
3. Quando pedir as variáveis de ambiente, preencha:
   - `SUPABASE_URL` = a Project URL do passo anterior
   - `SUPABASE_SERVICE_KEY` = a chave service_role
4. Confirme e aguarde o build. No fim, você recebe um link público
   `https://....onrender.com` — abra no celular. Pronto. 🎉

> **Observação (plano free do Render):** o serviço "dorme" após ~15 min sem
> uso e leva ~30–60s para acordar no primeiro acesso seguinte. Os palpites
> **não** se perdem, pois estão no Supabase.

---

## Estrutura

```
server.js               Servidor HTTP + API REST + seleção do armazenamento
lib/store-sqlite.js     Implementação SQLite (local)
lib/store-supabase.js   Implementação Supabase/Postgres (REST)
lib/util.js             Utilidades (data/hora BR)
public/index.html       Front-end single-page (UI + chamadas à API)
supabase-schema.sql     Script para criar as tabelas no Supabase
render.yaml             Blueprint de deploy no Render
bolao.db                Banco SQLite local (criado automaticamente, fora do git)
```

## Modelo de dados

Tabelas equivalentes nos dois bancos (`palpites` 1—N `placares`, com
`ON DELETE CASCADE`). Veja `supabase-schema.sql` para o Postgres.

A API monta cada registro neste formato JSON (igual ao da versão original):

```json
{
  "id": 1,
  "nome": "João da Silva",
  "palpites": [
    { "jogo": "Bra×Mar", "casa": 2, "fora": 1 },
    { "jogo": "Bra×Hai", "casa": 3, "fora": 0 },
    { "jogo": "Bra×Esc", "casa": 1, "fora": 1 }
  ],
  "quando": "19/06/2026 14:32"
}
```

## API REST

| Método   | Rota                 | Descrição                          |
|----------|----------------------|------------------------------------|
| `GET`    | `/api/palpites`      | Lista todos (mais recente primeiro)|
| `POST`   | `/api/palpites`      | Cria um palpite                    |
| `DELETE` | `/api/palpites/:id`  | Remove um palpite                  |
| `DELETE` | `/api/palpites`      | Apaga todos os palpites            |

### Exemplo de criação

```bash
curl -X POST http://localhost:3000/api/palpites \
  -H "Content-Type: application/json" \
  -d '{"nome":"João","palpites":[{"jogo":"Bra×Mar","casa":2,"fora":1}]}'
```

## Configurar os jogos

Edite o array `JOGOS` no topo do `<script>` em `public/index.html`:

```js
const JOGOS = [
  { id: "j1", casa: "Brasil", fora: "Marrocos", data: "13/jun · 19h" },
  { id: "j2", casa: "Brasil", fora: "Haiti",    data: "19/jun" },
  { id: "j3", casa: "Brasil", fora: "Escócia",  data: "24/jun" },
];
```

## Funcionalidades

- Cadastro de palpites por pessoa (nome + placar de cada jogo).
- Validação no front-end **e** no servidor (nome obrigatório, placares 0–99).
- Listagem dos palpites salvos, do mais recente para o mais antigo.
- Remoção individual com confirmação em 2 toques.
- Apagar todos os palpites (com `confirm()`).
- Exportar via `navigator.share` (mobile) com fallback para `clipboard`.
- Contador de palpites, toast de feedback e layout responsivo (tema Brasil).
- Escape de HTML no front-end para evitar injeção.
