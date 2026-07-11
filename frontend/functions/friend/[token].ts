// Cloudflare Pages Function: serves the SPA shell for /friend/<token> but
// rewrites the OpenGraph/Twitter meta tags so SMS/iMessage/WhatsApp unfurl
// the personal friend link into a rich "X wants to play Wordplay with you!"
// preview. Real browsers still boot the SPA and React Router renders the
// friend-accept screen. Sibling of functions/invite/[token].ts.
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

  let title = "You've been invited to Wordplay!";
  const description = "A delightful word game for two.";

  if (context.env.BACKEND_URL) {
    try {
      const res = await fetch(`${context.env.BACKEND_URL}/friends/${token}/preview`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const data = (await res.json()) as { username?: string };
        if (data.username) {
          title = `${data.username} wants to play Wordplay with you!`;
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
