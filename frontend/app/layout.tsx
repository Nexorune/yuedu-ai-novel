import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./library.css";

export const metadata: Metadata = {
  title: "悦读｜边追更，边学东西",
  description: "把喜欢的故事，读成自己的收获。",
};

export const viewport: Viewport = {
  themeColor: "#f8f2eb",
};

// 阅读背景（纸白 / 护眼 / 夜间）在页面绘制前就设好，避免夜间模式打开时先闪一下白底
const READING_THEME_SCRIPT = `try{var t=localStorage.getItem("yuedu-reading-theme");if(t==="eye"||t==="night")document.documentElement.dataset.readingTheme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: READING_THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
