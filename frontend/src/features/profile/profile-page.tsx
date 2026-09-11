"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/auth-context";
import { userService } from "@/services/user.service";
import { PageHeader } from "@/components/ui/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description";
import { FormField, Input, PasswordInput } from "@/components/ui/form";
import { Icons } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { fieldErrors, friendlyError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { primaryRoleLabel } from "@/components/layout/navigation";
import { PASSWORD_HINT, passwordError } from "@/utils/forms";

export function ProfilePage() {
  const auth = useAuth();
  const router = useRouter();
  const toast = useToast();
  const user = auth.user!;
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [phone, setPhone] = useState(user.phoneNumber ?? "");
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [profileBusy, setProfileBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordFailure, setPasswordFailure] = useState("");
  const name = `${user.firstName} ${user.lastName}`.trim();

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (profileBusy) return;
    const next: Record<string, string> = {};
    if (!firstName.trim()) next.firstName = "Enter your first name.";
    if (!lastName.trim()) next.lastName = "Enter your last name.";
    setProfileErrors(next);
    if (Object.keys(next).length) return;
    setProfileBusy(true);
    try { auth.setUser(await userService.updateProfile(firstName.trim(), lastName.trim(), phone.trim())); toast.success("Profile updated"); }
    catch (failure) { const fields = fieldErrors(failure); if (Object.keys(fields).length) setProfileErrors(fields); else toast.error("Profile not saved", friendlyError(failure)); }
    finally { setProfileBusy(false); }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (passwordBusy) return;
    setPasswordFailure("");
    const next: Record<string, string> = {};
    if (!currentPassword) next.currentPassword = "Enter your current password.";
    const issue = passwordError(newPassword);
    if (issue) next.newPassword = issue;
    if (newPassword !== confirmPassword) next.confirmPassword = "Passwords do not match.";
    setPasswordErrors(next);
    if (Object.keys(next).length) return;
    setPasswordBusy(true);
    try { await userService.changePassword(currentPassword, newPassword); auth.setUser(null); router.replace("/login?passwordChanged=true"); }
    catch (failure) { const fields = fieldErrors(failure); if (Object.keys(fields).length) setPasswordErrors(fields); else setPasswordFailure(friendlyError(failure)); setPasswordBusy(false); }
  }

  const organizerHref = user.organizerStatus === "NOT_APPLIED" ? "/become-organizer" : "/organizer/application-status";

  return (
    <div className="stack stack--lg">
      <PageHeader eyebrow="Account" title="Profile & security" description="Keep your details current. Your contact details are only shared with organizers of groups you join." />
      <Card>
        <CardBody className="row" style={{ gap: 16 }}>
          <Avatar name={name} size="lg" />
          <div style={{ minWidth: 0 }}>
            <div className="h-section">{name}</div>
            <div className="text-sm text-muted" style={{ overflowWrap: "anywhere" }}>{user.email}</div>
            <div className="row" style={{ marginTop: 6, gap: 6 }}>
              {user.roles.map((role) => <Badge key={role} tone={role === "SUPER_ADMIN" || role === "ADMIN" ? "indigo" : role === "ORGANIZER" ? "success" : "neutral"} plain>{role === "USER" ? "Member" : primaryRoleLabel({ ...user, roles: [role] })}</Badge>)}
            </div>
          </div>
        </CardBody>
      </Card>
      <div className="grid-2">
        <div className="stack stack--lg">
          <Card>
            <CardHeader title="Personal information" />
            <CardBody>
              <form className="stack" onSubmit={saveProfile} noValidate>
                <div className="grid-2">
                  <FormField label="First name" htmlFor="profile-first" required error={profileErrors.firstName}><Input id="profile-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} invalid={!!profileErrors.firstName} autoComplete="given-name" /></FormField>
                  <FormField label="Last name" htmlFor="profile-last" required error={profileErrors.lastName}><Input id="profile-last" value={lastName} onChange={(e) => setLastName(e.target.value)} invalid={!!profileErrors.lastName} autoComplete="family-name" /></FormField>
                </div>
                <FormField label="Phone number" htmlFor="profile-phone" optional error={profileErrors.phoneNumber} help="Shared with organizers of groups where you're an approved member."><Input id="profile-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} invalid={!!profileErrors.phoneNumber} autoComplete="tel" /></FormField>
                <div className="form-actions"><Button type="submit" loading={profileBusy}>Save changes</Button></div>
              </form>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Change password" subtitle="You'll be signed out after changing your password." />
            <CardBody>
              <form className="stack" onSubmit={changePassword} noValidate>
                <FormField label="Current password" htmlFor="pw-current" required error={passwordErrors.currentPassword}><PasswordInput id="pw-current" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} invalid={!!passwordErrors.currentPassword} /></FormField>
                <FormField label="New password" htmlFor="pw-new" required error={passwordErrors.newPassword} help={PASSWORD_HINT}><PasswordInput id="pw-new" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} invalid={!!passwordErrors.newPassword} /></FormField>
                <FormField label="Confirm new password" htmlFor="pw-confirm" required error={passwordErrors.confirmPassword}><PasswordInput id="pw-confirm" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} invalid={!!passwordErrors.confirmPassword} /></FormField>
                {passwordFailure && <Callout variant="danger">{passwordFailure}</Callout>}
                <div className="form-actions"><Button type="submit" variant="secondary" loading={passwordBusy} icon={<Icons.Lock size={16} />}>Change password</Button></div>
              </form>
            </CardBody>
          </Card>
        </div>
        <div className="stack stack--lg">
          <Card>
            <CardHeader title="Contact information" />
            <CardBody>
              <DescriptionList stack items={[
                { key: "Email", value: <span className="row" style={{ gap: 8 }}>{user.email} {user.emailVerified ? <Badge tone="success">Verified</Badge> : <Badge tone="neutral">Not verified</Badge>}</span> },
                { key: "Phone", value: <span className="row" style={{ gap: 8 }}>{user.phoneNumber || <span className="text-muted">Not provided</span>} {user.phoneNumber ? (user.phoneVerified ? <Badge tone="success">Verified</Badge> : <Badge tone="neutral">Not verified</Badge>) : null}</span> },
              ]} />
              <p className="text-xs text-muted" style={{ marginTop: 12 }}>Email and phone verification will be available in a future release.</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Account status" />
            <CardBody>
              <DescriptionList stack items={[
                { key: "Member since", value: formatDate(user.createdAt) },
                { key: "Roles", value: user.roles.map((r) => r === "USER" ? "Member" : primaryRoleLabel({ ...user, roles: [r] })).join(", ") },
                { key: "Organizer status", value: <span className="row" style={{ gap: 8 }}><StatusBadge kind="organizer" value={user.organizerStatus} />{user.organizerStatus !== "APPROVED" && <Link className="link text-sm" href={organizerHref}>{user.organizerStatus === "NOT_APPLIED" ? "Apply to organize" : "View application"}</Link>}</span> },
              ]} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
