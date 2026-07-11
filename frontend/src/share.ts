/**
 * Share via the native share sheet when available, otherwise copy the URL to
 * the clipboard. Returns which path ran so callers can show a "copied" toast
 * (or nothing, when the share sheet already gave feedback / was cancelled).
 */
export async function shareOrCopy(shareData: { title: string; text: string; url: string }): Promise<
  "shared" | "copied"
> {
  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch {
      /* user cancelled */
    }
    return "shared";
  }
  await navigator.clipboard.writeText(shareData.url);
  return "copied";
}
