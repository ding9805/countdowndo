export const dynamic = "force-dynamic";

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserTagCorpus } from '@/lib/tag-utils';

// Returns the user's full tag corpus (BankTask + BankTaskTemplate + Goal),
// deduped case-insensitively (keeping the first casing seen) and sorted. Used
// by forms that tag across sources — e.g. the goal form, which wants to
// suggest tags already used on bank tasks — so the suggestions list matches
// the casing the server-side normalizer will pick.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const corpus = await getUserTagCorpus(userId);

    const seen = new Set<string>();
    const unique: string[] = [];
    for (const tag of corpus) {
      const lower = tag.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      unique.push(tag);
    }
    unique.sort((a, b) => a.localeCompare(b));
    return NextResponse.json(unique);
  } catch (error: any) {
    console.error('GET /api/tags error:', error);
    return NextResponse.json([], { status: 500 });
  }
}