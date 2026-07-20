import { useState, useRef, useEffect } from 'react';
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
import { X, Settings } from 'lucide-react';

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
  const isOnline = useOnline();
  const { data: user } = useCurrentUser();


  const settingsRef = useRef<UserSettingsInput>({});

  useEffect(() => {
    if (!user) return;
    const raw = user.raw as Record<string, unknown> | undefined;
    const settings = (raw?.settings as UserSettingsInput | undefined) ?? {};
    settingsRef.current = {
      ...SETTINGS_DEFAULTS,
      ...settings,
      name: settings.name ?? user.name ?? undefined,
    };
  }, [user]);

  const pushSettings = (patch: UserSettingsInput) => {
    settingsRef.current = {
      ...settingsRef.current,
      ...patch,
      frontend_settings: frontendSettingsWithCria(settingsRef.current.frontend_settings),
    };
    return pushUserSettings(settingsRef.current);
  };

  const renderTab = () => {
    switch (activeTab) {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="glass-surface flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg shadow-lg"
        onClick={(e) => e.stopPropagation()}
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

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {renderTab()}
          </div>
        </div>
      </div>
    </div>
  );
}
