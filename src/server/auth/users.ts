import type { Staff, User } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { HttpError } from "../http";
import { hashPassword, verifyPassword } from "./password";

export const phoneSchema = z
  .string()
  .transform((s) => s.replace(/[^0-9]/g, ""))
  .refine((s) => /^01[016789][0-9]{7,8}$/.test(s), "휴대폰 번호를 확인해 주세요.");

export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email("이메일 형식을 확인해 주세요."),
  password: z.string().min(8, "비밀번호는 8자 이상으로 정해 주세요.").max(100),
  name: z.string().trim().min(1, "이름을 넣어 주세요.").max(30),
  phone: phoneSchema,
  marketing_opt_in: z.boolean().optional().default(false),
  agree_terms: z.literal(true, { message: "이용약관에 동의해 주세요." }),
  agree_privacy: z.literal(true, { message: "개인정보 수집·이용에 동의해 주세요." }),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, "이메일을 넣어 주세요."),
  password: z.string().min(1, "비밀번호를 넣어 주세요."),
});

export type PublicUser = Pick<User, "id" | "email" | "name" | "phone" | "marketing_opt_in">;
export const publicUser = (u: User): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  phone: u.phone,
  marketing_opt_in: u.marketing_opt_in,
});

export type PublicStaff = Pick<Staff, "id" | "email" | "name" | "role">;
export const publicStaff = (s: Staff): PublicStaff => ({ id: s.id, email: s.email, name: s.name, role: s.role });

export async function signup(input: z.infer<typeof signupSchema>): Promise<User> {
  const exists = await db.user.findUnique({ where: { email: input.email } });
  if (exists) throw new HttpError(409, "EMAIL_TAKEN", "이미 가입한 이메일이에요.");
  return db.user.create({
    data: {
      email: input.email,
      password_hash: await hashPassword(input.password),
      name: input.name,
      phone: input.phone,
      marketing_opt_in: input.marketing_opt_in,
    },
  });
}

const WRONG = new HttpError(401, "WRONG_LOGIN", "이메일 또는 비밀번호가 맞지 않아요.");

export async function login(email: string, password: string): Promise<User> {
  const u = await db.user.findUnique({ where: { email } });
  if (!u || !(await verifyPassword(password, u.password_hash))) throw WRONG;
  return u;
}

export async function staffLogin(email: string, password: string): Promise<Staff> {
  const s = await db.staff.findUnique({ where: { email } });
  if (!s || !s.active || !(await verifyPassword(password, s.password_hash))) throw WRONG;
  return s;
}
