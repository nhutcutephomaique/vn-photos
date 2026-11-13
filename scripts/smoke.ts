/**
 * Smoke test cho phần xử lý ảnh (không cần Supabase).
 * Chạy: npm run smoke
 */
import assert from "node:assert/strict";
import sharp from "sharp";
import { displaySize, grownSize, growthFactor } from "@/lib/display";
import { averageColor, differenceHash, sanitizeImage } from "@/lib/imaging";
import { screenImage } from "@/lib/moderation";
import { POLICY } from "@/lib/moderation/policy";

function hamming(a: string, b: string): number {
  let distance = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) distance += 1;
  }
  return distance + Math.abs(a.length - b.length);
}

/** Sinh ảnh giống ảnh chụp thật (gradient + hình khối) để hash có ý nghĩa. */
function photoSvg(variant: 0 | 1): string {
  const skyTop = variant === 0 ? "#0b1e3a" : "#2a0b1e";
  const skyBottom = variant === 0 ? "#4f7fa8" : "#a84f7f";
  const hill = variant === 0 ? "#0d1626" : "#1b0d1e";
  const sunX = variant === 0 ? 880 : 300;
  const sunY = variant === 0 ? 240 : 620;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${skyTop}"/>
        <stop offset="1" stop-color="${skyBottom}"/>
      </linearGradient>
      <radialGradient id="sun">
        <stop offset="0" stop-color="#ffd27a"/>
        <stop offset="0.55" stop-color="#ff9f4a" stop-opacity="0.55"/>
        <stop offset="1" stop-color="#ff9f4a" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1200" height="900" fill="url(#sky)"/>
    <circle cx="${sunX}" cy="${sunY}" r="210" fill="url(#sun)"/>
    <path d="${variant === 0 ? "M0 640 L280 470 L540 610 L830 430 L1200 650 L1200 900 L0 900Z" : "M0 480 L320 640 L640 500 L920 660 L1200 520 L1200 900 L0 900Z"}" fill="${hill}"/>
    <rect x="${variant === 0 ? 120 : 700}" y="700" width="360" height="150" rx="18" fill="#ffffff" opacity="0.14"/>
    <circle cx="${variant === 0 ? 300 : 950}" cy="770" r="46" fill="#3ad1b0" opacity="0.8"/>
  </svg>`;
}

async function main() {
  // 1. Ảnh JPEG 1200×900 có EXIF orientation (mô phỏng ảnh chụp từ điện thoại).
  const source = await sharp(Buffer.from(photoSvg(0)))
    .jpeg({ quality: 90 })
    .withMetadata({ orientation: 6 })
    .toBuffer();

  const exifBefore = await sharp(source).metadata();
  assert.ok(exifBefore.exif, "ảnh mẫu phải có EXIF");

  const result = await sanitizeImage(source);

  // 2. Output là WebP, không còn EXIF, giữ đúng tỉ lệ.
  assert.equal(result.buffer.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(result.buffer.subarray(8, 12).toString("ascii"), "WEBP");

  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.exif, undefined, "EXIF phải bị xoá");
  assert.equal(meta.orientation, undefined, "orientation phải được áp dụng rồi bỏ");
  assert.ok(meta.width! <= 1280 && meta.height! <= 1280);
  assert.equal(result.width, meta.width);
  assert.equal(result.height, meta.height);

  // 3. dhash: 256 bit, bền qua các lần nén lại.
  assert.equal(result.dhash.length, 256);
  assert.match(result.dhash, /^[01]{256}$/);
  assert.equal(await differenceHash(result.buffer), result.dhash, "hash phải ổn định");

  const recompressed = await sharp(result.buffer).jpeg({ quality: 60 }).toBuffer();
  const drift = hamming(await differenceHash(recompressed), result.dhash);
  assert.ok(
    drift <= POLICY.hashDistance,
    `hash phải bền với nén lại (drift ${drift} > ${POLICY.hashDistance})`,
  );

  // 4. Ảnh khác nội dung phải có hash khác.
  const different = await sharp(Buffer.from(photoSvg(1))).webp().toBuffer();
  assert.ok(
    hamming(await differenceHash(different), result.dhash) > POLICY.hashDistance,
    "ảnh khác nội dung không được trùng hash",
  );

  // 5. Ảnh đơn sắc: dhash giống nhau, nhưng màu trung bình phải khác
  //    (đây là lý do bảng blocked_hashes lưu thêm `color`).
  const red = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 220, g: 20, b: 20 } } })
    .webp()
    .toBuffer();
  const blue = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 20, g: 20, b: 220 } } })
    .webp()
    .toBuffer();
  assert.equal(await differenceHash(red), await differenceHash(blue));
  assert.notEqual(await averageColor(red), await averageColor(blue));

  // 6. Định dạng không hỗ trợ bị chặn.
  await assert.rejects(
    () => sanitizeImage(Buffer.from("<svg onload=alert(1)></svg>")),
    /Không đọc được file ảnh|Chỉ nhận/,
  );

  // 7. Kích thước hiển thị giữ tỉ lệ, không vượt cạnh tối đa.
  assert.deepEqual(displaySize(1200, 800, 256), { w: 256, h: 171 });
  assert.deepEqual(displaySize(800, 1200, 256), { w: 171, h: 256 });
  assert.deepEqual(displaySize(500, 500, 256), { w: 256, h: 256 });

  // 8. Tym làm ảnh to lên: đơn điệu tăng, có trần, không méo tỉ lệ.
  assert.equal(growthFactor(0), 1);
  assert.ok(growthFactor(1) > 1 && growthFactor(1) < 1.2);
  assert.ok(growthFactor(100) > growthFactor(10));
  assert.ok(growthFactor(100_000) <= 2.4, "phải có trần phóng to");
  assert.deepEqual(grownSize(256, 256, 0), { w: 256, h: 256 });

  const grown = grownSize(256, 128, 100);
  assert.ok(grown.w > 256 && grown.h > 128);
  assert.ok(
    Math.abs(grown.w / grown.h - 2) < 0.05,
    "tỉ lệ ảnh phải được giữ nguyên khi phóng to",
  );

  // 9. Không có API key kiểm duyệt → FAIL CLOSED (đưa vào hàng chờ),
  //    tuyệt đối không tự publish.
  delete process.env.OPENAI_API_KEY;
  delete process.env.SIGHTENGINE_API_USER;
  delete process.env.SIGHTENGINE_API_SECRET;
  process.env.MODERATION_FAIL_MODE = "review";
  process.env.ALLOW_UNSCREENED = "false";

  const verdict = await screenImage({
    image: result.buffer,
    mime: "image/webp",
    caption: "thử nghiệm",
  });
  assert.equal(verdict.decision, "review");
  assert.ok(verdict.flags.includes("no_provider"));

  console.log("✓ smoke test passed");
  console.log(
    `  ảnh lưu: ${result.width}×${result.height} webp, ${Math.round(result.buffer.byteLength / 1024)} KB`,
  );
  console.log(`  dhash  : ${result.dhash}`);
  console.log(`  verdict: ${verdict.decision} (${verdict.reason})`);
}

main().catch((error) => {
  console.error("✗ smoke test failed", error);
  process.exit(1);
});
