import { type ButtonHTMLAttributes, type ReactNode } from "react";

export interface PrimeButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  className?: string;
  size?: "default" | "sm" | "xs" | "lg";
}

export default function PrimeButton({
  children,
  className = "",
  size = "default",
  disabled,
  type = "button",
  ...props
}: PrimeButtonProps) {
  const sizeClasses = {
    xs: "h-7 gap-1 px-2.5 text-xs rounded-lg",
    sm: "h-8 gap-1.5 px-3 text-xs rounded-lg",
    default: "h-8.5 gap-1.5 px-3.5 text-xs rounded-xl",
    lg: "h-9.5 gap-2 px-4 text-xs font-semibold rounded-xl",
  }[size];

  return (
    <button
      type={type}
      disabled={disabled}
      className={`group/button cursor-pointer relative overflow-hidden inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-all duration-200 ease-in-out outline-none select-none disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] text-white border border-[#4338ca]/80 dark:border-[#6366f1]/60 bg-[linear-gradient(180deg,#6366f1_0%,#4f46e5_100%)] dark:bg-[linear-gradient(180deg,#4f46e5_0%,#4338ca_100%)] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.45),inset_0_-1px_0_0_rgba(0,0,0,0.14),0_1px_2px_0_rgba(0,0,0,0.06),0_2px_5px_0_rgba(79,70,229,0.22)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25),inset_0_-1px_0_0_rgba(0,0,0,0.20),0_1px_2px_0_rgba(0,0,0,0.25),0_2px_6px_0_rgba(79,70,229,0.35)] before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-[linear-gradient(180deg,#818cf8_0%,#6366f1_100%)] dark:before:bg-[linear-gradient(180deg,#6366f1_0%,#4f46e5_100%)] before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-200 before:ease-in-out [&_svg]:pointer-events-none [&_svg]:shrink-0 [&>*]:relative [&>*]:z-10 ${sizeClasses} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
