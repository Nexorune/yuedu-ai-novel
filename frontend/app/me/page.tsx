"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, FileText, LogOut, ShieldCheck, Sparkles, Trophy } from "lucide-react";
import { api, errorMessage, UserStats } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { SiteFooter, SiteHeader } from "@/components/site/SiteHeader";

export default function MePage() {
  const { user, ready } = useAccount(true);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api.stats().then((data) => { if (!cancelled) setStats(data.stats); }).catch((cause) => { if (!cancelled) setError(errorMessage(cause)); });
    return () => { cancelled = true; };
  }, [user]);

  async function logout() {
    if (leaving) return;
    setLeaving(true);
    try {
      await api.logout();
      window.location.replace("/");
    } catch (cause) {
      setError(errorMessage(cause));
      setLeaving(false);
    }
  }

  if (!ready || !user) return <div className="app-loading">正在打开个人中心…</div>;

  return (
    <div className="site-shell">
      <SiteHeader user={user} nav={[{ href: "/create", label: "开始学习" }, { href: "/create#books", label: "学习记录" }]} />
      <main className="me-main">
        <section className="me-card me-profile">
          <span className="avatar avatar-large">{user.nickname.slice(-2)}</span>
          <div>
            <h1>{user.nickname}</h1>
            <p>{user.phone_masked} · {user.created_at.slice(0, 10)} 加入悦读</p>
          </div>
        </section>

        <section className="me-stats" aria-label="学习统计">
          <div className="me-stat"><BookOpen size={20} /><b>{stats?.books ?? "–"}</b><span>读过的书</span></div>
          <div className="me-stat"><Trophy size={20} /><b>{stats?.chapters_passed ?? "–"}</b><span>通关章节</span></div>
          <div className="me-stat"><Sparkles size={20} /><b>{stats?.knowledge_points ?? "–"}</b><span>学会的知识点</span></div>
        </section>
        {error && <p className="form-error" role="alert">{error}</p>}

        <section className="me-card me-menu">
          <Link href="/create#books"><BookOpen size={18} /><span>我的学习记录</span><ChevronRight size={17} /></Link>
          <Link href="/terms"><FileText size={18} /><span>用户协议</span><ChevronRight size={17} /></Link>
          <Link href="/privacy"><ShieldCheck size={18} /><span>隐私政策</span><ChevronRight size={17} /></Link>
          <button type="button" onClick={() => void logout()} disabled={leaving}><LogOut size={18} /><span>{leaving ? "正在退出…" : "退出登录"}</span><ChevronRight size={17} /></button>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
