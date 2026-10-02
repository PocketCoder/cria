import { useState, useEffect } from 'react';
import { LabeledInput } from '@/components/ui/labeled-input';
import {
  getTotpStatus,
  enrollTotp,
  enableTotp,
  disableTotp,
  fetchTotpQrBlob,
  changePassword,
  updateEmail,
  type TotpStatus,
} from '@/api/account';
import { Button } from '@/components/ui/button';
import { validateEmailAddress, validateNewPassword } from '@/lib/accountValidation';

interface Props {
  disabled?: boolean;
}

type TotpPhase = 'loading' | 'not-enrolled' | 'enrolled' | 'enabling' | 'enabled';

export function SecurityTab({ disabled }: Props) {
  return (
    <div className="space-y-6">
      <PasswordSection disabled={disabled} />
      <EmailSection disabled={disabled} />
      <TotpSection disabled={disabled} />
    </div>
  );
}

function PasswordSection({ disabled }: Props) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const handlePasswordChange = async () => {
    setPasswordError('');
    setPasswordSuccess('');
    const invalid = validateNewPassword(newPassword, confirmPassword);
    if (invalid) {
      setPasswordError(invalid);
      return;
    }
    try {
      await changePassword(oldPassword, newPassword);
      setPasswordSuccess('Password changed successfully');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e) {
      setPasswordError((e as Error).message);
    }
  };

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Password</h3>
      <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
        <LabeledInput
          label="Current password"
          type="password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          inputClassName="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
        />
        <LabeledInput
          label="New password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          inputClassName="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
        />
        <LabeledInput
          label="Confirm new password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          inputClassName="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
        />
        {passwordError && <p className="text-xs text-[var(--color-destructive)]">{passwordError}</p>}
        {passwordSuccess && <p className="text-xs text-[var(--color-success)]">{passwordSuccess}</p>}
        <Button onClick={handlePasswordChange} size="sm" disabled={disabled}>Change Password</Button>
      </div>
    </section>
  );
}

function EmailSection({ disabled }: Props) {
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailSuccess, setEmailSuccess] = useState('');

  const handleEmailChange = async () => {
    setEmailError('');
    setEmailSuccess('');
    const invalid = validateEmailAddress(newEmail);
    if (invalid) {
      setEmailError(invalid);
      return;
    }
    try {
      await updateEmail(newEmail, emailPassword);
      setEmailSuccess('Email update requested');
      setNewEmail('');
      setEmailPassword('');
    } catch (e) {
      setEmailError((e as Error).message);
    }
  };

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Email</h3>
      <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
        <LabeledInput
          label="New email address"
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          inputClassName="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
        />
        <LabeledInput
          label="Current password"
          type="password"
          value={emailPassword}
          onChange={(e) => setEmailPassword(e.target.value)}
          inputClassName="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
        />
        {emailError && <p className="text-xs text-[var(--color-destructive)]">{emailError}</p>}
        {emailSuccess && <p className="text-xs text-[var(--color-success)]">{emailSuccess}</p>}
        <Button onClick={handleEmailChange} size="sm" disabled={disabled}>Update Email</Button>
      </div>
    </section>
  );
}

function TotpSection({ disabled }: Props) {
  const [totpPhase, setTotpPhase] = useState<TotpPhase>('loading');
  const [totpData, setTotpData] = useState<TotpStatus | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [totpPasscode, setTotpPasscode] = useState('');
  const [totpError, setTotpError] = useState('');

  const [disablePassword, setDisablePassword] = useState('');
  const [showDisableDialog, setShowDisableDialog] = useState(false);

  useEffect(() => {
    getTotpStatus()
      .then((status) => {
        if (status?.enabled) {
          setTotpPhase('enabled');
        } else {
          setTotpPhase('not-enrolled');
        }
        setTotpData(status);
      })
      .catch(() => setTotpPhase('not-enrolled'));
  }, []);

  const handleEnroll = async () => {
    setTotpError('');
    try {
      const result = await enrollTotp();
      setTotpData(result);
      setTotpPhase('enrolled');
      const blob = await fetchTotpQrBlob();
      const url = URL.createObjectURL(blob);
      setQrUrl(url);
    } catch (e) {
      setTotpError((e as Error).message);
    }
  };

  const handleEnable = async () => {
    setTotpError('');
    try {
      await enableTotp(totpPasscode);
      setTotpPhase('enabled');
      if (qrUrl) URL.revokeObjectURL(qrUrl);
      setQrUrl(null);
    } catch (e) {
      setTotpError((e as Error).message);
    }
  };

  const handleDisable = async () => {
    setTotpError('');
    try {
      await disableTotp(disablePassword);
      setTotpPhase('not-enrolled');
      setTotpData(null);
      setShowDisableDialog(false);
      setDisablePassword('');
    } catch (e) {
      setTotpError((e as Error).message);
    }
  };

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Two-Factor Authentication</h3>
      <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
        {totpPhase === 'not-enrolled' && (
          <div>
            <p className="mb-2 text-sm text-[var(--color-muted-foreground)]">
              TOTP is not set up. Use an authenticator app like Google Authenticator or Authy.
            </p>
            <Button onClick={handleEnroll} size="sm" disabled={disabled}>Set up TOTP</Button>
          </div>
        )}

        {totpPhase === 'enrolled' && totpData && (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Scan this QR code with your authenticator app, then enter the 6-digit code below.
            </p>
            {qrUrl && (
              <img src={qrUrl} alt="TOTP QR Code" className="mx-auto h-40 w-40 rounded border" />
            )}
            {totpData.secret && (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Secret: <code className="rounded bg-[var(--color-muted)] px-1">{totpData.secret}</code>
              </p>
            )}
            <LabeledInput
              label="Authenticator code"
              type="text"
              value={totpPasscode}
              onChange={(e) => setTotpPasscode(e.target.value)}
              placeholder="6-digit code"
              maxLength={6}
              inputClassName="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
            />
            {totpError && <p className="text-xs text-[var(--color-destructive)]">{totpError}</p>}
            <Button onClick={handleEnable} size="sm" disabled={disabled || totpPasscode.length !== 6}>
              Confirm & Enable
            </Button>
          </div>
        )}

        {totpPhase === 'enabled' && (
          <TotpEnabledPanel
            disabled={disabled}
            showDisableDialog={showDisableDialog}
            disablePassword={disablePassword}
            totpError={totpError}
            onShowDisable={() => setShowDisableDialog(true)}
            onPasswordChange={setDisablePassword}
            onConfirmDisable={handleDisable}
            onCancelDisable={() => {
              setShowDisableDialog(false);
              setDisablePassword('');
              setTotpError('');
            }}
          />
        )}
      </div>
    </section>
  );
}

function TotpEnabledPanel({
  disabled,
  showDisableDialog,
  disablePassword,
  totpError,
  onShowDisable,
  onPasswordChange,
  onConfirmDisable,
  onCancelDisable,
}: {
  disabled?: boolean;
  showDisableDialog: boolean;
  disablePassword: string;
  totpError: string;
  onShowDisable: () => void;
  onPasswordChange: (value: string) => void;
  onConfirmDisable: () => void;
  onCancelDisable: () => void;
}) {
  return (
    <div>
      <p className="mb-2 text-sm text-[var(--color-success)]">TOTP is enabled</p>
      {!showDisableDialog ? (
        <Button variant="destructive" size="sm" onClick={onShowDisable} disabled={disabled}>
          Disable TOTP
        </Button>
      ) : (
        <div className="space-y-2">
          <LabeledInput
            label="Current password"
            type="password"
            value={disablePassword}
            onChange={(e) => onPasswordChange(e.target.value)}
            inputClassName="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
          />
          {totpError && <p className="text-xs text-[var(--color-destructive)]">{totpError}</p>}
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={onConfirmDisable} disabled={disabled || !disablePassword}>
              Confirm Disable
            </Button>
            <Button variant="outline" size="sm" onClick={onCancelDisable}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
