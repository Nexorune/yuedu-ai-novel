"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 兜底页：地址多打了字符、或旧链接失效时，别让人卡在默认 404 上
export default function NotFound() {
  const pathname = usePathname() || "";
  let shown = pathname;
  try {
    shown = decodeURIComponent(pathname);
  } catch {
    /* 编码异常就原样显示 */
  }
  const suspicious = /[。，、！？；：""''（）【】\s]/.test(shown);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "48px 24px",
        background: "var(--paper)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          padding: "40px 36px",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 16,
          boxShadow: "0 18px 40px rgba(56, 91, 66, .07)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            font: "700 44px/1 var(--serif)",
            color: "var(--accent)",
            letterSpacing: ".06em",
            marginBottom: 14,
          }}
        >
          404
        </div>
        <h1 style={{ font: "700 22px/1.4 var(--serif)", marginBottom: 10 }}>这一页没找到</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.8, marginBottom: 22 }}>
          地址可能多带了字符，或者这一页已经搬走了。
        </p>

        {shown && (
          <div
            style={{
              marginBottom: 22,
              padding: "10px 14px",
              background: "var(--paper)",
              border: "1px dashed var(--line)",
              borderRadius: 8,
              font: "13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace",
              color: "var(--muted)",
              wordBreak: "break-all",
              textAlign: "left",
            }}
          >
            {shown}
          </div>
        )}

        {suspicious && (
          <p
            style={{
              marginBottom: 22,
              padding: "10px 14px",
              background: "var(--accent-pale)",
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.7,
              color: "var(--accent-dark)",
              textAlign: "left",
            }}
          >
            上面这段里混进了标点或空格——多数是复制时一起带上的。点下面的按钮回首页就好。
          </p>
        )}

        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/" className="button button-primary" style={{ minWidth: 130 }}>
            回首页
          </Link>
          <Link href="/library" className="button button-light" style={{ minWidth: 130 }}>
            去书库
          </Link>
        </div>
      </div>
    </main>
  );
}
