'use strict';

/**
 * Bolão do Brasil — Copa 2026
 * Servidor HTTP mínimo, sem dependências externas.
 *
 * - Usa apenas módulos nativos do Node (node:http, node:sqlite, node:fs, node:path).
 * - Serve o front-end (public/index.html).
 * - Expõe uma API REST com os palpites persistidos em SQLite.
 *
 * Mantém o mesmo formato de registro descrito na documentação, para que o
 * front-end troque apenas a camada "Banco" (IndexedDB -> API/SQLite).
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'bolao.db');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ----------------------------------------------------------------------------
// Banco de dados
// ----------------------------------------------------------------------------

// Garante que a pasta do banco exista (ex.: /var/data num host como o Render).
fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS palpites (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    nome   TEXT NOT NULL,
    quando TEXT NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS placares (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    palpite_id INTEGER NOT NULL,
    jogo       TEXT NOT NULL,
    casa       INTEGER NOT NULL,
    fora       INTEGER NOT NULL,
    ordem      INTEGER NOT NULL,
    FOREIGN KEY (palpite_id) REFERENCES palpites(id) ON DELETE CASCADE
  );
`);

// Statements reutilizáveis
const stmtInsertPalpite = db.prepare(
  'INSERT INTO palpites (nome, quando) VALUES (?, ?)'
);
const stmtInsertPlacar = db.prepare(
  'INSERT INTO placares (palpite_id, jogo, casa, fora, ordem) VALUES (?, ?, ?, ?, ?)'
);
const stmtListPalpites = db.prepare(
  'SELECT id, nome, quando FROM palpites ORDER BY id DESC'
);
const stmtPlacaresDe = db.prepare(
  'SELECT jogo, casa, fora FROM placares WHERE palpite_id = ? ORDER BY ordem ASC'
);
const stmtGetPalpite = db.prepare(
  'SELECT id, nome, quando FROM palpites WHERE id = ?'
);
const stmtDeletePalpite = db.prepare('DELETE FROM palpites WHERE id = ?');
const stmtDeleteTudo = db.prepare('DELETE FROM palpites');

/** Monta o registro completo (com placares) no formato documentado. */
function montarRegistro(palpite) {
  const placares = stmtPlacaresDe.all(palpite.id).map((p) => ({
    jogo: p.jogo,
    casa: p.casa,
    fora: p.fora,
  }));
  return {
    id: palpite.id,
    nome: palpite.nome,
    palpites: placares,
    quando: palpite.quando,
  };
}

function lerTodos() {
  return stmtListPalpites.all().map(montarRegistro);
}

/** Data/hora atual no formato "DD/MM/AAAA HH:MM" (fuso de Brasília). */
function agoraBR() {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

/** Insere um palpite + seus placares dentro de uma transação. */
function salvarPalpite(nome, placares) {
  const quando = agoraBR();
  const tx = db.prepare('BEGIN');
  tx.run();
  try {
    const info = stmtInsertPalpite.run(nome, quando);
    const palpiteId = info.lastInsertRowid;
    placares.forEach((p, i) => {
      stmtInsertPlacar.run(palpiteId, p.jogo, p.casa, p.fora, i);
    });
    db.prepare('COMMIT').run();
    return montarRegistro(stmtGetPalpite.get(palpiteId));
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
}

// ----------------------------------------------------------------------------
// Helpers HTTP
// ----------------------------------------------------------------------------

function enviarJSON(res, status, dados) {
  const body = JSON.stringify(dados);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tamanho = 0;
    req.on('data', (chunk) => {
      tamanho += chunk.length;
      if (tamanho > 1_000_000) {
        reject(new Error('Corpo da requisição muito grande'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve(null);
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

/** Valida e normaliza o payload de um novo palpite. */
function validarPalpite(body) {
  if (!body || typeof body !== 'object') return 'Dados ausentes.';
  const nome = typeof body.nome === 'string' ? body.nome.trim() : '';
  if (!nome) return 'Informe um nome.';
  if (nome.length > 80) return 'Nome muito longo.';
  if (!Array.isArray(body.palpites) || body.palpites.length === 0) {
    return 'Nenhum placar enviado.';
  }
  for (const p of body.palpites) {
    if (!p || typeof p.jogo !== 'string' || !p.jogo.trim()) {
      return 'Jogo inválido.';
    }
    const casa = Number(p.casa);
    const fora = Number(p.fora);
    if (!Number.isInteger(casa) || !Number.isInteger(fora)) {
      return 'Preencha todos os placares.';
    }
    if (casa < 0 || fora < 0 || casa > 99 || fora > 99) {
      return 'Placar fora do intervalo permitido.';
    }
    p.jogo = p.jogo.trim().slice(0, 60);
    p.casa = casa;
    p.fora = fora;
  }
  body.nome = nome;
  return null;
}

// ----------------------------------------------------------------------------
// Arquivos estáticos
// ----------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function servirEstatico(req, res) {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';

  // Resolve dentro de PUBLIC_DIR e bloqueia path traversal.
  const alvo = path.join(PUBLIC_DIR, path.normalize(url));
  if (!alvo.startsWith(PUBLIC_DIR)) {
    enviarJSON(res, 403, { erro: 'Acesso negado.' });
    return;
  }

  fs.readFile(alvo, (err, conteudo) => {
    if (err) {
      enviarJSON(res, 404, { erro: 'Não encontrado.' });
      return;
    }
    const ext = path.extname(alvo).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
    });
    res.end(conteudo);
  });
}

// ----------------------------------------------------------------------------
// Rotas da API
// ----------------------------------------------------------------------------

async function tratarApi(req, res) {
  const url = req.url.split('?')[0];

  // GET /api/palpites -> lista todos (mais recente primeiro)
  if (url === '/api/palpites' && req.method === 'GET') {
    enviarJSON(res, 200, lerTodos());
    return;
  }

  // POST /api/palpites -> cria um palpite
  if (url === '/api/palpites' && req.method === 'POST') {
    let body;
    try {
      body = await lerCorpo(req);
    } catch (e) {
      enviarJSON(res, 400, { erro: e.message });
      return;
    }
    const erro = validarPalpite(body);
    if (erro) {
      enviarJSON(res, 400, { erro });
      return;
    }
    const registro = salvarPalpite(body.nome, body.palpites);
    enviarJSON(res, 201, registro);
    return;
  }

  // DELETE /api/palpites -> apaga todos
  if (url === '/api/palpites' && req.method === 'DELETE') {
    stmtDeleteTudo.run();
    enviarJSON(res, 200, { ok: true });
    return;
  }

  // DELETE /api/palpites/:id -> apaga um
  const m = url.match(/^\/api\/palpites\/(\d+)$/);
  if (m && req.method === 'DELETE') {
    const id = Number(m[1]);
    const info = stmtDeletePalpite.run(id);
    if (info.changes === 0) {
      enviarJSON(res, 404, { erro: 'Palpite não encontrado.' });
      return;
    }
    enviarJSON(res, 200, { ok: true });
    return;
  }

  enviarJSON(res, 404, { erro: 'Rota não encontrada.' });
}

// ----------------------------------------------------------------------------
// Servidor
// ----------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    tratarApi(req, res).catch((err) => {
      console.error(err);
      enviarJSON(res, 500, { erro: 'Erro interno do servidor.' });
    });
    return;
  }
  servirEstatico(req, res);
});

server.listen(PORT, () => {
  console.log(`🇧🇷 Bolão do Brasil rodando em http://localhost:${PORT}`);
  console.log(`   Banco SQLite: ${DB_PATH}`);
});

// Encerramento limpo
function encerrar() {
  console.log('\nEncerrando...');
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
