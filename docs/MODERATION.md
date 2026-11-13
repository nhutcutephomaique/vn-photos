# Chiến lược kiểm duyệt nội dung 18+ cho vn/photos

Tài liệu này giải thích **vì sao** hệ thống được thiết kế như hiện tại, các ngưỡng
đang dùng, những gì kẻ xấu sẽ thử, và cách vận hành để không vỡ trận khi đông người.

Đọc kèm code:

| Thành phần | File |
| --- | --- |
| Ngưỡng & policy | `src/lib/moderation/policy.ts` |
| Lớp 1 — OpenAI | `src/lib/moderation/openai.ts` |
| Lớp 2 — Sightengine | `src/lib/moderation/sightengine.ts` |
| Tổng hợp quyết định | `src/lib/moderation/index.ts` |
| Làm sạch ảnh + hash | `src/lib/imaging.ts` |
| Luồng upload | `src/app/api/upload/complete/route.ts` |
| Hàng chờ người duyệt | `src/app/admin/page.tsx` |

---

## 0. Nguyên tắc thiết kế

1. **Không có "đăng rồi gỡ".** Ảnh chỉ tồn tại ở nơi công khai sau khi có quyết
   định. Trước đó nó nằm trong bucket private, không có URL công khai.
2. **Fail closed.** Provider lỗi / hết quota / timeout → ảnh vào hàng chờ, không
   tự duyệt. Mặc định an toàn là "chưa đăng".
3. **Vùng xám thuộc về con người.** Máy chỉ được phép nói "chắc chắn sạch" hoặc
   "chắc chắn bẩn"; mọi thứ ở giữa → hàng chờ.
4. **Nhiều lớp, mỗi lớp giả định lớp trước đã sai.** Nếu model bỏ sót, hash +
   báo cáo + người duyệt vẫn còn.
5. **Rẻ trước, đắt sau.** Chặn hash → lọc metadata → profile model → model ảnh
   → người. Mỗi bước loại bỏ được một phần khối lượng.
6. **Ghi lại mọi quyết định.** Điểm số, provider, thời điểm, người duyệt được
   lưu trong `photos.moderation` để còn điều chỉnh ngưỡng và trả lời khiếu nại.

---

## 1. Máy trạng thái của một tấm ảnh

```
                    ┌──────────── reject ────────────► rejected  (file bị xoá)
                    │                                     │
upload → pending ───┼──────────── review ────────────► review ──► approved
                    │                                     ▲          │
                    └──────────── approve ────────────────┘          │
                                                                     │ 3 báo cáo
                                                                     ▼
                                                              review (bị ẩn)
```

| Trạng thái | Ai thấy | File ở đâu |
| --- | --- | --- |
| `pending` | không ai (trừ service role) | bucket `pending` |
| `review` | admin trong `/admin` | bucket `pending` |
| `approved` | tất cả | bucket `photos` (public read) |
| `rejected` | admin (log) | đã xoá |

`SELECT` của client bị RLS giới hạn ở `status = 'approved'`. Không có policy
`INSERT/UPDATE/DELETE` nào cho `anon` → client không thể tự đăng hay tự duyệt.

---

## 2. Các lớp bảo vệ

### Lớp 0 — Chặn trước khi upload (UX, không phải bảo mật)

- Giới hạn 12 MB, tối thiểu 32×32, chỉ nhận `jpeg/png/webp/gif/avif`.
- **SVG bị chặn** (vector có thể chứa script).
- Có thể thêm `nsfwjs` chạy trong browser để phản hồi tức thì — nhưng **không
  bao giờ tin kết quả client**; nó chỉ để người dùng biết sớm.

### Lớp 1 — Cách ly (containment)

Đây là lớp quan trọng nhất và hay bị bỏ qua:

- Upload đi vào bucket **private** `pending` bằng **signed upload URL** (URL
  hết hạn, chỉ dùng một lần, do server ký sau khi xác thực + kiểm quota).
- **Re-encode toàn bộ ảnh** bằng `sharp` trước khi làm bất cứ điều gì khác:
  - Xoá EXIF (GPS, model máy, thời gian chụp) → chống lộ dữ liệu cá nhân.
  - Chuẩn hoá về WebP, tối đa 1280 px → giảm 90% băng thông.
  - Phá polyglot file (JPEG+HTML, ảnh chứa JS) vì output là pixel đã giải mã.
  - Không tin `Content-Type` của client: `sharp.metadata().format` là nguồn
    duy nhất để xác định định dạng thật.
- File public đặt tên `<user_id>/<uuid>.webp` — không đoán được, không index.
- Mọi ảnh còn `pending` đều có thể bị cron dọn sau 48h.

> Vì ảnh đã bị re-encode, mọi "mẹo" nhúng payload trong file gốc đều mất tác dụng
> **trước khi** ảnh tới tay người xem.

### Lớp 2 — Phát hiện tự động (2 provider độc lập)

| | OpenAI `omni-moderation-latest` | Sightengine `nudity-2.1` |
| --- | --- | --- |
| Đầu vào | ảnh **+ caption** | ảnh (multipart) |
| Trường sử dụng | `sexual`, `sexual/minors`, `violence/graphic`, `hate`, `harassment` | `sexual_activity`, `sexual_display`, `erotica`, `very_suggestive`, `minor` |
| Chi phí | **miễn phí** | trả theo request |
| Độ trễ | ~300–900 ms | ~400–1200 ms |
| Mạnh | text + ảnh cùng lúc, bắt `sexual/minors` | chính xác hơn với ảnh, có `minor` riêng |
| Yếu | đôi khi bỏ sót ảnh vẽ/illustration | không đọc được caption |

Chạy **song song** (`Promise.allSettled`), mỗi provider timeout 12s. Điểm cuối
cùng là **max** trên các provider, nên provider nào "nhìn thấy" nội dung xấu đều
có quyền kéo ảnh vào vùng xám.

Điểm cộng thêm: Sightengine model `text` (OCR) được bật để bắt số điện thoại /
email trong ảnh — chống doxxing, một dạng vi phạm rất phổ biến mà model nudity
không thấy.

#### Ngưỡng hiện tại

| Tín hiệu | Từ chối tự động | Chuyển người duyệt |
| --- | --- | --- |
| `sexual` | ≥ **0.32** | ≥ 0.12 |
| `sexual/minors` (CSAM) | ≥ **0.15** — tuyệt đối | ≥ 0.04 |
| `suggestive` (đồ bơi, nội y) | *không bao giờ* | ≥ 0.50 |
| `gore` | — | ≥ 0.55 |
| `hate` / `offensive` | — | ≥ 0.55 |
| OCR có SĐT / email / CCCD | — | luôn |

Lý do tách `suggestive`: nếu gộp `very_suggestive` vào `sexual` (nhân hệ số),
ảnh du lịch biển, thể thao, thời trang sẽ bị từ chối hàng loạt. Đưa vào hàng chờ
giữ được cả hai: không lọt nội dung gợi dục, không chặn oan ảnh hợp lệ.

**Vì sao `sexual/minors` là tuyệt đối?** Vì đây không phải vấn đề "mức độ". Một
dương tính giả ở đây chỉ làm chậm một ảnh; một âm tính giả là thảm hoạ pháp lý
và đạo đức. Ngưỡng thấp + luôn có người xem lại.

### Lớp 3 — Chống tái phạm (blocklist)

Mỗi ảnh bị từ chối vì nội dung 18+ được lưu **dHash 256-bit** + **màu trung bình**
vào `blocked_hashes`. Lần upload sau, hệ thống tính hash trước khi gọi provider:

- Trùng khớp (Hamming ≤ 24/256, tức ~9%) **và** màu trung bình gần nhau
  (tổng lệch RGB ≤ 48) → từ chối ngay, không tốn phí API.
- Vì sao cần màu? dHash của ảnh đơn sắc gần như luôn giống nhau
  (`0000…`). Không có kiểm tra màu, một ảnh nền đỏ bị cấm sẽ chặn luôn mọi ảnh
  nền xanh.
- So sánh chạy trong Postgres (`bit_count(a # b)`) → không cần kéo dữ liệu về app.

**Giới hạn cần biết:** dHash bền với nén lại, đổi kích thước, thêm viền; **không**
bền với crop mạnh, lật ảnh, xoay 90°, đổi màu mạnh. Xem mục 5 để biết cách bù.

### Lớp 4 — Người duyệt

`/admin` là nơi mọi thứ không chắc chắn đổ về:

- Hàng chờ sắp xếp mới nhất trước, hiển thị: ảnh (mặc định **che mờ**), caption,
  toạ độ, điểm số từng provider, provider nào lỗi, các cờ (`sexual_borderline`,
  `csam_suspected`, `pii_in_text`…).
- Ba hành động:
  - **Duyệt** → chuyển file sang bucket public, publish.
  - **Gỡ + chặn hash** → xoá file, thêm hash vào blocklist (không cho up lại).
  - **Xoá** → xoá vĩnh viễn cả row và object (dùng cho takedown bản quyền/CSAM).
- Mọi hành động ghi `moderation.admin = { action, note, at }` — cần cho audit
  và khiếu nại.
- Ảnh mặc định bị che để giảm tác hại tâm lý cho người duyệt.

**SLA gợi ý:** ảnh có cờ `csam_suspected` xử lý ngay; ảnh `review` thường
trong 24h; nếu hàng chờ > 100 ảnh, tạm thời hạ ngưỡng `reviewSexual` xuống
(danh sách trắng ngắn hơn) hoặc bật chế độ chỉ auto-approve ảnh điểm rất thấp.

### Lớp 5 — Cộng đồng + hậu kiểm

- Nút **Báo cáo ảnh** trên từng ảnh (6 lý do, kèm ghi chú).
- Mỗi người chỉ báo cáo một ảnh một lần (`unique(photo_id, reporter_id)`).
- **3 báo cáo khác nhau → ảnh tự động chuyển `review`** (trigger
  `on_photo_reported`), tức là biến mất khỏi bàn cờ ngay lập tức.
- Client tự làm mới khung nhìn mỗi 45s nên ảnh bị gỡ sẽ biến mất trong ≤ 45s.

---

## 3. Xử lý CSAM — quy trình riêng

Đây là loại nội dung **không được** xử lý như "một loại 18+ khác":

1. **Từ chối tự động, không hiển thị cho cộng đồng.** `sexual/minors ≥ 0.15` →
   `rejected` + cờ `csam_suspected`.
2. **Không auto-duyệt trong mọi trường hợp**, kể cả khi provider còn lại nói sạch.
3. **Không đưa vào hàng chờ thông thường.** Ảnh bị từ chối + xoá file; chỉ giữ
   hash và metadata để phục vụ báo cáo.
4. **Báo cáo cho cơ quan có thẩm quyền.** Tại Việt Nam: Cục An ninh mạng
   (A05) / đường dây nóng; quốc tế: NCMEC CyberTipline. Việc báo cáo là nghĩa vụ
   pháp lý ở nhiều nơi, không phải tuỳ chọn.
5. **Không lưu bản sao lâu hơn cần thiết.** Giữ hash + log; xoá nội dung.
6. **Nâng cấp provider chuyên dụng khi có lưu lượng thật:** Cloudflare Images
   CSAM Scanning (miễn phí), Microsoft PhotoDNA, Thorn Safer. Các model
   moderation tổng quát **không** được thiết kế cho CSAM và không đủ.

> Nếu bạn vận hành công khai, hãy viết sẵn quy trình này thành văn bản nội bộ
> trước khi mở cửa. Đừng đợi đến lúc có sự cố.

---

## 4. Nội dung xấu khác cần chặn

| Loại | Cách phát hiện | Hành động |
| --- | --- | --- |
| Gore / máu me | `gore-2.0` + OpenAI `violence/graphic` ≥ 0.55 | review |
| Thù địch, biểu tượng cực đoan | `offensive` ≥ 0.55, `hate` ≥ 0.55 | review |
| Doxxing (SĐT, email, CCCD trong ảnh) | OCR (`text` model) + regex | review |
| Spam / quảng cáo / QR code | caption + OCR + hành vi (tần suất) | review |
| Bản quyền | báo cáo của chủ sở hữu | admin xoá |
| Ảnh chân dung người khác không đồng ý | báo cáo | admin xoá |

---

## 5. Kẻ tấn công sẽ thử gì (threat model)

| Kỹ thuật né tránh | Vì sao hiệu quả | Đối phó hiện có | Nên bổ sung |
| --- | --- | --- | --- |
| Crop mạnh / zoom vào vùng nhỏ | dHash đổi hoàn toàn | model vẫn bắt nếu vùng nhỏ còn đủ lớn | hash nhiều vùng (tile), embedding |
| Lật / xoay 90° | dHash không bất biến | model vẫn bắt | khi ban, lưu thêm hash của 4 biến thể |
| Đổi màu / filter mạnh | hash đổi, model có thể yếu đi | kiểm tra màu giúp giảm false positive | tăng cường ảnh trước khi kiểm duyệt |
| Ghép collage nhiều ảnh nhỏ | model giảm độ nhạy theo diện tích | vẫn bắt nếu đủ lớn | multi-crop, tile scanning |
| Ảnh vẽ / anime / 3D | model train trên ảnh thật | review | model thứ 3 chuyên illustration |
| Nhồi text lách luật trong caption | moderation text yếu hơn | OpenAI xử lý caption | thêm danh sách từ khoá tiếng Việt |
| GIF động, frame xấu ở giữa | chỉ kiểm tra frame đầu | — | trích 3–5 frame, kiểm tra tất cả |
| Chia nhỏ ảnh thành nhiều mảnh đăng cạnh nhau | mỗi mảnh "sạch" | rate limit + toạ độ | phát hiện cụm ảnh cùng tác giả gần nhau |
| Nhiều tài khoản ẩn danh | xoá localStorage là có identity mới | quota theo `author_id` | Turnstile + limit theo IP/ASN + device fingerprint |
| Upload chậm rải rác | tránh rate limit theo phút | 1 ảnh/tài khoản + 10 lần thử/24h | phát hiện pattern theo giờ |
| Lợi dụng lúc moderator vắng | hàng chờ dồn | auto-reject vùng chắc chắn | auto-approve chỉ khi điểm rất thấp |

---

## 6. Vận hành

### Chỉ số cần theo dõi

| Chỉ số | Ý nghĩa | Ngưỡng báo động |
| --- | --- | --- |
| `% approved tự động` | tỉ lệ ảnh sạch đủ rõ | < 60% → ngưỡng quá chặt |
| `% review` | tải cho người duyệt | > 15% → cần thêm lớp/người |
| `% rejected` | tỉ lệ nội dung xấu | tăng đột biến → có chiến dịch spam |
| Thời gian chờ duyệt (p95) | SLA | > 24h |
| Tỉ lệ báo cáo ảnh đã duyệt | dấu hiệu lọt | > 1% |
| Tỉ lệ dương tính giả (khiếu nại) | chất lượng ngưỡng | > 5% |

Truy vấn nhanh:

```sql
select status, count(*) from photos
where created_at > now() - interval '7 days'
group by status;

select reject_reason, count(*) from photos
where status = 'rejected' and created_at > now() - interval '7 days'
group by reject_reason order by 2 desc;
```

### Quy trình chỉnh ngưỡng

1. Thu một bộ test cố định ~100 ảnh (sạch / bikini / gợi dục / 18+ rõ ràng /
   gore / meme). **Không** đưa CSAM thật vào bộ test.
2. Chạy ở **shadow mode**: ghi lại quyết định mới nhưng không đổi hành vi.
3. So sánh precision/recall với ngưỡng hiện tại.
4. Chỉ đổi ngưỡng khi có dữ liệu; ghi lại lý do trong commit message.

### Kiểm soát chi phí

- Hash blocklist được kiểm tra **trước** provider → ảnh tái phạm không tốn phí.
- Có thể thêm cache `approved_hashes`: ảnh phổ biến được đăng lại nhiều lần sẽ
  được duyệt ngay bằng hash (nhớ cảnh báo: chỉ dùng cho ảnh đã từng được duyệt
  thủ công).
- Giới hạn 1 ảnh/tài khoản và 10 lần thử/ngày là van chi phí hiệu quả nhất.

---

## 7. Những gì **không** nên làm

- ❌ Chỉ dựa vào một model. Model nào cũng có blind spot riêng.
- ❌ Đặt ngưỡng reject thấp để "cho chắc". Bạn sẽ chặn oan rất nhiều và người
  dùng sẽ bỏ đi.
- ❌ Tự động publish khi provider lỗi ("chắc ảnh này không sao").
- ❌ Kiểm duyệt ở client (ẩn nút, disable upload…). Ai cũng bỏ qua được.
- ❌ Lưu bản gốc ảnh bị từ chối. Không cần thiết và tạo rủi ro pháp lý.
- ❌ Dùng chung mật khẩu admin cho cả team mà không có audit.
- ❌ Coi "đã gỡ" là "đã xong" — phải chặn cả việc đăng lại.

---

## 8. Việc cần làm trước khi mở công khai

- [ ] Bật **Cloudflare Turnstile** ở bước upload (chống bot).
- [ ] Rate limit theo IP bằng **Upstash Redis** (`src/lib/auth.ts` đã có chỗ nối).
- [ ] Đăng ký **CSAM scanning** chuyên dụng.
- [ ] Viết **quy trình báo cáo CSAM** và lưu số liên hệ cơ quan chức năng.
- [ ] Chuyển admin sang **Supabase Auth + bảng `admin_users`**.
- [ ] Thêm **age gate** + Điều khoản sử dụng + Chính sách riêng tư.
- [ ] Có **2 người duyệt** trở lên (một người ốm là hàng chờ tắc).
- [ ] Thiết lập **alert** khi tỉ lệ reject tăng bất thường.
- [ ] Chạy thử **red team** với bộ test 100 ảnh trước khi công bố.
