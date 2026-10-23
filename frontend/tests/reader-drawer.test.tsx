// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TocDrawer } from "../components/reader/ReaderSheets";
import { api, Book, Chapter } from "../lib/api";
const book: Book = { id: 1, title: "时间的礼物", genre: "都市", topic: "复利", planned_chapters: 3, mode: "full", status: "reading", created_at: "", min_words: 800, max_words: 1500 };
const chapter: Chapter = { chapter_no: 2, title: "积累的力量", content: "故事", questions: [], status: "locked", is_ending: false, knowledge_points: [{ role: "core", point: "复利：利息加入本金继续计息。" }] };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function Drawer({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [open, setOpen] = useState(true);
  const [view, setView] = useState<"chapters" | "knowledge">("chapters");
  return <TocDrawer open={open} onClose={() => { setOpen(false); onClose(); }} book={book} title={book.title} current={1} chapterNo={2} isEnding={false} disabled={false} onPick={vi.fn()} canFinalize={false} onFinalize={vi.fn()} chapter={chapter} view={view} onView={setView} />;
}
it("switches between chapters and knowledge without loading the book directory, and restores scrolling on Escape", () => {
  const request = vi.spyOn(api, "knowledge");
  render(<Drawer />);
  expect(screen.getByRole("link", { name: "结局画廊" })).toBeTruthy();
  expect(screen.queryByText("复利：利息加入本金继续计息。")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^知识点$/ }));
  expect(screen.getByText("复利：利息加入本金继续计息。")).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "章节目录" }));
  expect(screen.getByRole("link", { name: "结局画廊" })).toBeTruthy();
  expect(document.body.style.overflow).toBe("hidden");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.body.style.overflow).toBe("");
});
it("closes the drawer when following knowledge back to a different chapter", async () => {
  vi.spyOn(api, "knowledge").mockResolvedValue({ chapters: [{ chapter_no: 1, title: "时间的礼物", is_ending: false, knowledge_points: chapter.knowledge_points! }] });
  const close = vi.fn();
  render(<Drawer onClose={close} />);
  fireEvent.click(screen.getByRole("button", { name: /^知识点$/ }));
  fireEvent.click(screen.getByRole("button", { name: "本书知识目录" }));
  const link = await screen.findByRole("link", { name: /阅读这一章/, hidden: true });
  expect(link.getAttribute("href")).toBe("/book/1?chapter=1");
  fireEvent.click(link);
  expect(close).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
});
