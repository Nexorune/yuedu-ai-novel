export type BookSummary = {
  id: number;
  genre: string;
  topic: string;
  title: string;
  planned_chapters: number;
  mode: "full" | "quick";
  status: "reading" | "completed";
  created_at: string;
  /** 已闯关解锁到第几章（书单接口返回；书籍详情里同样的数在 progress 里）。 */
  current_chapter?: number;
};

export type Book = BookSummary & {
  min_words: number;
  max_words: number;
};

export type Progress = {
  current_chapter: number;
  consecutive_fails: number;
};

export type Question = {
  type?: "memory" | "understanding" | "transfer" | "locate" | string;
  question: string;
  options: string[];
  source_paragraph: number;
};

export type KnowledgePoint = { role: "core" | "aux" | string; point: string };

/** 某道题作答后才揭晓的信息（正确答案只在作答后由后端给出）。 */
export type AnswerReveal = {
  index: number;
  choice: number;
  correct: boolean;
  answer: number;
  explanation: string;
  knowledge: string;
  source_paragraph: number | null;
  /** 这道题在正文里的原句依据（逐字引用），用于「回看原文」定位。 */
  evidence?: string | null;
};

export type QuizState = { answered: (AnswerReveal | null)[]; finished: boolean };

export type Chapter = {
  chapter_no: number;
  title: string;
  content: string;
  questions: Question[];
  status: "locked" | "unlocked";
  is_ending: number | boolean;
  quiz?: QuizState;
  knowledge_points?: KnowledgePoint[];
};

export type KnowledgeChapter = { chapter_no: number; title: string; is_ending: boolean; knowledge_points: KnowledgePoint[] };

export type Recap = {
  mainline: string;
  characters: { name: string; identity: string }[];
  previous: { chapter_no: number; title: string; excerpt: string } | null;
  knowledge: (KnowledgePoint & { chapter_no: number })[];
};

export type Task = {
  task_id: number;
  status: "pending" | "running" | "done" | "error";
  kind: "outline" | "chapter" | "ending" | "regen_questions";
  chapter_no: number | null;
  progress: string;
  error: string | null;
};

export type AnswerResult = {
  passed: boolean;
  correct: number;
  total: number;
  message: string;
  hints?: string[];
  action?: "retry_new_questions" | "retry_lower_difficulty" | "retry_easiest";
  knowledge_points?: KnowledgePoint[];
};

export type AnswerFeedback = AnswerReveal & { answered: number; total: number; result: AnswerResult | null };

export type Ending = { style: string; desc: string; unlocked: boolean; chapter_no: number | null };

export type User = { id: number; nickname: string; phone_masked: string; created_at: string };

export type Mistake = {
  id: number; book_id: number; book_title: string; topic: string; chapter_no: number; chapter_title: string;
  question: string; options: string[]; answer: number; choice: number; type: string;
  explanation: string; knowledge: string; source_paragraph: number | null; source_excerpt: string;
  mastered: boolean; created_at: string;
};

export type UserStats = { books: number; chapters_passed: number; knowledge_points: number };

export class AppError extends Error {
  constructor(public code: string, message: string, public retryable = false) {
    super(message);
    this.name = "AppError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      cache: "no-store",
      signal: init?.signal ?? AbortSignal.timeout(15_000),
    });
  } catch (cause) {
    const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
    throw new AppError(timedOut ? "TIMEOUT" : "NETWORK", timedOut ? "等待服务响应超时，请稍后重试。" : "连接中断，请检查网络后重试。", true);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new AppError("BAD_RESPONSE", "服务返回了无法读取的结果，请稍后重试。", true);
  }
  if (response.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
    // 登录过期或未登录：带上当前地址去登录页，登录后回到这里
    const here = window.location.pathname + window.location.search + window.location.hash;
    window.location.replace("/login?next=" + encodeURIComponent(here));
  }
  if (!response.ok) {
    const detail = record(data) && record(data.error) ? data.error : null;
    throw new AppError(
      typeof detail?.code === "string" ? detail.code : `HTTP_${response.status}`,
      typeof detail?.message === "string" ? detail.message : "请求失败，请稍后重试。",
      response.status >= 500 || response.status === 429,
    );
  }
  if (!record(data)) throw new AppError("BAD_RESPONSE", "服务返回的数据格式有误。", true);
  return data as T;
}

export const api = {
  async mistakes(): Promise<{ mistakes: Mistake[] }> {
    const data = await request<{ mistakes: unknown }>("/mistakes");
    if (!Array.isArray(data.mistakes)) throw new AppError("BAD_RESPONSE", "错题数据格式有误，请重新加载。", true);
    return { mistakes: data.mistakes as Mistake[] };
  },
  mistake(id: number) { return request<{ mistake: Mistake }>(`/mistakes/${id}`); },
  updateMistake(id: number, mastered: boolean) {
    return request<{ id: number; mastered: boolean }>(`/mistakes/${id}`, { method: "PATCH", body: JSON.stringify({ mastered }) });
  },
  me() {
    return request<{ user: User | null; demo_autofill?: boolean }>("/auth/me");
  },
  sendCode(phone: string, demoAutofill = false) {
    return request<{ sent: boolean; cooldown: number; demo_code?: string }>("/auth/code", { method: "POST", body: JSON.stringify({ phone, demo_autofill: demoAutofill }) });
  },
  login(input: { phone: string; code: string; agreed: boolean }) {
    return request<{ user: User; created: boolean }>("/auth/login", { method: "POST", body: JSON.stringify(input) });
  },
  logout() {
    return request<{ ok: boolean }>("/auth/logout", { method: "POST" });
  },
  stats() {
    return request<{ stats: UserStats }>("/me/stats");
  },
  async books(): Promise<BookSummary[]> {
    const data = await request<{ books: unknown }>("/books");
    if (!Array.isArray(data.books)) throw new AppError("BAD_RESPONSE", "书架数据格式有误。", true);
    return data.books as BookSummary[];
  },
  book(id: number) {
    return request<{ book: Book; progress: Progress; endings: string[]; outline_ready: boolean }>(`/books/${id}`);
  },
  retryOutline(id: number) {
    return request<{ task_id: number }>(`/books/${id}/outline/retry`, { method: "POST" });
  },
  createBook(input: {
    genre: string; topic: string; mode: "full" | "quick";
    planned_chapters: number; min_words: number; max_words: number;
  }) {
    return request<{ book_id: number; task_id: number }>("/books", { method: "POST", body: JSON.stringify(input) });
  },
  nextChapter(id: number) {
    return request<{ task_id: number | null; chapter_no: number; chapter?: Chapter }>(`/books/${id}/chapters/next`, { method: "POST" });
  },
  prefetchNext(id: number, number: number) {
    return request<{ task_id: number | null; chapter_no: number; ready: boolean }>(`/books/${id}/chapters/${number}/prefetch-next`, { method: "POST" });
  },
  chapter(id: number, number: number) {
    return request<{ chapter: Chapter }>(`/books/${id}/chapters/${number}`);
  },
  submit(id: number, number: number, answers: number[]) {
    return request<AnswerResult>(`/books/${id}/chapters/${number}/submit`, { method: "POST", body: JSON.stringify({ answers }) });
  },
  answer(id: number, number: number, index: number, choice: number) {
    return request<AnswerFeedback>(`/books/${id}/chapters/${number}/answer`, { method: "POST", body: JSON.stringify({ index, choice }) });
  },
  knowledge(id: number) {
    return request<{ chapters: KnowledgeChapter[] }>(`/books/${id}/knowledge`);
  },
  recap(id: number) {
    return request<Recap>(`/books/${id}/recap`);
  },
  regenerate(id: number, number: number, difficulty_hint: string) {
    return request<{ task_id: number }>(`/books/${id}/chapters/${number}/regenerate`, { method: "POST", body: JSON.stringify({ difficulty_hint }) });
  },
  finalize(id: number) {
    return request<{ task_id: number }>(`/books/${id}/finalize`, { method: "POST" });
  },
  endings(id: number) {
    return request<{ endings: Ending[] }>(`/books/${id}/endings`);
  },
  rewalk(id: number, style: string) {
    return request<{ task_id: number }>(`/books/${id}/endings/${encodeURIComponent(style)}`, { method: "POST" });
  },
  task(id: number) {
    return request<Task>(`/tasks/${id}`);
  },
};

export function errorMessage(error: unknown): string {
  return error instanceof AppError ? error.message : "操作未完成，请稍后重试。";
}
