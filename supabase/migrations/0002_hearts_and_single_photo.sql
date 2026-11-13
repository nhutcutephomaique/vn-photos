-- =============================================================================
-- 0002 — nâng cấp từ bản "pixel" đầu tiên
--
-- Chỉ cần chạy file này nếu bạn ĐÃ chạy 0001 trước khi có tính năng tym.
-- Nếu đang dựng project mới: chỉ chạy 0001_init.sql là đủ.
--
-- Thay đổi:
--   1. Toạ độ x, y chuyển từ góc trên-trái sang TÂM ảnh.
--   2. Thêm base_w/base_h (kích thước gốc) và heart_count.
--   3. Bỏ quota 20 ảnh/ngày → 1 ảnh/tài khoản.
--   4. Thêm bảng photo_hearts + hàm register_heart (ảnh to dần theo tym).
-- =============================================================================

-- 1. Cột mới ----------------------------------------------------------------
alter table public.photos add column if not exists base_w integer;
alter table public.photos add column if not exists base_h integer;
alter table public.photos add column if not exists heart_count integer not null default 0;

-- 2. Chuyển toạ độ góc trên-trái → tâm + ghi lại kích thước gốc -------------
--    (guard bằng `base_w is null` để chạy lại không bị cộng dồn)
update public.photos
   set base_w = w,
       base_h = h,
       x = x + w / 2,
       y = y + h / 2
 where base_w is null;

alter table public.photos alter column base_w set not null;
alter table public.photos alter column base_h set not null;

-- 3. Nới trần kích thước: ảnh có thể phình to gấp 2.4 lần -------------------
alter table public.photos drop constraint if exists photos_w_check;
alter table public.photos add constraint photos_w_check check (w > 0 and w <= 768);

alter table public.photos drop constraint if exists photos_h_check;
alter table public.photos add constraint photos_h_check check (h > 0 and h <= 768);

alter table public.photos drop constraint if exists photos_base_w_check;
alter table public.photos add constraint photos_base_w_check check (base_w > 0 and base_w <= 512);

alter table public.photos drop constraint if exists photos_base_h_check;
alter table public.photos add constraint photos_base_h_check check (base_h > 0 and base_h <= 512);

-- 4. Một tài khoản = một ảnh ------------------------------------------------
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

drop function if exists public.enforce_upload_limits();

-- 5. Tym --------------------------------------------------------------------
create table if not exists public.photo_hearts (
  id         bigserial primary key,
  photo_id   uuid not null references public.photos (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists photo_hearts_photo_idx on public.photo_hearts (photo_id);
create index if not exists photo_hearts_user_idx on public.photo_hearts (user_id, created_at desc);

alter table public.photo_hearts enable row level security;

-- Bỏ hàm cũ trước: `create or replace` không đổi được kiểu trả về.
drop function if exists public.register_heart(uuid, uuid);

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
