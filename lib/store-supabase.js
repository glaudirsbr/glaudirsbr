'use strict';

/**
 * Armazenamento no Supabase (Postgres) via API REST (PostgREST).
 *
 * Não usa nenhuma dependência: fala com o Supabase pelo `fetch` nativo.
 * A chave de serviço (service_role) fica só no servidor, via variável de
 * ambiente, e nunca é exposta ao navegador.
 *
 * Tabelas esperadas (criar uma vez no SQL Editor do Supabase — ver BOLAO.md):
 *   palpites(id, nome, quando)
 *   placares(id, palpite_id -> palpites.id ON DELETE CASCADE, jogo, casa, fora, ordem)
 *
 * Interface exposta (igual à do store-sqlite):
 *   listar(), criar(nome, placares), remover(id), removerTodos()
 */

const { agoraBR } = require('./util');

function criarStore(url, serviceKey) {
  const base = url.replace(/\/+$/, '') + '/rest/v1';
  const headers = {
    apikey: serviceKey,
    Authorization: 'Bearer ' + serviceKey,
    'Content-Type': 'application/json',
  };

  async function req(metodo, caminho, { body, prefer } = {}) {
    const res = await fetch(base + caminho, {
      method: metodo,
      headers: prefer ? { ...headers, Prefer: prefer } : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Supabase ${res.status}: ${txt || res.statusText}`);
    }
    if (res.status === 204) return null;
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }

  return {
    nome: 'Supabase (' + url + ')',

    async listar() {
      const rows = await req(
        'GET',
        '/palpites?select=id,nome,quando,placares(jogo,casa,fora,ordem)&order=id.desc'
      );
      return (rows || []).map((r) => ({
        id: r.id,
        nome: r.nome,
        quando: r.quando,
        palpites: (r.placares || [])
          .slice()
          .sort((a, b) => a.ordem - b.ordem)
          .map((p) => ({ jogo: p.jogo, casa: p.casa, fora: p.fora })),
      }));
    },

    async criar(nome, placares) {
      const quando = agoraBR();
      const criado = await req('POST', '/palpites', {
        body: { nome, quando },
        prefer: 'return=representation',
      });
      const palpite = criado[0];

      if (placares.length) {
        const linhas = placares.map((p, i) => ({
          palpite_id: palpite.id,
          jogo: p.jogo,
          casa: p.casa,
          fora: p.fora,
          ordem: i,
        }));
        await req('POST', '/placares', { body: linhas, prefer: 'return=minimal' });
      }

      return {
        id: palpite.id,
        nome: palpite.nome,
        palpites: placares.map((p) => ({ jogo: p.jogo, casa: p.casa, fora: p.fora })),
        quando: palpite.quando,
      };
    },

    async remover(id) {
      const apagados = await req('DELETE', `/palpites?id=eq.${encodeURIComponent(id)}`, {
        prefer: 'return=representation',
      });
      return Array.isArray(apagados) && apagados.length > 0;
    },

    async removerTodos() {
      // PostgREST exige um filtro no DELETE; id>=0 cobre todas as linhas.
      await req('DELETE', '/palpites?id=gte.0', { prefer: 'return=minimal' });
    },

    fechar() {},
  };
}

module.exports = { criarStore };
