import {
  FORM_TEMPLATES,
  customerAnswers,
  customerTemplate,
  type Answers,
  type FormTemplate,
} from '../deskdev/lib/forms';
import { logEvent } from './guard';

// Customer quick forms (migration 047): DeskDev mints a private link to
// /f/<token> for a lead's discovery form or a project's onboarding form. The
// database only knows the token's SHA-256; it answers two RPCs, both called
// here on the server with the anon key plus LEAD_INTAKE_SECRET (checked
// against the Vault secret 'lead_intake_secret', like intake_site_lead), so a
// token alone opens nothing outside this site's own server.
//
//   form_link_read(p_secret, p_token)                         → the form and its stored answers
//   form_link_submit(p_secret, p_token, p_answers, p_form_title) → merges the customer's answers
//
// form_link_read returns EVERY stored answer, the team's internal notes
// included. Nothing from it leaves the server unfiltered: the template is
// reduced to its customer view and the answers to that view's keys
// (customerAnswers), and the submit path filters the same way, so a customer
// can neither read nor write an internal field.
//
// Server only (route handlers and server components): it reads secrets.

const ROUTE = 'form-link';

/** The database answers in well under a second; past this the page says "try again". */
const RPC_TIMEOUT_MS = 3_000;

/** What DeskDev mints (32 random bytes, base64url) with room either side; anything else is refused unread. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32,128}$/;

export function isTokenShape(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_SHAPE.test(token);
}

export interface FormLinkContext {
  /** The person the form is for (lead or client name). */
  name: string | null;
  company: string | null;
  projectTitle: string | null;
}

/** An open link, reduced to what the customer may see. */
export interface OpenFormLink {
  status: 'open';
  form: string;
  /** The template's customer view (internal fields removed). */
  template: FormTemplate;
  /** Stored answers to the customer view's fields only. */
  answers: Answers;
  context: FormLinkContext;
  expiresAt: string | null;
}

export type FormLinkRead =
  | OpenFormLink
  | { status: 'submitted'; form: string; template: FormTemplate; context: FormLinkContext }
  | { status: 'not_found' }
  | { status: 'expired' }
  | { status: 'not_configured' }
  | { status: 'unavailable' }
  | { status: 'timeout' };

export type FormLinkSubmit =
  | { status: 'saved' }
  | { status: 'not_found' }
  | { status: 'expired' }
  | { status: 'already_submitted' }
  | { status: 'invalid' }
  | { status: 'not_configured' }
  | { status: 'unavailable' }
  | { status: 'timeout' };

interface Config {
  url: string;
  anonKey: string;
  secret: string;
}

/** Read per call: on Workers the secrets arrive with the request's environment. */
function config(): Config | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.LEAD_INTAKE_SECRET;
  if (!url || !anonKey || !secret) {
    logEvent(ROUTE, 'error', 'not_configured', { url: Boolean(url), anonKey: Boolean(anonKey), secret: Boolean(secret) });
    return null;
  }
  return { url: url.replace(/\/+$/, ''), anonKey, secret };
}

/** First 8 hex of the token's SHA-256: enough to match log lines, useless as a key. */
async function tokenRef(token: string): Promise<string> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest).slice(0, 4), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return 'unknown';
  }
}

type RpcResult = { kind: 'ok'; body: Record<string, unknown> } | { kind: 'unavailable' } | { kind: 'timeout' };

async function rpc(cfg: Config, fn: string, args: Record<string, unknown>, ref: string): Promise<RpcResult> {
  try {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}` },
      body: JSON.stringify({ p_secret: cfg.secret, ...args }),
      // POSTs are never cached; the /f page is force-dynamic as well.
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!res.ok) {
      // PostgREST's error code only (42501 = the secret was refused); its message can echo input.
      const code = await res
        .json()
        .then((b: unknown) => {
          const c = (b as { code?: unknown } | null)?.code;
          return typeof c === 'string' ? c : null;
        })
        .catch(() => null);
      logEvent(ROUTE, 'error', `${fn}_failed`, { status: res.status, code, ref });
      return { kind: 'unavailable' };
    }
    const body = (await res.json().catch(() => null)) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      logEvent(ROUTE, 'error', `${fn}_bad_answer`, { ref });
      return { kind: 'unavailable' };
    }
    return { kind: 'ok', body: body as Record<string, unknown> };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    logEvent(ROUTE, 'error', timedOut ? `${fn}_timeout` : `${fn}_unreachable`, { ref });
    return { kind: timedOut ? 'timeout' : 'unavailable' };
  }
}

function text(v: unknown, max = 160): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

function contextOf(v: unknown): FormLinkContext {
  const c = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return { name: text(c.name, 120), company: text(c.company), projectTitle: text(c.project_title, 200) };
}

/** The form behind a link, filtered to what its customer may see. Never throws. */
export async function readFormLink(token: string): Promise<FormLinkRead> {
  if (!isTokenShape(token)) return { status: 'not_found' };
  const cfg = config();
  if (!cfg) return { status: 'not_configured' };
  const ref = await tokenRef(token);

  const result = await rpc(cfg, 'form_link_read', { p_token: token }, ref);
  if (result.kind !== 'ok') return { status: result.kind };
  const body = result.body;

  if (body.ok !== true) {
    const reason = body.reason === 'expired' ? 'expired' : 'not_found';
    logEvent(ROUTE, 'info', `read_${reason}`, { ref });
    return { status: reason };
  }

  const form = typeof body.form === 'string' ? body.form : '';
  const template = FORM_TEMPLATES[form];
  const view = template ? customerTemplate(template) : null;
  if (!template || !view) {
    // A form this site doesn't know, or one that isn't meant for customers.
    logEvent(ROUTE, 'warn', 'read_unshareable_form', { form: form.slice(0, 40), ref });
    return { status: 'not_found' };
  }

  const context = contextOf(body.context);
  if (body.submitted === true || typeof body.customer_submitted_at === 'string') {
    return { status: 'submitted', form, template: view, context };
  }

  const stored = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? (body.answers as Answers) : {};
  return {
    status: 'open',
    form,
    template: view,
    answers: customerAnswers(template, stored),
    context,
    expiresAt: typeof body.expires_at === 'string' ? body.expires_at : null,
  };
}

/**
 * Hands the customer's answers to the database. `answers` must already be
 * filtered to the customer view (customerAnswers) and validated; the RPC
 * merges whatever it gets.
 */
export async function submitFormLink(token: string, answers: Answers, formTitle: string): Promise<FormLinkSubmit> {
  if (!isTokenShape(token)) return { status: 'not_found' };
  const cfg = config();
  if (!cfg) return { status: 'not_configured' };
  const ref = await tokenRef(token);

  const result = await rpc(
    cfg,
    'form_link_submit',
    { p_token: token, p_answers: answers, p_form_title: formTitle.slice(0, 120) },
    ref,
  );
  if (result.kind !== 'ok') return { status: result.kind };
  const body = result.body;

  if (body.ok === true) {
    logEvent(ROUTE, 'info', 'submitted', { form: typeof body.form === 'string' ? body.form.slice(0, 40) : null, ref });
    return { status: 'saved' };
  }
  const reason =
    body.reason === 'expired' ? 'expired'
    : body.reason === 'submitted' ? 'already_submitted'
    : body.reason === 'invalid' ? 'invalid'
    : 'not_found';
  logEvent(ROUTE, reason === 'invalid' ? 'warn' : 'info', `submit_${reason}`, { ref });
  return { status: reason };
}

/** "Discovery" → "discovery form"; what the team's notification names. */
export function formTitleFor(template: FormTemplate): string {
  const title = template.title.trim();
  return `${title.charAt(0).toLowerCase()}${title.slice(1)}${/\bform$/i.test(title) ? '' : ' form'}`;
}
