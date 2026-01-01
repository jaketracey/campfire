import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('text-brand-500', className)}
    >
      {/* Campfire flames */}
      <path
        d="M16 4C16 4 12 10 12 14C12 16.2091 13.7909 18 16 18C18.2091 18 20 16.2091 20 14C20 10 16 4 16 4Z"
        fill="currentColor"
        className="animate-pulse"
      />
      <path
        d="M10 8C10 8 7 12 7 15C7 17.7614 9.23858 20 12 20C13.3062 20 14.4922 19.4773 15.3633 18.6328C13.4063 18.1172 12 16.2578 12 14C12 11.5 14 7 16 4C13.5 5 10 8 10 8Z"
        fill="currentColor"
        fillOpacity="0.7"
      />
      <path
        d="M22 8C22 8 25 12 25 15C25 17.7614 22.7614 20 20 20C18.6938 20 17.5078 19.4773 16.6367 18.6328C18.5937 18.1172 20 16.2578 20 14C20 11.5 18 7 16 4C18.5 5 22 8 22 8Z"
        fill="currentColor"
        fillOpacity="0.7"
      />
      {/* Logs */}
      <path
        d="M6 24L12 20L16 22L20 20L26 24L22 26L16 24L10 26L6 24Z"
        fill="currentColor"
        fillOpacity="0.3"
      />
      <path
        d="M8 26L14 22L18 24L24 22L26 24L20 28L12 28L8 26Z"
        fill="currentColor"
        fillOpacity="0.2"
      />
    </svg>
  );
}
