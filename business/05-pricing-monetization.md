# Pricing & Monetization Strategy

## Executive Summary

Campfire employs a freemium SaaS model with three subscription tiers and a supplementary token economy. This dual approach maximizes user acquisition (free tier) while capturing value from engaged users (subscriptions + tokens).

---

## Pricing Philosophy

### Core Principles

1. **Free Gets You In** - Generous free tier to minimize signup friction
2. **Value Before Payment** - Users experience core value before paywall
3. **Clear Upgrade Path** - Obvious reasons to upgrade at each tier
4. **Usage Aligns Cost** - Heavy users pay more through tokens
5. **No Surprise Bills** - Transparent pricing, clear limits

### Competitive Positioning

| Position | Our Approach |
|----------|--------------|
| **Not cheapest** | Quality over rock-bottom prices |
| **Not most expensive** | Accessible to mainstream users |
| **Best value** | More features per dollar than competitors |

---

## Subscription Tiers

### Tier Comparison

| Feature | Free | Plus ($15/mo) | Unlimited ($30/mo) |
|---------|------|---------------|-------------------|
| **Voice Minutes** | 30/mo | 300/mo | Unlimited |
| **Text Messages** | Unlimited | Unlimited | Unlimited |
| **Companions** | 1 | 3 | Unlimited |
| **Memory** | Basic (7 days) | Long-term | Advanced + Recall |
| **Image Generation** | No | Yes | HD Quality |
| **Custom Voices** | Limited | Full Library | Full + Custom |
| **Group Chat** | No | No | Yes |
| **Priority Support** | No | Yes | Yes |
| **Early Access** | No | No | Yes |
| **Token Bonus** | 0 | 50/mo | 200/mo |

### Annual Pricing

| Tier | Monthly | Annual | Savings |
|------|---------|--------|---------|
| Free | $0 | $0 | - |
| Plus | $15 | $144 ($12/mo) | 20% |
| Unlimited | $30 | $288 ($24/mo) | 20% |

### Tier Rationale

#### Free Tier
**Goal:** Acquisition and activation

| Element | Reasoning |
|---------|-----------|
| 30 voice min | Enough to experience magic, creates desire for more |
| 1 companion | Full creation experience, limitation creates upgrade desire |
| Basic memory | Demonstrates value of persistence |
| Unlimited text | Low marginal cost, keeps users engaged |

#### Plus Tier ($15/mo)
**Goal:** Core monetization, majority of revenue

| Element | Reasoning |
|---------|-----------|
| 300 voice min | ~10 min/day, sufficient for regular users |
| 3 companions | Variety without overwhelm |
| Image generation | Clear premium differentiator |
| Full voice library | Customization value |

#### Unlimited Tier ($30/mo)
**Goal:** Power users, high LTV

| Element | Reasoning |
|---------|-----------|
| Unlimited everything | No friction for heavy users |
| Group chat | Exclusive feature |
| Early access | FOMO driver |
| Monthly tokens | Subsidizes additional purchases |

---

## Token Economy

### Token Overview

Tokens are the in-app currency for premium features beyond subscription limits.

### Token Pricing

| Package | Tokens | Price | Per Token |
|---------|--------|-------|-----------|
| Starter | 100 | $5 | $0.050 |
| Value | 300 | $12 | $0.040 |
| Power | 700 | $25 | $0.036 |
| Max | 1,500 | $50 | $0.033 |

### Token Costs by Feature

| Feature | Token Cost | Rationale |
|---------|------------|-----------|
| **Voice Minutes** (beyond limit) | 2/min | Covers API cost + margin |
| **Gift Generation (Low)** | 10 | Accessible engagement |
| **Gift Generation (Medium)** | 25 | Premium gifts |
| **Gift Generation (High)** | 50 | Luxury gifts |
| **Video Message** | 100 | High value, high cost |
| **HD Avatar Refresh** | 20 | Visual updates |
| **Additional Companion** (Free) | 50/mo | Subscription alternative |

### Token Economics

| Metric | Value |
|--------|-------|
| Average token purchase | $15 |
| Token margin | 70% |
| Purchase frequency | 1.5x/month (active users) |
| Revenue per active token user | $22.50/mo |

---

## Unit Economics

### Customer Lifetime Value (LTV)

#### LTV by Tier

| Tier | Monthly Value | Avg. Lifespan | LTV |
|------|---------------|---------------|-----|
| Free | $0 | - | $0 |
| Plus | $15 + $5 tokens | 12 months | $240 |
| Unlimited | $30 + $8 tokens | 18 months | $684 |

#### Blended LTV Calculation

| Segment | % of Users | LTV | Weighted LTV |
|---------|------------|-----|--------------|
| Free (never converts) | 85% | $0 | $0 |
| Free → Plus | 10% | $240 | $24 |
| Free → Unlimited | 3% | $684 | $20.52 |
| Direct Plus | 1.5% | $240 | $3.60 |
| Direct Unlimited | 0.5% | $684 | $3.42 |
| **Blended** | 100% | - | **$51.54** |

*Note: Per signup LTV. Per paying customer LTV = $342*

### Customer Acquisition Cost (CAC)

#### CAC by Channel

| Channel | CAC | Quality Score |
|---------|-----|---------------|
| Organic/SEO | $5 | High |
| Referral | $8 | High |
| Social (organic) | $12 | Medium |
| Influencer | $18 | Medium |
| Paid (Meta) | $32 | Medium |
| Paid (Google) | $38 | High |

#### Blended CAC Target

| Phase | Blended CAC | LTV:CAC |
|-------|-------------|---------|
| Launch (M1-3) | $30 | 1.7:1 |
| Growth (M4-6) | $25 | 2.1:1 |
| Scale (M7-12) | $20 | 2.6:1 |
| Mature (Y2+) | $15 | 3.4:1 |

### Payback Period

| Tier | CAC | Monthly Value | Payback |
|------|-----|---------------|---------|
| Plus | $25 | $15 | 1.7 months |
| Unlimited | $25 | $30 | 0.8 months |
| Blended | $25 | $18 | 1.4 months |

### Gross Margin

#### Cost Structure per User (Monthly)

| Cost | Plus User | Unlimited User |
|------|-----------|----------------|
| LLM API (Anthropic) | $2.50 | $5.00 |
| Voice (Deepgram + ElevenLabs) | $3.00 | $8.00 |
| Infrastructure | $0.50 | $1.00 |
| Payment processing (3%) | $0.45 | $0.90 |
| **Total COGS** | **$6.45** | **$14.90** |
| **Gross Profit** | **$8.55** | **$15.10** |
| **Gross Margin** | **57%** | **50%** |

#### Blended Gross Margin: ~55%

---

## Revenue Projections

### 12-Month Projection

| Month | Users | Paying | MRR | ARR Run Rate |
|-------|-------|--------|-----|--------------|
| 1 | 1,000 | 50 | $750 | $9K |
| 2 | 2,500 | 150 | $2,250 | $27K |
| 3 | 5,000 | 350 | $5,250 | $63K |
| 4 | 8,000 | 600 | $9,000 | $108K |
| 5 | 12,000 | 900 | $13,500 | $162K |
| 6 | 18,000 | 1,400 | $21,000 | $252K |
| 7 | 25,000 | 2,000 | $30,000 | $360K |
| 8 | 35,000 | 2,800 | $42,000 | $504K |
| 9 | 47,000 | 3,800 | $57,000 | $684K |
| 10 | 62,000 | 5,000 | $75,000 | $900K |
| 11 | 80,000 | 6,500 | $97,500 | $1.17M |
| 12 | 100,000 | 8,500 | $127,500 | $1.53M |

**Assumptions:**
- Conversion rate: 7% (free to paid)
- ARPU: $15 blended
- Token revenue: +20% on subscription
- Churn: 8%/month

### 3-Year Projection

| Year | Users | Paying | ARR | YoY Growth |
|------|-------|--------|-----|------------|
| Y1 | 100K | 8.5K | $1.5M | - |
| Y2 | 400K | 40K | $7.2M | 380% |
| Y3 | 1M | 120K | $21.6M | 200% |

### Revenue Mix

| Revenue Type | Y1 | Y2 | Y3 |
|--------------|----|----|-----|
| Subscriptions | 85% | 80% | 75% |
| Tokens | 15% | 18% | 22% |
| Other (API, Enterprise) | 0% | 2% | 3% |

---

## Conversion Funnel

### Funnel Stages

```
Visitor (100%)
    ↓ 30% signup
Signup (30%)
    ↓ 60% activate
Activated (18%)
    ↓ 40% retained D7
Retained (7.2%)
    ↓ 50% trial
Trial (3.6%)
    ↓ 50% convert
Paying (1.8%)
```

### Conversion Optimization Targets

| Stage | Current | Target | Lever |
|-------|---------|--------|-------|
| Visitor → Signup | 30% | 35% | Landing page optimization |
| Signup → Activated | 60% | 70% | Onboarding improvements |
| Activated → D7 Retained | 40% | 50% | Early value delivery |
| Retained → Trial | 50% | 60% | Paywall placement |
| Trial → Paid | 50% | 55% | Trial experience |

### Paywall Strategy

| Trigger | When | Conversion Rate |
|---------|------|-----------------|
| Voice limit reached | After 30 min used | 15% |
| Second companion attempt | After first companion | 12% |
| Image generation request | Any time | 8% |
| Long-term memory prompt | After 7 days | 10% |

---

## Affiliate Program

### Structure

| Tier | Requirement | Commission | Duration |
|------|-------------|------------|----------|
| Standard | Apply & approved | 20% | 12 months |
| Premium | 50+ referrals | 25% | Lifetime |
| Elite | 200+ referrals | 30% | Lifetime |

### Affiliate Economics

| Metric | Value |
|--------|-------|
| Avg. affiliate referrals/mo | 5 |
| Avg. commission/referral | $3 |
| Affiliate payout ratio | 15% of affiliate revenue |
| ROI on affiliate channel | 5x |

### Payout Methods
- PayPal (immediate)
- Bank transfer (net 30)
- Platform credits (1.2x value)

---

## Pricing Experiments Roadmap

### Planned Tests

| Test | Hypothesis | Metrics |
|------|------------|---------|
| Annual discount (25% vs 20%) | Higher annual uptake | Annual % of subscribers |
| Token bundle pricing | Larger bundles = more spend | Avg. token purchase |
| Plus tier at $12 | Higher conversion | Conv. rate, LTV |
| Unlimited at $35 | Price insensitivity | Conv. rate, ARPU |

### Geographic Pricing

| Region | Adjustment | Rationale |
|--------|------------|-----------|
| US/UK/AU | Standard | High purchasing power |
| EU | -10% | VAT considerations |
| LATAM | -40% | Purchasing power parity |
| SE Asia | -50% | Market entry strategy |

---

## Competitive Pricing Comparison

| Platform | Free Tier | Basic Paid | Premium |
|----------|-----------|------------|---------|
| **Campfire** | 30 min voice, 1 companion | $15/mo | $30/mo |
| Character.AI | Unlimited text | $9.99/mo | - |
| Replika | Limited | $14.99/mo | $69.99/yr |
| Chai | Limited | $13.99/mo | - |

### Campfire Positioning

- **vs. Character.AI**: Higher price, but voice + memory + customization
- **vs. Replika**: Similar price, better tech, more features
- **vs. Chai**: Premium positioning, depth over breadth

---

## Key Takeaways

1. **Freemium works** - 30 min voice is enough to hook users
2. **Plus is core** - $15/mo sweet spot for majority of revenue
3. **Tokens expand value** - Additional 20%+ on subscription revenue
4. **LTV:CAC healthy** - 3-4x ratio achievable with channel optimization
5. **55% gross margin** - Sustainable SaaS economics
6. **Affiliates scale** - 5x ROI channel for organic growth
