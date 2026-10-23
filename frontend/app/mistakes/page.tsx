"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown, NotebookPen, RotateCcw, Search } from "lucide-react";
import { api, errorMessage, Mistake } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { chapterTitle, knowledgeTitle, optionLabels, optionLetter, QUESTION_KINDS } from "@/lib/chapter";
import { SiteFooter, SiteHeader } from "@/components/site/SiteHeader";
import styles from "./notebook.module.css";
import { CoverIllustration } from "@/components/site/CoverIllustration";

const BOOK_PAGE_SIZE = 12;
const QUESTION_PAGE_SIZE = 20;
function subscribeBook(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("notebook-book", callback);
  return () => { window.removeEventListener("popstate", callback); window.removeEventListener("notebook-book", callback); };
}
function currentBook() { return new URLSearchParams(window.location.search).get("book") || ""; }
function Pagination({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  if (total <= 1) return null;
  return <nav className={styles.pagination} aria-label="错题本分页"><button disabled={page <= 1} onClick={() => onChange(page - 1)}><ArrowLeft size={14} />上一页</button><span>第 {page} / {total} 页</span><button disabled={page >= total} onClick={() => onChange(page + 1)}>下一页<ArrowRight size={14} /></button></nav>;
}

export default function MistakesPage() {
  const { user, ready } = useAccount(true);
  const [items, setItems] = useState<Mistake[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const book = useSyncExternalStore(subscribeBook, currentBook, () => "");
  const [chapter, setChapter] = useState("");
  const [page, setPage] = useState(1);
  const [opened, setOpened] = useState<number | null>(null);
  function resetList() { setPage(1); setOpened(null); }
  function selectBook(id: string) {
    window.history.pushState(null, "", id ? `/mistakes?book=${id}` : "/mistakes");
    window.dispatchEvent(new Event("notebook-book"));
    setChapter(""); setQuery(""); setNotice(""); resetList();
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  const [filter, setFilter] = useState<"pending" | "mastered" | "all">("pending");
  const [busy, setBusy] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api.mistakes().then(({ mistakes }) => { if (!cancelled) setItems(mistakes); })
      .catch((cause) => { if (!cancelled) setError(errorMessage(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, retry]);

  useEffect(() => {
    const reset = () => { setChapter(""); setQuery(""); setPage(1); setOpened(null); setNotice(""); };
    window.addEventListener("popstate", reset);
    return () => window.removeEventListener("popstate", reset);
  }, []);

  async function toggle(item: Mistake) {
    if (busy !== null) return;
    setBusy(item.id); setUpdateError(""); setNotice("");
    try {
      const result = await api.updateMistake(item.id, !item.mastered);
      setItems((old) => old.map((value) => value.id === item.id ? { ...value, mastered: result.mastered } : value));
      setNotice(result.mastered ? "已移入「已掌握」，需要时可以移回待巩固。" : "已移回「待巩固」。");
    } catch (cause) { setUpdateError(errorMessage(cause)); }
    finally { setBusy(null); }
  }

  const search = query.trim().toLocaleLowerCase();
  const groups = new Map<number, Mistake[]>();
  for (const item of items) {
    const entries = groups.get(item.book_id);
    if (entries) entries.push(item); else groups.set(item.book_id, [item]);
  }
  const selected = book ? groups.get(Number(book)) : undefined;
  const scope = book ? selected ?? [] : items;
  const pending = scope.filter((item) => !item.mastered).length;
  const matches = (item: Mistake) => (filter === "all" || item.mastered === (filter === "mastered")) && `${item.question} ${item.knowledge} ${item.topic} ${item.book_title}`.toLocaleLowerCase().includes(search);
  const books = [...groups.entries()].map(([id, entries]) => ({ id, entries, matches: entries.filter(matches) })).filter((group) => group.matches.length > 0);
  const chapters = [...new Set(scope.map((item) => item.chapter_no))].sort((a, b) => a - b);
  const visible = scope.filter((item) => matches(item) && (!chapter || item.chapter_no === Number(chapter))).sort((a, b) => a.chapter_no - b.chapter_no || b.created_at.localeCompare(a.created_at) || b.id - a.id);
  const totalPages = Math.max(1, Math.ceil((book ? visible.length : books.length) / (book ? QUESTION_PAGE_SIZE : BOOK_PAGE_SIZE)));
  const currentPage = Math.min(page, totalPages);
  const shownBooks = books.slice((currentPage - 1) * BOOK_PAGE_SIZE, currentPage * BOOK_PAGE_SIZE);
  const shownQuestions = visible.slice((currentPage - 1) * QUESTION_PAGE_SIZE, currentPage * QUESTION_PAGE_SIZE);
  const chapterGroups = [...new Set(shownQuestions.map((item) => item.chapter_no))];
  const title = selected?.[0].book_title || (selected?.[0].topic ? `${selected[0].topic}之旅` : "这本书的错题");
  function changePage(next: number) { setPage(next); setOpened(null); document.getElementById("notebook-tools")?.scrollIntoView({ block: "start" }); }

  return <div className="site-shell">
    <SiteHeader user={user} ready={ready} />
    <main className={styles.room}><div className={styles.workspace}>
      <header className={styles.heading}>
        {book ? <button className={styles.back} onClick={() => selectBook("")}><ArrowLeft size={15} />全部错题书本</button> : <p className={styles.eyebrow}><NotebookPen size={16} /> 学习手记</p>}
        {book ? <div className={styles.bookHero}>
          <div className={`${styles.heroCover} ${styles[`tone${Number(book) % 3}`]}`} aria-hidden="true"><span>悦读 · 学习手记</span><strong>{title}</strong><CoverIllustration variant={Number(book) % 6} /></div>
          <div className={styles.heroText}><p className={styles.heroKicker}>错题手记 <span>/</span> {selected?.[0].topic || "学习与回顾"}</p><h1>{title}</h1><p className={styles.intro}>把没记牢的地方，再读懂一点。</p><div className={styles.heroMeta}><span><b>{scope.length}</b> 道错题</span><i /><span><b>{chapters.length}</b> 个章节</span><span className={styles.savedNote}><NotebookPen size={13} />随学习自动收录</span></div></div>
        </div> : <><div className={styles.titleRow}><h1>我的错题本</h1>{!loading && !error && <span className={styles.total}>{groups.size} 本书 · {items.length} 道错题</span>}</div><p className={styles.intro}>一本书，一份学习手记。选一本，回顾还没记牢的知识。</p></>}

      </header>
      <div className={styles.tools} id="notebook-tools">
        <div className={styles.tabs} role="group" aria-label="错题分类">{([['pending', `待巩固 ${pending}`], ['mastered', `已掌握 ${scope.length - pending}`], ['all', `全部 ${scope.length}`]] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setNotice(""); resetList(); }}>{label}</button>)}</div>
        <div className={styles.filters}>
          <label className={styles.search}><Search size={16} /><span className="sr-only">搜索书名、错题或知识点</span><input type="search" placeholder={book ? "搜索本书错题或知识点" : "搜索书名、错题或知识点"} value={query} onChange={(event) => { setQuery(event.target.value); resetList(); }} /></label>
          {book && <label className={styles.chapterFilter}><span className="sr-only">按章节筛选</span><select value={chapter} onChange={(event) => { setChapter(event.target.value); resetList(); }}><option value="">全部章节</option>{chapters.map((no) => <option key={no} value={no}>第 {no} 章</option>)}</select><ChevronDown size={14} /></label>}
        </div>
      </div>
      {notice && <p role="status" className={styles.notice}><Check size={15} />{notice}</p>}
      {updateError && <p role="alert" className={styles.error}>{updateError} 请重新点击状态按钮重试。</p>}
      {ready && !user ? <div className={styles.empty} role="alert"><p>暂时无法获取登录状态，请刷新页面重试。</p><button className="button button-light" onClick={() => window.location.reload()}>刷新页面</button><Link href="/login?next=%2Fmistakes">前往登录</Link></div> : loading ? <div className={styles.empty} role="status">正在整理你的错题…</div> : error ? <div className={styles.empty} role="alert"><p>{error}</p><button className="button button-light" onClick={() => { setLoading(true); setError(""); setRetry((v) => v + 1); }}>重新加载</button></div> : (book ? visible.length === 0 : books.length === 0) ? <div className={styles.empty}><NotebookPen size={32} strokeWidth={1.2} /><h2>{items.length === 0 ? "每一次学习，都值得留下收获" : search || chapter ? "没有找到匹配的错题" : filter === "pending" ? "暂时没有待巩固的错题" : "这里还没有相关错题"}</h2><p>{items.length === 0 ? "闯关中答错的题会按书自动收录，讲解和原文线索也会一起保留。" : "可以切换分类，或选择另一本书继续复习。"}</p>{search || chapter ? <button className="button button-light" onClick={() => { setQuery(""); setChapter(""); resetList(); }}>清除筛选</button> : book ? <button className="button button-light" onClick={() => selectBook("")}>返回全部错题书本</button> : <Link className="button button-light" href="/library">去学习书架 <ArrowUpRight size={15} /></Link>}</div> : !book ? <>
        <p className={styles.listLabel}>{books.length} 本书{search ? "包含匹配的错题" : " · 按最近收录排列"}</p>
        <div className={styles.bookGrid}>{shownBooks.map(({ id, entries, matches: matched }) => {
          const first = entries[0]; const left = entries.filter((entry) => !entry.mastered).length;
          return <button type="button" className={styles.bookCard} key={id} onClick={() => selectBook(String(id))} aria-label={`查看《${first.book_title || `${first.topic}之旅`}》的错题`}>
            <span className={`${styles.cover} ${styles[`tone${id % 3}`]}`} aria-hidden="true"><BookOpen size={17} /><CoverIllustration variant={id % 6} /></span>
            <span className={styles.bookInfo}><span className={styles.topic}>{first.topic}</span><strong>{first.book_title || `${first.topic}之旅`}</strong><span className={styles.bookCounts}><b>{left} 待巩固</b><span>{entries.length - left} 已掌握</span></span><span className={styles.bookMeta}>{new Set(entries.map((entry) => entry.chapter_no)).size} 个章节 · 共 {entries.length} 道{search && ` · 匹配 ${matched.length} 道`}</span></span><ArrowRight size={16} className={styles.bookArrow} />
          </button>;
        })}</div>
        <Pagination page={currentPage} total={totalPages} onChange={changePage} />
      </> : <>
        <div className={styles.listLabel}><span>复习清单 · {visible.length} 道</span><span>{visible.length > QUESTION_PAGE_SIZE ? `每页 ${QUESTION_PAGE_SIZE} 道 · ` : ""}点击题目，展开复习</span></div>
        <div className={styles.chapterList}>{chapterGroups.map((no) => <section className={styles.chapterGroup} key={no} aria-label={`第 ${no} 章错题`}>
          <h2 className={styles.chapterHeading}><span className={styles.chapterTag}>第 {no} 章</span><span>{chapterTitle(shownQuestions.find((item) => item.chapter_no === no)?.chapter_title || "")}</span><small>{visible.filter((item) => item.chapter_no === no).length} 道错题</small></h2><div className={styles.paper}>
          {shownQuestions.filter((item) => item.chapter_no === no).map((item) => {
            const options = optionLabels(item.options); const open = opened === item.id;
            return <article className={`${styles.questionRow} ${open ? styles.isOpen : ""}`} key={item.id}>
              <h3><button type="button" className={styles.questionToggle} aria-expanded={open} aria-controls={`mistake-${item.id}`} onClick={() => setOpened(open ? null : item.id)}><span className={styles.rowNumber} aria-hidden="true">{String((currentPage - 1) * QUESTION_PAGE_SIZE + shownQuestions.indexOf(item) + 1).padStart(2, "0")}</span><span className={styles.rowText}><span className={styles.rowMeta}><span className={styles.kind}>{item.mastered ? "已掌握" : QUESTION_KINDS[item.type] || "待巩固"}</span><span>{item.knowledge ? knowledgeTitle(item.knowledge) : "知识回顾"}</span></span><strong>{item.question}</strong></span><ChevronDown size={16} className={open ? styles.rotated : ""} /></button></h3>
              {open && <div className={styles.detailBody} id={`mistake-${item.id}`}>
                <p className={styles.detailLabel}>作答回顾</p><div className={styles.options}>{options.map((option, index) => <div key={index} className={index === item.answer ? styles.correct : index === item.choice ? styles.wrong : ""}><span>{optionLetter(index)}</span><p>{option}</p>{index === item.choice && <small>当时的选择</small>}</div>)}</div>
                <p className={styles.answer}><Check size={16} /><span>正确答案：{optionLetter(item.answer)}. {options[item.answer]}</span></p>
                {(item.explanation || item.knowledge) && <p className={styles.explanation}>{item.explanation || item.knowledge}</p>}
                {item.source_excerpt && <details className={styles.excerpt}><summary>书中原文摘录 <ChevronDown size={14} /></summary><blockquote>{item.source_excerpt}</blockquote></details>}
                <footer className={styles.cardFoot}><Link href={`/book/${item.book_id}?chapter=${item.chapter_no}&mistake=${item.id}`}><BookOpen size={16} />回到书中知识 <ArrowUpRight size={14} /></Link><button type="button" disabled={busy !== null} aria-label={`${item.mastered ? '移回待巩固' : '标为已掌握'}：${item.question}`} onClick={() => void toggle(item)}>{item.mastered ? <RotateCcw size={14} /> : <Check size={14} />}{busy === item.id ? "保存中…" : item.mastered ? "移回待巩固" : "标为已掌握"}</button></footer>
              </div>}
            </article>;
          })}</div>
        </section>)}</div>
        <Pagination page={currentPage} total={totalPages} onChange={changePage} />
      </>}
    </div></main><SiteFooter />
  </div>;
}
