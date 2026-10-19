/** Shown wherever a photo, document or chat goes to Gemini: free-tier content can be used by Google. */
export function AiDataNote({ what }: { what: string }) {
  return (
    <p className="ai-data-note">
      {what} goes to Google Gemini. On the free tier Google may use it to improve its products, so use demo or non-personal data only.
    </p>
  );
}
