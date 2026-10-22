// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { chapterTitle, countChars, findQuoteParagraph, optionLabels, parseChapter, parseEnding, parseHint, readingMinutes } from "../lib/chapter";
import { loadLastBook, loadReadingSize, nextReadingSize, saveLastBook, saveReadingSize } from "../lib/prefs";

describe("chapter display parsing", () => {
  it("splits body by paragraph markers and drops the AI prefix", () => {
    const content = "（AI 生成内容）\n第1段\n深夜十一点。\n第2段\n“随便看看。”\n他转身离开。\n\n第3段\n结尾。";
    expect(parseChapter(content)).toEqual([
      { no: 1, lines: ["深夜十一点。"] },
      { no: 2, lines: ["“随便看看。”", "他转身离开。"] },
      { no: 3, lines: ["结尾。"] },
    ]);
  });

  it("keeps unmarked legacy content as one unnumbered paragraph", () => {
    expect(parseChapter("第一行\n\n第二行")).toEqual([{ no: null, lines: ["第一行", "第二行"] }]);
  });

  it("drops the chapter number prefix from titles", () => {
    expect(chapterTitle("第一章：忘川书店的硬币")).toBe("忘川书店的硬币");
    expect(chapterTitle("第12章 废城拾荒者")).toBe("废城拾荒者");
    expect(chapterTitle("回声与雨日")).toBe("回声与雨日");
    expect(chapterTitle("第二章")).toBe("第二章");
  });

  it("counts characters without markers or whitespace", () => {
    const paragraphs = parseChapter("第1段\n一二 三\n第2段\n四五");
    expect(countChars(paragraphs)).toBe(5);
    expect(readingMinutes(0)).toBe(1);
    expect(readingMinutes(4000)).toBe(10);
  });

  it("reads the paragraph number out of backend hints", () => {
    expect(parseHint("· 「复利的定义是什么？…」→ 回看第 3 段")).toEqual({ question: "复利的定义是什么？", paragraph: 3 });
    expect(parseHint("请再读一遍原文")).toBeNull();
  });

  it("strips letter prefixes only when every option carries one in order", () => {
    expect(optionLabels(["A. 本金", "B、利息", "C：复利", "D) 单利"])).toEqual(["本金", "利息", "复利", "单利"]);
    expect(optionLabels(["A股市场", "B超检查", "期货", "债券"])).toEqual(["A股市场", "B超检查", "期货", "债券"]);
  });

  it("splits ending descriptions into name and detail", () => {
    expect(parseEnding("圆满结局（主角逆袭成功，Happy Ending）")).toEqual({ name: "圆满结局", detail: "主角逆袭成功，Happy Ending" });
    expect(parseEnding("神秘结局")).toEqual({ name: "神秘结局", detail: "" });
  });
});

describe("reading preferences", () => {
  it("falls back to defaults and round-trips saved values", () => {
    localStorage.clear();
    expect(loadReadingSize()).toBe("m");
    expect(loadLastBook()).toBeNull();
    saveReadingSize("l");
    saveLastBook(14);
    expect(loadReadingSize()).toBe("l");
    expect(loadLastBook()).toBe(14);
    expect(nextReadingSize("xl")).toBe("s");
  });
});

describe("knowledge cards", () => {
  it("splits a knowledge point into a card title and finds where the text explains it", async () => {
    const { knowledgeTitle, knowledgeTerms, findParagraph, parseChapter: parse } = await import("../lib/chapter");
    const point = "RAG（检索增强生成）是一种结合信息检索与文本生成的技术框架。";
    expect(knowledgeTitle(point)).toBe("RAG（检索增强生成）");
    expect(knowledgeTerms(point)).toEqual(["RAG", "检索增强生成"]);
    expect(knowledgeTitle("单利只按本金计息，不滚入利息")).toBe("单利只按本金计息");
    expect(knowledgeTitle("关键词检索（Keyword Search）基于精确的词语匹配，适合查找特定术语。")).toBe("关键词检索（Keyword Search）");
    const paragraphs = parse("第1段\n开头。\n第2段\n他想起了检索增强生成。\n第3段\n结尾。");
    expect(findParagraph(paragraphs, knowledgeTerms(point))).toBe(1);
    expect(findParagraph(paragraphs, ["不存在"])).toBe(-1);
  });

  it("locates a paragraph by the exact quote the question cites", () => {
    const paragraphs = parseChapter("第1段\n开头。\n第2段\n复利是利息也生利息，时间越长差距越大。\n第3段\n结尾。");
    // 标点、引号、空白与原文不一致也认
    expect(findQuoteParagraph(paragraphs, "“复利是利息也生利息 时间越长，差距越大”")).toBe(1);
    expect(findQuoteParagraph(paragraphs, "复利是把利息也当本金")).toBe(-1);
    // 太短的引用不足以定位，避免误落到别的段落
    expect(findQuoteParagraph(paragraphs, "复利")).toBe(-1);
  });

  it("remembers reading theme and position per book", async () => {
    const prefs = await import("../lib/prefs");
    localStorage.clear();
    expect(prefs.loadReadingTheme()).toBe("paper");
    prefs.saveReadingTheme("night");
    expect(prefs.loadReadingTheme()).toBe("night");
    expect(prefs.loadPosition(3)).toBeNull();
    prefs.savePosition(3, { chapter: 2, paragraph: 14 });
    expect(prefs.loadPosition(3)).toEqual({ chapter: 2, paragraph: 14 });
    expect(prefs.stepReadingSize("xl", 1)).toBe("xl");
    expect(prefs.stepReadingSize("s", -1)).toBe("s");
  });
});
