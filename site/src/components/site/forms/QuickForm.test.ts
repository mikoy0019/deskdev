import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { DISCOVERY_FORM, ONBOARDING_FORM, customerAnswers, customerTemplate, formFields } from '../../../deskdev/lib/forms';
import { QuickForm } from './QuickForm';

// Server-render smoke test: what the /f/<token> page hands the browser.

function render(template = DISCOVERY_FORM, stored: Record<string, unknown> = {}) {
  const view = customerTemplate(template)!;
  return renderToString(
    createElement(QuickForm, {
      token: 'Q2xhdWRlLXRlc3QtdG9rZW4tMDEyMzQ1Njc4OWFiY2RlZg',
      template: view,
      initialAnswers: customerAnswers(template, stored),
      firstName: 'Maya',
    }),
  );
}

describe('QuickForm', () => {
  it('renders every customer field, and no internal one', () => {
    const html = render();
    for (const f of formFields(customerTemplate(DISCOVERY_FORM)!)) expect(html, f.key).toContain(f.label.replace(/'/g, '&#x27;'));
    for (const f of formFields(DISCOVERY_FORM).filter((x) => x.internal)) expect(html, f.key).not.toContain(f.label);
    expect(html).not.toContain('Our notes');
  });

  it('shows what is on file, and never an internal answer', () => {
    const html = render(DISCOVERY_FORM, { company: 'Kalye Coffee Co.', meeting_notes: 'INTERNAL-NOTE', services: ['website'] });
    expect(html).toContain('value="Kalye Coffee Co."');
    expect(html).not.toContain('INTERNAL-NOTE');
    // The picked service chip starts checked.
    expect(html).toMatch(/role="checkbox" aria-checked="true"[^>]*>.*?Website/);
  });

  it('marks optional fields and uses radio chips for single choices', () => {
    const html = render(ONBOARDING_FORM);
    expect(html).toContain('Optional');
    expect(html).toContain('role="radiogroup"');
    expect(html).not.toContain('Kickoff call');
    expect(html).toContain('name="_honey"');
  });
});
