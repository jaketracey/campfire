import { redirect } from 'next/navigation';

export default function HomePage() {
  // Redirect to login for now - will add auth check later
  redirect('/login');
}
