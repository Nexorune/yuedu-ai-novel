"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenText, Check, X } from "lucide-react";
import { AnswerFeedback, AnswerResult, AnswerReveal, Chapter, errorMessage } from "@/lib/api";
import { optionLabels, optionLetter, QUESTION_KINDS } from "@/lib/chapter";
import { KnowledgeCards } from "./KnowledgeCards";
import { useDialog } from "./useDialog";

type Props = {
  chapter: Chapter;
  label: string;
  answered: (AnswerReveal | null)[];
  result: AnswerResult | null;
  onAnswer: (index: number, choice: number) => Promise<AnswerFeedback>;
  onClose: () => void;
  onLookBack: (reveal: AnswerReveal) => void;
  passedActions: React.ReactNode;
  failedActions: React.ReactNode;
};

const CONFETTI = Array.from({ length: 14 }, (_, i) => i);

/** 多邻国式闯关：一题一屏，答完立刻揭晓对错与讲解；5 题答完给出闯关结果。 */
export function QuizMode({ chapter, label, answered, result, onAnswer, onClose, onLookBack, passedActions, failedActions }: Props) {
  const total = chapter.questions.length;
  const firstOpen = answered.findIndex((item) => !item);
  const [index, setIndex] = useState(firstOpen === -1 ? 0 : firstOpen);
  const [choice, setChoice] = useState<number | null>(null);
  const [reveal, setReveal] = useState<AnswerReveal | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showResult, setShowResult] = useState(firstOpen === -1 && !!result);
  const ref = useDialog<HTMLDivElement>(true, onClose, true);

  const question = chapter.questions[index];
  const options = useMemo(() => optionLabels(question?.options ?? []), [question]);
  const correctCount = answered.filter((item) => item?.correct).length;

  const confirm = useCallback(async () => {
    if (choice === null || reveal || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      setReveal(await onAnswer(index, choice));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }, [choice, reveal, submitting, onAnswer, index]);

  const next = useCallback(() => {
    if (!reveal) return;
    const after = answered.findIndex((item, i) => !item && i > index);
    const anyOpen = answered.findIndex((item) => !item);
    const target = after !== -1 ? after : anyOpen;
    if (target === -1) {
      setShowResult(true);
    } else {
      setIndex(target);
    }
    setChoice(null);
    setReveal(null);
  }, [reveal, answered, index]);

  // 换到下一题时把焦点放到第一个选项上，键盘用户不用再找
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(".qm-option")?.focus();
  }, [index, ref]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (showResult || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      const picked = "1234".indexOf(key) !== -1 ? "1234".indexOf(key) : "abcd".indexOf(key);
      if (!reveal && picked !== -1 && picked < options.length) {
        setChoice(picked);
      } else if (key === "enter" && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        if (reveal) next();
        else void confirm();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showResult, reveal, options.length, next, confirm]);

  const passed = !!result?.passed;

  return (
    <div className="qm" ref={ref} role="dialog" aria-modal="true" aria-label={label + "闯关"}>
      <div className="qm-top">
        <button type="button" className="qm-close" onClick={onClose} aria-label="先退出，答题进度会保留"><X size={22} /></button>
        <div className="qm-bar" role="progressbar" aria-label="答题进度" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered.filter(Boolean).length}>
          {answered.map((item, i) => (
            <span key={i} className={item ? (item.correct ? "is-right" : "is-wrong") : !showResult && i === index ? "is-current" : ""} />
          ))}
        </div>
        <span className="qm-count">{showResult ? total : index + 1}/{total}</span>
      </div>

      {showResult && result ? (
        <div className={"qm-result" + (passed ? " is-pass" : " is-fail")}>
          {passed && <div className="qm-burst" aria-hidden="true">{CONFETTI.map((i) => <i key={i} style={{ "--i": i } as React.CSSProperties} />)}</div>}
          <div className="qm-score" style={{ "--pct": (result.correct / result.total) * 100 + "%" } as React.CSSProperties}>
            <b>{result.correct}</b><span>/{result.total}</span>
          </div>
          <h2>{passed ? "闯关成功！" : "还差一点"}</h2>
          <p className="qm-result-text">{passed ? `${label}通关，下一章已解锁。` : result.message}</p>
          {passed ? (
            <KnowledgeCards points={result.knowledge_points ?? []} heading="本章收获" note="这一章你学会了这些" />
          ) : (
            <ul className="qm-review">
              {answered.map((item, i) => item && !item.correct && (
                <li key={i}>
                  <p>{chapter.questions[i].question}</p>
                  <span>正确答案：{optionLetter(item.answer)}. {optionLabels(chapter.questions[i].options)[item.answer]}</span>
                  <button type="button" className="qm-link" onClick={() => onLookBack(item)}><BookOpenText size={15} />回看原文</button>
                </li>
              ))}
            </ul>
          )}
          <div className="qm-actions">{passed ? passedActions : failedActions}</div>
        </div>
      ) : question ? (
        <>
          <div className="qm-body" key={index}>
            <p className="qm-kind">第 {index + 1} 题{question.type && QUESTION_KINDS[question.type] ? ` · ${QUESTION_KINDS[question.type]}` : ""}</p>
            <h2 className="qm-question">{question.question}</h2>
            <div className="qm-options" role="radiogroup" aria-label="选项">
              {options.map((option, j) => {
                const state = reveal ? (j === reveal.answer ? " is-right" : j === reveal.choice ? " is-wrong" : " is-dim") : choice === j ? " is-picked" : "";
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={choice === j}
                    key={j}
                    className={"qm-option" + state}
                    disabled={!!reveal || submitting}
                    data-autofocus={j === 0 ? true : undefined}
                    onClick={() => setChoice(j)}
                  >
                    <kbd>{optionLetter(j)}</kbd>
                    <span>{option}</span>
                    {reveal && j === reveal.answer && <Check size={18} className="qm-mark" />}
                  </button>
                );
              })}
            </div>
            {error && <p className="qm-error" role="alert">{error}</p>}
            <p className="qm-tip" aria-hidden="true">{correctCount > 0 ? `已答对 ${correctCount} 题 · ` : ""}答对 3 题即可通关<span className="qm-keys"> · 键盘 1–4 选择，回车确认</span></p>
          </div>

          <div className={"qm-foot" + (reveal ? (reveal.correct ? " is-right" : " is-wrong") : "")} aria-live="polite">
            <div className="qm-foot-inner">
              {reveal ? (
                <>
                  <div className="qm-feedback">
                    <strong>{reveal.correct ? "答对了！" : `正确答案：${optionLetter(reveal.answer)}. ${options[reveal.answer] ?? ""}`}</strong>
                    {(reveal.explanation || reveal.knowledge) && (
                      <p>{reveal.explanation || "这道题考的是：" + reveal.knowledge}</p>
                    )}
                    {reveal.evidence && (
                      <p className="qm-evidence"><span>原文依据</span>「{reveal.evidence}」</p>
                    )}
                    {!reveal.correct && (
                      <button type="button" className="qm-link" onClick={() => onLookBack(reveal)}><BookOpenText size={15} />回看原文{reveal.source_paragraph ? ` · 第 ${reveal.source_paragraph} 段` : ""}</button>
                    )}
                  </div>
                  <button type="button" className="qm-cta" onClick={next} autoFocus>
                    {answered.filter(Boolean).length >= total ? "查看结果" : "继续"}
                  </button>
                </>
              ) : (
                <>
                  <span className="qm-hint">{choice === null ? "选一个答案" : `已选 ${optionLetter(choice)}，确认后揭晓`}</span>
                  <button type="button" className="qm-cta" disabled={choice === null || submitting} onClick={() => void confirm()}>
                    {submitting ? "判分中…" : "确认"}
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
