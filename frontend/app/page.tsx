"use client";

import Link from "next/link";
import { ArrowRight, BookOpenText, Check, PenLine, Sparkles, Trophy } from "lucide-react";
import { useAccount } from "@/lib/account";
import { SiteFooter, SiteHeader } from "@/components/site/SiteHeader";

const STEPS = [
  { icon: PenLine, title: "写下想学的", text: "复利、英语时态、光合作用……一个词就够，再选一种喜欢的故事类型。" },
  { icon: BookOpenText, title: "读为你写的小说", text: "AI 为你写一本小说，知识点自然藏在剧情里，像追更一样往下读。" },
  { icon: Trophy, title: "答题解锁下一章", text: "每章读完闯一关：5 道题答对 3 道，就能解锁下一章，还会收获知识卡片。" },
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
    <div className="site-shell">
      <SiteHeader user={user} ready={ready} />

      <main className="home-main">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow"><span className="eyebrow-line" /> 一段好故事，也是一段好学习</p>
            <h1>读进故事里，<br /><em>把知识带出来。</em></h1>
            <p className="hero-lead">选一个喜欢的故事类型，写下想了解的主题。每一章都为你而写，每一道题都帮你记住刚读过的知识。</p>
            <Link className="button button-primary" href={start}>开始学习 <ArrowRight size={18} /></Link>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="art-orbit art-orbit-one" />
            <div className="art-orbit art-orbit-two" />
            <div className="art-book art-book-back"><span>知</span></div>
            <div className="art-book art-book-front"><span className="art-book-rule" /><span>悦<br />读</span><small>一页一世界</small></div>
            <div className="art-note"><Sparkles size={17} /> 下一个故事，等你开启</div>
          </div>
        </section>

        <section className="landing-section">
          <p className="eyebrow">HOW IT WORKS</p>
          <h2>三步，把想学的读成故事</h2>
          <div className="landing-steps">
            {STEPS.map((step, index) => (
              <article key={step.title} className="landing-step">
                <span className="landing-step-icon"><step.icon size={22} /></span>
                <small>第 {index + 1} 步</small>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section">
          <p className="eyebrow">A TASTE</p>
          <h2>读起来是这样的</h2>
          <div className="landing-demo">
            <article className="demo-page">
              <p className="demo-meta">都市 · 学习「复利」 · 第 1 章</p>
              <h3>第一章　十年后的那张存单</h3>
              <p>林夏盯着银行打印出来的流水，愣了足足半分钟。同样是每月存一千，十年后表姐的账户却比她多出一大截，差距从哪里来？</p>
              <p>「秘密就在利滚利，」理财经理把计算器推过来，「你的钱只在本金上算利息；她的利息，会在下一年接着生利息。」</p>
              <p className="demo-fade">林夏第一次意识到，时间本身，也是一种本金……</p>
              <span className="demo-tag">AI 生成内容</span>
            </article>
            <article className="demo-quiz" aria-label="示例题目（仅展示）">
              <p className="demo-meta">第 1 关 · 第 2 题 / 共 5 题</p>
              <h3>本金和年利率都相同，下面哪种情况十年后得到的钱更多？</h3>
              <ul>
                <li>每年只按最初本金计算利息</li>
                <li className="is-correct"><Check size={15} /> 每年把利息并入本金，下一年一起计息</li>
                <li>每年把利息取出来花掉</li>
                <li>三种情况结果一样</li>
              </ul>
              <p className="demo-explain"><b>讲解：</b>复利会把已经得到的利息加入本金继续计息，时间越长，差距越大。</p>
            </article>
          </div>
        </section>

        <section className="landing-section">
          <p className="eyebrow">FAQ</p>
          <h2>常见问题</h2>
          <div className="landing-faq">
            {FAQ.map((item) => (
              <article key={item.q}><h3>{item.q}</h3><p>{item.a}</p></article>
            ))}
          </div>
        </section>

        <section className="landing-cta">
          <h2>下一本小说，从你想学的开始。</h2>
          <Link className="button button-primary" href={start}>开始学习 <ArrowRight size={18} /></Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
