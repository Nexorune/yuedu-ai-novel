"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ALargeSmall, ArrowLeft, ArrowRight, BookOpen, CircleAlert, CircleCheck, Flag, Images, List, RotateCcw, Sparkles, Swords, X } from "lucide-react";
import { api, AnswerResult, AnswerReveal, AppError, Book, Chapter, errorMessage, Mistake, Progress, Recap, Task } from "@/lib/api";
import { ActiveTask, clearTask, loadTask, saveTask, taskState } from "@/lib/task";
import { chapterTitle, countChars, findMistakeParagraph, findParagraph, knowledgeTerms, parseChapter, readingMinutes } from "@/lib/chapter";
import { loadPosition, loadReadingSize, loadReadingTheme, READING_SIZES, ReadingSize, ReadingTheme, saveLastBook, savePosition, saveReadingSize, saveReadingTheme, stepReadingSize } from "@/lib/prefs";
import { QuizMode } from "@/components/reader/QuizMode";
import { SettingsSheet, TocDrawer } from "@/components/reader/ReaderSheets";
import { WaitingPanel } from "@/components/reader/WaitingPanel";

const HINTS: Record<string, string> = {
  retry_new_questions: "适中难度，与原文一致",
  retry_lower_difficulty: "偏简单，答案尽量能在原文直接找到",
  retry_easiest: "最易：纯定位题，答案直接在原文里，一眼能看到",
};

function failAction(fails: number): keyof typeof HINTS {
  if (fails >= 3) return "retry_easiest";
  if (fails === 2) return "retry_lower_difficulty";
  return "retry_new_questions";
}

export default function ReadingPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const bookId = Number(params.id);
  const mistakeId = Number(searchParams.get("mistake")) || null;
  const [mistake, setMistake] = useState<Mistake | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [outlineReady, setOutlineReady] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<ActiveTask | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [prefetchTask, setPrefetchTask] = useState<number | null>(null);
  const [prefetchReady, setPrefetchReady] = useState(false);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [returnToQuiz, setReturnToQuiz] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [readingSize, setReadingSize] = useState<ReadingSize>("m");
  const [theme, setTheme] = useState<ReadingTheme>("paper");
  const [tocOpen, setTocOpen] = useState(false);
  const [drawerView, setDrawerView] = useState<"chapters" | "knowledge">("chapters");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [barsHidden, setBarsHidden] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [flashPara, setFlashPara] = useState<number | null>(null);
  const [resumed, setResumed] = useState(false);
  const prefetchedChapter = useRef("");
  const autoStarted = useRef(false);
  const levelRef = useRef<HTMLDivElement | null>(null);
  const afterRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async (target?: number) => {
    if (!Number.isInteger(bookId) || bookId <= 0) {
      setError("这本书的地址不正确。");
      setLoading(false);
      return;
    }
    try {
      if (mistakeId) {
        const { mistake: saved } = await api.mistake(mistakeId);
        if (saved.book_id !== bookId) throw new AppError("HTTP_404", "这道错题不属于当前书籍，请返回错题本重新打开。");
        setMistake(saved);
        target = target || saved.chapter_no;
      }
      const detail = await api.book(bookId);
      setBook(detail.book);
      setOutlineReady(detail.outline_ready);
      setProgress(detail.progress);
      if (!mistakeId) saveLastBook(bookId);
      const next = detail.progress.current_chapter + 1;
      let found: Chapter | null = null;
      if (target) {
        // 指定章节打不开（不存在或还没解锁）时，回到正常的阅读进度
        found = mistakeId ? (await api.chapter(bookId, target)).chapter : await api.chapter(bookId, target).then((response) => response.chapter).catch(() => null);
      }
      if (!found) {
        try {
          found = (await api.chapter(bookId, next)).chapter;
        } catch (cause) {
          if (!(cause instanceof AppError && cause.code === "HTTP_404")) throw cause;
          if (detail.progress.current_chapter > 0) {
            found = (await api.chapter(bookId, detail.progress.current_chapter)).chapter;
          }
        }
      }
      setChapter(found);
      setError("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [bookId, mistakeId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const target = Number(searchParams.get("chapter"));
      void load(Number.isInteger(target) && target > 0 ? target : undefined);
      setReadingSize(loadReadingSize());
      setTheme(loadReadingTheme());
      const stored = loadTask(bookId);
      const queryId = Number(searchParams.get("task"));
      setActive(mistakeId ? null : stored || (Number.isInteger(queryId) && queryId > 0 ? { id: queryId, kind: "outline" } : null));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [bookId, load, searchParams, mistakeId]);

  // 阅读背景作用在阅读页（含闯关弹层）；首页等其他页面不受影响
  useEffect(() => {
    if (theme === "paper") delete document.documentElement.dataset.readingTheme;
    else document.documentElement.dataset.readingTheme = theme;
  }, [theme]);

  const paragraphs = useMemo(() => (chapter ? parseChapter(chapter.content) : []), [chapter]);
  const chapterNo = chapter?.chapter_no;
  const mistakeParagraph = mistake && mistake.chapter_no === chapterNo ? findMistakeParagraph(paragraphs, mistake) : -1;

  useEffect(() => {
    if (mistakeParagraph < 0) return;
    const timer = window.setTimeout(() => {
      const target = document.getElementById("pi-" + mistakeParagraph);
      if (target) window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 100, behavior: "instant" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [mistakeParagraph, chapterNo]);

  // 打开章节：回到上次读到的段落；没读过就从头开始
  useEffect(() => {
    if (chapterNo === undefined || mistakeId) return;
    const timer = window.setTimeout(() => {
      const saved = loadPosition(bookId);
      const target = saved && saved.chapter === chapterNo && saved.paragraph >= 2 ? document.getElementById("pi-" + saved.paragraph) : null;
      if (target) {
        window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 88, behavior: "instant" });
        setResumed(true);
      } else {
        window.scrollTo({ top: 0, behavior: "instant" });
        setResumed(false);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [bookId, chapterNo, mistakeId]);

  useEffect(() => {
    if (!resumed) return;
    const timer = window.setTimeout(() => setResumed(false), 6000);
    return () => window.clearTimeout(timer);
  }, [resumed]);

  // 滚动：顶部进度细线、往下读时收起工具栏、记住读到哪一段
  useEffect(() => {
    let frame = 0;
    let lastY = window.scrollY;
    let lastSave = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setScrollProgress(max > 0 ? Math.min(1, Math.max(0, y / max)) : 0);
      if (y < 80) setBarsHidden(false);
      else if (y - lastY > 8) setBarsHidden(true);
      else if (lastY - y > 8) setBarsHidden(false);
      lastY = y;
      const now = Date.now();
      if (!mistakeId && chapterNo !== undefined && now - lastSave > 600) {
        lastSave = now;
        const items = document.querySelectorAll<HTMLElement>(".r-para");
        for (let i = 0; i < items.length; i++) {
          if (items[i].getBoundingClientRect().bottom > 96) {
            savePosition(bookId, { chapter: chapterNo, paragraph: i });
            break;
          }
        }
      }
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.cancelAnimationFrame(frame);
    };
  }, [bookId, chapterNo, mistakeId]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: number | undefined;
    let failures = 0;
    const started = Date.now();
    async function check() {
      if (document.hidden) {
        timer = window.setTimeout(() => void check(), 5000);
        return;
      }
      try {
        const current = await api.task(active!.id);
        if (cancelled) return;
        failures = 0;
        setError("");
        setTask(current);
        setSeconds(Math.floor((Date.now() - started) / 1000));
        if (current.status === "done" || current.status === "error") {
          clearTask(bookId);
          setActive(null);
          if (current.status === "done") {
            setResult(null);
            await load();
          } else {
            setError((current.error || "生成没有完成，请稍后重试。") + " 已有的阅读内容仍会保留。");
          }
          return;
        }
        if (taskState(current.status) === "unknown") setError("任务状态暂时无法确认；请稍后刷新页面。");
      } catch (cause) {
        if (cancelled) return;
        failures++;
        setError(errorMessage(cause) + " 任务可能仍在后台进行，恢复连接后会继续查询。");
      }
      if (!cancelled) timer = window.setTimeout(() => void check(), failures ? Math.min(15_000, 5000 * failures) : 1500);
    }
    void check();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [active, bookId, load]);

  // 等待生成时，拉取「上回说到」、复习卡片、登场人物（只含已读部分）
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    api.recap(bookId).then((data) => { if (!cancelled) setRecap(data); }).catch(() => { /* 没有也不影响等待 */ });
    return () => { cancelled = true; };
  }, [active, bookId]);

  // 来到闯关区时在后台提前写下一章（规则与之前一致：通关前读不到）
  useEffect(() => {
    const chapterKey = `${bookId}:${chapter?.chapter_no}`;
    if (mistakeId || !chapter || !book || !progress || chapter.status === "unlocked" || chapter.is_ending ||
        book.status !== "reading" || chapter.chapter_no >= book.planned_chapters ||
        chapter.chapter_no !== progress.current_chapter + 1 || prefetchedChapter.current === chapterKey) return;
    const level = levelRef.current;
    if (!level) return;
    const startPrefetch = () => {
      if (prefetchedChapter.current === chapterKey) return;
      prefetchedChapter.current = chapterKey;
      setPrefetchReady(false);
      setPrefetchTask(null);
      void api.prefetchNext(bookId, chapter.chapter_no).then((response) => {
        setPrefetchTask(response.task_id);
        setPrefetchReady(response.ready);
      }).catch(() => {
        // 提前生成失败时，通关后仍可用「读下一章」正常重试。
      });
    };
    if (!window.IntersectionObserver) {
      startPrefetch();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        startPrefetch();
        observer.disconnect();
      }
    }, { rootMargin: "300px 0px" });
    observer.observe(level);
    return () => observer.disconnect();
  }, [bookId, book, chapter, progress, mistakeId]);

  useEffect(() => {
    if (prefetchTask === null || prefetchReady) return;
    let stopped = false;
    let timer: number | undefined;
    async function check() {
      try {
        const status = await api.task(prefetchTask!);
        if (stopped) return;
        if (status.status === "done") { setPrefetchReady(true); setPrefetchTask(null); return; }
        if (status.status === "error") { setPrefetchTask(null); return; }
      } catch { /* 连接恢复后继续查询。 */ }
      if (!stopped) timer = window.setTimeout(() => void check(), 3000);
    }
    void check();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [prefetchTask, prefetchReady]);

  function begin(taskId: number, kind: Task["kind"], chapterNumber?: number) {
    const value: ActiveTask = { id: taskId, kind, chapterNo: chapterNumber };
    saveTask(bookId, value);
    setTask(null);
    setSeconds(0);
    setError("");
    setRecap(null);
    setConfirmFinish(false);
    setActive(value);
    window.setTimeout(() => afterRef.current?.scrollIntoView({ block: "start" }), 60);
  }

  async function nextChapter() {
    if (busy || active) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.nextChapter(bookId);
      if (response.chapter) {
        setChapter(response.chapter);
        setResult(null);
      } else if (response.task_id !== null) {
        begin(response.task_id, "chapter", response.chapter_no);
      }
    } catch (cause) {
      setError(errorMessage(cause) + " 如果连接曾中断，请先刷新页面确认本章是否已生成。");
    } finally {
      setBusy(false);
    }
  }

  async function goToChapter(no: number) {
    if (busy || active || no < 1) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.chapter(bookId, no);
      setChapter(response.chapter);
      setResult(null);
      setConfirmFinish(false);
      setReturnToQuiz(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function retryOutline() {
    if (busy || active) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.retryOutline(bookId);
      begin(response.task_id, "outline");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    if (!chapter || !progress || busy || active) return;
    setBusy(true);
    setError("");
    try {
      const action = result?.action ?? failAction(progress.consecutive_fails);
      const response = await api.regenerate(bookId, chapter.chapter_no, HINTS[action]);
      setResult(null);
      begin(response.task_id, "regen_questions", chapter.chapter_no);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function finalize() {
    if (busy || active) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.finalize(bookId);
      begin(response.task_id, "ending");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const answer = useCallback(async (index: number, choice: number) => {
    if (!chapter) throw new AppError("NO_CHAPTER", "章节还没有加载好。");
    const number = chapter.chapter_no;
    const feedback = await api.answer(bookId, number, index, choice);
    const reveal: AnswerReveal = {
      index: feedback.index, choice: feedback.choice, correct: feedback.correct, answer: feedback.answer,
      explanation: feedback.explanation, knowledge: feedback.knowledge, source_paragraph: feedback.source_paragraph,
    };
    const finished = feedback.result;
    setChapter((old) => {
      if (!old || old.chapter_no !== number) return old;
      const answeredList = old.quiz?.answered.length === old.questions.length ? [...old.quiz.answered] : old.questions.map(() => null);
      answeredList[reveal.index] = reveal;
      const updated: Chapter = { ...old, quiz: { answered: answeredList, finished: !!finished } };
      return finished?.passed ? { ...updated, status: "unlocked", knowledge_points: finished.knowledge_points } : updated;
    });
    if (finished) {
      setResult(finished);
      setProgress((old) => {
        if (!old) return old;
        return finished.passed
          ? { ...old, current_chapter: Math.max(old.current_chapter, number), consecutive_fails: 0 }
          : { ...old, consecutive_fails: old.consecutive_fails + 1 };
      });
    }
    return feedback;
  }, [bookId, chapter]);

  function lookBack(reveal: AnswerReveal) {
    let target = reveal.knowledge ? findParagraph(paragraphs, knowledgeTerms(reveal.knowledge)) : -1;
    if (target < 0 && reveal.source_paragraph) target = paragraphs.findIndex((paragraph) => paragraph.no === reveal.source_paragraph);
    const index = Math.max(0, target);
    setQuizOpen(false);
    setReturnToQuiz(true);
    window.setTimeout(() => {
      const element = document.getElementById("pi-" + index);
      if (!element) return;
      window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - window.innerHeight / 3, behavior: "smooth" });
      setFlashPara(index);
      window.setTimeout(() => setFlashPara(null), 3200);
    }, 80);
  }

  function openQuiz() {
    setReturnToQuiz(false);
    setQuizOpen(true);
  }

  function changeSize(delta: 1 | -1) {
    const next = stepReadingSize(readingSize, delta);
    setReadingSize(next);
    saveReadingSize(next);
  }

  function changeTheme(next: ReadingTheme) {
    setTheme(next);
    saveReadingTheme(next);
  }

  function toggleBars() {
    if (window.getSelection()?.toString()) return;
    setBarsHidden((old) => !old);
  }

  const chars = countChars(paragraphs);
  const size = READING_SIZES.find((item) => item.key === readingSize) ?? READING_SIZES[1];
  const generating = active !== null;
  const finishedChapter = chapter?.status === "unlocked";
  const canReadNext = outlineReady && !generating && !busy && book?.status === "reading" && progress && progress.current_chapter < book.planned_chapters && (!chapter || finishedChapter);
  const awaitingFirstChapter = !mistakeId && !loading && !error && !chapter && !!canReadNext && progress?.current_chapter === 0;

  // 大纲写好、还没有任何章节时，自动开始写第一章（只自动一次；失败后留着「开始第一章」按钮手动重试）
  useEffect(() => {
    if (!awaitingFirstChapter || autoStarted.current) return;
    const timer = window.setTimeout(() => {
      autoStarted.current = true;
      void nextChapter();
    }, 0);
    return () => window.clearTimeout(timer);
  });
  const current = progress?.current_chapter || 0;
  const planned = book?.planned_chapters || 0;
  const title = book ? book.title || book.topic + "之旅" : "";
  const reviewing = !!chapter && finishedChapter && chapter.chapter_no < current;
  const canFinalize = !generating && !busy && book?.status === "reading" && current > 0;
  const allRead = !!book && book.status === "reading" && current >= planned && finishedChapter && !reviewing;
  const answered = chapter ? (chapter.quiz?.answered.length === chapter.questions.length ? chapter.quiz.answered : chapter.questions.map(() => null)) : [];
  const answeredCount = answered.filter(Boolean).length;
  const correctCount = answered.filter((item) => item?.correct).length;
  const quizFinished = !!chapter?.quiz?.finished && !finishedChapter;
  const levelLabel = chapter ? `第 ${chapter.chapter_no} 关` : "";
  const taskPhase = taskState(task?.status || "pending");
  const statusTitle = taskPhase === "queued" ? "任务已受理，正在排队"
    : taskPhase === "unknown" ? "任务状态暂时无法确认"
    : active?.kind === "outline" ? "正在构思故事大纲"
    : active?.kind === "regen_questions" ? "正在出一套新题"
    : active?.kind === "ending" ? "正在写大结局"
    : `正在写第 ${active?.chapterNo ?? current + 1} 章`;

  const finishBox = (
    <div className="confirm-box" role="group" aria-label="确认完结">
      <strong>确定就此完结吗？</strong>
      <p>悦读会根据已读的 {current} 章写出大结局，完结后不能再续写新章节，生成会产生模型用量费用。</p>
      <div>
        <button type="button" className="button button-primary" disabled={busy} onClick={() => { setConfirmFinish(false); void finalize(); }}>确认完结</button>
        <button type="button" className="button button-light" onClick={() => setConfirmFinish(false)}>再想想</button>
      </div>
    </div>
  );

  // 弹层打开时，背后的页面对键盘和读屏软件不可用
  const backgroundInert = quizOpen || tocOpen || settingsOpen;

  return (
    <div className="reader-shell">
      <header className={"r-top" + (barsHidden && !mistakeId && !tocOpen && !settingsOpen ? " is-hidden" : "")} inert={backgroundInert}>
        <div className="r-top-inner">
          <Link className="r-back" href={mistakeId ? `/mistakes?book=${bookId}` : "/library"} aria-label={mistakeId ? "返回我的错题本" : "返回学习记录"}><ArrowLeft size={20} /><span>{mistakeId ? "错题本" : "记录"}</span></Link>
          <div className="r-top-title">{book && <><b>{title}</b>{chapter && <span>{chapter.is_ending ? "大结局" : `第 ${chapter.chapter_no} 章`}</span>}</>}</div>
          <div className="r-tools">
            {generating && <span className="r-pill" aria-hidden="true"><i />生成中 {seconds}s</span>}
            <button type="button" className="icon-button" onClick={() => { setDrawerView("chapters"); setTocOpen(true); }} aria-label="目录与知识点" title="目录与知识点" aria-expanded={tocOpen} aria-controls="reader-library-panel" disabled={!book}><List size={20} /></button>
            <button type="button" className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="阅读设置：字号与背景"><ALargeSmall size={20} /></button>
          </div>
        </div>
        <div className="r-line" style={{ transform: `scaleX(${scrollProgress})` }} aria-hidden="true" />
      </header>

      <main className="r-page" inert={backgroundInert}>
        {loading ? (
          <div className="r-skeleton" role="status" aria-label="正在找回你的阅读进度">
            <i style={{ width: "36%" }} /><i style={{ width: "62%", height: 30 }} /><i style={{ width: "28%", marginBottom: 40 }} />
            {Array.from({ length: 9 }, (_, i) => <i key={i} style={{ width: i % 3 === 2 ? "58%" : "100%" }} />)}
          </div>
        ) : !book ? (
          <div className="r-empty" role="alert">
            <CircleAlert size={30} strokeWidth={1.6} />
            <h2>这本书暂时打不开</h2>
            <p>{error || "请返回学习记录重新选择。"}</p>
            <Link className="button button-light" href="/library"><ArrowLeft size={16} />返回学习记录</Link>
          </div>
        ) : (
          <>
            {mistake && <aside className="r-mistake-note">
              <span>错题知识回顾 · 第 {mistake.chapter_no} 章</span><p>{mistake.question}</p>
              {mistakeParagraph >= 0 ? <button type="button" onClick={() => { setBarsHidden(false); document.getElementById("pi-" + mistakeParagraph)?.scrollIntoView({ block: "center", behavior: "smooth" }); }}>定位高亮知识段落 <ArrowRight size={14} /></button> : <p>当前章节未找到对应段落，可返回错题本查看保存的原文摘录。</p>}
              <Link href={`/mistakes?book=${bookId}`}>返回我的错题本</Link>
            </aside>}
            {chapter && (
              <article className="r-chapter" aria-labelledby="chapter-title">
                <header className="r-head">
                  <p className="r-kicker">{title} · {chapter.is_ending ? "大结局" : `第 ${chapter.chapter_no} 章`}</p>
                  <h1 id="chapter-title">{chapterTitle(chapter.title)}</h1>
                  <p className="r-meta">约 {chars.toLocaleString("zh-CN")} 字 · 读完约 {readingMinutes(chars)} 分钟 · AI 生成内容</p>
                </header>
                <div className="r-body" style={{ fontSize: size.px }} onClick={toggleBars}>
                  {paragraphs.map((paragraph, i) => (
                    <div key={i} id={"pi-" + i} className={"r-para" + (flashPara === i || mistakeParagraph === i ? " is-flash" : "")}>
                      {paragraph.lines.map((line, j) => <p key={j}>{line}</p>)}
                    </div>
                  ))}
                </div>
                <div className="r-end" aria-hidden="true"><span>{chapter.is_ending ? "全书完" : "本章完"}</span></div>
                {chapter.chapter_no > 1 && !generating && (
                  <button type="button" className="r-prev" disabled={busy} onClick={() => void goToChapter(chapter.chapter_no - 1)}><ArrowLeft size={15} />上一章</button>
                )}
              </article>
            )}

            <section className="r-after" ref={afterRef}>
              {generating ? (
                <WaitingPanel kind={active.kind} title={statusTitle} progress={task?.progress || ""} seconds={seconds} recap={recap} firstBook={!chapter && current === 0} />
              ) : !chapter ? (
                book.status === "completed" ? (
                  <div className="r-card r-center">
                    <Sparkles size={26} className="r-card-icon" />
                    <h2>这本书已经完结</h2>
                    <p>去结局画廊看看这个故事的结局吧。</p>
                    <Link className="button button-primary" href={`/book/${bookId}/gallery`}><Images size={17} />查看结局画廊</Link>
                  </div>
                ) : outlineReady ? (
                  <div className="r-card r-center r-start">
                    <span className="r-start-mark"><BookOpen size={28} /></span>
                    <p className="r-kicker">{book.genre} · 学习「{book.topic}」</p>
                    <h2>{title}</h2>
                    <p>{awaitingFirstChapter ? "故事大纲已经写好，正在接着写第一章…" : "故事大纲已经写好。点开始，悦读会写出第一章；读完闯过 5 道题，就能解锁下一章。"}</p>
                    {canReadNext && <button className="button button-primary button-3d" type="button" onClick={() => void nextChapter()}>开始第一章 <ArrowRight size={18} /></button>}
                    <p className="r-note">写一章大约需要 1–2 分钟，会产生模型用量费用。</p>
                  </div>
                ) : (
                  <div className="r-card r-center">
                    <CircleAlert size={26} className="r-card-icon" />
                    <h2>故事大纲还没写好</h2>
                    <p>上次生成没有成功，已有的设置都还在，可以再试一次。</p>
                    <button className="button button-primary" type="button" disabled={busy} onClick={() => void retryOutline()}><RotateCcw size={16} />重试生成大纲</button>
                    <p className="r-note">重试会再次调用模型并产生用量费用。</p>
                  </div>
                )
              ) : chapter.is_ending ? (
                <div className="r-card r-center">
                  <Sparkles size={26} className="r-card-icon" />
                  <h2>全书完</h2>
                  <p>这个故事走到了结局。去结局画廊看看，还有哪些不同的结局等你解锁。</p>
                  <div className="r-actions">
                    <Link className="button button-primary" href={`/book/${bookId}/gallery`}><Images size={17} />查看结局画廊</Link>
                    <Link className="button button-light" href="/library">回到学习记录</Link>
                  </div>
                </div>
              ) : finishedChapter ? (
                <div className="r-card">
                  <p className="r-pass"><CircleCheck size={18} />{levelLabel}已通关{reviewing ? "" : result?.passed ? ` · 答对 ${result.correct}/${result.total}` : ""}</p>
                  <div className="r-actions">
                    {reviewing && <button className="button button-primary" type="button" disabled={busy} onClick={() => void goToChapter(chapter.chapter_no + 1)}>下一章 <ArrowRight size={17} /></button>}
                    {!reviewing && canReadNext && <button className="button button-primary button-3d" type="button" onClick={() => void nextChapter()}>读下一章 <ArrowRight size={17} /></button>}
                    {!reviewing && allRead && !confirmFinish && <button className="button button-primary button-3d" type="button" onClick={() => setConfirmFinish(true)}><Flag size={16} />完结本书，生成大结局</button>}
                  </div>
                  {!reviewing && canReadNext && <p className="r-note">{prefetchReady ? "下一章已经备好，点开就能读。" : "如果下一章还没写完，会先显示进度。"}</p>}
                  {!reviewing && allRead && confirmFinish && finishBox}
                </div>
              ) : quizFinished ? (
                <div className="r-card level is-fail" ref={levelRef}>
                  <span className="level-badge">{levelLabel}</span>
                  <h2>这一套没过关 · 答对 {correctCount}/{answered.length}</h2>
                  <p>{(result && !result.passed ? result.message : "") || "先回看原文，再换一套新题闯关。"}</p>
                  <div className="level-dots" aria-hidden="true">{answered.map((item, i) => <i key={i} className={item ? (item.correct ? "is-right" : "is-wrong") : ""} />)}</div>
                  <div className="r-actions">
                    <button className="button button-primary button-3d" type="button" disabled={busy} onClick={() => void regenerate()}><RotateCcw size={16} />换一套题再闯</button>
                    <button className="button button-light" type="button" onClick={() => openQuiz()}>看看错在哪</button>
                  </div>
                  <p className="r-note">换题会调用模型，产生少量费用；题目会按你的情况调简单一些。</p>
                </div>
              ) : (
                <div className="r-card level" ref={levelRef}>
                  <div className="level-top"><span className="level-badge">{levelLabel}</span><span>{answered.length} 题 · 答对 3 题通关</span></div>
                  <h2>{answeredCount > 0 ? "闯关进行中" : "读完了？来闯一关"}</h2>
                  <p>一题一题来，每题答完马上知道对错；答错会告诉你原因，还能一键回看原文。</p>
                  <div className="level-dots" aria-hidden="true">{answered.map((item, i) => <i key={i} className={item ? (item.correct ? "is-right" : "is-wrong") : ""} />)}</div>
                  <button className="button button-primary button-3d level-go" type="button" onClick={openQuiz}>
                    <Swords size={18} />{answeredCount > 0 ? `继续闯关（已答 ${answeredCount}/${answered.length}）` : "开始闯关"}
                  </button>
                  {chapter.chapter_no < planned && (
                    <p className="r-note">{prefetchReady ? "下一章已在后台备好，通关就能读。" : prefetchTask ? "下一章正在后台写，通关后就能接着读。" : "来到这里会在后台提前写下一章，会产生模型用量费用。"}</p>
                  )}
                  {canFinalize && !confirmFinish && <button type="button" className="r-text-button" onClick={() => setConfirmFinish(true)}>不想继续了？就此完结</button>}
                  {canFinalize && confirmFinish && finishBox}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {quizOpen && chapter && !chapter.is_ending && (
        <QuizMode
          chapter={chapter}
          label={levelLabel}
          answered={answered}
          result={result}
          onAnswer={answer}
          onClose={() => setQuizOpen(false)}
          onLookBack={lookBack}
          passedActions={<>
            {canReadNext && <button type="button" className="qm-cta" onClick={() => { setQuizOpen(false); void nextChapter(); }}>读下一章</button>}
            {allRead && <button type="button" className="qm-cta" onClick={() => { setQuizOpen(false); setConfirmFinish(true); window.setTimeout(() => afterRef.current?.scrollIntoView({ block: "center" }), 80); }}>去完结本书</button>}
            <button type="button" className="qm-ghost" onClick={() => setQuizOpen(false)}>回到正文</button>
          </>}
          failedActions={<>
            <button type="button" className="qm-cta" disabled={busy} onClick={() => { setQuizOpen(false); void regenerate(); }}>换一套题再闯</button>
            <button type="button" className="qm-ghost" onClick={() => { setQuizOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}>从头重读</button>
          </>}
        />
      )}

      {returnToQuiz && !quizOpen && chapter && !finishedChapter && (
        <button type="button" className="r-float" onClick={openQuiz}><Swords size={17} />回到闯关</button>
      )}

      {resumed && !quizOpen && (
        <div className="r-toast is-soft" role="status">
          <span>已回到上次读到的位置</span>
          <button type="button" onClick={() => { setResumed(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}>从头读</button>
        </div>
      )}

      {book && error && (
        <div className="r-toast" role="alert">
          <CircleAlert size={18} />
          <span>{error}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setError("")}><X size={16} /></button>
        </div>
      )}

      {book && (
        <TocDrawer
          open={tocOpen}
          chapter={chapter}
          view={drawerView}
          onView={setDrawerView}
          onClose={() => setTocOpen(false)}
          book={book}
          title={title}
          current={current}
          chapterNo={chapter?.chapter_no ?? null}
          isEnding={!!chapter?.is_ending}
          disabled={busy || generating}
          onPick={(no) => void goToChapter(no)}
          canFinalize={canFinalize}
          onFinalize={() => void finalize()}
        />
      )}
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} size={readingSize} onSize={changeSize} theme={theme} onTheme={changeTheme} />
    </div>
  );
}
