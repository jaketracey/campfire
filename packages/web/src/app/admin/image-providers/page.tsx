import { redirect } from 'next/navigation';

export default function ImageProvidersRedirectPage() {
  redirect('/admin/providers?tab=image');
}

