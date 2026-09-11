"use client";
import { useState } from "react";
import { groupService } from "@/services/group.service";
import type { Group } from "@/types/group";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Icons } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/errors";
import { formatDate } from "@/lib/format";

export function GroupCreatorCard({ group }: { group: Group }) {
  const toast = useToast();
  const [contact, setContact] = useState<{ name: string; phone: string | null; email: string }>();
  const [busy, setBusy] = useState(false);
  const canContact = group.creatorType === "ORGANIZER" && ["APPROVED", "ACTIVE"].includes(group.myMembership?.status ?? "");

  async function loadContact() {
    setBusy(true);
    try { setContact(await groupService.contact(group.id)); }
    catch (failure) { toast.error("Couldn't load contact details", friendlyError(failure)); }
    finally { setBusy(false); }
  }

  if (group.creatorType === "PLATFORM") {
    return (
      <Card>
        <CardHeader title="Created by" />
        <CardBody className="row" style={{ gap: 12 }}>
          <Avatar name="Dhanvi" tone="navy" size="lg" />
          <div>
            <div className="text-strong">Dhanvi platform</div>
            <div className="text-sm text-muted">Platform-managed savings group</div>
            <Badge tone="emerald" className="row" plain>Platform group</Badge>
          </div>
        </CardBody>
      </Card>
    );
  }
  const organizer = group.organizer;
  return (
    <Card>
      <CardHeader title="Organizer" />
      <CardBody className="stack">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <Avatar name={organizer?.name} size="lg" />
          <div style={{ minWidth: 0 }}>
            <div className="text-strong">{organizer?.name ?? "Organizer"}</div>
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              {organizer?.verified && <Badge tone="success"><Icons.BadgeCheck size={12} /> Verified organizer</Badge>}
              {organizer && <StatusBadge kind="organizer" value={organizer.status} />}
            </div>
            {organizer && <div className="text-sm text-muted" style={{ marginTop: 6 }}>Member since {formatDate(organizer.memberSince)}</div>}
          </div>
        </div>
        {canContact && !contact && <Button variant="secondary" size="sm" loading={busy} onClick={loadContact} icon={<Icons.Mail size={16} />}>Show contact details</Button>}
        {contact && (
          <div className="stack stack--sm text-sm">
            <span className="row" style={{ gap: 8 }}><Icons.Mail size={16} style={{ color: "var(--color-text-muted)" }} /><a className="link" href={`mailto:${contact.email}`}>{contact.email}</a></span>
            <span className="row" style={{ gap: 8 }}><Icons.Phone size={16} style={{ color: "var(--color-text-muted)" }} />{contact.phone ? <a className="link" href={`tel:${contact.phone}`}>{contact.phone}</a> : <span className="text-muted">Phone not provided</span>}</span>
          </div>
        )}
        {!canContact && <p className="text-xs text-muted">Contact details are shared with approved members only.</p>}
      </CardBody>
    </Card>
  );
}
