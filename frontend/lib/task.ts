import type { Task } from "./api";

export type ActiveTask = { id: number; kind: Task["kind"]; chapterNo?: number };

export function taskState(status: Task["status"] | string): "queued" | "running" | "succeeded" | "failed" | "unknown" {
  if (status === "pending") return "queued";
  if (status === "running") return "running";
  if (status === "done") return "succeeded";
  if (status === "error") return "failed";
  return "unknown";
}

export function taskKey(bookId: number): string {
  return `yuedu-active-task-${bookId}`;
}

export function saveTask(bookId: number, task: ActiveTask): void {
  localStorage.setItem(taskKey(bookId), JSON.stringify(task));
}

export function loadTask(bookId: number): ActiveTask | null {
  try {
    const raw = localStorage.getItem(taskKey(bookId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || !("id" in value) || typeof value.id !== "number") return null;
    return value as ActiveTask;
  } catch {
    return null;
  }
}

export function clearTask(bookId: number): void {
  localStorage.removeItem(taskKey(bookId));
}
