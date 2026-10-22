"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowRight, BookOpen, BookMarked, ChevronRight, Home, PenLine } from "lucide-react";
import { User } from "@/lib/api";

type NavItem = { href: string; label: string };

/** 共享导航：桌面书房侧栏，窄屏顶栏；沿用页面传入的入口与账号状态。 */
export function SiteHeader({ nav = [], user, ready = true }: { nav?: NavItem[]; user: User | null; ready?: boolean }) {
  const pathname = usePathname();
  const [hash, setHash] = useState("");
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, [pathname]);
  const items = nav.length ? nav : [{ href: user ? "/create" : "/login?next=%2Fcreate", label: "开始学习" }];

  // 登录确认前也使用访客页头，避免侧栏先闪现再消失。
  if (!ready || !user) {
    return (
      <header className="public-header">
        <Link href="/" className="logo"><span className="brand-mark brand-mark-small"><BookOpen size={19} strokeWidth={1.8} /></span><span>悦读</span></Link>
        <Link href="/login" className="button button-light button-small">登录 <ArrowRight size={15} /></Link>
      </header>
    );
  }

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="logo"><span className="brand-mark brand-mark-small"><BookOpen size={19} strokeWidth={1.8} /></span><span>悦读</span></Link>
        <nav aria-label="主导航" className="top-nav">
          <Link href="/" aria-current={pathname === "/" ? "page" : undefined}><Home size={18} strokeWidth={1.5} /><span>首页</span></Link>
          {items.map((item, index) => {
            const isBooks = item.href.includes("#books") || item.label === "继续阅读";
            const Icon = isBooks ? BookMarked : PenLine;
            const active = item.href.startsWith("#")
              ? hash === item.href || (!hash && index === 0)
              : pathname === item.href.split("#")[0] && !item.href.includes("#");
            return <Link key={item.href} href={item.href} onClick={() => { if (item.href.startsWith("#")) setHash(item.href); }} aria-current={active ? "page" : undefined}><Icon size={18} strokeWidth={1.5} /><span>{item.label}</span></Link>;
          })}
        </nav>
        <div className="sidebar-book" aria-hidden="true"><BookOpen size={27} strokeWidth={1} /><span>边追更，<br />边学东西。</span><i /></div>
        <div className="header-account">
          {!ready ? null : user ? (
            <Link href="/me" className="avatar-link" aria-label="个人中心" aria-current={pathname === "/me" ? "page" : undefined}><span className="avatar">{user.nickname.slice(-2)}</span><span className="avatar-name">{user.nickname}</span><ChevronRight size={15} /></Link>
          ) : (
            <Link href="/login" className="button button-light button-small">登录 <ArrowRight size={15} /></Link>
          )}
        </div>
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
