import { LegalDocumentPage } from "@/components/legal-document-page";
import { PRIVACY_POLICY_SECTIONS, TERMS_SECTIONS } from "@/lib/legal-docs";
import { OnboardingLegalConsentStep } from "@/components/onboarding-legal-consent-step";

const messagingSections = [
  {
    title: "Public Opt-In Disclosure",
    body: [
      "VNDRLY presents SMS consent during partner and vendor onboarding as a separate, unchecked, voluntary checkbox. Users can create an account and continue onboarding without opting in to SMS.",
      "The onboarding text identifies VNDRLY, describes transactional and operational message categories, explains that message frequency varies, notes that message and data rates may apply, provides HELP and STOP instructions, and links to the Privacy Policy and Terms & Conditions.",
    ],
  },
  {
    title: "Where the Same Terms Appear",
    body: [
      "The Privacy Policy and Terms & Conditions linked from onboarding contain the same messaging disclosures presented to users at opt-in.",
      "The SMS opt-in record is stored with onboarding payload data for future notification routing and audit review. Required legal acknowledgment is stored separately from optional SMS consent.",
    ],
  },
  ...PRIVACY_POLICY_SECTIONS.filter((section) => section.title === "Text Messaging and Mobile Information"),
  ...TERMS_SECTIONS.filter((section) => section.title === "Messaging Terms"),
];

export default function LegalMessagingConsentPage(): React.ReactElement {
  return (
    <LegalDocumentPage
      kind="messaging"
      title="Messaging Consent Disclosure"
      description="A public compliance reference showing how VNDRLY presents Privacy Policy, Terms & Conditions, and voluntary SMS consent during onboarding."
      sections={messagingSections}
    >
      <section className="mb-8 rounded-lg border border-slate-200 bg-white p-5" aria-label="Onboarding consent screen preview">
        <h2 className="mb-3 text-lg font-semibold">Onboarding consent screen preview</h2>
        <p className="mb-4 text-sm text-slate-600">This is the same consent screen used in partner and vendor onboarding. This public preview does not enroll anyone or record consent. Both choices begin unchecked; SMS is optional.</p>
        <OnboardingLegalConsentStep value={{ accepted: false, smsOptIn: false, version: "" }} onChange={() => {}} disabled />
      </section>
    </LegalDocumentPage>
  );
}
