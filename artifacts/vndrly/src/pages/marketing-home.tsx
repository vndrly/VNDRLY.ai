import {
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ClipboardCheck,
  CreditCard,
  Files,
  FileText,
  ListChecks,
  MapPinned,
  Megaphone,
  MessageSquare,
  Network,
  Radar,
  ShieldCheck,
  Star,
  Users,
  Video,
} from "lucide-react";
import halftone from "@assets/nav-pane-us-halftone.svg";
import PngPill, { PngPillLink } from "@/components/png-pill-rollover";
import PublicAskV from "@/components/public-askv";
import { PILL_COLORS } from "@/lib/pill-colors";
import {
  FEATURED_SOLUTIONS,
  JOB_WORKFLOW,
  MARKETING_MODULES,
  PARTNER_BENEFITS,
  VENDOR_BENEFITS,
  marketingCtaHref,
  marketingDemoHref,
} from "@/lib/marketing-content";
import { VNDRLY_LOGO_SQUARE } from "@/lib/vndrly-brand-assets";

const solutionIcons = [Radar, ShieldCheck];
const moduleIcons = [MapPinned, ClipboardCheck, Users, BriefcaseBusiness];
const workHubFeatures = [
  [MessageSquare, "Channels & conversations", "Organize team discussions by project, site, vendor, or priority so context stays attached."],
  [CalendarDays, "Calendars & scheduling", "Keep meetings, deadlines, shifts, and shared events visible to the people who need them."],
  [ListChecks, "Tasks & handoffs", "Assign owners, track progress, and move work between field and office teams without losing the next step."],
  [Files, "Forms & files", "Keep operational forms, documents, photos, and reference files where the work is happening."],
  [Megaphone, "Notes & announcements", "Share durable updates, decisions, and company-wide messages without relying on scattered texts."],
  [Video, "Meetings & role-aware collaboration", "Bring the right partners, vendors, and employees together while keeping access aligned with their roles."],
] as const;

function PrimaryLink({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <PngPillLink
      href={href}
      color="amber"
      height={30}
      data-testid="marketing-primary-cta"
      className="min-w-36 text-[13px] font-bold"
      labelClassName="text-[13px] font-black"
    >
      {children}
    </PngPillLink>
  );
}

function SectionLabel({ children, featured = false }: { children: React.ReactNode; featured?: boolean }) {
  return (
    <p
      className="text-xs font-black uppercase tracking-[.24em] text-[var(--vndrly-amber)]"
      style={featured ? {
        display: "inline-block",
        backgroundColor: "#2b3035",
        borderWidth: 2,
        borderStyle: "solid",
        borderColor: "var(--vndrly-amber)",
        borderRadius: 8,
        padding: "6px 12px",
        fontSize: 14,
        lineHeight: "18px",
        color: "white",
      } : undefined}
    >
      {children}
    </p>
  );
}

function SectionDivider() {
  return <div data-testid="marketing-section-divider" aria-hidden="true" className="border-t-2 border-[var(--vndrly-amber)]" />;
}

function BenefitList({ items, dark = false, textClassName }: { items: string[]; dark?: boolean; textClassName?: string }) {
  return (
    <ul className="mt-6 space-y-4">
      {items.map((item) => (
        <li key={item} className={`flex gap-3 text-sm leading-6 ${textClassName ?? (dark ? "text-slate-300" : "text-slate-600")}`}>
          <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--vndrly-amber)]/15 text-[var(--vndrly-amber)]">
            <Check className="h-3.5 w-3.5 text-[var(--vndrly-amber)]" strokeWidth={3} />
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function MarketingHome() {
  return (
    <main className="min-h-screen bg-[#f3f5f6] text-slate-950" data-testid="marketing-home" style={{ "--vndrly-amber": PILL_COLORS.amber } as React.CSSProperties}>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#15191d]/95 text-white shadow-lg backdrop-blur">
        <nav aria-label="Public navigation" className="mx-auto flex max-w-7xl items-center gap-5 px-4 py-3">
          <a href="/" className="flex shrink-0 items-center gap-2 font-black tracking-wide text-white">
            <img src={VNDRLY_LOGO_SQUARE} alt="" className="h-10 w-10 rounded-sm" />
            VNDRLY
          </a>
          <div className="ml-auto hidden items-center gap-6 lg:flex">
            <a href="#solutions" className="text-sm font-semibold text-white hover:text-[var(--vndrly-amber)]">Solutions</a>
            <a href="#workflow" className="text-sm font-semibold text-white hover:text-[var(--vndrly-amber)]">How it works</a>
            <a href="#partners" className="text-sm font-semibold text-white hover:text-[var(--vndrly-amber)]">For partners</a>
            <a href="#vendors" className="text-sm font-semibold text-white hover:text-[var(--vndrly-amber)]">For vendors</a>
          </div>
          <PngPillLink href="/login" color="amber" height={30} className="ml-auto min-w-36 lg:ml-2" labelClassName="text-[15px] font-black">Sign In</PngPillLink>
        </nav>
      </header>

      <section data-testid="marketing-hero" className="relative isolate overflow-hidden bg-[#20262b] text-white">
        <div className="absolute inset-0 bg-gradient-to-r from-[#12171b] via-[#182027]/90 to-[#182027]/45" />
        <img data-testid="hero-halftone" src={halftone} alt="" className="absolute left-1/2 top-1/2 w-[86rem] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-[.17]" />
        <div className="relative mx-auto grid min-h-[660px] max-w-7xl items-center gap-12 px-4 py-20 lg:grid-cols-[1.12fr_.88fr] lg:py-28">
          <div>
            <p className="text-sm font-black uppercase tracking-[.24em] text-[var(--vndrly-amber)]">Verified vendors. Connected operations.</p>
            <h1 className="mt-5 max-w-4xl text-[27px] font-black leading-[1.05] sm:text-[45px] lg:text-[54px]">
              The trusted vendor network built for field operations.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-200 sm:text-xl">
              VNDRLY helps partners find proven service companies and gives vendors the tools to run the work—so reputation, people, sites, tickets, gates, and approvals stay connected.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <PrimaryLink href={marketingCtaHref}>Get started <ArrowRight className="h-4 w-4" /></PrimaryLink>
              <a href={marketingDemoHref} data-testid="marketing-demo-cta" style={{ height: 30, minHeight: 30, maxHeight: 30, boxSizing: "border-box", fontSize: 13, fontWeight: 700 }} className="inline-flex items-center rounded-full border border-white/60 bg-black/20 px-6 text-[13px] font-bold text-white transition hover:border-[var(--vndrly-amber)] hover:bg-black/35 hover:text-[var(--vndrly-amber)] focus-visible:ring-2 focus-visible:ring-[var(--vndrly-amber)]">Request a demo</a>
            </div>
          </div>
          <aside data-testid="marketing-card" className="rounded-3xl border-2 border-[#9ca3af] bg-[#2b3035] p-6 shadow-2xl backdrop-blur-md sm:p-8" aria-label="Verified network highlights">
            <div className="flex items-center gap-3"><Network className="h-8 w-8 text-[var(--vndrly-amber)]" /><div><p className="text-xs font-black uppercase tracking-[.18em] text-[var(--vndrly-amber)]">A living vendor directory</p><p className="font-bold text-white">Maintained by the people doing the work</p></div></div>
            <div className="mt-7 grid gap-4 sm:grid-cols-2">
              {[
                [BadgeCheck, "Verified fit", "Services, geography, eligibility, and current operational context."],
                [Star, "Earned reputation", "Ratings and activity signals grounded in completed work."],
                [Radar, "Faster discovery", "Find qualified providers fast through our network of vendors."],
                [ShieldCheck, "Security aware", "All transactions are audited for security 24/7"],
              ].map(([Icon, title, copy]) => {
                const CardIcon = Icon as typeof BadgeCheck;
                return <div key={title as string} data-testid="marketing-card" className="rounded-2xl border-2 border-[var(--vndrly-amber)] bg-white/10 p-4"><div className="flex items-center gap-2"><CardIcon className="h-5 w-5 text-[var(--vndrly-amber)]"/><h2 className="font-black text-white">{title as string}</h2></div><p className="mt-2 text-sm leading-6 text-white">{copy as string}</p></div>;
              })}
            </div>
          </aside>
        </div>
        <div data-testid="hero-fade" className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-b from-transparent to-[#3a3d42]" />
      </section>

      <SectionDivider />
      <section id="solutions" className="mx-auto max-w-7xl px-4 py-20">
        <div className="max-w-3xl">
          <SectionLabel featured>Featured solutions</SectionLabel>
          <h2 className="mt-3 text-[23px] font-black sm:text-[36px]">Put the network to work.</h2>
          <p className="mt-4 text-lg leading-8 text-slate-600">Discover the right company when work appears, then keep every field and office handoff tied to the same trusted operational record.</p>
        </div>
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {FEATURED_SOLUTIONS.map((solution, index) => {
            const Icon = solutionIcons[index];
            return <article key={solution.title} data-testid="marketing-card" className="relative overflow-hidden rounded-3xl border-2 border-[var(--vndrly-amber)] bg-[#2b3035] p-7 text-white shadow-[0_18px_50px_rgba(15,23,42,.16)] sm:p-9"><div className="flex items-center gap-3"><Icon className="h-9 w-9 text-[var(--vndrly-amber)]"/><h3 className="text-2xl font-black text-white">{solution.title}</h3></div><p className="mt-5 text-xs font-black uppercase tracking-[.18em] text-[var(--vndrly-amber)]">{solution.eyebrow}</p><p className="mt-3 leading-7 text-white">{solution.description}</p><BenefitList items={solution.points} dark textClassName="text-white"/></article>;
          })}
        </div>
      </section>

      <SectionDivider />
      <section id="workflow" className="bg-[#1f252a] text-white">
        <div className="mx-auto max-w-7xl px-4 py-20">
          <p className="text-xs font-black uppercase tracking-[.24em] text-[var(--vndrly-amber)]">One connected job lifecycle</p>
          <h2 className="mt-3 max-w-4xl text-[23px] font-black sm:text-[36px]">From “we need this done” to an approval-ready record, ready to be paid</h2>
          <div className="mt-10 overflow-x-auto">
            <ol aria-label="Job lifecycle progress" className="grid min-w-[760px] grid-cols-7">
              {JOB_WORKFLOW.map(([title], index) => <li key={title} className="relative flex flex-col items-center px-2 text-center">
                {index < JOB_WORKFLOW.length - 1 && <span aria-hidden="true" className="absolute left-1/2 top-5 h-0.5 w-full bg-[var(--vndrly-amber)]/60"/>}
                <span className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 border-[var(--vndrly-amber)] bg-[#1f252a]">
                  <span data-step-dot aria-hidden="true" className="h-3 w-3 rounded-full bg-white"/>
                </span>
                <span className="mt-3 text-sm font-black text-white">{title}</span>
              </li>)}
            </ol>
          </div>
          <ol aria-label="VNDRLY job workflow" className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
            {JOB_WORKFLOW.map(([title, copy]) => <li key={title} data-testid="marketing-card" className="rounded-2xl border-2 border-[var(--vndrly-amber)] bg-white/[.06] p-4"><p className="text-xs leading-5 text-white">{copy}</p></li>)}
          </ol>
        </div>
      </section>

      <SectionDivider />
      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-20 lg:grid-cols-2">
        <article id="partners" data-testid="marketing-card" className="rounded-3xl border-2 border-[var(--vndrly-amber)] bg-[#2b3035] p-7 text-white shadow-xl sm:p-9">
          <div className="flex items-center gap-3"><Building2 className="h-9 w-9 text-[var(--vndrly-amber)]"/><p className="text-base font-black uppercase tracking-[.18em] text-[var(--vndrly-amber)]">For operating partners</p></div>
          <h2 className="mt-5 text-2xl font-black leading-tight text-white">For partners: know who can do the work—and what is happening now.</h2>
          <BenefitList items={PARTNER_BENEFITS} dark textClassName="text-white"/>
        </article>
        <article id="vendors" data-testid="marketing-card" className="rounded-3xl border-2 border-[var(--vndrly-amber)] bg-[#2b3035] p-7 text-white shadow-xl sm:p-9">
          <div className="flex items-center gap-3"><BriefcaseBusiness className="h-9 w-9 text-[var(--vndrly-amber)]"/><p className="text-base font-black uppercase tracking-[.18em] text-[var(--vndrly-amber)]">For vendors</p></div>
          <h2 className="mt-5 text-2xl font-black leading-tight text-white">For vendors: make proven performance easier to find and easier to repeat.</h2>
          <BenefitList items={VENDOR_BENEFITS} dark textClassName="text-white"/>
        </article>
      </section>

      <SectionDivider />
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-20">
          <SectionLabel featured>Connected operations</SectionLabel>
          <h2 className="mt-3 text-3xl font-black sm:text-5xl">The field facts and the office workflow tell the same story.</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {MARKETING_MODULES.map((module, index) => {
              const Icon = moduleIcons[index];
              return <article key={module.title} data-testid="marketing-card" className="rounded-3xl border-2 border-[var(--vndrly-amber)] bg-[#2b3035] p-6 text-white shadow-[0_18px_50px_rgba(15,23,42,.16)]"><div className="flex items-center gap-3"><Icon className="h-7 w-7 text-[var(--vndrly-amber)]"/><h3 className="text-xl font-black text-white">{module.title}</h3></div><p className="mt-4 text-sm leading-6 text-white">{module.description}</p></article>;
            })}
          </div>
        </div>
      </section>

      <SectionDivider />
      <section aria-label="Secure direct payments and payroll reporting" className="relative overflow-hidden bg-gradient-to-br from-cyan-950 via-slate-900 to-slate-950 text-white">
        <div className="mx-auto grid max-w-7xl items-start gap-8 px-4 py-16 md:grid-cols-[1fr_auto]">
          <div>
            <p className="text-xs font-black uppercase tracking-[.2em] text-[var(--vndrly-amber)]">Coming soon</p>
            <div className="mt-5 space-y-8">
              <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--vndrly-amber)] bg-[var(--vndrly-amber)]/10"><CreditCard className="h-8 w-8 text-[var(--vndrly-amber)]"/></div>
                <div><h2 className="text-3xl font-black">Secure direct payments</h2><p className="mt-3 max-w-3xl leading-7 text-slate-300">Move from approved work toward vendor payment without breaking the connected workflow. Payment availability, timing, and terms will be announced after the end-to-end service is verified.</p></div>
              </div>
              <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--vndrly-amber)] bg-[var(--vndrly-amber)]/10"><ClipboardCheck className="h-8 w-8 text-[var(--vndrly-amber)]"/></div>
                <div><h2 className="text-3xl font-black">Make Payroll &amp; IRS Reporting</h2><p className="mt-3 max-w-3xl leading-7 text-slate-300">Manage mileage and hours for your employees, compatible with QuickBooks, OpenAccountant with CSV exports available if you choose.</p></div>
              </div>
              <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--vndrly-amber)] bg-[var(--vndrly-amber)]/10"><FileText className="h-8 w-8 text-[var(--vndrly-amber)]"/></div>
                <div><h2 className="text-3xl font-black">Invoicing has never been easier</h2><p className="mt-3 max-w-3xl leading-7 text-slate-300">Automatic invoicing prepares your work product into a electronic invoice that stays in the same workflow native to VNDRLY with a full audit trail. Partners can verify the work product before paying Vendors</p></div>
              </div>
            </div>
          </div>
          <PngPill color="amber" height={30} className="min-w-32" data-testid="marketing-coming-soon-pill">Coming soon</PngPill>
        </div>
      </section>

      <SectionDivider />
      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-20 lg:grid-cols-[1fr_.9fr]">
        <div>
          <SectionLabel>Trust without exposure</SectionLabel>
          <h2 className="mt-3 text-3xl font-black sm:text-5xl">Useful signals. Private relationships.</h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">VNDRLY can help rank vendor fit using service alignment, operating geography, verified activity, responsiveness, and ratings. The public experience does not reveal who hired whom, private job details, or organization records.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">{[[BadgeCheck,"Verified operational signals"],[ShieldCheck,"Role and organization permissions"],[Star,"Reputation built through work"],[Network,"No public account directory"]].map(([Icon,label]) => { const TrustIcon = Icon as typeof BadgeCheck; return <div key={label as string} data-testid="marketing-card" className="flex items-center gap-3 rounded-2xl border-2 border-[var(--vndrly-amber)] bg-[#2b3035] p-4 font-bold text-white shadow-[0_18px_50px_rgba(15,23,42,.16)]"><TrustIcon className="h-5 w-5 text-[var(--vndrly-amber)]"/>{label as string}</div>; })}</div>
        </div>
        <aside data-testid="marketing-card" className="rounded-3xl border-2 border-[var(--vndrly-amber)] bg-[#2b3035] p-8 text-white shadow-xl">
          <SectionLabel>Ask V — Product Guide</SectionLabel>
          <h2 className="mt-3 text-3xl font-black text-white">Questions before you sign in?</h2>
          <p className="mt-4 leading-7 text-white">Ask about product fit, roles, signup, onboarding, demos, or sales. The public Product Guide uses approved public information only and cannot access accounts, operational records, or internal actions.</p>
          <p className="mt-6 text-sm font-bold text-[var(--vndrly-amber)]">Open Ask V in the lower-right corner.</p>
        </aside>
      </section>

      <SectionDivider />
      <section aria-label="Work Hub" className="relative overflow-hidden bg-[#20262b] text-white">
        <img src={halftone} alt="" className="absolute left-1/2 top-1/2 w-[76rem] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-[.07]"/>
        <div className="relative mx-auto max-w-7xl px-4 py-20">
          <div className="max-w-4xl">
            <SectionLabel>Connected teamwork</SectionLabel>
            <h2 className="mt-3 text-4xl font-black sm:text-5xl">Work Hub</h2>
            <h3 className="mt-4 text-2xl font-black sm:text-3xl">Keep every conversation tied to the work.</h3>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-white">Bring channels, calendars, tasks, forms, files, notes, announcements, meetings, and handoffs into one shared operational context. Work Hub helps field and office teams stay aligned without losing decisions across scattered tools.</p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {workHubFeatures.map(([Icon, title, description]) => (
              <article key={title} data-testid="marketing-card" className="rounded-3xl border-2 border-[var(--vndrly-amber)] bg-[#2b3035] p-6 text-white shadow-[0_18px_50px_rgba(15,23,42,.2)]">
                <div className="flex items-center gap-3">
                  <Icon className="h-7 w-7 shrink-0 text-[var(--vndrly-amber)]"/>
                  <h3 className="text-xl font-black text-white">{title}</h3>
                </div>
                <p className="mt-4 leading-7 text-white">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <SectionDivider />
      <section className="bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 lg:grid-cols-2">
          <div><SectionLabel featured>Getting started</SectionLabel><h2 className="mt-3 text-3xl font-black">Bring your organization into one connected operating picture.</h2><ol className="mt-7 space-y-5">{[["Choose your path","Register as a partner or vendor organization."],["Build your operating profile","Add people, services, locations, credentials, and permissions."],["Connect the work","Use the VNDRLY modules available to your role and organization."]].map(([title,copy],index)=><li key={title} className="flex gap-4"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--vndrly-amber)] text-sm font-black text-slate-950">{index+1}</span><div><h3 className="font-black">{title}</h3><p className="mt-1 text-sm text-slate-600">{copy}</p></div></li>)}</ol></div>
          <div><SectionLabel featured>Frequently asked questions</SectionLabel><div className="mt-3 divide-y">{[["What do I need to sign up?","Start with your organization, role, and contact details. Additional operating information can be completed during onboarding."],["How long does signup take?","The initial registration is brief. The time to complete onboarding depends on your organization, services, people, and review needs."],["Does the public Product Guide see my account?","No. It uses approved public product information only. Authenticated Ask V operates separately after sign-in."],["How do I talk to sales?","Request a demo or contact VNDRLY support. You control what information is sent."]].map(([q,a])=><details key={q} className="py-5"><summary className="cursor-pointer font-black">{q}</summary><p className="mt-2 text-sm leading-6 text-slate-600">{a}</p></details>)}</div></div>
        </div>
      </section>

      <SectionDivider />
      <section className="relative overflow-hidden bg-[#20262b] text-center text-white">
        <img src={halftone} alt="" className="absolute left-1/2 top-1/2 w-[70rem] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-10"/>
        <div className="relative mx-auto max-w-4xl px-4 py-24"><p className="text-sm font-black uppercase tracking-[.22em] text-[var(--vndrly-amber)]">A better vendor network starts here</p><h2 className="mt-4 text-4xl font-black sm:text-6xl">Find the right fit. Run the work. Keep the proof.</h2><p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-slate-300">Start your VNDRLY profile or let us walk through the workflow with your team.</p><div className="mt-9 flex flex-wrap justify-center gap-4"><PrimaryLink href={marketingCtaHref}>Get started <ArrowRight className="h-4 w-4"/></PrimaryLink><a href={marketingDemoHref} data-testid="marketing-demo-cta" style={{ height: 30, minHeight: 30, maxHeight: 30, boxSizing: "border-box", fontSize: 13, fontWeight: 700 }} className="inline-flex items-center rounded-full border border-white/60 px-6 text-[13px] font-bold text-white hover:border-[var(--vndrly-amber)] hover:text-[var(--vndrly-amber)] focus-visible:ring-2 focus-visible:ring-[var(--vndrly-amber)]">Request a demo</a></div></div>
      </section>

      <footer className="border-t border-white/10 bg-[#15191d] text-slate-300"><div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between"><span>© {new Date().getFullYear()} VNDRLY</span><div className="flex flex-wrap gap-5"><a href="/legal/privacy" className="hover:text-white">Privacy</a><a href="/legal/terms" className="hover:text-white">Terms</a><a href="mailto:support@vndrly.ai" className="hover:text-white">Support</a><a href={marketingDemoHref} className="hover:text-[var(--vndrly-amber)]">Request a demo</a></div></div></footer>
      <PublicAskV />
    </main>
  );
}
