"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronUp, LogOut, UserRound } from "lucide-react";
import { api, errorMessage, type User } from "@/lib/api";

/** 悬停或点击展开；键盘可用 Enter、方向下键和 Escape。 */
export function AccountMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  async function logout() {
    if (leaving) return;
    setLeaving(true);
    setError("");
    try {
      await api.logout();
      window.location.replace("/");
    } catch (cause) {
      setError(errorMessage(cause));
      setLeaving(false);
    }
  }

  return (
    <div ref={root} className="account-menu" onPointerEnter={(event) => { if (event.pointerType === "mouse") setOpen(true); }} onPointerLeave={() => { if (!leaving && !root.current?.contains(document.activeElement)) setOpen(false); }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } }}>
      <button ref={trigger} className="avatar-link account-trigger" type="button" aria-label="账号菜单" aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen(!open)} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); } }}>
        <span className="avatar">{user.nickname.slice(-2)}</span><span className="avatar-name">{user.nickname}</span><ChevronUp size={14} aria-hidden="true" />
      </button>
      {open && <div id={panelId} className="account-popover">
        <div className="account-identity"><strong>{user.nickname}</strong><span>{user.phone_masked}</span></div>
        <Link href="/me" onClick={() => setOpen(false)}><UserRound size={16} />个人中心</Link>
        <button type="button" onClick={() => void logout()} disabled={leaving}><LogOut size={16} />{leaving ? "正在退出…" : "退出登录"}</button>
        {error && <p role="alert">{error}</p>}
      </div>}
    </div>
  );
}
