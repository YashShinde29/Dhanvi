import Link from "next/link";
import { Icons } from "@/components/ui/icons";
import { LinkButton } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Badge } from "@/components/ui/badge";

const steps = [
  { title: "Choose a savings group", body: "Compare group value, monthly contribution, duration and who created the group before you decide." },
  { title: "Join with clear rules", body: "Every group publishes a versioned rule set. You review and accept it before the group starts." },
  { title: "Contribute monthly", body: "Each cycle has a fixed contribution date. Your recorded contributions are always visible to you." },
  { title: "Receive your payout turn", body: "Each member receives the main payout once, chosen by a verifiable random draw or an open auction." },
];

const reasons = [
  { icon: <Icons.FileText />, title: "Transparent rules", body: "Rules are published, versioned and hashed. What you accepted is what applies." },
  { icon: <Icons.BadgeCheck />, title: "Verified organizers", body: "Organizers apply, are reviewed by Dhanvi, and can be suspended if they break the rules." },
  { icon: <Icons.Wallet />, title: "Contribution tracking", body: "Expected and recorded contributions are tracked per member for every cycle." },
  { icon: <Icons.ShieldCheck />, title: "Auditable selection", body: "Random draws record a seed commitment, eligible set and result hash you can re-verify." },
  { icon: <Icons.History />, title: "Clear group history", body: "Applications, approvals, cycles and results are kept as a permanent record." },
];

const faqs = [
  { q: "Is Dhanvi an investment product?", a: "No. Dhanvi helps a group of people save together with clear rules. It does not promise returns or profit. Any auction benefit depends entirely on the group's published rules." },
  { q: "How is the payout recipient chosen?", a: "Random groups use a recorded, re-verifiable random draw among eligible members. Auction groups let eligible members offer a discount; the highest valid discount wins that cycle's payout right." },
  { q: "Can I receive the payout more than once?", a: "No. Each member receives the main payout once per group and continues contributing for all remaining cycles." },
  { q: "What does 'organizer receives first payout' mean?", a: "Some organizer-created groups reserve the first cycle payout for the organizer. This is always shown on the group before you apply." },
  { q: "Does Dhanvi move money?", a: "Not at this stage. Contributions are recorded operationally by the organizer or platform. Dhanvi does not process payments or payouts yet, and says so clearly throughout the product." },
];

export function LandingPage() {
  return (
    <div className="landing">
      <section className="landing__section hero">
        <div>
          <span className="hero__eyebrow"><Icons.ShieldCheck size={16} /> Community savings with transparent rules</span>
          <h1 className="hero__title">Save Together.<br />Plan Better.</h1>
          <p className="hero__lead">Dhanvi brings your savings circle online. Join a group with a fixed monthly contribution, follow clear published rules, and receive your payout turn through an auditable process.</p>
          <div className="hero__actions">
            <LinkButton href="/groups" size="lg" icon={<Icons.Search size={18} />}>Browse savings groups</LinkButton>
            <LinkButton href="/register?intent=organizer" size="lg" variant="secondary">Become an organizer</LinkButton>
          </div>
          <div className="hero__trust">
            <span><Icons.Check size={16} /> Versioned group rules</span>
            <span><Icons.Check size={16} /> Verified organizers</span>
            <span><Icons.Check size={16} /> Verifiable random draws</span>
          </div>
        </div>
        <div className="hero__visual" aria-hidden>
          <div className="hero__card">
            <div className="row row--between">
              <div>
                <div className="h-card">Vashi Savings Circle</div>
                <div className="text-sm text-muted">Created by Rahul P. · Verified organizer</div>
              </div>
              <Badge tone="info">Recruiting</Badge>
            </div>
            <div className="group-card__facts">
              <div className="fact"><span className="fact__label">Group value</span><span className="fact__value fact__value--lg">₹5,00,000</span></div>
              <div className="fact"><span className="fact__label">Monthly</span><span className="fact__value fact__value--lg">₹25,000</span></div>
              <div className="fact"><span className="fact__label">Members</span><span className="fact__value">12 / 20</span></div>
              <div className="fact"><span className="fact__label">Duration</span><span className="fact__value">20 months</span></div>
            </div>
            <ProgressBar value={12} max={20} label="Members joined" start="12 of 20 members joined" end="8 positions left" />
          </div>
          <div className="hero__card" style={{ padding: 16, gridTemplateColumns: "auto 1fr", display: "grid", alignItems: "center", gap: 12 }}>
            <span className="stat__icon" style={{ margin: 0 }}><Icons.ShieldCheck size={18} /></span>
            <div>
              <div className="text-strong text-sm">Cycle 5 random draw verified</div>
              <div className="text-xs text-muted">Recalculated from the recorded seed and eligible set · DHANVI_RANDOM_V1</div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing__band" id="how-it-works">
        <div className="landing__section">
          <div className="section-head section-head--center">
            <span className="section-head__eyebrow">How Dhanvi works</span>
            <h2>Four clear steps, no surprises</h2>
            <p>Everything from joining to payout follows rules you can read before you commit.</p>
          </div>
          <div className="feature-grid">
            {steps.map((step, index) => (
              <div key={step.title} className="feature">
                <span className="feature__step">Step {index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing__section" id="group-types">
        <div className="section-head">
          <span className="section-head__eyebrow">Two group types</span>
          <h2>Choose the model that suits your circle</h2>
          <p>Both use the same monthly contribution and one payout per member. They differ only in how the payout turn is decided.</p>
        </div>
        <div className="feature-grid feature-grid--2">
          <div className="feature">
            <span className="feature__icon"><Icons.Shuffle /></span>
            <h3>Random savings group</h3>
            <p>Each cycle, one eligible member is selected by a recorded random draw and receives the full group value as their payout right.</p>
            <ul className="choice__list"><li>Full pool payout</li><li>Random eligible member each cycle</li><li>One payout per member</li><li>Draw can be independently re-verified</li></ul>
          </div>
          <div className="feature feature--auction">
            <span className="feature__icon"><Icons.Gavel /></span>
            <h3>Auction savings group</h3>
            <p>Members who need funds sooner offer a discount on the payout. The highest valid discount wins that cycle; the discount benefit is shared under the group rules.</p>
            <ul className="choice__list"><li>Members offer a discount</li><li>Highest valid discount wins</li><li>Winner receives the reduced payout</li><li>Benefit calculated under group rules</li></ul>
          </div>
        </div>
      </section>

      <section className="landing__band">
        <div className="landing__section">
          <div className="section-head">
            <span className="section-head__eyebrow">Why Dhanvi</span>
            <h2>Built for trust, not hype</h2>
          </div>
          <div className="feature-grid feature-grid--3">
            {reasons.map((reason) => (
              <div key={reason.title} className="feature">
                <span className="feature__icon">{reason.icon}</span>
                <h3>{reason.title}</h3>
                <p>{reason.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing__section" id="organizers">
        <div className="feature-grid feature-grid--2" style={{ alignItems: "center" }}>
          <div className="section-head" style={{ marginBottom: 0 }}>
            <span className="section-head__eyebrow">For organizers</span>
            <h2>Already manage a savings circle?</h2>
            <p>Dhanvi gives organizers the tools to run groups professionally: applications, member approvals, rule versions, monthly cycles, contribution records, draws and auctions — all in one place, with a record members can see.</p>
            <div className="row" style={{ marginTop: 12 }}>
              <LinkButton href="/register?intent=organizer">Apply to organize</LinkButton>
              <Link href="/login" className="btn btn--ghost">Sign in</Link>
            </div>
          </div>
          <div className="stack">
            {["Review and approve member applications", "Publish versioned group rules members must accept", "Track expected vs. recorded contributions per cycle", "Run verifiable random draws or open auctions"].map((line) => (
              <div key={line} className="row" style={{ gap: 12, padding: "12px 16px", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12 }}>
                <span className="stat__icon" style={{ margin: 0, width: 32, height: 32 }}><Icons.Check size={16} /></span>
                <span className="text-strong" style={{ fontWeight: 500 }}>{line}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing__band landing__band--navy">
        <div className="landing__section">
          <div className="section-head">
            <span className="section-head__eyebrow" style={{ color: "#4ade80" }}>Safety & transparency</span>
            <h2>What Dhanvi does — and doesn&apos;t — promise</h2>
          </div>
          <div className="feature-grid feature-grid--3">
            <div><h3 style={{ color: "#fff", marginBottom: 8 }}>No guaranteed profit</h3><p className="text-secondary">Dhanvi is a savings coordination platform. It is not an investment, lending or return product.</p></div>
            <div><h3 style={{ color: "#fff", marginBottom: 8 }}>Rules you can read</h3><p className="text-secondary">Every financial rule — amount, duration, first payout, auction limits — is published before you accept.</p></div>
            <div><h3 style={{ color: "#fff", marginBottom: 8 }}>Records that stay</h3><p className="text-secondary">Contributions, selections and auction results are immutable once recorded, and always visible to members.</p></div>
          </div>
        </div>
      </section>

      <section className="landing__section" id="faq">
        <div className="section-head section-head--center">
          <span className="section-head__eyebrow">FAQ</span>
          <h2>Common questions</h2>
        </div>
        <div className="faq">
          {faqs.map((faq) => (
            <details key={faq.q}>
              <summary>{faq.q}</summary>
              <p>{faq.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="landing__band">
        <div className="landing__section cta-band">
          <div>
            <h2>Your Circle. Your Savings. Your Turn.</h2>
            <p className="text-secondary" style={{ marginTop: 6 }}>Create a free account to browse groups and apply.</p>
          </div>
          <div className="row">
            <LinkButton href="/register" size="lg">Create account</LinkButton>
            <LinkButton href="/groups" size="lg" variant="secondary">Browse groups</LinkButton>
          </div>
        </div>
      </section>
    </div>
  );
}
