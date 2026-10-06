import { Link } from "wouter";
import {
  LEGAL_EFFECTIVE_DATE,
  LEGAL_POLICY_VERSION,
  MESSAGING_DISCLOSURE,
  PRIVACY_POLICY_PATH,
  TERMS_PATH,
  type LegalSection,
} from "@/lib/legal-docs";
import { VNDRLY_LOGO_SQUARE as vndrlyLogo } from "@/lib/vndrly-brand-assets";

interface LegalDocumentPageProps {
  children?: React.ReactNode;
  title: string;
  description: string;
  sections: LegalSection[];
  kind: "privacy" | "terms" | "messaging";
}

export function LegalDocumentPage({
  title,
  description,
  sections,
  kind,
  children,
}: LegalDocumentPageProps): React.ReactElement {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
        <header className="mb-8 border-b border-slate-200 pb-6">
          <div className="mb-5 flex items-center gap-3">
            <img
              src={vndrlyLogo}
              alt="VNDRLY"
              className="h-11 w-11 rounded-lg"
              draggable={false}
            />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                VNDRLY Legal
              </p>
              <p className="text-sm text-slate-500">Version {LEGAL_POLICY_VERSION}</p>
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">{title}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
          <p className="mt-4 text-sm text-slate-500">Effective date: {LEGAL_EFFECTIVE_DATE}</p>
          {kind !== "messaging" && (
            <nav className="mt-5 flex flex-wrap gap-3 text-sm">
              {kind !== "privacy" && (
                <Link href={PRIVACY_POLICY_PATH} className="font-medium text-amber-700 underline">
                  Privacy Policy
                </Link>
              )}
              {kind !== "terms" && (
                <Link href={TERMS_PATH} className="font-medium text-amber-700 underline">
                  Terms & Conditions
                </Link>
              )}
            </nav>
          )}
        </header>

        {kind === "messaging" && (
          <section
            className="mb-8 rounded-lg border border-amber-300 bg-amber-50 p-5 text-sm text-slate-800"
            data-testid="messaging-disclosure-card"
          >
            <h2 className="text-base font-semibold text-slate-950">{MESSAGING_DISCLOSURE.programName}</h2>
            <p className="mt-2 leading-6">{MESSAGING_DISCLOSURE.summary}</p>
            <p className="mt-3 leading-6">{MESSAGING_DISCLOSURE.consent}</p>
            <p className="mt-3 leading-6">
              {MESSAGING_DISCLOSURE.rates} {MESSAGING_DISCLOSURE.stop} {MESSAGING_DISCLOSURE.help}{" "}
              {MESSAGING_DISCLOSURE.carriers}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href={PRIVACY_POLICY_PATH} className="font-medium text-amber-800 underline">
                Privacy Policy
              </Link>
              <Link href={TERMS_PATH} className="font-medium text-amber-800 underline">
                Terms & Conditions
              </Link>
            </div>
          </section>
        )}

        {children}
        <div className="space-y-7">
          {sections.map((section) => (
            <section key={section.title} className="border-b border-slate-200 pb-6 last:border-b-0">
              <h2 className="text-lg font-semibold text-slate-950">{section.title}</h2>
              <div className="mt-3 space-y-3 text-sm leading-6 text-slate-700">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
