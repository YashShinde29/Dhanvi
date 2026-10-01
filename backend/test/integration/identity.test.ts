import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, expectOk, type Harness, registerUser } from "../support/harness.js";

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

describe("authentication", () => {
  it("registers, rejects duplicates and invalid input with the .NET ProblemDetails shape", async () => {
    const api = as(h, null);
    const body = { firstName: "Asha", lastName: "Rao", email: "asha.identity@example.com", phoneNumber: null, password: "Passw0rd!" };
    const created = expectOk(await api("POST", "auth/register", body));
    expect(created).toMatchObject({ firstName: "Asha", lastName: "Rao", email: "asha.identity@example.com", roles: ["USER"] });
    const duplicate = await api("POST", "auth/register", { ...body, email: " ASHA.identity@example.com " });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ type: "conflict", title: "Email is already registered.", status: 409, instance: "/api/v1/auth/register" });
    const invalid = await api("POST", "auth/register", { firstName: "", lastName: "Rao", email: "bad", password: "x" });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().errors).toEqual({
      firstName: ["First name is required."], email: ["A valid email is required."],
      password: ["Password must contain at least 8 characters.", "Password must contain an uppercase letter.", "Password must contain a number.", "Password must contain a special character."],
    });
    expect(invalid.json().traceId).toBeTruthy();
  });

  it("logs in with HttpOnly SameSite=Strict cookies and the same JWT claim set as .NET", async () => {
    const res = await as(h, null)("POST", "auth/login", { email: "asha.identity@example.com", password: "Passw0rd!" });
    expect(res.statusCode).toBe(200);
    const cookies = ([] as string[]).concat(res.headers["set-cookie"] as string[]);
    expect(cookies.find((c) => c.startsWith("dhanvi_access="))).toMatch(/Max-Age=900; Path=\/; HttpOnly; SameSite=Strict/);
    expect(cookies.find((c) => c.startsWith("dhanvi_refresh="))).toMatch(/Max-Age=2592000; Path=\/; HttpOnly; SameSite=Strict/);
    const json = res.json();
    expect(json.expiresIn).toBe(900);
    const claims = JSON.parse(Buffer.from(json.accessToken.split(".")[1], "base64url").toString());
    expect(Object.keys(claims)).toEqual(["sub", "email", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier", "http://schemas.microsoft.com/ws/2008/06/identity/claims/role", "nbf", "exp", "iss", "aud"]);
    expect(claims).toMatchObject({ iss: "Dhanvi", aud: "Dhanvi.Web", "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": "USER" });
    expect(json.user).toMatchObject({ organizerStatus: "NOT_APPLIED", emailVerified: false, roles: ["USER"] });
    const wrong = await as(h, null)("POST", "auth/login", { email: "asha.identity@example.com", password: "nope" });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toMatchObject({ type: "authentication_error", title: "Invalid email or password." });
  });

  it("authenticates by bearer or cookie; anonymous requests get an empty 401 with WWW-Authenticate", async () => {
    const anon = await as(h, null)("GET", "users/me");
    expect(anon.statusCode).toBe(401);
    expect(anon.body).toBe("");
    expect(anon.headers["www-authenticate"]).toBe("Bearer");
    const login = await as(h, null)("POST", "auth/login", { email: "asha.identity@example.com", password: "Passw0rd!" });
    const cookie = ([] as string[]).concat(login.headers["set-cookie"] as string[]).map((c) => c.split(";")[0]).join("; ");
    const me = await h.app.inject({ method: "GET", url: "/api/v1/users/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe("asha.identity@example.com");
  });

  it("rotates refresh tokens and rejects reuse; logout revokes", async () => {
    const login = expectOk(await as(h, null)("POST", "auth/login", { email: "asha.identity@example.com", password: "Passw0rd!" }));
    const first = expectOk(await as(h, null)("POST", "auth/refresh", { refreshToken: login.refreshToken }));
    expect(first.refreshToken).not.toBe(login.refreshToken);
    expect((await as(h, null)("POST", "auth/refresh", { refreshToken: login.refreshToken })).statusCode).toBe(401);
    expect((await as(h, null)("POST", "auth/logout", { refreshToken: first.refreshToken })).statusCode).toBe(204);
    expect((await as(h, null)("POST", "auth/refresh", { refreshToken: first.refreshToken })).statusCode).toBe(401);
    expect((await as(h, null)("POST", "auth/refresh", {})).statusCode).toBe(401);
  });

  it("resets passwords once, revoking existing sessions; forgot-password never reveals accounts", async () => {
    let raw = "";
    const local = await createHarness();
    try {
      (local.services.auth as unknown as { deliverReset: (e: string, t: string) => Promise<void> }).deliverReset = async (_e, t) => { raw = t; };
      const user = await registerUser(local);
      expect(expectOk(await as(local, null)("POST", "auth/forgot-password", { email: "nobody@example.com" }))).toEqual({ message: "If an account exists, password reset instructions have been sent." });
      expectOk(await as(local, null)("POST", "auth/forgot-password", { email: user.email }));
      expect(raw.length).toBeGreaterThan(40);
      expectOk(await as(local, null)("POST", "auth/reset-password", { token: raw, newPassword: "N3w-Password" }));
      expect((await as(local, null)("POST", "auth/reset-password", { token: raw, newPassword: "N3w-Password" })).json().errors).toEqual({ token: ["Reset token is invalid or expired."] });
      expect((await as(local, null)("POST", "auth/login", { email: user.email, password: "N3w-Password" })).statusCode).toBe(200);
      const audit = await local.db.query<{ Action: string }>(`SELECT "Action" FROM audit.audit_logs WHERE "ActorUserId" = $1 ORDER BY "Timestamp"`, [user.id]);
      expect(audit.map((a) => a.Action)).toEqual(expect.arrayContaining(["USER_REGISTERED", "USER_LOGIN_SUCCESS", "PASSWORD_RESET"]));
    } finally { await local.close(); }
  });

  it("updates profile and changes password with validation", async () => {
    const user = await registerUser(h);
    const updated = expectOk(await as(h, user)("PUT", "users/me", { firstName: " Ravi ", lastName: "K", phoneNumber: "+91 98765 43210" }));
    expect(updated).toMatchObject({ firstName: "Ravi", lastName: "K", phoneNumber: "+91 98765 43210" });
    expect((await as(h, user)("PUT", "users/me", { firstName: "", lastName: "K", phoneNumber: "abc" })).json().errors).toEqual({ firstName: ["First name is required."], phoneNumber: ["Phone number format is invalid."] });
    expect((await as(h, user)("PUT", "users/me/password", { currentPassword: "wrong", newPassword: "Another1!" })).json().errors).toEqual({ currentPassword: ["Current password is incorrect."] });
    expect((await as(h, user)("PUT", "users/me/password", { currentPassword: "Passw0rd!", newPassword: "Another1!" })).statusCode).toBe(204);
  });
});

describe("organizer workflow and role-based authorization", () => {
  it("applies, lists for admins only, approves with the ORGANIZER role exactly once", async () => {
    const user = await registerUser(h, [], "Neha");
    const admin = await registerUser(h, ["ADMIN"], "Admin");
    const application = { address: "1 MG Road", city: "Pune", state: "MH", postalCode: "411001", reasonForBecomingOrganizer: "Community savings" };
    expect((await as(h, user)("POST", "organizers/apply", { ...application, city: "" })).json().errors).toEqual({ city: ["City is required."] });
    const applied = expectOk(await as(h, user)("POST", "organizers/apply", application));
    expect(applied.status).toBe("PENDING");
    expect((await as(h, user)("POST", "organizers/apply", application)).statusCode).toBe(409);
    expect((await as(h, user)("GET", "admin/organizer-applications")).statusCode).toBe(403);
    const list = expectOk(await as(h, admin)("GET", `admin/organizer-applications?status=PENDING&search=Neha`));
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ applicant: expect.stringContaining("Neha"), status: "PENDING" });
    expect((await as(h, admin)("POST", `admin/organizer-applications/${applied.application.id}/approve`)).statusCode).toBe(204);
    expect((await as(h, admin)("POST", `admin/organizer-applications/${applied.application.id}/approve`)).statusCode).toBe(409);
    expect(expectOk(await as(h, user)("GET", "organizers/me")).status).toBe("APPROVED");
    const relogin = expectOk(await as(h, null)("POST", "auth/login", { email: user.email, password: "Passw0rd!" }));
    expect(relogin.user.roles).toEqual(["ORGANIZER", "USER"]);
    const audit = await h.db.query<{ Action: string }>(`SELECT "Action" FROM audit.audit_logs WHERE "EntityId" IN ($1,$2)`, [applied.application.id, user.id]);
    expect(audit.filter((a) => a.Action === "USER_ROLE_ASSIGNED")).toHaveLength(1);
    expect((await as(h, admin)("POST", `admin/organizers/${user.id}/suspend`)).statusCode).toBe(204);
    expect(expectOk(await as(h, user)("GET", "organizers/me")).status).toBe("SUSPENDED");
    expect((await as(h, admin)("POST", `admin/organizer-applications/not-a-guid/approve`)).statusCode).toBe(404);
  });
});
