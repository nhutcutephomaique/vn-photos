-- =============================================================================
-- vn/photos — schema khởi tạo
-- Chạy trong Supabase SQL Editor, hoặc `supabase db push`.
--
-- Mô hình sản phẩm:
--   • Mỗi tài khoản chỉ có ĐÚNG 1 ảnh đang sống (pending / review / approved).
--   • Ảnh càng nhiều tym càng to ra (xem public.register_heart).
--   • Người dùng xoá ảnh được, xoá xong coi như làm lại từ đầu.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Trạng thái kiểm duyệt
-- ---------------------------------------------------------------------------
do $$
begin
  create type public.photo_status as enum ('pending', 'approved', 'review', 'rejected');
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Bảng photos
--    x, y là TÂM ảnh trong hệ toạ độ bàn cờ (đơn vị: px world).
--    Ảnh to dần quanh tâm khi được thả tym:
--      base_w/base_h = kích thước gốc, w/h = kích thước hiện tại.
-- ---------------------------------------------------------------------------
create table if not exists public.photos (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid references auth.users (id) on delete set null,
  storage_path  text not null,
  status        public.photo_status not null default 'pending',
  x             integer not null check (x >= 0),
  y             integer not null check (y >= 0),
  base_w        integer not null check (base_w > 0 and base_w <= 512),
  base_h        integer not null check (base_h > 0 and base_h <= 512),
  w             integer not null check (w > 0 and w <= 768),
  h             integer not null check (h > 0 and h <= 768),
  heart_count   integer not null default 0 check (heart_count >= 0),
  img_w         integer,
  img_h         integer,
  caption       text check (char_length(caption) <= 140),
  -- dHash 16×16 = 256 bit; NULL khi chưa xử lý ảnh.
  dhash         bit(256),
  -- Màu trung bình RGB 24-bit, dùng kèm dhash khi so trùng.
  color         integer,
  sexual_score  real,
  moderation    jsonb,
  reject_reason text,
  report_count  integer not null default 0,
  created_at    timestamptz not null default now(),
  approved_at   timestamptz
);

create index if not exists photos_visible_bbox_idx
  on public.photos (x, y) where status = 'approved';

create index if not exists photos_author_recent_idx
  on public.photos (author_id, created_at desc);

create index if not exists photos_queue_idx
  on public.photos (status, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Tym
--    Không unique (một người có thể thả nhiều tym cho cùng một ảnh),
--    nhưng bị giới hạn 20 tym/24h và 3 phút giữa hai lần.
-- ---------------------------------------------------------------------------
create table if not exists public.photo_hearts (
  id         bigserial primary key,
  photo_id   uuid not null references public.photos (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists photo_hearts_photo_idx on public.photo_hearts (photo_id);
create index if not exists photo_hearts_user_idx on public.photo_hearts (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Một tài khoản = một ảnh
--    Ảnh bị từ chối không chiếm chỗ (để người dùng thử lại), nhưng vẫn
--    giới hạn 10 lần upload/24h để tránh spam API kiểm duyệt.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_single_photo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  attempts_today int;
  max_attempts   constant int := 10;
begin
  if new.author_id is null then
    raise exception 'UPLOAD_REQUIRES_IDENTITY';
  end if;

  -- Khoá theo user để tránh race condition khi bắn nhiều request song song.
  perform pg_advisory_xact_lock(hashtext(new.author_id::text));

  if exists (
    select 1
    from public.photos
    where author_id = new.author_id
      and status in ('pending', 'review', 'approved')
  ) then
    raise exception 'PHOTO_ALREADY_EXISTS';
  end if;

  select count(*) into attempts_today
  from public.photos
  where author_id = new.author_id
    and created_at > now() - interval '24 hours';

  if attempts_today >= max_attempts then
    raise exception 'UPLOAD_ATTEMPTS_EXCEEDED';
  end if;

  return new;
end $$;

drop trigger if exists trg_enforce_upload_limits on public.photos;
drop trigger if exists trg_enforce_single_photo on public.photos;
create trigger trg_enforce_single_photo
  before insert on public.photos
  for each row execute function public.enforce_single_photo();

-- ---------------------------------------------------------------------------
-- 5. Thả tym: nguyên tử (atomic) — kiểm tra, ghi tym, tính lại kích thước.
--
--    Công thức phóng to được mirror ở src/lib/display.ts:
--      factor = min(1 + 0.22 * ln(1 + hearts), 2.4)
--
--    Chỉ gọi được bằng service_role (API route đã xác thực người dùng).
-- ---------------------------------------------------------------------------
create or replace function public.register_heart(p_photo_id uuid, p_user_id uuid)
returns table (heart_count int, w int, h int, hearts_left int, next_heart_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  photo        record;
  total        int;
  recent_count int;
  last_at      timestamptz;
  factor       numeric;
  new_w        int;
  new_h        int;
begin
  select id, author_id, status, base_w, base_h
    into photo
  from public.photos
  where id = p_photo_id
  for update;

  if not found then
    raise exception 'PHOTO_NOT_FOUND';
  end if;
  if photo.status <> 'approved' then
    raise exception 'PHOTO_NOT_APPROVED';
  end if;
  if photo.author_id = p_user_id then
    raise exception 'CANNOT_HEART_OWN_PHOTO';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  select max(created_at) into last_at
  from public.photo_hearts
  where user_id = p_user_id;

  if last_at is not null and last_at > now() - interval '3 minutes' then
    raise exception 'HEART_COOLDOWN';
  end if;

  select count(*) into recent_count
  from public.photo_hearts
  where user_id = p_user_id
    and created_at > now() - interval '24 hours';

  if recent_count >= 20 then
    raise exception 'HEART_QUOTA_EXCEEDED';
  end if;

  insert into public.photo_hearts (photo_id, user_id) values (p_photo_id, p_user_id);

  select count(*) into total from public.photo_hearts where photo_id = p_photo_id;

  factor := least(1 + 0.22 * ln(1 + total::numeric), 2.4);
  new_w  := greatest(1, round(photo.base_w * factor)::int);
  new_h  := greatest(1, round(photo.base_h * factor)::int);

  update public.photos
     set heart_count = total,
         w = new_w,
         h = new_h
   where id = p_photo_id;

  return query
    select total,
           new_w,
           new_h,
           greatest(0, 20 - (recent_count + 1)),
           now() + interval '3 minutes';
end $$;

revoke all on function public.register_heart(uuid, uuid) from public, anon, authenticated;
grant execute on function public.register_heart(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Danh sách hash ảnh bị cấm (chống up lại ảnh đã bị từ chối)
-- ---------------------------------------------------------------------------
create table if not exists public.blocked_hashes (
  id         uuid primary key default gen_random_uuid(),
  hash       bit(256) not null unique,
  color      integer not null default 0,
  reason     text not null default 'banned',
  created_at timestamptz not null default now()
);

-- Tìm hash gần giống (khoảng cách Hamming) — dùng cho ảnh bị crop/nén lại.
-- Nhận `text` (chuỗi 256 bit '0'/'1') để PostgREST gọi RPC không gặp lỗi cast.
-- Điều kiện `color` tránh false positive với ảnh đơn sắc (dhash của ảnh
-- một màu gần như luôn giống nhau).
create or replace function public.find_blocked_hash(
  p_hash text,
  p_max_distance int default 24,
  p_color int default null,
  p_color_tolerance int default 48
)
returns table (reason text, distance int)
language sql
stable
security definer
set search_path = public
as $$
  select b.reason, bit_count(b.hash # p_hash::bit(256)) as distance
  from public.blocked_hashes b
  where bit_count(b.hash # p_hash::bit(256)) <= p_max_distance
    and (
      p_color is null
      or abs(((b.color >> 16) & 255) - ((p_color >> 16) & 255))
       + abs(((b.color >> 8) & 255) - ((p_color >> 8) & 255))
       + abs((b.color & 255) - (p_color & 255)) <= p_color_tolerance
    )
  order by distance asc
  limit 1;
$$;

revoke all on function public.find_blocked_hash(text, int, int, int) from public, anon, authenticated;
grant execute on function public.find_blocked_hash(text, int, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Báo cáo ảnh
-- ---------------------------------------------------------------------------
create table if not exists public.photo_reports (
  id          bigserial primary key,
  photo_id    uuid not null references public.photos (id) on delete cascade,
  reporter_id uuid references auth.users (id) on delete set null,
  reason      text not null check (reason in ('sexual', 'violence', 'hate', 'spam', 'copyright', 'other')),
  note        text check (char_length(note) <= 500),
  created_at  timestamptz not null default now(),
  unique (photo_id, reporter_id)
);

create index if not exists photo_reports_photo_idx on public.photo_reports (photo_id);

-- Tự ẩn ảnh khi bị đủ 3 báo cáo khác nhau.
create or replace function public.on_photo_reported()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  update public.photos
     set report_count = report_count + 1
   where id = new.photo_id
  returning report_count into new_count;

  if new_count >= 3 then
    update public.photos
       set status = 'review',
           reject_reason = coalesce(reject_reason, 'auto-hidden: community reports')
     where id = new.photo_id
       and status = 'approved';
  end if;

  return new;
end $$;

drop trigger if exists trg_on_photo_reported on public.photo_reports;
create trigger trg_on_photo_reported
  after insert on public.photo_reports
  for each row execute function public.on_photo_reported();

-- ---------------------------------------------------------------------------
-- 8. Row Level Security
--    Client chỉ đọc được ảnh đã duyệt. Mọi thao tác ghi đi qua API route
--    dùng service_role (bỏ qua RLS) sau khi đã xác thực + kiểm duyệt.
-- ---------------------------------------------------------------------------
alter table public.photos enable row level security;
alter table public.photo_hearts enable row level security;
alter table public.photo_reports enable row level security;
alter table public.blocked_hashes enable row level security;

drop policy if exists "photos are readable when approved" on public.photos;
create policy "photos are readable when approved"
  on public.photos for select
  to anon, authenticated
  using (status = 'approved');

-- Không có policy insert/update/delete => client bị chặn hoàn toàn.
-- Bảng photo_hearts cũng không có policy nào: chỉ service_role đọc/ghi.

-- ---------------------------------------------------------------------------
-- 9. Storage buckets
--    `pending` : private, chỉ service_role đọc/ghi.
--    `photos`  : public read, chỉ service_role ghi.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('pending', 'pending', false)
on conflict (id) do update set public = false;

drop policy if exists "public read approved photos" on storage.objects;
create policy "public read approved photos"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'photos');

-- ---------------------------------------------------------------------------
-- 10. Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'photos'
  ) then
    alter publication supabase_realtime add table public.photos;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 11. Dọn ảnh chờ duyệt quá hạn
--     Gọi từ cron (Vercel Cron hoặc pg_cron) để tránh đầy storage.
-- ---------------------------------------------------------------------------
create or replace function public.purge_stale_pending(p_hours int default 48)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed int;
begin
  with gone as (
    delete from public.photos
    where status in ('pending', 'rejected')
      and created_at < now() - make_interval(hours => p_hours)
    returning 1
  )
  select count(*) into removed from gone;
  return removed;
end $$;

revoke all on function public.purge_stale_pending(int) from public, anon, authenticated;
grant execute on function public.purge_stale_pending(int) to service_role;
