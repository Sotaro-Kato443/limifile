export interface PrivacyNoticeProps {
  text: string;
}

export function PrivacyNotice({ text }: PrivacyNoticeProps) {
  return (
    <p class="privacy-notice" role="note">
      <span class="privacy-notice__icon" aria-hidden="true">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      </span>
      {text}
    </p>
  );
}
