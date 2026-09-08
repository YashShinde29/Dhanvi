"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProtectedPage } from "@/features/auth/protected-page";
import { useAuth } from "@/features/auth/auth-context";
import { userService } from "@/services/user.service";
import { errorMessage, passwordError } from "@/utils/forms";

export default function ProfilePage() {
  const auth = useAuth();
  return <ProtectedPage>{auth.user ? <ProfileContent key={auth.user.id} /> : null}</ProtectedPage>;
}

function ProfileContent() {
  const auth = useAuth(); const router = useRouter();
  const user = auth.user!;
  const [firstName, setFirstName] = useState(user.firstName); const [lastName, setLastName] = useState(user.lastName); const [phone, setPhone] = useState(user.phoneNumber ?? "");
  const [currentPassword, setCurrentPassword] = useState(""); const [newPassword, setNewPassword] = useState("");
  const [notice, setNotice] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function saveProfile(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { auth.setUser(await userService.updateProfile(firstName, lastName, phone)); setNotice("Profile updated."); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  async function changePassword(event: FormEvent) {
    event.preventDefault(); const issue = passwordError(newPassword); if (issue) { setError(issue); return; }
    setBusy(true); setError(""); setNotice("");
    try { await userService.changePassword(currentPassword, newPassword); auth.setUser(null); router.replace("/login?passwordChanged=true"); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <section><p className="eyebrow">Account</p><h1>Your profile</h1>
    <div className="profile-meta"><span>{user.email}</span><span>Email verified: {user.emailVerified ? "Yes" : "No"}</span><span>Phone verified: {user.phoneVerified ? "Yes" : "No"}</span><span>Roles: {auth.roles.join(", ")}</span><span>Organizer: {user.organizerStatus.replaceAll("_", " ")}</span><span>Created: {new Date(user.createdAt).toLocaleDateString()}</span></div>
    {notice && <p className="form-success" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    <div className="card-grid">
      <form className="panel form-stack" onSubmit={saveProfile}><h2>Personal details</h2>
        <label>First name<input required value={firstName} onChange={e => setFirstName(e.target.value)} /></label>
        <label>Last name<input required value={lastName} onChange={e => setLastName(e.target.value)} /></label>
        <label>Phone number<input type="tel" value={phone} onChange={e => setPhone(e.target.value)} /></label>
        <button className="button" disabled={busy}>Save profile</button>
      </form>
      <form className="panel form-stack" onSubmit={changePassword}><h2>Change password</h2>
        <label>Current password<input type="password" autoComplete="current-password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label>
        <label>New password<input type="password" autoComplete="new-password" required value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label>
        <p className="field-help">Use at least 12 characters with upper and lowercase letters, a number, and a symbol.</p>
        <button className="button secondary" disabled={busy}>Change password</button>
      </form>
    </div>
  </section>;
}
