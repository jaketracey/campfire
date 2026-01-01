'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';

export default function AdminPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/admin/users' as Route);
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="animate-pulse text-gray-500">Redirecting...</div>
    </div>
  );
}
