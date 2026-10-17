import { NextResponse } from 'next/server';
import webpush from 'web-push';

webpush.setVapidDetails(
  'mailto:admin@example.com',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export async function POST(req: Request) {
  try {
    const { subscription, title, body } = await req.json();

    if (!subscription) {
      return NextResponse.json({ error: 'Subscription missing' }, { status: 400 });
    }

    const payload = JSON.stringify({
      title: title || 'New Task Assigned!',
      body: body || 'You have received a new task.',
      url: '/member',
    });

    await webpush.sendNotification(subscription, payload);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Push notification error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}