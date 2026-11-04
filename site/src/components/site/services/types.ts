/** One capability on /services. The data lives in the page file. */
export interface Capability {
  /** Display index, e.g. "01". */
  id: string;
  /** Section id: the footer links to /services#<anchor>. */
  anchor: string;
  title: string;
  tagline: string;
  body: string;
  deliverables: string[];
  timeline: string;
  price: string;
  results: string[];
}

export interface AddOn {
  title: string;
  price: string;
  body: string;
}

/** "Conversion Websites" → ["Conversion", "Websites"] so the last word can take the serif accent. */
export function splitLastWord(text: string): [string, string] {
  const i = text.lastIndexOf(' ');
  return i < 0 ? ['', text] : [text.slice(0, i), text.slice(i + 1)];
}

/** "From $2,500/month" → { lead: "From", amount: "$2,500", unit: "/month" }; null if it doesn't fit the pattern. */
export function splitPrice(price: string): { lead?: string; amount: string; unit?: string } | null {
  const m = price.match(/^(From)?\s*(\$[\d,]+(?:\.\d+)?)(\/[a-z]+)?$/i);
  if (!m) return null;
  return { lead: m[1] || undefined, amount: m[2], unit: m[3] || undefined };
}

/**
 * "+312% organic traffic (Hike Wales)" → { metric: "+312%", rest: "organic traffic (Hike Wales)" }
 * so the figure can be set apart; null when a result doesn't lead with one ("Live KPIs in one panel").
 */
export function splitMetric(result: string): { metric: string; rest: string } | null {
  const m = result.match(/^([+#]?\d[\d,.]*(?:%|\+|s)?)\s+(.+)$/);
  return m ? { metric: m[1], rest: m[2] } : null;
}
