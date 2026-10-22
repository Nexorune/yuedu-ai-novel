"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowRight, LockKeyhole, Sparkles } from "lucide-react";
import { api, Book, Ending, errorMessage, Task } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { clearTask, loadTask, saveTask } from "@/lib/task";
import { SiteHeader } from "@/components/site/SiteHeader";

export default function GalleryPage() {
  const params = useParams<{ id: string }>();
  const bookId = Number(params.id);
  const { user, ready } = useAccount(true);
  const [book, setBook] = useState<Book | null>(null);
  const [endings, setEndings] = useState<Ending[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [task, setTask] = useState<Task | null>(null);

  const load = useCallback(async () => {
    try {
      const [detail, list] = await Promise.all([api.book(bookId), api.endings(bookId)]);
      setBook(detail.book);
      setEndings(list.endings);
      setError("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
      setActiveId(loadTask(bookId)?.id || null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [bookId, load]);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    let timer: number | undefined;
    let failures = 0;
    async function check() {
      try {
        const next = await api.task(activeId!);
        if (cancelled) return;
        failures = 0;
        setError("");
        setTask(next);
        if (next.status === "done" || next.status === "error") {
          clearTask(bookId);
          setActiveId(null);
          if (next.status === "done") await load();
          else setError(next.error || "结局生成没有完成，请稍后重试。");
          return;
        }
      } catch (cause) {
        if (cancelled) return;
        failures++;
        setError(errorMessage(cause) + " 恢复连接后会继续查询。");
      }
      if (!cancelled) timer = window.setTimeout(() => void check(), failures ? Math.min(15_000, 5000 * failures) : 1500);
    }
    void check();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activeId, bookId, load]);

  async function rewalk(style: string) {
    if (activeId || book?.status !== "completed") return;
    if (!window.confirm("重走这个结局会调用模型写一个新的大结局，并产生用量费用。确定吗？")) return;
    setError("");
    try {
      const response = await api.rewalk(bookId, style);
      saveTask(bookId, { id: response.task_id, kind: "ending" });
      setActiveId(response.task_id);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  return (
    <div className="site-shell">
      <SiteHeader user={user} ready={ready} nav={[{ href: "/create#books", label: "学习记录" }, { href: "/book/" + bookId, label: "继续阅读" }]} />
      <main className="reading-main">
        <Link className="back-link" href={"/book/" + bookId}><ArrowLeft size={16} /> 返回阅读</Link>
        <div className="reading-heading"><span className="eyebrow">ENDING GALLERY</span><h1>结局画廊</h1><p>同一个故事，也许有不止一种后来。重走结局会调用模型并产生用量费用。</p></div>
        {error && <div className="notice error" role="alert">{error}</div>}
        {activeId && <div className="notice" role="status" aria-live="polite">{task?.progress || "正在写新的结局…"} 离开页面后仍可回来查看。</div>}
        {loading ? <div className="notice" role="status">正在整理结局…</div> : <div className="gallery-grid">{endings.map((ending) => <article className="ending-card" key={ending.style}><span className="read-label">{ending.unlocked ? <Sparkles size={20} /> : <LockKeyhole size={20} />}</span><h2>{ending.desc.split("（")[0]}</h2><p>{ending.unlocked ? "这段结局已经收入你的画廊。" : book?.status === "completed" ? "再走一条路，看看故事会怎样结束。" : "读完故事并选择完结后，可以解锁更多结局。"}</p>{ending.unlocked ? (ending.chapter_no ? <Link className="button button-light" href={`/book/${bookId}?chapter=${ending.chapter_no}`}>阅读这个结局 <ArrowRight size={16} /></Link> : <span className="button button-light">已解锁</span>) : <button className="button button-primary" disabled={!!activeId || book?.status !== "completed"} onClick={() => void rewalk(ending.style)}>重走此结局 <ArrowRight size={16} /></button>}</article>)}</div>}
      </main>
    </div>
  );
}
