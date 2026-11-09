"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "./admin-auth";
import { DEPT_COOKIE, asFilter } from "./dept";

export async function setDeptFilter(fd: FormData) {
  await requireAdmin();
  const v = String(fd.get("dept"));
  (await cookies()).set(DEPT_COOKIE, asFilter(v), { httpOnly: true, sameSite: "strict", path: "/admin", maxAge: 31536000 });
  revalidatePath("/admin", "layout");
}
