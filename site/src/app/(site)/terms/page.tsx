import { pageMeta } from '@/lib/seo';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { PageHero } from '@/components/site/PageHero';
import { Accent } from '@/components/site/Typography';
import {
  LegalDocument,
  LegalMeta,
  LegalNext,
  LegalSummary,
  TextLink,
  type LegalSection,
} from '@/components/legal/LegalDocument';
import { OwnerFact } from '@/components/legal/OwnerFact';
import { COMPANY, CONTACT_EMAIL, LAST_UPDATED, SITE_DOMAIN, WORKSPACE_DOMAIN } from '@/components/legal/facts';

// Website terms (PLAN Topic D4), drafted for the owner's review (Q9). They
// cover use of the site and the workspace login; client engagements are
// governed by each signed proposal, which these terms defer to.
export const metadata = pageMeta({
  title: 'Terms of Service',
  description:
    'The terms for using the NixGen Solutions website, its forms, the template gallery and the team workspace.',
  path: '/terms',
});

const MAIL = `mailto:${CONTACT_EMAIL}`;

const sections: LegalSection[] = [
  {
    id: 'agreement',
    title: 'About these terms',
    content: (
      <>
        <p>
          These terms apply to your use of {SITE_DOMAIN} and its pages, forms and template gallery (the “site”), and
          of the workspace at {WORKSPACE_DOMAIN}. The site is run by {COMPANY}, a trading name of{' '}
          <OwnerFact fact="entityName" /> (“NixGen”, “we”, “us”), registered at <OwnerFact fact="registeredAddress" />.
        </p>
        <p>
          By using the site you agree to these terms. If you do not agree, please do not use it. Our{' '}
          <TextLink href="/privacy">Privacy Policy</TextLink> explains how we handle personal data and forms part of
          these terms.
        </p>
      </>
    ),
  },
  {
    id: 'using-the-site',
    title: 'Using the site',
    content: (
      <>
        <p>You may browse the site and use its forms for genuine enquiries. You agree not to:</p>
        <ul>
          <li>break the law, or infringe anyone’s rights, through the site;</li>
          <li>
            send automated, bulk or misleading form submissions, or try to get around Turnstile, rate limits or other
            protections;
          </li>
          <li>probe, scan or test the site for vulnerabilities, or interfere with how it runs;</li>
          <li>copy or scrape the site at a volume that burdens it, or to build a competing product;</li>
          <li>upload or send anything that contains malware or that you have no right to share.</li>
        </ul>
        <p>
          If you think you have found a security problem, please tell us at{' '}
          <TextLink href={MAIL}>{CONTACT_EMAIL}</TextLink> instead of testing it further. We will not take action
          against good-faith reports.
        </p>
      </>
    ),
  },
  {
    id: 'information',
    title: 'Information on the site',
    content: (
      <>
        <p>
          The site describes our services in general terms. Prices, timelines, examples and results shown on it are
          indicative, are not an offer, and can change without notice. Results from past client work describe what
          happened for those clients; they are not a promise of the same outcome for you.
        </p>
        <p>
          We work to keep the site accurate and current, but we do not guarantee that every page is complete, error
          free or always available.
        </p>
      </>
    ),
  },
  {
    id: 'enquiries',
    title: 'Enquiries, proposals and projects',
    short: 'Enquiries & projects',
    content: (
      <>
        <p>
          Sending an enquiry or booking a call does not create a contract, and we may decline any enquiry. Any
          project starts only once we have both agreed a written proposal or statement of work.
        </p>
        <p>
          That agreement, not these terms, sets the scope, fees, payment, ownership of deliverables, warranties and
          liability for the project. If it conflicts with these terms, the signed agreement wins.
        </p>
      </>
    ),
  },
  {
    id: 'intellectual-property',
    title: 'Our content and your feedback',
    short: 'Intellectual property',
    content: (
      <>
        <p>
          The site’s design, text, graphics, video, code and the NixGen name and logo belong to us or to the people
          who licensed them to us. You may view and share links to the site, but you may not copy, adapt or reuse its
          content for commercial purposes without our written permission.
        </p>
        <p>
          Previews in the template gallery are shown for evaluation only. Using a template, or any work we produce,
          is covered by the agreement for that project or purchase.
        </p>
        <p>
          If you send us ideas or feedback about the site, we may use them without any obligation to you.
        </p>
      </>
    ),
  },
  {
    id: 'portfolio',
    title: 'Client work we show',
    content: (
      <p>
        Our portfolio shows projects we built for clients, with their permission or as our agreements allow. Names,
        logos and screenshots belong to their owners. If you own a project we show and would like it changed or
        removed, write to <TextLink href={MAIL}>{CONTACT_EMAIL}</TextLink> and we will act on it promptly.
      </p>
    ),
  },
  {
    id: 'third-parties',
    title: 'Links and other services',
    content: (
      <p>
        The site links to other websites, including live client sites and template sources, and relies on services
        such as Cloudflare and Google to run. We do not control those websites or services and are not responsible
        for their content, availability or privacy practices; your use of them is governed by their own terms.
      </p>
    ),
  },
  {
    id: 'workspace',
    title: 'The workspace',
    content: (
      <>
        <p>
          The workspace at {WORKSPACE_DOMAIN} is for our team members and the clients we invite. If you have an
          account:
        </p>
        <ul>
          <li>it is personal to you; keep your password and any second-factor codes to yourself;</li>
          <li>use it only for work with NixGen, and only within the access you were given;</li>
          <li>tell us straight away if you think someone else has used it.</li>
        </ul>
        <p>
          We may suspend or remove access to protect the workspace, its data or other users, or when a project or
          role ends. Connecting a Google account is optional and is described in the{' '}
          <TextLink href="/privacy#google">Privacy Policy</TextLink>.
        </p>
      </>
    ),
  },
  {
    id: 'disclaimers',
    title: 'Disclaimers',
    content: (
      <p>
        The site is provided “as is” and “as available”. To the extent the law allows, we disclaim all warranties
        about the site, express or implied, including fitness for a particular purpose and non-infringement. Nothing in
        these terms limits rights you have under consumer law that cannot be excluded.
      </p>
    ),
  },
  {
    id: 'liability',
    title: 'Limitation of liability',
    content: (
      <>
        <p>
          To the extent the law allows, we are not liable for any indirect or consequential loss, or for lost profits,
          revenue, data or goodwill, arising from your use of the site. Our total liability to you for anything
          arising from the site is limited to one hundred US dollars (USD 100).
        </p>
        <p>
          Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud, or for
          anything else that cannot be limited by law. Liability for client projects is set by the project agreement.
        </p>
      </>
    ),
  },
  {
    id: 'governing-law',
    title: 'Governing law',
    content: (
      <p>
        These terms are governed by the laws of <OwnerFact fact="governingLaw" />. Any dispute about them will be
        handled by the courts of <OwnerFact fact="courts" />, unless the law where you live gives you the right to
        bring it elsewhere.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    content: (
      <p>
        We may update these terms from time to time. The date at the top shows the latest version, and continuing to
        use the site after a change means you accept it. If any part of these terms is found unenforceable, the rest
        still applies.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    content: (
      <p>
        <OwnerFact fact="entityName" />
        <br />
        <OwnerFact fact="registeredAddress" />
        <br />
        <TextLink href={MAIL}>{CONTACT_EMAIL}</TextLink>
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Navbar />

      <main className="flex-1">
        <PageHero
          eyebrow="Terms of Service"
          index="Legal"
          title={
            <>
              The ground rules, <Accent>in plain words.</Accent>
            </>
          }
          lede="What you can expect from this website, what we ask of you when you use it, and how it relates to the agreement for any project we take on together."
          aside={
            <LegalMeta
              rows={[
                { label: 'Last updated', value: <time dateTime={LAST_UPDATED.iso}>{LAST_UPDATED.label}</time> },
                { label: 'Operated by', value: <OwnerFact fact="entityName" /> },
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
                'Use the site and its forms for genuine enquiries; don’t attack or scrape it.',
                'Prices and results on the site are indicative, not an offer.',
                'A project starts only with a signed proposal, and that agreement wins.',
                'Own a project in our portfolio? Ask, and we will change or remove it.',
              ]}
            />
          }
          aside={
            <div className="mt-6">
              <LegalNext
                links={[
                  { label: 'Privacy Policy', hint: 'Also read', href: '/privacy' },
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
