-- ============================================================
-- DMOZ Q&A — Supabase Veritabanı Kurulum Scripti (TEK PARÇA)
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp
-- tek seferde "Run" ile çalıştırabilirsiniz.
-- ============================================================

-- 0) Gerekli eklenti (şifre hashleme için)
create extension if not exists pgcrypto;

-- ============================================================
-- 1) TABLOLAR
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  email text,
  full_name text,
  avatar_url text default 'https://api.dicebear.com/7.x/initials/svg?seed=U',
  role text not null default 'user' check (role in ('user','moderator','admin')),
  banned boolean not null default false,
  verified boolean not null default true,
  city text,
  zodiac text,
  profession text,
  bio text,
  social_twitter text,
  social_instagram text,
  social_website text,
  last_seen timestamptz default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id bigserial primary key,
  name text not null,
  slug text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id bigserial primary key,
  title text not null,
  content text not null,
  category text references public.categories(slug) on update cascade,
  tags text,
  author text,
  author_id uuid references public.profiles(id) on delete set null,
  votes integer not null default 0,
  answer_count integer not null default 0,
  views integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.answers (
  id bigserial primary key,
  question_id bigint references public.questions(id) on delete cascade,
  content text not null,
  author text,
  author_id uuid references public.profiles(id) on delete set null,
  votes integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.likes (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  question_id bigint references public.questions(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, question_id)
);

create table if not exists public.messages (
  id bigserial primary key,
  sender_id uuid references public.profiles(id) on delete cascade,
  receiver_id uuid references public.profiles(id) on delete cascade,
  content text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  type text,
  content text,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_questions_category on public.questions(category);
create index if not exists idx_questions_created on public.questions(created_at desc);
create index if not exists idx_answers_question on public.answers(question_id);
create index if not exists idx_messages_participants on public.messages(sender_id, receiver_id);
create index if not exists idx_notifications_user on public.notifications(user_id);

-- ============================================================
-- 2) RPC FONKSİYONLARI (frontend bunları çağırıyor)
-- ============================================================

create or replace function public.increment_view_count(q_id bigint)
returns void language sql security definer as $$
  update public.questions set views = coalesce(views,0) + 1 where id = q_id;
$$;

create or replace function public.increment_answer_count(q_id bigint)
returns void language sql security definer as $$
  update public.questions set answer_count = coalesce(answer_count,0) + 1 where id = q_id;
$$;

-- ============================================================
-- 3) YENİ KULLANICI KAYDINDA OTOMATİK PROFİL OLUŞTURMA
-- ============================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, username, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'username'),
    'https://api.dicebear.com/7.x/initials/svg?seed=' || coalesce(new.raw_user_meta_data->>'username', new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 4) ROW LEVEL SECURITY (RLS)
-- ============================================================

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.questions enable row level security;
alter table public.answers enable row level security;
alter table public.likes enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;

-- Mevcut kullanıcının admin/moderatör olup olmadığını kontrol eden yardımcı fonksiyon
create or replace function public.is_staff()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin','moderator')
  );
$$;

-- PROFILES
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles for select using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id or public.is_staff());

-- CATEGORIES
drop policy if exists "categories_select_all" on public.categories;
create policy "categories_select_all" on public.categories for select using (true);

drop policy if exists "categories_insert_staff" on public.categories;
create policy "categories_insert_staff" on public.categories for insert with check (public.is_staff());

drop policy if exists "categories_update_staff" on public.categories;
create policy "categories_update_staff" on public.categories for update using (public.is_staff());

drop policy if exists "categories_delete_staff" on public.categories;
create policy "categories_delete_staff" on public.categories for delete using (public.is_staff());

-- QUESTIONS
drop policy if exists "questions_select_all" on public.questions;
create policy "questions_select_all" on public.questions for select using (true);

drop policy if exists "questions_insert_auth" on public.questions;
create policy "questions_insert_auth" on public.questions for insert with check (auth.uid() = author_id);

drop policy if exists "questions_update_owner_or_staff" on public.questions;
create policy "questions_update_owner_or_staff" on public.questions for update using (auth.uid() = author_id or public.is_staff());

drop policy if exists "questions_delete_owner_or_staff" on public.questions;
create policy "questions_delete_owner_or_staff" on public.questions for delete using (auth.uid() = author_id or public.is_staff());

-- ANSWERS
drop policy if exists "answers_select_all" on public.answers;
create policy "answers_select_all" on public.answers for select using (true);

drop policy if exists "answers_insert_auth" on public.answers;
create policy "answers_insert_auth" on public.answers for insert with check (auth.uid() = author_id);

drop policy if exists "answers_update_owner_or_staff" on public.answers;
create policy "answers_update_owner_or_staff" on public.answers for update using (auth.uid() = author_id or public.is_staff());

drop policy if exists "answers_delete_owner_or_staff" on public.answers;
create policy "answers_delete_owner_or_staff" on public.answers for delete using (auth.uid() = author_id or public.is_staff());

-- LIKES
drop policy if exists "likes_select_all" on public.likes;
create policy "likes_select_all" on public.likes for select using (true);

drop policy if exists "likes_insert_own" on public.likes;
create policy "likes_insert_own" on public.likes for insert with check (auth.uid() = user_id);

drop policy if exists "likes_delete_own" on public.likes;
create policy "likes_delete_own" on public.likes for delete using (auth.uid() = user_id);

-- MESSAGES (sadece gönderen/alıcı görebilir)
drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant" on public.messages for select using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own" on public.messages for insert with check (auth.uid() = sender_id);

-- NOTIFICATIONS
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications for select using (auth.uid() = user_id);

drop policy if exists "notifications_insert_any_auth" on public.notifications;
create policy "notifications_insert_any_auth" on public.notifications for insert with check (auth.uid() is not null);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications for update using (auth.uid() = user_id);

-- ============================================================
-- 5) STORAGE: AVATAR BUCKET
-- ============================================================

insert into storage.buckets (id, name, public)
values ('avatars','avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatar_public_read" on storage.objects;
create policy "avatar_public_read" on storage.objects for select using (bucket_id = 'avatars');

drop policy if exists "avatar_upload_auth" on storage.objects;
create policy "avatar_upload_auth" on storage.objects for insert with check (bucket_id = 'avatars' and auth.uid() is not null);

drop policy if exists "avatar_update_auth" on storage.objects;
create policy "avatar_update_auth" on storage.objects for update using (bucket_id = 'avatars' and auth.uid() is not null);

-- ============================================================
-- 6) VARSAYILAN KATEGORİLER
-- ============================================================

insert into public.categories (name, slug) values
  ('Yazılım','yazilim'),
  ('Donanım','donanim'),
  ('Yapay Zeka','yapay-zeka'),
  ('Kariyer','kariyer'),
  ('Genel','genel')
on conflict (slug) do nothing;

-- ============================================================
-- 7) ADMIN KULLANICI OLUŞTURMA — Hamdi
--    e-posta : hamdiuludag@yandex.com
--    şifre   : Arif1978
-- ============================================================

do $$
declare
  new_user_id uuid := gen_random_uuid();
  existing_id uuid;
begin
  select id into existing_id from auth.users where email = 'hamdiuludag@yandex.com';

  if existing_id is null then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      new_user_id, 'authenticated', 'authenticated',
      'hamdiuludag@yandex.com',
      crypt('Arif1978', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"username":"Hamdi","full_name":"Hamdi"}',
      now(), now(), '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), new_user_id, new_user_id::text,
      jsonb_build_object('sub', new_user_id::text, 'email', 'hamdiuludag@yandex.com'),
      'email', now(), now(), now()
    );

    -- handle_new_user trigger'ı profili otomatik oluşturur; rolünü admin yapıyoruz
    update public.profiles
       set role = 'admin', verified = true, username = 'Hamdi', full_name = 'Hamdi'
     where id = new_user_id;
  else
    update public.profiles
       set role = 'admin', verified = true
     where id = existing_id;
  end if;
end $$;

-- ============================================================
-- 8) GÜVENLİK: rol/yasak alanlarını sadece admin değiştirebilsin
--    (Bu trigger admin oluşturulduktan SONRA ekleniyor, böylece
--     yukarıdaki seed adımı bloklanmıyor.)
-- ============================================================

create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer as $$
begin
  if not public.is_staff() then
    new.role := old.role;
    new.banned := old.banned;
    new.verified := old.verified;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_fields_trigger on public.profiles;
create trigger protect_profile_fields_trigger
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- ============================================================
-- TAMAMLANDI
-- ============================================================
-- Giriş bilgileri:
--   Kullanıcı adı / E-posta : Hamdi / hamdiuludag@yandex.com
--   Şifre                   : Arif1978
--   Rol                     : admin
-- ============================================================
