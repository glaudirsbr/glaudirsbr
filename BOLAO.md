# 🇧🇷 Bolão do Brasil — Copa 2026

Aplicativo web para registro de palpites de placares dos jogos do Brasil na
fase de grupos da Copa do Mundo 2026, **com persistência compartilhada em SQLite**.

## Diferença para a versão original

A versão original guardava os palpites em **IndexedDB** (cada aparelho via apenas
os seus). Esta versão usa um **servidor Node + banco SQLite**, então todos os
participantes que acessam o mesmo servidor veem os **mesmos palpites**.

## Stack

- **Back-end:** Node.js puro, **sem dependências externas** — usa apenas módulos
  nativos (`node:http`, `node:sqlite`, `node:fs`).
- **Banco:** SQLite (arquivo `bolao.db`), via `node:sqlite` (Node ≥ 22.5).
- **Front-end:** HTML + CSS + JavaScript puro (`public/index.html`).

## Como rodar

Requer Node.js **22.5 ou superior** (o módulo `node:sqlite` é nativo).

```bash
npm start
# ou
node server.js
```

Depois abra <http://localhost:3000>.

Variáveis de ambiente opcionais:

| Variável  | Padrão        | Descrição                      |
|-----------|---------------|--------------------------------|
| `PORT`    | `3000`        | Porta do servidor              |
| `DB_PATH` | `./bolao.db`  | Caminho do arquivo SQLite      |

## Estrutura

```
server.js           Servidor HTTP + API REST + camada SQLite
public/index.html   Front-end single-page (UI + chamadas à API)
bolao.db            Banco SQLite (criado automaticamente, fora do git)
```

## Modelo de dados (SQLite)

```sql
CREATE TABLE palpites (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nome   TEXT NOT NULL,
  quando TEXT NOT NULL          -- "DD/MM/AAAA HH:MM" (fuso de Brasília)
);

CREATE TABLE placares (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  palpite_id INTEGER NOT NULL,  -- FK -> palpites.id (ON DELETE CASCADE)
  jogo       TEXT NOT NULL,     -- ex.: "Bra×Mar"
  casa       INTEGER NOT NULL,
  fora       INTEGER NOT NULL,
  ordem      INTEGER NOT NULL   -- ordem do jogo no palpite
);
```

A API monta cada registro no mesmo formato JSON da versão original:

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
