import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "vn/photos — bàn cờ ảnh cộng đồng",
  description:
    "r/place phiên bản ảnh: mỗi người dán một tấm ảnh lên bàn cờ chung. Ảnh được kiểm duyệt tự động trước khi xuất hiện.",
  openGraph: {
    title: "vn/photos",
    description: "Bàn cờ ảnh cộng đồng — dán ảnh của bạn, xem thế giới vẽ nên nhau.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0b10",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
