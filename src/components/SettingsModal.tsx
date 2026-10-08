import { useState, useRef, useEffect } from 'react';
import { BackdropDismiss } from '@/components/ui/backdrop-dismiss';
import { useCurrentUser } from '@/queries/user';
import { useOnline } from '@/hooks/useOnline';
import { pushUserSettings, type UserSettingsInput, SETTINGS_DEFAULTS } from '@/api/userSettings';
import { frontendSettingsWithCria } from '@/sync/settingsSync';
import { AccountTab } from '@/components/settings/AccountTab';
import { GeneralTab } from '@/components/settings/GeneralTab';
import { AppearanceTab } from '@/components/settings/AppearanceTab';
import { PhotoCaptureTab } from '@/components/settings/PhotoCaptureTab';
import { ShortcutsTab } from '@/components/settings/ShortcutsTab';
import { NotificationsTab } from '@/components/settings/NotificationsTab';
import { SecurityTab } from '@/components/settings/SecurityTab';
import { TeamsTab } from '@/components/settings/TeamsTab';
import { TokensTab } from '@/components/settings/TokensTab';
import { DataTab } from '@/components/settings/DataTab';
import { AdvancedTab } from '@/components/settings/AdvancedTab';
import { X, Settings, ChevronLeft, ChevronRight } from 'lucide-react';
import { useIsMobile } from '@/lib/useIsMobile';

interface SettingsModalProps {
  onClose: () => void;
  initialTab?: TabId;
}

type TabId =
  | 'account'
  | 'general'
  | 'appearance'
  | 'photo-capture'
  | 'shortcuts'
  | 'notifications'
  | 'security'
  | 'teams'
  | 'tokens'
  | 'data'
  | 'advanced';

const TABS: { id: TabId; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'photo-capture', label: 'Photo capture' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'security', label: 'Security' },
  { id: 'teams', label: 'Teams' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'data', label: 'Data' },
  { id: 'advanced', label: 'Advanced' },
];

export function SettingsModal({ onClose, initialTab }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab ?? 'account');
  const isMobile = useIsMobile();
  // Mobile drills in: null = the section list, otherwise that section's page.
  const [mobileTab, setMobileTab] = useState<TabId | null>(initialTab ?? null);
  const isOnline = useOnline();
  const { data: user } = useCurrentUser();


  const settingsRef = useRef<UserSettingsInput>({});

  useEffect(() => {
    if (!user) return;
    const raw = user.raw as Record<string, unknown> | undefined;
    const settings = (raw?.settings as UserSettingsInput | undefined) ?? {};
    // Server values as the base; anything already changed in this session
    // (held in settingsRef) wins so a background user refetch can't clobber
    // an unsaved edit — the server overwrites every column from whatever we
    // POST next, so a stale refetch landing on top would silently revert it.
    settingsRef.current = {
      ...SETTINGS_DEFAULTS,
      ...settings,
      name: settings.name ?? user.name ?? undefined,
      ...settingsRef.current,
    };
  }, [user]);

  // Escape closes the modal, unless something inside already handled it
  // (Radix selects/popovers and inline edits call preventDefault).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const pushSettings = (patch: UserSettingsInput) => {
    settingsRef.current = {
      ...settingsRef.current,
      ...patch,
      frontend_settings: frontendSettingsWithCria(settingsRef.current.frontend_settings),
    };
    return pushUserSettings(settingsRef.current);
  };

  const renderTab = (tab: TabId = activeTab) => {
    switch (tab) {
      case 'account':
        return <AccountTab disabled={!isOnline} onPushSettings={pushSettings} />;
      case 'general':
        return <GeneralTab disabled={!isOnline} onPushSettings={pushSettings} />;
      case 'appearance':
        return <AppearanceTab />;
      case 'photo-capture':
        return <PhotoCaptureTab />;
      case 'shortcuts':
        return <ShortcutsTab />;
      case 'notifications':
        return <NotificationsTab disabled={!isOnline} />;
      case 'security':
        return <SecurityTab disabled={!isOnline} />;
      case 'teams':
        return <TeamsTab disabled={!isOnline} />;
      case 'tokens':
        return <TokensTab disabled={!isOnline} />;
      case 'data':
        return <DataTab disabled={!isOnline} />;
      case 'advanced':
        return <AdvancedTab />;
    }
  };

  if (isMobile) {
    const current = mobileTab ? TABS.find((t) => t.id === mobileTab) : null;
    return (
      <div
        className="safe-top safe-bottom safe-x fixed inset-0 z-50 flex flex-col bg-[var(--color-background)]"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <header className="grid grid-cols-[4rem_1fr_4rem] items-center border-b border-[var(--color-border)] px-2 py-2">
          {current ? (
            <button
              onClick={() => setMobileTab(null)}
              className="flex items-center text-[var(--color-primary)]"
              aria-label="Back to settings"
            >
              <ChevronLeft className="h-6 w-6" />
              <span className="text-[15px]">Back</span>
            </button>
          ) : (
            <span />
          )}
          <h2 className="truncate text-center text-base font-semibold">{current?.label ?? 'Settings'}</h2>
          <button
            onClick={onClose}
            className="justify-self-end px-2 text-[15px] font-medium text-[var(--color-primary)]"
          >
            Done
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {current ? (
            <div className="px-4 py-4">{renderTab(current.id)}</div>
          ) : (
            <ul className="mx-4 my-4 divide-y divide-[var(--color-border)] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]">
              {TABS.map((tab) => (
                <li key={tab.id}>
                  <button
                    onClick={() => setMobileTab(tab.id)}
                    className="flex w-full items-center justify-between px-4 py-3.5 text-left text-[15px]"
                  >
                    {tab.label}
                    <ChevronRight className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <BackdropDismiss onDismiss={onClose} />
      <div
        className="relative bg-[var(--color-card)] border border-[var(--color-border)] flex h-[min(80vh,640px)] w-full max-w-2xl flex-col overflow-hidden rounded-lg shadow-lg"
      >
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-[var(--color-muted-foreground)]" />
            <h2 className="text-base font-semibold">Settings</h2>
          </div>
          <button onClick={onClose} className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <nav className="w-44 shrink-0 border-r border-[var(--color-border)] p-2">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium'
                    : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto px-4 py-4 [scrollbar-gutter:stable]">
            {renderTab()}
          </div>
        </div>
      </div>
    </div>
  );
}
