-- ================================================================
-- 랜덤 산책 미션 생성기 — Supabase 초기 설정 SQL
-- Supabase 대시보드 > SQL Editor 에서 실행하세요
-- ================================================================

-- 1. 사용자 테이블
create table if not exists walk_users (
  id         uuid default gen_random_uuid() primary key,
  nickname   text unique not null,
  pin_hash   text not null,
  total_km   numeric(10,3) default 0,
  created_at timestamptz default now()
);

-- 2. 산책 기록 테이블
create table if not exists walk_records (
  id                 uuid default gen_random_uuid() primary key,
  user_id            uuid references walk_users(id) on delete cascade,
  nickname           text,
  distance_km        numeric(10,3),
  duration_seconds   integer,
  missions_completed integer,
  missions_total     integer,
  mode               text,   -- 'solo' | 'group'
  created_at         timestamptz default now()
);

-- 3. RLS (Row Level Security) 활성화
alter table walk_users   enable row level security;
alter table walk_records enable row level security;

-- 4. anon 키로 전체 접근 허용 (PIN 기반 보안)
create policy "anon_full_users"   on walk_users   for all to anon using (true) with check (true);
create policy "anon_full_records" on walk_records for all to anon using (true) with check (true);

-- 5. 성능을 위한 인덱스
create index if not exists idx_walk_records_user_id   on walk_records(user_id);
create index if not exists idx_walk_records_created_at on walk_records(created_at desc);
create index if not exists idx_walk_users_nickname     on walk_users(nickname);
