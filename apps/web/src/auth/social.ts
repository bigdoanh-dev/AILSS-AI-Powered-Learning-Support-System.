import type { SupportedLanguage } from "../../../../packages/localization/src";

export interface SocialWebConfig {
  googleClientId: string;
  appleClientId: string;
  appleRedirectUri: string;
}

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleIdentityApi {
  initialize(options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    ux_mode: "popup";
    auto_select: false;
  }): void;
  renderButton(
    element: HTMLElement,
    options: {
      type: "standard";
      theme: "outline";
      size: "large";
      text: "signin_with";
      shape: "rectangular";
      width: number;
      locale: SupportedLanguage;
    },
  ): void;
}

interface AppleSignInResponse {
  authorization?: {
    id_token?: string;
    state?: string;
  };
  user?: {
    name?: {
      firstName?: string;
      lastName?: string;
    };
  };
}

interface AppleIdentityApi {
  auth: {
    init(options: {
      clientId: string;
      scope: "name email";
      redirectURI: string;
      state: string;
      usePopup: true;
    }): void;
    signIn(): Promise<AppleSignInResponse>;
  };
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdentityApi } };
    AppleID?: AppleIdentityApi;
  }
}

const sdkLoads = new Map<string, Promise<void>>();
const initializedGoogle = new WeakMap<
  GoogleIdentityApi,
  { clientId: string; onCredential: (token: string) => void }
>();

function loadSdk(id: string, src: string, isReady: () => boolean): Promise<void> {
  if (isReady()) return Promise.resolve();
  const existingLoad = sdkLoads.get(id);
  if (existingLoad) return existingLoad;

  const load = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    script.dataset.ailssSdk = id;
    script.onload = () => {
      if (isReady()) resolve();
      else reject(new Error(`${id.toUpperCase()}_SDK_UNAVAILABLE`));
    };
    script.onerror = () => reject(new Error(`${id.toUpperCase()}_SDK_LOAD_FAILED`));
    document.head.append(script);
  }).catch((error: unknown) => {
    sdkLoads.delete(id);
    document.querySelector(`script[data-ailss-sdk="${id}"]`)?.remove();
    throw error;
  });
  sdkLoads.set(id, load);
  return load;
}

export async function mountGoogleSignInButton(
  element: HTMLElement,
  clientId: string,
  onCredential: (idToken: string) => void,
  language: SupportedLanguage = "vi",
  signal?: AbortSignal,
): Promise<void> {
  await loadSdk("google", `https://accounts.google.com/gsi/client?hl=${language}`, () =>
    Boolean(window.google?.accounts?.id),
  );
  const google = window.google?.accounts?.id;
  if (!google) throw new Error("GOOGLE_SDK_UNAVAILABLE");
  if (signal?.aborted) return;

  const previous = initializedGoogle.get(google);
  if (previous?.clientId === clientId) previous.onCredential = onCredential;
  else {
    const current = { clientId, onCredential };
    initializedGoogle.set(google, current);
    google.initialize({
      client_id: clientId,
      callback: ({ credential }) => {
        if (credential) current.onCredential(credential);
      },
      ux_mode: "popup",
      auto_select: false,
    });
  }
  let renderedWidth = 0;
  const render = () => {
    if (signal?.aborted) return;
    const width = Math.max(200, Math.min(400, Math.floor(element.getBoundingClientRect().width || 340)));
    if (width === renderedWidth) return;
    renderedWidth = width;
    element.replaceChildren();
    google.renderButton(element, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "rectangular",
      width,
      locale: language,
    });
  };
  render();
  // Match responsive layout changes without reinitializing the Google identity client.
  // Auth owns this signal and cancels it on unmount or language changes.
  if (signal && typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(render);
    observer.observe(element);
    signal.addEventListener("abort", () => observer.disconnect(), { once: true });
  }
}

export function prepareAppleSignIn(): Promise<void> {
  return loadSdk(
    "apple",
    "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js",
    () => Boolean(window.AppleID?.auth),
  );
}

export function requestAppleIdToken(
  config: Pick<SocialWebConfig, "appleClientId" | "appleRedirectUri">,
): Promise<{ idToken: string; clientProfile?: { firstName?: string; lastName?: string } }> {
  const apple = window.AppleID;
  if (!apple) return Promise.reject(new Error("APPLE_SDK_UNAVAILABLE"));

  const state = crypto.randomUUID();
  apple.auth.init({
    clientId: config.appleClientId,
    scope: "name email",
    redirectURI: config.appleRedirectUri,
    state,
    usePopup: true,
  });
  return apple.auth.signIn().then((response) => {
    const authorization = response.authorization;
    if (!authorization?.id_token) throw new Error("APPLE_ID_TOKEN_MISSING");
    if (authorization.state !== state) throw new Error("APPLE_STATE_MISMATCH");

    const firstName = response.user?.name?.firstName?.trim();
    const lastName = response.user?.name?.lastName?.trim();
    const clientProfile = {
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
    };
    return {
      idToken: authorization.id_token,
      ...(Object.keys(clientProfile).length ? { clientProfile } : {}),
    };
  });
}
