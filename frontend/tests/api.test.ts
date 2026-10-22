// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, AppError } from "../lib/api";
import { clearTask, loadTask, saveTask, taskState } from "../lib/task";

afterEach(() => vi.unstubAllGlobals());

describe("API boundary", () => {
  it("returns a safe message and code for backend errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 403,
      json: async () => ({ error: { code: "FORBIDDEN", message: "这章还没解锁" } }),
    }));
    await expect(api.chapter(1, 3)).rejects.toMatchObject({
      code: "FORBIDDEN", message: "这章还没解锁", retryable: false,
    } satisfies Partial<AppError>);
  });

  it("rejects malformed book lists before showing an empty state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ books: null }),
    }));
    await expect(api.books()).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("maps the backend task states without treating unknown states as complete", () => {
    expect(taskState("pending")).toBe("queued");
    expect(taskState("running")).toBe("running");
    expect(taskState("done")).toBe("succeeded");
    expect(taskState("error")).toBe("failed");
    expect(taskState("paused")).toBe("unknown");
  });

  it("persists only a task ID as a recovery pointer", () => {
    saveTask(7, { id: 42, kind: "chapter", chapterNo: 2 });
    expect(loadTask(7)).toEqual({ id: 42, kind: "chapter", chapterNo: 2 });
    expect(localStorage.getItem("yuedu-active-task-7")).not.toContain("running");
    clearTask(7);
    expect(loadTask(7)).toBeNull();
  });
});
