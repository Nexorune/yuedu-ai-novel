"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, ChevronDown, ChevronRight, Feather, History } from "lucide-react";
import { api, BookSummary, errorMessage } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { loadLastBook } from "@/lib/prefs";
import { saveTask } from "@/lib/task";
import { SiteFooter, SiteHeader } from "@/components/site/SiteHeader";

const GENRES = [
  { value: "爽文", desc: "逆袭升级，节奏爽快" },
  { value: "言情", desc: "感情线里学知识" },
  { value: "都市", desc: "职场生活，贴近现实" },
  { value: "玄幻", desc: "修炼设定，脑洞大开" },
  { value: "悬疑", desc: "解谜推理，环环相扣" },
];

const EXAMPLES = ["复利", "英语时态", "蝴蝶效应", "光合作用", "博弈论"];

// 「学多深」三档，对应后端的阅读方式与计划章节数；更细的数字放在「更多设置」
const DEPTHS = [
  { key: "quick", label: "快速了解", desc: "1 章短篇，约 5 分钟读完", mode: "quick", chapters: 1 },
  { key: "system", label: "系统学习", desc: "5 章连载，循序渐进", mode: "full", chapters: 5 },
  { key: "deep", label: "深入掌握", desc: "10 章连载，层层展开", mode: "full", chapters: 10 },
] as const;

type DepthKey = (typeof DEPTHS)[number]["key"];

const RECENT_COUNT = 4;

function bookTitle(book: BookSummary): string {
  return book.title || book.topic + "之旅";
}

/** 已闯过几章 / 共几章；完结的书算满。 */
function bookProgress(book: BookSummary): { passed: number; total: number } {
  const total = Math.max(1, book.planned_chapters);
  const passed = book.status === "completed" ? total : Math.min(total, book.current_chapter ?? 0);
  return { passed, total };
}

export default function CreatePage() {
  const router = useRouter();
  const { user, ready } = useAccount(true);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [lastBookId, setLastBookId] = useState<number | null>(null);
  const [genre, setGenre] = useState("爽文");
  const [topic, setTopic] = useState("");
  const [depth, setDepth] = useState<DepthKey>("system");
  const [chapters, setChapters] = useState(5);
  const [minWords, setMinWords] = useState(1500);
  const [maxWords, setMaxWords] = useState(2500);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const mode = depth === "quick" ? "quick" : "full";

  const loadBooks = useCallback(async () => {
    setLoading(true);
    setListError("");
    try {
      setBooks(await api.books());
    } catch (error) {
      setListError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    const timer = window.setTimeout(() => {
      setLastBookId(loadLastBook());
      void loadBooks();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [user, loadBooks]);

  // 从阅读页返回书架时，书架区是异步渲染的；等它出现后再定位，避免停在页面顶部
  useEffect(() => {
    if (!user) return;
    const hash = window.location.hash;
    if (hash === "#books" || hash === "#create") {
      const timer = window.setTimeout(() => {
        document.getElementById(hash.slice(1))?.scrollIntoView();
      }, 120);
      return () => window.clearTimeout(timer);
    }
  }, [user]);

  function chooseDepth(key: DepthKey) {
    setDepth(key);
    const chosen = DEPTHS.find((item) => item.key === key);
    if (chosen && chosen.mode === "full") setChapters(chosen.chapters);
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!topic.trim()) {
      setFormError("先写下你想学的东西，比如「复利」。");
      document.getElementById("topic-input")?.focus();
      return;
    }
    if (mode === "full" && (!Number.isInteger(chapters) || chapters < 1 || chapters > 50)) {
      setFormError("章节数请填 1 到 50（在「更多设置」里）。");
      return;
    }
    if (minWords < 800 || minWords > 5000 || maxWords < minWords || maxWords > 10000) {
      setFormError("请检查「更多设置」里的每章字数范围。");
      return;
    }
    setFormError("");
    setSubmitting(true);
    try {
      const result = await api.createBook({
        genre,
        topic: topic.trim(),
        mode,
        planned_chapters: mode === "quick" ? 1 : chapters,
        min_words: minWords,
        max_words: maxWords,
      });
      saveTask(result.book_id, { id: result.task_id, kind: "outline" });
      router.push("/book/" + result.book_id + "?task=" + result.task_id);
    } catch (error) {
      setFormError(errorMessage(error) + " 如提交后连接中断，请先看看下方学习记录里是否已经创建。");
      setSubmitting(false);
      void loadBooks();
    }
  }

  if (!ready || !user) return <div className="app-loading">正在打开悦读…</div>;

  const continueBook = books.find((book) => book.id === lastBookId && book.status === "reading") ?? books.find((book) => book.status === "reading");
  const continueProgress = continueBook ? bookProgress(continueBook) : null;
  const visibleBooks = showAll ? books : books.slice(0, RECENT_COUNT);

  return (
    <div className="site-shell">
      <SiteHeader user={user} nav={[{ href: "#create", label: "新建" }, { href: "#books", label: "学习记录" }]} />

      <main className="home-main">
        <section id="create" className="create-page">
          <div className="create-head">
            <p className="eyebrow"><span className="eyebrow-line" /> 开始一本新书</p>
            <h1>想学什么，就读一本关于它的小说。</h1>
            <p>写下想学的知识，悦读为你写一本小说；每章读完答几道题，答对就解锁下一章。</p>
          </div>
          {continueBook && continueProgress && (
            <Link href={"/book/" + continueBook.id} className="continue-strip">
              <span className="continue-icon"><History size={20} /></span>
              <span className="continue-text">
                <small>继续上次学习</small>
                <b>{continueBook.topic}</b>
                <span>《{bookTitle(continueBook)}》· 已闯过 {continueProgress.passed} / {continueProgress.total} 章</span>
              </span>
              <span className="continue-go">接着读 <ArrowRight size={17} /></span>
            </Link>
          )}
          <form className="create-panel" onSubmit={create} noValidate>
            <label className="topic-field" htmlFor="topic-input">
              <span>你想学什么？</span>
              <input id="topic-input" value={topic} maxLength={60} autoComplete="off" onChange={(event) => { setTopic(event.target.value); if (formError) setFormError(""); }} placeholder="例如：复利、英语时态、光合作用" />
            </label>
            <div className="topic-examples" aria-label="示例主题">
              <span>试试：</span>
              {EXAMPLES.map((example) => (
                <button type="button" key={example} className={topic === example ? "chip selected" : "chip"} onClick={() => { setTopic(example); setFormError(""); }}>{example}</button>
              ))}
            </div>

            <fieldset className="choice-group">
              <legend>喜欢哪种故事？</legend>
              <div className="genre-grid">
                {GENRES.map((item) => (
                  <label key={item.value} className={genre === item.value ? "choice-card selected" : "choice-card"}>
                    <input type="radio" name="genre" checked={genre === item.value} onChange={() => setGenre(item.value)} />
                    <b>{item.value}</b><small>{item.desc}</small>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="choice-group">
              <legend>想学多深？</legend>
              <div className="depth-grid">
                {DEPTHS.map((item) => (
                  <label key={item.key} className={depth === item.key ? "choice-card selected" : "choice-card"}>
                    <input type="radio" name="depth" checked={depth === item.key} onChange={() => chooseDepth(item.key)} />
                    <b>{item.label}</b><small>{item.desc}</small>
                  </label>
                ))}
              </div>
            </fieldset>

            <details className="more-settings">
              <summary>更多设置 <ChevronDown size={15} /></summary>
              <div className="form-row">
                {mode === "full" && <label className="field"><span>计划章节</span><input type="number" min="1" max="50" value={chapters} onChange={(event) => setChapters(Number(event.target.value))} /></label>}
                <label className="field"><span>每章最少字数</span><input type="number" min="800" max="5000" value={minWords} onChange={(event) => setMinWords(Number(event.target.value))} /></label>
                <label className="field"><span>每章最多字数</span><input type="number" min="800" max="10000" value={maxWords} onChange={(event) => setMaxWords(Number(event.target.value))} /></label>
              </div>
            </details>

            {formError && <p className="form-error" role="alert">{formError}</p>}
            <button className="button button-primary button-wide" disabled={submitting} type="submit">{submitting ? "正在创建，请稍候…" : "开始生成"} <ArrowRight size={18} /></button>
            <p className="form-footnote">会调用模型、产生少量费用。大约 2–4 分钟后就能读到第一章，等待时可以离开页面。</p>
          </form>
        </section>

        <section id="books" className="books-section">
          <div className="section-heading">
            <div><p className="eyebrow">YOUR LEARNING</p><h2>学习记录</h2><p>学过的主题都在这里，随时回去接着学。</p></div>
            {books.length > RECENT_COUNT && (
              <button type="button" className="button button-light" onClick={() => setShowAll((old) => !old)}>{showAll ? "收起" : `查看全部（${books.length}）`}</button>
            )}
          </div>
          {loading ? (
            <div className="book-status" role="status">正在整理你的学习记录…</div>
          ) : listError ? (
            <div className="book-status error-box" role="alert"><p>{listError}</p><button className="button button-light" onClick={() => void loadBooks()}>重新加载</button></div>
          ) : books.length === 0 ? (
            <div className="book-status empty-state"><BookOpen size={31} strokeWidth={1.4} /><h3>还没有学习记录</h3><p>在上面写下想学的东西，生成你的第一本书。</p><a href="#create">开始学习 <ChevronRight size={16} /></a></div>
          ) : (
            <div className="book-grid">
              {visibleBooks.map((book) => {
                const { passed, total } = bookProgress(book);
                return (
                  <Link href={"/book/" + book.id} className="book-card" key={book.id}>
                    <div className={"book-cover cover-" + (book.id % 4)}><span className="cover-top">{book.genre} · {book.mode === "quick" ? "短篇" : "连载"}</span><span className="cover-title">{book.topic}</span><span className="cover-foot">悦读原创故事 <Feather size={15} /></span></div>
                    <div className="book-card-body"><div><h3>{book.topic}</h3><p>《{bookTitle(book)}》</p></div><span className="book-arrow" aria-label="打开这本书"><ArrowRight size={18} /></span></div>
                    <div className="book-progress" aria-label={`已闯过 ${passed} / ${total} 章`}>
                      <span className="book-progress-bar"><span style={{ width: `${(passed / total) * 100}%` }} /></span>
                      <small>{book.status === "completed" ? "已学完" : `${passed} / ${total} 章`}</small>
                    </div>
                    <span className={"book-state " + (book.status === "completed" ? "book-state-done" : "")}>{book.status === "completed" ? "已完结" : "学习中"}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
