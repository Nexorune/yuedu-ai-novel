"use client";

import { useEffect, useState } from "react";
import { api, User } from "@/lib/api";

/** 当前登录账号。required 为 true 时，未登录会被带到登录页（登录后回到当前页面）。 */
export function useAccount(required = false): { user: User | null; ready: boolean } {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.me()
      .then(({ user: current }) => {
        if (cancelled) return;
        if (!current && required) {
          const here = window.location.pathname + window.location.search + window.location.hash;
          window.location.replace("/login?next=" + encodeURIComponent(here));
          return;
        }
        setUser(current);
        setReady(true);
      })
      .catch(() => {
        // 服务暂时连不上：不强制跳转，页面按未登录显示
        if (!cancelled) setReady(true);
      });
    return () => { cancelled = true; };
  }, [required]);

  return { user, ready };
}

/** 只允许站内相对地址作为登录后的去处，防止被带到外部网站。 */
export function safeNext(value: string | null, fallback = "/library"): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}
