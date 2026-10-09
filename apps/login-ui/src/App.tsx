import { useState } from 'preact/hooks';
import type { NextStep } from '@textauth/shared';

type Step = { step: 'phone' } | { step: 'otp' } | NextStep;

/**
 * The whole login flow on one page: phone -> SMS code -> email (optional) -> email code.
 * `tx` comes from /oauth/authorize's redirect and goes with every API call.
 *
 * TODO: wire each step to its /api endpoint (contract in @textauth/shared) and load
 * reCAPTCHA v3 for the phone step.
 */
export function App() {
  const tx = new URLSearchParams(location.search).get('tx');
  const [current] = useState<Step>({ step: 'phone' });

  if (!tx) {
    return (
      <main>
        <h1>Log in with your phone</h1>
        <p>This page is opened from the app's login screen. Please start your login there.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Log in with your phone</h1>
      <p>Step: {current.step}</p>
    </main>
  );
}
