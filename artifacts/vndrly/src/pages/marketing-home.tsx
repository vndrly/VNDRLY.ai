import {
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  Check,
  ClipboardCheck,
  CreditCard,
  MapPinned,
  Network,
  Radar,
  ShieldCheck,
  Star,
  Users,
} from "lucide-react";
import heroBackground from "@assets/VNDRLY_Header_Blur_4_1776220762025.png";
import halftone from "@assets/nav-pane-us-halftone.svg";
import PngPill from "@/components/png-pill-rollover";
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

function PrimaryLink({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <a href={href} className="inline-flex min-h-11 items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vndrly-amber)]">
      <PngPill className="min-w-36" color="amber" size="sm">
        {children}
      </PngPill>
    </a>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-black uppercase tracking-[.24em] text-[var(--vndrly-amber)]">
      {children}
    </p>
  );
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
          <a href="/login" className="ml-auto text-sm font-bold text-white hover:text-[var(--vndrly-amber)] lg:ml-2">Sign in</a>
          <PrimaryLink href={marketingCtaHref}>Get started</PrimaryLink>
        </nav>
      </header>

      <section className="relative isolate overflow-hidden bg-[#20262b] text-white">
        <img src={heroBackground} alt="" className="absolute inset-0 h-full w-full object-cover object-center opacity-70" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#12171b] via-[#182027]/90 to-[#182027]/45" />
        <img src={halftone} alt="" className="absolute -right-[18%] bottom-[-42%] w-[86rem] max-w-none opacity-[.17]" />
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
              <a href={marketingDemoHref} className="inline-flex min-h-11 items-center rounded-full border border-white/60 bg-black/20 px-6 text-sm font-bold text-white transition hover:border-[var(--vndrly-amber)] hover:bg-black/35 hover:text-[var(--vndrly-amber)] focus-visible:ring-2 focus-visible:ring-[var(--vndrly-amber)]">Request a demo</a>
            </div>
          </div>
          <aside className="rounded-3xl border border-white/20 bg-black/35 p-6 shadow-2xl backdrop-blur-md sm:p-8" aria-label="Verified network highlights">
            <div className="flex items-center gap-3"><Network className="h-8 w-8 text-[var(--vndrly-amber)]" /><div><p className="text-xs font-black uppercase tracking-[.18em] text-[var(--vndrly-amber)]">A living vendor directory</p><p className="font-bold text-white">Maintained by the people doing the work</p></div></div>
            <div className="mt-7 grid gap-4 sm:grid-cols-2">
              {[
                [BadgeCheck, "Verified fit", "Services, geography, eligibility, and current operational context."],
                [Star, "Earned reputation", "Ratings and activity signals grounded in completed work."],
                [Radar, "Faster discovery", "Find qualified providers fast through our network of vendors."],
                [ShieldCheck, "Security aware", "All transactions are audited for security 24/7"],
              ].map(([Icon, title, copy]) => {
                const CardIcon = Icon as typeof BadgeCheck;
                return <div key={title as string} className="rounded-2xl border border-white/15 bg-white/10 p-4"><CardIcon className="h-5 w-5 text-[var(--vndrly-amber)]"/><h2 className="mt-3 font-black text-[var(--vndrly-amber)]">{title as string}</h2><p className="mt-1 text-sm leading-6 text-white">{copy as string}</p></div>;
              })}
            </div>
          </aside>
        </div>
        <div data-testid="hero-fade" className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-b from-transparent to-[#3a3d42]" />
      </section>

      <section id="solutions" className="mx-auto max-w-7xl px-4 py-20">
        <div className="max-w-3xl">
          <SectionLabel>Featured solutions</SectionLabel>
          <h2 className="mt-3 text-[23px] font-black sm:text-[36px]">Put the network to work.</h2>
          <p className="mt-4 text-lg leading-8 text-slate-600">Discover the right company when work appears, then keep every field and office handoff tied to the same trusted operational record.</p>
        </div>
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {FEATURED_SOLUTIONS.map((solution, index) => {
            const Icon = solutionIcons[index];
            return <article key={solution.title} className="relative overflow-hidden rounded-3xl border-2 border-[var(--vndrly-amber)] bg-[#2b3035] p-7 text-white shadow-[0_18px_50px_rgba(15,23,42,.16)] sm:p-9"><Icon className="h-9 w-9 text-[var(--vndrly-amber)]"/><p className="mt-5 text-xs font-black uppercase tracking-[.18em] text-[var(--vndrly-amber)]">{solution.eyebrow}</p><h3 className="mt-2 text-3xl font-black text-[var(--vndrly-amber)]">{solution.title}</h3><p className="mt-3 leading-7 text-slate-300">{solution.description}</p><BenefitList items={solution.points} dark/></article>;
          })}
        </div>
      </section>

      <section id="workflow" className="border-y border-slate-300 bg-[#1f252a] text-white">
        <div className="mx-auto max-w-7xl px-4 py-20">
          <p className="text-xs font-black uppercase tracking-[.24em] text-[var(--vndrly-amber)]">One connected job lifecycle</p>
          <h2 className="mt-3 max-w-4xl text-[23px] font-black sm:text-[36px]">From “we need this done” to an approval-ready record.</h2>
          <ol aria-label="VNDRLY job workflow" className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
            {JOB_WORKFLOW.map(([title, copy], index) => <li key={title} className="rounded-2xl border border-[var(--vndrly-amber)] bg-white/[.06] p-4"><span className="text-xs font-black text-[var(--vndrly-amber)]">0{index + 1}</span><h3 className="mt-2 font-black text-[var(--vndrly-amber)]">{title}</h3><p className="mt-2 text-xs leading-5 text-slate-300">{copy}</p></li>)}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-20 lg:grid-cols-2">
        <article id="partners" className="rounded-3xl border-2 border-[var(--vndrly-amber)] bg-[#2b3035] p-7 text-white shadow-xl sm:p-9">
          <div className="flex items-center gap-3"><Building2 className="h-9 w-9 text-[var(--vndrly-amber)]"/><p className="text-base font-black uppercase tracking-[.18em] text-[var(--vndrly-amber)]">For operating partners</p></div>
          <h2 className="mt-5 text-2xl font-black leading-tight text-white">For partners: know who can do the work—and what is happening now.</h2>
          <BenefitList items={PARTNER_BENEFITS} dark textClassName="text-white"/>
        </article>
        <article id="vendors" className="rounded-3xl border-2 border-[var(--vndrly-amber)] bg-[#2b3035] p-7 text-white shadow-xl sm:p-9">
          <div className="flex items-center gap-3"><BriefcaseBusiness className="h-9 w-9 text-[var(--vndrly-amber)]"/><p className="text-base font-black uppercase tracking-[.18em] text-[var(--vndrly-amber)]">For vendors</p></div>
          <h2 className="mt-5 text-2xl font-black leading-tight text-white">For vendors: make proven performance easier to find and easier to repeat.</h2>
          <BenefitList items={VENDOR_BENEFITS} dark textClassName="text-white"/>
        </article>
      </section>

      <section className="border-y bg-white">
        <div className="mx-auto max-w-7xl px-4 py-20">
          <SectionLabel>Connected operations</SectionLabel>
          <h2 className="mt-3 text-3xl font-black sm:text-5xl">The field facts and the office workflow tell the same story.</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {MARKETING_MODULES.map((module, index) => {
              const Icon = moduleIcons[index];
              return <article key={module.title} className="rounded-2xl border border-slate-300 bg-[#f7f8f9] p-6"><Icon className="h-7 w-7 text-[var(--vndrly-amber)]"/><h3 className="mt-4 text-xl font-black text-[var(--vndrly-amber)]">{module.title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{module.description}</p></article>;
            })}
          </div>
        </div>
      </section>

      <section aria-label="Secure direct payments" className="relative overflow-hidden bg-gradient-to-br from-cyan-950 via-slate-900 to-slate-950 text-white">
        <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-16 md:grid-cols-[auto_1fr_auto]">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--vndrly-amber)] bg-[var(--vndrly-amber)]/10"><CreditCard className="h-8 w-8 text-[var(--vndrly-amber)]"/></div>
          <div><p className="text-xs font-black uppercase tracking-[.2em] text-[var(--vndrly-amber)]">Coming soon</p><h2 className="mt-2 text-3xl font-black">Secure direct payments</h2><p className="mt-3 max-w-3xl leading-7 text-slate-300">Move from approved work toward vendor payment without breaking the connected workflow. Payment availability, timing, and terms will be announced after the end-to-end service is verified.</p></div>
          <PngPill color="amber" className="min-w-32">Coming soon</PngPill>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-20 lg:grid-cols-[1fr_.9fr]">
        <div>
          <SectionLabel>Trust without exposure</SectionLabel>
          <h2 className="mt-3 text-3xl font-black sm:text-5xl">Useful signals. Private relationships.</h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">VNDRLY can help rank vendor fit using service alignment, operating geography, verified activity, responsiveness, and ratings. The public experience does not reveal who hired whom, private job details, or organization records.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">{[[BadgeCheck,"Verified operational signals"],[ShieldCheck,"Role and organization permissions"],[Star,"Reputation built through work"],[Network,"No public account directory"]].map(([Icon,label]) => { const TrustIcon = Icon as typeof BadgeCheck; return <div key={label as string} className="flex items-center gap-3 rounded-xl border bg-white p-4 font-bold text-[var(--vndrly-amber)]"><TrustIcon className="h-5 w-5 text-[var(--vndrly-amber)]"/>{label as string}</div>; })}</div>
        </div>
        <aside className="rounded-3xl border-2 border-[var(--vndrly-amber)] bg-white p-8 shadow-xl">
          <SectionLabel>Ask V — Product Guide</SectionLabel>
          <h2 className="mt-3 text-3xl font-black text-[var(--vndrly-amber)]">Questions before you sign in?</h2>
          <p className="mt-4 leading-7 text-slate-600">Ask about product fit, roles, signup, onboarding, demos, or sales. The public Product Guide uses approved public information only and cannot access accounts, operational records, or internal actions.</p>
          <p className="mt-6 text-sm font-bold text-[var(--vndrly-amber)]">Open Ask V in the lower-right corner.</p>
        </aside>
      </section>

      <section className="border-y bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 lg:grid-cols-2">
          <div><SectionLabel>Getting started</SectionLabel><h2 className="mt-3 text-3xl font-black">Bring your organization into one connected operating picture.</h2><ol className="mt-7 space-y-5">{[["Choose your path","Register as a partner or vendor organization."],["Build your operating profile","Add people, services, locations, credentials, and permissions."],["Connect the work","Use the VNDRLY modules available to your role and organization."]].map(([title,copy],index)=><li key={title} className="flex gap-4"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--vndrly-amber)] text-sm font-black text-slate-950">{index+1}</span><div><h3 className="font-black">{title}</h3><p className="mt-1 text-sm text-slate-600">{copy}</p></div></li>)}</ol></div>
          <div><SectionLabel>Frequently asked questions</SectionLabel><div className="mt-3 divide-y">{[["What do I need to sign up?","Start with your organization, role, and contact details. Additional operating information can be completed during onboarding."],["How long does signup take?","The initial registration is brief. The time to complete onboarding depends on your organization, services, people, and review needs."],["Does the public Product Guide see my account?","No. It uses approved public product information only. Authenticated Ask V operates separately after sign-in."],["How do I talk to sales?","Request a demo or contact VNDRLY support. You control what information is sent."]].map(([q,a])=><details key={q} className="py-5"><summary className="cursor-pointer font-black">{q}</summary><p className="mt-2 text-sm leading-6 text-slate-600">{a}</p></details>)}</div></div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-[#20262b] text-center text-white">
        <img src={halftone} alt="" className="absolute left-1/2 top-1/2 w-[70rem] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-10"/>
        <div className="relative mx-auto max-w-4xl px-4 py-24"><p className="text-sm font-black uppercase tracking-[.22em] text-[var(--vndrly-amber)]">A better vendor network starts here</p><h2 className="mt-4 text-4xl font-black sm:text-6xl">Find the right fit. Run the work. Keep the proof.</h2><p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-slate-300">Start your VNDRLY profile or let us walk through the workflow with your team.</p><div className="mt-9 flex flex-wrap justify-center gap-4"><PrimaryLink href={marketingCtaHref}>Get started <ArrowRight className="h-4 w-4"/></PrimaryLink><a href={marketingDemoHref} className="inline-flex min-h-11 items-center rounded-full border border-white/60 px-6 font-bold text-white hover:border-[var(--vndrly-amber)] hover:text-[var(--vndrly-amber)] focus-visible:ring-2 focus-visible:ring-[var(--vndrly-amber)]">Request a demo</a></div></div>
      </section>

      <footer className="border-t border-white/10 bg-[#15191d] text-slate-300"><div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between"><span>© {new Date().getFullYear()} VNDRLY</span><div className="flex flex-wrap gap-5"><a href="/legal/privacy" className="hover:text-white">Privacy</a><a href="/legal/terms" className="hover:text-white">Terms</a><a href="mailto:support@vndrly.ai" className="hover:text-white">Support</a><a href={marketingDemoHref} className="hover:text-[var(--vndrly-amber)]">Request a demo</a></div></div></footer>
      <PublicAskV />
    </main>
  );
}
