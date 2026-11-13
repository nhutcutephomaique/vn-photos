# vn/photos

Bàn cờ ảnh cộng đồng — lấy cảm hứng từ r/place, nhưng thay vì đặt từng ô pixel,
mỗi người dán **một tấm ảnh** lên một canvas chung 4096 × 4096.

```
                    ┌──────────────────────────────┐
                    │  mỗi người 1 ảnh             │
                    │  càng nhiều tym → ảnh càng to│
                    │  xoá ảnh → làm lại từ đầu    │
                    └──────────────────────────────┘
```

Ảnh không được publish trực tiếp: mọi file đi qua vùng chờ riêng tư, được
**làm sạch + kiểm duyệt tự động 2 lớp**, rồi mới có thể xuất hiện trên bàn cờ.
Vùng xám luôn rơi vào tay người duyệt.

```
Next.js 16 (App Router)  ──►  Vercel
        │
        ├── Supabase Postgres   (photos, hearts, reports + RLS + Realtime)
        ├── Supabase Storage    (bucket private `pending` / bucket public `photos`)
        └── OpenAI omni-moderation + Sightengine   (kiểm duyệt ảnh)
```

---

## 1. Ba luật chơi

| Luật | Chi tiết |
| --- | --- |
| **1 ảnh / tài khoản** | Có ảnh `pending`, `review` hoặc `approved` là không đăng được ảnh mới. Ảnh bị từ chối không chiếm chỗ (nhưng tối đa 10 lần thử/24h). |
| **Tym làm ảnh to lên** | Mỗi tym phóng ảnh thêm một chút theo logarit, tối đa **2.4×**. Tối đa **20 tym/ngày**, mỗi lần cách nhau **3 phút**, không tự thả tym cho ảnh của mình. |
| **Xoá = làm lại từ đầu** | Chủ ảnh xoá được bất cứ lúc nào. Ảnh + tym + vị trí biến mất, slot "1 ảnh" được giải phóng ngay. |

Công thức phóng to (mirror ở `src/lib/display.ts` và `public.register_heart()`):

```
factor = min(1 + 0.22 * ln(1 + hearts), 2.4)

 0 tym   → 1.00×        10 tym  → 1.53×
 1 tym   → 1.15×        100 tym → 2.06×
 5 tym   → 1.40×        575 tym → 2.40× (chạm trần)
```

Ảnh cũng được đẩy z-index theo số tym, nên ảnh được yêu thích nằm trên ảnh ít tym.

### Bàn cờ (hành xử như r/place)

- Mở trang là **vừa khít toàn bàn cờ** — không có khoảng trống để "lạc" ra ngoài.
- **Chỉ phóng to**, không zoom ra ngoài mức nhìn toàn bàn cờ. Zoom tối đa **4×**.
- Kéo chỉ để xem phần đã zoom; bàn cờ **không bao giờ rời khỏi màn hình**.
- Thanh giữa phía trên hiện **toạ độ + mức zoom**, nút **Toàn bàn cờ** để reset.
- Ảnh khi đặt nằm trọn trong bàn cờ, tối đa **256 × 256** đơn vị (giữ tỉ lệ gốc),
  snap lưới 8px, có khung xem trước đúng kích thước thật.

---

## 2. Kiến trúc & các luồng

### Upload (có kiểm duyệt)

```
Browser                         API (Vercel)                  Supabase
───────                         ────────────                  ────────
1. chọn file, click lên bàn cờ
2. POST /upload/init ─────────►  xác thực JWT ẩn danh
                                 dọn ảnh pending bỏ dở (>15')
                                 chặn nếu đã có 1 ảnh
                                 tạo row status=pending ─────► photos
                                 ký URL upload ─────────────► pending/*
3. PUT file lên signed URL ──────────────────────────────────► pending/<uid>/<id>
4. POST /upload/complete ─────►  tải file về
                                 re-encode (xoá EXIF, WebP)
                                 so khớp hash ảnh bị cấm
                                 gọi 2 provider kiểm duyệt
                                 ├─ reject  → xoá file, status=rejected
                                 ├─ review  → status=review (chờ admin)
                                 └─ approve → copy sang `photos/*`,
                                              status=approved
5. realtime UPDATE ───────────────────────────────────────────► ảnh hiện trên bàn cờ
```

**Client không bao giờ quyết định status.** Nó chỉ gửi `id` và toạ độ tâm ảnh.
Ảnh chưa duyệt nằm trong bucket private, không có URL công khai.

### Tym

```
client A ──POST /api/photos/:id/heart──► register_heart()  (một transaction)
                                          • kiểm tra: ảnh approved, không phải của mình
                                          • cooldown 3 phút + quota 20/24h (advisory lock)
                                          • insert photo_hearts
                                          • tính lại w/h từ base_w/base_h
                                          • update photos (w, h, heart_count)
                                                    │
        ◄── { hearts, w, h } ────────────────────────┘
                                                    │
        mọi client ◄── realtime UPDATE (w/h mới) ────┘   ảnh to lên ngay
```

### Xoá

```
owner ──DELETE /api/photos/:id──► xoá object storage
                                   xoá row (photo_hearts cascade)
                                   broadcast "photo_deleted"
                                        │
        mọi client ◄────────────────────┘  ảnh biến mất ngay
```

Vì RLS bật, `postgres_changes` không gửi được sự kiện DELETE, nên server bắn
thêm một **broadcast** qua Realtime. Nếu broadcast lỗi, client vẫn tự dọn sau
tối đa 45 giây (tự refresh khung nhìn).

---

## 3. Cài đặt Supabase

1. Tạo project tại [supabase.com](https://supabase.com).
2. **SQL Editor** → chạy migration:
   - Project mới: [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql)
   - Đã chạy 0001 bản cũ (chưa có tym): chạy thêm
     [`0002_hearts_and_single_photo.sql`](supabase/migrations/0002_hearts_and_single_photo.sql)

   > Sau khi nâng cấp, nếu tài khoản test của bạn còn nhiều ảnh cũ (bản 20 ảnh/ngày)
   > thì quy tắc "1 ảnh" sẽ chặn cho tới khi dọn hết:
   > ```sql
   > -- xem còn ảnh nào đang chiếm chỗ
   > select author_id, count(*) from photos
   > where status in ('pending','review','approved') group by 1;
   > -- dọn sạch để test lại từ đầu
   > delete from photos;
   > ```
3. **Authentication → Providers → Anonymous sign-ins**: bật **ON** (bắt buộc).
4. **Project Settings → API**: lấy `URL`, `anon key`, `service_role key`.
5. (Tuỳ chọn, gói Pro) bật **Storage → Image transformation** rồi đặt
   `NEXT_PUBLIC_IMAGE_TRANSFORMS=1`.

Migration tạo sẵn: bảng `photos`, `photo_hearts`, `photo_reports`,
`blocked_hashes`, RLS policy, trigger "1 ảnh/tài khoản", hàm `register_heart`,
2 bucket storage và bật realtime.

---

## 4. Biến môi trường

| Biến | Bắt buộc | Mô tả |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | URL project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | anon key (công khai được) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | **chỉ server** — bỏ qua RLS |
| `ADMIN_PASSWORD` | ✅ | mật khẩu vào `/admin` |
| `ADMIN_COOKIE_SECRET` | ✅ | chuỗi ngẫu nhiên ≥ 32 ký tự |
| `OPENAI_API_KEY` | ➖ | lớp kiểm duyệt 1 (miễn phí) |
| `SIGHTENGINE_API_USER` / `_SECRET` | ➖ | lớp kiểm duyệt 2 |
| `MODERATION_FAIL_MODE` | ➖ | `review` (mặc định) hoặc `closed` |
| `ALLOW_UNSCREENED` | ➖ | `true` **chỉ khi dev local** |
| `CRON_SECRET` | ➖ | bảo vệ `/api/cron/purge` |
| `NEXT_PUBLIC_IMAGE_TRANSFORMS` | ➖ | `1` nếu có Image Transformation |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> ⚠️ Biến `NEXT_PUBLIC_*` được nhúng vào bundle lúc **build**. Đổi URL/key Supabase
> thì phải **build lại** (redeploy), chỉ restart không đủ.

---

## 5. Chạy local

```bash
npm install
cp .env.example .env.local     # điền biến
npm run dev                    # http://localhost:3000
```

---

## 6. Hướng dẫn test

### 6.1. Test nhanh, không cần Supabase

```bash
npm run typecheck   # TypeScript toàn dự án
npm run smoke       # pipeline ảnh: EXIF, WebP, dHash, growth, fail-closed
npm run build       # build production
```

Kiểm tra hành vi canvas (cần dev server đang chạy + Chrome/Edge cài sẵn):

```bash
npm run ui:test     # fit-to-screen, không zoom out quá, kéo bị chặn, HUD, reset
npm run shots       # chụp ảnh desktop/laptop/mobile vào ./.shots để soát layout
```

`npm run smoke` kiểm tra: EXIF/GPS bị xoá, output là WebP, dHash 256-bit ổn
định qua nén lại, ảnh khác nội dung không trùng hash, SVG bị chặn, công thức
tym đơn điệu tăng + có trần + không méo tỉ lệ, và **không có API kiểm duyệt thì
ảnh không được auto-approve**.

### 6.2. Chuẩn bị môi trường test

- Điền `.env.local` với Supabase thật.
- Để test nhanh mà không tốn phí API:
  ```env
  ALLOW_UNSCREENED=true
  MODERATION_FAIL_MODE=review
  ```
  Khi đó ảnh được publish ngay. **Đừng bật dòng này trên production.**
- Muốn test luồng "chờ duyệt": đặt `ALLOW_UNSCREENED=false` và **không** cấu
  hình provider → mọi ảnh vào hàng chờ `review`.

**Tạo 2 "tài khoản" khác nhau:** mỗi browser profile / cửa sổ ẩn danh / thiết bị
có một danh tính ẩn danh riêng (lưu trong `localStorage` key `vn-photos-auth`).
Mở 2 profile cạnh nhau là có 2 người dùng độc lập — cần cho test tym và realtime.

### 6.3. Checklist thủ công (≈ 10 phút)

Chạy `npm run dev`, mở 2 profile: **A** (chủ ảnh) và **B** (người xem).

| # | Thao tác | Kết quả mong đợi |
| --- | --- | --- |
| 0a | Mở trang | Bàn cờ nằm giữa, **vừa khít chiều cao**, không có khoảng trống vô cực |
| 0b | Lăn chuột ra (zoom out) | Dừng ở mức "toàn bàn cờ", không nhỏ hơn |
| 0c | Lăn chuột vào rồi kéo | Xem được chi tiết, kéo không làm bàn cờ rời màn hình |
| 1 | A: bấm **Đặt ảnh** (nút giữa dưới) → chọn file → click lên bàn cờ | Toast "Đang tải…" → "Đang kiểm duyệt…" → "Ảnh đã lên bàn cờ!" |
| 2 | Ảnh xuất hiện trên bàn cờ ở đúng chỗ đã click, có viền xanh (ảnh của bạn) | ✅ |
| 3 | A: bấm **Đặt ảnh** lần 2 | Nút đổi thành "Bạn đã có 1 ảnh" + toast giải thích |
| 4 | Kiểm tra DB | `select status, x, y, base_w, w, heart_count from photos;` → `approved`, `heart_count = 0` |
| 5 | B: mở ảnh → bấm ♥ | Số tym +1, ảnh **to lên** ngay trên cả 2 tab, nút ♥ đếm ngược **3:00** |
| 6 | B: bấm ♥ ngay sau đó | Nút bị khoá + hiện "Tym tiếp sau 2:59" (server cũng chặn nếu gọi thẳng API) |
| 7 | B: thả đủ 20 tym | Lỗi "Bạn đã dùng hết 20 tym hôm nay" |
| 8 | A: mở ảnh của chính mình | Nút ♥ bị disable (không tự buff được) |
| 9 | A: **Xoá ảnh của tôi** → xác nhận | Ảnh biến mất ở **cả 2 tab** (broadcast), nút Đặt ảnh bật lại |
| 10 | A: đặt ảnh khác | Thành công, tym về 0, vị trí mới |
| 11 | B: báo cáo ảnh | Toast "Đã gửi báo cáo"; `photo_reports` có 1 row |
| 12 | `/admin` → đăng nhập → duyệt/gỡ | Ảnh xuất hiện/biến mất trên bàn cờ |

Ghi chú cho #12: ảnh `review` chỉ xuất hiện trong hàng chờ khi
`ALLOW_UNSCREENED=false` và không có provider. Nếu đã cấu hình provider thì
upload một ảnh "vùng xám" (ví dụ ảnh bikini) để có item trong hàng chờ.

> **Test tym nhanh:** cooldown là 3 phút nên không thể thả 20 tym liên tục. Xoá
> tym của tài khoản test để reset cả cooldown lẫn quota:
> ```sql
> delete from photo_hearts where user_id = '<uuid cua tai khoan test>';
> ```
> Hoặc tạm đổi `interval '3 minutes'` → `'3 seconds'` trong hàm
> `register_heart` (chạy lại phần 5 của migration) rồi đổi lại trước khi deploy.

Kiểm tra tự ẩn sau 3 báo cáo cần 3 danh tính khác nhau — dùng 3 profile, hoặc
test nhanh bằng SQL rồi xoá dữ liệu test:

```sql
-- xem ai đã báo cáo
select photo_id, reporter_id, reason from photo_reports;
-- gỡ chặn để test lại
delete from photo_reports where photo_id = '<id>';
update photos set status = 'approved', report_count = 0 where id = '<id>';
```

### 6.4. Test phần kiểm duyệt 18+

> ⚠️ **Tuyệt đối không** dùng ảnh CSAM thật để test, dù ở môi trường local.

Cách an toàn:

1. Cấu hình `OPENAI_API_KEY` thật.
2. Upload một ảnh **do bạn tự tạo** có màu da/đồ bơi để xem ảnh rơi vào
   `review` hay `reject`.
3. Xem điểm số đã lưu:
   ```sql
   select id, status, reject_reason, sexual_score, moderation
   from photos order by created_at desc limit 5;
   ```
4. Chỉnh ngưỡng trong `src/lib/moderation/policy.ts` rồi chạy lại — **không**
   sửa ngưỡng trực tiếp trên production khi chưa thử ở local.
5. Test "up lại ảnh đã bị cấm": sau khi một ảnh bị `reject`, upload lại đúng
   ảnh đó → phải bị chặn ngay với lý do `blocked_hash` (không tốn phí API).

Chi tiết chiến lược: [`docs/MODERATION.md`](docs/MODERATION.md).

### 6.5. Lỗi thường gặp

| Triệu chứng | Nguyên nhân | Cách sửa |
| --- | --- | --- |
| Banner "Chưa cấu hình Supabase" | thiếu `.env.local` / chưa restart dev | điền biến rồi `npm run dev` lại |
| "Không tạo được phiên ẩn danh" | chưa bật Anonymous sign-ins | Supabase → Authentication → Providers |
| Upload xong ảnh không hiện | `ALLOW_UNSCREENED=false` + không có provider → ảnh vào `review` | bật provider hoặc duyệt trong `/admin` |
| "Ảnh này trùng với nội dung đã bị gỡ" | dHash trùng ảnh trong `blocked_hashes` | `select * from blocked_hashes;` rồi xoá row test |
| Không đăng được ảnh dù đã xoá | còn ảnh `pending` cũ < 15 phút | đợi 15 phút, hoặc bấm chip "ảnh đang xử lý" để xoá |
| Tym không làm ảnh to | RPC lỗi | xem Network tab; kiểm tra đã chạy migration `0001`/`0002` |
| Realtime không cập nhật | chưa bật publication | chạy lại phần 10 trong migration |
| 500 khi `/api/upload/complete` | hết `maxDuration` hoặc provider timeout | giảm `providerTimeoutMs` hoặc nâng gói Vercel |

---

## 7. Deploy lên Vercel

### Bước 1 — Supabase (production)

1. Tạo project **riêng** cho production (đừng dùng chung với dev).
2. Chạy `0001_init.sql` (hoặc `0001` + `0002` nếu nâng cấp).
3. Bật **Anonymous sign-ins**.
4. Lấy 3 giá trị: `URL`, `anon key`, `service_role key`.

### Bước 2 — Đưa code lên GitHub

```bash
git init
git add .
git commit -m "vn/photos: 1 ảnh/tài khoản, tym, xoá & kiểm duyệt"
git branch -M main
git remote add origin https://github.com/<you>/vn-photos.git
git push -u origin main
```

`.env.local` đã nằm trong `.gitignore` — **không** commit key.

### Bước 3 — Import vào Vercel

1. [vercel.com/new](https://vercel.com/new) → import repo.
2. Framework: **Next.js** (Vercel tự nhận). Root directory: `./`.
3. Build command để mặc định (`next build`), Node 22+.
4. Mở **Environment Variables**, thêm (Production + Preview):

```
NEXT_PUBLIC_SUPABASE_URL        = https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY   = eyJ...
SUPABASE_SERVICE_ROLE_KEY       = eyJ...
ADMIN_PASSWORD                  = <mật khẩu mạnh>
ADMIN_COOKIE_SECRET             = <32+ ký tự ngẫu nhiên>
CRON_SECRET                     = <32+ ký tự ngẫu nhiên>
OPENAI_API_KEY                  = sk-...
SIGHTENGINE_API_USER            = ...
SIGHTENGINE_API_SECRET          = ...
MODERATION_FAIL_MODE            = review
NEXT_PUBLIC_IMAGE_TRANSFORMS    = 0
```

5. **Deploy**. Lần build đầu ~1–2 phút.

> `NEXT_PUBLIC_*` được nhúng lúc build: nếu nhập sai URL rồi sửa, phải
> **Redeploy → Deployments → ⋯ → Redeploy** (không tick "use existing build cache").

### Bước 4 — Kiểm tra sau deploy

| Việc | Cách kiểm tra |
| --- | --- |
| Trang chủ | mở domain, không có banner lỗi, canvas kéo/zoom được |
| Upload | đăng 1 ảnh thật, xác nhận toast + ảnh xuất hiện |
| Realtime | mở 2 thiết bị/profile, thả tym ở máy này → máy kia thấy ảnh to lên |
| Quy tắc 1 ảnh | thử đăng ảnh thứ 2 → bị chặn |
| Xoá | xoá ảnh → biến mất ở cả 2 máy, đăng lại được |
| Admin | `/admin` đăng nhập được, duyệt/gỡ hoạt động |
| Cron | Vercel → Project → **Cron Jobs** → thấy `/api/cron/purge` chạy 04:00 |
| Kiểm duyệt | upload ảnh "vùng xám" → phải vào `review`, không tự publish |

### Bước 5 — Vận hành

- **Cron dọn ảnh rác**: `vercel.json` đã khai báo `/api/cron/purge` (04:00 mỗi
  ngày). Vercel Cron tự gửi `Authorization: Bearer $CRON_SECRET`.
- **Storage**: ảnh được lưu tối đa 1280 px WebP (~150–400 KB). Gói Supabase
  Free 1 GB chứa được ~3.000 ảnh. Bật Image Transformation nếu băng thông tăng.
- **Giới hạn 60 giây**: `/api/upload/complete` gọi 2 provider. Nếu timeout,
  giảm `POLICY.providerTimeoutMs` hoặc chỉ dùng 1 provider.
- **Đổi mật khẩu admin**: đổi `ADMIN_PASSWORD` → redeploy (cookie cũ vẫn hợp lệ
  tới khi hết hạn 8h; đổi `ADMIN_COOKIE_SECRET` để vô hiệu hoá ngay).
- **Backup**: bật PITR/backup của Supabase và bật versioning cho bucket `photos`
  nếu cần khôi phục sau takedown nhầm.

---

## 8. API

| Method | Route | Mô tả |
| --- | --- | --- |
| `GET` | `/api/photos?x0&y0&x1&y1` | ảnh đã duyệt trong khung nhìn |
| `GET` | `/api/me` | ảnh hiện tại của tôi (`status`, `id`, `photo`) |
| `POST` | `/api/upload/init` | tạo row pending + ký URL upload |
| `POST` | `/api/upload/complete` | sanitize → kiểm duyệt → publish |
| `POST` | `/api/photos/:id/heart` | thả tym (ảnh to lên) |
| `DELETE` | `/api/photos/:id` | xoá ảnh của mình, làm lại từ đầu |
| `POST` | `/api/photos/:id/report` | báo cáo ảnh |
| `POST` | `/api/admin/login` · `/logout` | phiên admin |
| `GET` | `/api/admin/queue` | hàng chờ duyệt (URL ký tạm) |
| `POST` | `/api/admin/moderate` | approve / reject / delete |
| `GET` | `/api/cron/purge` | dọn ảnh pending/rejected > 48h |

Mọi route ghi cần header `Authorization: Bearer <supabase access token>`.

---

## 9. Cấu trúc thư mục

```
src/
├── app/
│   ├── api/…                  # route handlers (upload, heart, admin, cron)
│   ├── admin/page.tsx         # trang kiểm duyệt
│   ├── globals.css · layout.tsx · page.tsx
├── components/
│   ├── Canvas.tsx             # pan/zoom, culling, ghost preview, viền ảnh của tôi
│   ├── PlaceApp.tsx           # điều phối: auth, /api/me, realtime, upload, tym, xoá
│   ├── TopBar.tsx · Toasts.tsx · Lightbox.tsx · InfoModal.tsx
│   └── admin/…
└── lib/
    ├── imaging.ts             # sanitize + dHash 256-bit + màu trung bình
    ├── display.ts             # tỉ lệ ảnh + công thức phóng to theo tym
    ├── moderation/            # policy + openai + sightengine + aggregator
    ├── photos.ts · realtime.ts · auth.ts · admin-auth.ts
    ├── supabase/              # admin client (service role) + browser client
    └── usePhotos.ts
supabase/migrations/0001_init.sql · 0002_hearts_and_single_photo.sql
docs/MODERATION.md
scripts/smoke.ts
```

---

## 10. Chi phí tham khảo

| Hạng mục | Ước tính |
| --- | --- |
| Vercel Hobby/Pro | $0 – $20 |
| Supabase Free/Pro | $0 – $25 |
| OpenAI moderation | **$0** (miễn phí) |
| Sightengine | ~$0 – $29 (tuỳ gói) |

Vì mỗi người chỉ có 1 ảnh, khối lượng ảnh nhỏ hơn nhiều so với một bảng ảnh
tự do — chi phí chủ yếu là thời gian của người duyệt.

---

## 11. Giới hạn đã biết

- Danh tính ẩn danh có thể bị "làm mới" bằng cách xoá localStorage → một người
  có thể tạo nhiều ảnh. Production nên thêm Cloudflare Turnstile + rate limit
  theo IP (chỗ nối: `src/lib/auth.ts`).
- Zoom bị giới hạn trong khoảng **vừa khít bàn cờ → 4×**; ảnh đặt tối đa
  256×256 đơn vị nên không thể "chiếm" cả bàn cờ bằng một ảnh.
- dHash không bắt được crop mạnh / lật / đổi màu. Đây là lớp chống tái phạm,
  không phải lớp phát hiện nội dung.
- Ảnh bị moderator gỡ biến mất sau tối đa 45 giây (xoá bởi chủ ảnh thì ngay lập tức).
- Admin dùng mật khẩu chung; production nên chuyển sang Supabase Auth +
  bảng `admin_users` (sửa `src/lib/admin-auth.ts`).
- Nếu Supabase xoá user ẩn danh (tuỳ cấu hình), tym của user đó cũng mất theo
  (`on delete cascade`) và ảnh có thể nhỏ lại.
- Chưa có age gate; nếu mở cho trẻ vị thành niên cần thêm.

---

## 12. Pháp lý & vận hành

- **CSAM**: không có ngưỡng "chấp nhận được". Ảnh bị gắn cờ `csam_suspected`
  bị từ chối, hash vào blocklist, và **phải** chuyển cơ quan có thẩm quyền
  (Việt Nam: Cục An ninh mạng; quốc tế: NCMEC). Không lưu bản sao lâu hơn cần thiết.
- **Bản quyền**: dùng nút **Xoá** trong `/admin` (xoá cả object storage).
- **Quyền riêng tư**: EXIF/GPS bị xoá trước khi lưu; không lưu IP.
- **Điều khoản**: nêu rõ "ảnh do bạn tạo hoặc bạn có quyền dùng", quyền gỡ nội
  dung, và giới hạn 18+.
