import type { ProviderId } from "@/lib/types";

/** Simple inline provider marks — no external assets, no network fetch. */
export function ProviderMark({ p, size = 22, color }: { p: ProviderId; size?: number; color?: string }) {
  const c = color ?? "currentColor";
  const box = { width: size, height: size, display: "block" } as const;
  switch (p) {
    case "anthropic":
      return (
        <svg viewBox="0 0 24 24" style={box} aria-label="Anthropic">
          <path d="M6.4 3.2h4.05L16.9 20.8h-4.2l-1.28-3.6H5.06L3.8 20.8H-.4L6.4 3.2Zm.02 10.6h3.9L8.37 8.1 6.42 13.8Z" transform="translate(2.2 0)" fill={c} />
          <path d="M17.4 3.2h4.2L15.1 20.8h-4.2L17.4 3.2Z" fill={c} opacity=".55" />
        </svg>
      );
    case "openai":
      return (
        <svg viewBox="0 0 24 24" style={box} aria-label="OpenAI">
          <g fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round">
            <path d="M12 3.2 19 7.3v8.2L12 19.6 5 15.5V7.3l7-4.1Z" />
            <path d="M12 3.2v8.2l7 4.1M12 11.4l-7 4.1M12 11.4l7-4.1" />
          </g>
        </svg>
      );
    case "google":
      return (
        <svg viewBox="0 0 24 24" style={box} aria-label="Google">
          <path d="M12 2c.6 4.9 5.1 9.4 10 10-4.9.6-9.4 5.1-10 10-.6-4.9-5.1-9.4-10-10 4.9-.6 9.4-5.1 10-10Z" fill={c} />
        </svg>
      );
    case "xai":
      return (
        <svg viewBox="0 0 24 24" style={box} aria-label="xAI">
          <path d="M3 3h4l14 18h-4L3 3Zm18 0h-4.2l-4.4 5.6 2.1 2.7L21 3ZM3 21h4.2l4.4-5.6-2.1-2.7L3 21Z" fill={c} />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" style={box} aria-label="Custom endpoint">
          <circle cx="12" cy="12" r="8.4" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="3 3" />
          <circle cx="12" cy="12" r="2.6" fill={c} />
        </svg>
      );
  }
}

export function Wordmark() {
  return (
    <div className="flex items-baseline gap-2 select-none">
      <span className="disp text-[15px] text-ink">MODEL</span>
      <span className="disp text-[15px] text-amber">TALK</span>
      <span className="label ml-1 pt-[3px]">v0.2</span>
    </div>
  );
}
