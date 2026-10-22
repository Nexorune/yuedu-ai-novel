"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Bookmark, BookOpenText, Check, ClipboardCheck, PenLine, Plus } from "lucide-react";
import { useAccount } from "@/lib/account";
import { SiteFooter, SiteHeader } from "@/components/site/SiteHeader";
import styles from "./landing.module.css";

const STEPS = [
  { icon: PenLine, title: "写下想学的", text: "复利、英语时态、光合作用……一个词就够，再选一种喜欢的故事类型。" },
  { icon: BookOpenText, title: "读为你写的小说", text: "AI 为你写一本小说，知识点自然藏在剧情里，像追更一样往下读。" },
  { icon: ClipboardCheck, title: "答题解锁下一章", text: "每章读完闯一关：5 道题答对 3 道，就能解锁下一章，还会收获知识卡片。" },
];

const FAQ = [
  { q: "小说是谁写的？", a: "由 AI 根据你的主题实时生成，每一本都是只属于你的故事。正文和题目都经过安全审核。" },
  { q: "要等多久才能读到？", a: "一般 2–4 分钟就能读到第一章。等待时可以离开页面，回来会接着显示进度。" },
  { q: "适合学什么？", a: "概念类知识最合适，比如经济学原理、科学常识、英语语法、心理学效应、编程概念等。" },
  { q: "答错了会卡住吗？", a: "不会。答错有讲解、能回看原文，重新闯关时题目会逐步变简单，一定能过。" },
];

// 落地页：只展示产品，不提供操作；所有按钮未登录时去登录页，登录后进入创作页
export default function Landing() {
  const { user, ready } = useAccount();
  const start = user ? "/create" : "/login?next=%2Fcreate";

  return (
    <div className={`${styles.landing} ${ready && user ? `site-shell ${styles.member}` : styles.publicPage}`}>
      <SiteHeader user={user} ready={ready} />

      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="landing-title">
          <Image className={styles.roomImage} src="/images/landing/reading-room.png" alt="" fill sizes="100vw" preload />
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>一段好故事，也是一段好学习</p>
              <h1 id="landing-title">读进故事里，<br />把<em>知识</em>带出来。</h1>
              <p className={styles.lead}>选一个喜欢的故事类型，写下想了解的主题。<br />每一章都为你而写，每一道题都帮你记住刚读过的知识。</p>
              <Link className={styles.startButton} href={start}>开始学习 <ArrowRight size={21} aria-hidden="true" /></Link>
            </div>
            <div className={styles.heroArt} aria-hidden="true">
              <div className={styles.paperStack}>
                <div className={styles.paperMeta}><span>都市 · 学习「复利」</span><span>Aa <Bookmark size={15} /></span></div>
                <h2>十年后的那张存单</h2>
                <p>林夏盯着银行打印出来的流水，愣了足足半分钟。</p>
                <p>同样是每月存一千，十年后表姐的账户却比她多出一大截。</p>
                <p>秘密就在<mark>利滚利。</mark></p>
                <div className={styles.paperExcerpt}><p>你的钱只在本金上算利息；</p><p>她的利息，会在下一年接着生利息。</p><p>林夏第一次意识到，时间本身，<br />也是一种本金……</p></div>
              </div>
              <div className={styles.answerCard}>
                <span>第 1 关 · 记忆</span>
                <h3>复利的关键是什么？</h3>
                <p><Check size={17} /> 利息加入本金，继续产生利息</p>
                <strong><Check size={19} /> 答对了！</strong>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.demoSection} aria-labelledby="demo-title">
          <div className={styles.container}>
          <div className={styles.sectionHeading}>
            <div><p className={styles.sectionLabel}><span>01</span> / 阅读与学习</p><h2 id="demo-title">读起来是这样的</h2></div>
            <p className={styles.sectionAside}>都市 · 学习「复利」<br />一段故事，一次收获。</p>
          </div>
          <div className={styles.demoGrid}>
            <article className={styles.storyPage}>
              <Image className={styles.riverImage} src="/images/landing/river-reading.png" alt="" fill sizes="(max-width: 640px) 100vw, 400px" />
              <div className={styles.storyText}>
              <p className={styles.chapterLabel}>都市 · 学习「复利」 · 第 1 章</p>
              <h3><span>第一章</span>十年后的那张存单</h3>
              <p>林夏盯着银行打印出来的流水，愣了足足半分钟。同样是每月存一千，十年后表姐的账户却比她多出一大截，差距从哪里来？</p>
              <p>「秘密就在利滚利，」理财经理把计算器推过来，「你的钱只在本金上算利息；她的利息，会在下一年接着生利息。」</p>
              <p>林夏第一次意识到，时间本身，也是一种本金……</p>
              <span className={styles.aiLabel}>AI 生成内容</span>
              </div>
            </article>
            <article className={styles.quizPanel} aria-label="示例题目（仅展示）">
              <h3>读完一章，闯过一关</h3>
              <p className={styles.quizHint}>5 道题答对 3 道，就能解锁下一章</p>
              <div className={styles.progress} aria-hidden="true">{[0, 1, 2, 3, 4].map((n) => <i key={n} className={n < 3 ? styles.filled : undefined} />)}</div>
              <p className={styles.quizMeta}>第 1 关 · 第 2 题 / 共 5 题 · 示例</p>
              <h4>本金和年利率都相同，下面哪种情况十年后得到的钱更多？</h4>
              <ul>
                <li><span className={styles.optionCircle} />每年只按最初本金计算利息</li>
                <li className={styles.correct}><span className={styles.optionCircle}><Check size={12} /></span>每年把利息并入本金，下一年一起计息</li>
                <li><span className={styles.optionCircle} />每年把利息取出来花掉</li>
                <li><span className={styles.optionCircle} />三种情况结果一样</li>
              </ul>
              <p className={styles.explanation}><b>讲解：</b>复利会把已经得到的利息加入本金继续计息，时间越长，差距越大。</p>
            </article>
          </div>
          </div>
        </section>

        <section className={`${styles.container} ${styles.stepsSection}`} aria-labelledby="steps-title">
          <p className={styles.sectionLabel}><span>02</span> / 如何开始</p>
          <div className={styles.ruledHeading}><h2 id="steps-title">三步，把想学的读成故事</h2><span /></div>
          <div className={styles.steps}>
            {STEPS.map((step, index) => (
              <article key={step.title} className={styles.step}>
                <span className={styles.stepNumber}>0{index + 1}</span>
                <div className={styles.stepBody}><step.icon size={35} strokeWidth={1.35} aria-hidden="true" /><div><h3>{step.title}</h3><p>{step.text}</p></div></div>
              </article>
            ))}
          </div>
        </section>

        <section className={`${styles.container} ${styles.faqSection}`} aria-labelledby="faq-title">
          <p className={styles.sectionLabel}><span>03</span> / 常见问题</p>
          <h2 id="faq-title">开始之前，你可能想知道</h2>
          <div className={styles.faq}>
            {FAQ.map((item) => (
              <details key={item.q}><summary>{item.q}<Plus size={19} aria-hidden="true" /></summary><p>{item.a}</p></details>
            ))}
          </div>
        </section>

        <div className={styles.closing}>
          <Image className={styles.closingImage} src="/images/landing/reading-room.png" alt="" fill sizes="100vw" quality={75} />
          <div className={styles.container}>
            <section className={styles.cta}>
              <div><h2>下一个故事，等你开启</h2><p>下一本小说，从你想学的开始。</p></div>
              <Link className={styles.startButton} href={start}>开始学习 <ArrowRight size={21} aria-hidden="true" /></Link>
            </section>
            <SiteFooter />
          </div>
        </div>
      </main>
    </div>
  );
}
