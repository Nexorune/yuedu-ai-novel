"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Check, Plus, Search } from "lucide-react";
import { api, BookSummary, errorMessage } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { loadLastBook } from "@/lib/prefs";
import { SiteFooter, SiteHeader } from "@/components/site/SiteHeader";
import styles from "./shelves.module.css";
import { CoverIllustration } from "@/components/site/CoverIllustration";

function progress(book: BookSummary) {
  const total = Math.max(1, book.planned_chapters);
  const passed = book.status === "completed" ? total : Math.max(0, Math.min(total, book.current_chapter ?? 0));
  return { total, passed };
}

function Shelf({ title, books, searching }: { title: string; books: BookSummary[]; searching: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded || searching ? books : books.slice(0, 6);
  return (
    <section className={styles.shelf} aria-label={title}>
      <div className={styles.shelfHeading}>
        <h2>{title}<span>{books.length} 本</span></h2>
        {books.length > 6 && !searching && <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? "收起书架" : "展开全部"}<ArrowRight size={14} /></button>}
      </div>
      {books.length === 0 ? <p className={styles.emptyShelf}>{searching ? "这里没有匹配的书。" : "读完的故事，会在这里留下学习的足迹。"}</p> : (
        <div className={styles.books}>
          {visible.map((book) => {
            const { passed, total } = progress(book);
            const title = book.title || `${book.topic}之旅`;
            return (
              <Link href={`/book/${book.id}`} className={styles.book} key={book.id} aria-label={`${title}，学习${book.topic}，已闯过 ${passed} / ${total} 章`}>
                <div className={`${styles.cover} ${styles[`tone${book.id % 6}`]}`}>
                  <span className={styles.coverGenre}>{book.genre} · {book.mode === "quick" ? "短篇" : "连载"}</span>
                  <strong title={title}>{title}</strong>
                  <span className={styles.coverArt} aria-hidden="true"><CoverIllustration variant={book.id % 6} /></span>
                  <span className={styles.coverImprint}>悦 读 · 故 事 藏 知</span>
                </div>
                <div className={styles.bookInfo}>
                  <h3 title={book.topic}>{book.topic}</h3>
                  <div className={styles.progress} aria-label={`学习进度 ${Math.round(passed / total * 100)}%`}><span style={{ width: `${passed / total * 100}%` }} /></div>
                  <small>{book.status === "completed" ? <><Check size={12} /> 已学完</> : `${passed} / ${total} 章已闯过`}</small>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function LibraryPage() {
  const { user, ready } = useAccount(true);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [lastBookId, setLastBookId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api.books().then((result) => {
      if (!cancelled) { setBooks(result); setLastBookId(loadLastBook()); }
    }).catch((cause) => { if (!cancelled) setError(errorMessage(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, retry]);

  if (!ready) return <div className="app-loading">正在打开学习书架…</div>;
  if (!user) return <div className="app-loading">暂时无法读取账号，请<Link href="/login?next=%2Flibrary">重新登录</Link>。</div>;
  const reading = books.filter((book) => book.status !== "completed");
  const finished = books.filter((book) => book.status === "completed");
  const last = reading.find((book) => book.id === lastBookId) ?? reading[0];
  const ordered = last ? [last, ...reading.filter((book) => book.id !== last.id)] : reading;
  const search = query.trim().toLocaleLowerCase();
  const matches = (book: BookSummary) => `${book.title} ${book.topic} ${book.genre}`.toLocaleLowerCase().includes(search);
  const passed = books.reduce((sum, book) => sum + progress(book).passed, 0);

  return (
    <div className="site-shell">
      <SiteHeader user={user} />
      <main className={styles.room}>
        <div className={styles.toolbar}>
          <span className={styles.toolbarLabel}><BookOpen size={17} /> 我的书房</span>
          <label className={styles.search}><Search size={16} /><span className="sr-only">搜索书名或学习主题</span><input type="search" placeholder="搜索书名或学习主题" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <Link href="/create" className={styles.newBook}><Plus size={17} /><span>新建学习</span></Link>
        </div>
        <div className={styles.heading}>
          <div><p>每读一章，都离新知识近一点</p><h1>我的学习书架</h1></div>
          {!loading && !error && <p className={styles.stats}>在学 <b>{reading.length}</b><i />读完 <b>{finished.length}</b><i />闯过 <b>{passed}</b> 章</p>}
        </div>
        {loading ? <div className={styles.status} role="status">正在整理你的书架…</div> : error ? (
          <div className={styles.status} role="alert"><p>{error}</p><button className="button button-light" onClick={() => { setError(""); setLoading(true); setRetry((v) => v + 1); }}>重新加载</button></div>
        ) : books.length === 0 ? (
          <div className={styles.status}><BookOpen size={36} strokeWidth={1} /><h2>书架上的第一本，等你开启</h2><p>选一个想学的主题，把它读成故事。</p><Link className="button button-primary" href="/create">开始新的学习 <ArrowRight size={17} /></Link></div>
        ) : (
          <>
            {last && !search && <Link className={styles.continue} href={`/book/${last.id}`}><span className={styles.bookmark}><BookOpen size={18} /></span><span><small>接着上次读</small><strong>《{last.title || `${last.topic}之旅`}》</strong></span><span className={styles.continueAction}>继续学习 <ArrowRight size={16} /></span></Link>}
            {search && !books.some(matches) ? <div className={styles.status}><p>没有找到相关的书，换个书名或主题试试。</p><button className="button button-light" onClick={() => setQuery("")}>清除搜索</button></div> : <>
              <Shelf title="正在学习" books={ordered.filter(matches)} searching={!!search} />
              <Shelf title="已经读完" books={finished.filter(matches)} searching={!!search} />
            </>}
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
