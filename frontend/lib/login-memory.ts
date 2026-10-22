const KEY = "yuedu-login-memory-v1";
export type LoginMemory = { phone: string; agreed: boolean };
const EMPTY: LoginMemory = { phone: "", agreed: false };

export function loadLoginMemory(demoMode: boolean): LoginMemory {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!saved || typeof saved !== "object" || !("phone" in saved)
      || typeof saved.phone !== "string" || !/^\d{0,11}$/.test(saved.phone)) return { ...EMPTY };
    return {
      phone: saved.phone,
      agreed: demoMode && "agreed" in saved && saved.agreed === true,
    };
  } catch { return { ...EMPTY }; }
}

export function saveLoginMemory(value: LoginMemory, demoMode: boolean) {
  try {
    // 只持久化用户输入和确认；不接收验证码或会话凭证。
    localStorage.setItem(KEY, JSON.stringify({
      phone: value.phone.replace(/\D/g, "").slice(0, 11),
      agreed: demoMode && value.agreed,
    }));
  } catch { /* 禁用本地存储时仍可正常登录。 */ }
}

export function clearLoginMemory() {
  try { localStorage.removeItem(KEY); } catch { /* 存储不可用时清除页面状态即可。 */ }
}
