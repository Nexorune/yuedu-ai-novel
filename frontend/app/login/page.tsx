"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { safeNext } from "@/lib/account";

const PHONE = /^1\d{10}$/;

export default function LoginPage() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [adult, setAdult] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");

  // 已经登录的人直接去目标页
  useEffect(() => {
    let cancelled = false;
    api.me().then(({ user }) => {
      if (!cancelled && user) window.location.replace(safeNext(new URLSearchParams(window.location.search).get("next")));
    }).catch(() => { /* 连不上时照常显示登录表单 */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function sendCode() {
    if (sending || cooldown > 0) return;
    if (!PHONE.test(phone)) {
      setError("请输入正确的 11 位手机号");
      return;
    }
    setError("");
    setSending(true);
    try {
      const result = await api.sendCode(phone);
      setCooldown(result.cooldown);
      setHint("验证码已发送");
      document.getElementById("code-input")?.focus();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!PHONE.test(phone)) return setError("请输入正确的 11 位手机号");
    if (!/^\d{6}$/.test(code)) return setError("请输入 6 位验证码");
    if (!agreed) return setError("请先阅读并同意《用户协议》和《隐私政策》");
    if (!adult) return setError("本产品仅面向年满 18 岁的用户");
    setError("");
    setSubmitting(true);
    try {
      await api.login({ phone, code, agreed, adult_confirmed: adult });
      window.location.replace(safeNext(new URLSearchParams(window.location.search).get("next")));
    } catch (cause) {
      setError(errorMessage(cause));
      setSubmitting(false);
    }
  }

  return (
    <main className="login-wrap">
      <Link href="/" className="logo login-logo"><span className="brand-mark brand-mark-small"><BookOpen size={19} strokeWidth={1.8} /></span><span>悦读</span></Link>
      <form className="login-card" onSubmit={submit} noValidate>
        <h1>登录悦读</h1>
        <p className="login-sub">未注册的手机号验证后将自动创建账号</p>

        <label className="login-field">
          <span className="sr-only">手机号</span>
          <span className="login-prefix">+86</span>
          <input inputMode="numeric" autoComplete="tel" maxLength={11} placeholder="请输入手机号" value={phone} onChange={(event) => { setPhone(event.target.value.replace(/\D/g, "")); setError(""); }} />
        </label>
        <label className="login-field">
          <span className="sr-only">验证码</span>
          <input id="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="请输入验证码" value={code} onChange={(event) => { setCode(event.target.value.replace(/\D/g, "")); setError(""); }} />
          <button type="button" className="login-code-button" disabled={sending || cooldown > 0} onClick={() => void sendCode()}>{cooldown > 0 ? `${cooldown} 秒后重发` : sending ? "发送中…" : "获取验证码"}</button>
        </label>
        {hint && !error && <p className="login-hint" role="status">{hint}</p>}

        <label className="login-check"><input type="checkbox" checked={agreed} onChange={(event) => { setAgreed(event.target.checked); setError(""); }} /><span>我已阅读并同意 <Link href="/terms" target="_blank">《用户协议》</Link>和<Link href="/privacy" target="_blank">《隐私政策》</Link></span></label>
        <label className="login-check"><input type="checkbox" checked={adult} onChange={(event) => { setAdult(event.target.checked); setError(""); }} /><span>我已年满 18 岁</span></label>

        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary button-wide" type="submit" disabled={submitting}>{submitting ? "正在登录…" : "登录"} <ArrowRight size={18} /></button>
      </form>
      <p className="login-foot">内容由 AI 生成，仅面向年满 18 岁的成年人</p>
    </main>
  );
}
