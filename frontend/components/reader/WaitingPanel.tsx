"use client";

import { useState } from "react";
import { Check, ChevronRight, Users } from "lucide-react";
import type { Recap, Task } from "@/lib/api";
import { knowledgeTitle } from "@/lib/chapter";

// 后端会把当前步骤写进任务进度（如「内容安全审核中…」），按关键词对应到步骤条
const STEPS: Record<Task["kind"], { label: string; keys: string[] }[]> = {
  outline: [
    { label: "构思大纲", keys: ["大纲（", "全书大纲"] },
    { label: "设定人物", keys: ["档案建立"] },
    { label: "准备就绪", keys: ["已完成"] },
  ],
  chapter: [
    { label: "写正文", keys: ["正文（"] },
    { label: "安全审核", keys: ["审核", "校验中"] },
    { label: "出题", keys: ["出题"] },
    { label: "前后文检查", keys: ["连贯"] },
    { label: "完成", keys: ["已保存"] },
  ],
  ending: [
    { label: "写大结局", keys: ["正文（"] },
    { label: "安全审核", keys: ["审核", "校验中"] },
    { label: "出题", keys: ["出题"] },
    { label: "前后文检查", keys: ["连贯"] },
    { label: "完成", keys: ["已保存"] },
  ],
  regen_questions: [
    { label: "出新题", keys: ["出题"] },
    { label: "审题", keys: ["审题"] },
  ],
};

// 新书第一次等待：大纲和第一章连着写，合成一条步骤条（数字是各自任务步骤到这条的对应位置）
const FIRST_BOOK_STEPS = ["构思大纲", "设定人物", "写第一章", "审核出题", "完成"];
const FIRST_BOOK_MAP: Partial<Record<Task["kind"], number[]>> = {
  outline: [0, 1, 2],
  chapter: [2, 3, 3, 3, 4],
};

function stepIndex(kind: Task["kind"], progress: string): number {
  const steps = STEPS[kind] ?? [];
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].keys.some((key) => progress.includes(key))) return i;
  }
  return 0;
}

type Props = {
  kind: Task["kind"];
  title: string;
  progress: string;
  seconds: number;
  recap: Recap | null;
  /** 这本书还没有任何章节：把大纲和第一章显示成一条连续的步骤。 */
  firstBook?: boolean;
};

/** 等待生成时：步骤进度 + 可以顺手看的内容（上回说到、复习卡片、登场人物），不剧透未读内容。 */
export function WaitingPanel({ kind, title, progress, seconds, recap, firstBook }: Props) {
  const firstMap = firstBook ? FIRST_BOOK_MAP[kind] : undefined;
  const steps = firstMap ? FIRST_BOOK_STEPS : (STEPS[kind] ?? []).map((step) => step.label);
  const current = firstMap ? firstMap[stepIndex(kind, progress)] ?? 0 : stepIndex(kind, progress);
  const [card, setCard] = useState(0);
  const knowledge = recap?.knowledge ?? [];
  const shown = knowledge.length > 0 ? knowledge[card % knowledge.length] : null;

  return (
    <section className="waiting" role="status" aria-live="polite">
      <div className="waiting-head">
        <span className="waiting-pen" aria-hidden="true" />
        <div>
          <strong>{title}</strong>
          <p>{progress || "请稍候…"} · 已等待 {seconds} 秒</p>
        </div>
      </div>
      {steps.length > 1 && (
        <ol className="waiting-steps">
          {steps.map((label, i) => (
            <li key={label} className={i < current ? "is-done" : i === current ? "is-active" : ""}>
              <span>{i < current ? <Check size={12} /> : i + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      )}
      <p className="waiting-note">{firstMap ? "大纲和第一章一共大约 2–4 分钟，写好会直接打开第一章。" : "一般需要 1–2 分钟。"}离开页面也没关系，回来会接着显示进度。</p>

      <div className="waiting-extras">
        {recap?.previous?.excerpt ? (
          <article className="waiting-card">
            <h3>上回说到</h3>
            <p className="waiting-quote">{recap.previous.excerpt}</p>
          </article>
        ) : recap?.mainline ? (
          <article className="waiting-card">
            <h3>故事简介</h3>
            <p>{recap.mainline}</p>
          </article>
        ) : kind === "outline" ? (
          <article className="waiting-card">
            <h3>悦读怎么玩</h3>
            <ol className="waiting-howto">
              <li>每章读完有一关小测验，5 题答对 3 题就能解锁下一章。</li>
              <li>每题答完马上知道对错，答错会告诉你原因、带你回看原文。</li>
              <li>读完可以随时完结，收集不同的结局。</li>
            </ol>
          </article>
        ) : null}

        {shown && (
          <article className="waiting-card waiting-review">
            <h3>趁现在复习一下 <small>{(card % knowledge.length) + 1}/{knowledge.length}</small></h3>
            <p className="waiting-review-title">{knowledgeTitle(shown.point)}</p>
            <p>{shown.point}</p>
            {knowledge.length > 1 && (
              <button type="button" className="waiting-next" onClick={() => setCard((old) => old + 1)}>换一张 <ChevronRight size={15} /></button>
            )}
          </article>
        )}

        {recap && recap.characters.length > 0 && (
          <article className="waiting-card">
            <h3><Users size={15} /> 登场人物</h3>
            <ul className="waiting-cast">
              {recap.characters.map((character) => (
                <li key={character.name}><b>{character.name}</b><span>{character.identity}</span></li>
              ))}
            </ul>
          </article>
        )}
      </div>
    </section>
  );
}
