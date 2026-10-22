// 只存本机阅读偏好（字号、背景、读到哪、上次打开的书）；读写失败时退回默认值，不影响阅读。

export const READING_SIZES = [
  { key: "s", label: "小", px: 16 },
  { key: "m", label: "标准", px: 18 },
  { key: "l", label: "大", px: 20 },
  { key: "xl", label: "特大", px: 22 },
] as const;

export type ReadingSize = (typeof READING_SIZES)[number]["key"];

const SIZE_KEY = "yuedu-reading-size";
const LAST_BOOK_KEY = "yuedu-last-book";
const THEME_KEY = "yuedu-reading-theme";

export const READING_THEMES = [
  { key: "paper", label: "纸白" },
  { key: "eye", label: "护眼" },
  { key: "night", label: "夜间" },
] as const;

export type ReadingTheme = (typeof READING_THEMES)[number]["key"];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 隐私模式等情况下无法保存偏好，忽略即可。
  }
}

export function loadReadingSize(): ReadingSize {
  const value = read(SIZE_KEY);
  return READING_SIZES.some((size) => size.key === value) ? (value as ReadingSize) : "m";
}

export function saveReadingSize(size: ReadingSize): void {
  write(SIZE_KEY, size);
}

export function nextReadingSize(size: ReadingSize): ReadingSize {
  const index = READING_SIZES.findIndex((item) => item.key === size);
  return READING_SIZES[(index + 1) % READING_SIZES.length].key;
}

export function loadLastBook(): number | null {
  const value = Number(read(LAST_BOOK_KEY));
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function saveLastBook(id: number): void {
  write(LAST_BOOK_KEY, String(id));
}

export function loadReadingTheme(): ReadingTheme {
  const value = read(THEME_KEY);
  return value === "eye" || value === "night" ? value : "paper";
}

export function saveReadingTheme(theme: ReadingTheme): void {
  write(THEME_KEY, theme);
}

export function stepReadingSize(size: ReadingSize, delta: 1 | -1): ReadingSize {
  const index = READING_SIZES.findIndex((item) => item.key === size);
  return READING_SIZES[Math.max(0, Math.min(READING_SIZES.length - 1, index + delta))].key;
}

/** 读到哪：记录某本书某一章读到第几段（段落在正文里的序号，从 0 开始）。 */
export type ReadingPosition = { chapter: number; paragraph: number };

export function loadPosition(bookId: number): ReadingPosition | null {
  try {
    const value: unknown = JSON.parse(read("yuedu-pos-" + bookId) || "null");
    if (typeof value !== "object" || value === null) return null;
    const { chapter, paragraph } = value as Record<string, unknown>;
    return Number.isInteger(chapter) && Number.isInteger(paragraph) ? { chapter: chapter as number, paragraph: paragraph as number } : null;
  } catch {
    return null;
  }
}

export function savePosition(bookId: number, position: ReadingPosition): void {
  write("yuedu-pos-" + bookId, JSON.stringify(position));
}
