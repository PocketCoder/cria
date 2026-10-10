import appIcon from '@/assets/app-icon.png';

/** Empty list: the llama icon (the only illustration) above a short message. */
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3.5 p-10 text-center">
      <img src={appIcon} alt="" className="h-[72px] w-[72px] rounded-[18px] opacity-90" />
      <p className="text-sm text-[var(--color-muted-foreground)]">{message}</p>
    </div>
  );
}
