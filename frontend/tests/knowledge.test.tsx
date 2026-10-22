// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChapterKnowledge } from "../components/reader/ChapterKnowledge";
import { api, Chapter } from "../lib/api";
const points = [{ role: "aux", point: "时间价值：长期积累的作用。" }, { role: "core", point: "复利：利息加入本金，继续计息。" }];
const chapter: Chapter = { chapter_no: 1, title: "时间的礼物", content: "故事", status: "locked", is_ending: false, questions: [], knowledge_points: points };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("shows all chapter knowledge before passing and orders core before supplementary points", () => {
  const request = vi.spyOn(api, "knowledge");
  render(<ChapterKnowledge bookId={1} chapter={chapter} />);
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["复利", "时间价值"]);
  expect(screen.getByText(points[0].point)).toBeTruthy();
  expect(screen.getByText(points[1].point)).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
});

it("loads a chapter-grouped directory, filters knowledge and links to its chapter", async () => {
  vi.spyOn(api, "knowledge").mockResolvedValue({ chapters: [
    { chapter_no: 1, title: "时间的礼物", is_ending: false, knowledge_points: points },
    { chapter_no: 2, title: "新的选择", is_ending: false, knowledge_points: [{ role: "core", point: "机会成本：放弃的最好选择。" }] },
  ] });
  render(<ChapterKnowledge bookId={1} chapter={chapter} />);
  fireEvent.click(screen.getByRole("button", { name: "本书知识目录" }));
  await screen.findByText("第 2 章 · 新的选择");
  expect(screen.getByRole("link", { name: /阅读这一章/, hidden: true }).getAttribute("href")).toBe("/book/1?chapter=2");
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "机会成本" } });
  expect(screen.queryByText("第 1 章 · 时间的礼物")).toBeNull();
  expect(screen.getByRole("heading", { name: "机会成本" })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "不相关" } });
  expect(screen.getByText("没有找到相关知识点，换个关键词试试。")).toBeTruthy();
});

it("keeps chapter content available on directory failure and offers retry and empty states", async () => {
  const request = vi.spyOn(api, "knowledge").mockRejectedValueOnce(new Error("断网")).mockResolvedValueOnce({ chapters: [] });
  render(<ChapterKnowledge bookId={1} chapter={{ ...chapter, knowledge_points: [] }} />);
  expect(screen.getByText(/这一章暂未整理知识点/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "本书知识目录" }));
  fireEvent.click(await screen.findByRole("button", { name: "重新加载" }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  await screen.findByText("当前还没有可阅读章节。");
  fireEvent.click(screen.getByRole("button", { name: "本章知识点" }));
  expect(screen.getByText(/这一章暂未整理知识点/)).toBeTruthy();
});
