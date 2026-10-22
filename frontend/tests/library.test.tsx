// @vitest-environment jsdom
import { createElement, type AnchorHTMLAttributes } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LibraryPage from "../app/library/page";
import CreatePage from "../app/create/page";
import Landing from "../app/page";
import { SiteHeader } from "../components/site/SiteHeader";
import { useAccount, safeNext } from "../lib/account";
import { api, type BookSummary, type User } from "../lib/api";
const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/library", useRouter: () => ({ replace }) }));
vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props) }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("../lib/account", async (original) => ({ ...await original<typeof import("../lib/account")>(), useAccount: vi.fn() }));
vi.mock("../lib/api", () => ({ api: { books: vi.fn(), logout: vi.fn() }, errorMessage: () => "连接中断，请重试" }));
const user: User = { id: 1, nickname: "测试读者", phone_masked: "138****0000", created_at: "2026-10-22" };
const books: BookSummary[] = [
  { id: 1, title: "时间的利息", topic: "复利", genre: "都市", mode: "full", planned_chapters: 5, current_chapter: 2, status: "reading", created_at: "2026-10-22" },
  { id: 2, title: "山间的花", topic: "光合作用", genre: "悬疑", mode: "quick", planned_chapters: 1, status: "completed", created_at: "2026-10-21" },
];
beforeEach(() => { vi.mocked(useAccount).mockReturnValue({ user, ready: true }); vi.mocked(api.books).mockResolvedValue(books); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("keeps workspace navigation separate and links the brand to the public home", () => {
  render(<SiteHeader user={user} />);
  const nav = within(screen.getByRole("navigation"));
  expect(nav.getByRole("link", { name: "学习书架" }).getAttribute("href")).toBe("/library");
  expect(nav.queryByRole("link", { name: "首页" })).toBeNull();
  expect(nav.getAllByRole("link").map((link) => link.textContent)).toEqual(["新建学习", "学习书架"]);
  expect(screen.getByRole("link", { name: "悦读" }).getAttribute("href")).toBe("/");
  expect(safeNext(null)).toBe("/library");
  expect(safeNext("/book/1")).toBe("/book/1");
});
it("keeps the signed-in landing page outside the workspace without redirecting", () => {
  render(<Landing />);
  expect(replace).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("读进故事里");
  expect(screen.getByRole("link", { name: "进入学习书架" }).getAttribute("href")).toBe("/library");
  expect(screen.queryByRole("navigation")).toBeNull();
});
it("keeps the public landing page and directs visitors to login then library", () => {
  vi.mocked(useAccount).mockReturnValue({ user: null, ready: true });
  render(<Landing />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("读进故事里");
  expect(screen.getAllByRole("link", { name: "开始学习" })[0].getAttribute("href")).toBe("/login?next=%2Flibrary");
  expect(screen.queryByRole("navigation")).toBeNull();
});
it("groups actual learning progress and searches titles and topics", async () => {
  render(<LibraryPage />);
  const reading = await screen.findByRole("region", { name: "正在学习" });
  expect(within(reading).getByRole("link").getAttribute("aria-label")).toContain("2 / 5");
  expect(within(screen.getByRole("region", { name: "已经读完" })).getByRole("link").getAttribute("aria-label")).toContain("1 / 1");
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "光合" } });
  expect(screen.queryByText("时间的利息")).toBeNull();
  expect(screen.getByText("山间的花")).toBeTruthy();
});
it("shows an empty bookshelf with a separate creation entry", async () => {
  vi.mocked(api.books).mockResolvedValue([]);
  render(<LibraryPage />);
  await screen.findByText("书架上的第一本，等你开启");
  expect(screen.getByRole("link", { name: "开始新的学习" }).getAttribute("href")).toBe("/create");
  expect(screen.queryByPlaceholderText("例如：复利、英语时态、光合作用")).toBeNull();
});
it("distinguishes fetch failures from empty data and retries", async () => {
  vi.mocked(api.books).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(books);
  render(<LibraryPage />);
  await screen.findByRole("alert");
  expect(screen.queryByText("书架上的第一本，等你开启")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
  await screen.findByRole("region", { name: "正在学习" });
  expect(api.books).toHaveBeenCalledTimes(2);
});

it("redirects legacy learning-record anchors even when only the hash changes", async () => {
  window.history.replaceState({}, "", "/create");
  render(<CreatePage />);
  expect(replace).not.toHaveBeenCalled();
  window.history.replaceState({}, "", "/create#books");
  fireEvent(window, new HashChangeEvent("hashchange"));
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/library"));
  window.history.replaceState({}, "", "/");
});

it("opens the account disclosure by click, closes with Escape and outside click", () => {
  render(<SiteHeader user={user} />);
  const trigger = screen.getByRole("button", { name: "账号菜单" });
  expect(screen.queryByRole("button", { name: "退出登录" })).toBeNull();
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("link", { name: "个人中心" }).getAttribute("href")).toBe("/me");
  expect(screen.getByText(user.phone_masked)).toBeTruthy();
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(screen.getByRole("button", { name: "退出登录" })).toBeTruthy();
  fireEvent.pointerDown(document.body);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});
it("preserves the account and offers retry when logout fails", async () => {
  vi.mocked(api.logout).mockRejectedValue(new Error("offline"));
  render(<SiteHeader user={user} />);
  fireEvent.click(screen.getByRole("button", { name: "账号菜单" }));
  fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
  expect(screen.getByRole("button", { name: "正在退出…" }).hasAttribute("disabled")).toBe(true);
  await screen.findByRole("alert");
  expect(api.logout).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "退出登录" }).hasAttribute("disabled")).toBe(false);
});
