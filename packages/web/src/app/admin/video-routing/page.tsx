import { redirect } from 'next/navigation';

export default function VideoRoutingRedirectPage() {
  redirect('/admin/routing?tab=video');
}

