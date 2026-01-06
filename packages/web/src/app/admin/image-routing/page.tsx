import { redirect } from 'next/navigation';

export default function ImageRoutingRedirectPage() {
  redirect('/admin/routing?tab=image');
}

