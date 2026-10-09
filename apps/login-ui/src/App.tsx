import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { NextStep } from '@textauth/shared';
import { api, ApiRequestError } from './api';
import { COUNTRIES, guessCountry } from './countries';
import { loadRecaptcha, recaptchaToken } from './recaptcha';

/**
 * The whole login on one page: phone -> SMS code -> (new users) email -> email code.
 * The server decides each next step (NextStep); this only renders it. `tx` comes from
 * /oauth/authorize's redirect and goes with every API call.
 */
type Screen =
  | { step: 'phone' }
  | { step: 'otp'; phone: string; country: string; resendAfterSeconds: number }
  | { step: 'email' }
  | { step: 'email-verify'; email: string }
  | { step: 'redirecting' }
  | { step: 'expired' };

export function App() {
  const tx = new URLSearchParams(location.search).get('tx');
  const [screen, setScreen] = useState<Screen>({ step: tx ? 'phone' : 'expired' });

  useEffect(() => {
    if (tx) loadRecaptcha().catch(() => undefined);
  }, [tx]);

  /** Every step's API errors go through here; an expired login ends the page. */
  function onError(err: unknown): string {
    if (err instanceof ApiRequestError && err.code === 'invalid_transaction') {
      setScreen({ step: 'expired' });
    }
    return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
  }

  function goTo(next: NextStep) {
    if (next.step === 'done') {
      setScreen({ step: 'redirecting' });
      location.assign(next.redirectUrl);
    } else {
      setScreen(next);
    }
  }

  return (
    <main>
      <h1>Log in with your phone</h1>
      {screen.step === 'phone' && (
        <PhoneStep
          tx={tx!}
          onError={onError}
          onSent={(phone, country, resendAfterSeconds) => setScreen({ step: 'otp', phone, country, resendAfterSeconds })}
        />
      )}
      {screen.step === 'otp' && (
        <CodeStep
          key={`otp:${screen.phone}`}
          intro={`We texted a 6-digit code to ${screen.phone}.`}
          webOtp
          resendAfterSeconds={screen.resendAfterSeconds}
          onVerify={(code) => api.verifyOtp({ tx: tx!, code })}
          onResend={async () => {
            const result = await api.startOtp({
              tx: tx!,
              phone: screen.phone,
              country: screen.country,
              recaptchaToken: await recaptchaToken('otp_start'),
            });
            return result.resendAfterSeconds;
          }}
          onDone={goTo}
          onError={onError}
          backLabel="Use a different number"
          onBack={() => setScreen({ step: 'phone' })}
        />
      )}
      {screen.step === 'email' && <EmailStep tx={tx!} onDone={goTo} onError={onError} />}
      {screen.step === 'email-verify' && (
        <CodeStep
          key={`email:${screen.email}`}
          intro={`We emailed a 6-digit code to ${screen.email}.`}
          resendAfterSeconds={30}
          onVerify={(code) => api.verifyEmail({ tx: tx!, code })}
          onResend={async () => {
            await api.submitEmail({ tx: tx!, email: screen.email });
            return 30;
          }}
          onDone={goTo}
          onError={onError}
          backLabel="Use a different email"
          onBack={() => setScreen({ step: 'email' })}
          extra={<SkipEmailButton tx={tx!} onDone={goTo} onError={onError} />}
        />
      )}
      {screen.step === 'redirecting' && <p class="muted">Signing you in…</p>}
      {screen.step === 'expired' && (
        <p>This login has expired or is no longer valid. Please go back to the app and start your login again.</p>
      )}
    </main>
  );
}

interface StepProps {
  onError: (err: unknown) => string;
}

function PhoneStep({
  tx,
  onSent,
  onError,
}: StepProps & { tx: string; onSent: (phone: string, country: string, resendAfterSeconds: number) => void }) {
  const [country, setCountry] = useState(guessCountry);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: Event) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.startOtp({ tx, phone, country, recaptchaToken: await recaptchaToken('otp_start') });
      onSent(phone, country, result.resendAfterSeconds);
    } catch (err) {
      setError(onError(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <p>Enter your mobile number and we'll text you a code.</p>
      <div class="phone">
        <select
          aria-label="Country"
          value={country}
          onChange={(e) => setCountry((e.target as HTMLSelectElement).value as typeof country)}
        >
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name} (+{c.callingCode})
            </option>
          ))}
        </select>
        <input
          type="tel"
          aria-label="Mobile number"
          autocomplete="tel"
          placeholder="Mobile number"
          required
          value={phone}
          onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
        />
      </div>
      {error && <p class="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy || !phone.trim()}>
        {busy ? 'Sending…' : 'Send code'}
      </button>
      <p class="fine-print">
        Protected by reCAPTCHA. Google's <a href="https://policies.google.com/privacy">Privacy Policy</a> and{' '}
        <a href="https://policies.google.com/terms">Terms of Service</a> apply.
      </p>
    </form>
  );
}

function EmailStep({ tx, onDone, onError }: StepProps & { tx: string; onDone: (next: NextStep) => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: Event) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      onDone(await api.submitEmail({ tx, email }));
    } catch (err) {
      setError(onError(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <p>Add your email address so we can reach you. We'll send a code to confirm it.</p>
      <input
        type="email"
        aria-label="Email address"
        autocomplete="email"
        placeholder="you@example.com"
        required
        value={email}
        onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
      />
      {error && <p class="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy || !email.trim()}>
        {busy ? 'Sending…' : 'Send code'}
      </button>
      <SkipEmailButton tx={tx} onDone={onDone} onError={onError} label="I don't have an email" />
    </form>
  );
}

function SkipEmailButton({
  tx,
  onDone,
  onError,
  label = 'Skip and continue without email',
}: StepProps & { tx: string; onDone: (next: NextStep) => void; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function skip() {
    setBusy(true);
    setError(undefined);
    try {
      onDone(await api.skipEmail({ tx }));
    } catch (err) {
      setError(onError(err));
      setBusy(false);
    }
  }

  return (
    <>
      {error && <p class="error" role="alert">{error}</p>}
      <button type="button" class="link" disabled={busy} onClick={skip}>
        {busy ? 'Continuing…' : label}
      </button>
    </>
  );
}

const CODE_LENGTH = 6;

function CodeStep(props: StepProps & {
  intro: string;
  /** Android Chrome: read the code straight from the SMS (WebOTP API). */
  webOtp?: boolean;
  resendAfterSeconds: number;
  onVerify: (code: string) => Promise<NextStep>;
  onResend: () => Promise<number>;
  onDone: (next: NextStep) => void;
  backLabel: string;
  onBack: () => void;
  extra?: ComponentChildren;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [resendIn, setResendIn] = useState(props.resendAfterSeconds);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  useEffect(() => {
    if (!props.webOtp || !('OTPCredential' in window)) return;
    const abort = new AbortController();
    navigator.credentials
      .get({ otp: { transport: ['sms'] }, signal: abort.signal } as CredentialRequestOptions)
      .then((credential) => {
        const received = (credential as { code?: string } | null)?.code;
        if (received) void verify(received);
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, []);

  async function verify(value: string) {
    setCode(value);
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      props.onDone(await props.onVerify(value));
    } catch (err) {
      setError(props.onError(err));
      setCode('');
      setBusy(false);
      input.current?.focus();
    }
  }

  async function resend() {
    setError(undefined);
    setNotice(undefined);
    try {
      setResendIn(await props.onResend());
      setNotice('We sent you a new code.');
    } catch (err) {
      setError(props.onError(err));
    }
  }

  function onInput(event: Event) {
    const value = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(value);
    if (value.length === CODE_LENGTH) void verify(value);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void verify(code);
      }}
    >
      <p>{props.intro}</p>
      <input
        ref={input}
        class="code"
        aria-label="Code"
        inputMode="numeric"
        autocomplete="one-time-code"
        pattern="[0-9]*"
        placeholder="••••••"
        disabled={busy}
        value={code}
        onInput={onInput}
      />
      {error && <p class="error" role="alert">{error}</p>}
      {notice && <p class="muted" role="status">{notice}</p>}
      <button type="submit" disabled={busy || code.length !== CODE_LENGTH}>
        {busy ? 'Checking…' : 'Continue'}
      </button>
      <div class="links">
        <button type="button" class="link" disabled={resendIn > 0} onClick={resend}>
          {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
        </button>
        <button type="button" class="link" onClick={props.onBack}>
          {props.backLabel}
        </button>
      </div>
      {props.extra}
    </form>
  );
}
