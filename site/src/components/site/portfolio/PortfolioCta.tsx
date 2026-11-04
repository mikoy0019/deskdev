import { CtaBand } from '@/components/site/CtaBand';
import { Button } from '@/components/site/Button';
import { Accent, Beacon } from '@/components/site/Typography';
import { Magnetic } from '@/components/site/motion';

/** The closing band of /portfolio and of every case study under it. */
export function PortfolioCta() {
  return (
    <CtaBand
      kicker={<Beacon>Two slots open&nbsp;— Q2 2026</Beacon>}
      title={
        <>
          Your site could be <Accent>the next one live.</Accent>
        </>
      }
      body={
        <>
          Every site in this archive started with a single call. If you&apos;re ready for a website that actually
          brings in business&nbsp;— let&apos;s talk.
        </>
      }
      actions={
        <>
          <Magnetic>
            <Button href="/contact" variant="white" size="lg" arrow>
              Start a Project
            </Button>
          </Magnetic>
          <Magnetic>
            <Button href="/services" variant="outline-white" size="lg">
              See What We Do
            </Button>
          </Magnetic>
        </>
      }
    />
  );
}
