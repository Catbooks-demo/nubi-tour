import { beforeEach, describe, expect, it } from "vitest";
import { POST as adminLogin } from "@/app/api/admin/auth/login/route";
import { GET as adminMe } from "@/app/api/admin/auth/me/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as signup } from "@/app/api/auth/signup/route";
import { db } from "@/server/db";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { STAFF_COOKIE, USER_COOKIE, issueStaffSession, requireStaff } from "@/server/auth/session";
import { HttpError } from "@/server/http";
import { resetDb } from "./helpers/db";
import { call } from "./helpers/http";

const form = {
  email: "Minji@Example.com",
  password: "travel-2026",
  name: "김민지",
  phone: "010-1234-5678",
  agree_terms: true,
  agree_privacy: true,
};

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

describe("회원", () => {
  it("가입 → 내 정보 → 로그아웃", async () => {
    const r = await call(signup, { body: form });
    expect(r.status).toBe(201);
    expect(r.body.user.email).toBe("minji@example.com");
    expect(r.body.user.phone).toBe("01012345678");
    const token = r.cookie(USER_COOKIE);
    expect(token).toBeTruthy();

    const m = await call(me, { cookies: { [USER_COOKIE]: token } });
    expect(m.status).toBe(200);
    expect(m.body.user.name).toBe("김민지");

    await call(logout, { method: "POST", cookies: { [USER_COOKIE]: token } });
    expect((await call(me, { cookies: { [USER_COOKIE]: token } })).status).toBe(401);
  });

  it("같은 이메일 409, 짧은 비밀번호·약관 미동의 400", async () => {
    await call(signup, { body: form });
    expect((await call(signup, { body: { ...form, email: "minji@example.com" } })).status).toBe(409);
    expect((await call(signup, { body: { ...form, email: "a@b.com", password: "short" } })).status).toBe(400);
    expect((await call(signup, { body: { ...form, email: "c@d.com", agree_terms: false } })).status).toBe(400);
    expect((await call(signup, { body: { ...form, email: "e@f.com", phone: "02-123-4567" } })).status).toBe(400);
  });

  it("로그인 성공은 쿠키, 틀린 비밀번호 401, 11번째 시도는 429", async () => {
    await call(signup, { body: form });
    const ok = await call(login, { body: { email: form.email, password: form.password } });
    expect(ok.status).toBe(200);
    expect(ok.cookie(USER_COOKIE)).toBeTruthy();
    resetRateLimits();
    for (let i = 0; i < 10; i++) {
      expect((await call(login, { body: { email: form.email, password: "wrong-pass" } })).status).toBe(401);
    }
    expect((await call(login, { body: { email: form.email, password: form.password } })).status).toBe(429);
  });

  it("비밀번호 원문을 저장하지 않는다", async () => {
    await call(signup, { body: form });
    const u = await db.user.findFirstOrThrow();
    expect(u.password_hash).not.toContain(form.password);
    expect(await verifyPassword(form.password, u.password_hash)).toBe(true);
    expect(await verifyPassword("other", u.password_hash)).toBe(false);
  });
});

describe("직원", () => {
  async function makeStaff(role: "admin" | "agent") {
    return db.staff.create({
      data: { email: `${role}@nubi.test`, name: role, role, password_hash: await hashPassword("staff-pass-1") },
    });
  }

  it("직원 로그인 → me", async () => {
    await makeStaff("agent");
    const r = await call(adminLogin, { body: { email: "agent@nubi.test", password: "staff-pass-1" } });
    expect(r.status).toBe(200);
    const m = await call(adminMe, { cookies: { [STAFF_COOKIE]: r.cookie(STAFF_COOKIE) } });
    expect(m.body.staff.role).toBe("agent");
  });

  it("쿠키 없으면 401, agent가 관리자 전용이면 403, 회원 쿠키로는 안 됨", async () => {
    expect((await call(adminMe)).status).toBe(401);
    const agent = await makeStaff("agent");
    const token = await issueStaffSession(agent.id);
    const req = new Request("http://localhost/x", { headers: { cookie: `${STAFF_COOKIE}=${token}` } });
    await expect(requireStaff(req, "admin")).rejects.toMatchObject({ status: 403 });
    await expect(requireStaff(req)).resolves.toMatchObject({ id: agent.id });

    const u = await call(signup, { body: form });
    const asUser = new Request("http://localhost/x", { headers: { cookie: `${STAFF_COOKIE}=${u.cookie(USER_COOKIE)}` } });
    await expect(requireStaff(asUser)).rejects.toBeInstanceOf(HttpError);
  });

  it("비활성 직원은 로그인할 수 없다", async () => {
    const s = await makeStaff("admin");
    await db.staff.update({ where: { id: s.id }, data: { active: false } });
    expect((await call(adminLogin, { body: { email: "admin@nubi.test", password: "staff-pass-1" } })).status).toBe(401);
  });
});
