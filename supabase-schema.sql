-- 🇧🇷 Bolão do Brasil — esquema do banco no Supabase (Postgres)
--
-- Rode este script UMA VEZ no Supabase:
--   Painel do projeto -> SQL Editor -> New query -> cole tudo -> Run.

create table if not exists palpites (
  id     bigint generated always as identity primary key,
  nome   text not null,
  quando text not null
);

create table if not exists placares (
  id         bigint generated always as identity primary key,
  palpite_id bigint not null references palpites (id) on delete cascade,
  jogo       text not null,
  casa       int not null,
  fora       int not null,
  ordem      int not null
);

create index if not exists placares_palpite_id_idx on placares (palpite_id);

-- Segurança: liga o RLS e NÃO cria políticas públicas.
-- Assim a chave anônima não acessa as tabelas; só o servidor, que usa a
-- chave service_role (que ignora o RLS), consegue ler/escrever.
alter table palpites enable row level security;
alter table placares enable row level security;
