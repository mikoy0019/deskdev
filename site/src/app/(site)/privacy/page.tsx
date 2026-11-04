import { pageMeta } from '@/lib/seo';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { PageHero } from '@/components/site/PageHero';
import { Accent } from '@/components/site/Typography';
import {
  LegalDocument,
  LegalMeta,
  LegalNext,
  LegalRows,
  LegalSummary,
  Sub,
  TextLink,
  type LegalRow,
  type LegalSection,
} from '@/components/legal/LegalDocument';
import { OwnerFact } from '@/components/legal/OwnerFact';
import {
  BROWSER_STORAGE,
  COMPANY,
  CONTACT_EMAIL,
  GOOGLE_PERMISSIONS_URL,
  GOOGLE_SCOPES,
  GOOGLE_USER_DATA_POLICY_URL,
  LAST_UPDATED,
  RETENTION_WINDOWS,
  SITE_DOMAIN,
  WORKSPACE_DOMAIN,
} from '@/components/legal/facts';

// Draft from PLAN Topic D4 for the owner's review (Q9). Every statement here
// describes code in this repo: the contact route and guard (site/src/lib),
// attribution in sessionStorage, the formsubmit.co fallback in ContactForm,
// the google Edge Function's scopes and migration 039's retention windows.
// legal.test.ts holds the retention, storage keys and scopes to the code.
export const metadata = pageMeta({
  title: 'Privacy Policy',
  description:
    'How NixGen Solutions collects, uses, keeps and protects personal data from this website, its contact and newsletter forms, and the team workspace.',
  path: '/privacy',
});

const MAIL = `mailto:${CONTACT_EMAIL}`;
const MAIL_REQUEST = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Privacy request')}`;

const processors: LegalRow[] = [
  {
    term: 'Cloudflare',
    meta: 'Hosting & security',
    detail:
      'Serves this website and runs its server code, protects the forms with Turnstile, and provides our cookieless Web Analytics. Processes your IP address and request details to deliver and secure the site.',
  },
  {
    term: 'Supabase',
    meta: 'Database',
    detail:
      'Stores enquiries, newsletter sign-ups and the team workspace (database, sign-in and file storage). This is where your enquiry is kept.',
  },
  {
    term: 'Google',
    meta: 'Email & workspace',
    detail:
      'Our company email runs on Gmail, so the replies we send you and the messages you send us pass through Google. Workspace users who connect a Google account also use Google Calendar and Drive, as described in section 08.',
  },
  {
    term: 'FormSubmit (formsubmit.co)',
    meta: 'Fallback only',
    detail:
      'Used only when our own system cannot confirm it received your enquiry. It forwards the form to our company inbox so nothing is lost (section 05).',
  },
  {
    term: 'Workflow automation (n8n)',
    meta: 'Run by us',
    detail:
      'A workflow tool we operate ourselves. It can send the confirmation email for a new enquiry and alerts the team member responsible for it.',
  },
  {
    term: 'Web push services',
    meta: 'Team devices',
    detail:
      'Deliver notifications about new enquiries to our own team members’ browsers and phones (for example Apple, Google or Mozilla push services). Nothing is pushed to visitors.',
  },
];

const retention: LegalRow[] = [
  {
    term: 'Enquiries we decide not to pursue',
    meta: RETENTION_WINDOWS.lost_lead_pii,
    detail:
      'Counted from your last message or our last update, whichever is later. We then remove your name, email, phone, company, message, our notes about you, your IP fingerprint, and the referring page, landing page and click id. What remains (the service asked about, budget band, timeline, campaign name, dates and outcome) no longer identifies you and is kept for our own reporting.',
  },
  {
    term: 'Submissions marked as spam',
    meta: RETENTION_WINDOWS.spam_leads,
    detail:
      'Deleted entirely once 30 days have passed since the submission was last received or changed, so a genuine message caught by mistake can still be recovered in that time.',
  },
  {
    term: 'Enquiries that become a project',
    meta: 'Engagement + legal period',
    detail:
      'Kept for the length of our work together and afterwards for as long as accounting, tax and contract law require, then deleted or anonymised.',
  },
  {
    term: 'Internal team notifications',
    meta: RETENTION_WINDOWS.notifications,
    detail:
      'All in-app team notifications, including those that quote an enquiry, are deleted after 90 days, and sooner if the enquiry itself is deleted or anonymised.',
  },
  {
    term: 'Newsletter sign-ups',
    meta: 'Until you unsubscribe',
    detail:
      'When you unsubscribe we keep your address, the date you left and the record of your original sign-up as a do-not-contact entry, so you are never added back by mistake. Ask us and we will delete it entirely.',
  },
  {
    term: 'Form abuse checks',
    meta: RETENTION_WINDOWS.subscriber_attempts,
    detail: 'The short-lived records we use to slow down repeated sign-up attempts are cleared after one day.',
  },
  {
    term: 'Visit source in your browser',
    meta: 'Until the tab closes',
    detail: `The ${BROWSER_STORAGE.attributionKey} entry lives in sessionStorage, which your browser clears when you close the tab.`,
  },
  {
    term: 'Server and error logs',
    meta: 'Up to 7 days',
    detail:
      'Technical logs from our server code, including error reports from the site, have email addresses, tokens and link query strings scrubbed out, and expire with our hosting provider’s log retention.',
  },
];

const sections: LegalSection[] = [
  {
    id: 'who-we-are',
    title: 'Who we are',
    content: (
      <>
        <p>
          {COMPANY} (“NixGen”, “we”, “us”) is a trading name of <OwnerFact fact="entityName" />, registered at{' '}
          <OwnerFact fact="registeredAddress" />. We are the controller of the personal data described in this
          policy.
        </p>
        <p>
          This policy covers the website at {SITE_DOMAIN}, its contact and newsletter forms, and the team workspace at{' '}
          {WORKSPACE_DOMAIN}, which our team and invited clients sign in to. When we build or run systems for a client,
          the data inside those systems is handled under our agreement with that client, not under this policy.
        </p>
        <p>
          Questions about your data go to <TextLink href={MAIL}>{CONTACT_EMAIL}</TextLink>.
        </p>
      </>
    ),
  },
  {
    id: 'what-we-collect',
    title: 'What we collect',
    content: (
      <>
        <Sub>When you send an enquiry</Sub>
        <ul>
          <li>
            <strong>What you type:</strong> your name, email address, company, phone number (optional), the services
            you are interested in, budget range, timeline and your message.
          </li>
          <li>
            <strong>Your consent:</strong> the time you ticked the box agreeing to this policy.
          </li>
          <li>
            <strong>How you found us:</strong> the campaign tags in the link you arrived from (for example{' '}
            <code>utm_source</code> or a Google Ads click id), the website that referred you (its address without the
            query string) and the page you landed on.
          </li>
          <li>
            <strong>Anti-spam signals:</strong> a one-way, salted fingerprint of your IP address (we never store the
            address itself), the result of the Turnstile check, how long the form took to fill in, and whether the
            hidden trap field was filled.
          </li>
        </ul>
        <p>
          We use these details to work out how quickly to reply and who on the team should handle it. That internal
          ranking never decides anything about you on its own: a person reads every genuine enquiry.
        </p>

        <Sub>When you join the newsletter</Sub>
        <p>
          Your email address, where on the site you signed up, the time you gave consent and the same salted IP
          fingerprint. We have not sent a newsletter yet; when we do, every email will include a way to unsubscribe.
        </p>

        <Sub>When you visit</Sub>
        <ul>
          <li>
            <strong>Analytics:</strong> we use Cloudflare Web Analytics, which counts page views and performance
            without cookies and without building a profile of you across sites.
          </li>
          <li>
            <strong>Delivery and security:</strong> like any website, our hosting provider processes your IP address,
            browser type and the pages requested to serve the site and block attacks.
          </li>
          <li>
            <strong>Error reports:</strong> if the site breaks in your browser, it may send us a technical report of the
            error. Email addresses, tokens and the query strings of links are scrubbed out before the reports
            are logged.
          </li>
        </ul>

        <Sub>When you email or work with us</Sub>
        <p>
          Your messages and anything you choose to share with us, and, for clients and team members, the account
          details needed to sign in to the workspace.
        </p>
      </>
    ),
  },
  {
    id: 'browser-storage',
    title: 'Cookies and browser storage',
    short: 'Cookies & storage',
    content: (
      <>
        <p>
          We do not use advertising or cross-site tracking cookies, so this site has no cookie banner. What it does
          store in your browser:
        </p>
        <ul>
          <li>
            <code>{BROWSER_STORAGE.attributionKey}</code> in sessionStorage: the first and latest source of your
            visit (campaign tags, referring site, landing page and time), read by the contact form so we know which
            channels bring enquiries. Your browser deletes it when you close the tab, and it is only ever sent to us if
            you submit the form.
          </li>
          <li>
            <code>{BROWSER_STORAGE.themeKey}</code> as a cookie and in localStorage: whether you chose the light or
            dark theme. It holds nothing else.
          </li>
          <li>
            <strong>Cloudflare Turnstile</strong> runs a short check in your browser when you use a form, to tell
            people from bots. It does not use cookies to follow you across sites.
          </li>
          <li>
            <strong>Workspace sign-in</strong> (team members and invited clients only): a session kept in your
            browser’s storage so you stay signed in.
          </li>
        </ul>
        <p>You can clear any of these in your browser settings; the site keeps working without them.</p>
      </>
    ),
  },
  {
    id: 'how-we-use',
    title: 'How we use it, and why we are allowed to',
    short: 'How we use it',
    content: (
      <>
        <ul>
          <li>
            <strong>Answering your enquiry and preparing a proposal</strong>: at your request, before any contract,
            and because you agreed to this policy when you sent the form.
          </li>
          <li>
            <strong>Keeping the forms free of spam and abuse</strong>: our legitimate interest in running a safe
            service. Suspected spam is set aside without alerting anyone, and deleted after 30 days unless we find it was genuine.
          </li>
          <li>
            <strong>Understanding which channels bring enquiries</strong>: our legitimate interest in running our
            business, using only the source details listed above and aggregate analytics.
          </li>
          <li>
            <strong>Sending the newsletter</strong>: your consent, which you can withdraw at any time.
          </li>
          <li>
            <strong>Delivering a project</strong>: our contract with you or your company.
          </li>
          <li>
            <strong>Keeping records the law requires</strong>: our legal obligations.
          </li>
        </ul>
        <p>We do not sell your personal data, and we do not share it with anyone for their own advertising.</p>
      </>
    ),
  },
  {
    id: 'fallback',
    title: 'If our system cannot take your enquiry',
    short: 'Fallback email',
    content: (
      <>
        <p>
          Enquiries go straight into our own database. If that step fails or cannot be confirmed, the form sends the
          same enquiry through FormSubmit (formsubmit.co), an email-forwarding service, to our company inbox at{' '}
          {CONTACT_EMAIL}, so your message is not lost. FormSubmit handles the contents only to deliver that email.
        </p>
        <p>
          This is a temporary safety net. We intend to remove it once our own system has run reliably for several
          weeks, and we will update this section when we do.
        </p>
      </>
    ),
  },
  {
    id: 'sharing',
    title: 'Who we share it with',
    content: (
      <>
        <p>
          We use the providers below to run the site and our business. They process personal data only on our
          instructions and under contracts that require them to protect it.
        </p>
        <LegalRows rows={processors} label="Service providers" />
        <p>
          We will also disclose personal data where the law requires it, to protect our rights or someone’s safety,
          or to a buyer if our business is ever sold, in which case this policy continues to apply.
        </p>
      </>
    ),
  },
  {
    id: 'international',
    title: 'International transfers',
    content: (
      <p>
        Our providers run data centres in several countries, so your data may be processed outside the country you
        live in. Where data protection law requires it, transfers rely on safeguards such as the European
        Commission’s Standard Contractual Clauses or an adequacy decision, as offered in each provider’s data
        processing terms.
      </p>
    ),
  },
  {
    id: 'google',
    title: 'Google user data in the workspace',
    short: 'Google user data',
    content: (
      <>
        <p>
          This section applies only to team members and invited clients who connect a Google account in the
          workspace. The workspace asks Google for the narrowest access each feature needs, and nothing more:
        </p>
        <LegalRows
          label="Google permissions"
          rows={GOOGLE_SCOPES.map((s) => ({
            term: s.label,
            meta: <code className="!bg-transparent !p-0 !text-[0.75rem] !text-inherit normal-case">{s.scope.replace('https://www.googleapis.com/auth/', '')}</code>,
            detail: s.use,
          }))}
        />
        <p>
          The workspace never asks for access to your Gmail, your contacts or your whole Drive. The connection’s access
          tokens are stored encrypted on our servers and used only when you, or the shared team calendar, need them. You
          can disconnect at any time in the workspace settings or from your{' '}
          <TextLink href={GOOGLE_PERMISSIONS_URL}>Google Account permissions</TextLink>; when a team member leaves,
          we revoke their connection.
        </p>
        <p>
          <strong>
            {COMPANY}’s use and transfer to any other app of information received from Google APIs will adhere to
            the{' '}
            <TextLink href={GOOGLE_USER_DATA_POLICY_URL}>Google API Services User Data Policy</TextLink>, including
            the Limited Use requirements.
          </strong>{' '}
          In particular, we:
        </p>
        <ul>
          <li>use Google user data only to provide and improve the workspace features you can see;</li>
          <li>never sell it, or use or transfer it for advertising, including retargeting or personalised ads;</li>
          <li>
            never use it to develop, improve or train generalised artificial intelligence or machine learning models;
          </li>
          <li>
            transfer it to others only as needed to provide those features, to comply with the law, or as part of a
            merger or sale with notice to you;
          </li>
          <li>
            do not let people read it unless you ask us to (for example for support), it is needed for security or
            the law, or it has been aggregated and anonymised for internal operations.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    content: (
      <>
        <p>
          We keep personal data only as long as we need it. Most of the periods below are enforced automatically by a
          scheduled job in our database, not left to someone remembering.
        </p>
        <LegalRows rows={retention} label="Retention periods" />
        <p>
          Enquiries that reached us by the fallback email are kept in our company inbox and follow the same periods.
          Backups roll over on their own schedule, so a deleted record can survive in a backup for a short
          time before it is overwritten.
        </p>
      </>
    ),
  },
  {
    id: 'security',
    title: 'How we protect it',
    content: (
      <>
        <p>
          Everything travels over encrypted connections. Our database only lets each team member see what their role
          allows, form endpoints check where a request came from and how big it is before anything is stored, and
          secrets and passwords live in encrypted storage rather than in code. IP addresses are reduced to a salted
          fingerprint before they reach the database.
        </p>
        <p>
          No system is perfectly secure. If a breach puts your data at risk, we will tell you and the relevant
          authorities as the law requires.
        </p>
      </>
    ),
  },
  {
    id: 'your-rights',
    title: 'Your rights and data requests',
    short: 'Your rights',
    content: (
      <>
        <p>Depending on where you live, you can ask us to:</p>
        <ul>
          <li>tell you what personal data we hold about you and give you a copy;</li>
          <li>correct it, or delete it;</li>
          <li>stop or limit how we use it, including for our own reporting;</li>
          <li>give it to you in a portable format;</li>
          <li>withdraw a consent you gave, such as for the newsletter, without affecting what came before.</li>
        </ul>
        <p>
          Email <TextLink href={MAIL_REQUEST}>{CONTACT_EMAIL}</TextLink> with the subject “Privacy request” and the
          email address you used with us. To protect you, we confirm the request from that address before acting on
          it. We reply within 30 days, and there is no charge.
        </p>
        <p>
          If you are in California: we do not sell or share personal information for cross-context behavioural
          advertising, and we will not treat you differently for using these rights. If you are unhappy with our
          answer, you can complain to the data protection authority where you live.
        </p>
      </>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    content: (
      <p>
        This site and our services are for businesses. They are not directed at children under 16, and we do not
        knowingly collect their personal data. If you think a child has sent us their details, write to us and we
        will delete them.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    content: (
      <p>
        When we change how we handle personal data, we update this page and the date at the top. If a change
        matters to how we use data you already gave us, we will tell you before it applies.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    content: (
      <>
        <p>
          <OwnerFact fact="entityName" />
          <br />
          <OwnerFact fact="registeredAddress" />
          <br />
          <TextLink href={MAIL}>{CONTACT_EMAIL}</TextLink>
        </p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Navbar />

      <main className="flex-1">
        <PageHero
          eyebrow="Privacy Policy"
          index="Legal"
          title={
            <>
              What we collect, and <Accent>why.</Accent>
            </>
          }
          lede="Plain answers about the data this website and our team workspace handle: what we ask for, where it goes, how long we keep it, and how to have it removed."
          aside={
            <LegalMeta
              rows={[
                { label: 'Last updated', value: <time dateTime={LAST_UPDATED.iso}>{LAST_UPDATED.label}</time> },
                { label: 'Controller', value: <OwnerFact fact="entityName" /> },
                { label: 'Questions', value: <TextLink href={MAIL}>{CONTACT_EMAIL}</TextLink> },
              ]}
            />
          }
        />

        <LegalDocument
          sections={sections}
          intro={
            <LegalSummary
              points={[
                'We collect what you type into our forms, and how you found us.',
                'No advertising or tracking cookies, and analytics without cookies.',
                'We never sell your data or use it for anyone else’s ads.',
                <>
                  Unused enquiries lose their personal details after {RETENTION_WINDOWS.lost_lead_pii}; spam goes after{' '}
                  {RETENTION_WINDOWS.spam_leads}.
                </>,
              ]}
            />
          }
          aside={
            <div className="mt-6">
              <LegalNext
                links={[
                  { label: 'Terms of Service', hint: 'Also read', href: '/terms' },
                  { label: 'Contact us', hint: 'Start a project', href: '/contact' },
                ]}
              />
            </div>
          }
        />
      </main>

      <Footer />
    </div>
  );
}
