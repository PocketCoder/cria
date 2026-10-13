/**
 * Error text for a batch save that stopped part-way. Items already saved are
 * dropped from the pending list, so say how many landed and that a retry only
 * covers the rest.
 */
export function partialSaveMessage(saved: number, total: number): string {
  if (saved === 0) return 'Some tasks could not be created. Please try again.';
  return `Created ${saved} of ${total} task${total === 1 ? '' : 's'}. Please try again for the rest.`;
}
