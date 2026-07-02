import { redirect } from 'next/navigation';

/**
 * The public metered-pricing estimator ("taxi meter") exposed internal cost and
 * margin figures ("Internal only — don't show prospects") on an unauthenticated
 * page, and marketed a pricing model we no longer run. Redirect to real pricing.
 */
export default function PricingEstimateRedirect() {
  redirect('/pricing');
}
