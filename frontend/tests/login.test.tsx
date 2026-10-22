// @vitest-environment jsdom
import { createElement, type AnchorHTMLAttributes } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "../app/login/page";
import { api } from "../lib/api";
import { loadLoginMemory, saveLoginMemory } from "../lib/login-memory";

vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props) }));
vi.mock("../lib/api", () => ({
  api: { me: vi.fn(), sendCode: vi.fn(), login: vi.fn() },
  errorMessage: () => "请求失败，请重试",
}));
const PHONE = "13800000000";
const CODE = "123456"; // 测试 fixture，不使用本机演示码。
const phoneInput = () => screen.getByPlaceholderText("请输入手机号") as HTMLInputElement;
const codeInput = () => screen.getByPlaceholderText("请输入验证码") as HTMLInputElement;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.me).mockResolvedValue({ user: null, demo_autofill: true });
  vi.mocked(api.sendCode).mockResolvedValue({ sent: true, cooldown: 0, demo_code: CODE });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); });

describe("remembered demo login", () => {
  it("restores only previously checked consent and fetches a fresh code on phone focus", async () => {
    saveLoginMemory({ phone: PHONE, agreed: true }, true);
    render(<LoginPage />);
    await waitFor(() => expect(phoneInput().value).toBe(PHONE));
    expect((screen.getAllByRole("checkbox") as HTMLInputElement[]).every((el) => el.checked)).toBe(true);
    expect(api.sendCode).not.toHaveBeenCalled();
    expect(codeInput().value).toBe("");
    fireEvent.focus(phoneInput());
    await waitFor(() => expect(codeInput().value).toBe(CODE));
    expect(api.sendCode).toHaveBeenCalledWith(PHONE, true);
    expect(screen.getByRole("status").textContent).toBe("验证码已填写");
    expect(screen.queryByText(/演示|本机测试/)).toBeNull();
    expect(localStorage.getItem("yuedu-login-memory-v1")).not.toContain(CODE);
  });

  it("persists edits across remounts, and clears consent when changing the account", async () => {
    const view = render(<LoginPage />);
    await screen.findByText("清除记录");
    fireEvent.change(phoneInput(), { target: { value: PHONE } });
    screen.getAllByRole("checkbox").forEach((el) => fireEvent.click(el));
    view.unmount();
    render(<LoginPage />);
    await waitFor(() => expect(phoneInput().value).toBe(PHONE));
    expect(loadLoginMemory(true)).toEqual({ phone: PHONE, agreed: true });
    fireEvent.change(phoneInput(), { target: { value: "13900000000" } });
    expect((screen.getAllByRole("checkbox") as HTMLInputElement[]).every((el) => !el.checked)).toBe(true);
    expect(loadLoginMemory(true).agreed).toBe(false);
  });

  it("does not auto-request codes or restore consent when demo mode is off", async () => {
    saveLoginMemory({ phone: PHONE, agreed: true }, true);
    vi.mocked(api.me).mockResolvedValue({ user: null, demo_autofill: false });
    render(<LoginPage />);
    await waitFor(() => expect(phoneInput().value).toBe(PHONE));
    fireEvent.focus(phoneInput());
    expect(api.sendCode).not.toHaveBeenCalled();
    expect(codeInput().value).toBe("");
    expect((screen.getAllByRole("checkbox") as HTMLInputElement[]).every((el) => !el.checked)).toBe(true);
    expect(screen.queryByText("清除记录")).toBeNull();
  });

  it("does not let a delayed response refill a cleared form", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof api.sendCode>>) => void;
    vi.mocked(api.sendCode).mockReturnValue(new Promise((r) => { resolve = r; }));
    saveLoginMemory({ phone: PHONE, agreed: true }, true);
    render(<LoginPage />);
    await waitFor(() => expect(phoneInput().value).toBe(PHONE));
    fireEvent.focus(phoneInput());
    fireEvent.click(screen.getByText("清除记录"));
    await act(async () => resolve({ sent: true, cooldown: 0, demo_code: CODE }));
    expect(phoneInput().value).toBe("");
    expect(codeInput().value).toBe("");
    expect(loadLoginMemory(true)).toEqual({ phone: "", agreed: false });
  });

  it("still fills the code if the user moves on to a checkbox before the response", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof api.sendCode>>) => void;
    vi.mocked(api.sendCode).mockReturnValue(new Promise((r) => { resolve = r; }));
    saveLoginMemory({ phone: PHONE, agreed: false }, true);
    render(<LoginPage />);
    await waitFor(() => expect(phoneInput().value).toBe(PHONE));
    fireEvent.focus(phoneInput()); fireEvent.blur(phoneInput());
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    await act(async () => resolve({ sent: true, cooldown: 0, demo_code: CODE }));
    expect(codeInput().value).toBe(CODE);
  });

  it("handles corrupt or unavailable browser storage without breaking login", async () => {
    localStorage.setItem("yuedu-login-memory-v1", "not-json");
    expect(loadLoginMemory(true).phone).toBe("");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<LoginPage />);
    await screen.findByText("清除记录");
    fireEvent.change(phoneInput(), { target: { value: PHONE } });
    fireEvent.click(screen.getByText("获取验证码"));
    await waitFor(() => expect(codeInput().value).toBe(CODE));
  });
});


it("submits with agreement only, without an age field", async () => {
  vi.mocked(api.login).mockRejectedValue(new Error("fixture: avoid navigation"));
  render(<LoginPage />);
  await screen.findByText("清除记录");
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  fireEvent.change(phoneInput(), { target: { value: PHONE } });
  fireEvent.change(codeInput(), { target: { value: CODE } });
  fireEvent.click(screen.getByRole("button", { name: "登录" }));
  expect(api.login).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "登录" }));
  await waitFor(() => expect(api.login).toHaveBeenCalledWith({ phone: PHONE, code: CODE, agreed: true }));
});

it("restores old saved phone and agreement while discarding the obsolete age field", () => {
  localStorage.setItem("yuedu-login-memory-v1", JSON.stringify({ phone: PHONE, agreed: true, adult: true }));
  const restored = loadLoginMemory(true);
  expect(restored).toEqual({ phone: PHONE, agreed: true });
  saveLoginMemory(restored, true);
  expect(localStorage.getItem("yuedu-login-memory-v1")).not.toContain("adult");
});
