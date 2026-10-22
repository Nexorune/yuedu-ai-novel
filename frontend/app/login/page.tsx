"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { safeNext } from "@/lib/account";
import { clearLoginMemory, loadLoginMemory, saveLoginMemory } from "@/lib/login-memory";

const PHONE = /^1\d{10}$/;

export default function LoginPage() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [demoMode, setDemoMode] = useState(false);
  const [phoneActivation, setPhoneActivation] = useState(0);
  const edited = useRef(false);
  const currentPhone = useRef("");
  const codeRequest = useRef(0);

  // 已经登录的人直接去目标页
  useEffect(() => {
    let cancelled = false;
    function restore(demo: boolean) {
      if (cancelled) return;
      setDemoMode(demo);
      if (edited.current) return;
      const saved = loadLoginMemory(demo);
      currentPhone.current = saved.phone;
      setPhone(saved.phone);
      setAgreed(saved.agreed);
    }
    api.me().then(({ user, demo_autofill }) => {
      if (cancelled) return;
      if (user) return window.location.replace(safeNext(new URLSearchParams(window.location.search).get("next")));
      restore(demo_autofill === true);
    }).catch(() => { restore(false); });
    return () => { cancelled = true; };
  }, []);

  // 只在明确开启演示模式、且用户正在操作完整手机号时自动请求。
  useEffect(() => {
    if (!demoMode || phoneActivation === 0 || !PHONE.test(phone)) return;
    let cancelled = false;
    const request = ++codeRequest.current;
    api.sendCode(phone, true).then((result) => {
      if (cancelled || request !== codeRequest.current || currentPhone.current !== phone) return;
      if (result.demo_code && /^\d{6}$/.test(result.demo_code)) {
        setCode(result.demo_code);
        setHint("演示验证码已自动填写，确认后即可登录");
        setError("");
      }
    }).catch((cause) => {
      if (!cancelled && request === codeRequest.current) setError(errorMessage(cause));
    });
    return () => { cancelled = true; };
  }, [demoMode, phoneActivation, phone]);

  function changePhone(value: string) {
    const next = value.replace(/\D/g, "").slice(0, 11);
    if (next === currentPhone.current) return;
    edited.current = true;
    currentPhone.current = next;
    ++codeRequest.current;
    setPhone(next);
    setCode("");
    setHint("");
    setError("");
    setCooldown(0);
    setAgreed(false);
    saveLoginMemory({ phone: next, agreed: false }, demoMode);
  }

  function forget() {
    edited.current = true;
    currentPhone.current = "";
    ++codeRequest.current;
    clearLoginMemory();
    setPhone(""); setCode(""); setAgreed(false);
    setHint(""); setError(""); setCooldown(0);
  }

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
    const request = ++codeRequest.current;
    try {
      const result = await api.sendCode(phone);
      if (request !== codeRequest.current || currentPhone.current !== phone) return;
      setCooldown(result.cooldown);
      if (demoMode && result.demo_code && /^\d{6}$/.test(result.demo_code)) {
        setCode(result.demo_code);
        setHint("演示验证码已自动填写，确认后即可登录");
      } else {
        setHint("验证码已发送");
      }
      document.getElementById("code-input")?.focus();
    } catch (cause) {
      if (request === codeRequest.current) setError(errorMessage(cause));
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
    setError("");
    setSubmitting(true);
    try {
      await api.login({ phone, code, agreed });
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
          <input inputMode="numeric" autoComplete="tel" maxLength={11} placeholder="请输入手机号" value={phone} onFocus={() => setPhoneActivation((value) => value + 1)} onChange={(event) => changePhone(event.target.value)} />
        </label>
        <label className="login-field">
          <span className="sr-only">验证码</span>
          <input id="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="请输入验证码" value={code} onChange={(event) => { ++codeRequest.current; setCode(event.target.value.replace(/\D/g, "")); setError(""); }} />
          <button type="button" className="login-code-button" disabled={sending || cooldown > 0} onClick={() => void sendCode()}>{cooldown > 0 ? `${cooldown} 秒后重发` : sending ? "发送中…" : "获取验证码"}</button>
        </label>
        {hint && !error && <p className="login-hint" role="status">{hint}</p>}

        <label className="login-check"><input type="checkbox" checked={agreed} onChange={(event) => { edited.current = true; setAgreed(event.target.checked); setError(""); saveLoginMemory({ phone, agreed: event.target.checked }, demoMode); }} /><span>我已阅读并同意 <Link href="/terms" target="_blank">《用户协议》</Link>和<Link href="/privacy" target="_blank">《隐私政策》</Link></span></label>

        {demoMode && <div className="login-memory"><span>本机测试：记住手机号和勾选项，点击手机号自动填码。</span><button type="button" onClick={forget}>清除记录</button></div>}

        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary button-wide" type="submit" disabled={submitting}>{submitting ? "正在登录…" : "登录"} <ArrowRight size={18} /></button>
      </form>
      <p className="login-foot">内容由 AI 生成，陪你在故事里学习</p>
    </main>
  );
}
