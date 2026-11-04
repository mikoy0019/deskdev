/** One phase of the NixGen protocol on /process. The data lives in the page file. */
export interface Phase {
  /** Display index, e.g. "01". */
  id: string;
  title: string;
  subtitle: string;
  duration: string;
  body: string;
  deliverables: string[];
}

export type GuaranteeIcon = 'clock' | 'key' | 'chart' | 'support' | 'report' | 'badge';

export interface Guarantee {
  title: string;
  body: string;
  icon: GuaranteeIcon;
}
