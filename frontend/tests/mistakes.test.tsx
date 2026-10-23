// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MistakesPage from "../app/mistakes/page";
import { api, Mistake } from "../lib/api";
import { findMistakeParagraph, parseChapter } from "../lib/chapter";

vi.mock("../lib/account", () => { const account = { user: { id: 1, nickname: "读者" }, ready: true }; return { useAccount: () => account }; });
vi.mock("../components/site/SiteHeader", () => ({ SiteHeader: () => null, SiteFooter: () => null }));
const item: Mistake = { id: 7, book_id: 22, book_title: "存单", topic: "复利", chapter_no: 2, chapter_title: "时间", question: "什么是复利？", options: ["利息加入本金", "只有本金"], answer: 0, choice: 1, type: "memory", explanation: "利息也参与计息", knowledge: "复利的积累", source_paragraph: 3, source_excerpt: "利息加入本金。", mastered: false, created_at: "2026-10-22" };
beforeEach(() => { window.history.replaceState(null, "", "/mistakes"); vi.spyOn(window, "scrollTo").mockImplementation(() => {}); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("filters stored mistakes and keeps an exact source link", async () => {
  vi.spyOn(api, "mistakes").mockResolvedValue({ mistakes: [item] });
  render(<MistakesPage />);
  fireEvent.click(await screen.findByRole("button", { name: "查看《存单》的错题" }));
  expect(screen.queryByRole("link", { name: /回到书中知识/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /什么是复利/ }));
  expect(screen.getByRole("link", { name: /回到书中知识/ }).getAttribute("href")).toBe("/book/22?chapter=2&mistake=7");
  expect(screen.getByText(item.explanation)).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "不相关" } });
  expect(screen.queryByRole("heading", { name: /什么是复利/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
  expect(screen.getByRole("heading", { name: /什么是复利/ })).toBeTruthy();
});

it("persists mastery only after server success and can move back", async () => {
  vi.spyOn(api, "mistakes").mockResolvedValue({ mistakes: [item] });
  const update = vi.spyOn(api, "updateMistake").mockRejectedValueOnce(new Error("断网")).mockResolvedValueOnce({ id: 7, mastered: true }).mockResolvedValueOnce({ id: 7, mastered: false });
  render(<MistakesPage />);
  fireEvent.click(await screen.findByRole("button", { name: "查看《存单》的错题" }));
  fireEvent.click(screen.getByRole("button", { name: /什么是复利/ }));
  const button = await screen.findByRole("button", { name: /标为已掌握/ });
  fireEvent.click(button);
  await screen.findByRole("alert");
  expect(screen.getByRole("heading", { name: /什么是复利/ })).toBeTruthy();
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(screen.queryByRole("heading", { name: /什么是复利/ })).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: /已掌握 1/ }));
  fireEvent.click(screen.getByRole("button", { name: /什么是复利/ }));
  fireEvent.click(screen.getByRole("button", { name: /移回待巩固/ }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: /什么是复利/ })).toBeNull());
  expect(update).toHaveBeenLastCalledWith(7, false);
});

it("shows loading failures with a working retry", async () => {
  vi.spyOn(api, "mistakes").mockRejectedValueOnce(new Error("断网")).mockResolvedValueOnce({ mistakes: [] });
  render(<MistakesPage />);
  fireEvent.click(await screen.findByRole("button", { name: "重新加载" }));
  await screen.findByRole("heading", { name: "每一次学习，都值得留下收获" });
});

it("locates exact knowledge after paragraph renumbering and avoids stale positions", () => {
  const paragraphs = parseChapter("第1段\n开头\n第8段\n利息加入本金。");
  expect(findMistakeParagraph(paragraphs, item)).toBe(1);
  expect(findMistakeParagraph(parseChapter("第3段\n别的内容"), item)).toBe(-1);
  expect(findMistakeParagraph(paragraphs, { source_excerpt: "", source_paragraph: 8 })).toBe(1);
});


it("organizes by book, paginates questions and resets the page when filtering", async () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ ...item, id: i + 100, question: `复习题目 ${i + 1}`, chapter_no: i < 21 ? 1 : 2 }));
  vi.spyOn(api, "mistakes").mockResolvedValue({ mistakes: [...many, { ...item, id: 99, book_id: 23, book_title: "另一种学习", question: "别的书题目" }] });
  render(<MistakesPage />);
  await screen.findByRole("button", { name: "查看《存单》的错题" });
  expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  expect(screen.getByRole("button", { name: "查看《另一种学习》的错题" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "查看《存单》的错题" }));
  expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(20);
  expect(screen.queryByText("别的书题目")).toBeNull();
  expect(window.location.search).toBe("?book=22");
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(5);
  fireEvent.change(screen.getByRole("combobox", { name: "按章节筛选" }), { target: { value: "2" } });
  expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(4);
  expect(screen.queryByRole("navigation", { name: "错题本分页" })).toBeNull();
  const toggles = screen.getAllByRole("button", { expanded: false });
  fireEvent.click(toggles[0]);
  fireEvent.click(toggles[1]);
  expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1);
  expect(screen.getAllByRole("link", { name: /回到书中知识/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "全部错题书本" }));
  expect(screen.getByRole("button", { name: "查看《另一种学习》的错题" })).toBeTruthy();
});

it("supports direct book links and book overview pagination", async () => {
  const manyBooks = Array.from({ length: 13 }, (_, i) => ({ ...item, id: i + 1, book_id: i + 1, book_title: `书籍 ${i + 1}` }));
  window.history.replaceState(null, "", "/mistakes?book=13");
  vi.spyOn(api, "mistakes").mockResolvedValue({ mistakes: manyBooks });
  render(<MistakesPage />);
  await screen.findByRole("heading", { name: "书籍 13" });
  expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "全部错题书本" }));
  expect(screen.getAllByRole("button", { name: /查看《书籍/ })).toHaveLength(12);
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(screen.getAllByRole("button", { name: /查看《书籍/ })).toHaveLength(1);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "书籍 1" } });
  expect(screen.getAllByRole("button", { name: /查看《书籍/ })).toHaveLength(5);
});
