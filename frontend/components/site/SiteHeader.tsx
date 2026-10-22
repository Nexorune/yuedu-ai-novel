"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, BookOpen, BookMarked, PenLine } from "lucide-react";
import { User } from "@/lib/api";
import { AccountMenu } from "./AccountMenu";
import { CoverIllustration } from "./CoverIllustration";

type NavItem = { href: string; label: string };

/** 共享导航：桌面书房侧栏，窄屏顶栏；沿用页面传入的入口与账号状态。 */
export function SiteHeader({ nav = [], user, ready = true, publicView = false }: { nav?: NavItem[]; user: User | null; ready?: boolean; publicView?: boolean }) {
  const pathname = usePathname();
  const items = [{ href: "/create", label: "新建学习" }, { href: "/library", label: "学习书架" }, ...nav.filter((item) => item.href.startsWith("/book/"))];

  // 登录确认前也使用访客页头，避免侧栏先闪现再消失。
  if (publicView || !ready || !user) {
    return (
      <header className="public-header">
        <Link href="/" className="logo"><span className="brand-mark brand-mark-small"><BookOpen size={19} strokeWidth={1.8} /></span><span>悦读</span></Link>
        <Link href={ready && user ? "/library" : "/login"} className="button button-light button-small">{ready && user ? "进入学习书架" : "登录"} <ArrowRight size={15} /></Link>
      </header>
    );
  }

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="logo"><span className="brand-mark brand-mark-small"><BookOpen size={19} strokeWidth={1.8} /></span><span>悦读</span></Link>
        <nav aria-label="主导航" className="top-nav">
          {items.map((item) => {
            const isBooks = item.href === "/library" || item.label === "继续阅读";
            const Icon = isBooks ? BookMarked : PenLine;
            const active = pathname === item.href;
            return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}><Icon size={18} strokeWidth={1.5} /><span>{item.label}</span></Link>;
          })}
        </nav>
        <div className="sidebar-book" aria-hidden="true"><span className="sidebar-book-edition">悦读 · 故事藏知</span><strong>悦读</strong><span className="sidebar-book-art"><CoverIllustration variant={0} /></span><span className="sidebar-book-caption">边追更，边学东西。</span><i /></div>
        <div className="header-account"><AccountMenu user={user} /></div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>© 2026 悦读 · 边追更，边学东西</span>
      <span className="footer-links"><Link href="/terms">用户协议</Link><Link href="/privacy">隐私政策</Link></span>
    </footer>
  );
}
