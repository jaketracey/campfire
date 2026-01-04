import Link from 'next/link';
import { Flame } from 'lucide-react';

export default function CompanionNotFound() {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="text-center px-4">
        <Flame className="h-16 w-16 text-campfire-500 mx-auto mb-6" />
        <h1 className="text-4xl font-bold text-white mb-4">Companion Not Found</h1>
        <p className="text-gray-400 mb-8 max-w-md mx-auto">
          The companion profile you&apos;re looking for doesn&apos;t exist or hasn&apos;t been published yet.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center px-6 py-3 bg-campfire-500 hover:bg-campfire-600 text-white rounded-lg font-medium transition-colors"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
