import { SVGProps } from 'react';

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

export default function IconMerge({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="18" cy="18" r="3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 9v3a6 6 0 0 0 6 6h3" />
      <path d="M18 9v6" />
    </svg>
  );
}
