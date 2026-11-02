const base = "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-semibold shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:shrink-0";

const variants = {
  secondary: "border-slate-200 bg-white text-slate-700 hover:border-[#155D3B]/40 hover:bg-[#F0F7F3] hover:text-[#155D3B] focus-visible:outline-[#155D3B]",
  primary: "border-[#155D3B] bg-[#155D3B] text-white hover:border-[#104A2F] hover:bg-[#104A2F] focus-visible:outline-[#155D3B]",
  danger: "border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100 focus-visible:outline-red-700",
};

export function actionButtonStyles(variant: keyof typeof variants = "secondary", size: "sm" | "xs" = "sm") {
  return `${base} ${size === "xs" ? "min-h-7 px-2 py-1 text-[11px]" : "min-h-9 px-3 py-2 text-xs"} ${variants[variant]}`;
}
