'use strict';

/**
 * Armazenamento em SQLite (arquivo local).
 *
 * Usado para rodar o app localmente sem depender de serviço externo.
 * Usa apenas o módulo nativo `node:sqlite` (Node >= 22.5).
 *
 * Interface exposta (assíncrona, igual à do store-supabase):
 *   listar(), criar(nome, placares), remover(id), removerTodos()
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { agoraBR } = require('./util');

function criarStore(dbPath) {
  // Garante que a pasta do banco exista (ex.: /var/data num host).
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

  const db = new DatabaseSync(dbPath);
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

  const stmtInsertPalpite = db.prepare('INSERT INTO palpites (nome, quando) VALUES (?, ?)');
  const stmtInsertPlacar = db.prepare(
    'INSERT INTO placares (palpite_id, jogo, casa, fora, ordem) VALUES (?, ?, ?, ?, ?)'
  );
  const stmtListPalpites = db.prepare('SELECT id, nome, quando FROM palpites ORDER BY id DESC');
  const stmtPlacaresDe = db.prepare(
    'SELECT jogo, casa, fora FROM placares WHERE palpite_id = ? ORDER BY ordem ASC'
  );
  const stmtGetPalpite = db.prepare('SELECT id, nome, quando FROM palpites WHERE id = ?');
  const stmtDeletePalpite = db.prepare('DELETE FROM palpites WHERE id = ?');
  const stmtDeleteTudo = db.prepare('DELETE FROM palpites');

  function montarRegistro(palpite) {
    const placares = stmtPlacaresDe.all(palpite.id).map((p) => ({
      jogo: p.jogo,
      casa: p.casa,
      fora: p.fora,
    }));
    return { id: palpite.id, nome: palpite.nome, palpites: placares, quando: palpite.quando };
  }

  return {
    nome: 'SQLite (' + dbPath + ')',

    async listar() {
      return stmtListPalpites.all().map(montarRegistro);
    },

    async criar(nome, placares) {
      const quando = agoraBR();
      db.prepare('BEGIN').run();
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
    },

    async remover(id) {
      return stmtDeletePalpite.run(id).changes > 0;
    },

    async removerTodos() {
      stmtDeleteTudo.run();
    },

    fechar() {
      db.close();
    },
  };
}

module.exports = { criarStore };
