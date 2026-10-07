export const LEGAL_EFFECTIVE_DATE = "August 24, 2026";
import { LEGAL_POLICY_VERSION } from "@workspace/api-zod/legal-policy";
export { LEGAL_POLICY_VERSION };
export const LEGAL_CONTACT_EMAIL = "legal@vndrly.ai";
export const LEGAL_SUPPORT_EMAIL = "support@vndrly.ai";
export const LEGAL_SITE_ORIGIN = "https://vndrly.ai";
export const PRIVACY_POLICY_PATH = "/legal/privacy";
export const TERMS_PATH = "/legal/terms";
export const MESSAGING_DISCLOSURE_PATH = "/legal/messaging";
export const PRIVACY_POLICY_URL = `${LEGAL_SITE_ORIGIN}${PRIVACY_POLICY_PATH}`;
export const TERMS_URL = `${LEGAL_SITE_ORIGIN}${TERMS_PATH}`;
export const MESSAGING_DISCLOSURE_URL = `${LEGAL_SITE_ORIGIN}${MESSAGING_DISCLOSURE_PATH}`;

export interface LegalSection {
  title: string;
  body: string[];
}

export const MESSAGING_DISCLOSURE = {
  programName: "VNDRLY Field Operations Alerts",
  summary:
    "VNDRLY sends transactional and operational messages related to account setup, authentication, tickets, site activity, routing, compliance, invoices, payments, support, and safety-adjacent workflow reminders.",
  consent:
    "By opting in, you agree to receive recurring automated text messages from VNDRLY at the mobile number you provide. Consent is not required to create an account or use VNDRLY.",
  rates: "Message frequency varies. Message and data rates may apply.",
  help: `Reply HELP for help or contact ${LEGAL_SUPPORT_EMAIL}.`,
  stop: "Reply STOP to cancel text messages. After you opt out, we may send one final confirmation message.",
  carriers: "Carriers are not liable for delayed or undelivered messages.",
};

export const PRIVACY_POLICY_SECTIONS: LegalSection[] = [
  {
    title: "Overview",
    body: [
      `This Privacy Policy explains how VNDRLY collects, uses, stores, and protects information when partners, vendors, field employees, visitors, and administrators use the VNDRLY web application, iOS application, and related services. It is effective ${LEGAL_EFFECTIVE_DATE}.`,
      "VNDRLY is built for oil and gas field operations, including ticket tracking, crew dispatch, GPS-verified work activity, site management, parts and labor records, invoices, 1099 reporting workflows, compliance records, notifications, and support.",
    ],
  },
  {
    title: "Information We Collect",
    body: [
      "We collect account and organization information such as names, email addresses, phone numbers, job titles, user roles, partner/vendor organization names, billing details, tax identifiers where required for reporting, insurance and compliance documents, and support communications.",
      "We collect operational information entered into the platform, including site locations, tickets, assignments, schedules, GPS pings, route and mileage records, check-in and check-out events, photos, notes, parts, labor, invoices, payment status, visitor logs, and audit history.",
      "We collect technical information such as device type, browser, IP address, session data, app version, error logs, and security events so we can operate, protect, and improve the service.",
    ],
  },
  {
    title: "Location Data",
    body: [
      "VNDRLY may collect precise location data from authorized field users when location sharing is enabled, when a user is en route to a ticket, on location, on site, clocked in, or otherwise using a location-enabled workflow.",
      "Location data is used to support route estimates, crew maps, site geofences, ticket mileage, ETA, timekeeping context, compliance review, dispute resolution, and safety-adjacent operational visibility. Off-shift employees should not appear on live crew maps unless a configured workflow and consent allow it.",
      "Users can control device-level location permissions through their iOS or browser settings. Turning off location may prevent certain VNDRLY field workflows from working correctly.",
    ],
  },
  {
    title: "Gate and Vehicle Evidence",
    body: [
      "Authorized gate personnel may record visitor names, companies, license-plate values, check-in and check-out times, site location, and separate photographs of a vehicle tag and vehicle for site-security and operational records.",
      "When plate-reading assistance is used, VNDRLY sends the selected plate photograph to an artificial-intelligence service provider solely to extract the visible plate characters. Operators can type or correct the plate manually when automated reading is unavailable or inaccurate.",
      "Gate photographs are stored in private application storage and are available only to authorized users associated with the relevant site or host organization. Retention follows the customer and legal requirements applicable to the visitor log.",
    ],
  },
  {
    title: "How We Use Information",
    body: [
      "We use information to provide and secure VNDRLY, create and manage accounts, authenticate users, assign work, track tickets, calculate time and mileage, prepare reports, support invoicing and 1099 workflows, deliver notifications, troubleshoot issues, improve product reliability, and comply with applicable legal obligations.",
      "We may use contact information to send service-related email, SMS, in-app, or push notifications about account security, tickets, schedules, dispatch, site activity, invoices, payments, compliance deadlines, tax reporting, support, and product operations.",
    ],
  },
  {
    title: "Text Messaging and Mobile Information",
    body: [
      MESSAGING_DISCLOSURE.consent,
      `${MESSAGING_DISCLOSURE.summary} ${MESSAGING_DISCLOSURE.rates} ${MESSAGING_DISCLOSURE.stop} ${MESSAGING_DISCLOSURE.help} ${MESSAGING_DISCLOSURE.carriers}`,
      "VNDRLY does not sell, rent, or share mobile phone numbers, text messaging opt-in records, or SMS consent with third parties for their marketing or promotional purposes.",
    ],
  },
  {
    title: "How We Share Information",
    body: [
      "We share information only as needed to operate VNDRLY, including with the partner, vendor, field employee, or administrator accounts authorized to view a workflow; service providers that host, secure, deliver, route, message, email, map, analyze, or support the platform; and government, legal, tax, or safety authorities where required by law or valid process.",
      "We do not sell personal information. We do not allow service providers to use VNDRLY data for their own marketing.",
    ],
  },
  {
    title: "Data Retention and Security",
    body: [
      "We keep information for as long as needed to provide the service, support audit trails, meet tax and reporting obligations, resolve disputes, enforce agreements, and comply with law. Retention periods may vary by record type, customer configuration, and legal requirement.",
      "VNDRLY uses administrative, technical, and organizational safeguards intended to protect data against unauthorized access, loss, misuse, or alteration. No system is perfectly secure, so users should protect credentials and report suspected misuse promptly.",
    ],
  },
  {
    title: "Your Choices",
    body: [
      "Users may request access, correction, export, deletion, or restriction of personal information by contacting VNDRLY. Some requests may be limited by contractual, tax, safety, audit, security, or legal obligations.",
      "Users may opt out of SMS messages by replying STOP. Users may update email and notification preferences in the product where available or by contacting support.",
    ],
  },
  {
    title: "Contact",
    body: [
      `Questions about this Privacy Policy can be sent to ${LEGAL_CONTACT_EMAIL}. Support requests can be sent to ${LEGAL_SUPPORT_EMAIL}.`,
    ],
  },
];

export const TERMS_SECTIONS: LegalSection[] = [
  {
    title: "Agreement",
    body: [
      `These Terms and Conditions govern access to and use of VNDRLY, including the web application at ${LEGAL_SITE_ORIGIN}, the VNDRLY Field iOS application, APIs, notifications, support workflows, and related services. They are effective ${LEGAL_EFFECTIVE_DATE}.`,
      "By creating an account, accepting onboarding terms, signing in, or using VNDRLY on behalf of yourself or an organization, you agree to these Terms and represent that you have authority to bind the organization you represent.",
    ],
  },
  {
    title: "Service Description",
    body: [
      "VNDRLY is field operations management software for partners, vendors, and field employees in oil and gas and adjacent industrial operations. The platform supports site locations, QR and visitor workflows, dispatch, tickets, GPS activity, route and mileage context, parts and labor, compliance documents, invoices, payment status, reports, notifications, 1099 support workflows, and AskV assistance.",
      "VNDRLY is not a substitute for a company's HSE program, emergency response plan, legal advice, accounting advice, insurance obligations, or tax filing responsibilities.",
    ],
  },
  {
    title: "Accounts and Authorized Users",
    body: [
      "You are responsible for keeping account information accurate, protecting login credentials, assigning appropriate user roles, promptly removing users who should no longer have access, and ensuring your users comply with these Terms.",
      "You may not share credentials, impersonate another user, bypass access controls, interfere with audit trails, submit false job or compliance information, or use VNDRLY to violate law or another party's rights.",
    ],
  },
  {
    title: "Customer Data and Operational Records",
    body: [
      "Partners, vendors, and authorized users are responsible for the accuracy and legality of data they submit to VNDRLY, including tickets, time, mileage, tax identifiers, compliance documents, invoices, site data, photos, notes, and user contact information.",
      "VNDRLY may process customer data to provide, secure, support, improve, and report on the service, and to comply with applicable obligations.",
    ],
  },
  {
    title: "Messaging Terms",
    body: [
      `${MESSAGING_DISCLOSURE.programName}: ${MESSAGING_DISCLOSURE.summary}`,
      `${MESSAGING_DISCLOSURE.consent} ${MESSAGING_DISCLOSURE.rates}`,
      `${MESSAGING_DISCLOSURE.stop} ${MESSAGING_DISCLOSURE.help} ${MESSAGING_DISCLOSURE.carriers}`,
      "SMS consent is voluntary and is not a condition of purchasing or using VNDRLY. Operational messages may also be delivered by email, in-app notification, push notification, or other available channels depending on account configuration.",
    ],
  },
  {
    title: "Payments, Taxes, and Reporting",
    body: [
      "VNDRLY may help users prepare invoices, payment status records, reports, and 1099-supporting data. Each organization remains responsible for validating amounts, worker classifications, tax IDs, filing obligations, payments, and compliance with applicable laws.",
      "Electronic delivery of tax forms requires separate consent where applicable. Users may be asked to choose paper or electronic delivery during onboarding or account setup.",
    ],
  },
  {
    title: "Availability and Changes",
    body: [
      "VNDRLY may modify, suspend, or discontinue parts of the service, release updates, change workflows, or perform maintenance. We aim to keep the platform reliable, but we do not guarantee uninterrupted or error-free availability.",
      "We may update these Terms or related policies. Continued use after an update means you accept the updated terms unless a separate written agreement says otherwise.",
    ],
  },
  {
    title: "Disclaimers and Limitation of Liability",
    body: [
      "VNDRLY is provided as software for operational coordination. To the fullest extent permitted by law, VNDRLY disclaims implied warranties, including merchantability, fitness for a particular purpose, and non-infringement.",
      "To the fullest extent permitted by law, VNDRLY will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, lost revenue, lost data, business interruption, field delays, safety incidents, or third-party conduct.",
    ],
  },
  {
    title: "Contact",
    body: [
      `Questions about these Terms can be sent to ${LEGAL_CONTACT_EMAIL}. Support requests can be sent to ${LEGAL_SUPPORT_EMAIL}.`,
    ],
  },
];
