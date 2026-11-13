"use client";

import { useEffect } from "react";
import { HEARTS_PER_DAY, HEART_COOLDOWN_MS, MAX_DISPLAY_SIZE, MAX_GROWTH } from "@/lib/config";

export default function InfoModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="overlay-close" onClick={onClose} aria-label="Đóng">
          ×
        </button>

        <h2>vn/photos là gì?</h2>
        <p>
          Một bàn cờ chung 4096 × 4096. Thay vì đặt từng ô pixel như r/place, mỗi người dán
          một tấm ảnh của mình lên đó — tối đa {MAX_DISPLAY_SIZE} đơn vị mỗi cạnh, giữ đúng
          tỉ lệ gốc.
        </p>

        <h3>Mỗi người một ảnh</h3>
        <p>
          Mỗi tài khoản chỉ được <b>1 ảnh</b> trên bàn cờ. Muốn đổi ảnh? Xoá ảnh cũ trước —
          xoá xong mọi thứ về 0 và bạn đăng lại từ đầu.
        </p>

        <h3>Tym làm ảnh to lên</h3>
        <p>
          Ai cũng có thể thả tym cho ảnh của người khác. Mỗi tym làm ảnh to thêm một chút
          (theo logarit, tối đa {MAX_GROWTH}× kích thước gốc) và đẩy ảnh lên trên các ảnh
          ít tym hơn. Ảnh của chính mình thì không tự thả tym được.
        </p>
        <ul>
          <li>
            Mỗi ngày được thả {HEARTS_PER_DAY} tym, mỗi lần cách nhau ít nhất{" "}
            {Math.round(HEART_COOLDOWN_MS / 60_000)} phút.
          </li>
          <li>Tym là vĩnh viễn — không rút lại được.</li>
        </ul>

        <h3>Luật chơi</h3>
        <ul>
          <li>Ảnh phải do bạn tạo hoặc bạn có quyền sử dụng.</li>
          <li>Không đăng nội dung 18+, bạo lực, thù địch, hoặc thông tin cá nhân người khác.</li>
          <li>Ảnh có thể chồng lên nhau — ảnh mới và ảnh nhiều tym nằm trên.</li>
        </ul>

        <h3>Ảnh được kiểm duyệt thế nào?</h3>
        <p>
          Mọi ảnh đi qua một vùng chờ riêng tư, được làm sạch metadata rồi chạy qua{" "}
          <b>hai lớp kiểm duyệt tự động</b> (OpenAI omni-moderation + Sightengine). Ảnh bị
          nghi ngờ sẽ vào hàng chờ để <b>người duyệt</b> xem tận mắt — không có chuyện máy
          quyết định một mình rồi đăng ngay.
        </p>
        <p>
          Ảnh đã bị gỡ được lưu dưới dạng <b>dấu vân tay</b> để chặn việc đăng lại (kể cả khi
          crop hay nén lại). Ba báo cáo khác nhau từ cộng đồng sẽ tự động ẩn ảnh.
        </p>

        <h3>Quyền riêng tư</h3>
        <p>
          Bạn không cần tài khoản. Hệ thống tạo một danh tính ẩn danh trên thiết bị chỉ để
          chống spam và cho phép bạn xoá ảnh của mình. Toạ độ GPS trong EXIF bị xoá trước khi
          ảnh được lưu.
        </p>

        <p className="sheet-foot">
          Muốn gỡ ảnh vi phạm bản quyền? Dùng nút <b>Báo cáo</b> trên ảnh đó.
        </p>
      </div>
    </div>
  );
}
