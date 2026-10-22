"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronDown, Check, Flame, Heart, Building2, Sparkles, Fingerprint, BookOpen, Layers, Library } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { saveTask } from "@/lib/task";
import { SiteFooter, SiteHeader } from "@/components/site/SiteHeader";
import styles from "./create.module.css";

const GENRES = [
  { value: "爽文", icon: Flame, desc: "逆袭升级，节奏爽快" },
  { value: "言情", icon: Heart, desc: "感情线里学知识" },
  { value: "都市", icon: Building2, desc: "职场生活，贴近现实" },
  { value: "玄幻", icon: Sparkles, desc: "修炼设定，脑洞大开" },
  { value: "悬疑", icon: Fingerprint, desc: "解谜推理，环环相扣" },
];

const EXAMPLES = ["复利", "英语时态", "蝴蝶效应", "光合作用", "博弈论"];

// 「学多深」三档，对应后端的阅读方式与计划章节数；更细的数字放在「更多设置」
const DEPTHS = [
  { key: "quick", icon: BookOpen, label: "快速了解", desc: "1 章短篇，约 5 分钟读完", mode: "quick", chapters: 1 },
  { key: "system", icon: Layers, label: "系统学习", desc: "5 章连载，循序渐进", mode: "full", chapters: 5 },
  { key: "deep", icon: Library, label: "深入掌握", desc: "10 章连载，层层展开", mode: "full", chapters: 10 },
] as const;

type DepthKey = (typeof DEPTHS)[number]["key"];

export default function CreatePage() {
  const router = useRouter();
  const { user, ready } = useAccount(true);
  const [genre, setGenre] = useState("爽文");
  const [topic, setTopic] = useState("");
  const [depth, setDepth] = useState<DepthKey>("system");
  const [chapters, setChapters] = useState(5);
  const [minWords, setMinWords] = useState(1500);
  const [maxWords, setMaxWords] = useState(2500);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const mode = depth === "quick" ? "quick" : "full";

  // 保留旧学习记录书签，避免旧链接仍停在新建表单。
  useEffect(() => {
    const redirectBooks = () => { if (window.location.hash === "#books") router.replace("/library"); };
    redirectBooks();
    window.addEventListener("hashchange", redirectBooks);
    return () => window.removeEventListener("hashchange", redirectBooks);
  }, [router]);

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
      setFormError(errorMessage(error) + " 如提交后连接中断，请先到学习书架看看是否已经创建。");
      setSubmitting(false);
    }
  }

  if (!ready || !user) return <div className="app-loading">正在打开悦读…</div>;

  return (
    <div className="site-shell">
      <SiteHeader user={user} />

      <main className="home-main create-main">
        <section id="create" className={`create-page ${styles.studio}`}>
          <div className="create-head">
            <h1>开始一段新的学习</h1>
            <p>写下想学的知识，悦读为你写一本小说；每章读完答几道题，答对就解锁下一章。</p>
          </div>
          <form className="create-panel" onSubmit={create} noValidate>
            <label className="topic-field" htmlFor="topic-input">
              <span className={styles.sectionTitle}><i aria-hidden="true">01</i>你想学什么？</span>
              <input id="topic-input" value={topic} maxLength={60} autoComplete="off" onChange={(event) => { setTopic(event.target.value); if (formError) setFormError(""); }} placeholder="例如：复利、英语时态、光合作用" />
            </label>
            <div className="topic-examples" aria-label="示例主题">
              <span>试试：</span>
              {EXAMPLES.map((example) => (
                <button type="button" key={example} className={topic === example ? "chip selected" : "chip"} onClick={() => { setTopic(example); setFormError(""); }}>{example}</button>
              ))}
            </div>

            <fieldset className="choice-group">
              <legend><span className={styles.sectionTitle}><i aria-hidden="true">02</i>喜欢哪种故事？</span></legend>
              <div className="genre-grid">
                {GENRES.map((item) => (
                  <label key={item.value} className={genre === item.value ? "choice-card selected" : "choice-card"}>
                    <input type="radio" name="genre" checked={genre === item.value} onChange={() => setGenre(item.value)} />
                    <span className={styles.genreIcon} aria-hidden="true"><item.icon size={20} strokeWidth={1.5} /></span>
                    {genre === item.value && <Check className={styles.selectionCheck} size={12} aria-hidden="true" />}
                    <b>{item.value}</b><small>{item.desc}</small>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="choice-group">
              <legend><span className={styles.sectionTitle}><i aria-hidden="true">03</i>想学多深？</span></legend>
              <div className="depth-grid">
                {DEPTHS.map((item) => (
                  <label key={item.key} className={depth === item.key ? "choice-card selected" : "choice-card"}>
                    <input type="radio" name="depth" checked={depth === item.key} onChange={() => chooseDepth(item.key)} />
                    <span className={styles.depthIcon} aria-hidden="true"><item.icon size={20} strokeWidth={1.4} /></span>
                    {depth === item.key && <Check className={styles.selectionCheck} size={12} aria-hidden="true" />}
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

            {formError && <p className="form-error" role="alert">{formError} <Link href="/library">查看学习书架</Link></p>}
            <button className="button button-primary button-wide" disabled={submitting} type="submit">{submitting ? "正在创建，请稍候…" : "开始生成"} <ArrowRight size={18} /></button>
            <p className="form-footnote">会调用模型、产生少量费用。大约 2–4 分钟后就能读到第一章，等待时可以离开页面。</p>
          </form>
        </section>

      </main>
      <SiteFooter />
    </div>
  );
}
