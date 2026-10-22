// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QuizMode } from "../components/reader/QuizMode";
import type { AnswerFeedback, AnswerReveal, Chapter } from "../lib/api";

const chapter: Chapter = { chapter_no: 1, title: "时间的利息", content: "第1段\n利息也参与计息。", status: "locked", is_ending: 0,
  questions: Array.from({ length: 5 }, (_, i) => ({ type: "memory", question: `复利练习 ${i + 1}：什么会参与下期计息？`, options: ["本金和利息", "只有本金", "只有利息", "都不参与"], source_paragraph: 1 })) };
const reveal: AnswerReveal = { index: 0, choice: 1, answer: 0, correct: false, explanation: "利息加入本金后，一起参与下一期计息。", knowledge: "复利", source_paragraph: 1 };
const actions = { passedActions: <button className="qm-cta">读下一章</button>, failedActions: <button className="qm-cta">换一套题再闯</button> };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("reveals server feedback after confirmation, keeps look-back and focuses continuation", async () => {
  const onAnswer = vi.fn().mockResolvedValue({ ...reveal, answered: 1, total: 5, result: null });
  const onLookBack = vi.fn();
  function Harness() {
    const [answered, setAnswered] = useState<(AnswerReveal | null)[]>(Array(5).fill(null));
    return <QuizMode chapter={chapter} label="第 1 章" answered={answered} result={null} onClose={vi.fn()} onLookBack={onLookBack} {...actions}
      onAnswer={async (index, choice) => { const value = await onAnswer(index, choice); setAnswered((old) => old.map((item, i) => i === index ? value : item)); return value; }} />;
  }
  render(<Harness />);
  expect(screen.getByRole("button", { name: "确认" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: /B.*只有本金/ }));
  expect(screen.queryByText(reveal.explanation)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  await screen.findByText(reveal.explanation);
  expect(onAnswer).toHaveBeenCalledWith(0, 1);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "继续" }));
  fireEvent.click(screen.getByRole("button", { name: "回看原文" }));
  expect(onLookBack).toHaveBeenCalledWith(expect.objectContaining({ source_paragraph: 1 }));
  fireEvent.click(screen.getByRole("button", { name: "继续" }));
  expect(screen.getByRole("heading", { name: /复利练习 2/ })).toBeTruthy();
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
});

it("keeps a failed submission retryable without revealing an answer", async () => {
  const onAnswer = vi.fn().mockRejectedValue(new Error("offline"));
  render(<QuizMode chapter={chapter} label="第 1 章" answered={Array(5).fill(null)} result={null} onAnswer={onAnswer} onClose={vi.fn()} onLookBack={vi.fn()} {...actions} />);
  fireEvent.click(screen.getByRole("radio", { name: /A.*本金和利息/ }));
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  await screen.findByRole("alert");
  expect(screen.queryByText(reveal.explanation)).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", { name: "确认" }).hasAttribute("disabled")).toBe(false));
});

it("puts retry actions before the review and retains wrong answers, explanations and close", () => {
  const onClose = vi.fn();
  render(<QuizMode chapter={chapter} label="第 1 章" answered={Array.from({ length: 5 }, (_, index) => ({ ...reveal, index }))}
    result={{ passed: false, correct: 0, total: 5, message: "回看原文，再来一次。" }} onAnswer={vi.fn()} onClose={onClose} onLookBack={vi.fn()} {...actions} />);
  expect(screen.getByRole("heading", { name: "再巩固一下" })).toBeTruthy();
  expect(screen.getAllByText("你的答案：B. 只有本金")).toHaveLength(5);
  expect(screen.getAllByText(reveal.explanation)).toHaveLength(5);
  const retry = screen.getByRole("button", { name: "换一套题再闯" });
  const review = screen.getByRole("region", { name: "错题回顾" });
  expect(retry.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("shows the passed result and knowledge cards without a wrong-answer list", () => {
  render(<QuizMode chapter={chapter} label="第 1 章" answered={Array.from({ length: 5 }, (_, index) => ({ ...reveal, index, correct: true, choice: 0 }))}
    result={{ passed: true, correct: 5, total: 5, message: "通关", knowledge_points: [{ role: "core", point: "复利：利息加入本金继续计息。" }] }}
    onAnswer={vi.fn<() => Promise<AnswerFeedback>>()} onClose={vi.fn()} onLookBack={vi.fn()} {...actions} />);
  expect(screen.getByRole("heading", { name: "闯关成功！" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "本章收获" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "读下一章" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "错题回顾" })).toBeNull();
});
