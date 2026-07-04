// Shared by preview.yml and frontend.yml so both workflows can
// collaboratively fill in one PR comment instead of each posting its own,
// regardless of which one finishes first.
const MARKER_PREFIX = '<!-- preview-env-data:';
// Recognized so a stale comment from before this file existed gets rewritten
// in place on the next run instead of leaving a duplicate behind.
const LEGACY_MARKER = '<!-- preview-env-comment -->';

function render(data) {
  const row = (label, value) => `| ${label} | ${value || '⏳ pending'} |`;
  const neonCell = data.neonBranch
    ? data.neonProjectId
      ? `[\`${data.neonBranch}\`](https://console.neon.tech/app/projects/${data.neonProjectId}/branches)`
      : `\`${data.neonBranch}\``
    : null;

  return [
    `${MARKER_PREFIX}${JSON.stringify(data)} -->`,
    '### 🚀 Preview environment',
    '',
    '| Service | URL |',
    '|---|---|',
    row('Frontend', data.frontendUrl),
    row('Backend', data.backendUrl),
    row('Electric', data.electricUrl),
    row('Neon branch', neonCell),
  ].join('\n');
}

async function upsertPreviewComment(github, context, newData) {
  const { data: comments } = await github.rest.issues.listComments({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: context.issue.number,
  });

  // Collect every comment this system has ever posted, oldest first — in
  // steady state there's exactly one, but overlapping runs (e.g. two
  // workflows racing before a concurrency guard was in place) can leave
  // stragglers. Merge them all into one and delete the rest so the PR
  // self-heals back to a single comment regardless of how it got here.
  const matches = comments
    .filter((c) => c.body.startsWith(MARKER_PREFIX) || c.body.startsWith(LEGACY_MARKER))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  let data = {};
  for (const c of matches) {
    if (!c.body.startsWith(MARKER_PREFIX)) continue; // legacy body isn't machine-readable
    const match = c.body.match(/^<!-- preview-env-data:(.*) -->/);
    if (!match) continue;
    try {
      data = { ...data, ...JSON.parse(match[1]) };
    } catch {
      // ignore a malformed marker rather than fail the whole run
    }
  }

  data = { ...data, ...newData };
  const body = render(data);

  const primary = matches[0];
  if (primary) {
    await github.rest.issues.updateComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: primary.id,
      body,
    });
    for (const dup of matches.slice(1)) {
      await github.rest.issues.deleteComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        comment_id: dup.id,
      });
    }
  } else {
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.issue.number,
      body,
    });
  }
}

module.exports = { upsertPreviewComment };
