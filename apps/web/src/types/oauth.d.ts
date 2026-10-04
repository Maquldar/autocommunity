// Minimal typings for the Google Identity Services and Sign in with Apple JS globals we use.

type GoogleCredentialResponse = { credential: string };

type GoogleButtonOptions = {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  width?: number;
  locale?: string;
};

type GoogleIdentity = {
  accounts: {
    id: {
      initialize(config: { client_id: string; callback: (response: GoogleCredentialResponse) => void; ux_mode?: 'popup' | 'redirect' }): void;
      renderButton(parent: HTMLElement, options: GoogleButtonOptions): void;
    };
  };
};

type AppleSignInResponse = {
  authorization: { id_token: string; code: string; state?: string };
  user?: { email?: string; name?: { firstName?: string; lastName?: string } };
};

type AppleIdAuth = {
  auth: {
    init(config: { clientId: string; scope: string; redirectURI: string; usePopup: boolean; state?: string }): void;
    signIn(): Promise<AppleSignInResponse>;
  };
};

interface Window {
  google?: GoogleIdentity;
  AppleID?: AppleIdAuth;
}
