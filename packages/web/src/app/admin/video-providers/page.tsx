import { redirect } from 'next/navigation';

export default function VideoProvidersRedirectPage() {
  redirect('/admin/providers?tab=video');
}

