// Cloudflare Pages Function: serves the SPA shell for /invite/<token> but
// rewrites the OpenGraph/Twitter meta tags so SMS/iMessage/WhatsApp unfurl
// the link into a rich "X challenged you to Wordplay!" preview. Real
// browsers still boot the SPA and React Router renders the invite screen.
//
// This function is excluded from the frontend's tsc build (tsconfig only
// includes src/); wrangler compiles it at deploy time.

interface Env {
  ASSETS: { fetch: (req: Request | string | URL) => Promise<Response> };
  BACKEND_URL?: string;
}

interface Context {
  request: Request;
  params: { token: string };
  env: Env;
}

const OG_IMAGE = "https://wordplay.lightbody.net/og.png";

export const onRequestGet = async (context: Context): Promise<Response> => {
  const { token } = context.params;

  let title = "You've been challenged to Wordplay!";
  let description = "A delightful word game for two.";

  if (context.env.BACKEND_URL) {
    try {
      const res = await fetch(`${context.env.BACKEND_URL}/invites/${token}/preview`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const data = (await res.json()) as { inviter_username?: string; first_word?: string | null };
        if (data.inviter_username) {
          title = `${data.inviter_username} challenged you to Wordplay!`;
        }
        if (data.first_word) {
          description = `They opened with ${data.first_word} — your move.`;
        }
      }
    } catch {
      // Fall back to generic copy on any timeout/error.
    }
  }

  const shell = await context.env.ASSETS.fetch(new URL("/index.html", context.request.url));
  const response = new Response(shell.body, shell);
  response.headers.set("Cache-Control", "public, max-age=300");

  const setContent = (value: string) => ({
    element(el: { setAttribute: (k: string, v: string) => void }) {
      el.setAttribute("content", value);
    },
  });

  // @ts-expect-error HTMLRewriter is a Cloudflare Workers runtime global.
  return new HTMLRewriter()
    .on("title", {
      element(el: { setInnerContent: (v: string) => void }) {
        el.setInnerContent(title);
      },
    })
    .on('meta[property="og:title"]', setContent(title))
    .on('meta[property="og:description"]', setContent(description))
    .on('meta[property="og:image"]', setContent(OG_IMAGE))
    .on('meta[name="twitter:title"]', setContent(title))
    .on('meta[name="twitter:description"]', setContent(description))
    .transform(response);
};
