const SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string;

interface Grecaptcha {
  ready(callback: () => void): void;
  execute(siteKey: string, options: { action: string }): Promise<string>;
}

declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
  }
}

let loaded: Promise<Grecaptcha> | undefined;

/** Loads reCAPTCHA v3 once. Called early so the first token isn't slowed down by the script. */
export function loadRecaptcha(): Promise<Grecaptcha> {
  loaded ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(SITE_KEY)}`;
    script.async = true;
    script.onload = () => window.grecaptcha!.ready(() => resolve(window.grecaptcha!));
    script.onerror = () => {
      loaded = undefined;
      reject(new Error('Could not load reCAPTCHA'));
    };
    document.head.appendChild(script);
  });
  return loaded;
}

/** v3 is invisible: a fresh token per protected action, scored by Google, checked by our API. */
export async function recaptchaToken(action: string): Promise<string> {
  const grecaptcha = await loadRecaptcha();
  return grecaptcha.execute(SITE_KEY, { action });
}
