"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, BookOpen, ChevronDown, Lightbulb, Search } from "lucide-react";
import { api, Chapter, errorMessage, KnowledgeChapter, KnowledgePoint } from "@/lib/api";
import { chapterTitle, knowledgeTitle } from "@/lib/chapter";
import styles from "./knowledge.module.css";

function Points({ points }: { points: KnowledgePoint[] }) {
  const ordered = points.filter((point) => point.point.trim()).toSorted((a, b) => Number(b.role === "core") - Number(a.role === "core"));
  if (!ordered.length) return <p className={styles.empty}>这一章暂未整理知识点，你可以继续阅读正文。</p>;
  return <ol className={styles.points}>{ordered.map((point, i) => <li key={`${i}-${point.point}`}>
    <span className={styles.number}>{String(i + 1).padStart(2, "0")}</span>
    <div><span className={styles.kind}>{point.role === "core" ? "核心知识" : "拓展知识"}</span><h3>{knowledgeTitle(point.point)}</h3><p>{point.point}</p></div>
  </li>)}</ol>;
}

/** 阅读材料与闯关成绩分开；仅展示后端允许阅读的章节知识。 */
export function ChapterKnowledge({ bookId, chapter, compact = false, onNavigate }: { bookId: number; chapter: Chapter; compact?: boolean; onNavigate?: () => void }) {
  const [view, setView] = useState<"chapter" | "book">("chapter");
  const [chapters, setChapters] = useState<KnowledgeChapter[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (view !== "book") return;
    let cancelled = false;
    api.knowledge(bookId).then((result) => { if (!cancelled) { setChapters(result.chapters); setError(""); } })
      .catch((cause) => { if (!cancelled) setError(errorMessage(cause)); });
    return () => { cancelled = true; };
  }, [view, bookId, retry]);
  const search = query.trim().toLocaleLowerCase();
  const filtered = chapters?.map((entry) => ({ ...entry, knowledge_points: entry.knowledge_points.filter((point) => `${entry.title} ${point.point}`.toLocaleLowerCase().includes(search)) })).filter((entry) => !search || entry.knowledge_points.length > 0);
  return <section id="chapter-knowledge" className={`${styles.panel} ${compact ? styles.compact : ""}`} aria-label="章节知识清单">
    <header className={styles.head}><span className={styles.icon}><Lightbulb size={20} /></span><div><p className={styles.eyebrow}>把故事里的知识留下来</p><h2>{view === "chapter" ? "本章知识点" : "本书知识目录"}</h2></div><span className={styles.count}>{view === "chapter" ? `${chapter.knowledge_points?.length ?? 0} 个知识点` : chapters ? `${chapters.length} 个可读章节` : ""}</span></header>
    <div className={styles.tabs} role="group" aria-label="知识范围"><button type="button" aria-pressed={view === "chapter"} onClick={() => setView("chapter")}>本章知识点</button><button type="button" aria-pressed={view === "book"} onClick={() => setView("book")}>本书知识目录</button></div>
    {view === "chapter" ? <><p className={styles.note}>第 {chapter.chapter_no} 章 · {chapterTitle(chapter.title)}。读完可以先回顾，再去闯关。</p><Points points={chapter.knowledge_points ?? []} /></> : <>
      <p className={styles.note}>按章节整理当前可阅读的知识；后续章节解锁后会继续加入。</p>
      <label className={styles.search}><Search size={16} /><span className="sr-only">搜索本书知识点</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索知识点或章节名称" /></label>
      {error ? <div className={styles.empty} role="alert"><p>{error}</p><button type="button" onClick={() => { setError(""); setChapters(null); setRetry((n) => n + 1); }}>重新加载</button></div> : chapters === null ? <p className={styles.empty} role="status">正在整理本书知识…</p> : !filtered?.length ? <p className={styles.empty}>{search ? "没有找到相关知识点，换个关键词试试。" : "当前还没有可阅读章节。"}</p> : <div className={styles.directory}>{filtered.map((entry) => <details key={entry.chapter_no} open={search ? true : undefined}>
        <summary><BookOpen size={16} /><span>第 {entry.chapter_no} 章 · {chapterTitle(entry.title)}</span><small>{entry.knowledge_points.length} 个</small><ChevronDown size={15} /></summary>
        <Points points={entry.knowledge_points} />
        {entry.chapter_no !== chapter.chapter_no && <Link className={styles.read} onClick={onNavigate} href={`/book/${bookId}?chapter=${entry.chapter_no}`}>阅读这一章 <ArrowUpRight size={14} /></Link>}
      </details>)}</div>}
    </>}
  </section>;
}
