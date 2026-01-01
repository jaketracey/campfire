import { NextResponse } from 'next/server';
import Stripe from 'stripe';

// Initialize Stripe (conditional to allow build without env vars)
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-12-15.clover', // Use latest API version
    })
  : null;

export async function POST(req: Request) {
  if (!stripe) {
    console.error('Stripe secret key is missing');
    return NextResponse.json(
      { error: 'Stripe configuration error' },
      { status: 500 }
    );
  }

  try {
    const { priceId, plan, billingCycle } = await req.json();

    if (!priceId) {
      return NextResponse.json({ error: 'Price ID is required' }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/pricing`,
      metadata: {
        plan,
        billingCycle,
      },
    });

    return NextResponse.json({ sessionId: session.id });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
