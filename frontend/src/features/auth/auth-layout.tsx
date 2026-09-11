import type { ReactNode } from "react";
import { Icons } from "@/components/ui/icons";

const points = [
  "Published, versioned group rules you accept before a group starts",
  "Verified organizers reviewed by Dhanvi",
  "Verifiable random draws and transparent auctions",
  "A permanent record of contributions and results",
];

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth__panel" aria-hidden>
        <div className="hero__eyebrow" style={{ background: "rgba(74,222,128,0.12)", borderColor: "rgba(74,222,128,0.25)", color: "#4ade80", width: "fit-content" }}><Icons.ShieldCheck size={16} /> Community savings platform</div>
        <h2>Your Circle.<br />Your Savings.<br />Your Turn.</h2>
        <p>Dhanvi helps savings circles run with clear rules, tracked contributions and auditable selection.</p>
        <div className="auth__points">
          {points.map((point) => <div key={point} className="auth__point"><Icons.CheckCircle size={18} /><span>{point}</span></div>)}
        </div>
      </aside>
      <div className="auth__form-col">
        <div className="auth__card">
          <div>
            <h1 className="auth__title">{title}</h1>
            {subtitle && <p className="auth__subtitle">{subtitle}</p>}
          </div>
          {children}
          {footer && <div className="auth__links">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
