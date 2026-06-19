'use strict';

/**
 * Bolão do Brasil — Copa 2026
 * Servidor HTTP mínimo, sem dependências externas (só módulos nativos do Node).
 *
 * - Serve o front-end (public/index.html).
 * - Expõe uma API REST com os palpites.
 * - Persistência plugável:
 *     • Supabase (Postgres) — se SUPABASE_URL e SUPABASE_SERVICE_KEY existirem.
 *     • SQLite (arquivo local) — caso contrário (ideal para rodar no PC).
 *
 * Formato de registro (mesmo nas duas camadas):
 *   { id, nome, palpites: [{ jogo, casa, fora }], quando }
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ----------------------------------------------------------------------------
// Seleção do armazenamento
// ----------------------------------------------------------------------------

let store;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  store = require('./lib/store-supabase').criarStore(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
} else {
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'bolao.db');
  store = require('./lib/store-sqlite').criarStore(dbPath);
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
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
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
    enviarJSON(res, 200, await store.listar());
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
    const registro = await store.criar(body.nome, body.palpites);
    enviarJSON(res, 201, registro);
    return;
  }

  // DELETE /api/palpites -> apaga todos
  if (url === '/api/palpites' && req.method === 'DELETE') {
    await store.removerTodos();
    enviarJSON(res, 200, { ok: true });
    return;
  }

  // DELETE /api/palpites/:id -> apaga um
  const m = url.match(/^\/api\/palpites\/(\d+)$/);
  if (m && req.method === 'DELETE') {
    const ok = await store.remover(Number(m[1]));
    if (!ok) {
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
  console.log(`   Armazenamento: ${store.nome}`);
});

// Encerramento limpo
function encerrar() {
  console.log('\nEncerrando...');
  server.close(() => {
    store.fechar();
    process.exit(0);
  });
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
