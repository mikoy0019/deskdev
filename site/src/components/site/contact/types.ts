/** One way to reach the studio on /contact. The data lives in the page file. */
export interface Channel {
  label: string;
  value: string;
  /** mailto:, tel: or an in-page anchor; null renders plain text. */
  href: string | null;
}
