// ─── Sender lists (shared by Gmail query + rule-based classifier) ─────

/**
 * Consumer / education / job-board senders that never contain the user's own
 * applications.
 */
export const EXCLUDED_SENDER_DOMAINS = [
  "uber.com", "ubereats.com", "ola.com", "olacabs.com",
  "zomato.com", "swiggy.com", "dunzo.com", "blinkit.com",
  "amazon.in", "amazon.com", "flipkart.com", "myntra.com", "meesho.com",
  "paytm.com", "phonepe.com", "gpay.com", "razorpay.com",
  "internshala.com", "coursera.org", "udemy.com", "edx.org",
  "unacademy.com", "upgrad.com", "simplilearn.com", "byjus.com",
  "naukri.com", "indeed.com", "glassdoor.com", "shine.com", "monster.com",
  "unstop.com", "hackerearth.com", "devfolio.co", "hackerrank.com",
];

/**
 * LinkedIn senders that are pure noise. Application confirmations
 * ("Your application was sent to X") come from jobs-noreply@linkedin.com
 * and are intentionally NOT excluded.
 */
export const EXCLUDED_LINKEDIN_SENDERS = [
  "jobalerts-noreply@linkedin.com",
  "messages-noreply@linkedin.com",
  "notifications-noreply@linkedin.com",
  "invitations@linkedin.com",
  "messaging-digest-noreply@linkedin.com",
  "news@linkedin.com",
  "editors-noreply@linkedin.com",
  "linkedin@e.linkedin.com",
];

/** ATS senders that send confirmations/replies on behalf of employers. */
export const ATS_SENDER_DOMAINS = [
  "greenhouse.io", "lever.co", "myworkday.com", "myworkdayjobs.com",
  "ashbyhq.com", "smartrecruiters.com", "icims.com", "workablemail.com",
  "wellfound.com", "jobvite.com", "taleo.net", "successfactors.com",
];

/** True if the From header belongs to an excluded sender. */
export function isExcludedSender(from: string): boolean {
  const f = from.toLowerCase();
  if (EXCLUDED_SENDER_DOMAINS.some((d) => f.includes(d))) return true;
  if (EXCLUDED_LINKEDIN_SENDERS.some((s) => f.includes(s))) return true;
  // Any other LinkedIn sender except the application-confirmation one
  if (f.includes("linkedin.com") && !f.includes("jobs-noreply@linkedin.com")) return true;
  return false;
}
