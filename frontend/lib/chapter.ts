// 章节正文与题目的展示层解析：只做排版用途的拆分，不改动后端返回的原文。

export type Paragraph = { no: number | null; lines: string[] };

const MARKER = /^\s*第\s*(\d+)\s*段\s*[:：]?\s*$/;
const AI_PREFIX = /^\s*（AI 生成内容）\s*/;

/** 按后端写入的「第N段」标记切分正文；没有标记的旧内容整体作为一段。 */
export function parseChapter(content: string): Paragraph[] {
  const result: Paragraph[] = [];
  let current: Paragraph | null = null;
  for (const raw of content.replace(AI_PREFIX, "").split("\n")) {
    const marker = raw.match(MARKER);
    if (marker) {
      current = { no: Number(marker[1]), lines: [] };
      result.push(current);
      continue;
    }
    const line = raw.trim();
    if (!line) continue;
    if (!current) {
      current = { no: null, lines: [] };
      result.push(current);
    }
    current.lines.push(line);
  }
  return result.filter((paragraph) => paragraph.lines.length > 0);
}

/** 章节号已单独展示，标题去掉「第一章：」「第1章 」这类前缀；去完为空时保留原标题。 */
export function chapterTitle(title: string): string {
  const stripped = title.replace(/^\s*第\s*[一二三四五六七八九十百零〇两\d]+\s*章\s*[：:·.、\-—\s]*/, "").trim();
  return stripped || title.trim();
}

/** 正文字数（不含段落标记与空白），用于显示篇幅和预计阅读时间。 */
export function countChars(paragraphs: Paragraph[]): number {
  return paragraphs.reduce((sum, p) => sum + p.lines.reduce((n, line) => n + line.replace(/\s/g, "").length, 0), 0);
}

export function readingMinutes(chars: number): number {
  return Math.max(1, Math.round(chars / 400));
}

/** 后端错题提示形如「· 「题干…」→ 回看第 3 段」；解析失败时返回 null，界面按原文显示。 */
export function parseHint(hint: string): { question: string; paragraph: number } | null {
  const match = hint.match(/「(.+?)」\s*→\s*回看第\s*(\d+)\s*段/);
  return match ? { question: match[1].replace(/…$/, ""), paragraph: Number(match[2]) } : null;
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const FULL_WIDTH = ["Ａ", "Ｂ", "Ｃ", "Ｄ", "Ｅ", "Ｆ"];

/** 部分旧题目的选项自带「A. 」前缀；只有全部选项按顺序带前缀时才去掉，避免误删正文。 */
export function optionLabels(options: string[]): string[] {
  const patterns = options.map((_, i) => new RegExp(`^\\s*[${LETTERS[i] ?? "_"}${FULL_WIDTH[i] ?? "_"}]\\s*[.、．:：)）]\\s*`));
  const prefixed = options.length > 0 && options.every((option, i) => patterns[i].test(option));
  return prefixed ? options.map((option, i) => option.replace(patterns[i], "")) : options;
}

export function optionLetter(index: number): string {
  return LETTERS[index] ?? String(index + 1);
}

/** 结局描述形如「圆满结局（主角逆袭成功，Happy Ending）」。 */
export function parseEnding(desc: string): { name: string; detail: string } {
  const match = desc.match(/^(.+?)[（(](.+)[）)]\s*$/);
  return match ? { name: match[1].trim(), detail: match[2].trim() } : { name: desc.trim(), detail: "" };
}

/** 知识卡片：把「RAG（检索增强生成）是一种……」拆成卡片标题「RAG（检索增强生成）」和完整解释。 */
export function knowledgeTitle(point: string): string {
  const text = point.trim();
  const isAt = text.indexOf("是");
  if (isAt >= 2 && isAt <= 30) return text.slice(0, isAt).replace(/[，,：:\s]+$/, "");
  // 「关键词检索（Keyword Search）基于……」：取到括号注释为止
  const named = text.match(/^[^，,。：:]{1,20}?[（(][^）)]{1,40}[）)]/);
  if (named) return named[0];
  const clause = text.split(/[，,：:。]/)[0];
  return clause.length <= 24 ? clause : clause.slice(0, 24) + "…";
}

/** 知识点里的关键词：「RAG（检索增强生成）」→ ["RAG", "检索增强生成"]，用于在正文里找到讲它的那一段。 */
export function knowledgeTerms(point: string): string[] {
  const title = knowledgeTitle(point);
  return title.split(/[（）()、/，,\s]+/).map((term) => term.trim()).filter((term) => term.length >= 2);
}

/** 返回正文里第一次讲到这些关键词的段落序号；找不到返回 -1。 */
export function findParagraph(paragraphs: Paragraph[], terms: string[]): number {
  if (terms.length === 0) return -1;
  const lowered = terms.map((term) => term.toLowerCase());
  return paragraphs.findIndex((paragraph) => {
    const text = paragraph.lines.join("").toLowerCase();
    return lowered.some((term) => text.includes(term));
  });
}

export const QUESTION_KINDS: Record<string, string> = {
  memory: "记忆",
  understanding: "理解",
  transfer: "应用",
  locate: "辨析",
};
