/** An edit is worth checking again when the text really changed. Link previews and pins also update a message, but leave the words as they were. */
export function isRealEdit(before: string | null | undefined, after: string | null | undefined, edited: boolean): boolean {
  if (!edited || !after || !after.trim()) return false;
  return before === null || before === undefined || before !== after; // an uncached message has no "before": the edit mark is enough
}
