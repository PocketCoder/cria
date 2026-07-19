import { useState, useEffect } from 'react';
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

interface Props {
  disabled?: boolean;
}

type TotpPhase = 'loading' | 'not-enrolled' | 'enrolled' | 'enabling' | 'enabled';

export function SecurityTab({ disabled }: Props) {
  const [totpPhase, setTotpPhase] = useState<TotpPhase>('loading');
  const [totpData, setTotpData] = useState<TotpStatus | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [totpPasscode, setTotpPasscode] = useState('');
  const [totpError, setTotpError] = useState('');

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailSuccess, setEmailSuccess] = useState('');

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

  const handlePasswordChange = async () => {
    setPasswordError('');
    setPasswordSuccess('');
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
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

  const handleEmailChange = async () => {
    setEmailError('');
    setEmailSuccess('');
    if (!newEmail.includes('@')) {
      setEmailError('Invalid email address');
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
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Password</h3>
        <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
          <input
            type="password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            placeholder="Current password"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
          />
          {passwordError && <p className="text-xs text-red-500">{passwordError}</p>}
          {passwordSuccess && <p className="text-xs text-green-500">{passwordSuccess}</p>}
          <Button onClick={handlePasswordChange} size="sm" disabled={disabled}>Change Password</Button>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Email</h3>
        <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="New email address"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
          />
          <input
            type="password"
            value={emailPassword}
            onChange={(e) => setEmailPassword(e.target.value)}
            placeholder="Current password"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
          />
          {emailError && <p className="text-xs text-red-500">{emailError}</p>}
          {emailSuccess && <p className="text-xs text-green-500">{emailSuccess}</p>}
          <Button onClick={handleEmailChange} size="sm" disabled={disabled}>Update Email</Button>
        </div>
      </section>

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
              <input
                type="text"
                value={totpPasscode}
                onChange={(e) => setTotpPasscode(e.target.value)}
                placeholder="6-digit code"
                maxLength={6}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
              />
              {totpError && <p className="text-xs text-red-500">{totpError}</p>}
              <Button onClick={handleEnable} size="sm" disabled={disabled || totpPasscode.length !== 6}>
                Confirm & Enable
              </Button>
            </div>
          )}

          {totpPhase === 'enabled' && (
            <div>
              <p className="mb-2 text-sm text-green-500">TOTP is enabled</p>
              {!showDisableDialog ? (
                <Button variant="destructive" size="sm" onClick={() => setShowDisableDialog(true)} disabled={disabled}>
                  Disable TOTP
                </Button>
              ) : (
                <div className="space-y-2">
                  <input
                    type="password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    placeholder="Current password"
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
                  />
                  {totpError && <p className="text-xs text-red-500">{totpError}</p>}
                  <div className="flex gap-2">
                    <Button variant="destructive" size="sm" onClick={handleDisable} disabled={disabled || !disablePassword}>
                      Confirm Disable
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { setShowDisableDialog(false); setDisablePassword(''); setTotpError(''); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
