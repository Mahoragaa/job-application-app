import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function htmlToCleanText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(nav|header|footer)[\s\S]*?<\/\1>/gi, " ");

  const withBreaks = withoutScripts
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|section|article|tr)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n");

  const stripped = withBreaks.replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(stripped)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractMetaContent(html: string, nameOrProp: string): string | null {
  const regex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${nameOrProp}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${nameOrProp}["']`,
    "i"
  );
  const m = html.match(regex);
  const val = m?.[1] || m?.[2];
  return val ? decodeHtmlEntities(val).trim() : null;
}

function findJobPostingJsonLd(node: unknown): Record<string, unknown> | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPostingJsonLd(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const typeVal = obj["@type"];
    if (
      typeVal === "JobPosting" ||
      (Array.isArray(typeVal) && typeVal.includes("JobPosting"))
    ) {
      return obj;
    }
    if (obj["@graph"]) {
      return findJobPostingJsonLd(obj["@graph"]);
    }
  }
  return null;
}

function inferCompanyFromUrl(urlObj: URL): string {
  const host = urlObj.hostname.toLowerCase();
  const pathParts = urlObj.pathname.split("/").filter(Boolean);

  if (
    (host.includes("greenhouse.io") ||
      host.includes("lever.co") ||
      host.includes("ashbyhq.com") ||
      host.includes("workable.com") ||
      host.includes("breezy.hr")) &&
    pathParts.length > 0
  ) {
    return pathParts[0]
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const hostParts = host.replace(/^www\.|^jobs\.|^careers\./, "").split(".");
  if (hostParts.length > 0 && hostParts[0]) {
    return hostParts[0]
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return "";
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { url?: string };
    const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
    if (!rawUrl) {
      return NextResponse.json({ error: "Please provide a valid URL." }, { status: 400 });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
    } catch {
      return NextResponse.json({ error: "Invalid URL format." }, { status: 400 });
    }

    // Special fast path for Greenhouse URLs via public JSON API
    const ghMatch = parsedUrl.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/i);
    if (parsedUrl.hostname.includes("greenhouse.io") && ghMatch) {
      const board = ghMatch[1];
      const jobId = ghMatch[2];
      const apiRes = await fetch(
        `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${jobId}`,
        { headers: { Accept: "application/json" } }
      ).catch(() => null);

      if (apiRes && apiRes.ok) {
        const ghData = (await apiRes.json()) as {
          title?: string;
          company_name?: string;
          content?: string;
        };
        const decodedHtml = decodeHtmlEntities(ghData.content || "");
        const jobDescription = htmlToCleanText(decodedHtml);
        return NextResponse.json({
          company:
            ghData.company_name ||
            board.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          role: ghData.title || "",
          jobDescription,
        });
      }
    }

    const response = await fetch(parsedUrl.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `Could not fetch URL (HTTP ${response.status}). Please paste the job description text directly.`,
        },
        { status: 422 }
      );
    }

    const html = await response.text();

    let company = "";
    let role = "";
    let jobDescription = "";

    // 1. Try JSON-LD JobPosting schema
    const ldMatches =
      html.match(
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
      ) || [];

    for (const scriptBlock of ldMatches) {
      const jsonText = scriptBlock
        .replace(/^<script[^>]*>/i, "")
        .replace(/<\/script>$/i, "")
        .trim();
      try {
        const parsed = JSON.parse(jsonText);
        const jobPosting = findJobPostingJsonLd(parsed);
        if (jobPosting) {
          if (typeof jobPosting.title === "string") {
            role = decodeHtmlEntities(jobPosting.title);
          }
          const org = jobPosting.hiringOrganization as
            | { name?: string }
            | undefined;
          if (org && typeof org.name === "string") {
            company = decodeHtmlEntities(org.name);
          }
          if (typeof jobPosting.description === "string") {
            jobDescription = htmlToCleanText(jobPosting.description);
          }
          break;
        }
      } catch {
        // Ignore malformed JSON-LD block
      }
    }

    // 2. Fallback to OpenGraph / <title>
    const ogTitle =
      extractMetaContent(html, "og:title") ||
      extractMetaContent(html, "twitter:title") ||
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ||
      "";
    const ogSite = extractMetaContent(html, "og:site_name") || "";
    const ogDesc =
      extractMetaContent(html, "og:description") ||
      extractMetaContent(html, "description") ||
      "";

    if (!role && ogTitle) {
      const cleanTitle = decodeHtmlEntities(ogTitle);
      const parts = cleanTitle.split(/\s+(?:at|@|-|–|—|\|)\s+/i);
      role = parts[0]?.trim() || cleanTitle;
      if (!company && parts[1]) {
        company = parts[1].replace(/\s*(Careers|Jobs|LinkedIn|Greenhouse|Lever).*$/i, "").trim();
      }
    }

    if (!company) {
      company = ogSite || inferCompanyFromUrl(parsedUrl);
    }

    // 3. Fallback to main/article or body text for Job Description
    if (!jobDescription || jobDescription.length < 120) {
      const mainMatch =
        html.match(/<main[\s\S]*?<\/main>/i)?.[0] ||
        html.match(/<article[\s\S]*?<\/article>/i)?.[0] ||
        html.match(/<body[\s\S]*?<\/body>/i)?.[0] ||
        html;

      const bodyText = htmlToCleanText(mainMatch);
      jobDescription =
        bodyText.length >= (ogDesc?.length || 0) ? bodyText.slice(0, 12000) : ogDesc;
    }

    if (!jobDescription) {
      return NextResponse.json(
        {
          error:
            "This job board renders content dynamically via client-side scripts. Please copy and paste the job description text below.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      company: company || "Target Company",
      role: role || "Target Role",
      jobDescription,
    });
  } catch (error) {
    console.error("Failed to scrape job URL:", error);
    return NextResponse.json(
      {
        error:
          "Unable to reach that URL directly. Please paste the job description text manually.",
      },
      { status: 500 }
    );
  }
}
